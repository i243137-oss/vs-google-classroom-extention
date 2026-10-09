import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: Sign Out
 *
 * Phase 1: Placeholder.
 * Phase 4: Will clear SecretStorage tokens and reset auth state.
 */
export async function signOutCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Sign Out command invoked.');

  try {
    if (!state.isAuthenticated) {
      await vscode.window.showInformationMessage(
        'Classroom Submit: You are not currently signed in.',
      );
      return;
    }

    // Phase 4 will implement real token revocation and SecretStorage cleanup here.
    state.isAuthenticated = false;
    state.selectedCourseId = undefined;
    state.selectedCourseWorkId = undefined;

    await vscode.window.showInformationMessage(
      '✓ Classroom Submit: Signed out successfully. ' +
      '(Phase 4 will revoke Google tokens.)',
    );
  } catch (error) {
    logger.error('Sign Out command failed', error);
    await vscode.window.showErrorMessage(
      'Sign Out failed. Check the Classroom Submit output channel for details.',
    );
  }
}
