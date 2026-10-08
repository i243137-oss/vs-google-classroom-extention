import * as vscode from 'vscode';
import { ExtensionState } from '../utils/extensionState.js';
import { signInCommand } from './signIn.js';
import { signOutCommand } from './signOut.js';
import { submitAssignmentCommand } from './submitAssignment.js';
import { selectCourseCommand } from './selectCourse.js';
import { selectAssignmentCommand } from './selectAssignment.js';
import { viewStatusCommand } from './viewStatus.js';

/**
 * Registers all extension commands and returns their Disposables.
 *
 * Command IDs must match exactly what is declared in package.json contributes.commands.
 * Using a dedicated registrar keeps extension.ts clean and makes testing easier.
 */
export function registerCommands(
  _context: vscode.ExtensionContext,
  state: ExtensionState,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('classroomSubmit.submitAssignment', () =>
      submitAssignmentCommand(state),
    ),
    vscode.commands.registerCommand('classroomSubmit.signIn', () =>
      signInCommand(state),
    ),
    vscode.commands.registerCommand('classroomSubmit.signOut', () =>
      signOutCommand(state),
    ),
    vscode.commands.registerCommand('classroomSubmit.selectCourse', () =>
      selectCourseCommand(state),
    ),
    vscode.commands.registerCommand('classroomSubmit.selectAssignment', () =>
      selectAssignmentCommand(state),
    ),
    vscode.commands.registerCommand('classroomSubmit.viewStatus', () =>
      viewStatusCommand(state),
    ),
  ];
}
