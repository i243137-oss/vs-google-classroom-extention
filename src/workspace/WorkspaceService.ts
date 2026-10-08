import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceFile } from '../types/index.js';
import { WorkspaceError } from '../errors/errors.js';
import { FileScanner } from './FileScanner.js';
import { FileFilter } from './FileFilter.js';
import { ExtensionConfiguration } from '../types/index.js';
import { Logger } from '../utils/logger.js';

/**
 * Result returned by WorkspaceService.analyzeWorkspace().
 * Contains both the full list (for the UI to show) and summary stats.
 */
export interface WorkspaceAnalysis {
  /** Root folder of the workspace being submitted. */
  rootPath: string;
  /** Display name (last path segment) of the workspace folder. */
  folderName: string;
  /** All files found (after directory-name exclusion by FileScanner). */
  allFiles: WorkspaceFile[];
  /** Files that pass the FileFilter (default submission set). */
  includedFiles: WorkspaceFile[];
  /** Files that are excluded by default (globs or size). */
  excludedFiles: WorkspaceFile[];
  /** Total size of included files in bytes. */
  totalIncludedBytes: number;
  /** Number of files exceeding the max-size threshold. */
  oversizedFileCount: number;
}

/**
 * WorkspaceService
 *
 * Entry point for all workspace/project analysis.
 *
 * Responsibilities:
 * - Detect the currently open workspace folder(s)
 * - Coordinate FileScanner + FileFilter to produce a WorkspaceAnalysis
 * - Handle: no workspace, multi-root workspace, empty workspace
 *
 * Does NOT upload anything. Does NOT read file contents.
 */
export class WorkspaceService {
  private readonly scanner = new FileScanner();
  private readonly logger = Logger.getInstance();

  /**
   * Returns the workspace folder to submit from.
   *
   * Multi-root: prompts the user to pick one.
   * Single-root: returns it directly.
   * No workspace: throws WorkspaceError.
   */
  public async getWorkspaceRoot(): Promise<vscode.WorkspaceFolder> {
    const folders = vscode.workspace.workspaceFolders;

    if (!folders || folders.length === 0) {
      throw new WorkspaceError(
        'No folder is open in VS Code. Please open your project folder before submitting.',
        'NO_WORKSPACE',
      );
    }

    if (folders.length === 1) {
      return folders[0];
    }

    // Multi-root: let the user choose which folder to submit
    const picks = folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    }));

    const selected = await vscode.window.showQuickPick(picks, {
      title: 'Classroom Submit — Select Project Folder',
      placeHolder: 'Which folder do you want to submit?',
      ignoreFocusOut: true,
    });

    if (!selected) {
      throw new WorkspaceError(
        'No folder selected. Submission cancelled.',
        'NO_FOLDER_SELECTED',
      );
    }

    return selected.folder;
  }

  /**
   * Analyses the workspace: scans files and partitions them into
   * included / excluded sets based on the current configuration.
   *
   * Progress is reported through the VS Code progress API.
   */
  public async analyzeWorkspace(
    config: ExtensionConfiguration,
    token?: vscode.CancellationToken,
  ): Promise<WorkspaceAnalysis> {
    const workspaceFolder = await this.getWorkspaceRoot();
    const rootPath = workspaceFolder.uri.fsPath;
    const folderName = path.basename(rootPath);

    this.logger.info(`WorkspaceService: analysing ${rootPath}`);

    const filter = new FileFilter(config);

    // Bail early if cancelled
    if (token?.isCancellationRequested) {
      throw new WorkspaceError('Workspace analysis cancelled.', 'CANCELLED');
    }

    // Scan the directory tree
    const allFiles = await this.scanner.scan(rootPath, {
      excludedDirNames: filter.getExcludedDirNames(),
      maxFileSizeBytes: filter.getMaxFileSizeBytes(),
      followSymlinks: false,
    });

    if (token?.isCancellationRequested) {
      throw new WorkspaceError('Workspace analysis cancelled.', 'CANCELLED');
    }

    // Partition into included / excluded
    const { included, excluded } = filter.partition(allFiles);

    const totalIncludedBytes = included
      .filter((f) => !f.isDirectory)
      .reduce((sum, f) => sum + f.size, 0);

    const maxBytes = filter.getMaxFileSizeBytes();
    const oversizedFileCount = allFiles.filter(
      (f) => !f.isDirectory && f.size > maxBytes,
    ).length;

    this.logger.info(
      `WorkspaceService: found ${allFiles.length} entries, ` +
      `${included.length} included, ${excluded.length} excluded.`,
    );

    return {
      rootPath,
      folderName,
      allFiles,
      includedFiles: included,
      excludedFiles: excluded,
      totalIncludedBytes,
      oversizedFileCount,
    };
  }

  /**
   * Human-readable file size string (e.g. "1.8 MB", "240 KB").
   */
  public static formatBytes(bytes: number): string {
    if (bytes === 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const clamped = Math.min(i, units.length - 1);
    return `${(bytes / Math.pow(1024, clamped)).toFixed(1)} ${units[clamped]}`;
  }
}
