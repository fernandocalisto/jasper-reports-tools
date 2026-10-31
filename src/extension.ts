import * as vscode from 'vscode';
import { ConnectionManager } from './services/connectionManager';
import { ServerManager } from './services/serverManager';
import { JasperServerClient } from './services/jasperServerClient';
import { RunnerService } from './services/runnerService';
import { jrxmlParser } from './services/jrxmlParser';
import { parameterValidator } from './services/parameterValidator';
import { JasperCompletionProvider, PROVIDER_SELECTOR } from './services/completionProvider';
import { DatabaseTreeProvider } from './providers/databaseTreeProvider';
import { ServerTreeProvider } from './providers/serverTreeProvider';
import { ServerSearchController } from './controllers/serverSearchController';
import { ServerClipboardController } from './controllers/serverClipboardController';
import { registerConnectionCommands } from './commands/connectionCommands';
import { registerReportCommands } from './commands/reportCommands';
import { registerServerCommands } from './commands/serverCommands';
import { PreviewPanel } from './webviewPanels/previewPanel';
import { FieldViewerPanel } from './webviewPanels/fieldViewerPanel';
import { ServerFormPanel } from './webviewPanels/serverFormPanel';

let statusBarItem: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel | undefined;

async function updateStatusBar(
  connectionManager: ConnectionManager,
  item: vscode.StatusBarItem
): Promise<void> {
  const activeProfile = await connectionManager.getActiveProfile();
  if (activeProfile) {
    item.text = `$(database) Jasper: ${activeProfile.name}`;
  } else {
    item.text = '$(database) Jasper: Nenhuma Conexão';
  }
  item.tooltip = 'Clique para alternar a conexão de banco de dados ativa';
  item.show();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('JasperReports');
  const connectionManager = new ConnectionManager(context);
  const serverManager = new ServerManager(context);
  const serverClient = new JasperServerClient(serverManager);
  const runnerService = new RunnerService(context);
  const databaseTreeProvider = new DatabaseTreeProvider(connectionManager);
  const serverTreeProvider = new ServerTreeProvider(
    serverManager,
    serverClient,
    outputChannel
  );

  const treeView = vscode.window.createTreeView('jasper-databases', {
    treeDataProvider: databaseTreeProvider,
    showCollapseAll: false
  });

  const serverTreeView = vscode.window.createTreeView('jasper-servers', {
    treeDataProvider: serverTreeProvider,
    showCollapseAll: true,
    canSelectMany: true,
    manageCheckboxStateManually: true
  });

  const treeBindingDisposable = serverTreeProvider.bindTreeView(serverTreeView);
  const searchController = new ServerSearchController(
    serverTreeProvider,
    serverTreeView,
    outputChannel
  );
  const clipboardController = new ServerClipboardController(
    serverManager,
    serverClient,
    serverTreeProvider,
    serverTreeView,
    outputChannel
  );

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'jasper.setActiveConnection';
  await updateStatusBar(connectionManager, statusBarItem);

  const connectionListener = connectionManager.onDidChangeConnections(() => {
    if (statusBarItem) {
      void updateStatusBar(connectionManager, statusBarItem);
    }
  });

  const connectionDisposables = registerConnectionCommands(
    context,
    connectionManager,
    runnerService,
    outputChannel
  );
  // Registra comandos de relatório (compileCurrentReport, decompileJasper, openPreview, openFieldViewer, batchCompile, batchExport)
  const reportDisposables = registerReportCommands(
    context,
    connectionManager,
    runnerService,
    outputChannel,
    parameterValidator
  );
  const serverDisposables = registerServerCommands(
    context,
    serverManager,
    serverClient,
    serverTreeProvider,
    runnerService,
    outputChannel,
    serverTreeView,
    searchController,
    clipboardController
  );

  const completionDisposable = vscode.languages.registerCompletionItemProvider(
    PROVIDER_SELECTOR,
    new JasperCompletionProvider(jrxmlParser),
    '$',
    '{',
    '.',
    '('
  );

  const saveDocumentListener = vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.fileName.toLowerCase().endsWith('.jrxml')) {
      parameterValidator.invalidateCache(document.uri.fsPath);
      PreviewPanel.handleDidSaveTextDocument(document);
      FieldViewerPanel.handleDidSaveTextDocument(document);
    }
  });

  const configChangeListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('jasper.validation')) {
      PreviewPanel.handleConfigurationChanged();
      FieldViewerPanel.handleConfigurationChanged();
    }
  });

  context.subscriptions.push(
    outputChannel,
    connectionManager,
    serverManager,
    databaseTreeProvider,
    serverTreeProvider,
    treeView,
    serverTreeView,
    treeBindingDisposable,
    searchController,
    clipboardController,
    statusBarItem,
    connectionListener,
    completionDisposable,
    saveDocumentListener,
    configChangeListener,
    ...connectionDisposables,
    ...reportDisposables,
    ...serverDisposables
  );
}

export function deactivate(): void {
  if (PreviewPanel.currentPanel) {
    PreviewPanel.currentPanel.dispose();
  }
  if (FieldViewerPanel.currentPanel) {
    FieldViewerPanel.currentPanel.dispose();
  }
  if (ServerFormPanel.currentPanel) {
    ServerFormPanel.currentPanel.dispose();
  }
  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = undefined;
  }
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = undefined;
  }
}

