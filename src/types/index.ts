// ─── Shared Types ─────────────────────────────────────────────────────────────
// Central barrel for all shared type definitions used across the extension.

export interface GoogleAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (ms)
  scopes: string[];
}

export interface UserInfo {
  email: string;
  name: string;
  picture?: string;
}

export interface Course {
  id: string;
  name: string;
  section?: string;
  descriptionHeading?: string;
  enrollmentCode?: string;
  courseState: 'ACTIVE' | 'ARCHIVED' | 'PROVISIONED' | 'DECLINED' | 'SUSPENDED';
  alternateLink: string;
}

export interface CourseWork {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  dueDate?: {
    year: number;
    month: number;
    day: number;
  };
  dueTime?: {
    hours: number;
    minutes: number;
  };
  state: 'PUBLISHED' | 'DRAFT' | 'DELETED';
  workType: 'ASSIGNMENT' | 'SHORT_ANSWER_QUESTION' | 'MULTIPLE_CHOICE_QUESTION';
  alternateLink: string;
}

export interface StudentSubmission {
  id: string;
  courseId: string;
  courseWorkId: string;
  state:
    | 'NEW'
    | 'CREATED'
    | 'TURNED_IN'
    | 'RETURNED'
    | 'RECLAIMED_BY_STUDENT';
  late: boolean;
  alternateLink: string;
  driveFiles?: DriveFileAttachment[];
}

export interface DriveFileAttachment {
  id: string;
  title: string;
  alternateLink: string;
  thumbnailUrl?: string;
}

export interface WorkspaceFile {
  relativePath: string;
  absolutePath: string;
  size: number;
  isDirectory: boolean;
}

export interface SubmissionSummary {
  course: Course;
  courseWork: CourseWork;
  submission: StudentSubmission;
  selectedFiles: WorkspaceFile[];
  totalBytes: number;
}

export interface ExtensionConfiguration {
  excludedDirectories: string[];
  excludedFiles: string[];
  maxFileSizeMb: number;
  confirmBeforeSubmit: boolean;
  detectSecrets: boolean;
  showNotifications: boolean;
  clientId: string;
  clientSecret: string;
}
