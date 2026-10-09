import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { Logger } from '../utils/logger.js';
import { WorkspaceService } from '../workspace/WorkspaceService.js';
import { FilePicker } from '../ui/FilePicker.js';
import { CoursePicker } from '../ui/CoursePicker.js';
import { AssignmentPicker } from '../ui/AssignmentPicker.js';
import { ClassroomService } from '../classroom/ClassroomService.js';
import {
  WorkspaceError,
  AuthenticationError,
  ClassroomApiError,
  DriveApiError,
  SubmissionError,
} from '../errors/errors.js';
import { Course, CourseWork } from '../types/index.js';
import { AssignmentSubmission } from '../submission/types.js';

/**
 * Classroom: Submit Assignment
 *
 * Phase 11: Complete End-to-End Submission Pipeline:
 * 1. Verify Authentication (prompt sign-in if needed)
 * 2. Ensure Course Selection (prompt picker if none selected)
 * 3. Ensure Assignment Selection (prompt picker if none selected)
 * 4. Verify Submission Status (prompt Reclaim if currently TURNED_IN)
 * 5. Analyze Workspace & Select Files (FileScanner, FileFilter, FilePicker)
 * 6. Pre-submission Confirmation Modal Summary (if confirmBeforeSubmit enabled)
 * 7. Unified Progress Execution:
 *    a. Resolve Google Drive folder: Classroom Submit / <Course> / <Assignment>
 *    b. Upload selected workspace files to Google Drive
 *    c. Link uploaded files to Google Classroom submission record (modifyAttachments)
 *    d. Finalize & Turn In assignment to Google Classroom (turnIn)
 * 8. Completion Feedback (on-time vs late detection, deep link to Classroom)
 */
