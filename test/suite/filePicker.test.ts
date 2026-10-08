import * as assert from 'assert';
import { FileSelectionManager, FileQuickPickItem, FilePicker } from '../../src/ui/FilePicker.js';
import { WorkspaceFile } from '../../src/types/index.js';
import { WorkspaceAnalysis } from '../../src/workspace/WorkspaceService.js';

suite('Phase 3 — FileSelectionManager & FilePicker', () => {
  const sampleFiles: WorkspaceFile[] = [
    { relativePath: 'src', absolutePath: '/proj/src', size: 0, isDirectory: true },
    { relativePath: 'docs', absolutePath: '/proj/docs', size: 0, isDirectory: true },
    { relativePath: 'node_modules', absolutePath: '/proj/node_modules', size: 0, isDirectory: true },
    { relativePath: 'src/main.py', absolutePath: '/proj/src/main.py', size: 1024, isDirectory: false },
    { relativePath: 'src/utils.py', absolutePath: '/proj/src/utils.py', size: 2048, isDirectory: false },
    { relativePath: 'docs/README.md', absolutePath: '/proj/docs/README.md', size: 512, isDirectory: false },
    { relativePath: 'package.json', absolutePath: '/proj/package.json', size: 300, isDirectory: false },
    { relativePath: '.env', absolutePath: '/proj/.env', size: 100, isDirectory: false },
    { relativePath: 'big-data.bin', absolutePath: '/proj/big-data.bin', size: 100 * 1024 * 1024, isDirectory: false },
  ];

  const sampleIncluded: WorkspaceFile[] = [
    { relativePath: 'src', absolutePath: '/proj/src', size: 0, isDirectory: true },
    { relativePath: 'docs', absolutePath: '/proj/docs', size: 0, isDirectory: true },
    { relativePath: 'src/main.py', absolutePath: '/proj/src/main.py', size: 1024, isDirectory: false },
    { relativePath: 'src/utils.py', absolutePath: '/proj/src/utils.py', size: 2048, isDirectory: false },
    { relativePath: 'docs/README.md', absolutePath: '/proj/docs/README.md', size: 512, isDirectory: false },
    { relativePath: 'package.json', absolutePath: '/proj/package.json', size: 300, isDirectory: false },
  ];

  const sampleExcluded: WorkspaceFile[] = [
    { relativePath: '.env', absolutePath: '/proj/.env', size: 100, isDirectory: false },
    { relativePath: 'big-data.bin', absolutePath: '/proj/big-data.bin', size: 100 * 1024 * 1024, isDirectory: false },
  ];

  const sampleAnalysis: WorkspaceAnalysis = {
    rootPath: '/proj',
    folderName: 'proj',
    allFiles: sampleFiles,
    includedFiles: sampleIncluded,
    excludedFiles: sampleExcluded,
    totalIncludedBytes: 1024 + 2048 + 512 + 300,
    oversizedFileCount: 1,
  };

  test('createQuickPickItems creates items for directories and files', () => {
    const items = FileSelectionManager.createQuickPickItems(sampleAnalysis);

    // 3 top-level directories + 6 files = 9 items
    assert.strictEqual(items.length, 9, 'Should have 9 total items');

    const srcDirItem = items.find((i) => i.workspaceFile.relativePath === 'src');
    assert.ok(srcDirItem, 'src directory should be present');
    assert.strictEqual(srcDirItem!.picked, true, 'src should be picked by default (has included files)');
    assert.ok(srcDirItem!.label.includes('src/'), 'Directory label should contain folder name and slash');

    const nodeModulesDir = items.find((i) => i.workspaceFile.relativePath === 'node_modules');
    assert.ok(nodeModulesDir, 'node_modules should be present');
    assert.strictEqual(nodeModulesDir!.picked, false, 'node_modules should not be picked (no included files)');

    const mainPy = items.find((i) => i.workspaceFile.relativePath === 'src/main.py');
    assert.ok(mainPy, 'src/main.py should be present');
    assert.strictEqual(mainPy!.picked, true, 'src/main.py should be picked by default');

    const dotEnv = items.find((i) => i.workspaceFile.relativePath === '.env');
    assert.ok(dotEnv, '.env should be present');
    assert.strictEqual(dotEnv!.picked, false, '.env should be unchecked by default');
    assert.ok(dotEnv!.detail?.includes('Excluded'), '.env should note exclusion in detail');
  });

  test('resolveSelection with individual files selected', () => {
    const items = FileSelectionManager.createQuickPickItems(sampleAnalysis);
    const selected = items.filter(
      (i) => i.workspaceFile.relativePath === 'package.json' || i.workspaceFile.relativePath === 'src/main.py',
    );

    const result = FileSelectionManager.resolveSelection(selected, sampleAnalysis.allFiles);

    assert.strictEqual(result.totalFiles, 2, 'Should have 2 files');
    assert.strictEqual(result.totalBytes, 300 + 1024, 'Total bytes should match');
    assert.strictEqual(result.excludedCount, 4, 'Excluded count should be 6 non-dir files - 2 = 4');
    assert.ok(result.selectedFiles.some((f) => f.relativePath === 'package.json'));
    assert.ok(result.selectedFiles.some((f) => f.relativePath === 'src/main.py'));
  });

  test('resolveSelection cascades directory selection to all child files', () => {
    const items = FileSelectionManager.createQuickPickItems(sampleAnalysis);
    // Select src/ folder
    const selected = items.filter((i) => i.workspaceFile.relativePath === 'src');

    const result = FileSelectionManager.resolveSelection(selected, sampleAnalysis.allFiles);

    // src/ contains src/main.py and src/utils.py
    assert.strictEqual(result.totalFiles, 2, 'Should include both files under src/');
    assert.ok(result.selectedFiles.some((f) => f.relativePath === 'src/main.py'));
    assert.ok(result.selectedFiles.some((f) => f.relativePath === 'src/utils.py'));
    assert.strictEqual(result.totalBytes, 1024 + 2048);
  });

  test('resolveSelection deduplicates files when both folder and individual child are selected', () => {
    const items = FileSelectionManager.createQuickPickItems(sampleAnalysis);
    // Select both 'src/' and 'src/main.py'
    const selected = items.filter(
      (i) => i.workspaceFile.relativePath === 'src' || i.workspaceFile.relativePath === 'src/main.py',
    );

    const result = FileSelectionManager.resolveSelection(selected, sampleAnalysis.allFiles);

    assert.strictEqual(result.totalFiles, 2, 'Should still have 2 files without duplicates');
    assert.strictEqual(result.totalBytes, 1024 + 2048);
  });

  test('resolveSelection with empty selection returns 0 files and all excluded', () => {
    const result = FileSelectionManager.resolveSelection([], sampleAnalysis.allFiles);

    assert.strictEqual(result.totalFiles, 0);
    assert.strictEqual(result.totalBytes, 0);
    assert.strictEqual(result.excludedCount, 6);
  });

  test('confirmSelectionSummary throws error when 0 files selected', async () => {
    const picker = new FilePicker();
    const emptyResult = {
      selectedFiles: [],
      totalBytes: 0,
      totalFiles: 0,
      excludedCount: 6,
      formattedSize: '0 B',
    };

    await assert.rejects(
      () => picker.confirmSelectionSummary(emptyResult, 'proj'),
      (err: Error) => {
        assert.strictEqual(err.name, 'WorkspaceError');
        return true;
      },
    );
  });
});
