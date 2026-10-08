import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: View Submission Status
 *
 * Phase 1: Placeholder.
 * Phase 7+: Will show the current submission state from the Classroom API.
 */
export async function viewStatusCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('View Submission Status command invoked.');

  if (!state.isAuthenticated) {
    void vscode.window.showWarningMessage(
      'Classroom Submit: Please sign in first.',
    );
    return;
  }

  void vscode.window.showInformationMessage(
    '📊 Classroom Submit: Submission status view will be implemented in Phase 7+.',
  );
}
