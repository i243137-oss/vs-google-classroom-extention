import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: Configure Google OAuth Credentials
 *
 * Interactive command to set or update Google Cloud OAuth credentials.
 */
export async function configureCredentialsCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Configure Credentials command invoked.');

  const config = state.getConfiguration();

  const clientId = await vscode.window.showInputBox({
    title: 'Classroom Submit — Google OAuth Client ID',
    prompt: 'Enter your OAuth 2.0 Client ID from Google Cloud Console',
    placeHolder: 'xxxxxxxxxxxx-xxxxxxxx.apps.googleusercontent.com',
    value: config.clientId,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Client ID is required';
      }
      return null;
    },
  });

  if (clientId === undefined) {
    return; // User cancelled
  }

  const clientSecret = await vscode.window.showInputBox({
    title: 'Classroom Submit — Google OAuth Client Secret',
    prompt: 'Enter your OAuth 2.0 Client Secret from Google Cloud Console',
    password: true,
    value: config.clientSecret,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Client Secret is required';
      }
      return null;
    },
  });

  if (clientSecret === undefined) {
    return; // User cancelled
  }

  const cfg = vscode.workspace.getConfiguration('classroomSubmit');
  await cfg.update('clientId', clientId.trim(), vscode.ConfigurationTarget.Global);
  await cfg.update('clientSecret', clientSecret.trim(), vscode.ConfigurationTarget.Global);

  logger.info('Google OAuth Client ID and Secret updated in settings.');

  const action = await vscode.window.showInformationMessage(
    '✓ Google OAuth credentials saved successfully.',
    'Sign In Now',
    'Dismiss',
  );

  if (action === 'Sign In Now') {
    await vscode.commands.executeCommand('classroomSubmit.signIn');
  }
}
