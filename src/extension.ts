import * as vscode from 'vscode';
import { ConnectionManager } from './services/connectionManager';
import { RunnerService } from './services/runnerService';
import { DatabaseTreeProvider } from './providers/databaseTreeProvider';
import { registerConnectionCommands } from './commands/connectionCommands';
import { registerReportCommands } from './commands/reportCommands';
import { PreviewPanel } from './webviewPanels/previewPanel';

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
  const runnerService = new RunnerService(context);
  const databaseTreeProvider = new DatabaseTreeProvider(connectionManager);

  const treeView = vscode.window.createTreeView('jasper-databases', {
    treeDataProvider: databaseTreeProvider,
    showCollapseAll: false
  });

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
  const reportDisposables = registerReportCommands(
    context,
    connectionManager,
    runnerService,
    outputChannel
  );

  const saveDocumentListener = vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.fileName.toLowerCase().endsWith('.jrxml')) {
      PreviewPanel.handleDidSaveTextDocument(document);
    }
  });

  context.subscriptions.push(
    outputChannel,
    connectionManager,
    databaseTreeProvider,
    treeView,
    statusBarItem,
    connectionListener,
    saveDocumentListener,
    ...connectionDisposables,
    ...reportDisposables
  );
}

export function deactivate(): void {
  if (PreviewPanel.currentPanel) {
    PreviewPanel.currentPanel.dispose();
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
