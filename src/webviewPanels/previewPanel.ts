import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConnectionManager } from '../services/connectionManager';
import { RunnerCliError, RunnerService } from '../services/runnerService';
import { JrxmlMetadata, jrxmlParser, JrxmlParameter } from '../services/jrxmlParser';
import {
  ParameterValidator,
  parameterValidator as defaultParameterValidator,
  ValidationResult
} from '../services/parameterValidator';

const AUTO_RELOAD_STATE_KEY = 'jasper_preview_auto_reload';

export interface ValidationSettings {
  enabled: boolean;
  autoValidateOnPreviewOpen: boolean;
  debounceMs: number;
  showWarningsAsErrors: boolean;
}

export class PreviewPanel implements vscode.Disposable {
  public static currentPanel: PreviewPanel | undefined;
  private static readonly viewType = 'jasper.splitPreview';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly parameterValidator: ParameterValidator;
  private jrxmlPath: string;
  private lastParams: Record<string, any> = {};
  private lastGeneratedPdfPath: string | undefined;
  private isGenerating = false;
  private lastSaveTriggerTimestamp = 0;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly connectionManager: ConnectionManager,
    private readonly runnerService: RunnerService,
    private readonly outputChannel: vscode.OutputChannel,
    jrxmlPath: string,
    parameterValidator: ParameterValidator = defaultParameterValidator
  ) {
    this.panel = panel;
    this.jrxmlPath = jrxmlPath;
    this.parameterValidator = parameterValidator;

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

  /**
   * Abre o painel de Preview Dividido ao lado do editor atual (`vscode.ViewColumn.Beside`)
   * ou reutiliza a instância ativa.
   */
  public static createOrShow(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    runnerService: RunnerService,
    outputChannel: vscode.OutputChannel,
    jrxmlPath: string,
    parameterValidator: ParameterValidator = defaultParameterValidator
  ): PreviewPanel {
    const normalizedPath = path.resolve(jrxmlPath);
    const title = `Preview: ${path.basename(normalizedPath)}`;

    if (PreviewPanel.currentPanel) {
      const existing = PreviewPanel.currentPanel;
      const isSameFile =
        existing.jrxmlPath.toLowerCase() === normalizedPath.toLowerCase();

      existing.jrxmlPath = normalizedPath;
      existing.panel.title = title;
      existing.panel.reveal(vscode.ViewColumn.Beside, true);

      if (!isSameFile) {
        existing.lastParams = {};
        existing.lastGeneratedPdfPath = undefined;
      }

      void existing.initializePreview(true);
      return existing;
    }

    const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, 'media'));
    const previewRoot = vscode.Uri.file(
      path.join(context.extensionPath, 'webviews', 'preview')
    );
    const tempRoot = vscode.Uri.file(os.tmpdir());

    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      title,
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot, previewRoot, tempRoot]
      }
    );

    PreviewPanel.currentPanel = new PreviewPanel(
      panel,
      context,
      connectionManager,
      runnerService,
      outputChannel,
      normalizedPath,
      parameterValidator
    );

    return PreviewPanel.currentPanel;
  }

  /**
   * Notifica o painel ativo quando um documento de texto é salvo no workspace (Live Reload).
   */
  public static handleDidSaveTextDocument(document: vscode.TextDocument): void {
    if (!PreviewPanel.currentPanel) {
      return;
    }
    void PreviewPanel.currentPanel.onDocumentSaved(document);
  }

  public static handleConfigurationChanged(): void {
    if (!PreviewPanel.currentPanel) {
      return;
    }
    void PreviewPanel.currentPanel.onConfigurationChanged();
  }

  public getJrxmlPath(): string {
    return this.jrxmlPath;
  }

  public getValidationSettings(): ValidationSettings {
    const config = vscode.workspace.getConfiguration('jasper.validation');
    return {
      enabled: config.get<boolean>('enabled', true),
      autoValidateOnPreviewOpen: config.get<boolean>('autoValidateOnPreviewOpen', true),
      debounceMs: config.get<number>('debounceMs', 300),
      showWarningsAsErrors: config.get<boolean>('showWarningsAsErrors', false)
    };
  }

  public async onConfigurationChanged(): Promise<void> {
    const validationSettings = this.getValidationSettings();
    await this.panel.webview.postMessage({
      command: 'updateValidationSettings',
      validationSettings
    });
    if (validationSettings.enabled) {
      await this.validateParameters(this.lastParams);
    }
  }

  public isAutoReloadEnabled(): boolean {
    const wsPref = this.context.workspaceState.get<boolean>(AUTO_RELOAD_STATE_KEY);
    if (typeof wsPref === 'boolean') {
      return wsPref;
    }
    return this.context.globalState.get<boolean>(AUTO_RELOAD_STATE_KEY, true);
  }

  private async setAutoReloadEnabled(enabled: boolean): Promise<void> {
    await this.context.workspaceState.update(AUTO_RELOAD_STATE_KEY, enabled);
    await this.context.globalState.update(AUTO_RELOAD_STATE_KEY, enabled);
  }

  public async onDocumentSaved(document: vscode.TextDocument): Promise<void> {
    if (!document || !document.uri || !document.uri.fsPath) {
      return;
    }
    const savedPath = path.resolve(document.uri.fsPath);
    if (savedPath.toLowerCase() !== this.jrxmlPath.toLowerCase()) {
      return;
    }

    this.parameterValidator.invalidateCache(this.jrxmlPath);

    if (!this.isAutoReloadEnabled()) {
      return;
    }

    const now = Date.now();
    if (now - this.lastSaveTriggerTimestamp < 200) {
      return;
    }
    this.lastSaveTriggerTimestamp = now;

    const parameters = this.extractParameters(document);
    await this.panel.webview.postMessage({
      command: 'triggerAutoReload',
      parameters
    });
  }

  private findOpenDocument(): vscode.TextDocument | undefined {
    const targetLower = this.jrxmlPath.toLowerCase();
    return vscode.workspace.textDocuments.find(
      (doc) => path.resolve(doc.uri.fsPath).toLowerCase() === targetLower
    );
  }

  private extractMetadata(document?: vscode.TextDocument): JrxmlMetadata {
    try {
      const targetDoc = document ?? this.findOpenDocument();
      return this.parameterValidator.getCachedMetadata(this.jrxmlPath, targetDoc);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.log(`Aviso ao inspecionar metadados XML de "${path.basename(this.jrxmlPath)}": ${errMsg}`);
      return { parameters: [], fields: [], variables: [] };
    }
  }

  private extractParameters(document?: vscode.TextDocument): JrxmlParameter[] {
    return this.extractMetadata(document).parameters;
  }

  private buildInitialParams(parameters: JrxmlParameter[]): Record<string, any> {
    const initial: Record<string, any> = {};
    for (const p of parameters) {
      if (this.lastParams[p.name] !== undefined) {
        initial[p.name] = this.lastParams[p.name];
      } else if (p.defaultValue !== undefined && p.defaultValue !== null) {
        const trimmed = String(p.defaultValue).trim();
        if (
          trimmed &&
          trimmed !== 'null' &&
          !trimmed.startsWith('new ') &&
          !trimmed.includes('$P{') &&
          !trimmed.includes('$F{') &&
          !trimmed.includes('$V{')
        ) {
          initial[p.name] = trimmed;
        } else {
          initial[p.name] = '';
        }
      } else if (
        p.className === 'java.lang.Boolean' ||
        p.className === 'boolean'
      ) {
        initial[p.name] = false;
      } else {
        initial[p.name] = '';
      }
    }
    return initial;
  }

  private async validateParameters(
    params: Record<string, any>
  ): Promise<ValidationResult[]> {
    const validationSettings = this.getValidationSettings();
    const metadata = this.extractMetadata();
    const context = {
      parameter: metadata.parameters[0],
      parameters: metadata.parameters,
      allParameters: params,
      fields: metadata.fields,
      jrxmlPath: this.jrxmlPath,
      showWarningsAsErrors: validationSettings.showWarningsAsErrors
    };

    const results = this.parameterValidator.validateAll(params, context);

    // Atualiza UI de validação (inline + painel lateral + badge no header)
    await this.updateValidationUI(results);

    // Se houver erros, desabilita botão "Atualizar" ou mostra warning
    await this.updateActionButtons(results);

    return results;
  }

  private async updateValidationUI(results: ValidationResult[]): Promise<void> {
    const serialized = results.map((r) => ({
      parameterName: r.parameterName,
      ruleType: r.rule.type,
      passed: r.passed,
      message: r.message,
      severity: r.severity
    }));

    await this.panel.webview.postMessage({
      command: 'validationResults',
      results: serialized
    });
  }

  private async updateActionButtons(results: ValidationResult[]): Promise<void> {
    const errorCount = results.filter((r) => !r.passed && r.severity === 'error').length;
    const warningCount = results.filter(
      (r) => !r.passed && r.severity === 'warning'
    ).length;

    await this.panel.webview.postMessage({
      command: 'updateActionButtons',
      hasErrors: errorCount > 0,
      errorCount,
      warningCount
    });
  }

  private async initializePreview(autoRun: boolean): Promise<void> {
    const openDoc = this.findOpenDocument();
    const parameters = this.extractParameters(openDoc);
    const activeProfile = await this.connectionManager.getActiveProfile();
    const validationSettings = this.getValidationSettings();
    const initialParams = this.buildInitialParams(parameters);
    this.lastParams = { ...initialParams };

    let hasBlockingErrors = false;
    let initialValidationResults: ValidationResult[] = [];

    if (validationSettings.enabled && validationSettings.autoValidateOnPreviewOpen) {
      const metadata = this.extractMetadata(openDoc);
      initialValidationResults = this.parameterValidator.validateAll(initialParams, {
        parameter: metadata.parameters[0],
        parameters: metadata.parameters,
        allParameters: initialParams,
        fields: metadata.fields,
        jrxmlPath: this.jrxmlPath,
        showWarningsAsErrors: validationSettings.showWarningsAsErrors
      });
      hasBlockingErrors = initialValidationResults.some(
        (r) => !r.passed && r.severity === 'error'
      );
    }

    await this.panel.webview.postMessage({
      command: 'initMetadata',
      reportName: path.basename(this.jrxmlPath),
      parameters,
      connectionName: activeProfile?.name ?? null,
      autoReload: this.isAutoReloadEnabled(),
      validationSettings,
      initialValidationResults: initialValidationResults.map((r) => ({
        parameterName: r.parameterName,
        ruleType: r.rule.type,
        passed: r.passed,
        message: r.message,
        severity: r.severity
      })),
      autoRun: autoRun && !hasBlockingErrors
    });

    if (validationSettings.enabled && validationSettings.autoValidateOnPreviewOpen) {
      await this.updateValidationUI(initialValidationResults);
      await this.updateActionButtons(initialValidationResults);
    }
  }

  private getTempPdfPath(): string {
    const hash = crypto
      .createHash('md5')
      .update(this.jrxmlPath.toLowerCase())
      .digest('hex')
      .slice(0, 12);
    return path.join(os.tmpdir(), `jasper_preview_${hash}.pdf`);
  }

  private async handleMessage(message: any): Promise<void> {
    if (!message || typeof message.command !== 'string') {
      return;
    }

    switch (message.command) {
      case 'ready': {
        await this.initializePreview(true);
        break;
      }

      case 'validateParameters': {
        const params =
          message.params && typeof message.params === 'object' ? message.params : {};
        this.lastParams = { ...params };
        await this.validateParameters(params);
        break;
      }

      case 'runReport': {
        const params =
          message.params && typeof message.params === 'object' ? message.params : {};
        this.lastParams = { ...params };
        const validationSettings = this.getValidationSettings();
        if (validationSettings.enabled) {
          const results = await this.validateParameters(params);
          const hasErrors = results.some((r) => !r.passed && r.severity === 'error');
          if (hasErrors) {
            return;
          }
        }
        await this.generatePreviewPdf(params, Boolean(message.isAutoReload));
        break;
      }

      case 'exportPdf': {
        const params =
          message.params && typeof message.params === 'object'
            ? message.params
            : this.lastParams;
        await this.exportPdfToDisk(params);
        break;
      }

      case 'exportJasper': {
        await this.exportJasperToDisk();
        break;
      }

      case 'toggleAutoReload': {
        await this.setAutoReloadEnabled(Boolean(message.enabled));
        break;
      }

      case 'openLog': {
        this.outputChannel.show(true);
        break;
      }
    }
  }

  private async generatePreviewPdf(
    params: Record<string, any>,
    isAutoReload = false
  ): Promise<void> {
    if (this.isGenerating) {
      return;
    }
    this.isGenerating = true;
    this.lastParams = { ...params };

    const fileName = path.basename(this.jrxmlPath);
    const tempPdfPath = this.getTempPdfPath();

    try {
      const openDoc = this.findOpenDocument();
      if (openDoc && openDoc.isDirty && !isAutoReload) {
        await openDoc.save();
      }

      const activeProfile = await this.connectionManager.getActiveProfile();
      const password = activeProfile
        ? await this.connectionManager.getPassword(activeProfile.id)
        : undefined;

      this.log(
        `Gerando preview PDF para "${fileName}" ` +
          `[Conexão: ${activeProfile ? activeProfile.name : 'Modo Mock'}, ` +
          `Parâmetros: ${JSON.stringify(params)}]`
      );

      const response = await this.runnerService.fillAndExport({
        jrxmlPath: this.jrxmlPath,
        outputPath: tempPdfPath,
        format: 'pdf',
        dbProfile: activeProfile,
        password,
        params
      });

      const resolvedOutput = response.outputFile || tempPdfPath;
      if (!fs.existsSync(resolvedOutput)) {
        throw new Error(`O arquivo PDF temporário não foi encontrado em "${resolvedOutput}".`);
      }

      this.lastGeneratedPdfPath = resolvedOutput;
      const pdfBytes = await fs.promises.readFile(resolvedOutput);
      const base64Data = pdfBytes.toString('base64');
      const pdfUri = this.panel.webview
        .asWebviewUri(vscode.Uri.file(resolvedOutput))
        .toString();

      this.log(
        `Preview de "${fileName}" gerado com sucesso em ${response.executionTimeMs}ms (${response.pages ?? 0} página(s)).`
      );

      await this.panel.webview.postMessage({
        command: 'loadPdf',
        base64Data,
        pdfUri,
        pages: response.pages ?? 0,
        executionTimeMs: response.executionTimeMs,
        connectionName: activeProfile?.name ?? null
      });
    } catch (error) {
      const errMessage =
        error instanceof Error
          ? error.message
          : 'Erro inesperado ao gerar visualização do relatório.';
      const errorType =
        error instanceof RunnerCliError ? error.errorType : 'PREVIEW_ERROR';

      this.log(`ERRO no preview de "${fileName}" [${errorType}]: ${errMessage}`);
      if (error instanceof RunnerCliError && error.stackTraceSnippet) {
        this.outputChannel.appendLine(error.stackTraceSnippet);
      }

      await this.panel.webview.postMessage({
        command: 'reportError',
        errorType,
        message: errMessage
      });
    } finally {
      this.isGenerating = false;
    }
  }

  private async exportPdfToDisk(params: Record<string, any>): Promise<void> {
    const baseName = path.basename(this.jrxmlPath, path.extname(this.jrxmlPath));
    const defaultUri = vscode.Uri.file(
      path.join(path.dirname(this.jrxmlPath), `${baseName}.pdf`)
    );

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      saveLabel: 'Exportar PDF',
      title: 'Salvar Relatório em PDF',
      filters: {
        'Documento PDF': ['pdf']
      }
    });

    if (!saveUri) {
      return;
    }

    const targetPath = saveUri.fsPath;
    const fileName = path.basename(this.jrxmlPath);

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Jasper: Exportando PDF "${path.basename(targetPath)}"...`,
          cancellable: false
        },
        async () => {
          const openDoc = this.findOpenDocument();
          if (openDoc && openDoc.isDirty) {
            await openDoc.save();
          }

          const activeProfile = await this.connectionManager.getActiveProfile();
          const password = activeProfile
            ? await this.connectionManager.getPassword(activeProfile.id)
            : undefined;

          await this.runnerService.fillAndExport({
            jrxmlPath: this.jrxmlPath,
            outputPath: targetPath,
            format: 'pdf',
            dbProfile: activeProfile,
            password,
            params
          });
        }
      );

      this.log(`PDF exportado com sucesso para: ${targetPath}`);
      void vscode.window.showInformationMessage(
        `PDF exportado com sucesso: ${path.basename(targetPath)}`
      );
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : 'Falha ao exportar o PDF.';
      this.log(`ERRO ao exportar PDF de "${fileName}": ${errMessage}`);
      if (error instanceof RunnerCliError && error.stackTraceSnippet) {
        this.outputChannel.appendLine(error.stackTraceSnippet);
      }

      const action = await vscode.window.showErrorMessage(
        `Falha ao exportar PDF: ${errMessage}`,
        'Ver Log'
      );
      if (action === 'Ver Log') {
        this.outputChannel.show(true);
      }
    }
  }

  private async exportJasperToDisk(): Promise<void> {
    const baseName = path.basename(this.jrxmlPath, path.extname(this.jrxmlPath));
    const defaultUri = vscode.Uri.file(
      path.join(path.dirname(this.jrxmlPath), `${baseName}.jasper`)
    );

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      saveLabel: 'Exportar .jasper',
      title: 'Exportar Relatório Compilado (.jasper)',
      filters: {
        'Relatório Compilado Jasper': ['jasper']
      }
    });

    if (!saveUri) {
      return;
    }

    const targetPath = saveUri.fsPath;
    const fileName = path.basename(this.jrxmlPath);

    try {
      const openDoc = this.findOpenDocument();
      if (openDoc && openDoc.isDirty) {
        await openDoc.save();
      }

      const response = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Jasper: Compilando "${path.basename(targetPath)}"...`,
          cancellable: false
        },
        async () => this.runnerService.compileReport(this.jrxmlPath, targetPath)
      );

      this.log(
        `Binário .jasper exportado em ${response.executionTimeMs}ms -> ${targetPath}`
      );
      void vscode.window.showInformationMessage(
        `Arquivo .jasper exportado com sucesso! (${response.executionTimeMs}ms) → ${path.basename(targetPath)}`
      );
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : 'Falha ao exportar o arquivo .jasper.';
      this.log(`ERRO ao exportar .jasper de "${fileName}": ${errMessage}`);
      if (error instanceof RunnerCliError && error.stackTraceSnippet) {
        this.outputChannel.appendLine(error.stackTraceSnippet);
      }

      const action = await vscode.window.showErrorMessage(
        `Falha ao exportar .jasper: ${errMessage}`,
        'Ver Log'
      );
      if (action === 'Ver Log') {
        this.outputChannel.show(true);
      }
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = path.join(
      this.context.extensionPath,
      'webviews',
      'preview',
      'index.html'
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'preview', 'style.css')
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'preview', 'main.js')
      )
    );
    const pdfJsUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'media', 'pdfjs', 'pdf.min.js')
      )
    );
    const pdfWorkerUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'media', 'pdfjs', 'pdf.worker.min.js')
      )
    );

    let html = fs.readFileSync(htmlPath, 'utf8');

    html = html
      .replace(/\{\{cspSource\}\}/g, webview.cspSource)
      .replace(/\{\{styleUri\}\}/g, styleUri.toString())
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString())
      .replace(/\{\{pdfJsUri\}\}/g, pdfJsUri.toString())
      .replace(/\{\{pdfWorkerUri\}\}/g, pdfWorkerUri.toString());

    return html;
  }

  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  public dispose(): void {
    PreviewPanel.currentPanel = undefined;

    if (this.lastGeneratedPdfPath && fs.existsSync(this.lastGeneratedPdfPath)) {
      try {
        fs.unlinkSync(this.lastGeneratedPdfPath);
      } catch {
        // Ignora erro caso o arquivo temporário já tenha sido removido
      }
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
