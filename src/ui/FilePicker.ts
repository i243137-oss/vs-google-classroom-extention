import * as vscode from 'vscode';
import { WorkspaceFile, FileSelectionResult } from '../types/index.js';
import { WorkspaceAnalysis, WorkspaceService } from '../workspace/WorkspaceService.js';
import { WorkspaceError } from '../errors/errors.js';
import { Logger } from '../utils/logger.js';

/**
 * Item structure for the File Selection QuickPick.
 */
export interface FileQuickPickItem extends vscode.QuickPickItem {
  /** The underlying workspace entry. */
  workspaceFile: WorkspaceFile;
  /** Whether this item is pre-selected by default. */
  picked: boolean;
}

/**
 * FileSelectionManager
 *
 * Pure selection logic separated from VS Code UI widgets.
 * Handles:
 * - Converting WorkspaceAnalysis into QuickPick items.
 * - Resolving selections (including directory cascades).
 * - Generating submission metrics (file count, total size, excluded count).
 */
export class FileSelectionManager {
  /**
   * Builds the QuickPick items from the workspace analysis.
   * Default inclusion rules:
   * - Top-level directories that contain any included files start checked.
   * - Files that passed FileFilter start checked.
   * - Files/directories excluded by default start unchecked.
   */
  public static createQuickPickItems(analysis: WorkspaceAnalysis): FileQuickPickItem[] {
    const includedSet = new Set(analysis.includedFiles.map((f) => f.relativePath));
    const items: FileQuickPickItem[] = [];

    // Separate top-level directories and files
    const topDirs = analysis.allFiles.filter((f) => f.isDirectory);
    const files = analysis.allFiles.filter((f) => !f.isDirectory);

    // Add directory items first
    for (const dir of topDirs) {
      const dirPrefix = dir.relativePath.endsWith('/') ? dir.relativePath : `${dir.relativePath}/`;
      const hasIncludedChildren = files.some(
        (f) => f.relativePath.startsWith(dirPrefix) && includedSet.has(f.relativePath),
      );
      const childCount = files.filter((f) => f.relativePath.startsWith(dirPrefix)).length;

      items.push({
        label: `$(folder) ${dir.relativePath}/`,
        description: `(${childCount} files)`,
        detail: hasIncludedChildren ? 'Folder included by default' : 'Folder excluded by default',
        picked: hasIncludedChildren,
        workspaceFile: dir,
      });
    }

    // Add individual files
    for (const file of files) {
      const isIncluded = includedSet.has(file.relativePath);
      const sizeStr = WorkspaceService.formatBytes(file.size);

      const fileItem: FileQuickPickItem = {
        label: `$(file) ${file.relativePath}`,
        description: sizeStr,
        picked: isIncluded,
        workspaceFile: file,
      };

      if (!isIncluded) {
        fileItem.detail = 'Excluded by default rule or size limit';
      }

      items.push(fileItem);
    }

    return items;
  }

  /**
   * Resolves the selected items into a final set of uploadable files.
   * - If a directory item is selected, all files belonging to that directory are included.
   * - If an individual file item is selected, it is included.
   * - Deduplicates items.
   * - Excludes directories from the final file list (only uploadable files are returned).
   */
  public static resolveSelection(
    selectedItems: readonly FileQuickPickItem[],
    allFiles: WorkspaceFile[],
  ): FileSelectionResult {
    const nonDirFiles = allFiles.filter((f) => !f.isDirectory);
    const selectedRelativePaths = new Set<string>();

    const selectedDirs: string[] = [];
    for (const item of selectedItems) {
      if (item.workspaceFile.isDirectory) {
        const prefix = item.workspaceFile.relativePath.endsWith('/')
          ? item.workspaceFile.relativePath
          : `${item.workspaceFile.relativePath}/`;
        selectedDirs.push(prefix);
      } else {
        selectedRelativePaths.add(item.workspaceFile.relativePath);
      }
    }

    // If a directory was selected, include all its files
    for (const dirPrefix of selectedDirs) {
      for (const file of nonDirFiles) {
        if (file.relativePath.startsWith(dirPrefix)) {
          selectedRelativePaths.add(file.relativePath);
        }
      }
    }

    const finalFiles = nonDirFiles.filter((f) => selectedRelativePaths.has(f.relativePath));
    const totalBytes = finalFiles.reduce((sum, f) => sum + f.size, 0);
    const excludedCount = nonDirFiles.length - finalFiles.length;

    return {
      selectedFiles: finalFiles,
      totalBytes,
      totalFiles: finalFiles.length,
      excludedCount,
      formattedSize: WorkspaceService.formatBytes(totalBytes),
    };
  }
}

/**
 * FilePicker
 *
 * Provides the interactive file selection UI using VS Code QuickPick.
 */
export class FilePicker {
  private readonly logger = Logger.getInstance();

  /**
   * Prompts the user to select files for submission.
   * Returns the resolved FileSelectionResult or undefined if cancelled.
   */
  public async promptFileSelection(
    analysis: WorkspaceAnalysis,
  ): Promise<FileSelectionResult | undefined> {
    const quickPick = vscode.window.createQuickPick<FileQuickPickItem>();
    const items = FileSelectionManager.createQuickPickItems(analysis);

    quickPick.title = `Classroom Submit — Select Files (${analysis.folderName})`;
    quickPick.placeholder = 'Select files and folders to submit. Check/uncheck items, then press Enter or OK.';
    quickPick.canSelectMany = true;
    quickPick.ignoreFocusOut = true;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.items = items;
    quickPick.selectedItems = items.filter((item) => item.picked);

    return new Promise<FileSelectionResult | undefined>((resolve) => {
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems;
        quickPick.hide();

        if (selected.length === 0) {
          resolve(undefined);
          return;
        }

        const result = FileSelectionManager.resolveSelection(selected, analysis.allFiles);
        this.logger.info(
          `FilePicker: User selected ${result.totalFiles} files (${result.formattedSize}), ` +
          `${result.excludedCount} excluded.`,
        );
        resolve(result);
      });

      quickPick.onDidHide(() => {
        quickPick.dispose();
        resolve(undefined);
      });

      quickPick.show();
    });
  }

  /**
   * Displays a summary confirmation dialog before submission.
   * Returns true if user confirmed, false if cancelled.
   */
  public async confirmSelectionSummary(
    summary: FileSelectionResult,
    folderName: string,
  ): Promise<boolean> {
    if (summary.totalFiles === 0) {
      throw new WorkspaceError(
        'No files were selected for submission. Please select at least one file.',
        'NO_FILES_SELECTED',
      );
    }

    const message =
      `📁 Ready to submit ${summary.totalFiles} files (${summary.formattedSize})\n` +
      `Project: ${folderName}\n` +
      `Excluded files: ${summary.excludedCount}`;

    const choice = await vscode.window.showInformationMessage(
      message,
      { modal: true },
      'Proceed to Submit',
      'Review Files',
      'Cancel',
    );

    if (choice === 'Proceed to Submit') {
      return true;
    }

    return false;
  }
}
