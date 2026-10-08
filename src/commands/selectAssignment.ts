import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: Select Assignment
 *
 * Phase 1: Placeholder.
 * Phase 6: Will show assignment list for the selected course.
 */
export async function selectAssignmentCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Select Assignment command invoked.');

  if (!state.isAuthenticated) {
    void vscode.window.showWarningMessage(
      'Classroom Submit: Please sign in first.',
    );
    return;
  }

  if (!state.selectedCourseId) {
    void vscode.window.showWarningMessage(
      'Classroom Submit: Please select a course first.',
    );
    return;
  }

  void vscode.window.showInformationMessage(
    '📝 Classroom Submit: Assignment selection will be implemented in Phase 6.',
  );
}
