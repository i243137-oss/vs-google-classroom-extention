import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { Logger } from '../utils/logger.js';
import { WorkspaceService } from '../workspace/WorkspaceService.js';
import { WorkspaceError } from '../errors/errors.js';
import { FilePicker } from '../ui/FilePicker.js';

/**
 * Classroom: Submit Assignment
 *
 * Phase 2: Workspace analysis.
 * Phase 3: Interactive File Selection UI + submission summary.
 * Phases 4+: Google OAuth, Courses, Assignments, Drive Upload, Turn In.
 */
export async function submitAssignmentCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Submit Assignment command invoked.');

  try {
    // ── Step 1: Check authentication ─────────────────────────────────────────
    if (!state.isAuthenticated) {
      const action = await vscode.window.showWarningMessage(
        'Classroom Submit: You need to sign in with Google before submitting.',
        'Sign In',
        'Cancel',
      );
      if (action === 'Sign In') {
        await vscode.commands.executeCommand('classroomSubmit.signIn');
      }
      return;
    }

    // ── Step 2: Analyse workspace (Phase 2) ───────────────────────────────────
    const config = state.getConfiguration();
    const workspaceService = new WorkspaceService();

    const analysis = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Classroom Submit',
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: 'Analysing workspace…' });
        return workspaceService.analyzeWorkspace(config, token);
      },
    );

    if (!analysis) {
      return;
    }

    // ── Step 3: Interactive File Selection UI (Phase 3) ───────────────────────
    const filePicker = new FilePicker();
    const selectionResult = await filePicker.promptFileSelection(analysis);

    if (!selectionResult) {
      await vscode.window.showInformationMessage('Classroom Submit: File selection cancelled.');
      return;
    }

    if (selectionResult.totalFiles === 0) {
      await vscode.window.showWarningMessage('Classroom Submit: No files selected for submission.');
      return;
    }

    // Show submission summary (per Phase 3 spec)
    const summaryMsg =
      `📋 Submission Summary:\n` +
      `Files: ${selectionResult.totalFiles}\n` +
      `Total size: ${selectionResult.formattedSize}\n` +
      `Excluded: ${selectionResult.excludedCount} files`;

    logger.info(summaryMsg.replace(/\n/g, ' | '));

    await vscode.window.showInformationMessage(
      `✓ Files selected: ${selectionResult.totalFiles} files (${selectionResult.formattedSize}) ready. ` +
      `(Google Drive upload and Classroom submission will be integrated in subsequent phases).`,
    );
  } catch (error) {
    logger.error('Submit Assignment command failed', error);

    if (error instanceof WorkspaceError) {
      if (error.code === 'NO_WORKSPACE') {
        const sel = await vscode.window.showErrorMessage(
          'Classroom Submit: ' + error.message,
          'Open Folder',
        );
        if (sel === 'Open Folder') {
          await vscode.commands.executeCommand('vscode.openFolder');
        }
      } else if (error.code !== 'CANCELLED') {
        await vscode.window.showErrorMessage(`Classroom Submit: ${error.message}`);
      }
    } else {
      await vscode.window.showErrorMessage(
        'Submission failed. Check the Classroom Submit output channel for details.',
      );
    }
  }
}
