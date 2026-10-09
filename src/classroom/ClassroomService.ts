import { Course } from '../types/index.js';
import { ClassroomApiError, friendlyHttpError } from '../errors/errors.js';
import { ListCoursesOptions, ListCoursesResponse } from './types.js';
import { Logger } from '../utils/logger.js';

const CLASSROOM_API_BASE = 'https://classroom.googleapis.com/v1';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache lifetime

export interface IClassroomService {
  listCourses(options?: ListCoursesOptions): Promise<Course[]>;
  getCourse(courseId: string): Promise<Course>;
  clearCache(): void;
}

export class ClassroomService implements IClassroomService {
  private readonly getAccessToken: () => Promise<string>;
  private readonly logger = Logger.getInstance();

  private cachedCourses: Course[] | null = null;
  private cacheExpiresAt: number = 0;

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
    if (!forceRefresh && this.cachedCourses && Date.now() < this.cacheExpiresAt) {
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
    this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;

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
    if (this.cachedCourses && Date.now() < this.cacheExpiresAt) {
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
   * Clears the in-memory course cache.
   */
  public clearCache(): void {
    this.cachedCourses = null;
    this.cacheExpiresAt = 0;
    this.logger.info('ClassroomService: Cache cleared.');
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
