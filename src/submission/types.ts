import { DriveFileAttachment } from '../types/index.js';

/**
 * Internal submission abstraction matching Google Classroom's submission model.
 */
export interface AssignmentSubmission {
  courseId: string;
  courseworkId: string;
  submissionId: string;
  state: 'NEW' | 'CREATED' | 'TURNED_IN' | 'RETURNED' | 'RECLAIMED_BY_STUDENT';
  isSubmitted: boolean;
  canSubmit: boolean;
  canReclaim: boolean;
  isResubmission: boolean;
  late?: boolean | undefined;
  alternateLink?: string | undefined;
  assignedGrade?: number | undefined;
  draftGrade?: number | undefined;
  attachments?: DriveFileAttachment[] | undefined;
}

export interface SubmissionStateInfo {
  state: string;
  label: string;
  description: string;
  canSubmit: boolean;
  canReclaim: boolean;
  isSubmitted: boolean;
  isResubmission: boolean;
}

export interface ModifyAttachmentsOptions {
  addDriveFileIds?: string[] | undefined;
  removeAttachmentIds?: string[] | undefined;
}
