import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: Sign Out
 *
 * Clears stored tokens from SecretStorage, revokes tokens, and resets auth state.
 */
export async function signOutCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Sign Out command invoked.');

  try {
    const isAuthed = await state.authService.isAuthenticated();
    if (!isAuthed && !state.isAuthenticated) {
      await vscode.window.showInformationMessage(
        'Classroom Submit: You are not currently signed in.',
      );
      return;
    }

    await state.authService.signOut();

    state.isAuthenticated = false;
    state.selectedCourseId = undefined;
    state.selectedCourseWorkId = undefined;

    await vscode.window.showInformationMessage(
      '✓ Classroom Submit: Signed out successfully. Google credentials removed.',
    );
  } catch (error) {
    logger.error('Sign Out command failed', error);
    await vscode.window.showErrorMessage(
      'Sign Out failed. Check the Classroom Submit output channel for details.',
    );
  }
}
