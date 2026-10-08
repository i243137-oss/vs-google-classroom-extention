import * as vscode from 'vscode';
import { registerCommands } from './commands/index.js';
import { ExtensionState } from './utils/extensionState.js';
import { Logger } from './utils/logger.js';

/**
 * Called when the extension is first activated.
 * Activation events are configured in package.json (onStartupFinished).
 */
export function activate(context: vscode.ExtensionContext): void {
  const logger = Logger.getInstance();
  logger.info('Classroom Submit extension activating…');

  // Initialize shared extension state
  const state = new ExtensionState(context);

  // Register all commands
  const disposables = registerCommands(context, state);
  context.subscriptions.push(...disposables);

  logger.info('Classroom Submit extension activated successfully.');
}

/**
 * Called when the extension is deactivated (VS Code shutdown or extension disable).
 * Clean up any resources here.
 */
export function deactivate(): void {
  Logger.getInstance().info('Classroom Submit extension deactivated.');
}
