import * as vscode from 'vscode';
import { JrxmlParser } from './jrxmlParser';
import {
  evaluateExpressionWithMock,
  extractExpressionsFromXml,
  JrxmlExpressionOccurrence,
  offsetToLineCol,
  validateExpression
} from './expressionEditor';

function shortenJavaType(fullType: string): string {
  if (!fullType) {
    return 'Object';
  }
  const idx = fullType.lastIndexOf('.');
  return idx >= 0 ? fullType.slice(idx + 1) : fullType;
}

/**
 * HoverProvider para expressões JasperReports no XML (.jrxml) e arquivos .jrexpr.
 * Exibe tipo inferido, resultado de preview com dados mock, referências utilizadas,
 * diagnósticos de validação e link direto para abrir o Expression Editor.
 */
export class ExpressionHoverProvider implements vscode.HoverProvider {
  constructor(private readonly jrxmlParser: JrxmlParser) {}

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    if (!document.fileName.toLowerCase().endsWith('.jrxml') && !document.fileName.toLowerCase().endsWith('.jrexpr')) {
      return undefined;
    }

    const xmlText = document.getText();
    const offset = document.offsetAt(position);
    const occurrences = extractExpressionsFromXml(xmlText);
    const occ = occurrences.find(
      (item) => offset >= item.tagStartOffset && offset <= item.tagEndOffset
    );

    if (!occ) {
      return undefined;
    }

    const metadata = this.jrxmlParser.getMetadata(document);
    const validation = validateExpression(occ.expression, metadata, {
      language: occ.language,
      expectedType: occ.expectedType,
      tagName: occ.tagName
    });
    const preview = evaluateExpressionWithMock(
      occ.expression,
      metadata,
      undefined,
      occ.language
    );

    const commandArgs = encodeURIComponent(
      JSON.stringify([document.uri.toString(), occ.id, occ.startLine])
    );
    const openCmdUri = `command:jasper.openExpressionEditor?${commandArgs}`;

    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;

    md.appendMarkdown(
      `### $(symbol-operator) Expressão JasperReports — \`<${occ.tagName}>\`\n\n`
    );
    md.appendMarkdown(
      `[$(edit) Abrir no Expression Editor](${openCmdUri}) &nbsp;|&nbsp; **Linguagem:** \`${occ.language.toUpperCase()}\` &nbsp;|&nbsp; **Contexto:** \`${occ.contextLabel}\`\n\n`
    );
    md.appendCodeblock(occ.expression || '// Expressão vazia', occ.language);

    const shortInferred = shortenJavaType(validation.inferredType);
    const shortExpected = shortenJavaType(occ.expectedType);
    md.appendMarkdown(
      `**Tipo Inferido:** \`${validation.inferredType}\` (${shortInferred}) &nbsp;•&nbsp; **Esperado:** \`${occ.expectedType}\` (${shortExpected})\n\n`
    );

    // Seção de Preview com Dados Mock
    if (preview.success) {
      md.appendMarkdown(
        `**$(play) Preview (Dados Mock):** \`${preview.formattedValue}\` *(${shortenJavaType(
          preview.resultType
        )}, ${preview.executionTimeMs}ms)*\n\n`
      );
    } else if (preview.error) {
      md.appendMarkdown(
        `**$(warning) Preview Runtime:** \`${preview.error.type}\` — ${preview.error.message}\n\n`
      );
    }

