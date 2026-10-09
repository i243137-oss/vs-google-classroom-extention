import { Course } from '../types/index.js';

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
