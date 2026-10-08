import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: Select Course
 *
 * Phase 1: Placeholder.
 * Phase 5: Will show a QuickPick with real courses from Classroom API.
 */
export async function selectCourseCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Select Course command invoked.');

  if (!state.isAuthenticated) {
    void vscode.window.showWarningMessage(
      'Classroom Submit: Please sign in first.',
    );
    return;
  }

  void vscode.window.showInformationMessage(
    '📋 Classroom Submit: Course selection will be implemented in Phase 5.',
  );
}
