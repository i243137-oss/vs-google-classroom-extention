import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { AuthenticationError } from '../errors/errors.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: Sign In
 *
 * Implements real OAuth 2.0 PKCE sign in flow using GoogleAuthService.
 */
export async function signInCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Sign In command invoked.');

  try {
    const config = state.getConfiguration();

    // Check credentials presence
    if (!config.clientId || !config.clientSecret) {
      const selection = await vscode.window.showWarningMessage(
        'Classroom Submit: Google OAuth credentials not configured. ' +
        'Please configure your Client ID and Client Secret.',
        'Configure Credentials',
        'Open Settings',
      );

      if (selection === 'Configure Credentials') {
        await vscode.commands.executeCommand('classroomSubmit.configureCredentials');
      } else if (selection === 'Open Settings') {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'classroomSubmit',
        );
      }
      return;
    }

    // Check if already authenticated
    const alreadyAuthed = await state.authService.isAuthenticated();
    if (alreadyAuthed) {
      const userInfo = await state.authService.getUserInfo();
      const userText = userInfo?.email ? ` (${userInfo.email})` : '';
      const choice = await vscode.window.showInformationMessage(
        `Classroom Submit: You are already signed in${userText}.`,
        'Sign In Again',
        'OK',
      );
      if (choice !== 'Sign In Again') {
        state.isAuthenticated = true;
        return;
      }
    }

    // Run OAuth flow with progress notification
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Classroom Submit — Google Sign In',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Waiting for browser authorization…' });
        await state.authService.signIn();
      },
    );

    state.isAuthenticated = true;
    const profile = await state.authService.getUserInfo();
    const accountLabel = profile?.email || 'Google Account';

    await vscode.window.showInformationMessage(
      `✓ Classroom Submit: Signed in successfully as ${accountLabel}.`,
    );
  } catch (error) {
    logger.error('Sign In command failed', error);

    if (error instanceof AuthenticationError) {
      if (error.code === 'USER_CANCELLED') {
        await vscode.window.showWarningMessage('Classroom Submit: Google sign-in was cancelled.');
      } else if (error.code === 'PORT_IN_USE') {
        await vscode.window.showErrorMessage(
          'Classroom Submit: Port 5000 is already in use by another application. Please free port 5000 and try again.',
        );
      } else {
        await vscode.window.showErrorMessage(`Classroom Submit: Sign-in failed (${error.message}).`);
      }
    } else {
      await vscode.window.showErrorMessage(
        'Classroom Submit: Sign-in failed. Check the Classroom Submit output channel for details.',
      );
    }
  }
}