    // Referências utilizadas
    if (validation.references.length > 0) {
      md.appendMarkdown(`**Referências:**\n`);
      const seenRefs = new Set<string>();
      for (const ref of validation.references) {
        if (seenRefs.has(ref.raw)) {
          continue;
        }
        seenRefs.add(ref.raw);
        const mockVal = preview.mockDataUsed[ref.raw];
        const mockStr =
          mockVal !== undefined ? ` = \`${JSON.stringify(mockVal)}\`` : '';
        if (ref.exists) {
          md.appendMarkdown(
            `- \`${ref.raw}\` → \`${ref.className}\`${mockStr}${
              ref.description ? ` *(${ref.description})*` : ''
            }\n`
          );
        } else {
          md.appendMarkdown(
            `- $(error) \`${ref.raw}\` → **Referência inexistente no relatório**${
              ref.suggestion ? ` *(Sugestão: \`${ref.suggestion}\`)*` : ''
            }\n`
          );
        }
      }
      md.appendMarkdown('\n');
    }

    // Diagnósticos de Validação
    if (validation.diagnostics.length === 0) {
      md.appendMarkdown(`$(check) *Expressão válida — nenhum erro de sintaxe ou referência.*`);
    } else {
      md.appendMarkdown(`**Validação (${validation.diagnostics.length}):**\n`);
      for (const diag of validation.diagnostics) {
        const icon = diag.severity === 'error' ? '$(error)' : '$(warning)';
        md.appendMarkdown(`- ${icon} ${diag.message}\n`);
      }
    }

    const range = new vscode.Range(
      document.positionAt(occ.tagStartOffset),
      document.positionAt(occ.tagEndOffset)
    );
    return new vscode.Hover(md, range);
  }
}

/**
 * CodeLensProvider para tags de expressão no XML (.jrxml), exibindo "Editar Expressão"
 * e resumo de validação/preview acima de `<textFieldExpression>`, `<printWhenExpression>`, etc.
 */
export class ExpressionCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> =
    this._onDidChangeCodeLenses.event;

  constructor(private readonly jrxmlParser: JrxmlParser) {}

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    if (!document.fileName.toLowerCase().endsWith('.jrxml')) {
      return [];
    }

    const config = vscode.workspace.getConfiguration('jasper.expressionEditor');
    if (config.get<boolean>('enableCodeLens', true) === false) {
      return [];
    }

    const xmlText = document.getText();
    const occurrences = extractExpressionsFromXml(xmlText);
    if (occurrences.length === 0) {
      return [];
    }

    const metadata = this.jrxmlParser.getMetadata(document);
    const lenses: vscode.CodeLens[] = [];

    for (const occ of occurrences) {
      const range = new vscode.Range(
        new vscode.Position(occ.startLine, occ.startCharacter),
        new vscode.Position(occ.endLine, occ.endCharacter)
      );

      // 1. CodeLens principal: "Editar Expressão"
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(edit) Editar Expressão',
          tooltip: `Abrir "${occ.contextLabel}" no Jasper Expression Editor`,
          command: 'jasper.openExpressionEditor',
          arguments: [document.uri, occ.id, occ.startLine]
        })
      );

      // 2. CodeLens secundário: resumo de validação / tipo / preview
      const validation = validateExpression(occ.expression, metadata, {
        language: occ.language,
        expectedType: occ.expectedType,
        tagName: occ.tagName
      });

      const errorCount = validation.diagnostics.filter((d) => d.severity === 'error').length;
      const warnCount = validation.diagnostics.filter((d) => d.severity === 'warning').length;

      if (errorCount > 0) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `$(error) ${errorCount} erro(s) na expressão`,
            tooltip: validation.diagnostics.map((d) => d.message).join('\n'),
            command: 'jasper.openExpressionEditor',
            arguments: [document.uri, occ.id, occ.startLine]
          })
        );
      } else {
        const preview = evaluateExpressionWithMock(
          occ.expression,
          metadata,
          undefined,
          occ.language
        );
        const shortType = shortenJavaType(validation.inferredType);
        const previewSnippet = preview.success
          ? preview.formattedValue.length > 28
            ? `${preview.formattedValue.slice(0, 25)}...`
            : preview.formattedValue
          : 'Erro runtime';
        const warnSuffix = warnCount > 0 ? ` • $(warning) ${warnCount}` : '';

        lenses.push(
          new vscode.CodeLens(range, {
            title: `$(symbol-event) ${shortType} → ${previewSnippet}${warnSuffix}`,
            tooltip: `Tipo inferido: ${validation.inferredType}\nPreview (mock): ${preview.formattedValue}`,
            command: 'jasper.openExpressionEditor',
            arguments: [document.uri, occ.id, occ.startLine]
          })
        );
      }
    }

    return lenses;
  }
}

/**
 * CodeActionProvider (Quick Fix) para expressões JasperReports no XML:
 * - "Abrir no Expression Editor"
 * - Correção rápida de referências quebradas ($F{...}, $P{...}, $V{...}) quando há sugestão similar
 */
export class ExpressionCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.RefactorRewrite
  ];

  constructor(private readonly jrxmlParser: JrxmlParser) {}

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    _context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    if (!document.fileName.toLowerCase().endsWith('.jrxml')) {
      return [];
    }

    const xmlText = document.getText();
    const occurrences = extractExpressionsFromXml(xmlText);
    const cursorLine = range.start.line;

    const occ = occurrences.find(
      (item) => cursorLine >= item.startLine && cursorLine <= item.endLine
    );
    if (!occ) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];

    // 1. Quick Fix principal: "Abrir no Expression Editor"
    const openAction = new vscode.CodeAction(
      'Abrir no Expression Editor',
      vscode.CodeActionKind.QuickFix
    );
    openAction.command = {
      command: 'jasper.openExpressionEditor',
      title: 'Abrir no Expression Editor',
      arguments: [document.uri, occ.id, occ.startLine]
    };
    openAction.isPreferred = true;
    actions.push(openAction);

    // 2. Quick Fixes para referências quebradas com sugestão de nome similar
    const metadata = this.jrxmlParser.getMetadata(document);
    const validation = validateExpression(occ.expression, metadata, {
      language: occ.language,
      expectedType: occ.expectedType,
      tagName: occ.tagName
    });

    for (const diag of validation.diagnostics) {
      if (diag.replacement && diag.suggestion) {
        const fixRefAction = new vscode.CodeAction(
          `Substituir '${diag.replacement.target}' por '${diag.replacement.value}'`,
          vscode.CodeActionKind.QuickFix
        );
        const absStart = occ.contentStartOffset + diag.startOffset;
        const absEnd = occ.contentStartOffset + diag.endOffset;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(absStart), document.positionAt(absEnd)),
          diag.replacement.value
        );
        fixRefAction.edit = edit;
        actions.push(fixRefAction);
      }
    }

    return actions;
  }
}

/**
 * Gerenciador de diagnósticos inline (squiggly) no editor XML para expressões JasperReports.
 */
export class ExpressionDiagnosticsManager implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];
  private debounceTimer?: NodeJS.Timeout;

  constructor(private readonly jrxmlParser: JrxmlParser) {
    this.collection = vscode.languages.createDiagnosticCollection('jasper-expressions');

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.scheduleValidate(doc, 50)),
      vscode.workspace.onDidChangeTextDocument((e) => this.scheduleValidate(e.document, 250)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.collection.delete(doc.uri))
    );

    for (const doc of vscode.workspace.textDocuments) {
      if (doc.fileName.toLowerCase().endsWith('.jrxml')) {
        this.validateDocument(doc);
      }
    }
  }

  public scheduleValidate(document: vscode.TextDocument, delayMs = 200): void {
    if (!document.fileName.toLowerCase().endsWith('.jrxml')) {
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.validateDocument(document);
    }, delayMs);
  }

  public validateDocument(document: vscode.TextDocument): void {
    if (!document.fileName.toLowerCase().endsWith('.jrxml')) {
      return;
    }

    const config = vscode.workspace.getConfiguration('jasper.expressionEditor');
    if (config.get<boolean>('enableInlineValidation', true) === false) {
      this.collection.delete(document.uri);
      return;
    }

    const xmlText = document.getText();
    const occurrences = extractExpressionsFromXml(xmlText);
    const metadata = this.jrxmlParser.getMetadata(document);
    const vscodeDiagnostics: vscode.Diagnostic[] = [];

    for (const occ of occurrences) {
      if (!occ.expression.trim()) {
        continue;
      }
      const validation = validateExpression(occ.expression, metadata, {
        language: occ.language,
        expectedType: occ.expectedType,
        tagName: occ.tagName
      });

      for (const d of validation.diagnostics) {
        const absStart = occ.contentStartOffset + d.startOffset;
        const absEnd = occ.contentStartOffset + d.endOffset;
        const range = new vscode.Range(
          document.positionAt(absStart),
          document.positionAt(absEnd)
        );
        const severity =
          d.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : d.severity === 'warning'
              ? vscode.DiagnosticSeverity.Warning
              : vscode.DiagnosticSeverity.Information;

        const vDiag = new vscode.Diagnostic(range, d.message, severity);
        vDiag.code = d.code;
        vDiag.source = 'Jasper Expression';
        vscodeDiagnostics.push(vDiag);
      }
    }

    this.collection.set(document.uri, vscodeDiagnostics);
  }

  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.collection.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

export { offsetToLineCol, JrxmlExpressionOccurrence };
