import * as vscode from 'vscode';
import { ConnectionManager } from './services/connectionManager';
import { DatabaseTreeProvider } from './providers/databaseTreeProvider';
import { registerConnectionCommands } from './commands/connectionCommands';

let statusBarItem: vscode.StatusBarItem | undefined;

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
  const connectionManager = new ConnectionManager(context);
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

  const commandDisposables = registerConnectionCommands(context, connectionManager);

  context.subscriptions.push(
    connectionManager,
    databaseTreeProvider,
    treeView,
    statusBarItem,
    connectionListener,
    ...commandDisposables
  );
}

export function deactivate(): void {
  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = undefined;
  }
}
