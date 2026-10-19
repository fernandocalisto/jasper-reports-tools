import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConnectionManager } from '../services/connectionManager';
import { FieldAnalyzer } from '../services/fieldAnalyzer';
import { RunnerCliError, RunnerService } from '../services/runnerService';

export class FieldViewerPanel implements vscode.Disposable {
  public static currentPanel: FieldViewerPanel | undefined;
  private static readonly viewType = 'jasper.fieldViewer';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly fieldAnalyzer: FieldAnalyzer;
  private jrxmlPath: string;
  private isInspecting = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly connectionManager: ConnectionManager,
    private readonly runnerService: RunnerService,
    private readonly outputChannel: vscode.OutputChannel,
    jrxmlPath: string
  ) {
    this.panel = panel;
    this.jrxmlPath = jrxmlPath;
    this.fieldAnalyzer = new FieldAnalyzer(runnerService, connectionManager);

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );

    const connSub = this.connectionManager.onDidChangeConnections(async () => {
      const activeProfile = await this.connectionManager.getActiveProfile();
      await this.panel.webview.postMessage({
        command: 'updateConnectionStatus',
        connectionName: activeProfile?.name ?? null
      });
    });
    this.disposables.push(connSub);
  }

  public static createOrShow(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    runnerService: RunnerService,
    outputChannel: vscode.OutputChannel,
    jrxmlPath: string
  ): FieldViewerPanel {
    const normalizedPath = path.resolve(jrxmlPath);
    const title = `Fields: ${path.basename(normalizedPath)}`;

    if (FieldViewerPanel.currentPanel) {
      const existing = FieldViewerPanel.currentPanel;
      existing.jrxmlPath = normalizedPath;
      existing.panel.title = title;
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      void existing.loadStaticFields();
      return existing;
    }

    const webviewRoot = vscode.Uri.file(
      path.join(context.extensionPath, 'webviews', 'field-viewer')
    );

    const panel = vscode.window.createWebviewPanel(
      FieldViewerPanel.viewType,
      title,
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot]
      }
    );

    FieldViewerPanel.currentPanel = new FieldViewerPanel(
      panel,
      context,
      connectionManager,
      runnerService,
      outputChannel,
      normalizedPath
    );

    return FieldViewerPanel.currentPanel;
  }

  public static handleDidSaveTextDocument(document: vscode.TextDocument): void {
    if (!FieldViewerPanel.currentPanel) {
      return;
    }
    const savedPath = path.resolve(document.uri.fsPath);
    if (savedPath.toLowerCase() === FieldViewerPanel.currentPanel.jrxmlPath.toLowerCase()) {
      void FieldViewerPanel.currentPanel.loadStaticFields(document);
    }
  }

  private findOpenDocument(): vscode.TextDocument | undefined {
    const targetLower = this.jrxmlPath.toLowerCase();
    return vscode.workspace.textDocuments.find(
      (doc) => path.resolve(doc.uri.fsPath).toLowerCase() === targetLower
    );
  }

  public async loadStaticFields(document?: vscode.TextDocument): Promise<void> {
    try {
      const targetDoc = document ?? this.findOpenDocument();
      const result = await this.fieldAnalyzer.analyzeStatic(this.jrxmlPath, targetDoc);
      await this.panel.webview.postMessage({
        command: 'renderFields',
        data: result
      });
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.log(`Erro ao analisar campos do arquivo "${path.basename(this.jrxmlPath)}": ${errMessage}`);
      await this.panel.webview.postMessage({
        command: 'showError',
        message: errMessage
      });
    }
  }

  private async inspectQueryInDatabase(): Promise<void> {
    if (this.isInspecting) {
      return;
    }
    this.isInspecting = true;

    const fileName = path.basename(this.jrxmlPath);
    await this.panel.webview.postMessage({
      command: 'setLoading',
      loading: true,
      message: 'Consultando metadados JDBC no banco de dados...'
    });

    try {
      const openDoc = this.findOpenDocument();
      if (openDoc && openDoc.isDirty) {
        await openDoc.save();
      }

      this.log(`Inspecionando metadados JDBC da query de "${fileName}"...`);
      const result = await this.fieldAnalyzer.analyzeDatabase(this.jrxmlPath, openDoc);

      this.log(
        `Introspecção JDBC concluída em ${result.executionTimeMs ?? 0}ms (${result.fields.length} campo(s) mapeado(s)).`
      );

      await this.panel.webview.postMessage({
        command: 'renderFields',
        data: result
      });
    } catch (error) {
      const errMessage =
        error instanceof Error
          ? error.message
          : 'Falha ao inspecionar tipos da query no banco de dados.';
      this.log(`ERRO na introspecção de "${fileName}": ${errMessage}`);
      if (error instanceof RunnerCliError && error.stackTraceSnippet) {
        this.outputChannel.appendLine(error.stackTraceSnippet);
      }

      await this.panel.webview.postMessage({
        command: 'showError',
        message: errMessage
      });
    } finally {
      this.isInspecting = false;
      await this.panel.webview.postMessage({
        command: 'setLoading',
        loading: false
      });
    }
  }

  private async handleMessage(message: any): Promise<void> {
    if (!message || typeof message.command !== 'string') {
      return;
    }

    switch (message.command) {
      case 'ready':
      case 'refreshStatic': {
        await this.loadStaticFields();
        break;
      }

      case 'inspectDatabase': {
        await this.inspectQueryInDatabase();
        break;
      }

      case 'copyExpression': {
        const fieldName = typeof message.fieldName === 'string' ? message.fieldName.trim() : '';
        if (!fieldName) {
          return;
        }
        const expression = `$F{${fieldName}}`;
        await vscode.env.clipboard.writeText(expression);
        await this.panel.webview.postMessage({
          command: 'copiedToast',
          text: expression
        });
        void vscode.window.setStatusBarMessage(`Jasper: Copiado ${expression}`, 3000);
        break;
      }

      case 'copyFieldXml': {
        const fieldName = typeof message.fieldName === 'string' ? message.fieldName.trim() : '';
        const javaClass =
          typeof message.javaClass === 'string' && message.javaClass.trim()
            ? message.javaClass.trim()
            : 'java.lang.String';
        if (!fieldName) {
          return;
        }
        const xmlSnippet = `<field name="${fieldName}" class="${javaClass}"/>`;
        await vscode.env.clipboard.writeText(xmlSnippet);
        await this.panel.webview.postMessage({
          command: 'copiedToast',
          text: xmlSnippet
        });
        void vscode.window.setStatusBarMessage(`Jasper: Tag <field> copiada (${fieldName})`, 3000);
        break;
      }

      case 'selectConnection': {
        await vscode.commands.executeCommand('jasper.setActiveConnection');
        break;
      }

      case 'openLog': {
        this.outputChannel.show(true);
        break;
      }
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = path.join(
      this.context.extensionPath,
      'webviews',
      'field-viewer',
      'index.html'
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'field-viewer', 'styles.css')
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'field-viewer', 'main.js')
      )
    );

    const nonce = crypto.randomBytes(16).toString('base64');
    let html = fs.readFileSync(htmlPath, 'utf8');

    html = html
      .replace(/\{\{cspSource\}\}/g, webview.cspSource)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{styleUri\}\}/g, styleUri.toString())
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString());

    return html;
  }

  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  public dispose(): void {
    FieldViewerPanel.currentPanel = undefined;
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
