import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { AssignmentPicker } from '../ui/AssignmentPicker.js';
import { ClassroomApiError, AuthenticationError } from '../errors/errors.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: Select Assignment
 *
 * Phase 6: Retrieves coursework for the selected course, displays
 * assignments with due dates and submission statuses, and saves user choice.
 */
export async function selectAssignmentCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Select Assignment command invoked.');

  try {
    // 1. Verify authentication
    const isAuthed = await state.authService.isAuthenticated();
    if (!isAuthed) {
      const action = await vscode.window.showWarningMessage(
        'Classroom Submit: Please sign in with Google before selecting an assignment.',
        'Sign In',
        'Cancel',
      );
      if (action === 'Sign In') {
        await vscode.commands.executeCommand('classroomSubmit.signIn');
      }
      return;
    }

    // 2. Ensure course is selected (Course ➔ Assignment flow)
    if (!state.selectedCourseId) {
      const pickCourseAction = await vscode.window.showInformationMessage(
        'Classroom Submit: No course selected yet. Please select a course first.',
        'Select Course',
        'Cancel',
      );
      if (pickCourseAction === 'Select Course') {
        await vscode.commands.executeCommand('classroomSubmit.selectCourse');
      }
      if (!state.selectedCourseId) {
        return;
      }
    }

    const courseId = state.selectedCourseId;

    // Fetch course details for title display
    let courseName: string | undefined;
    try {
      const course = await state.classroomService.getCourse(courseId);
      courseName = course.name;
    } catch {
      // Non-fatal, courseName remains undefined
    }

    // 3. Fetch assignments with submissions
    const assignments = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Classroom Submit',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Fetching assignments and submission statuses…' });
        return state.classroomService.listAssignmentsWithSubmissions(courseId);
      },
    );

    // 4. Prompt user with QuickPick
    const picker = new AssignmentPicker();
    const selected = await picker.promptAssignmentSelection(assignments, courseName);

    if (!selected) {
      logger.info('Assignment selection cancelled by user.');
      return;
    }

    // 5. Update state
    state.selectedCourseWorkId = selected.courseWork.id;
    logger.info(`Assignment selected: ${selected.courseWork.title} (${selected.courseWork.id})`);

    const summaryText =
      `✓ Selected Assignment: ${selected.courseWork.title}\n` +
      `Due: ${selected.formattedDue} | Status: ${selected.statusLabel}`;

    await vscode.window.showInformationMessage(summaryText.replace('\n', ' • '));
  } catch (error) {
    logger.error('Select Assignment command failed', error);

    if (error instanceof ClassroomApiError) {
      await vscode.window.showErrorMessage(`Google Classroom: ${error.message}`);
    } else if (error instanceof AuthenticationError) {
      const action = await vscode.window.showErrorMessage(
        `Authentication error: ${error.message}`,
        'Sign In Again',
      );
      if (action === 'Sign In Again') {
        await vscode.commands.executeCommand('classroomSubmit.signIn');
      }
    } else {
      await vscode.window.showErrorMessage(
        'Failed to retrieve assignments. Check the Classroom Submit output channel for details.',
      );
    }
  }
}
