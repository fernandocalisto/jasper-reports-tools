import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  ALL_DIFF_CATEGORIES,
  DiffCancellationToken,
  DiffCategory,
  DiffOptions,
  DiffResult,
  ReportDiffEngine
} from '../services/reportDiffEngine';
import { RunnerService } from '../services/runnerService';

export interface DiffEndpointInput {
  filePath?: string;
  content?: string;
  label: string;
  subtitle?: string;
  origin?: 'local' | 'server';
}

export interface DiffSessionInput {
  left: DiffEndpointInput;
  right: DiffEndpointInput;
  options?: DiffOptions;
}

export class DiffViewerPanel implements vscode.Disposable {
  public static currentPanel: DiffViewerPanel | undefined;
  private static readonly viewType = 'jasper.reportDiffViewer';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly diffEngine: ReportDiffEngine;

  private session: DiffSessionInput;
  private currentOptions: DiffOptions;
  private lastDiffResult?: DiffResult;
  private activeToken?: DiffCancellationToken;
  private isRunningDiff = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly runnerService: RunnerService,
    private readonly outputChannel: vscode.OutputChannel,
    session: DiffSessionInput
  ) {
    this.panel = panel;
    this.session = session;
    this.diffEngine = new ReportDiffEngine(runnerService);
    this.currentOptions = {
      ignoreWhitespace: false,
      ignoreAttributeOrder: true,
      ignoreUUID: false,
      semanticQueryDiff: true,
      semanticExpressionDiff: true,
      filters: [...ALL_DIFF_CATEGORIES],
      ...session.options
    };

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );
  }

  /**
   * Cria ou reutiliza o painel WebView de Comparação de Relatórios (`DiffViewerPanel`).
   */
  public static createOrShow(
    context: vscode.ExtensionContext,
    runnerService: RunnerService,
    outputChannel: vscode.OutputChannel,
    session: DiffSessionInput
  ): DiffViewerPanel {
    const title = `Diff: ${path.basename(session.left.label)} ↔ ${path.basename(session.right.label)}`;

    if (DiffViewerPanel.currentPanel) {
      const existing = DiffViewerPanel.currentPanel;
      existing.session = session;
      if (session.options) {
        existing.currentOptions = {
          ...existing.currentOptions,
          ...session.options
        };
      }
      existing.panel.title = title;
      existing.panel.reveal(vscode.ViewColumn.Active, false);
      void existing.runComparison();
      return existing;
    }

    const webviewRoot = vscode.Uri.file(
      path.join(context.extensionPath, 'webviews', 'report-diff')
    );
    const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, 'media'));

    const panel = vscode.window.createWebviewPanel(
      DiffViewerPanel.viewType,
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot, mediaRoot]
      }
    );

    DiffViewerPanel.currentPanel = new DiffViewerPanel(
      panel,
      context,
      runnerService,
      outputChannel,
      session
    );

    return DiffViewerPanel.currentPanel;
  }

  /**
   * Atualiza automaticamente a comparação caso um dos arquivos locais comparados seja salvo no editor.
   */
  public static handleDidSaveTextDocument(document: vscode.TextDocument): void {
    if (!DiffViewerPanel.currentPanel || !document?.uri?.fsPath) {
      return;
    }
    const savedLower = path.resolve(document.uri.fsPath).toLowerCase();
    const current = DiffViewerPanel.currentPanel;
    const leftPath = current.session.left.filePath
      ? path.resolve(current.session.left.filePath).toLowerCase()
      : '';
    const rightPath = current.session.right.filePath
      ? path.resolve(current.session.right.filePath).toLowerCase()
      : '';

    if (savedLower === leftPath || savedLower === rightPath) {
      void current.runComparison();
    }
  }

  private async resolveEndpointContent(
    endpoint: DiffEndpointInput
  ): Promise<{ content: string; size: number; displayPath: string }> {
    if (endpoint.filePath) {
      const resolvedPath = path.resolve(endpoint.filePath);
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => path.resolve(d.uri.fsPath).toLowerCase() === resolvedPath.toLowerCase()
      );
      if (openDoc && path.extname(resolvedPath).toLowerCase() === '.jrxml') {
        const text = openDoc.getText();
        return {
          content: text,
          size: Buffer.byteLength(text, 'utf8'),
          displayPath: endpoint.subtitle || resolvedPath
        };
      }

      const loaded = await this.diffEngine.loadReportContent(resolvedPath);
      return {
        content: loaded.content,
        size: loaded.size,
        displayPath: endpoint.subtitle || resolvedPath
      };
    }

    const content = endpoint.content ?? '';
    return {
      content,
      size: Buffer.byteLength(content, 'utf8'),
      displayPath: endpoint.subtitle || endpoint.label
    };
  }

  public async runComparison(): Promise<DiffResult | undefined> {
    if (this.isRunningDiff && this.activeToken) {
      this.activeToken.isCancellationRequested = true;
    }

    this.isRunningDiff = true;
    const token: DiffCancellationToken = { isCancellationRequested: false };
    this.activeToken = token;

    await this.panel.webview.postMessage({
      command: 'setLoading',
      loading: true,
      message: `Comparando "${path.basename(this.session.left.label)}" e "${path.basename(
        this.session.right.label
      )}"...`
    });

    try {
      const [resolvedLeft, resolvedRight] = await Promise.all([
        this.resolveEndpointContent(this.session.left),
        this.resolveEndpointContent(this.session.right)
      ]);

      if (token.isCancellationRequested) {
        await this.panel.webview.postMessage({
          command: 'diffCancelled'
        });
        return undefined;
      }

      const result = await this.diffEngine.diffContent(
        resolvedLeft.content,
        resolvedRight.content,
        {
          ...this.currentOptions,
          cancellationToken: token,
          labelA: resolvedLeft.displayPath,
          labelB: resolvedRight.displayPath
        },
        {
          path: resolvedLeft.displayPath,
          name: this.session.left.label,
          size: resolvedLeft.size
        },
        {
          path: resolvedRight.displayPath,
          name: this.session.right.label,
          size: resolvedRight.size
        }
      );

      if (token.isCancellationRequested || result.metadata.cancelled) {
        this.log('Comparação de relatórios cancelada pelo usuário.');
        await this.panel.webview.postMessage({
          command: 'diffCancelled'
        });
        return undefined;
      }

      this.lastDiffResult = result;

      this.log(
        `Diff concluído em ${result.metadata.diffTimeMs}ms: ` +
          `"${this.session.left.label}" vs "${this.session.right.label}" ` +
          `(+${result.summary.added} -${result.summary.removed} ~${result.summary.modified}, ` +
          `${result.changes.length} mudança(s) semântica(s)).`
      );

      await this.panel.webview.postMessage({
        command: 'renderDiff',
        result,
        options: this.currentOptions,
        leftOrigin: this.session.left.origin || 'local',
        rightOrigin: this.session.right.origin || 'local',
        canOpenLeftFile: Boolean(
          this.session.left.filePath &&
            this.session.left.filePath.toLowerCase().endsWith('.jrxml')
        ),
        canOpenRightFile: Boolean(
          this.session.right.filePath &&
            this.session.right.filePath.toLowerCase().endsWith('.jrxml')
        )
      });

      return result;
    } catch (error) {
      const errMessage =
        error instanceof Error
          ? error.message
          : 'Erro inesperado ao comparar relatórios.';
      this.log(`ERRO no Report Diff: ${errMessage}`);
      await this.panel.webview.postMessage({
        command: 'showError',
        message: errMessage
      });
      return undefined;
    } finally {
      this.isRunningDiff = false;
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
      case 'refreshDiff': {
        await this.runComparison();
        break;
      }

      case 'updateOptions': {
        if (message.options && typeof message.options === 'object') {
          this.currentOptions = {
            ...this.currentOptions,
            ignoreWhitespace: Boolean(message.options.ignoreWhitespace),
            ignoreAttributeOrder: Boolean(message.options.ignoreAttributeOrder),
            ignoreUUID: Boolean(message.options.ignoreUUID),
            semanticQueryDiff: Boolean(message.options.semanticQueryDiff),
            semanticExpressionDiff: Boolean(message.options.semanticExpressionDiff),
            filters: Array.isArray(message.options.filters)
              ? (message.options.filters as DiffCategory[])
              : this.currentOptions.filters
          };
          await this.runComparison();
        }
        break;
      }

      case 'swapSides': {
        this.session = {
          ...this.session,
          left: this.session.right,
          right: this.session.left
        };
        this.panel.title = `Diff: ${path.basename(this.session.left.label)} ↔ ${path.basename(
          this.session.right.label
        )}`;
        await this.runComparison();
        break;
      }

      case 'cancelDiff': {
        if (this.activeToken) {
          this.activeToken.isCancellationRequested = true;
        }
        this.diffEngine.cancel();
        await this.panel.webview.postMessage({
          command: 'diffCancelled'
        });
        break;
      }

      case 'exportDiff': {
        const format: 'html' | 'markdown' | 'json' =
          message.format === 'markdown' || message.format === 'json'
            ? message.format
            : 'html';
        const activeFilters: DiffCategory[] | undefined = Array.isArray(message.filters)
          ? message.filters
          : this.currentOptions.filters;
        await this.exportDiffToDisk(format, activeFilters);
        break;
      }

      case 'openFileAtLine': {
        const side = message.side === 'right' ? 'right' : 'left';
        const line = typeof message.line === 'number' && message.line > 0 ? message.line : 1;
        const targetEndpoint = side === 'right' ? this.session.right : this.session.left;
        if (targetEndpoint.filePath && fs.existsSync(targetEndpoint.filePath)) {
          const doc = await vscode.workspace.openTextDocument(
            vscode.Uri.file(targetEndpoint.filePath)
          );
          const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: false
          });
          const pos = new vscode.Position(Math.max(0, line - 1), 0);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(
            new vscode.Range(pos, pos),
            vscode.TextEditorRevealType.InCenter
          );
        }
        break;
      }

      case 'openLog': {
        this.outputChannel.show(true);
        break;
      }
    }
  }

  private async exportDiffToDisk(
    format: 'html' | 'markdown' | 'json',
    activeFilters?: DiffCategory[]
  ): Promise<void> {
    if (!this.lastDiffResult) {
      void vscode.window.showWarningMessage(
        'Nenhum resultado de comparação disponível para exportar.'
      );
      return;
    }

    const baseLeft = path.basename(
      this.session.left.label,
      path.extname(this.session.left.label)
    );
    const baseRight = path.basename(
      this.session.right.label,
      path.extname(this.session.right.label)
    );
    const ext = format === 'markdown' ? 'md' : format === 'json' ? 'json' : 'html';
    const defaultFileName = `diff-${baseLeft}-vs-${baseRight}.${ext}`;

    const baseDir = this.session.left.filePath
      ? path.dirname(this.session.left.filePath)
      : this.session.right.filePath
      ? path.dirname(this.session.right.filePath)
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    const filtersMap: Record<string, string[]> =
      format === 'markdown'
        ? { 'Markdown (.md)': ['md'], 'HTML Standalone (.html)': ['html'], 'JSON (.json)': ['json'] }
        : format === 'json'
        ? { 'JSON (.json)': ['json'], 'HTML Standalone (.html)': ['html'], 'Markdown (.md)': ['md'] }
        : { 'HTML Standalone (.html)': ['html'], 'Markdown (.md)': ['md'], 'JSON (.json)': ['json'] };

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(baseDir, defaultFileName)),
      saveLabel: 'Exportar Diff',
      title: 'Exportar Comparação de Relatórios',
      filters: filtersMap
    });

    if (!saveUri) {
      return;
    }

    const targetExt = path.extname(saveUri.fsPath).toLowerCase();
    let outputContent: string;
    if (targetExt === '.md') {
      outputContent = this.diffEngine.exportToMarkdown(this.lastDiffResult);
    } else if (targetExt === '.json') {
      outputContent = this.diffEngine.exportToJson(this.lastDiffResult);
    } else {
      outputContent = this.diffEngine.exportToHtml(this.lastDiffResult, {
        ...this.currentOptions,
        filters: activeFilters
      });
    }

    await fs.promises.writeFile(saveUri.fsPath, outputContent, 'utf8');
    this.log(`Diff exportado com sucesso para: ${saveUri.fsPath}`);

    const action = await vscode.window.showInformationMessage(
      `Diff exportado com sucesso: ${path.basename(saveUri.fsPath)}`,
      'Abrir Arquivo'
    );
    if (action === 'Abrir Arquivo') {
      await vscode.env.openExternal(saveUri);
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = path.join(
      this.context.extensionPath,
      'webviews',
      'report-diff',
      'index.html'
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'report-diff', 'styles.css')
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'report-diff', 'main.js')
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
    this.outputChannel.appendLine(`[${timestamp}] [ReportDiff] ${message}`);
  }

  public dispose(): void {
    DiffViewerPanel.currentPanel = undefined;
    if (this.activeToken) {
      this.activeToken.isCancellationRequested = true;
    }
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
