import * as path from 'path';
import { minimatch } from 'minimatch';
import { WorkspaceFile } from '../types/index.js';
import { ExtensionConfiguration } from '../types/index.js';

/**
 * FileFilter
 *
 * Applies inclusion/exclusion rules to a flat list of WorkspaceFile entries.
 *
 * Two layers of filtering:
 * 1. Directory name exclusions (exact match) — applied during scanning by FileScanner.
 * 2. File glob pattern exclusions — applied here by FileFilter post-scan.
 *
 * This separation means FileScanner stays generic and FileFilter owns policy.
 */
export class FileFilter {
  private readonly excludedDirNames: ReadonlySet<string>;
  private readonly excludedGlobs: readonly string[];
  private readonly maxFileSizeBytes: number;

  constructor(config: Pick<ExtensionConfiguration, 'excludedDirectories' | 'excludedFiles' | 'maxFileSizeMb'>) {
    this.excludedDirNames = new Set(config.excludedDirectories);
    this.excludedGlobs = config.excludedFiles;
    this.maxFileSizeBytes = config.maxFileSizeMb * 1024 * 1024;
  }

  /**
   * Returns the set of excluded directory names for use by FileScanner.
   */
  public getExcludedDirNames(): ReadonlySet<string> {
    return this.excludedDirNames;
  }

  /**
   * Filters a list of WorkspaceFiles, removing:
   * - Files matching any excluded glob pattern
   * - Files exceeding the configured max size
   *
   * Note: directory-name exclusion is done by FileScanner before this runs.
   */
  public filter(files: WorkspaceFile[]): WorkspaceFile[] {
    return files.filter((file) => !this.shouldExclude(file));
  }

  /**
   * Returns whether a single WorkspaceFile should be excluded.
   */
  public shouldExclude(file: WorkspaceFile): boolean {
    if (file.isDirectory) {
      // Directories are passed through — they were already filtered by name in FileScanner
      return false;
    }

    // Glob pattern matching against basename and relative path
    const basename = path.basename(file.relativePath);
    for (const glob of this.excludedGlobs) {
      if (minimatch(basename, glob, { dot: true })) {
        return true;
      }
      if (minimatch(file.relativePath, glob, { dot: true, matchBase: true })) {
        return true;
      }
    }

    // Max size check
    if (file.size > this.maxFileSizeBytes) {
      return true;
    }

    return false;
  }

  /**
   * Returns the max file size in bytes for external use (e.g., UI warnings).
   */
  public getMaxFileSizeBytes(): number {
    return this.maxFileSizeBytes;
  }

  /**
   * Separates a list into included and excluded files for UI display.
   */
  public partition(files: WorkspaceFile[]): {
    included: WorkspaceFile[];
    excluded: WorkspaceFile[];
  } {
    const included: WorkspaceFile[] = [];
    const excluded: WorkspaceFile[] = [];

    for (const file of files) {
      if (this.shouldExclude(file)) {
        excluded.push(file);
      } else {
        included.push(file);
      }
    }

    return { included, excluded };
  }
}
