import * as vscode from 'vscode';
import { ExtensionConfiguration } from '../types/index.js';
import { GoogleAuthService, GoogleAuthServiceImpl } from '../auth/GoogleAuthService.js';
import { ClassroomService } from '../classroom/ClassroomService.js';
import { SubmissionService } from '../submission/SubmissionService.js';

/**
 * Shared mutable state for the extension lifetime.
 *
 * Design: Passed by reference to all services/commands.
 * This avoids global singletons while still allowing services
 * to share state (e.g., cached auth status, selected course).
 */
export class ExtensionState {
  public readonly context: vscode.ExtensionContext;
  public readonly authService: GoogleAuthService;
  public readonly classroomService: ClassroomService;
  public readonly submissionService: SubmissionService;

  /** True once the user has successfully authenticated. */
  public isAuthenticated: boolean = false;

  /** The currently selected course ID (cached across commands). */
  public selectedCourseId: string | undefined = undefined;

  /** The currently selected coursework ID (cached across commands). */
  public selectedCourseWorkId: string | undefined = undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.authService = new GoogleAuthServiceImpl(
      context.secrets,
      () => {
        const cfg = this.getConfiguration();
        return {
          clientId: cfg.clientId,
          clientSecret: cfg.clientSecret,
          redirectUri: cfg.redirectUri,
        };
      },
    );
    this.classroomService = new ClassroomService(() => this.authService.getAccessToken());
    this.submissionService = new SubmissionService(() => this.authService.getAccessToken());
  }

  /** Read the current extension configuration from VS Code settings. */
  public getConfiguration(): ExtensionConfiguration {
    const cfg = vscode.workspace.getConfiguration('classroomSubmit');
    return {
      excludedDirectories: cfg.get<string[]>('excludedDirectories', [
        '.git', 'node_modules', '.venv', 'venv', '__pycache__',
        'dist', 'build', 'target', 'coverage', '.next', '.cache', 'out',
      ]),
      excludedFiles: cfg.get<string[]>('excludedFiles', [
        '.env', '*.vsix', '*.tsbuildinfo', '*.log',
      ]),
      maxFileSizeMb: cfg.get<number>('maxFileSizeMb', 50),
      confirmBeforeSubmit: cfg.get<boolean>('confirmBeforeSubmit', true),
      detectSecrets: cfg.get<boolean>('detectSecrets', true),
      showNotifications: cfg.get<boolean>('showNotifications', true),
      clientId: cfg.get<string>('clientId', ''),
      clientSecret: cfg.get<string>('clientSecret', ''),
      redirectUri: cfg.get<string>('redirectUri', 'http://localhost:5000/auth/google/callback'),
    };
  }
}
