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
  section?: string | undefined;
  descriptionHeading?: string | undefined;
  room?: string | undefined;
  enrollmentCode?: string | undefined;
  courseState?: 'ACTIVE' | 'ARCHIVED' | 'PROVISIONED' | 'DECLINED' | 'SUSPENDED' | undefined;
  alternateLink?: string | undefined;
}

export interface CourseWork {
  id: string;
  courseId: string;
  title: string;
  description?: string | undefined;
  dueDate?: {
    year: number;
    month: number;
    day: number;
  } | undefined;
  dueTime?: {
    hours?: number | undefined;
    minutes?: number | undefined;
    seconds?: number | undefined;
    nanos?: number | undefined;
  } | undefined;
  state?: 'PUBLISHED' | 'DRAFT' | 'DELETED' | undefined;
  workType?: 'ASSIGNMENT' | 'SHORT_ANSWER_QUESTION' | 'MULTIPLE_CHOICE_QUESTION' | undefined;
  maxPoints?: number | undefined;
  alternateLink?: string | undefined;
  associatedWithDeveloper?: boolean | undefined;
  creationTime?: string | undefined;
  updateTime?: string | undefined;
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
  late?: boolean | undefined;
  alternateLink?: string | undefined;
  associatedWithDeveloper?: boolean | undefined;
  driveFiles?: DriveFileAttachment[] | undefined;
  assignmentSubmission?: {
    attachments?: Attachment[] | undefined;
  } | undefined;
}

export interface Attachment {
  driveFile?: DriveFileAttachment | undefined;
  link?: { url: string; title?: string | undefined } | undefined;
  form?: { formUrl: string; title?: string | undefined } | undefined;
  id?: string | undefined;
}

export interface DriveFileAttachment {
  id: string;
  title: string;
  alternateLink?: string | undefined;
  thumbnailUrl?: string | undefined;
}

export interface WorkspaceFile {
  relativePath: string;
  absolutePath: string;
  size: number;
  isDirectory: boolean;
}

export interface FileSelectionResult {
  selectedFiles: WorkspaceFile[];
  totalBytes: number;
  totalFiles: number;
  excludedCount: number;
  formattedSize: string;
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
  redirectUri: string;
}
