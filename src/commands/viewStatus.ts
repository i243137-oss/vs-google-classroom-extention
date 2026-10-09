import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { SubmissionError, AuthenticationError } from '../errors/errors.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: View Submission Status
 *
 * Phase 7: Shows the student submission state from the Google Classroom API
 * for the currently selected course and assignment.
 */
export async function viewStatusCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('View Submission Status command invoked.');

  try {
    // 1. Verify authentication
    const isAuthed = await state.authService.isAuthenticated();
    if (!isAuthed) {
      const action = await vscode.window.showWarningMessage(
        'Classroom Submit: Please sign in with Google first.',
        'Sign In',
        'Cancel',
      );
      if (action === 'Sign In') {
        await vscode.commands.executeCommand('classroomSubmit.signIn');
      }
      return;
    }

    // 2. Verify selected course
    if (!state.selectedCourseId) {
      const action = await vscode.window.showInformationMessage(
        'Classroom Submit: Please select a course first.',
        'Select Course',
        'Cancel',
      );
      if (action === 'Select Course') {
        await vscode.commands.executeCommand('classroomSubmit.selectCourse');
      }
      return;
    }

    // 3. Verify selected assignment
    if (!state.selectedCourseWorkId) {
      const action = await vscode.window.showInformationMessage(
        'Classroom Submit: Please select an assignment first.',
        'Select Assignment',
        'Cancel',
      );
      if (action === 'Select Assignment') {
        await vscode.commands.executeCommand('classroomSubmit.selectAssignment');
      }
      return;
    }

    const courseId = state.selectedCourseId;
    const courseworkId = state.selectedCourseWorkId;

    // 4. Retrieve submission and metadata
    const { submission, course, coursework } = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Classroom Submit',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Fetching submission status from Google Classroom…' });

        const [sub, crs, cw] = await Promise.all([
          state.submissionService.getStudentSubmission(courseId, courseworkId),
          state.classroomService.getCourse(courseId).catch(() => undefined),
          state.classroomService.getCourseWork(courseId, courseworkId).catch(() => undefined),
        ]);

        return { submission: sub, course: crs, coursework: cw };
      },
    );

    const stateInfo = state.submissionService.determineSubmissionState(
      submission.state,
      submission.late,
    );

    const courseTitle = course?.name || 'Selected Course';
    const assignmentTitle = coursework?.title || 'Selected Assignment';

    const messageLines = [
      `📊 Assignment: ${assignmentTitle}`,
      `Course: ${courseTitle}`,
      `Status: ${stateInfo.label}`,
      `Details: ${stateInfo.description}`,
    ];

    if (submission.assignedGrade !== undefined) {
      messageLines.push(`Grade: ${submission.assignedGrade} pts`);
    }

    if (submission.attachments && submission.attachments.length > 0) {
      const count = submission.attachments.length;
      messageLines.push(`Attachments: ${count} file${count > 1 ? 's' : ''} attached`);
    }

    const buttons: string[] = [];
    if (submission.canReclaim) {
      buttons.push('Reclaim Submission');
    }
    if (submission.alternateLink) {
      buttons.push('Open in Browser');
    }
    buttons.push('OK');

    const choice = await vscode.window.showInformationMessage(
      messageLines.join('\n'),
      ...buttons,
    );

    if (choice === 'Reclaim Submission') {
      const confirmReclaim = await vscode.window.showWarningMessage(
        'Reclaiming will unsubmit your assignment in Google Classroom so you can make changes. Continue?',
        { modal: true },
        'Yes, Reclaim',
        'Cancel',
      );

      if (confirmReclaim === 'Yes, Reclaim') {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Classroom Submit — Reclaiming Assignment',
            cancellable: false,
          },
          async () => {
            await state.submissionService.reclaimSubmission(
              courseId,
              courseworkId,
              submission.submissionId,
            );
          },
        );

        await vscode.window.showInformationMessage(
          '✓ Submission reclaimed. You can now submit new files.',
        );
      }
    } else if (choice === 'Open in Browser' && submission.alternateLink) {
      void vscode.env.openExternal(vscode.Uri.parse(submission.alternateLink));
    }
  } catch (error) {
    logger.error('View Submission Status command failed', error);

    if (error instanceof SubmissionError) {
      await vscode.window.showErrorMessage(`Submission Error: ${error.message}`);
    } else if (error instanceof AuthenticationError) {
      await vscode.window.showErrorMessage(`Authentication Error: ${error.message}`);
    } else {
      await vscode.window.showErrorMessage(
        'Failed to check submission status. Check Classroom Submit output channel.',
      );
    }
  }
}
