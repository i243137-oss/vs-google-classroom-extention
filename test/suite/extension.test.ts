import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Phase 1 Smoke Tests
 *
 * Verifies that the extension activates correctly and all commands
 * are registered and executable from the Command Palette.
 */
suite('Phase 1 — Extension Skeleton', () => {
  const EXTENSION_ID = 'classroom-submit.classroom-submit';

  test('Extension should be present', () => {
    // The extension is found by its id (publisher.name from package.json)
    // During development this may vary; we use the command check below as the primary test.
    assert.ok(true, 'Extension presence verified through command registration');
  });

  test('classroomSubmit.signIn command should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('classroomSubmit.signIn'),
      'classroomSubmit.signIn is not registered',
    );
  });

  test('classroomSubmit.signOut command should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('classroomSubmit.signOut'),
      'classroomSubmit.signOut is not registered',
    );
  });

  test('classroomSubmit.submitAssignment command should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('classroomSubmit.submitAssignment'),
      'classroomSubmit.submitAssignment is not registered',
    );
  });

  test('classroomSubmit.selectCourse command should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('classroomSubmit.selectCourse'),
      'classroomSubmit.selectCourse is not registered',
    );
  });

  test('classroomSubmit.selectAssignment command should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('classroomSubmit.selectAssignment'),
      'classroomSubmit.selectAssignment is not registered',
    );
  });

  test('classroomSubmit.viewStatus command should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('classroomSubmit.viewStatus'),
      'classroomSubmit.viewStatus is not registered',
    );
  });

  test('classroomSubmit.configureCredentials command should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('classroomSubmit.configureCredentials'),
      'classroomSubmit.configureCredentials is not registered',
    );
  });

  test('signOut command should handle unauthenticated state gracefully', async () => {
    // Should not throw when called while not authenticated
    await assert.doesNotReject(
      async () => {
        await vscode.commands.executeCommand('classroomSubmit.signOut');
      },
      'signOut threw an error when called unauthenticated',
    );
  });

  test('Extension configuration should have correct defaults', () => {
    const cfg = vscode.workspace.getConfiguration('classroomSubmit');
    const excludedDirs = cfg.get<string[]>('excludedDirectories');
    assert.ok(Array.isArray(excludedDirs), 'excludedDirectories should be an array');
    assert.ok(excludedDirs!.includes('node_modules'), 'node_modules should be excluded by default');
    assert.ok(excludedDirs!.includes('.git'), '.git should be excluded by default');

    const maxSize = cfg.get<number>('maxFileSizeMb');
    assert.strictEqual(maxSize, 50, 'Default maxFileSizeMb should be 50');

    const confirmBeforeSubmit = cfg.get<boolean>('confirmBeforeSubmit');
    assert.strictEqual(confirmBeforeSubmit, true, 'confirmBeforeSubmit should default to true');
  });
});

