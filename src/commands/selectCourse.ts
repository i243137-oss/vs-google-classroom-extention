import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { CoursePicker } from '../ui/CoursePicker.js';
import { ClassroomApiError, AuthenticationError } from '../errors/errors.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: Select Course
 *
 * Phase 5: Fetches courses from Google Classroom API and presents
 * an interactive QuickPick to select the active course.
 */
export async function selectCourseCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Select Course command invoked.');

  try {
    // 1. Verify authentication
    const isAuthed = await state.authService.isAuthenticated();
    if (!isAuthed) {
      const action = await vscode.window.showWarningMessage(
        'Classroom Submit: Please sign in with Google before selecting a course.',
        'Sign In',
        'Cancel',
      );
      if (action === 'Sign In') {
        await vscode.commands.executeCommand('classroomSubmit.signIn');
      }
      return;
    }

    // 2. Fetch courses with progress indicator
    const courses = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Classroom Submit',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Fetching Google Classroom courses…' });
        return state.classroomService.listCourses();
      },
    );

    // 3. Prompt user with QuickPick
    const picker = new CoursePicker();
    const selected = await picker.promptCourseSelection(courses);

    if (!selected) {
      logger.info('Course selection cancelled by user.');
      return;
    }

    // 4. Update extension state
    state.selectedCourseId = selected.id;
    state.selectedCourseWorkId = undefined; // Reset assignment for new course

    logger.info(`Course selected: ${selected.name} (${selected.id})`);
    await vscode.window.showInformationMessage(
      `✓ Selected course: ${selected.name}${selected.section ? ` (${selected.section})` : ''}`,
    );
  } catch (error) {
    logger.error('Select Course command failed', error);

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
        'Failed to retrieve courses. Check the Classroom Submit output channel for details.',
      );
    }
  }
}
