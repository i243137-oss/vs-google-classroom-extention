import { Course, CourseWork, StudentSubmission } from '../types/index.js';

export interface ListCoursesResponse {
  courses?: Course[] | undefined;
  nextPageToken?: string | undefined;
}

export interface ListCoursesOptions {
  /** Course states to include. Defaults to ['ACTIVE']. */
  courseStates?: Array<'ACTIVE' | 'ARCHIVED' | 'PROVISIONED' | 'DECLINED' | 'SUSPENDED'> | undefined;
  /** Page size per request (max 100). Defaults to 50. */
  pageSize?: number | undefined;
  /** Restricts courses to student enrollment ('me'). Optional. */
  studentId?: string | undefined;
  /** Whether to bypass the cache and fetch freshly from Google Classroom. */
  forceRefresh?: boolean | undefined;
}

export interface CoursePickerItem {
  label: string;
  description?: string | undefined;
  detail?: string | undefined;
  course: Course;
}

export interface ListCourseWorkResponse {
  courseWork?: CourseWork[] | undefined;
  nextPageToken?: string | undefined;
}

export interface ListStudentSubmissionsResponse {
  studentSubmissions?: StudentSubmission[] | undefined;
  nextPageToken?: string | undefined;
}

export interface ListCourseWorkOptions {
  /** Coursework states to include. Defaults to ['PUBLISHED']. */
  courseWorkStates?: Array<'PUBLISHED' | 'DRAFT' | 'DELETED'> | undefined;
  /** Page size per request (max 100). Defaults to 50. */
  pageSize?: number | undefined;
  /** Whether to bypass cache and fetch freshly. */
  forceRefresh?: boolean | undefined;
}

export type DueStatus = 'NO_DUE_DATE' | 'UPCOMING' | 'DUE_TODAY' | 'OVERDUE';
export type SubmissionStatus = 'NOT_SUBMITTED' | 'TURNED_IN' | 'RETURNED' | 'RECLAIMED';

export interface AssignmentWithSubmission {
  courseWork: CourseWork;
  submission?: StudentSubmission | undefined;
  dueStatus: DueStatus;
  formattedDue: string;
  submissionStatus: SubmissionStatus;
  statusLabel: string;
}

export interface AssignmentPickerItem {
  label: string;
  description?: string | undefined;
  detail?: string | undefined;
  assignment: AssignmentWithSubmission;
}
