import * as vscode from 'vscode';
import { ConnectionManager } from './services/connectionManager';
import { ServerManager } from './services/serverManager';
import { JasperServerClient } from './services/jasperServerClient';
import { JasperServerSchedulerService } from './services/jasperServerScheduler';
import { RunnerService } from './services/runnerService';
import { jrxmlParser } from './services/jrxmlParser';
import { parameterValidator } from './services/parameterValidator';
import { PROVIDER_SELECTOR } from './services/completionProvider';
import {
  EXPRESSION_PROVIDER_SELECTOR,
  ExpressionCompletionProvider
} from './services/expressionCompletionProvider';
import {
  ExpressionCodeActionProvider,
  ExpressionCodeLensProvider,
  ExpressionDiagnosticsManager,
  ExpressionHoverProvider
} from './services/expressionHoverProvider';
import { DatabaseTreeProvider } from './providers/databaseTreeProvider';
import { ServerTreeProvider } from './providers/serverTreeProvider';
import { SchedulerTreeProvider } from './providers/schedulerTreeProvider';
import { ServerSearchController } from './controllers/serverSearchController';
import { ServerClipboardController } from './controllers/serverClipboardController';
import { registerConnectionCommands } from './commands/connectionCommands';
import { registerReportCommands } from './commands/reportCommands';
import { registerServerCommands } from './commands/serverCommands';
import { PreviewPanel } from './webviewPanels/previewPanel';
import { FieldViewerPanel } from './webviewPanels/fieldViewerPanel';
import { ServerFormPanel } from './webviewPanels/serverFormPanel';
import { DiffViewerPanel } from './webviewPanels/diffViewerPanel';
import { SchedulerJobEditorPanel } from './webviewPanels/schedulerJobEditorPanel';
import { SchedulerHistoryPanel } from './webviewPanels/schedulerHistoryPanel';
import {
  ExpressionEditorPanel,
  JasperExpressionCustomEditorProvider
} from './webviewPanels/expressionEditorPanel';

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
  const schedulerService = new JasperServerSchedulerService(
    serverClient,
    serverManager,
    outputChannel
  );
  const runnerService = new RunnerService(context);
  const databaseTreeProvider = new DatabaseTreeProvider(connectionManager);
  const serverTreeProvider = new ServerTreeProvider(
    serverManager,
    serverClient,
    outputChannel
  );
  const schedulerTreeProvider = new SchedulerTreeProvider(
    serverManager,
    schedulerService,
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

  const schedulesTreeView = vscode.window.createTreeView('jasper-schedules', {
    treeDataProvider: schedulerTreeProvider,
    showCollapseAll: true
  });

  const treeBindingDisposable = serverTreeProvider.bindTreeView(serverTreeView);
  const schedulesBindingDisposable = schedulerTreeProvider.bindTreeView(schedulesTreeView);
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
  // Registra comandos de relatório (compileCurrentReport, decompileJasper, openPreview, openFieldViewer, batchCompile, batchExport, compareReports, compareWithServer, openDiffViewer)
  const reportDisposables = registerReportCommands(
    context,
    connectionManager,
    runnerService,
    outputChannel,
    parameterValidator,
    serverManager,
    serverClient,
    serverTreeProvider
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
    clipboardController,
    schedulerService,
    schedulerTreeProvider
  );

  const expressionCompletionProvider = new ExpressionCompletionProvider(jrxmlParser);
  const completionDisposable = vscode.languages.registerCompletionItemProvider(
    EXPRESSION_PROVIDER_SELECTOR,
    expressionCompletionProvider,
    '$',
    '{',
    '.',
    '(',
    '?',
    ':'
  );

  const hoverDisposable = vscode.languages.registerHoverProvider(
    EXPRESSION_PROVIDER_SELECTOR,
    new ExpressionHoverProvider(jrxmlParser)
  );

  const expressionCodeLensProvider = new ExpressionCodeLensProvider(jrxmlParser);
  const codeLensDisposable = vscode.languages.registerCodeLensProvider(
    PROVIDER_SELECTOR,
    expressionCodeLensProvider
  );

  const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
    PROVIDER_SELECTOR,
    new ExpressionCodeActionProvider(jrxmlParser),
    {
      providedCodeActionKinds: ExpressionCodeActionProvider.providedCodeActionKinds
    }
  );

  const expressionDiagnosticsManager = new ExpressionDiagnosticsManager(jrxmlParser);

  const customExpressionEditorDisposable = vscode.window.registerCustomEditorProvider(
    JasperExpressionCustomEditorProvider.viewType,
    new JasperExpressionCustomEditorProvider(context, jrxmlParser, outputChannel),
    {
      webviewOptions: { retainContextWhenHidden: true }
    }
  );

  const saveDocumentListener = vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.fileName.toLowerCase().endsWith('.jrxml')) {
      parameterValidator.invalidateCache(document.uri.fsPath);
      PreviewPanel.handleDidSaveTextDocument(document);
      FieldViewerPanel.handleDidSaveTextDocument(document);
      DiffViewerPanel.handleDidSaveTextDocument(document);
      ExpressionEditorPanel.handleDidSaveTextDocument(document);
      expressionCodeLensProvider.refresh();
      expressionDiagnosticsManager.validateDocument(document);
    }
  });

  const configChangeListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('jasper.validation')) {
      PreviewPanel.handleConfigurationChanged();
      FieldViewerPanel.handleConfigurationChanged();
    }
    if (event.affectsConfiguration('jasper.expressionEditor')) {
      expressionCodeLensProvider.refresh();
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.fileName.toLowerCase().endsWith('.jrxml')) {
          expressionDiagnosticsManager.validateDocument(doc);
        }
      }
    }
  });

  context.subscriptions.push(
    outputChannel,
    connectionManager,
    serverManager,
    databaseTreeProvider,
    serverTreeProvider,
    schedulerTreeProvider,
    treeView,
    serverTreeView,
    schedulesTreeView,
    treeBindingDisposable,
    schedulesBindingDisposable,
    searchController,
    clipboardController,
    statusBarItem,
    connectionListener,
    completionDisposable,
    hoverDisposable,
    codeLensDisposable,
    codeActionDisposable,
    expressionDiagnosticsManager,
    customExpressionEditorDisposable,
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
  if (DiffViewerPanel.currentPanel) {
    DiffViewerPanel.currentPanel.dispose();
  }
  if (SchedulerJobEditorPanel.currentPanel) {
    SchedulerJobEditorPanel.currentPanel.dispose();
  }
  if (SchedulerHistoryPanel.currentPanel) {
    SchedulerHistoryPanel.currentPanel.dispose();
  }
  if (ExpressionEditorPanel.currentPanel) {
    ExpressionEditorPanel.currentPanel.dispose();
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

