import * as assert from 'assert';
import { ClassroomService } from '../../src/classroom/ClassroomService.js';
import { AssignmentPicker } from '../../src/ui/AssignmentPicker.js';
import { CourseWork, StudentSubmission } from '../../src/types/index.js';
import { AssignmentWithSubmission } from '../../src/classroom/types.js';

suite('Phase 6 — Assignment Discovery', () => {
  let classroomService: ClassroomService;
  let originalFetch: typeof globalThis.fetch;
  const mockToken = 'mock-access-token-xyz-789';

  const sampleCourseWork: CourseWork[] = [
    {
      id: 'cw-1',
      courseId: 'course-101',
      title: 'Assignment 02 — Structural Testing',
      description: 'Implement structural tests and unit tests for the core logic.',
      dueDate: { year: 2026, month: 10, day: 12 },
      dueTime: { hours: 23, minutes: 59 },
      maxPoints: 100,
      state: 'PUBLISHED',
      workType: 'ASSIGNMENT',
      alternateLink: 'https://classroom.google.com/c/101/cw/1',
    },
    {
      id: 'cw-2',
      courseId: 'course-101',
      title: 'Assignment 01 — Setup & Specification',
      description: 'Initial repo setup and architecture plan.',
      dueDate: { year: 2026, month: 9, day: 15 },
      dueTime: { hours: 18, minutes: 0 },
      maxPoints: 50,
      state: 'PUBLISHED',
      workType: 'ASSIGNMENT',
      alternateLink: 'https://classroom.google.com/c/101/cw/2',
    },
    {
      id: 'cw-3',
      courseId: 'course-101',
      title: 'Ungraded Reading Material',
      description: 'Read chapter 3 before next class.',
      state: 'PUBLISHED',
      workType: 'ASSIGNMENT',
      alternateLink: 'https://classroom.google.com/c/101/cw/3',
    },
  ];

  const sampleSubmissions: StudentSubmission[] = [
    {
      id: 'sub-1',
      courseId: 'course-101',
      courseWorkId: 'cw-1',
      state: 'CREATED',
      late: false,
      alternateLink: 'https://classroom.google.com/c/101/cw/1/sub/1',
    },
    {
      id: 'sub-2',
      courseId: 'course-101',
      courseWorkId: 'cw-2',
      state: 'TURNED_IN',
      late: true,
      alternateLink: 'https://classroom.google.com/c/101/cw/2/sub/2',
    },
  ];

  setup(() => {
    originalFetch = globalThis.fetch;
    classroomService = new ClassroomService(async () => mockToken);
  });

  teardown(() => {
    globalThis.fetch = originalFetch;
    classroomService.clearCache();
  });

  suite('ClassroomService — CourseWork Retrieval', () => {
    test('fetches coursework items with authorization token', async () => {
      let capturedUrl = '';
      let capturedAuth = '';

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedAuth = (init?.headers as Record<string, string>)?.Authorization || '';

        return {
          ok: true,
          status: 200,
          json: async () => ({
            courseWork: sampleCourseWork,
          }),
        } as unknown as Response;
      };

      const items = await classroomService.listCourseWork('course-101');

      assert.ok(capturedUrl.includes('/courses/course-101/courseWork'));
      assert.strictEqual(capturedAuth, `Bearer ${mockToken}`);
      assert.strictEqual(items.length, 3);
      assert.strictEqual(items[0]?.title, 'Assignment 02 — Structural Testing');
    });

    test('handles pagination across multiple coursework page tokens', async () => {
      let callCount = 0;

      globalThis.fetch = async (url: string | URL | Request) => {
        callCount++;
        const parsed = new URL(String(url));
        const pageToken = parsed.searchParams.get('pageToken');

        if (!pageToken) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              courseWork: [sampleCourseWork[0]],
              nextPageToken: 'page-token-2',
            }),
          } as unknown as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            courseWork: [sampleCourseWork[1], sampleCourseWork[2]],
            nextPageToken: undefined,
          }),
        } as unknown as Response;
      };

      const items = await classroomService.listCourseWork('course-101');

      assert.strictEqual(callCount, 2, 'Should paginate across 2 requests');
      assert.strictEqual(items.length, 3, 'Should combine items from both pages');
    });

    test('serves coursework from in-memory cache and respects forceRefresh', async () => {
      let networkCalls = 0;

      globalThis.fetch = async () => {
        networkCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courseWork: sampleCourseWork,
          }),
        } as unknown as Response;
      };

      // Call 1: Network fetch
      const res1 = await classroomService.listCourseWork('course-101');
      // Call 2: Served from cache
      const res2 = await classroomService.listCourseWork('course-101');
      assert.strictEqual(networkCalls, 1, 'Subsequent request should use cache');
      assert.deepStrictEqual(res1, res2);

      // Call 3: Force refresh bypasses cache
      await classroomService.listCourseWork('course-101', { forceRefresh: true });
      assert.strictEqual(networkCalls, 2, 'forceRefresh must re-fetch from network');
    });

    test('listAssignmentsWithSubmissions correlates coursework with student submissions', async () => {
      globalThis.fetch = async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes('/courseWork/-/studentSubmissions')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ studentSubmissions: sampleSubmissions }),
          } as unknown as Response;
        }

        if (urlStr.includes('/courseWork')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ courseWork: sampleCourseWork }),
          } as unknown as Response;
        }

        return { ok: false, status: 404 } as unknown as Response;
      };

      const assignments = await classroomService.listAssignmentsWithSubmissions('course-101');

      assert.strictEqual(assignments.length, 3);

      // cw-1 has submission with state 'CREATED'
      const a1 = assignments.find((a) => a.courseWork.id === 'cw-1');
      assert.ok(a1);
      assert.strictEqual(a1?.submission?.id, 'sub-1');
      assert.strictEqual(a1?.submissionStatus, 'NOT_SUBMITTED');

      // cw-2 has submission with state 'TURNED_IN', late: true
      const a2 = assignments.find((a) => a.courseWork.id === 'cw-2');
      assert.ok(a2);
      assert.strictEqual(a2?.submission?.id, 'sub-2');
      assert.strictEqual(a2?.submissionStatus, 'TURNED_IN');
      assert.strictEqual(a2?.statusLabel, 'Turned in (Late)');

      // cw-3 has no submission
      const a3 = assignments.find((a) => a.courseWork.id === 'cw-3');
      assert.ok(a3);
      assert.strictEqual(a3?.submission, undefined);
      assert.strictEqual(a3?.dueStatus, 'NO_DUE_DATE');
      assert.strictEqual(a3?.formattedDue, 'No due date');
    });
  });

  suite('Due Date and Submission Status Helpers', () => {
    test('formatDueDate correctly handles missing due date', () => {
      const result = ClassroomService.formatDueDate(undefined);
      assert.strictEqual(result.formatted, 'No due date');
      assert.strictEqual(result.dueStatus, 'NO_DUE_DATE');
      assert.strictEqual(result.isOverdue, false);
    });

    test('formatDueDate formats date with month, day, year, and time', () => {
      const result = ClassroomService.formatDueDate(
        { year: 2026, month: 10, day: 12 },
        { hours: 23, minutes: 59 },
      );

      assert.ok(result.formatted.includes('October 12, 2026'));
      assert.ok(result.formatted.includes('11:59 PM'));
    });

    test('computeSubmissionStatus handles turned-in and returned states', () => {
      const turnedInSub: StudentSubmission = {
        id: '1',
        courseId: 'c1',
        courseWorkId: 'cw1',
        state: 'TURNED_IN',
        late: false,
        alternateLink: 'link',
      };
      const returnedSub: StudentSubmission = {
        id: '2',
        courseId: 'c1',
        courseWorkId: 'cw1',
        state: 'RETURNED',
        late: false,
        alternateLink: 'link',
      };
      const reclaimedSub: StudentSubmission = {
        id: '3',
        courseId: 'c1',
        courseWorkId: 'cw1',
        state: 'RECLAIMED_BY_STUDENT',
        late: false,
        alternateLink: 'link',
      };

      assert.deepStrictEqual(ClassroomService.computeSubmissionStatus(turnedInSub), {
        status: 'TURNED_IN',
        label: 'Turned in',
      });

      assert.deepStrictEqual(ClassroomService.computeSubmissionStatus(returnedSub), {
        status: 'RETURNED',
        label: 'Returned',
      });

      assert.deepStrictEqual(ClassroomService.computeSubmissionStatus(reclaimedSub), {
        status: 'RECLAIMED',
        label: 'Not submitted (Reclaimed)',
      });
    });

    test('computeSubmissionStatus marks unsubmitted past-due items as Missing (Overdue)', () => {
      const createdSub: StudentSubmission = {
        id: '1',
        courseId: 'c1',
        courseWorkId: 'cw1',
        state: 'CREATED',
        late: false,
        alternateLink: 'link',
      };

      const result = ClassroomService.computeSubmissionStatus(createdSub, true);
      assert.strictEqual(result.status, 'NOT_SUBMITTED');
      assert.strictEqual(result.label, 'Missing (Overdue)');
    });
  });

  suite('AssignmentPicker UI Item Formatting', () => {
    test('createPickerItem formats active assignment with due date and status details', () => {
      const item: AssignmentWithSubmission = {
        courseWork: sampleCourseWork[0]!,
        submission: sampleSubmissions[0],
        dueStatus: 'UPCOMING',
        formattedDue: 'October 12, 2026, 11:59 PM',
        submissionStatus: 'NOT_SUBMITTED',
        statusLabel: 'Not submitted',
      };

      const pickerItem = AssignmentPicker.createPickerItem(item);

      assert.ok(pickerItem.label.includes('Assignment 02 — Structural Testing'));
      assert.ok(pickerItem.description?.includes('October 12, 2026'));
      assert.ok(pickerItem.detail?.includes('Status: Not submitted'));
      assert.ok(pickerItem.detail?.includes('100 pts'));
    });

    test('createPickerItem shows alert icon and warning tag for overdue assignments', () => {
      const item: AssignmentWithSubmission = {
        courseWork: sampleCourseWork[1]!,
        submission: undefined,
        dueStatus: 'OVERDUE',
        formattedDue: 'September 15, 2026',
        submissionStatus: 'NOT_SUBMITTED',
        statusLabel: 'Missing (Overdue)',
      };

      const pickerItem = AssignmentPicker.createPickerItem(item);

      assert.ok(pickerItem.label.includes('$(alert)'));
      assert.ok(pickerItem.description?.includes('⚠️ Overdue'));
    });
  });
});
