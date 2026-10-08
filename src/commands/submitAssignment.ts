import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { Logger } from '../utils/logger.js';

/**
 * Classroom: Submit Assignment
 *
 * This is the PRIMARY command — the full submission workflow.
 *
 * Phase 1: Shows a placeholder with the planned workflow steps.
 * Phases 2–11: Each phase wires in the real implementation step by step.
 *
 * Final flow (after all phases):
 *   Check auth → Select course → Select assignment → Analyze workspace
 *   → Select files → Validate → Confirm → Upload → Attach → Turn in → Result
 */
export async function submitAssignmentCommand(state: ExtensionState): Promise<void> {
  const logger = Logger.getInstance();
  logger.info('Submit Assignment command invoked.');

  try {
    // ── Step 1: Check authentication ──────────────────────────────────────────
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

    // ── Phases 2–11 will add the remaining steps here ─────────────────────────
    void vscode.window.showInformationMessage(
      '📚 Classroom Submit: Extension skeleton is working! ' +
      'Full submission workflow will be implemented in Phases 2–11.',
    );
  } catch (error) {
    logger.error('Submit Assignment command failed', error);
    void vscode.window.showErrorMessage(
      'Submission failed. Check the Classroom Submit output channel for details.',
    );
  }
}
