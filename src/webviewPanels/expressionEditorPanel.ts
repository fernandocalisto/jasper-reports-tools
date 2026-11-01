import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JrxmlMetadata, JrxmlParser } from '../services/jrxmlParser';
import {
  EXPRESSION_SNIPPETS,
  getStaticClassNames,
  GROOVY_OPERATORS,
  JASPER_BUILTIN_FUNCTIONS,
  JASPER_BUILTIN_PARAMETERS,
  JASPER_BUILTIN_VARIABLES
} from '../services/groovySignatureLibrary';
import {
  applyExpressionEditToDocument,
  detectReportLanguage,
  evaluateExpressionWithMock,
  ExpressionLanguage,
  extractExpressionsFromXml,
  findExpressionAtLine,
  generateMockDataForMetadata,
  JrxmlExpressionOccurrence,
  validateExpression
} from '../services/expressionEditor';
import { ExpressionCompletionProvider } from '../services/expressionCompletionProvider';

export interface OpenExpressionEditorOptions {
  documentUri?: vscode.Uri;
  expressionId?: string;
  lineZeroBased?: number;
  onAfterSave?: (document: vscode.TextDocument) => void;
}

export class ExpressionEditorPanel implements vscode.Disposable {
  public static currentPanel: ExpressionEditorPanel | undefined;
  public static readonly viewType = 'jasper.expressionEditorPanel';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly completionProvider: ExpressionCompletionProvider;

