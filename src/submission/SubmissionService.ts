import { AssignmentSubmission, SubmissionStateInfo } from './types.js';
import { StudentSubmission } from '../types/index.js';
import { SubmissionError, friendlyHttpError } from '../errors/errors.js';
import { Logger } from '../utils/logger.js';

const CLASSROOM_API_BASE = 'https://classroom.googleapis.com/v1';

export interface ISubmissionService {
  getStudentSubmission(courseId: string, courseworkId: string): Promise<AssignmentSubmission>;
  reclaimSubmission(courseId: string, courseworkId: string, submissionId: string): Promise<AssignmentSubmission>;
  determineSubmissionState(state: string, late?: boolean): SubmissionStateInfo;
}

/**
 * SubmissionService
 *
 * Implements the Google Classroom student submission model abstraction.
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

      throw new SubmissionError(
        details ? `${friendlyMsg} (${details})` : friendlyMsg,
        res.status === 404 ? 'SUBMISSION_NOT_FOUND' : 'SUBMISSION_API_ERROR',
      );
    }

    return (await res.json()) as T;
  }
}
