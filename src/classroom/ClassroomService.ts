import { Course, CourseWork, StudentSubmission } from '../types/index.js';
import { ClassroomApiError, friendlyHttpError } from '../errors/errors.js';
import {
  ListCoursesOptions,
  ListCoursesResponse,
  ListCourseWorkOptions,
  ListCourseWorkResponse,
  ListStudentSubmissionsResponse,
  AssignmentWithSubmission,
  DueStatus,
  SubmissionStatus,
} from './types.js';
import { Logger } from '../utils/logger.js';

const CLASSROOM_API_BASE = 'https://classroom.googleapis.com/v1';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache lifetime

export interface IClassroomService {
  listCourses(options?: ListCoursesOptions): Promise<Course[]>;
  getCourse(courseId: string): Promise<Course>;
  listCourseWork(courseId: string, options?: ListCourseWorkOptions): Promise<CourseWork[]>;
  getCourseWork(courseId: string, courseWorkId: string): Promise<CourseWork>;
  listStudentSubmissions(courseId: string, courseWorkId?: string): Promise<StudentSubmission[]>;
  listAssignmentsWithSubmissions(
    courseId: string,
    options?: ListCourseWorkOptions,
  ): Promise<AssignmentWithSubmission[]>;
  clearCache(): void;
}

export class ClassroomService implements IClassroomService {
  private readonly getAccessToken: () => Promise<string>;
  private readonly logger = Logger.getInstance();

  private cachedCourses: Course[] | null = null;
  private cacheCoursesExpiresAt: number = 0;

  private cachedCourseWork: Map<string, { items: CourseWork[]; expiresAt: number }> = new Map();

  constructor(tokenProvider: () => Promise<string>) {
    this.getAccessToken = tokenProvider;
  }

  /**
   * Retrieves all courses for the user from Google Classroom.
   * Handles pagination automatically to collect full course listings.
   * Results are cached for 5 minutes unless `forceRefresh` is specified.
   */
  public async listCourses(options?: ListCoursesOptions): Promise<Course[]> {
    const forceRefresh = options?.forceRefresh ?? false;

    // Check memory cache
    if (!forceRefresh && this.cachedCourses && Date.now() < this.cacheCoursesExpiresAt) {
      this.logger.info(`ClassroomService: Returning ${this.cachedCourses.length} courses from memory cache.`);
      return this.filterCoursesByState(this.cachedCourses, options?.courseStates);
    }

    const allCourses: Course[] = [];
    let nextPageToken: string | undefined = undefined;
    const statesToRequest = options?.courseStates ?? ['ACTIVE'];

    this.logger.info('ClassroomService: Fetching courses from Google Classroom API…');

    do {
      const url = new URL(`${CLASSROOM_API_BASE}/courses`);
      url.searchParams.set('pageSize', String(options?.pageSize ?? 50));

      for (const state of statesToRequest) {
        url.searchParams.append('courseStates', state);
      }

      if (options?.studentId) {
        url.searchParams.set('studentId', options.studentId);
      }

      if (nextPageToken) {
        url.searchParams.set('pageToken', nextPageToken);
      }

      const response = await this.executeRequest<ListCoursesResponse>(url.toString());

      if (response.courses && response.courses.length > 0) {
        allCourses.push(...response.courses);
      }

      nextPageToken = response.nextPageToken;
    } while (nextPageToken);

    // Update memory cache
    this.cachedCourses = allCourses;
    this.cacheCoursesExpiresAt = Date.now() + CACHE_TTL_MS;

    this.logger.info(`ClassroomService: Successfully retrieved ${allCourses.length} courses.`);
    return allCourses;
  }

  /**
   * Retrieves a single course by its ID.
   */
  public async getCourse(courseId: string): Promise<Course> {
    if (!courseId || !courseId.trim()) {
      throw new ClassroomApiError('Course ID is required.', 'INVALID_ARGUMENT');
    }

    // Try finding in cache first
    if (this.cachedCourses && Date.now() < this.cacheCoursesExpiresAt) {
      const found = this.cachedCourses.find((c) => c.id === courseId);
      if (found) {
        return found;
      }
    }

    this.logger.info(`ClassroomService: Fetching course details for ID ${courseId}…`);
    const url = `${CLASSROOM_API_BASE}/courses/${encodeURIComponent(courseId)}`;
    const course = await this.executeRequest<Course>(url);

    // Update in cache if cache is warm
    if (this.cachedCourses) {
      const idx = this.cachedCourses.findIndex((c) => c.id === courseId);
      if (idx >= 0) {
        this.cachedCourses[idx] = course;
      } else {
        this.cachedCourses.push(course);
      }
    }

    return course;
  }

