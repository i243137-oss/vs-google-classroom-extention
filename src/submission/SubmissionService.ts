import { AssignmentSubmission, SubmissionStateInfo, ModifyAttachmentsOptions } from './types.js';
import { StudentSubmission, DriveFileAttachment } from '../types/index.js';
import { SubmissionError, friendlyHttpError } from '../errors/errors.js';
import { Logger } from '../utils/logger.js';

const CLASSROOM_API_BASE = 'https://classroom.googleapis.com/v1';

export interface ISubmissionService {
  getStudentSubmission(courseId: string, courseworkId: string): Promise<AssignmentSubmission>;
  reclaimSubmission(courseId: string, courseworkId: string, submissionId: string): Promise<AssignmentSubmission>;
  turnInSubmission(courseId: string, courseworkId: string, submissionId: string): Promise<AssignmentSubmission>;
  determineSubmissionState(state: string, late?: boolean): SubmissionStateInfo;
  attachDriveFiles(
    courseId: string,
    courseworkId: string,
    submissionId: string,
    driveFileIds: string[],
  ): Promise<AssignmentSubmission>;
  modifyAttachments(
    courseId: string,
    courseworkId: string,
    submissionId: string,
    options: ModifyAttachmentsOptions,
  ): Promise<AssignmentSubmission>;
}

/**
 * SubmissionService
 *
 * Implements the Google Classroom student submission model abstraction and attachment modifications.
 *
 * GOOGLE CLASSROOM API ARCHITECTURAL SPECIFICATION:
 * 1. Automatic Creation: Google Classroom auto-provisions a StudentSubmission
 *    for each enrolled student upon coursework publishing. Clients cannot
 *    create submissions manually; they locate the auto-created submission.
 * 2. Immutable TURNED_IN: Google Classroom forbids adding files or modifying
 *    attachments on submissions in the TURNED_IN state. To submit new or revised
 *    files, the student must reclaim the submission first.
 * 3. Resubmission on RETURNED: Submissions returned by instructors can be
 *    directly resubmitted by adding files and calling turnIn.
 * 4. modifyAttachments: Links Google Drive files to the submission record.
 *    Google Classroom automatically grants the teacher access to attached Drive files.
 */
export class SubmissionService implements ISubmissionService {
  private readonly getAccessToken: () => Promise<string>;
  private readonly logger = Logger.getInstance();

  constructor(tokenProvider: () => Promise<string>) {
    this.getAccessToken = tokenProvider;
  }

  /**
   * Locates and retrieves the student's submission record for an assignment.
   */
  public async getStudentSubmission(
    courseId: string,
    courseworkId: string,
  ): Promise<AssignmentSubmission> {
    if (!courseId || !courseId.trim()) {
      throw new SubmissionError('Course ID is required.', 'INVALID_ARGUMENT');
    }
    if (!courseworkId || !courseworkId.trim()) {
      throw new SubmissionError('CourseWork ID is required.', 'INVALID_ARGUMENT');
    }

    this.logger.info(
      `SubmissionService: Locating student submission for course ${courseId}, assignment ${courseworkId}…`,
    );

    const url = new URL(
      `${CLASSROOM_API_BASE}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseworkId)}/studentSubmissions`,
    );
    url.searchParams.set('userId', 'me');

    const response = await this.executeRequest<{
      studentSubmissions?: StudentSubmission[] | undefined;
    }>(url.toString());

    const submissions = response.studentSubmissions;
    if (!submissions || submissions.length === 0 || !submissions[0]) {
      throw new SubmissionError(
        'No submission record found for your account in this assignment. Make sure you are enrolled as a student.',
        'SUBMISSION_NOT_FOUND',
      );
    }

    return this.mapToAssignmentSubmission(courseId, courseworkId, submissions[0]);
  }

