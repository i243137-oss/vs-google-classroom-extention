import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileScanner } from '../../src/workspace/FileScanner.js';
import { FileFilter } from '../../src/workspace/FileFilter.js';
import { WorkspaceService } from '../../src/workspace/WorkspaceService.js';

/**
 * Phase 2 — Workspace & File Discovery Tests
 *
 * These tests run as pure Node.js (no VS Code host required)
 * because FileScanner and FileFilter have no VS Code dependencies.
 * WorkspaceService tests mock the VS Code API parts.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

async function rmdir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

const DEFAULT_CONFIG = {
  excludedDirectories: ['.git', 'node_modules', '__pycache__', 'dist', '.venv', 'venv'],
  excludedFiles: ['.env', '*.log', '*.vsix'],
  maxFileSizeMb: 50,
};

// ─── FileScanner Tests ────────────────────────────────────────────────────────

suite('Phase 2 — FileScanner', () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = await createTempDir('cls-scan-');
  });

  teardown(async () => {
    await rmdir(tmpDir);
  });

  test('scans a simple flat directory', async () => {
    await writeFile(tmpDir, 'main.py', 'print("hello")');
    await writeFile(tmpDir, 'README.md', '# Project');
    await writeFile(tmpDir, 'requirements.txt', 'flask');

    const scanner = new FileScanner();
    const filter = new FileFilter(DEFAULT_CONFIG);
    const results = await scanner.scan(tmpDir, {
      excludedDirNames: filter.getExcludedDirNames(),
      maxFileSizeBytes: filter.getMaxFileSizeBytes(),
    });

    const files = results.filter((r) => !r.isDirectory);
    assert.strictEqual(files.length, 3, 'Should find 3 files');
    const names = files.map((f) => f.relativePath).sort();
    assert.deepStrictEqual(names, ['README.md', 'main.py', 'requirements.txt']);
  });

  test('scans nested directories and returns files', async () => {
    await writeFile(tmpDir, 'src/app.py', '# app');
    await writeFile(tmpDir, 'src/utils/helper.py', '# helper');
    await writeFile(tmpDir, 'tests/test_app.py', '# test');
    await writeFile(tmpDir, 'README.md', '# Project');

    const scanner = new FileScanner();
    const filter = new FileFilter(DEFAULT_CONFIG);
    const results = await scanner.scan(tmpDir, {
      excludedDirNames: filter.getExcludedDirNames(),
      maxFileSizeBytes: filter.getMaxFileSizeBytes(),
    });

    const files = results.filter((r) => !r.isDirectory);
    assert.strictEqual(files.length, 4, 'Should find 4 files including nested ones');
  });

  test('emits top-level directories as selectable units', async () => {
    await writeFile(tmpDir, 'src/main.py', '# main');
    await writeFile(tmpDir, 'tests/test_main.py', '# test');

    const scanner = new FileScanner();
    const filter = new FileFilter(DEFAULT_CONFIG);
    const results = await scanner.scan(tmpDir, {
      excludedDirNames: filter.getExcludedDirNames(),
      maxFileSizeBytes: filter.getMaxFileSizeBytes(),
    });

    const dirs = results.filter((r) => r.isDirectory);
    const dirNames = dirs.map((d) => d.relativePath).sort();
    assert.deepStrictEqual(dirNames, ['src', 'tests'], 'Top-level dirs should be emitted');
  });

  test('excludes node_modules directory', async () => {
    await writeFile(tmpDir, 'index.js', 'console.log("hi")');
    await writeFile(tmpDir, 'node_modules/lodash/index.js', '// lodash');

    const scanner = new FileScanner();
    const filter = new FileFilter(DEFAULT_CONFIG);
    const results = await scanner.scan(tmpDir, {
      excludedDirNames: filter.getExcludedDirNames(),
      maxFileSizeBytes: filter.getMaxFileSizeBytes(),
    });

    const paths = results.map((r) => r.relativePath);
    const hasNodeModules = paths.some((p) => p.includes('node_modules'));
    assert.ok(!hasNodeModules, 'node_modules should be excluded');
  });

  test('excludes .git directory', async () => {
    await writeFile(tmpDir, 'main.py', '# main');
    await writeFile(tmpDir, '.git/config', '[core]');

    const scanner = new FileScanner();
    const filter = new FileFilter(DEFAULT_CONFIG);
    const results = await scanner.scan(tmpDir, {
      excludedDirNames: filter.getExcludedDirNames(),
      maxFileSizeBytes: filter.getMaxFileSizeBytes(),
    });

    const paths = results.map((r) => r.relativePath);
    const hasGit = paths.some((p) => p.startsWith('.git'));
    assert.ok(!hasGit, '.git should be excluded');
  });

  test('handles an empty workspace', async () => {
    const scanner = new FileScanner();
    const filter = new FileFilter(DEFAULT_CONFIG);
    const results = await scanner.scan(tmpDir, {
      excludedDirNames: filter.getExcludedDirNames(),
      maxFileSizeBytes: filter.getMaxFileSizeBytes(),
    });

    assert.strictEqual(results.length, 0, 'Empty workspace should return no files');
  });

  test('records correct file sizes', async () => {
    const content = 'x'.repeat(1024); // exactly 1024 bytes
    await writeFile(tmpDir, 'big.txt', content);

    const scanner = new FileScanner();
    const filter = new FileFilter(DEFAULT_CONFIG);
    const results = await scanner.scan(tmpDir, {
      excludedDirNames: filter.getExcludedDirNames(),
      maxFileSizeBytes: filter.getMaxFileSizeBytes(),
    });

    const bigFile = results.find((f) => f.relativePath === 'big.txt');
    assert.ok(bigFile, 'big.txt should be found');
    assert.strictEqual(bigFile!.size, 1024, 'File size should be 1024 bytes');
  });

  test('returns absolutePath correctly', async () => {
    await writeFile(tmpDir, 'hello.py', '# hello');

    const scanner = new FileScanner();
    const filter = new FileFilter(DEFAULT_CONFIG);
    const results = await scanner.scan(tmpDir, {
      excludedDirNames: filter.getExcludedDirNames(),
      maxFileSizeBytes: filter.getMaxFileSizeBytes(),
    });

    const file = results.find((f) => f.relativePath === 'hello.py');
    assert.ok(file, 'hello.py should be found');
    assert.strictEqual(
      file!.absolutePath,
      path.join(tmpDir, 'hello.py'),
      'absolutePath should be the full path',
    );
  });

  test('throws WorkspaceError for non-existent root path', async () => {
    const scanner = new FileScanner();
    const filter = new FileFilter(DEFAULT_CONFIG);
    const fakePath = path.join(tmpDir, 'does-not-exist');

    await assert.rejects(
      () => scanner.scan(fakePath, {
        excludedDirNames: filter.getExcludedDirNames(),
        maxFileSizeBytes: filter.getMaxFileSizeBytes(),
      }),
      (err: Error) => {
        assert.ok(err.name === 'WorkspaceError', `Expected WorkspaceError, got ${err.name}`);
        return true;
      },
    );
  });

  test('handles multiple excluded directories', async () => {
    await writeFile(tmpDir, 'src/main.py', '# src');
    await writeFile(tmpDir, '__pycache__/main.cpython-311.pyc', '# cache');
    await writeFile(tmpDir, 'dist/bundle.js', '# bundle');
    await writeFile(tmpDir, '.venv/bin/python', '# python');

    const scanner = new FileScanner();
    const filter = new FileFilter(DEFAULT_CONFIG);
    const results = await scanner.scan(tmpDir, {
      excludedDirNames: filter.getExcludedDirNames(),
      maxFileSizeBytes: filter.getMaxFileSizeBytes(),
    });

    const paths = results.map((r) => r.relativePath);
    assert.ok(!paths.some((p) => p.includes('__pycache__')), '__pycache__ excluded');
    assert.ok(!paths.some((p) => p.includes('dist')), 'dist excluded');
    assert.ok(!paths.some((p) => p.includes('.venv')), '.venv excluded');
    assert.ok(paths.some((p) => p.includes('main.py')), 'src/main.py included');
  });
});

// ─── FileFilter Tests ─────────────────────────────────────────────────────────

suite('Phase 2 — FileFilter', () => {
  function makeFile(relativePath: string, size = 0): import('../../src/types/index.js').WorkspaceFile {
    return { relativePath, absolutePath: `/root/${relativePath}`, size, isDirectory: false };
  }

  test('excludes .env files by glob', () => {
    const filter = new FileFilter(DEFAULT_CONFIG);
    const file = makeFile('.env');
    assert.ok(filter.shouldExclude(file), '.env should be excluded');
  });

  test('excludes *.log files by glob', () => {
    const filter = new FileFilter(DEFAULT_CONFIG);
    assert.ok(filter.shouldExclude(makeFile('app.log')), 'app.log should be excluded');
    assert.ok(filter.shouldExclude(makeFile('logs/error.log')), 'logs/error.log should be excluded');
  });

  test('excludes *.vsix files by glob', () => {
    const filter = new FileFilter(DEFAULT_CONFIG);
    assert.ok(filter.shouldExclude(makeFile('extension.vsix')), '*.vsix should be excluded');
  });

  test('includes normal source files', () => {
    const filter = new FileFilter(DEFAULT_CONFIG);
    assert.ok(!filter.shouldExclude(makeFile('main.py')), 'main.py should be included');
    assert.ok(!filter.shouldExclude(makeFile('src/app.ts')), 'src/app.ts should be included');
    assert.ok(!filter.shouldExclude(makeFile('README.md')), 'README.md should be included');
  });

  test('excludes files exceeding maxFileSizeMb', () => {
    const filter = new FileFilter({ ...DEFAULT_CONFIG, maxFileSizeMb: 1 });
    const bigFile = makeFile('data.bin', 2 * 1024 * 1024); // 2 MB
    assert.ok(filter.shouldExclude(bigFile), '2MB file should be excluded with 1MB limit');
  });

  test('includes files exactly at maxFileSizeMb', () => {
    const filter = new FileFilter({ ...DEFAULT_CONFIG, maxFileSizeMb: 1 });
    const exactFile = makeFile('data.bin', 1 * 1024 * 1024); // exactly 1 MB
    assert.ok(!filter.shouldExclude(exactFile), 'File at exact limit should be included');
  });

  test('partition() correctly splits included and excluded', () => {
    const filter = new FileFilter(DEFAULT_CONFIG);
    const files = [
      makeFile('main.py'),
      makeFile('.env'),
      makeFile('app.log'),
      makeFile('README.md'),
    ];

    const { included, excluded } = filter.partition(files);
    assert.strictEqual(included.length, 2, 'Should have 2 included files');
    assert.strictEqual(excluded.length, 2, 'Should have 2 excluded files');
    assert.ok(included.some((f) => f.relativePath === 'main.py'));
    assert.ok(included.some((f) => f.relativePath === 'README.md'));
    assert.ok(excluded.some((f) => f.relativePath === '.env'));
    assert.ok(excluded.some((f) => f.relativePath === 'app.log'));
  });

  test('filter() returns only included files', () => {
    const filter = new FileFilter(DEFAULT_CONFIG);
    const files = [makeFile('main.py'), makeFile('.env'), makeFile('src/utils.py')];
    const result = filter.filter(files);
    assert.strictEqual(result.length, 2);
    assert.ok(!result.some((f) => f.relativePath === '.env'));
  });

  test('passes directories through (dirs filtered by name, not glob)', () => {
    const filter = new FileFilter(DEFAULT_CONFIG);
    const dir = { relativePath: 'src', absolutePath: '/root/src', size: 0, isDirectory: true };
    assert.ok(!filter.shouldExclude(dir), 'Directories should pass through FileFilter');
  });
});

// ─── WorkspaceService.formatBytes Tests ──────────────────────────────────────

suite('Phase 2 — WorkspaceService.formatBytes', () => {
  test('formats 0 bytes', () => {
    assert.strictEqual(WorkspaceService.formatBytes(0), '0 B');
  });

  test('formats bytes under 1 KB', () => {
    assert.strictEqual(WorkspaceService.formatBytes(512), '512.0 B');
  });

  test('formats kilobytes', () => {
    assert.strictEqual(WorkspaceService.formatBytes(1024), '1.0 KB');
  });

  test('formats megabytes', () => {
    assert.strictEqual(WorkspaceService.formatBytes(1.8 * 1024 * 1024), '1.8 MB');
  });

  test('formats gigabytes', () => {
    assert.strictEqual(WorkspaceService.formatBytes(2 * 1024 * 1024 * 1024), '2.0 GB');
  });
});

