import * as fs from 'fs/promises';
import { Dir } from 'fs';
import * as path from 'path';
import { WorkspaceFile } from '../types/index.js';
import { WorkspaceError } from '../errors/errors.js';
import { Logger } from '../utils/logger.js';

/** Maximum directory depth to prevent infinite loops on circular symlinks. */
const MAX_DEPTH = 50;

/** Options controlling how a scan is performed. */
export interface ScanOptions {
  /** Absolute directory names to skip entirely (e.g. 'node_modules'). */
  excludedDirNames: ReadonlySet<string>;
  /** Maximum file size in bytes. Files larger than this are included in the list
   *  but flagged so the UI can warn the user. Pass Infinity to disable. */
  maxFileSizeBytes: number;
  /** Whether to follow symlinks (default false — avoids infinite loops). */
  followSymlinks?: boolean;
}

/**
 * FileScanner
 *
 * Recursively walks a directory tree using async iteration (no blocking I/O,
 * no reading file contents — only stat metadata).
 *
 * Design:
 * - Uses `fs.opendir` for lazy, memory-efficient directory traversal.
 * - Skips excluded directory names at the top level — never descends into them.
 * - Follows symlinks only when explicitly requested (off by default).
 * - Catches per-entry permission errors and logs them without aborting the scan.
 */
export class FileScanner {
  private readonly logger = Logger.getInstance();

  /**
   * Scan `rootPath` and yield every file (not directory) found,
   * subject to `options`.
   *
   * Yields `WorkspaceFile` objects — directories are represented as entries
   * with `isDirectory: true` ONLY at the first level so the UI can show them
   * as selectable units. Nested contents are returned as individual files.
   */
  public async scan(rootPath: string, options: ScanOptions): Promise<WorkspaceFile[]> {
    const results: WorkspaceFile[] = [];

    try {
      await fs.access(rootPath);
    } catch {
      throw new WorkspaceError(
        `Cannot access workspace root: ${rootPath}`,
        'WORKSPACE_NOT_ACCESSIBLE',
      );
    }

    await this.walkDir(rootPath, rootPath, options, results, 0, true);
    return results;
  }

  private async walkDir(
    rootPath: string,
    currentPath: string,
    options: ScanOptions,
    results: WorkspaceFile[],
    depth: number,
    isTopLevel: boolean,
  ): Promise<void> {
    if (depth > MAX_DEPTH) {
      this.logger.warn(`FileScanner: max depth reached at ${currentPath}, skipping.`);
      return;
    }

    let dir: Dir;
    try {
      dir = await fs.opendir(currentPath);
    } catch (err) {
      this.logger.warn(`FileScanner: cannot open directory ${currentPath}: ${String(err)}`);
      return;
    }

    try {
      for await (const entry of dir) {
        const entryPath = path.join(currentPath, entry.name);

        // Resolve symlinks if needed
        let stat: import('fs').Stats;
        try {
          stat = options.followSymlinks
            ? await fs.stat(entryPath)
            : await fs.lstat(entryPath);
        } catch (err) {
          this.logger.warn(`FileScanner: cannot stat ${entryPath}: ${String(err)}`);
          continue;
        }

        if (stat.isSymbolicLink() && !options.followSymlinks) {
          // Skip symlinks when not following them
          this.logger.info(`FileScanner: skipping symlink ${entryPath}`);
          continue;
        }

        if (stat.isDirectory()) {
          // Skip excluded directory names (exact match, not path match)
          if (options.excludedDirNames.has(entry.name)) {
            this.logger.info(`FileScanner: excluding directory ${entry.name}`);
            continue;
          }

          const relativePath = path.relative(rootPath, entryPath);

          if (isTopLevel) {
            // Emit the top-level directory itself as a selectable unit
            results.push({
              relativePath,
              absolutePath: entryPath,
              size: 0,
              isDirectory: true,
            });
          }

          // Recurse into subdirectory
          await this.walkDir(rootPath, entryPath, options, results, depth + 1, false);
        } else if (stat.isFile()) {
          const relativePath = path.relative(rootPath, entryPath);
          results.push({
            relativePath,
            absolutePath: entryPath,
            size: stat.size,
            isDirectory: false,
          });
        }
        // Ignore sockets, FIFOs, block/char devices, etc.
      }
    } finally {
      // dir.close() is idempotent — always called even on error
      try {
        await dir.close();
      } catch {
        // ignore close errors
      }
    }
  }
}
