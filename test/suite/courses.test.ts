import * as assert from 'assert';
import { ClassroomService } from '../../src/classroom/ClassroomService.js';
import { CoursePicker } from '../../src/ui/CoursePicker.js';
import { Course } from '../../src/types/index.js';
import { ClassroomApiError } from '../../src/errors/errors.js';

suite('Phase 5 — Google Classroom Courses', () => {
  let classroomService: ClassroomService;
  let originalFetch: typeof globalThis.fetch;
  const mockToken = 'mock-access-token-abc-123';

  const sampleCourses: Course[] = [
    {
      id: 'course-1',
      name: 'Software Construction & Design',
      section: 'CS-401',
      descriptionHeading: 'Spring 2026',
      courseState: 'ACTIVE',
      alternateLink: 'https://classroom.google.com/c/1',
    },
    {
      id: 'course-2',
      name: 'Database Systems',
      section: 'CS-402',
      room: 'Lab 3',
      courseState: 'ACTIVE',
      alternateLink: 'https://classroom.google.com/c/2',
    },
    {
      id: 'course-3',
      name: 'Artificial Intelligence',
      courseState: 'ARCHIVED',
      alternateLink: 'https://classroom.google.com/c/3',
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

  suite('ClassroomService — listCourses', () => {
    test('fetches active courses with Bearer token authorization header', async () => {
      let capturedAuthHeader: string | undefined;

      globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        capturedAuthHeader = headers?.Authorization;

        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: sampleCourses.filter((c) => c.courseState === 'ACTIVE'),
          }),
        } as unknown as Response;
      };

      const courses = await classroomService.listCourses();

      assert.strictEqual(capturedAuthHeader, `Bearer ${mockToken}`);
      assert.strictEqual(courses.length, 2);
      assert.strictEqual(courses[0]?.name, 'Software Construction & Design');
      assert.strictEqual(courses[1]?.name, 'Database Systems');
    });

    test('handles pagination across multiple page tokens', async () => {
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
              courses: [sampleCourses[0]],
              nextPageToken: 'token-page-2',
            }),
          } as unknown as Response;
        } else if (pageToken === 'token-page-2') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              courses: [sampleCourses[1]],
              nextPageToken: undefined,
            }),
          } as unknown as Response;
        }

        return { ok: false, status: 400 } as unknown as Response;
      };

      const courses = await classroomService.listCourses();

      assert.strictEqual(callCount, 2, 'Should make 2 paginated requests');
      assert.strictEqual(courses.length, 2, 'Should combine courses from both pages');
      assert.strictEqual(courses[0]?.id, 'course-1');
      assert.strictEqual(courses[1]?.id, 'course-2');
    });

    test('serves subsequent calls from memory cache within TTL', async () => {
      let networkCalls = 0;

      globalThis.fetch = async () => {
        networkCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [sampleCourses[0]],
          }),
        } as unknown as Response;
      };

      const firstCall = await classroomService.listCourses();
      const secondCall = await classroomService.listCourses();

      assert.strictEqual(networkCalls, 1, 'Network should only be called once');
      assert.deepStrictEqual(firstCall, secondCall);
    });

    test('bypasses cache when forceRefresh is true', async () => {
      let networkCalls = 0;

      globalThis.fetch = async () => {
        networkCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [sampleCourses[0]],
          }),
        } as unknown as Response;
      };

      await classroomService.listCourses();
      await classroomService.listCourses({ forceRefresh: true });

      assert.strictEqual(networkCalls, 2, 'Should re-fetch from network when forceRefresh is true');
    });

    test('handles empty course list gracefully', async () => {
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({ courses: [] }),
        } as unknown as Response;
      };

      const courses = await classroomService.listCourses();
      assert.strictEqual(courses.length, 0);
    });

    test('throws friendly ClassroomApiError when API returns HTTP 403 Forbidden', async () => {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: { message: 'The caller does not have permission' },
          }),
        } as unknown as Response;
      };

      await assert.rejects(
        () => classroomService.listCourses(),
        (err: Error) => {
          assert.strictEqual(err.name, 'ClassroomApiError');
          assert.strictEqual((err as ClassroomApiError).httpStatus, 403);
          assert.ok(err.message.includes('denied access'));
          return true;
        },
      );
    });

    test('throws ClassroomApiError when network fails', async () => {
      globalThis.fetch = async () => {
        throw new Error('ECONNREFUSED connect failed');
      };

      await assert.rejects(
        () => classroomService.listCourses(),
        (err: Error) => {
          assert.strictEqual(err.name, 'ClassroomApiError');
          assert.strictEqual((err as ClassroomApiError).code, 'NETWORK_ERROR');
          return true;
        },
      );
    });
  });

  suite('ClassroomService — getCourse', () => {
    test('fetches single course by id', async () => {
      globalThis.fetch = async (url: string | URL | Request) => {
        assert.ok(String(url).endsWith('/courses/course-1'));
        return {
          ok: true,
          status: 200,
          json: async () => sampleCourses[0],
        } as unknown as Response;
      };

      const course = await classroomService.getCourse('course-1');
      assert.strictEqual(course.name, 'Software Construction & Design');
    });

    test('throws ClassroomApiError with COURSE_NOT_FOUND on HTTP 404', async () => {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Course not found' } }),
        } as unknown as Response;
      };

      await assert.rejects(
        () => classroomService.getCourse('missing-course-id'),
        (err: Error) => {
          assert.strictEqual(err.name, 'ClassroomApiError');
          assert.strictEqual((err as ClassroomApiError).code, 'COURSE_NOT_FOUND');
          return true;
        },
      );
    });

    test('rejects empty course ID argument', async () => {
      await assert.rejects(
        () => classroomService.getCourse('   '),
        (err: Error) => {
          assert.strictEqual(err.name, 'ClassroomApiError');
          assert.strictEqual((err as ClassroomApiError).code, 'INVALID_ARGUMENT');
          return true;
        },
      );
    });
  });

  suite('CoursePicker UI Formatting', () => {
    test('createPickerItem formats active course with icon and section', () => {
      const item = CoursePicker.createPickerItem(sampleCourses[0]!);

      assert.ok(item.label.includes('Software Construction & Design'));
      assert.ok(item.label.includes('$(mortar-board)'));
      assert.strictEqual(item.description, 'CS-401');
      assert.strictEqual(item.detail, 'Spring 2026');
    });

    test('createPickerItem formats archived course with archive icon', () => {
      const item = CoursePicker.createPickerItem(sampleCourses[2]!);

      assert.ok(item.label.includes('Artificial Intelligence'));
      assert.ok(item.label.includes('$(archive)'));
    });
  });
});
