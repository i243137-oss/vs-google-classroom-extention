/**
 * Centralized logger for the extension.
 *
 * SECURITY: Never log OAuth tokens, refresh tokens, client secrets,
 * authorization codes, or private project file contents.
 *
 * Uses VS Code's OutputChannel for structured, user-inspectable logs.
 */
import * as vscode from 'vscode';

interface OutputChannelLike {
  appendLine(value: string): void;
  show(): void;
  dispose(): void;
}

export class Logger {
  private static instance: Logger;
  private readonly outputChannel: OutputChannelLike;

  private constructor() {
    try {
      this.outputChannel = vscode.window.createOutputChannel('Classroom Submit');
    } catch {
      // Fallback for standalone unit test environments where VS Code host is not present
      this.outputChannel = {
        appendLine: (): void => {},
        show: (): void => {},
        dispose: (): void => {},
      };
    }
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
    let raw = '';
    if (error instanceof Error) {
      raw = error.message;
      const cause = (error as { cause?: unknown }).cause;
      if (cause) {
        let causeStr = '';
        if (cause instanceof Error) {
          causeStr = `${cause.name}: ${cause.message}`;
        } else if (typeof cause === 'string') {
          causeStr = cause;
        } else {
          try {
            causeStr = JSON.stringify(cause);
          } catch {
            causeStr = '[Complex Object]';
          }
        }
        raw += ` (cause: ${causeStr})`;
      }
    } else if (typeof error === 'string') {
      raw = error;
    } else {
      try {
        raw = JSON.stringify(error);
      } catch {
        raw = '[Unserializable Error]';
      }
    }
    // Strip anything that looks like a Bearer token or long base64 string
    return raw
      .replace(/Bearer [A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]')
      .replace(/[A-Za-z0-9]{40,}/g, '[REDACTED]');
  }

  public show(): void {
    this.outputChannel.show();
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }
}