  /**
   * Retrieves coursework (assignments) for a specific course.
   * Handles pagination automatically to fetch all coursework.
   * Results are cached for 5 minutes per course.
   */
  public async listCourseWork(
    courseId: string,
    options?: ListCourseWorkOptions,
  ): Promise<CourseWork[]> {
    if (!courseId || !courseId.trim()) {
      throw new ClassroomApiError('Course ID is required.', 'INVALID_ARGUMENT');
    }

    const forceRefresh = options?.forceRefresh ?? false;
    const cached = this.cachedCourseWork.get(courseId);

    if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
      this.logger.info(
        `ClassroomService: Returning ${cached.items.length} coursework items for course ${courseId} from cache.`,
      );
      return cached.items;
    }

    const allWork: CourseWork[] = [];
    let nextPageToken: string | undefined = undefined;
    const statesToRequest = options?.courseWorkStates ?? ['PUBLISHED'];

    this.logger.info(`ClassroomService: Fetching coursework for course ${courseId}…`);

    do {
      const url = new URL(`${CLASSROOM_API_BASE}/courses/${encodeURIComponent(courseId)}/courseWork`);
      url.searchParams.set('pageSize', String(options?.pageSize ?? 50));

      for (const state of statesToRequest) {
        url.searchParams.append('courseWorkStates', state);
      }

      if (nextPageToken) {
        url.searchParams.set('pageToken', nextPageToken);
      }

      const response = await this.executeRequest<ListCourseWorkResponse>(url.toString());

      if (response.courseWork && response.courseWork.length > 0) {
        allWork.push(...response.courseWork);
      }

      nextPageToken = response.nextPageToken;
    } while (nextPageToken);

