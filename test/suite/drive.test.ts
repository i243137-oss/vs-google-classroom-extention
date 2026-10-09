import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DriveService } from '../../src/drive/DriveService.js';
import { DriveApiError } from '../../src/errors/errors.js';

suite('Phase 8 — Google Drive File Upload', () => {
  let driveService: DriveService;
  let originalFetch: typeof globalThis.fetch;
  const mockToken = 'mock-access-token-drive-456';
  let tempDir: string;

  setup(() => {
    originalFetch = globalThis.fetch;
    // Set low resumable threshold (1 KB) for testing resumable upload easily
    driveService = new DriveService(async () => mockToken, 1024);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-submit-drive-test-'));
  });

  teardown(() => {
    globalThis.fetch = originalFetch;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  suite('MIME Type Detection', () => {
    test('resolves correct MIME types for code and documents', () => {
      assert.strictEqual(driveService.lookupMimeType('index.ts'), 'application/typescript');
      assert.strictEqual(driveService.lookupMimeType('main.py'), 'text/x-python');
      assert.strictEqual(driveService.lookupMimeType('package.json'), 'application/json');
      assert.strictEqual(driveService.lookupMimeType('README.md'), 'text/markdown');
      assert.strictEqual(driveService.lookupMimeType('style.css'), 'text/css');
      assert.strictEqual(driveService.lookupMimeType('doc.pdf'), 'application/pdf');
    });

    test('falls back to application/octet-stream for unknown binaries', () => {
      assert.strictEqual(driveService.lookupMimeType('binary.unknownext'), 'application/octet-stream');
    });
  });

  suite('Folder Management', () => {
    test('finds existing folder if present', async () => {
      let capturedUrl = '';

      globalThis.fetch = async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              {
                id: 'folder-existing-123',
                name: 'CS101',
                webViewLink: 'https://drive.google.com/folder/123',
              },
            ],
          }),
        } as unknown as Response;
      };

      const folder = await driveService.findOrCreateFolder('CS101');

      assert.ok(capturedUrl.includes('/files?q='));
      assert.ok(capturedUrl.includes('mimeType+%3D+%27application%2Fvnd.google-apps.folder%27'));
      assert.strictEqual(folder.id, 'folder-existing-123');
      assert.strictEqual(folder.name, 'CS101');
    });

    test('creates new folder when none exists', async () => {
      let searchCalled = false;
      let createCalled = false;
      let createBody = '';

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url);
        if (init?.method === 'POST') {
          createCalled = true;
          createBody = String(init.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'folder-new-456',
              name: 'NewFolder',
              webViewLink: 'https://drive.google.com/folder/456',
            }),
          } as unknown as Response;
        } else {
          searchCalled = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [] }),
          } as unknown as Response;
        }
      };

      const folder = await driveService.findOrCreateFolder('NewFolder', 'parent-id-001');

      assert.ok(searchCalled);
      assert.ok(createCalled);
      assert.ok(createBody.includes('NewFolder'));
      assert.ok(createBody.includes('parent-id-001'));
      assert.strictEqual(folder.id, 'folder-new-456');
    });

    test('getOrCreateClassroomFolder builds hierarchy', async () => {
      const createdFolders: string[] = [];

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { name: string };
          createdFolders.push(body.name);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: `folder-${body.name}`,
              name: body.name,
            }),
          } as unknown as Response;
        } else {
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [] }),
          } as unknown as Response;
        }
      };

      const finalFolder = await driveService.getOrCreateClassroomFolder('CS50', 'Project 1');

      assert.strictEqual(createdFolders.length, 3);
      assert.strictEqual(createdFolders[0], 'Classroom Submit');
      assert.strictEqual(createdFolders[1], 'CS50');
      assert.strictEqual(createdFolders[2], 'Project 1');
      assert.strictEqual(finalFolder.id, 'folder-Project 1');
    });

    test('throws INVALID_ARGUMENT when folder name is empty', async () => {
      await assert.rejects(
        async () => driveService.findOrCreateFolder(''),
        (err: unknown) => err instanceof DriveApiError && err.code === 'INVALID_ARGUMENT',
      );
    });
  });

  suite('Multipart File Upload (< threshold)', () => {
    test('uploads small file using multipart upload', async () => {
      let capturedMethod = '';
      let capturedAuth = '';
      let capturedContentType = '';
      let progressReported = false;

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        capturedMethod = init?.method || '';
        capturedAuth = (init?.headers as Record<string, string>)?.Authorization || '';
        capturedContentType = (init?.headers as Record<string, string>)?.['Content-Type'] || '';

        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'file-drive-001',
            name: 'solution.ts',
            mimeType: 'application/typescript',
            webViewLink: 'https://drive.google.com/file/d/001/view',
            size: '50',
          }),
        } as unknown as Response;
      };

      const content = Buffer.from('console.log("Hello from Classroom Submit");');
      const uploaded = await driveService.uploadFile(content, 'solution.ts', {
        parentFolderId: 'folder-parent-999',
        onProgress: (uploadedBytes, totalBytes) => {
          if (uploadedBytes === totalBytes) {
            progressReported = true;
          }
        },
      });

      assert.strictEqual(capturedMethod, 'POST');
      assert.strictEqual(capturedAuth, `Bearer ${mockToken}`);
      assert.ok(capturedContentType.includes('multipart/related; boundary='));
      assert.strictEqual(uploaded.id, 'file-drive-001');
      assert.strictEqual(uploaded.name, 'solution.ts');
      assert.strictEqual(uploaded.size, 50);
      assert.ok(progressReported);
    });

    test('uploads file from disk path', async () => {
      const testFilePath = path.join(tempDir, 'sample.py');
      fs.writeFileSync(testFilePath, 'print("Python workspace file")');

      globalThis.fetch = async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'file-py-002',
            name: 'sample.py',
            mimeType: 'text/x-python',
          }),
        }) as unknown as Response;

      const uploaded = await driveService.uploadFile(testFilePath, 'sample.py');
      assert.strictEqual(uploaded.id, 'file-py-002');
      assert.strictEqual(uploaded.name, 'sample.py');
    });

    test('constructs RFC 2046 compliant multipart payload with trailing CRLF', async () => {
      let capturedBody: Uint8Array | undefined;
      let capturedContentType = '';

      globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
        capturedContentType = (init?.headers as Record<string, string>)?.['Content-Type'] || '';
        if (init?.body instanceof Uint8Array) {
          capturedBody = init.body;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'file-multipart-rfc',
            name: 'rfc.txt',
            mimeType: 'text/plain',
          }),
        } as unknown as Response;
      };

      await driveService.uploadFile(Buffer.from('hello rfc'), 'rfc.txt');

      assert.ok(capturedBody, 'Body should be a Uint8Array');
      const boundaryMatch = capturedContentType.match(/boundary=([^\s;]+)/);
      assert.ok(boundaryMatch, 'Content-Type should specify boundary');
      const boundary = boundaryMatch[1];
      const bodyText = Buffer.from(capturedBody).toString('utf-8');
      assert.ok(
        bodyText.endsWith(`\r\n--${boundary}--\r\n`),
        'Multipart payload must end with closing boundary followed by CRLF per RFC 2046',
      );
    });

    test('falls back to resumable upload when multipart upload encounters network failure', async () => {
      let attemptCount = 0;
      let resumableInitCalled = false;
      let chunkUploaded = false;

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        attemptCount++;
        const urlStr = String(url);

        // First attempt: multipart upload throws network error (e.g. socket reset)
        if (urlStr.includes('uploadType=multipart')) {
          const fetchErr = new TypeError('fetch failed');
          Object.assign(fetchErr, { cause: new Error('ECONNRESET: Connection reset by peer') });
          throw fetchErr;
        }

        // Fallback: resumable upload session init
        if (urlStr.includes('uploadType=resumable') && init?.method === 'POST') {
          resumableInitCalled = true;
          return {
            ok: true,
            status: 200,
            headers: new Headers({
              location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=fallback-session-999',
            }),
          } as unknown as Response;
        }

        // Fallback: resumable chunk upload
        if (urlStr.includes('fallback-session-999') && init?.method === 'PUT') {
          chunkUploaded = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'file-recovered-via-resumable',
              name: 'small.txt',
              mimeType: 'text/plain',
            }),
          } as unknown as Response;
        }

        throw new Error(`Unexpected request: ${urlStr}`);
      };

      const result = await driveService.uploadFile(Buffer.from('small content'), 'small.txt');

      assert.ok(attemptCount >= 2, 'Should have attempted multipart first then resumable');
      assert.ok(resumableInitCalled, 'Resumable session should have been initiated as fallback');
      assert.ok(chunkUploaded, 'Resumable chunk should have been uploaded');
      assert.strictEqual(result.id, 'file-recovered-via-resumable');
    });

    test('throws FILE_NOT_FOUND when local file does not exist', async () => {
      await assert.rejects(
        async () => driveService.uploadFile('C:/non-existent-path/file.txt', 'file.txt'),
        (err: unknown) => err instanceof DriveApiError && err.code === 'FILE_NOT_FOUND',
      );
    });
  });

  suite('Resumable File Upload (>= threshold)', () => {
    test('uploads file exceeding threshold via resumable session', async () => {
      let initCalled = false;
      let chunkCount = 0;
      const progressSteps: number[] = [];

      const largeContent = Buffer.alloc(2048, 'x'); // 2048 bytes > 1024 threshold

      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url);
        if (init?.method === 'POST') {
          initCalled = true;
          return {
            ok: true,
            status: 200,
            headers: new Headers({
              location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session-xyz',
            }),
          } as unknown as Response;
        } else if (init?.method === 'PUT') {
          chunkCount++;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'large-file-drive-789',
              name: 'large.zip',
              mimeType: 'application/zip',
              size: '2048',
            }),
          } as unknown as Response;
        }

        throw new Error(`Unexpected request: ${urlStr}`);
      };

      const uploaded = await driveService.uploadFile(largeContent, 'large.zip', {
        onProgress: (current, total) => {
          progressSteps.push(current);
        },
      });

      assert.ok(initCalled);
      assert.ok(chunkCount >= 1);
      assert.strictEqual(uploaded.id, 'large-file-drive-789');
      assert.strictEqual(uploaded.size, 2048);
      assert.ok(progressSteps.length > 0);
    });

    test('throws RESUMABLE_SESSION_FAILED when location header is missing', async () => {
      const largeContent = Buffer.alloc(2048, 'x');

      globalThis.fetch = async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(), // No location header
        }) as unknown as Response;

      await assert.rejects(
        async () => driveService.uploadFile(largeContent, 'data.bin'),
        (err: unknown) => err instanceof DriveApiError && err.code === 'RESUMABLE_SESSION_FAILED',
      );
    });
  });

  suite('Batch File Upload', () => {
    test('uploads array of files reporting batch progress', async () => {
      const file1Path = path.join(tempDir, 'file1.txt');
      const file2Path = path.join(tempDir, 'file2.txt');
      fs.writeFileSync(file1Path, 'File 1 content');
      fs.writeFileSync(file2Path, 'File 2 content');

      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: `batch-id-${callCount}`,
            name: `file${callCount}.txt`,
            mimeType: 'text/plain',
          }),
        } as unknown as Response;
      };

      const progressRecords: { current: number; total: number; name: string }[] = [];

      const results = await driveService.uploadBatch(
        [
          { filePath: file1Path, relativePath: 'src/file1.txt' },
          { filePath: file2Path, relativePath: 'src/file2.txt' },
        ],
        {
          onProgress: (current, total, name) => {
            progressRecords.push({ current, total, name });
          },
        },
      );

      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0]?.id, 'batch-id-1');
      assert.strictEqual(results[1]?.id, 'batch-id-2');
      assert.ok(progressRecords.length >= 2);
    });

    test('handles empty batch gracefully', async () => {
      const results = await driveService.uploadBatch([]);
      assert.deepStrictEqual(results, []);
    });
  });

  suite('Error Handling & Diagnostics', () => {
    test('maps HTTP 403 Forbidden to DriveApiError with friendly message', async () => {
      globalThis.fetch = async () =>
        ({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          json: async () => ({
            error: { message: 'The user does not have sufficient permissions for this file.' },
          }),
        }) as unknown as Response;

      await assert.rejects(
        async () => driveService.uploadFile(Buffer.from('test'), 'test.txt'),
        (err: unknown) => {
          assert.ok(err instanceof DriveApiError);
          assert.strictEqual(err.httpStatus, 403);
          assert.ok(err.message.includes('permission') || err.message.includes('denied'));
          return true;
        },
      );
    });

    test('handles network fetch exception gracefully', async () => {
      globalThis.fetch = async () => {
        throw new Error('DNS failure');
      };

      await assert.rejects(
        async () => driveService.uploadFile(Buffer.from('test'), 'test.txt'),
        (err: unknown) => {
          assert.ok(err instanceof DriveApiError);
          assert.strictEqual(err.code, 'NETWORK_ERROR');
          assert.ok(err.message.includes('DNS failure'));
          return true;
        },
      );
    });

    test('extracts and formats error cause in DriveApiError', async () => {
      globalThis.fetch = async () => {
        const fetchErr = new TypeError('fetch failed');
        Object.assign(fetchErr, { cause: new Error('ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:443') });
        throw fetchErr;
      };

      await assert.rejects(
        async () => driveService.uploadFile(Buffer.from('test'), 'test.txt'),
        (err: unknown) => {
          assert.ok(err instanceof DriveApiError);
          assert.strictEqual(err.code, 'NETWORK_ERROR');
          assert.ok(err.message.includes('ECONNREFUSED'), 'Error message should include cause details');
          return true;
        },
      );
    });
  });
});
