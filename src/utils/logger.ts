import * as vscode from 'vscode';

/**
 * Centralized logger for the extension.
 *
 * SECURITY: Never log OAuth tokens, refresh tokens, client secrets,
 * authorization codes, or private project file contents.
 *
 * Uses VS Code's OutputChannel for structured, user-inspectable logs.
 */
export class Logger {
  private static instance: Logger;
  private readonly outputChannel: vscode.OutputChannel;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Classroom Submit', {
      log: true,
    });
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public info(message: string): void {
    this.outputChannel.appendLine(`[INFO] ${new Date().toISOString()} ${message}`);
  }

  public warn(message: string): void {
    this.outputChannel.appendLine(`[WARN] ${new Date().toISOString()} ${message}`);
  }

  public error(message: string, error?: unknown): void {
    const errorDetail = this.sanitizeError(error);
    this.outputChannel.appendLine(
      `[ERROR] ${new Date().toISOString()} ${message}${errorDetail ? ` | ${errorDetail}` : ''}`,
    );
  }

  /**
   * Sanitize error messages to remove any credential-like strings
   * before logging. Strips common token patterns.
   */
  private sanitizeError(error: unknown): string | undefined {
    if (!error) {
      return undefined;
    }
    const raw = error instanceof Error ? error.message : String(error);
    // Strip anything that looks like a Bearer token or long base64 string
    return raw.replace(/Bearer [A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]')
              .replace(/[A-Za-z0-9]{40,}/g, '[REDACTED]');
  }

  public show(): void {
    this.outputChannel.show();
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }
}