    // Store in per-course cache
    this.cachedCourseWork.set(courseId, {
      items: allWork,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    this.logger.info(
      `ClassroomService: Successfully retrieved ${allWork.length} coursework items for course ${courseId}.`,
    );
    return allWork;
  }

  /**
   * Retrieves a single coursework item by its courseId and courseWorkId.
   */
  public async getCourseWork(courseId: string, courseWorkId: string): Promise<CourseWork> {
    if (!courseId || !courseId.trim() || !courseWorkId || !courseWorkId.trim()) {
      throw new ClassroomApiError('Course ID and CourseWork ID are required.', 'INVALID_ARGUMENT');
    }

    const cached = this.cachedCourseWork.get(courseId);
    if (cached && Date.now() < cached.expiresAt) {
      const found = cached.items.find((w) => w.id === courseWorkId);
      if (found) {
        return found;
      }
    }

    const url = `${CLASSROOM_API_BASE}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}`;
    return this.executeRequest<CourseWork>(url);
  }

  /**
   * Retrieves student submissions for a course or specific coursework item.
   * Uses userId='me' to retrieve the current student's submissions.
   */
  public async listStudentSubmissions(
    courseId: string,
    courseWorkId?: string,
  ): Promise<StudentSubmission[]> {
    if (!courseId || !courseId.trim()) {
      throw new ClassroomApiError('Course ID is required.', 'INVALID_ARGUMENT');
    }

    const workIdPath = courseWorkId && courseWorkId.trim() ? encodeURIComponent(courseWorkId) : '-';
    const allSubmissions: StudentSubmission[] = [];
    let nextPageToken: string | undefined = undefined;

    do {
      const url = new URL(
        `${CLASSROOM_API_BASE}/courses/${encodeURIComponent(courseId)}/courseWork/${workIdPath}/studentSubmissions`,
      );
      url.searchParams.set('userId', 'me');
      url.searchParams.set('pageSize', '50');

      if (nextPageToken) {
        url.searchParams.set('pageToken', nextPageToken);
      }

      const response = await this.executeRequest<ListStudentSubmissionsResponse>(url.toString());

      if (response.studentSubmissions && response.studentSubmissions.length > 0) {
        allSubmissions.push(...response.studentSubmissions);
      }

      nextPageToken = response.nextPageToken;
    } while (nextPageToken);

    return allSubmissions;
  }

  /**
   * High-level method: Retrieves coursework combined with student submission state,
   * calculating due status, human-readable date, and actual submission status.
   */
  public async listAssignmentsWithSubmissions(
    courseId: string,
    options?: ListCourseWorkOptions,
  ): Promise<AssignmentWithSubmission[]> {
    // 1. Fetch coursework
    const workItems = await this.listCourseWork(courseId, options);

    if (workItems.length === 0) {
      return [];
    }

    // 2. Fetch student submissions for the course (best effort)
    const submissionMap = new Map<string, StudentSubmission>();
    try {
      const submissions = await this.listStudentSubmissions(courseId);
      for (const sub of submissions) {
        submissionMap.set(sub.courseWorkId, sub);
      }
    } catch (err) {
      this.logger.warn(
        `ClassroomService: Could not fetch student submissions in bulk for course ${courseId}: ${String(err)}`,
      );
    }

    // 3. Combine coursework with submissions
    return workItems.map((work) => {
      const submission = submissionMap.get(work.id);
      const dueInfo = ClassroomService.formatDueDate(work.dueDate, work.dueTime);
      const statusInfo = ClassroomService.computeSubmissionStatus(submission, dueInfo.isOverdue);

      return {
        courseWork: work,
        submission,
        dueStatus: dueInfo.dueStatus,
        formattedDue: dueInfo.formatted,
        submissionStatus: statusInfo.status,
        statusLabel: statusInfo.label,
      };
    });
  }

  /**
   * Formats a Classroom due date and time into a human-readable string and DueStatus.
   */
  public static formatDueDate(
    dueDate?: CourseWork['dueDate'],
    dueTime?: CourseWork['dueTime'],
  ): { formatted: string; dueStatus: DueStatus; isOverdue: boolean } {
    if (!dueDate || !dueDate.year || !dueDate.month || !dueDate.day) {
      return {
        formatted: 'No due date',
        dueStatus: 'NO_DUE_DATE',
        isOverdue: false,
      };
    }

    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const monthName = months[dueDate.month - 1] ?? `Month ${dueDate.month}`;

    const hours = dueTime?.hours ?? 23;
    const minutes = dueTime?.minutes ?? 59;
    const seconds = dueTime?.seconds ?? 59;

    const dueUtc = new Date(Date.UTC(dueDate.year, dueDate.month - 1, dueDate.day, hours, minutes, seconds));
    const now = new Date();

    const isOverdue = dueUtc.getTime() < now.getTime();

    const sameDay =
      dueUtc.getUTCFullYear() === now.getUTCFullYear() &&
      dueUtc.getUTCMonth() === now.getUTCMonth() &&
      dueUtc.getUTCDate() === now.getUTCDate();

    let dueStatus: DueStatus = 'UPCOMING';
    if (isOverdue) {
      dueStatus = 'OVERDUE';
    } else if (sameDay) {
      dueStatus = 'DUE_TODAY';
    }

    const timeStr = dueTime
      ? `, ${String(hours % 12 || 12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`
      : '';

    return {
      formatted: `${monthName} ${dueDate.day}, ${dueDate.year}${timeStr}`,
      dueStatus,
      isOverdue,
    };
  }

  /**
   * Computes the actual submission state and user-friendly label from API data.
   * Never invents non-existent states.
   */
  public static computeSubmissionStatus(
    submission?: StudentSubmission,
    isOverdue: boolean = false,
  ): { status: SubmissionStatus; label: string } {
    if (!submission) {
      return {
        status: 'NOT_SUBMITTED',
        label: isOverdue ? 'Missing (Overdue)' : 'Not submitted',
      };
    }

    switch (submission.state) {
      case 'TURNED_IN':
        return {
          status: 'TURNED_IN',
          label: submission.late ? 'Turned in (Late)' : 'Turned in',
        };
      case 'RETURNED':
        return {
          status: 'RETURNED',
          label: 'Returned',
        };
      case 'RECLAIMED_BY_STUDENT':
        return {
          status: 'RECLAIMED',
          label: 'Not submitted (Reclaimed)',
        };
      case 'NEW':
      case 'CREATED':
      default:
        return {
          status: 'NOT_SUBMITTED',
          label: isOverdue ? 'Missing (Overdue)' : 'Not submitted',
        };
    }
  }

  /**
   * Clears in-memory caches.
   */
  public clearCache(): void {
    this.cachedCourses = null;
    this.cacheCoursesExpiresAt = 0;
    this.cachedCourseWork.clear();
    this.logger.info('ClassroomService: All caches cleared.');
  }

  /**
   * Filter courses array by requested states.
   */
  private filterCoursesByState(
    courses: Course[],
    states?: Array<'ACTIVE' | 'ARCHIVED' | 'PROVISIONED' | 'DECLINED' | 'SUSPENDED'>,
  ): Course[] {
    if (!states || states.length === 0) {
      return courses.filter((c) => c.courseState === 'ACTIVE');
    }
    const stateSet = new Set(states);
    return courses.filter((c) => c.courseState && stateSet.has(c.courseState));
  }

  /**
   * Executes an authenticated HTTP request to the Google Classroom API.
   * Maps HTTP errors to friendly ClassroomApiError messages.
   */
  private async executeRequest<T>(url: string): Promise<T> {
    const token = await this.getAccessToken();

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      this.logger.error(`ClassroomService: Network failure reaching ${url}`, err);
      throw new ClassroomApiError(
        `Failed to connect to Google Classroom: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR',
      );
    }

    if (!res.ok) {
      const friendlyMsg = friendlyHttpError(res.status, 'Classroom');
      let errorDetails = '';

      try {
        const errorJson = (await res.json()) as { error?: { message?: string } };
        if (errorJson?.error?.message) {
          errorDetails = errorJson.error.message;
        }
      } catch {
        // If body is not json, ignore
      }

      this.logger.error(
        `Classroom API request failed [HTTP ${res.status}]: ${errorDetails || res.statusText}`,
      );

      throw new ClassroomApiError(
        errorDetails ? `${friendlyMsg} (${errorDetails})` : friendlyMsg,
        res.status === 404 ? 'COURSE_NOT_FOUND' : 'CLASSROOM_API_ERROR',
        res.status,
      );
    }

    return (await res.json()) as T;
  }
}