  /**
   * Reclaims an already turned-in submission, transitioning state to RECLAIMED_BY_STUDENT
   * so attachments can be modified and new code uploaded.
   */
  public async reclaimSubmission(
    courseId: string,
    courseworkId: string,
    submissionId: string,
  ): Promise<AssignmentSubmission> {
    if (!courseId || !courseworkId || !submissionId) {
      throw new SubmissionError('Course, coursework, and submission IDs are required.', 'INVALID_ARGUMENT');
    }

    this.logger.info(`SubmissionService: Reclaiming submission ${submissionId}…`);

    const url = `${CLASSROOM_API_BASE}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseworkId)}/studentSubmissions/${encodeURIComponent(submissionId)}:reclaim`;

    const updatedRaw = await this.executeRequest<StudentSubmission>(url, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    this.logger.info(`SubmissionService: Submission ${submissionId} reclaimed successfully.`);
    return this.mapToAssignmentSubmission(courseId, courseworkId, updatedRaw);
  }

  /**
   * Turns in the student submission, locking attached files from student modification.
   * Google Classroom transitions the state to TURNED_IN and flags late submissions if past due.
   */
  public async turnInSubmission(
    courseId: string,
    courseworkId: string,
    submissionId: string,
  ): Promise<AssignmentSubmission> {
    if (!courseId || !courseId.trim()) {
      throw new SubmissionError('Course ID is required.', 'INVALID_ARGUMENT');
    }
    if (!courseworkId || !courseworkId.trim()) {
      throw new SubmissionError('CourseWork ID is required.', 'INVALID_ARGUMENT');
    }
    if (!submissionId || !submissionId.trim()) {
      throw new SubmissionError('Submission ID is required.', 'INVALID_ARGUMENT');
    }

    this.logger.info(`SubmissionService: Turning in submission ${submissionId}…`);

    const url = `${CLASSROOM_API_BASE}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseworkId)}/studentSubmissions/${encodeURIComponent(submissionId)}:turnIn`;

    const updatedRaw = await this.executeRequest<StudentSubmission>(url, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    this.logger.info(
      `SubmissionService: Submission ${submissionId} turned in successfully (state: ${updatedRaw.state}, late: ${Boolean(updatedRaw.late)}).`,
    );
    return this.mapToAssignmentSubmission(courseId, courseworkId, updatedRaw);
  }

  /**
   * Attaches one or more uploaded Google Drive files to the student submission.
   */
  public async attachDriveFiles(
    courseId: string,
    courseworkId: string,
    submissionId: string,
    driveFileIds: string[],
  ): Promise<AssignmentSubmission> {
    if (!driveFileIds || driveFileIds.length === 0) {
      throw new SubmissionError('At least one Drive file ID is required to attach.', 'INVALID_ARGUMENT');
    }

    return this.modifyAttachments(courseId, courseworkId, submissionId, {
      addDriveFileIds: driveFileIds,
    });
  }

  /**
   * Modifies attachments on a student submission (add Drive files and/or remove existing attachments).
   * Calls the Google Classroom API studentSubmissions.modifyAttachments endpoint.
   */
  public async modifyAttachments(
    courseId: string,
    courseworkId: string,
    submissionId: string,
    options: ModifyAttachmentsOptions,
  ): Promise<AssignmentSubmission> {
    if (!courseId || !courseId.trim()) {
      throw new SubmissionError('Course ID is required.', 'INVALID_ARGUMENT');
    }
    if (!courseworkId || !courseworkId.trim()) {
      throw new SubmissionError('CourseWork ID is required.', 'INVALID_ARGUMENT');
    }
    if (!submissionId || !submissionId.trim()) {
      throw new SubmissionError('Submission ID is required.', 'INVALID_ARGUMENT');
    }

    const hasAdd = Boolean(options.addDriveFileIds && options.addDriveFileIds.length > 0);
    const hasRemove = Boolean(options.removeAttachmentIds && options.removeAttachmentIds.length > 0);

    if (!hasAdd && !hasRemove) {
      throw new SubmissionError(
        'At least one attachment to add or remove must be provided.',
        'INVALID_ARGUMENT',
      );
    }

    this.logger.info(
      `SubmissionService: Modifying attachments on submission ${submissionId} (add: ${options.addDriveFileIds?.length ?? 0}, remove: ${options.removeAttachmentIds?.length ?? 0})…`,
    );

    const payload: {
      addAttachments?: Array<{ driveFile: { id: string } }> | undefined;
      removeAttachmentIds?: string[] | undefined;
    } = {};

    if (hasAdd && options.addDriveFileIds) {
      payload.addAttachments = options.addDriveFileIds.map((id) => ({
        driveFile: { id },
      }));
    }

    if (hasRemove && options.removeAttachmentIds) {
      payload.removeAttachmentIds = options.removeAttachmentIds;
    }

    const url = `${CLASSROOM_API_BASE}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseworkId)}/studentSubmissions/${encodeURIComponent(submissionId)}:modifyAttachments`;

    const updatedRaw = await this.executeRequest<StudentSubmission>(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    this.logger.info(
      `SubmissionService: Attachments modified successfully on submission ${submissionId}.`,
    );
    return this.mapToAssignmentSubmission(courseId, courseworkId, updatedRaw);
  }

  /**
   * Computes state metadata from Google Classroom submission state strings.
   * Never invents non-existent states.
   */
  public determineSubmissionState(state: string, late?: boolean): SubmissionStateInfo {
    switch (state) {
      case 'TURNED_IN':
        return {
          state,
          label: late ? 'Turned in (Late)' : 'Turned in',
          description: 'The assignment is currently turned in. Reclaim before uploading new files.',
          isSubmitted: true,
          canSubmit: false,
          canReclaim: true,
          isResubmission: false,
        };

      case 'RETURNED':
        return {
          state,
          label: 'Returned',
          description: 'Your submission was evaluated and returned. You can submit revised work.',
          isSubmitted: false,
          canSubmit: true,
          canReclaim: false,
          isResubmission: true,
        };

      case 'RECLAIMED_BY_STUDENT':
        return {
          state,
          label: 'Not submitted (Reclaimed)',
          description: 'The submission was previously turned in and unsubmitted. Ready for resubmission.',
          isSubmitted: false,
          canSubmit: true,
          canReclaim: false,
          isResubmission: true,
        };

      case 'NEW':
      case 'CREATED':
      default:
        return {
          state,
          label: 'Not submitted',
          description: 'Assignment has not been submitted yet.',
          isSubmitted: false,
          canSubmit: true,
          canReclaim: false,
          isResubmission: false,
        };
    }
  }

  /**
   * Maps a Google Classroom API StudentSubmission into internal AssignmentSubmission abstraction.
   */
  public mapToAssignmentSubmission(
    courseId: string,
    courseworkId: string,
    raw: StudentSubmission,
  ): AssignmentSubmission {
    const info = this.determineSubmissionState(raw.state, raw.late);

    const attachments: DriveFileAttachment[] = [];
    if (raw.assignmentSubmission?.attachments) {
      for (const att of raw.assignmentSubmission.attachments) {
        if (att.driveFile) {
          attachments.push({
            id: att.driveFile.id,
            title: att.driveFile.title,
            alternateLink: att.driveFile.alternateLink,
            thumbnailUrl: att.driveFile.thumbnailUrl,
          });
        }
      }
    } else if (raw.driveFiles) {
      attachments.push(...raw.driveFiles);
    }

    return {
      courseId,
      courseworkId,
      submissionId: raw.id,
      state: raw.state,
      isSubmitted: info.isSubmitted,
      canSubmit: info.canSubmit,
      canReclaim: info.canReclaim,
      isResubmission: info.isResubmission,
      late: raw.late,
      alternateLink: raw.alternateLink,
      associatedWithDeveloper: raw.associatedWithDeveloper,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  /**
   * Executes an authenticated request with Google Classroom API.
   */
  private async executeRequest<T>(url: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken();

    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...init?.headers,
        },
      });
    } catch (err) {
      this.logger.error(`SubmissionService: Network failure reaching ${url}`, err);
      throw new SubmissionError(
        `Network error communicating with Google Classroom: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR',
      );
    }

    if (!res.ok) {
      const friendlyMsg = friendlyHttpError(res.status, 'Classroom');
      let details = '';

      try {
        const errorJson = (await res.json()) as { error?: { message?: string } };
        if (errorJson?.error?.message) {
          details = errorJson.error.message;
        }
      } catch {
        // ignore
      }

      this.logger.error(`SubmissionService: HTTP ${res.status} error: ${details || res.statusText}`);

      if (
        details.includes('ProjectPermissionDenied') ||
        details.includes('not permitted to make this request')
      ) {
        throw new SubmissionError(
          'Google Classroom Developer Project Policy: This assignment was created via the Google Classroom web portal. Google API allows programmatic modification and turn-in only for coursework created by the same Developer Console project.',
          'PROJECT_PERMISSION_DENIED',
        );
      }

      if (details.toLowerCase().includes('turned in') || details.toLowerCase().includes('turned_in')) {
        if (details.toLowerCase().includes('already turned in') || details.toLowerCase().includes('already')) {
          throw new SubmissionError(
            'This assignment is already turned in.',
            'ALREADY_TURNED_IN',
          );
        }
        throw new SubmissionError(
          'Cannot modify attachments on a turned-in assignment. Please reclaim the assignment before submitting new files.',
          'CANNOT_MODIFY_TURNED_IN',
        );
      }

      throw new SubmissionError(
        details ? `${friendlyMsg} (${details})` : friendlyMsg,
        res.status === 404 ? 'SUBMISSION_NOT_FOUND' : 'SUBMISSION_API_ERROR',
      );
    }

    return (await res.json()) as T;
  }
}