export async function submitAssignmentCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Submit Assignment command invoked.');

  let alternateClassroomUrl: string | undefined;

  try {
    // ── Step 1: Ensure Authentication ─────────────────────────────────────────
    const isAuthed = await state.authService.isAuthenticated();
    if (!isAuthed) {
      const action = await vscode.window.showWarningMessage(
        'Classroom Submit: Please sign in with Google before submitting.',
        'Sign In',
        'Cancel',
      );
      if (action === 'Sign In') {
        await vscode.commands.executeCommand('classroomSubmit.signIn');
      }
      return;
    }

    // ── Step 2: Ensure Course Selection ───────────────────────────────────────
    let courseId = state.selectedCourseId;
    let selectedCourse: Course | undefined;

    if (courseId) {
      selectedCourse = await state.classroomService.getCourse(courseId).catch(() => undefined);
    }

    if (!courseId || !selectedCourse) {
      const courses = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Classroom Submit',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Fetching enrolled courses from Google Classroom…' });
          return state.classroomService.listCourses();
        },
      );

      const coursePicker = new CoursePicker();
      const chosenCourse = await coursePicker.promptCourseSelection(courses);
      if (!chosenCourse) {
        return;
      }

      state.selectedCourseId = chosenCourse.id;
      state.selectedCourseWorkId = undefined; // reset assignment when course changes
      courseId = chosenCourse.id;
      selectedCourse = chosenCourse;
    }

    // ── Step 3: Ensure Assignment Selection ───────────────────────────────────
    let courseworkId = state.selectedCourseWorkId;
    let selectedCourseWork: CourseWork | undefined;

    if (courseworkId) {
      selectedCourseWork = await state.classroomService
        .getCourseWork(courseId, courseworkId)
        .catch(() => undefined);
    }

    if (!courseworkId || !selectedCourseWork) {
      const assignments = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Classroom Submit',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Fetching assignments for selected course…' });
          return state.classroomService.listAssignmentsWithSubmissions(courseId);
        },
      );

      const assignmentPicker = new AssignmentPicker();
      const chosenAssignment = await assignmentPicker.promptAssignmentSelection(
        assignments,
        selectedCourse.name,
      );
      if (!chosenAssignment) {
        return;
      }

      state.selectedCourseWorkId = chosenAssignment.courseWork.id;
      courseworkId = chosenAssignment.courseWork.id;
      selectedCourseWork = chosenAssignment.courseWork;
    }

    alternateClassroomUrl = selectedCourseWork.alternateLink;

    // ── Step 4: Verify Current Student Submission State ───────────────────────
    let submission: AssignmentSubmission = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Classroom Submit',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Checking current submission status…' });
        return state.submissionService.getStudentSubmission(courseId, courseworkId);
      },
    );

    // If already TURNED_IN, Google Classroom forbids modifying attachments. Student must reclaim first.
    if (submission.state === 'TURNED_IN') {
      const choice = await vscode.window.showWarningMessage(
        `This assignment is currently marked as Turned In in Google Classroom.\n` +
          `To submit new or updated files, you must reclaim it first.`,
        { modal: true },
        'Reclaim & Continue',
        'Cancel',
      );

      if (choice !== 'Reclaim & Continue') {
        return;
      }

      submission = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Classroom Submit — Reclaiming Assignment',
          cancellable: false,
        },
        async () => {
          return state.submissionService.reclaimSubmission(
            courseId,
            courseworkId,
            submission.submissionId,
          );
        },
      );

      await vscode.window.showInformationMessage('✓ Assignment reclaimed. Continuing with submission…');
    }

    // ── Step 5: Analyse Workspace & File Selection ────────────────────────────
    const config = state.getConfiguration();
    const workspaceService = new WorkspaceService();

    const analysis = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Classroom Submit',
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: 'Scanning project files…' });
        return workspaceService.analyzeWorkspace(config, token);
      },
    );

    if (!analysis) {
      return;
    }

    const filePicker = new FilePicker();
    const selectionResult = await filePicker.promptFileSelection(analysis);

    if (!selectionResult) {
      await vscode.window.showInformationMessage('Classroom Submit: File selection cancelled.');
      return;
    }

    if (selectionResult.totalFiles === 0) {
      await vscode.window.showWarningMessage('Classroom Submit: No files selected for submission.');
      return;
    }

    // ── Step 6: Pre-Submission Confirmation Dialog ────────────────────────────
    if (config.confirmBeforeSubmit) {
      const formattedDue = ClassroomService.formatDueDate(
        selectedCourseWork.dueDate,
        selectedCourseWork.dueTime,
      );

      const confirmLines = [
        `Submit to Google Classroom?`,
        ``,
        `Course: ${selectedCourse.name}`,
        `Assignment: ${selectedCourseWork.title}`,
        `Due: ${formattedDue.formatted}`,
        `Files: ${selectionResult.totalFiles} file(s) (${selectionResult.formattedSize})`,
      ];

      if (formattedDue.isOverdue) {
        confirmLines.push(`⚠️ Note: This assignment is past due and will be marked Late.`);
      }

      if (submission.isResubmission) {
        confirmLines.push(`ℹ️ Note: This is a resubmission.`);
      }

      confirmLines.push(``, `Files will be uploaded to Google Drive and turned in to Google Classroom.`);

      const confirmed = await vscode.window.showInformationMessage(
        confirmLines.join('\n'),
        { modal: true },
        'Submit Now',
        'Cancel',
      );

      if (confirmed !== 'Submit Now') {
        await vscode.window.showInformationMessage('Classroom Submit: Submission cancelled.');
        return;
      }
    }

    // ── Step 7: Unified End-to-End Submission Pipeline ────────────────────────
    const filesToUpload = selectionResult.selectedFiles.map((file) => ({
      filePath: file.absolutePath,
      relativePath: file.relativePath,
    }));

    interface PipelineResult {
      mode: 'TURNED_IN' | 'DRIVE_READY';
      targetFolder: { id: string; name: string; webViewLink?: string | undefined };
      uploadedFiles: Array<{ id: string; name: string }>;
      submission?: AssignmentSubmission | undefined;
    }

    const pipelineResult = await vscode.window.withProgress<PipelineResult>(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Classroom Submit: Submitting Assignment',
        cancellable: false,
      },
      async (progress): Promise<PipelineResult> => {
        // Stage A: Google Drive folder hierarchy
        progress.report({ message: 'Stage 1/4: Resolving Google Drive submission folder…' });
        const targetFolder = await state.driveService.getOrCreateClassroomFolder(
          selectedCourse.name,
          selectedCourseWork.title,
        );

        // Stage B: Upload files to Google Drive
        progress.report({
          message: `Stage 2/4: Uploading ${filesToUpload.length} file(s) to Google Drive…`,
        });

        const uploadedFiles = await state.driveService.uploadBatch(filesToUpload, {
          parentFolderId: targetFolder.id,
          onProgress: (done, total, currentFile) => {
            progress.report({
              message: `Stage 2/4: Uploading files (${done}/${total}): ${currentFile}`,
            });
          },
        });

        // Stage C: Check Developer Project association
        const isAssociated =
          selectedCourseWork.associatedWithDeveloper ?? submission.associatedWithDeveloper;
        if (isAssociated === false) {
          logger.info(
            `CourseWork ${courseworkId} is not associated with this developer project. Files saved to Google Drive. Guided turn-in enabled.`,
          );
          return {
            mode: 'DRIVE_READY',
            targetFolder,
            uploadedFiles,
            submission,
          };
        }

        // Stage C: Attach uploaded Drive files to Classroom submission
        progress.report({
          message: `Stage 3/4: Attaching files to Classroom submission…`,
        });

        const driveFileIds = uploadedFiles.map((file) => file.id);
        try {
          await state.submissionService.attachDriveFiles(
            courseId,
            courseworkId,
            submission.submissionId,
            driveFileIds,
          );
        } catch (err) {
          if (err instanceof SubmissionError && err.code === 'PROJECT_PERMISSION_DENIED') {
            logger.info(
              'ProjectPermissionDenied during attachDriveFiles; falling back to Drive-ready flow.',
            );
            return {
              mode: 'DRIVE_READY',
              targetFolder,
              uploadedFiles,
              submission,
            };
          }
          throw err;
        }

        // Stage D: Turn in submission to Google Classroom
        progress.report({
          message: `Stage 4/4: Finalizing submission and turning in…`,
        });

        try {
          const finalSub = await state.submissionService.turnInSubmission(
            courseId,
            courseworkId,
            submission.submissionId,
          );
          return {
            mode: 'TURNED_IN',
            targetFolder,
            uploadedFiles,
            submission: finalSub,
          };
        } catch (err) {
          if (err instanceof SubmissionError && err.code === 'PROJECT_PERMISSION_DENIED') {
            logger.info(
              'ProjectPermissionDenied during turnInSubmission; falling back to Drive-ready flow.',
            );
            return {
              mode: 'DRIVE_READY',
              targetFolder,
              uploadedFiles,
              submission,
            };
          }
          throw err;
        }
      },
    );

    // ── Step 8: Completion Feedback ───────────────────────────────────────────
    if (pipelineResult.mode === 'DRIVE_READY') {
      logger.info(
        `Files uploaded to Google Drive. Providing guided completion for Classroom web portal turn-in.`,
      );

      const classroomUrl = selectedCourseWork.alternateLink || submission.alternateLink;
      const buttons: string[] = [];
      if (classroomUrl) {
        buttons.push('Open in Classroom');
      }
      if (pipelineResult.targetFolder.webViewLink) {
        buttons.push('View in Drive');
      }
      buttons.push('OK');

      const choice = await vscode.window.showInformationMessage(
        `✓ Uploaded ${filesToUpload.length} file(s) to Google Drive in folder "${selectedCourse.name} / ${selectedCourseWork.title}".\n\n` +
          `ℹ️ Google Classroom Policy: Because this assignment was created by your teacher in the Classroom portal, Google requires students to turn in the assignment directly in Google Classroom.\n\n` +
          `Your files are ready in Drive! Click "Open in Classroom" to attach them and turn in.`,
        ...buttons,
      );

      if (choice === 'Open in Classroom' && classroomUrl) {
        void vscode.env.openExternal(vscode.Uri.parse(classroomUrl));
      } else if (choice === 'View in Drive' && pipelineResult.targetFolder.webViewLink) {
        void vscode.env.openExternal(vscode.Uri.parse(pipelineResult.targetFolder.webViewLink));
      }
      return;
    }

    const finalSubmission = pipelineResult.submission;
    logger.info(
      `Assignment ${courseworkId} turned in successfully. Late: ${Boolean(finalSubmission?.late)}`,
    );

    const openButton = finalSubmission?.alternateLink ? 'Open in Classroom' : undefined;
    const buttons = openButton ? [openButton, 'OK'] : ['OK'];

    if (finalSubmission?.late) {
      const choice = await vscode.window.showWarningMessage(
        `⚠️ Assignment turned in successfully (submitted after the due date).`,
        ...buttons,
      );
      if (choice === openButton && finalSubmission.alternateLink) {
        void vscode.env.openExternal(vscode.Uri.parse(finalSubmission.alternateLink));
      }
    } else {
      const choice = await vscode.window.showInformationMessage(
        `🎉 Successfully submitted "${selectedCourseWork.title}" to Google Classroom! (${filesToUpload.length} file(s) uploaded)`,
        ...buttons,
      );
      if (choice === openButton && finalSubmission?.alternateLink) {
        void vscode.env.openExternal(vscode.Uri.parse(finalSubmission.alternateLink));
      }
    }
  } catch (error) {
    logger.error('Submit Assignment command failed', error);

    if (error instanceof WorkspaceError) {
      if (error.code === 'NO_WORKSPACE') {
        const sel = await vscode.window.showErrorMessage(
          'Classroom Submit: ' + error.message,
          'Open Folder',
        );
        if (sel === 'Open Folder') {
          await vscode.commands.executeCommand('vscode.openFolder');
        }
      } else if (error.code !== 'CANCELLED') {
        await vscode.window.showErrorMessage(`Classroom Submit: ${error.message}`);
      }
    } else if (error instanceof AuthenticationError) {
      await vscode.window.showErrorMessage(`Authentication Error: ${error.message}`);
    } else if (error instanceof ClassroomApiError) {
      await vscode.window.showErrorMessage(`Google Classroom Error: ${error.message}`);
    } else if (error instanceof DriveApiError) {
      await vscode.window.showErrorMessage(
        `Google Drive Upload Error: ${error.message}. You can try submitting again or view status.`,
      );
    } else if (error instanceof SubmissionError) {
      if (error.code === 'PROJECT_PERMISSION_DENIED') {
        const choice = await vscode.window.showInformationMessage(
          `Google Classroom Developer Project Policy:\n` +
            `This assignment was created via the Google Classroom web portal. Google API allows programmatic modification and turn-in only for coursework created by the same Developer Console project.\n\n` +
            `Your files are safely saved in Google Drive.`,
          ...(alternateClassroomUrl ? ['Open in Classroom', 'OK'] : ['OK']),
        );
        if (choice === 'Open in Classroom' && alternateClassroomUrl) {
          void vscode.env.openExternal(vscode.Uri.parse(alternateClassroomUrl));
        }
      } else {
        await vscode.window.showErrorMessage(`Submission Error: ${error.message}`);
      }
    } else {
      await vscode.window.showErrorMessage(
        'Submission failed unexpectedly. Check the Classroom Submit output channel for details.',
      );
    }
  }
}
