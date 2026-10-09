import * as assert from 'assert';
import * as vscode from 'vscode';
import { submitAssignmentCommand } from '../../src/commands/submitAssignment.js';
import { ExtensionState } from '../../src/utils/extensionState.js';
import { Course, CourseWork } from '../../src/types/index.js';
import { AssignmentSubmission } from '../../src/submission/types.js';
import { DriveFolder, UploadedDriveFile } from '../../src/drive/types.js';
import { WorkspaceService } from '../../src/workspace/WorkspaceService.js';
import { FilePicker } from '../../src/ui/FilePicker.js';

suite('Phase 11 — Complete Submission Command Pipeline', () => {
  let mockState: ExtensionState;
  let originalShowWarning: typeof vscode.window.showWarningMessage;
  let originalShowInfo: typeof vscode.window.showInformationMessage;
  let originalShowError: typeof vscode.window.showErrorMessage;
  let originalAnalyzeWorkspace: typeof WorkspaceService.prototype.analyzeWorkspace;
  let originalPromptFileSelection: typeof FilePicker.prototype.promptFileSelection;

  const sampleCourse: Course = {
    id: 'crs-pipeline-1',
    name: 'CS50 Intro to Computer Science',
    courseState: 'ACTIVE',
  };

  const sampleCourseWork: CourseWork = {
    id: 'cw-pipeline-1',
    courseId: 'crs-pipeline-1',
    title: 'Problem Set 1 — C Syntax',
    state: 'PUBLISHED',
    workType: 'ASSIGNMENT',
  };

  setup(() => {
    originalShowWarning = vscode.window.showWarningMessage;
    originalShowInfo = vscode.window.showInformationMessage;
    originalShowError = vscode.window.showErrorMessage;
    originalAnalyzeWorkspace = WorkspaceService.prototype.analyzeWorkspace;
    originalPromptFileSelection = FilePicker.prototype.promptFileSelection;

    const mockContext = {
      secrets: {
        get: async () => null,
        store: async () => {},
        delete: async () => {},
        onDidChange: () => ({ dispose: () => {} }),
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    mockState = new ExtensionState(mockContext);
  });

  teardown(() => {
    vscode.window.showWarningMessage = originalShowWarning;
    vscode.window.showInformationMessage = originalShowInfo;
    vscode.window.showErrorMessage = originalShowError;
    WorkspaceService.prototype.analyzeWorkspace = originalAnalyzeWorkspace;
    FilePicker.prototype.promptFileSelection = originalPromptFileSelection;
  });

  test('prompts to sign in when user is not authenticated', async () => {
    let warningPrompted = false;

    mockState.authService.isAuthenticated = async () => false;

    vscode.window.showWarningMessage = async (msg: string) => {
      if (msg.includes('Please sign in with Google')) {
        warningPrompted = true;
      }
      return undefined;
    };

    await submitAssignmentCommand(mockState);
    assert.ok(warningPrompted, 'Should warn user to sign in first');
  });

  test('prompts to reclaim if submission is currently in TURNED_IN state', async () => {
    mockState.authService.isAuthenticated = async () => true;
    mockState.selectedCourseId = 'crs-pipeline-1';
    mockState.selectedCourseWorkId = 'cw-pipeline-1';

    mockState.classroomService.getCourse = async () => sampleCourse;
    mockState.classroomService.getCourseWork = async () => sampleCourseWork;

    const turnedInSub: AssignmentSubmission = {
      courseId: 'crs-pipeline-1',
      courseworkId: 'cw-pipeline-1',
      submissionId: 'sub-turned-in-1',
      state: 'TURNED_IN',
      isSubmitted: true,
      canSubmit: false,
      canReclaim: true,
      isResubmission: false,
    };

    mockState.submissionService.getStudentSubmission = async () => turnedInSub;

    let reclaimPromptShown = false;
    vscode.window.showWarningMessage = async (msg: string) => {
      if (msg.includes('marked as Turned In')) {
        reclaimPromptShown = true;
      }
      // User clicks Cancel
      return 'Cancel' as unknown as undefined;
    };

    await submitAssignmentCommand(mockState);
    assert.ok(reclaimPromptShown, 'Should prompt user that submission must be reclaimed first');
  });

  test('cancels submission cleanly when user declines confirmation dialog', async () => {
    mockState.authService.isAuthenticated = async () => true;
    mockState.selectedCourseId = 'crs-pipeline-1';
    mockState.selectedCourseWorkId = 'cw-pipeline-1';

    mockState.classroomService.getCourse = async () => sampleCourse;
    mockState.classroomService.getCourseWork = async () => sampleCourseWork;

    const createdSub: AssignmentSubmission = {
      courseId: 'crs-pipeline-1',
      courseworkId: 'cw-pipeline-1',
      submissionId: 'sub-new-1',
      state: 'CREATED',
      isSubmitted: false,
      canSubmit: true,
      canReclaim: false,
      isResubmission: false,
    };

    mockState.submissionService.getStudentSubmission = async () => createdSub;

    // Simulate workspace analysis
    WorkspaceService.prototype.analyzeWorkspace = async () => ({
      rootPath: 'C:/project',
      folderName: 'project',
      allFiles: [],
      includedFiles: [],
      excludedFiles: [],
      totalIncludedBytes: 100,
      oversizedFileCount: 0,
    });

    // Mock promptFileSelection to return 1 file
    FilePicker.prototype.promptFileSelection = async () => ({
      selectedFiles: [
        {
          relativePath: 'main.c',
          absolutePath: 'C:/project/main.c',
          size: 100,
          isDirectory: false,
        },
      ],
      totalBytes: 100,
      totalFiles: 1,
      excludedCount: 0,
      formattedSize: '100 B',
    });

    let cancelInfoShown = false;
    vscode.window.showInformationMessage = async (msg: string) => {
      if (msg.includes('Submit to Google Classroom?')) {
        return 'Cancel';
      }
      if (msg.includes('Submission cancelled')) {
        cancelInfoShown = true;
      }
      return undefined;
    };

    mockState.getConfiguration = () => ({
      excludedDirectories: [],
      excludedFiles: [],
      maxFileSizeMb: 50,
      confirmBeforeSubmit: true,
      detectSecrets: false,
      showNotifications: true,
      clientId: 'mock',
      clientSecret: 'mock',
      redirectUri: 'mock',
    });

    await submitAssignmentCommand(mockState);
    assert.ok(cancelInfoShown, 'Should notify user that submission was cancelled');
  });

  test('executes end-to-end pipeline: drive upload, attach files, and turn in', async () => {
    mockState.authService.isAuthenticated = async () => true;
    mockState.selectedCourseId = 'crs-pipeline-1';
    mockState.selectedCourseWorkId = 'cw-pipeline-1';

    mockState.classroomService.getCourse = async () => sampleCourse;
    mockState.classroomService.getCourseWork = async () => sampleCourseWork;

    const createdSub: AssignmentSubmission = {
      courseId: 'crs-pipeline-1',
      courseworkId: 'cw-pipeline-1',
      submissionId: 'sub-new-1',
      state: 'CREATED',
      isSubmitted: false,
      canSubmit: true,
      canReclaim: false,
      isResubmission: false,
    };

    mockState.submissionService.getStudentSubmission = async () => createdSub;

    let folderCreated = false;
    let batchUploaded = false;
    let filesAttached = false;
    let assignmentTurnedIn = false;
    let successMessageShown = false;

    WorkspaceService.prototype.analyzeWorkspace = async () => ({
      rootPath: 'C:/project',
      folderName: 'project',
      allFiles: [],
      includedFiles: [],
      excludedFiles: [],
      totalIncludedBytes: 250,
      oversizedFileCount: 0,
    });

    FilePicker.prototype.promptFileSelection = async () => ({
      selectedFiles: [
        {
          relativePath: 'main.c',
          absolutePath: 'C:/project/main.c',
          size: 250,
          isDirectory: false,
        },
      ],
      totalBytes: 250,
      totalFiles: 1,
      excludedCount: 0,
      formattedSize: '250 B',
    });

    mockState.driveService.getOrCreateClassroomFolder = async (crsName, cwTitle): Promise<DriveFolder> => {
      assert.strictEqual(crsName, 'CS50 Intro to Computer Science');
      assert.strictEqual(cwTitle, 'Problem Set 1 — C Syntax');
      folderCreated = true;
      return { id: 'folder-drive-123', name: cwTitle || '' };
    };

    mockState.driveService.uploadBatch = async (files, options): Promise<UploadedDriveFile[]> => {
      assert.strictEqual(files.length, 1);
      assert.strictEqual(options?.parentFolderId, 'folder-drive-123');
      batchUploaded = true;
      return [
        {
          id: 'drive-uploaded-file-01',
          name: 'main.c',
          mimeType: 'text/x-c',
        },
      ];
    };

    mockState.submissionService.attachDriveFiles = async (crsId, cwId, subId, fileIds) => {
      assert.strictEqual(crsId, 'crs-pipeline-1');
      assert.strictEqual(cwId, 'cw-pipeline-1');
      assert.strictEqual(subId, 'sub-new-1');
      assert.deepStrictEqual(fileIds, ['drive-uploaded-file-01']);
      filesAttached = true;
      return createdSub;
    };

    mockState.submissionService.turnInSubmission = async (crsId, cwId, subId) => {
      assert.strictEqual(crsId, 'crs-pipeline-1');
      assert.strictEqual(cwId, 'cw-pipeline-1');
      assert.strictEqual(subId, 'sub-new-1');
      assignmentTurnedIn = true;
      return {
        ...createdSub,
        state: 'TURNED_IN',
        isSubmitted: true,
        canSubmit: false,
        canReclaim: true,
        late: false,
      };
    };

    vscode.window.showInformationMessage = async (msg: string) => {
      if (msg.includes('Submit to Google Classroom?')) {
        return 'Submit Now';
      }
      if (msg.includes('Successfully submitted')) {
        successMessageShown = true;
      }
      return undefined;
    };

    await submitAssignmentCommand(mockState);

    assert.ok(folderCreated, 'Should create Drive folder hierarchy');
    assert.ok(batchUploaded, 'Should upload selected files in batch');
    assert.ok(filesAttached, 'Should attach uploaded Drive files to Classroom submission');
    assert.ok(assignmentTurnedIn, 'Should turn in submission to Google Classroom');
    assert.ok(successMessageShown, 'Should present success completion message');
  });
});
