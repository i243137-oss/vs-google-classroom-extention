import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { Logger } from '../utils/logger.js';
import { WorkspaceService } from '../workspace/WorkspaceService.js';
import { WorkspaceError } from '../errors/errors.js';

/**
 * Classroom: Submit Assignment
 *
 * Phase 2: Adds real workspace analysis after the auth check stub.
 * Phases 3+: Will add file selection UI, Classroom API, Drive upload, etc.
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

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Classroom Submit',
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: 'Analysing workspace…' });

        const analysis = await workspaceService.analyzeWorkspace(config, token);

        if (token.isCancellationRequested) {
          return;
        }

        const totalSizeStr = WorkspaceService.formatBytes(analysis.totalIncludedBytes);
        const fileCount = analysis.includedFiles.filter((f) => !f.isDirectory).length;

        // ── Phases 3–11 will add: file picker, course/assignment selection,
        //    upload, attach, turn-in. For now show analysis summary. ──────────
        void vscode.window.showInformationMessage(
          `📁 Workspace: ${analysis.folderName} | ` +
          `${fileCount} files | ${totalSizeStr} | ` +
          `${analysis.excludedFiles.length} excluded. ` +
          '(File selection UI comes in Phase 3)',
        );

        logger.info(
          `Workspace analysis: ${fileCount} files, ${totalSizeStr}, ` +
          `${analysis.excludedFiles.length} excluded.`,
        );
      },
    );
  } catch (error) {
    logger.error('Submit Assignment command failed', error);

    if (error instanceof WorkspaceError) {
      if (error.code === 'NO_WORKSPACE') {
        void vscode.window.showErrorMessage(
          'Classroom Submit: ' + error.message,
          'Open Folder',
        ).then((sel) => {
          if (sel === 'Open Folder') {
            void vscode.commands.executeCommand('vscode.openFolder');
          }
        });
      } else if (error.code !== 'CANCELLED') {
        void vscode.window.showErrorMessage(`Classroom Submit: ${error.message}`);
      }
    } else {
      void vscode.window.showErrorMessage(
        'Submission failed. Check the Classroom Submit output channel for details.',
      );
    }
  }
}
