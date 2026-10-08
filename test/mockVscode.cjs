// Lightweight mock for VS Code API during pure unit tests
// Allows instant test execution without launching full Electron GUI

const Module = require('module');
const originalRequire = Module.prototype.require;

const pkg = require('../package.json');
const configProps = pkg.contributes?.configuration?.properties || {};

Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      workspace: {
        workspaceFolders: undefined,
        getConfiguration: (section) => ({
          get: (key, defaultValue) => {
            const fullKey = section ? `${section}.${key}` : key;
            if (configProps[fullKey]?.default !== undefined) {
              return configProps[fullKey].default;
            }
            return defaultValue;
          },
        }),
      },
      window: {
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
          dispose: () => {},
        }),
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showQuickPick: async () => undefined,
        createQuickPick: () => {
          let acceptCb = () => {};
          let hideCb = () => {};
          return {
            title: '',
            placeholder: '',
            canSelectMany: true,
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true,
            items: [],
            selectedItems: [],
            onDidAccept: (cb) => {
              acceptCb = cb;
              return { dispose: () => {} };
            },
            onDidHide: (cb) => {
              hideCb = cb;
              return { dispose: () => {} };
            },
            show: () => {},
            hide: () => {},
            dispose: () => {},
            _accept: () => acceptCb(),
            _hide: () => hideCb(),
          };
        },
        withProgress: async (_options, task) => {
          return task({ report: () => {} }, { isCancellationRequested: false });
        },
      },
      commands: {
        executeCommand: async () => undefined,
        registerCommand: () => ({ dispose: () => {} }),
        getCommands: async () => [
          'classroomSubmit.signIn',
          'classroomSubmit.signOut',
          'classroomSubmit.submitAssignment',
          'classroomSubmit.selectCourse',
          'classroomSubmit.selectAssignment',
          'classroomSubmit.viewStatus',
        ],
      },
      ProgressLocation: {
        Notification: 15,
        Window: 10,
        SourceControl: 1,
      },
    };
  }
  return originalRequire.apply(this, arguments);
};
