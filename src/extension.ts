import * as vscode from 'vscode';
import { ConnectionManager } from './services/connectionManager';
import { ServerManager } from './services/serverManager';
import { JasperServerClient } from './services/jasperServerClient';
import { RunnerService } from './services/runnerService';
import { DatabaseTreeProvider } from './providers/databaseTreeProvider';
import { ServerTreeProvider } from './providers/serverTreeProvider';
import { registerConnectionCommands } from './commands/connectionCommands';
import { registerReportCommands } from './commands/reportCommands';
import { registerServerCommands } from './commands/serverCommands';
import { PreviewPanel } from './webviewPanels/previewPanel';
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
    showCollapseAll: true
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
  const serverDisposables = registerServerCommands(
    context,
    serverManager,
    serverClient,
    serverTreeProvider,
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
    serverManager,
    databaseTreeProvider,
    serverTreeProvider,
    treeView,
    serverTreeView,
    statusBarItem,
    connectionListener,
    saveDocumentListener,
    ...connectionDisposables,
    ...reportDisposables,
    ...serverDisposables
  );
}

export function deactivate(): void {
  if (PreviewPanel.currentPanel) {
    PreviewPanel.currentPanel.dispose();
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