  private document: vscode.TextDocument;
  private activeOccurrence: JrxmlExpressionOccurrence;
  private currentLanguage: ExpressionLanguage;
  private customMockValues: Record<string, any> = {};
  private onAfterSaveCallback?: (document: vscode.TextDocument) => void;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly jrxmlParser: JrxmlParser,
    private readonly outputChannel: vscode.OutputChannel,
    document: vscode.TextDocument,
    initialOccurrence: JrxmlExpressionOccurrence,
    onAfterSave?: (document: vscode.TextDocument) => void
  ) {
    this.panel = panel;
    this.document = document;
    this.activeOccurrence = initialOccurrence;
    this.currentLanguage = initialOccurrence.language || 'groovy';
    this.onAfterSaveCallback = onAfterSave;
    this.completionProvider = new ExpressionCompletionProvider(jrxmlParser);

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
   * Abre ou reutiliza o modal/painel do Expression Editor para a expressão selecionada no `.jrxml`.
   */
  public static async createOrShow(
    context: vscode.ExtensionContext,
    jrxmlParser: JrxmlParser,
    outputChannel: vscode.OutputChannel,
    options: OpenExpressionEditorOptions = {}
  ): Promise<ExpressionEditorPanel | undefined> {
    let targetDoc: vscode.TextDocument | undefined;

    if (options.documentUri) {
      targetDoc = await vscode.workspace.openTextDocument(options.documentUri);
    } else if (vscode.window.activeTextEditor?.document) {
      targetDoc = vscode.window.activeTextEditor.document;
    } else {
      targetDoc = vscode.workspace.textDocuments.find((d) =>
        d.fileName.toLowerCase().endsWith('.jrxml')
      );
    }

    if (!targetDoc) {
      void vscode.window.showWarningMessage(
        'Abra um relatório .jrxml para editar expressões no Expression Editor.'
      );
      return undefined;
    }

    const xmlContent = targetDoc.getText();
    const allOccurrences = extractExpressionsFromXml(xmlContent);
    let targetOccurrence: JrxmlExpressionOccurrence | undefined;

    if (options.expressionId) {
      targetOccurrence = allOccurrences.find((o) => o.id === options.expressionId);
    }

    if (!targetOccurrence && typeof options.lineZeroBased === 'number') {
      targetOccurrence = findExpressionAtLine(xmlContent, options.lineZeroBased);
    }

    if (!targetOccurrence && vscode.window.activeTextEditor?.document === targetDoc) {
      const activePos = vscode.window.activeTextEditor.selection.active;
      targetOccurrence = findExpressionAtLine(
        xmlContent,
        activePos.line,
        activePos.character
      );
    }

    if (!targetOccurrence && allOccurrences.length > 0) {
      targetOccurrence = allOccurrences[0];
    }

    if (!targetOccurrence) {
      // Fallback caso o arquivo .jrxml ainda não possua tags de expressão
      const defaultLang = detectReportLanguage(xmlContent);
      targetOccurrence = {
        id: 'textFieldExpression:1:1',
        tagName: 'textFieldExpression',
        expression: '$F{CAMPO}',
        rawInnerContent: '<![CDATA[$F{CAMPO}]]>',
        hasCdata: true,
        expectedType: 'java.lang.Object',
        contextLabel: 'textFieldExpression (Nova)',
        language: defaultLang,
        tagStartOffset: 0,
        tagEndOffset: 0,
        contentStartOffset: 0,
        contentEndOffset: 0,
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 0,
        contentStartLine: 0,
        contentStartCharacter: 0,
        contentEndLine: 0,
        contentEndCharacter: 0
      };
    }

    const title = `Expression Editor: ${path.basename(targetDoc.fileName)}`;

    if (ExpressionEditorPanel.currentPanel) {
      const existing = ExpressionEditorPanel.currentPanel;
      existing.document = targetDoc;
      existing.activeOccurrence = targetOccurrence;
      existing.currentLanguage = targetOccurrence.language || 'groovy';
      existing.onAfterSaveCallback = options.onAfterSave;
      existing.panel.title = title;
      existing.panel.reveal(vscode.ViewColumn.Active, false);
      await existing.sendInitialState();
      return existing;
    }

    const webviewRoot = vscode.Uri.file(
      path.join(context.extensionPath, 'webviews', 'expression-editor')
    );
    const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, 'media'));

    const panel = vscode.window.createWebviewPanel(
      ExpressionEditorPanel.viewType,
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot, mediaRoot]
      }
    );

    ExpressionEditorPanel.currentPanel = new ExpressionEditorPanel(
      panel,
      context,
      jrxmlParser,
      outputChannel,
      targetDoc,
      targetOccurrence,
      options.onAfterSave
    );

    return ExpressionEditorPanel.currentPanel;
  }

  public static handleDidSaveTextDocument(document: vscode.TextDocument): void {
    if (!ExpressionEditorPanel.currentPanel) {
      return;
    }
    const current = ExpressionEditorPanel.currentPanel;
    if (
      path.resolve(current.document.uri.fsPath).toLowerCase() ===
      path.resolve(document.uri.fsPath).toLowerCase()
    ) {
      current.document = document;
    }
  }

  private getEnrichedMetadata(): JrxmlMetadata {
    const rawMeta = this.jrxmlParser.getMetadata(this.document);
    const existingParamNames = new Set(rawMeta.parameters.map((p) => p.name));
    const parameters = [...rawMeta.parameters];
    for (const bp of JASPER_BUILTIN_PARAMETERS) {
      if (!existingParamNames.has(bp.name)) {
        parameters.push(bp);
      }
    }

    const existingVarNames = new Set((rawMeta.variables || []).map((v) => v.name));
    const variables = [...(rawMeta.variables || [])];
    for (const bv of JASPER_BUILTIN_VARIABLES) {
      if (!existingVarNames.has(bv.name)) {
        variables.push(bv);
      }
    }

    return {
      ...rawMeta,
      parameters,
      variables
    };
  }

  public async sendInitialState(overrideExpression?: string): Promise<void> {
    const xmlText = this.document.getText();
    const allOccurrences = extractExpressionsFromXml(xmlText);
    const refreshedActive =
      allOccurrences.find((o) => o.id === this.activeOccurrence.id) ||
      allOccurrences.find(
        (o) =>
          o.tagName === this.activeOccurrence.tagName &&
          Math.abs(o.startLine - this.activeOccurrence.startLine) <= 5
      ) ||
      this.activeOccurrence;

    this.activeOccurrence = refreshedActive;
    const exprText =
      overrideExpression !== undefined ? overrideExpression : refreshedActive.expression;
    const metadata = this.getEnrichedMetadata();

    const mockEntries = generateMockDataForMetadata(metadata, exprText);
    for (const entry of mockEntries) {
      if (Object.prototype.hasOwnProperty.call(this.customMockValues, entry.refKey)) {
        const customVal = this.customMockValues[entry.refKey];
        if (customVal === null) {
          entry.isNull = true;
        } else {
          entry.value = customVal;
          entry.isNull = false;
        }
      }
    }

    const validation = validateExpression(exprText, metadata, {
      language: this.currentLanguage,
      expectedType: refreshedActive.expectedType,
      tagName: refreshedActive.tagName
    });

    const preview = evaluateExpressionWithMock(
      exprText,
      metadata,
      this.customMockValues,
      this.currentLanguage
    );

    await this.panel.webview.postMessage({
      command: 'initEditor',
      fileName: path.basename(this.document.fileName),
      filePath: this.document.uri.fsPath,
      language: this.currentLanguage,
      activeOccurrence: {
        id: refreshedActive.id,
        tagName: refreshedActive.tagName,
        expression: exprText,
        expectedType: refreshedActive.expectedType,
        contextLabel: refreshedActive.contextLabel,
        parentElementName: refreshedActive.parentElementName,
        startLine: refreshedActive.startLine + 1
      },
      allOccurrences: allOccurrences.map((o) => ({
        id: o.id,
        tagName: o.tagName,
        contextLabel: o.contextLabel,
        expression: o.expression,
        expectedType: o.expectedType,
        startLine: o.startLine + 1
      })),
      metadata: {
        fields: metadata.fields,
        parameters: metadata.parameters,
        variables: metadata.variables || []
      },
      snippets: EXPRESSION_SNIPPETS,
      groovyOperators: GROOVY_OPERATORS,
      builtinFunctions: JASPER_BUILTIN_FUNCTIONS.map((f) => ({
        name: f.name,
        signature: f.signature,
        description: f.description,
        insertText: f.insertText || `${f.name}()`
      })),
      staticClasses: getStaticClassNames(),
      mockEntries,
      validation,
      preview
    });
  }

  private async handleMessage(message: any): Promise<void> {
    if (!message || typeof message.command !== 'string') {
      return;
    }

    switch (message.command) {
      case 'ready': {
        await this.sendInitialState();
        break;
      }

      case 'validateAndPreview': {
        const exprText = typeof message.expression === 'string' ? message.expression : '';
        if (message.language === 'java' || message.language === 'groovy') {
          this.currentLanguage = message.language;
        }
        if (message.customMockValues && typeof message.customMockValues === 'object') {
          this.customMockValues = { ...message.customMockValues };
        }

        const metadata = this.getEnrichedMetadata();
        const mockEntries = generateMockDataForMetadata(metadata, exprText);
        for (const entry of mockEntries) {
          if (Object.prototype.hasOwnProperty.call(this.customMockValues, entry.refKey)) {
            const customVal = this.customMockValues[entry.refKey];
            if (customVal === null) {
              entry.isNull = true;
            } else {
              entry.value = customVal;
              entry.isNull = false;
            }
          }
        }

        const validation = validateExpression(exprText, metadata, {
          language: this.currentLanguage,
          expectedType: this.activeOccurrence.expectedType,
          tagName: this.activeOccurrence.tagName
        });

        const preview = evaluateExpressionWithMock(
          exprText,
          metadata,
          this.customMockValues,
          this.currentLanguage
        );

        await this.panel.webview.postMessage({
          command: 'validationAndPreviewResult',
          validation,
          preview,
          mockEntries
        });
        break;
      }

      case 'requestCompletions': {
        const exprText = typeof message.expression === 'string' ? message.expression : '';
        const cursorOffset =
          typeof message.cursorOffset === 'number' ? message.cursorOffset : exprText.length;
        const lang: ExpressionLanguage =
          message.language === 'java' ? 'java' : this.currentLanguage;
        const metadata = this.getEnrichedMetadata();
        const items = this.completionProvider.provideWebviewCompletions(
          exprText,
          cursorOffset,
          metadata,
          lang
        );

        await this.panel.webview.postMessage({
          command: 'completionsResult',
          requestId: message.requestId,
          items
        });
        break;
      }

      case 'switchExpression': {
        const targetId = String(message.expressionId || '');
        const allOccurrences = extractExpressionsFromXml(this.document.getText());
        const found = allOccurrences.find((o) => o.id === targetId);
        if (found) {
          this.activeOccurrence = found;
          await this.sendInitialState();
        }
        break;
      }

      case 'regenerateMockData': {
        this.customMockValues = {};
        const exprText =
          typeof message.expression === 'string'
            ? message.expression
            : this.activeOccurrence.expression;
        await this.sendInitialState(exprText);
        break;
      }

      case 'saveExpression': {
        const newExpression =
          typeof message.expression === 'string' ? message.expression.trim() : '';
        const closeAfterSave = Boolean(message.closeAfterSave);

        await this.saveExpressionToDocument(newExpression, closeAfterSave);
        break;
      }

      case 'revealInXml': {
        const editor = await vscode.window.showTextDocument(this.document, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: false
        });
        const pos = new vscode.Position(
          Math.max(0, this.activeOccurrence.startLine),
          Math.max(0, this.activeOccurrence.startCharacter)
        );
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter
        );
        break;
      }

      case 'closeEditor': {
        this.dispose();
        break;
      }
    }
  }

  private async saveExpressionToDocument(
    newExpression: string,
    closeAfterSave: boolean
  ): Promise<void> {
    try {
      if (this.activeOccurrence.tagEndOffset > this.activeOccurrence.tagStartOffset) {
        const applied = await applyExpressionEditToDocument(
          this.document,
          this.activeOccurrence,
          newExpression
        );
        if (!applied) {
          throw new Error('Não foi possível aplicar a edição no documento XML.');
        }
      } else {
        // Documento .jrexpr ou arquivo sem tag prévia
        const fullRange = new vscode.Range(
          this.document.positionAt(0),
          this.document.positionAt(this.document.getText().length)
        );
        const edit = new vscode.WorkspaceEdit();
        edit.replace(this.document.uri, fullRange, newExpression);
        await vscode.workspace.applyEdit(edit);
      }

      if (this.document.isDirty) {
        await this.document.save();
      }

      this.activeOccurrence = {
        ...this.activeOccurrence,
        expression: newExpression
      };

      const timestamp = new Date().toLocaleTimeString('pt-BR');
      this.outputChannel.appendLine(
        `[${timestamp}] [ExpressionEditor] Expressão salva em "${path.basename(
          this.document.fileName
        )}" (<${this.activeOccurrence.tagName}> L${this.activeOccurrence.startLine + 1})`
      );

      if (this.onAfterSaveCallback) {
        this.onAfterSaveCallback(this.document);
      }

      await this.panel.webview.postMessage({
        command: 'saveSuccess',
        expression: newExpression,
        message: `Expressão salva em <${this.activeOccurrence.tagName}> (Linha ${
          this.activeOccurrence.startLine + 1
        })`
      });

      void vscode.window.showInformationMessage(
        `Expressão atualizada em <${this.activeOccurrence.tagName}> (${path.basename(
          this.document.fileName
        )}).`
      );

      if (closeAfterSave) {
        this.dispose();
      } else {
        await this.sendInitialState(newExpression);
      }
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : 'Erro ao salvar expressão no XML.';
      await this.panel.webview.postMessage({
        command: 'saveError',
        message: errMessage
      });
      void vscode.window.showErrorMessage(`Falha ao salvar expressão: ${errMessage}`);
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = path.join(
      this.context.extensionPath,
      'webviews',
      'expression-editor',
      'index.html'
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'expression-editor', 'styles.css')
      )
    );
    const monacoUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(
          this.context.extensionPath,
          'media',
          'monaco',
          'monaco-expression-bundle.js'
        )
      )
    );
    const workerUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'media', 'monaco', 'expression-worker.js')
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'expression-editor', 'main.js')
      )
    );

    const nonce = crypto.randomBytes(16).toString('base64');
    let html = fs.readFileSync(htmlPath, 'utf8');

    html = html
      .replace(/\{\{cspSource\}\}/g, webview.cspSource)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{styleUri\}\}/g, styleUri.toString())
      .replace(/\{\{monacoUri\}\}/g, monacoUri.toString())
      .replace(/\{\{workerUri\}\}/g, workerUri.toString())
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString());

    return html;
  }

  public dispose(): void {
    ExpressionEditorPanel.currentPanel = undefined;
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

/**
 * CustomEditorProvider (`jasperExpressionEditor`) para arquivos `.jrexpr` (Requisito 4.1).
 */
export class JasperExpressionCustomEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'jasperExpressionEditor';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly jrxmlParser: JrxmlParser,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const webviewRoot = vscode.Uri.file(
      path.join(this.context.extensionPath, 'webviews', 'expression-editor')
    );
    const mediaRoot = vscode.Uri.file(path.join(this.context.extensionPath, 'media'));

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot, mediaRoot]
    };

    await ExpressionEditorPanel.createOrShow(
      this.context,
      this.jrxmlParser,
      this.outputChannel,
      {
        documentUri: document.uri,
        lineZeroBased: 0
      }
    );
  }
}
