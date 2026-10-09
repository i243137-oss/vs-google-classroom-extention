import * as assert from 'assert';
import { SubmissionService } from '../../src/submission/SubmissionService.js';
import { StudentSubmission } from '../../src/types/index.js';
import { SubmissionError } from '../../src/errors/errors.js';

suite('Phase 7 — Submission Model & Reclaim Flow', () => {
  let submissionService: SubmissionService;
  let originalFetch: typeof globalThis.fetch;
  const mockToken = 'mock-access-token-sub-123';

  setup(() => {
    originalFetch = globalThis.fetch;
    submissionService = new SubmissionService(async () => mockToken);
  });

  teardown(() => {
    globalThis.fetch = originalFetch;
  });

  suite('SubmissionService.determineSubmissionState', () => {
    test('correctly describes TURNED_IN on-time submission', () => {
      const stateInfo = submissionService.determineSubmissionState('TURNED_IN', false);
      assert.strictEqual(stateInfo.state, 'TURNED_IN');
      assert.strictEqual(stateInfo.label, 'Turned in');
      assert.strictEqual(stateInfo.isSubmitted, true);
      assert.strictEqual(stateInfo.canSubmit, false);
      assert.strictEqual(stateInfo.canReclaim, true);
      assert.strictEqual(stateInfo.isResubmission, false);
    });

    test('correctly describes TURNED_IN late submission', () => {
      const stateInfo = submissionService.determineSubmissionState('TURNED_IN', true);
      assert.strictEqual(stateInfo.state, 'TURNED_IN');
      assert.strictEqual(stateInfo.label, 'Turned in (Late)');
      assert.strictEqual(stateInfo.isSubmitted, true);
      assert.strictEqual(stateInfo.canSubmit, false);
      assert.strictEqual(stateInfo.canReclaim, true);
      assert.strictEqual(stateInfo.isResubmission, false);
    });

    test('correctly describes RETURNED submission', () => {
      const stateInfo = submissionService.determineSubmissionState('RETURNED', false);
      assert.strictEqual(stateInfo.state, 'RETURNED');
      assert.strictEqual(stateInfo.label, 'Returned');
      assert.strictEqual(stateInfo.isSubmitted, false);
      assert.strictEqual(stateInfo.canSubmit, true);
      assert.strictEqual(stateInfo.canReclaim, false);
      assert.strictEqual(stateInfo.isResubmission, true);
    });

    test('correctly describes RECLAIMED_BY_STUDENT submission', () => {
      const stateInfo = submissionService.determineSubmissionState('RECLAIMED_BY_STUDENT', false);
      assert.strictEqual(stateInfo.state, 'RECLAIMED_BY_STUDENT');
      assert.strictEqual(stateInfo.label, 'Not submitted (Reclaimed)');
      assert.strictEqual(stateInfo.isSubmitted, false);
      assert.strictEqual(stateInfo.canSubmit, true);
      assert.strictEqual(stateInfo.canReclaim, false);
      assert.strictEqual(stateInfo.isResubmission, true);
    });

    test('correctly describes NEW / CREATED submission', () => {
      const stateInfo = submissionService.determineSubmissionState('CREATED', false);
      assert.strictEqual(stateInfo.state, 'CREATED');
      assert.strictEqual(stateInfo.label, 'Not submitted');
      assert.strictEqual(stateInfo.isSubmitted, false);
      assert.strictEqual(stateInfo.canSubmit, true);
      assert.strictEqual(stateInfo.canReclaim, false);
      assert.strictEqual(stateInfo.isResubmission, false);
    });
  });

  suite('SubmissionService.getStudentSubmission', () => {
    test('retrieves and maps student submission successfully', async () => {
      let capturedUrl = '';
      let capturedAuth = '';

      const sampleRaw: StudentSubmission = {
        id: 'sub-xyz',
        courseId: 'crs-1',
        courseWorkId: 'cw-1',
        state: 'CREATED',
        late: false,
        alternateLink: 'https://classroom.google.com/submission/xyz',
      };

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedAuth = (init?.headers as Record<string, string>)?.Authorization || '';

        return {
          ok: true,
          status: 200,
          json: async () => ({
            studentSubmissions: [sampleRaw],
          }),
        } as unknown as Response;
      };

      const result = await submissionService.getStudentSubmission('crs-1', 'cw-1');

      assert.ok(capturedUrl.includes('/courses/crs-1/courseWork/cw-1/studentSubmissions'));
      assert.ok(capturedUrl.includes('userId=me'));
      assert.strictEqual(capturedAuth, `Bearer ${mockToken}`);
      assert.strictEqual(result.submissionId, 'sub-xyz');
      assert.strictEqual(result.courseId, 'crs-1');
      assert.strictEqual(result.courseworkId, 'cw-1');
      assert.strictEqual(result.state, 'CREATED');
      assert.strictEqual(result.isSubmitted, false);
      assert.strictEqual(result.canSubmit, true);
      assert.strictEqual(result.canReclaim, false);
      assert.strictEqual(result.late, false);
    });

    test('throws INVALID_ARGUMENT when parameters are empty', async () => {
      await assert.rejects(
        async () => submissionService.getStudentSubmission('', 'cw-1'),
        (err: unknown) => err instanceof SubmissionError && err.code === 'INVALID_ARGUMENT',
      );

      await assert.rejects(
        async () => submissionService.getStudentSubmission('crs-1', ''),
        (err: unknown) => err instanceof SubmissionError && err.code === 'INVALID_ARGUMENT',
      );
    });

    test('throws SUBMISSION_NOT_FOUND when studentSubmissions is empty', async () => {
      globalThis.fetch = async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ studentSubmissions: [] }),
        }) as unknown as Response;

      await assert.rejects(
        async () => submissionService.getStudentSubmission('crs-1', 'cw-1'),
        (err: unknown) => err instanceof SubmissionError && err.code === 'SUBMISSION_NOT_FOUND',
      );
    });

    test('handles 404 HTTP response from Classroom API', async () => {
      globalThis.fetch = async () =>
        ({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ error: { message: 'Assignment not found' } }),
        }) as unknown as Response;

      await assert.rejects(
        async () => submissionService.getStudentSubmission('crs-1', 'cw-notfound'),
        (err: unknown) => err instanceof SubmissionError && err.code === 'SUBMISSION_NOT_FOUND',
      );
    });
  });

  suite('SubmissionService.reclaimSubmission', () => {
    test('sends POST request to :reclaim endpoint and returns updated submission', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      let capturedAuth = '';

      const returnedRaw: StudentSubmission = {
        id: 'sub-xyz',
        courseId: 'crs-1',
        courseWorkId: 'cw-1',
        state: 'RECLAIMED_BY_STUDENT',
        late: false,
      };

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedMethod = init?.method || '';
        capturedAuth = (init?.headers as Record<string, string>)?.Authorization || '';

        return {
          ok: true,
          status: 200,
          json: async () => returnedRaw,
        } as unknown as Response;
      };

      const result = await submissionService.reclaimSubmission('crs-1', 'cw-1', 'sub-xyz');

      assert.ok(capturedUrl.includes('/courses/crs-1/courseWork/cw-1/studentSubmissions/sub-xyz:reclaim'));
      assert.strictEqual(capturedMethod, 'POST');
      assert.strictEqual(capturedAuth, `Bearer ${mockToken}`);
      assert.strictEqual(result.state, 'RECLAIMED_BY_STUDENT');
      assert.strictEqual(result.isSubmitted, false);
      assert.strictEqual(result.canSubmit, true);
      assert.strictEqual(result.canReclaim, false);
      assert.strictEqual(result.isResubmission, true);
    });

    test('throws INVALID_ARGUMENT when reclaim arguments are missing', async () => {
      await assert.rejects(
        async () => submissionService.reclaimSubmission('', 'cw-1', 'sub-1'),
        (err: unknown) => err instanceof SubmissionError && err.code === 'INVALID_ARGUMENT',
      );
      await assert.rejects(
        async () => submissionService.reclaimSubmission('crs-1', '', 'sub-1'),
        (err: unknown) => err instanceof SubmissionError && err.code === 'INVALID_ARGUMENT',
      );
      await assert.rejects(
        async () => submissionService.reclaimSubmission('crs-1', 'cw-1', ''),
        (err: unknown) => err instanceof SubmissionError && err.code === 'INVALID_ARGUMENT',
      );
    });
  });
});
