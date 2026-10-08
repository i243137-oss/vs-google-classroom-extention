import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { AuthenticationError } from '../errors/errors.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: Sign In
 *
 * Phase 1: Placeholder that shows a stub message.
 * Phase 4: Will be replaced with real OAuth 2.0 flow.
 */
export async function signInCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Sign In command invoked.');

  try {
    // Phase 4 will implement real OAuth here.
    // For now, show a clear placeholder.
    const config = state.getConfiguration();

    if (!config.clientId || !config.clientSecret) {
      void vscode.window.showWarningMessage(
        'Classroom Submit: OAuth credentials not configured. ' +
        'Please set classroomSubmit.clientId and classroomSubmit.clientSecret in VS Code settings.',
        'Open Settings',
      ).then((selection) => {
        if (selection === 'Open Settings') {
          void vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'classroomSubmit',
          );
        }
      });
      return;
    }

    void vscode.window.showInformationMessage(
      '🔐 Classroom Submit: Google Sign In will be implemented in Phase 4. ' +
      'The extension skeleton is working correctly.',
    );
  } catch (error) {
    logger.error('Sign In command failed', error);
    if (error instanceof AuthenticationError) {
      void vscode.window.showErrorMessage(`Sign In failed: ${error.message}`);
    } else {
      void vscode.window.showErrorMessage(
        'Sign In failed. Check the Classroom Submit output channel for details.',
      );
    }
  }
}
