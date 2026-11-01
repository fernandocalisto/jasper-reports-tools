import * as vscode from 'vscode';
import { JrxmlMetadata, JrxmlParser } from './jrxmlParser';
import {
  EXPRESSION_SNIPPETS,
  getCombinedMembersForType,
  getCombinedStaticMembers,
  getStaticClassNames,
  GROOVY_OPERATORS,
  JASPER_BUILTIN_FUNCTIONS,
  JASPER_BUILTIN_PARAMETERS,
  JASPER_BUILTIN_VARIABLES,
  normalizeJavaTypeName
} from './groovySignatureLibrary';
import {
  detectReportLanguage,
  ExpressionLanguage,
  extractExpressionsFromXml,
  inferExpressionType
} from './expressionEditor';

export const EXPRESSION_PROVIDER_SELECTOR: vscode.DocumentSelector = [
  { language: 'xml', pattern: '**/*.jrxml' },
  { language: 'groovy', pattern: '**/*.jrexpr' },
  { language: 'java', pattern: '**/*.jrexpr' },
  { pattern: '**/*.jrexpr' }
];

export interface WebviewCompletionItem {
  label: string;
  insertText: string;
  kind: 'field' | 'parameter' | 'variable' | 'method' | 'property' | 'constant' | 'class' | 'operator' | 'snippet' | 'function';
  detail: string;
  documentation: string;
  sortText: string;
  filterText?: string;
  replaceStartOffset: number;
  replaceEndOffset: number;
  isGroovyOnly?: boolean;
}

export class ExpressionCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly jrxmlParser: JrxmlParser) {}

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const fullLine = document.lineAt(position).text;
    const lineBeforeCursor = fullLine.substring(0, position.character);
    const xmlText = document.getText();
    const metadata = this.jrxmlParser.getMetadata(document);
    const language = detectReportLanguage(xmlText);
    const isInsideExpressionTag = this.isPositionInsideExpressionTag(
      xmlText,
      document.offsetAt(position),
      document.fileName
    );

    // 1. Contexto: $F{...}, $P{...} ou $V{...}
    const varMatch = lineBeforeCursor.match(/\$(F|P|V)\{([^}]*)$/);
    if (varMatch) {
      const type = varMatch[1] as 'F' | 'P' | 'V';
      const prefix = varMatch[2];
      const startCol = lineBeforeCursor.length - varMatch[0].length;
      const hasClosingBrace = fullLine[position.character] === '}';
      const endCol = hasClosingBrace ? position.character + 1 : position.character;
      const replaceRange = new vscode.Range(position.line, startCol, position.line, endCol);

      return this.buildReferenceCompletions(type, prefix, replaceRange, metadata);
    }

    // 1b. Contexto: usuário digitou '$' ou '$F' / '$P' / '$V'
    const dollarMatch = lineBeforeCursor.match(/\$(F|P|V)?$/);
    if (dollarMatch) {
      const filterType = dollarMatch[1] as 'F' | 'P' | 'V' | undefined;
      const startCol = lineBeforeCursor.length - dollarMatch[0].length;
      const replaceRange = new vscode.Range(
        position.line,
        startCol,
        position.line,
        position.character
      );
      const results: vscode.CompletionItem[] = [];
      if (!filterType || filterType === 'F') {
        results.push(...this.buildReferenceCompletions('F', '', replaceRange, metadata, '0'));
      }
      if (!filterType || filterType === 'P') {
        results.push(...this.buildReferenceCompletions('P', '', replaceRange, metadata, '1'));
      }
      if (!filterType || filterType === 'V') {
        results.push(...this.buildReferenceCompletions('V', '', replaceRange, metadata, '2'));
      }
      return results;
    }

    // 2. Contexto: operador estático — ex: Boolean.val<cursor>, DateUtils.add<cursor>, BigDecimal.<cursor>
    const staticMatch = lineBeforeCursor.match(/\b([A-Z][a-zA-Z0-9_]*)\.([a-zA-Z_$][\w$]*)?(\()?$/);
    if (staticMatch) {
      const className = staticMatch[1];
      const prefix = staticMatch[2] || '';
      const hasOpenParen = Boolean(staticMatch[3]);
      const staticItems = this.getStaticMemberCompletions(className, prefix, hasOpenParen);
      if (staticItems.length > 0) {
        return staticItems;
      }
    }

    // 3. Contexto: acesso a membro de instância com `.`, `?.` ou `*.` após expressão
    const memberAccessMatch = lineBeforeCursor.match(
      /([\s\S]+?)(?:\?\.|\*\.|\.)([a-zA-Z_$][\w$]*)?(\()?$/
    );
    if (memberAccessMatch) {
      const receiverExpr = this.extractReceiverExpression(memberAccessMatch[1]);
      const prefix = memberAccessMatch[2] || '';
      const hasOpenParen = Boolean(memberAccessMatch[3]);
      if (receiverExpr) {
        const inferredType = this.inferReceiverType(receiverExpr, metadata, language);
        if (inferredType) {
          return this.getInstanceMemberCompletions(
            inferredType,
            prefix,
            language,
            hasOpenParen
          );
        }
      }
    }

    // 4. Contexto: dentro de tag de expressão (<textFieldExpression>, etc.) -> Snippets (if, fmt, money, nullsafe, cond), operadores Groovy, classes estáticas e funções
    if (isInsideExpressionTag) {
      const wordMatch = lineBeforeCursor.match(/([a-zA-Z_?$*][a-zA-Z0-9_?.:$*]*)$/);
      const prefix = wordMatch ? wordMatch[1] : '';
      const startCol = position.character - prefix.length;
      const replaceRange = new vscode.Range(position.line, startCol, position.line, position.character);

      return this.getGeneralExpressionCompletions(
        prefix,
        replaceRange,
        metadata,
        language
      );
    }

    return [];
  }

  private isPositionInsideExpressionTag(
    xmlText: string,
    offset: number,
    fileName: string
  ): boolean {
    if (fileName.toLowerCase().endsWith('.jrexpr')) {
      return true;
    }
    const occurrences = extractExpressionsFromXml(xmlText);
    return occurrences.some(
      (occ) => offset >= occ.tagStartOffset && offset <= occ.tagEndOffset
    );
  }

  private buildReferenceCompletions(
    type: 'F' | 'P' | 'V',
    prefix: string,
    replaceRange: vscode.Range,
    metadata: JrxmlMetadata,
    sortPrefix = '0'
  ): vscode.CompletionItem[] {
    const rawItems =
      type === 'F'
        ? metadata.fields
        : type === 'P'
          ? this.mergeParametersWithBuiltIns(metadata)
          : this.mergeVariablesWithBuiltIns(metadata);

    const kind =
      type === 'F'
        ? vscode.CompletionItemKind.Field
        : type === 'P'
          ? vscode.CompletionItemKind.Property
          : vscode.CompletionItemKind.Variable;

    const normalizedPrefix = prefix.toLowerCase();

    return rawItems
      .filter((item) => item.name.toLowerCase().startsWith(normalizedPrefix))
      .map((item) => {
        const exprText = `$${type}{${item.name}}`;
        const ci = new vscode.CompletionItem(exprText, kind);
        ci.detail = item.description
          ? `${item.className} • ${item.description}`
          : item.className;
        ci.documentation = new vscode.MarkdownString(
          `\`\`\`groovy\n${exprText}\n\`\`\`\n\n**Tipo:** \`${item.className}\`${
            item.description ? `\n\n${item.description}` : ''
          }`
        );
        ci.range = replaceRange;
        ci.filterText = `${exprText} ${item.name}`;
        ci.sortText = `${sortPrefix}_${item.name}`;
        return ci;
      });
  }

  private mergeParametersWithBuiltIns(metadata: JrxmlMetadata) {
    const existingNames = new Set(metadata.parameters.map((p) => p.name));
    const merged = [...metadata.parameters];
    for (const bp of JASPER_BUILTIN_PARAMETERS) {
      if (!existingNames.has(bp.name)) {
        merged.push(bp);
      }
    }
    return merged;
  }

  private mergeVariablesWithBuiltIns(metadata: JrxmlMetadata) {
    const existingNames = new Set((metadata.variables || []).map((v) => v.name));
    const merged = [...(metadata.variables || [])];
    for (const bv of JASPER_BUILTIN_VARIABLES) {
      if (!existingNames.has(bv.name)) {
        merged.push(bv);
      }
    }
    return merged;
  }

  private extractReceiverExpression(rawBeforeDot: string): string {
    // Remove prefixo XML/CDATA caso a expressão esteja na mesma linha da tag
    let cleaned = rawBeforeDot;
    const cdataIdx = cleaned.lastIndexOf('<![CDATA[');
    if (cdataIdx >= 0) {
      cleaned = cleaned.slice(cdataIdx + 9);
    } else {
      const gtIdx = cleaned.lastIndexOf('>');
      if (gtIdx >= 0) {
        cleaned = cleaned.slice(gtIdx + 1);
      }
    }

    // Pega o operando mais à direita (após operadores binários de nível 0 como ?, :, +, -, ==, !=, &&, ||)
    const tokenSplit = cleaned.split(/(?:&&|\|\||==|!=|<=|>=|\?:|[?+*/,-])/);
    const candidate = (tokenSplit[tokenSplit.length - 1] || cleaned).trim();
    return candidate;
  }

  public inferReceiverType(
    receiverExpr: string,
    metadata: JrxmlMetadata,
    language: ExpressionLanguage = 'groovy'
  ): string | null {
    const trimmed = receiverExpr.trim();
    if (!trimmed) {
      return null;
    }

    // Construtor `new SimpleDateFormat(...)` ou `new DecimalFormat(...)`
    if (/new\s+(?:java\.text\.)?SimpleDateFormat\s*\([^)]*\)$/.test(trimmed)) {
      return 'java.text.SimpleDateFormat';
    }
    if (/new\s+(?:java\.text\.)?DecimalFormat\s*\([^)]*\)$/.test(trimmed)) {
      return 'java.text.DecimalFormat';
    }

    const inferred = inferExpressionType(trimmed, metadata, language);
    return inferred || 'java.lang.Object';
  }

  private getInstanceMemberCompletions(
    type: string,
    prefix: string,
    language: ExpressionLanguage,
    includeAllOnParen = false
  ): vscode.CompletionItem[] {
    if (type === 'java.text.SimpleDateFormat') {
      return getCombinedStaticMembers('SimpleDateFormat').map((m) => {
        const ci = new vscode.CompletionItem(m.name, m.kind);
        ci.detail = `${m.signature} — ${m.description}`;
        ci.documentation = new vscode.MarkdownString(`**${m.signature}**\n\n${m.doc}`);
        return ci;
      });
    }
    if (type === 'java.text.DecimalFormat') {
      return getCombinedStaticMembers('DecimalFormat').map((m) => {
        const ci = new vscode.CompletionItem(m.name, m.kind);
        ci.detail = `${m.signature} — ${m.description}`;
        ci.documentation = new vscode.MarkdownString(`**${m.signature}**\n\n${m.doc}`);
        return ci;
      });
    }

    const members = getCombinedMembersForType(type, language);
    const normalizedPrefix = prefix.toLowerCase();

    const filtered = includeAllOnParen
      ? members
      : members.filter((m) => m.name.toLowerCase().startsWith(normalizedPrefix));

    return filtered.map((m, idx) => {
      const isPrefixMatch = m.name.toLowerCase().startsWith(normalizedPrefix);
      const ci = new vscode.CompletionItem(
        {
          label: m.name,
          detail: m.isGroovyOnly ? ` (Groovy) — ${m.signature}` : ` — ${m.signature}`
        },
        m.kind
      );
      ci.detail = `${m.signature} — ${m.description}`;
      ci.documentation = new vscode.MarkdownString(
        `**${m.signature}**\n\n${m.doc}\n\n*Tipo receptor:* \`${type}\`${
          m.isGroovyOnly ? ' • *Groovy GDK*' : ''
        }`
      );
      ci.filterText = m.name;
      ci.sortText = `${isPrefixMatch ? '0' : '1'}_${m.isGroovyOnly ? '1' : '0'}_${String(
        idx
      ).padStart(2, '0')}_${m.name}`;
      return ci;
    });
  }

  private getStaticMemberCompletions(
    className: string,
    prefix: string,
    includeAllOnParen = false
  ): vscode.CompletionItem[] {
    const members = getCombinedStaticMembers(className);
    if (members.length === 0) {
      return [];
    }
    const normalizedPrefix = prefix.toLowerCase();

    const filtered = includeAllOnParen
      ? members
      : members.filter((m) => m.name.toLowerCase().startsWith(normalizedPrefix));

    return filtered.map((m, idx) => {
      const isPrefixMatch = m.name.toLowerCase().startsWith(normalizedPrefix);
      const ci = new vscode.CompletionItem(
        { label: m.name, detail: ` — ${m.signature}` },
        m.kind
      );
      ci.detail = `${className}.${m.signature} — ${m.description}`;
      ci.documentation = new vscode.MarkdownString(`**${className}.${m.signature}**\n\n${m.doc}`);
      ci.filterText = m.name;
      ci.sortText = `${isPrefixMatch ? '0' : '1'}_${String(idx).padStart(2, '0')}_${m.name}`;
      return ci;
    });
  }

  private getGeneralExpressionCompletions(
    prefix: string,
    replaceRange: vscode.Range,
    metadata: JrxmlMetadata,
    language: ExpressionLanguage
  ): vscode.CompletionItem[] {
    const normalizedPrefix = prefix.toLowerCase();
    const items: vscode.CompletionItem[] = [];

    // 1. Snippets de Expressão (if, fmt, money, nullsafe, cond)
    for (const snip of EXPRESSION_SNIPPETS) {
      if (!normalizedPrefix || snip.prefix.toLowerCase().startsWith(normalizedPrefix)) {
        const ci = new vscode.CompletionItem(
          { label: snip.prefix, description: snip.description },
          vscode.CompletionItemKind.Snippet
        );
        ci.detail = `Snippet Jasper: ${snip.expansion}`;
        ci.documentation = new vscode.MarkdownString(
          `**${snip.label}**\n\n\`\`\`groovy\n${snip.expansion}\n\`\`\`\n\n${snip.doc}`
        );
        ci.insertText = new vscode.SnippetString(
          this.convertExpansionToVscodeSnippet(snip.expansion)
        );
        ci.range = replaceRange;
        ci.filterText = snip.prefix;
        ci.sortText = `00_snip_${snip.prefix}`;
        items.push(ci);
      }
    }

    // 2. Operadores e keywords Groovy (?, ?., ?:, *., <=>, collect, findAll, sum, groupBy)
    if (language === 'groovy') {
      for (const op of GROOVY_OPERATORS) {
        if (!normalizedPrefix || op.operator.startsWith(normalizedPrefix) || op.label.toLowerCase().includes(normalizedPrefix)) {
          const ci = new vscode.CompletionItem(
            { label: op.operator.trim(), description: op.description },
            vscode.CompletionItemKind.Operator
          );
          ci.detail = `${op.signature} — ${op.description}`;
          ci.documentation = new vscode.MarkdownString(`**${op.label}**\n\n${op.doc}`);
          ci.insertText = op.insertText;
          ci.range = replaceRange;
          ci.sortText = `01_op_${op.operator}`;
          items.push(ci);
        }
      }
    }

    // 3. Classes estáticas (Boolean, Integer, BigDecimal, DateUtils, JRExtendedUtils, Math, etc.)
    for (const clsName of getStaticClassNames()) {
      if (!normalizedPrefix || clsName.toLowerCase().startsWith(normalizedPrefix)) {
        const ci = new vscode.CompletionItem(clsName, vscode.CompletionItemKind.Class);
        ci.detail = `Classe utilitária Java/Jasper (${clsName})`;
        ci.documentation = new vscode.MarkdownString(
          `Digite \`${clsName}.\` para listar métodos e constantes estáticas.`
        );
        ci.range = replaceRange;
        ci.sortText = `02_cls_${clsName}`;
        items.push(ci);
      }
    }

    // 4. Funções built-in do JasperReports (IF, CONCATENATE, NVL, ISNULL, DATEFORMAT, etc.)
    for (const fn of JASPER_BUILTIN_FUNCTIONS) {
      if (!normalizedPrefix || fn.name.toLowerCase().startsWith(normalizedPrefix)) {
        const ci = new vscode.CompletionItem(
          { label: fn.name, description: fn.description },
          vscode.CompletionItemKind.Function
        );
        ci.detail = fn.signature;
        ci.documentation = new vscode.MarkdownString(`**${fn.signature}**\n\n${fn.doc}`);
        ci.insertText = fn.insertText || `${fn.name}()`;
        ci.range = replaceRange;
        ci.sortText = `03_fn_${fn.name}`;
        items.push(ci);
      }
    }

    void metadata;
    return items;
  }

  private convertExpansionToVscodeSnippet(expansion: string): string {
    // Escapa `$` de `$F{}`, `$P{}`, `$V{}` e transforma placeholders conhecidos em tabstops
    return expansion
      .replace(/\$F\{CAMPO\}/g, '\\$F{${1:CAMPO}}')
      .replace(/\$F\{DATA\}/g, '\\$F{${1:DATA}}')
      .replace(/\$F\{VALOR\}/g, '\\$F{${1:VALOR}}')
      .replace(/\$F\{COND\}/g, '\\$F{${1:COND}}');
  }

  /**
   * Fornece itens de autocomplete estruturados para o Monaco Editor dentro do WebView modal (`ExpressionEditorPanel`).
   */
  public provideWebviewCompletions(
    expression: string,
    cursorOffset: number,
    metadata: JrxmlMetadata,
    language: ExpressionLanguage = 'groovy'
  ): WebviewCompletionItem[] {
    const safeOffset = Math.max(0, Math.min(expression.length, cursorOffset));
    const textBefore = expression.slice(0, safeOffset);
    const results: WebviewCompletionItem[] = [];

    // 1. $F{...}, $P{...}, $V{...}
    const varMatch = textBefore.match(/\$(F|P|V)\{([^}]*)$/);
    if (varMatch) {
      const type = varMatch[1] as 'F' | 'P' | 'V';
      const prefix = varMatch[2].toLowerCase();
      const replaceStartOffset = safeOffset - varMatch[0].length;
      const replaceEndOffset =
        expression[safeOffset] === '}' ? safeOffset + 1 : safeOffset;

      const list =
        type === 'F'
          ? metadata.fields
          : type === 'P'
            ? this.mergeParametersWithBuiltIns(metadata)
            : this.mergeVariablesWithBuiltIns(metadata);
      const itemKind =
        type === 'F' ? 'field' : type === 'P' ? 'parameter' : 'variable';

      for (const item of list) {
        if (!prefix || item.name.toLowerCase().startsWith(prefix)) {
          const refText = `$${type}{${item.name}}`;
          results.push({
            label: refText,
            insertText: refText,
            kind: itemKind,
            detail: item.className,
            documentation: item.description
              ? `${item.description} (${item.className})`
              : `Tipo: ${item.className}`,
            sortText: `0_${item.name}`,
            filterText: `${refText} ${item.name}`,
            replaceStartOffset,
            replaceEndOffset
          });
        }
      }
      return results;
    }

    // 1b. Digitou '$' ou '$F' / '$P' / '$V'
    const dollarMatch = textBefore.match(/\$(F|P|V)?$/);
    if (dollarMatch) {
      const filterType = dollarMatch[1] as 'F' | 'P' | 'V' | undefined;
      const replaceStartOffset = safeOffset - dollarMatch[0].length;
      const replaceEndOffset = safeOffset;

      const pushGroup = (
        t: 'F' | 'P' | 'V',
        list: Array<{ name: string; className: string; description?: string }>,
        k: 'field' | 'parameter' | 'variable',
        sortPrefix: string
      ) => {
        if (filterType && filterType !== t) {
          return;
        }
        for (const item of list) {
          const refText = `$${t}{${item.name}}`;
          results.push({
            label: refText,
            insertText: refText,
            kind: k,
            detail: item.className,
            documentation: item.description
              ? `${item.description} (${item.className})`
              : `Tipo: ${item.className}`,
            sortText: `${sortPrefix}_${item.name}`,
            filterText: `${refText} ${item.name}`,
            replaceStartOffset,
            replaceEndOffset
          });
        }
      };

      pushGroup('F', metadata.fields, 'field', '0');
      pushGroup('P', this.mergeParametersWithBuiltIns(metadata), 'parameter', '1');
      pushGroup('V', this.mergeVariablesWithBuiltIns(metadata), 'variable', '2');
      return results;
    }

    // 2. Classe estática: `Boolean.`, `Integer.`, `BigDecimal.`, `DateUtils.`, `JRExtendedUtils.`, `Math.`
    const staticMatch = textBefore.match(/\b([A-Z][a-zA-Z0-9_]*)\.([a-zA-Z_$][\w$]*)?$/);
    if (staticMatch) {
      const className = staticMatch[1];
      const prefix = (staticMatch[2] || '').toLowerCase();
      const replaceStartOffset = safeOffset - (staticMatch[2] || '').length;
      const members = getCombinedStaticMembers(className);
      if (members.length > 0) {
        members
          .filter((m) => !prefix || m.name.toLowerCase().startsWith(prefix))
          .forEach((m, idx) => {
            results.push({
              label: m.name,
              insertText: m.insertText || m.name,
              kind: m.kind === vscode.CompletionItemKind.Constant ? 'constant' : 'method',
              detail: `${className}.${m.signature}`,
              documentation: `${m.description} — ${m.doc}`,
              sortText: `0_${String(idx).padStart(2, '0')}_${m.name}`,
              replaceStartOffset,
              replaceEndOffset: safeOffset
            });
          });
        return results;
      }
    }

    // 3. Acesso a membro após `.`, `?.`, `*.`
    const memberMatch = textBefore.match(/([\s\S]+?)(?:\?\.|\*\.|\.)([a-zA-Z_$][\w$]*)?$/);
    if (memberMatch) {
      const receiverExpr = this.extractReceiverExpression(memberMatch[1]);
      const prefix = (memberMatch[2] || '').toLowerCase();
      const replaceStartOffset = safeOffset - (memberMatch[2] || '').length;
      const inferredType =
        this.inferReceiverType(receiverExpr, metadata, language) || 'java.lang.Object';

      const members =
        inferredType === 'java.text.SimpleDateFormat'
          ? getCombinedStaticMembers('SimpleDateFormat')
          : inferredType === 'java.text.DecimalFormat'
            ? getCombinedStaticMembers('DecimalFormat')
            : getCombinedMembersForType(inferredType, language);

      members
        .filter((m) => !prefix || m.name.toLowerCase().startsWith(prefix))
        .forEach((m, idx) => {
          results.push({
            label: m.name,
            insertText: m.insertText || (m.signature.includes('()') ? `${m.name}()` : m.name),
            kind: m.kind === vscode.CompletionItemKind.Property ? 'property' : 'method',
            detail: `${m.signature}${m.isGroovyOnly ? ' [Groovy]' : ''}`,
            documentation: `${m.description} — ${m.doc} (Tipo: ${normalizeJavaTypeName(
              inferredType
            )})`,
            sortText: `${m.isGroovyOnly ? '1' : '0'}_${String(idx).padStart(2, '0')}_${m.name}`,
            replaceStartOffset,
            replaceEndOffset: safeOffset,
            isGroovyOnly: m.isGroovyOnly
          });
        });

      return results;
    }

    // 4. Contexto geral: Snippets (if, fmt, money, nullsafe, cond) + Referências + Classes Estáticas + Operadores Groovy + Funções
    const wordMatch = textBefore.match(/([a-zA-Z0-9_$?.:*]+)$/);
    const prefix = wordMatch ? wordMatch[1] : '';
    const lowerPrefix = prefix.toLowerCase();
    const replaceStartOffset = safeOffset - prefix.length;

    for (const snip of EXPRESSION_SNIPPETS) {
      if (!lowerPrefix || snip.prefix.startsWith(lowerPrefix)) {
        results.push({
          label: snip.prefix,
          insertText: snip.expansion,
          kind: 'snippet',
          detail: snip.label,
          documentation: `${snip.description}\nExpande para: ${snip.expansion}`,
          sortText: `00_snip_${snip.prefix}`,
          replaceStartOffset,
          replaceEndOffset: safeOffset
        });
      }
    }

    for (const f of metadata.fields) {
      const refText = `$F{${f.name}}`;
      if (!lowerPrefix || f.name.toLowerCase().includes(lowerPrefix) || refText.toLowerCase().startsWith(lowerPrefix)) {
        results.push({
          label: refText,
          insertText: refText,
          kind: 'field',
          detail: f.className,
          documentation: f.description || `Campo do relatório (${f.className})`,
          sortText: `01_field_${f.name}`,
          replaceStartOffset,
          replaceEndOffset: safeOffset
        });
      }
    }

    for (const p of this.mergeParametersWithBuiltIns(metadata)) {
      const refText = `$P{${p.name}}`;
      if (!lowerPrefix || p.name.toLowerCase().includes(lowerPrefix) || refText.toLowerCase().startsWith(lowerPrefix)) {
        results.push({
          label: refText,
          insertText: refText,
          kind: 'parameter',
          detail: p.className,
          documentation: p.description || `Parâmetro do relatório (${p.className})`,
          sortText: `02_param_${p.name}`,
          replaceStartOffset,
          replaceEndOffset: safeOffset
        });
      }
    }

    for (const v of this.mergeVariablesWithBuiltIns(metadata)) {
      const refText = `$V{${v.name}}`;
      if (!lowerPrefix || v.name.toLowerCase().includes(lowerPrefix) || refText.toLowerCase().startsWith(lowerPrefix)) {
        results.push({
          label: refText,
          insertText: refText,
          kind: 'variable',
          detail: v.className,
          documentation: v.description || `Variável do relatório (${v.className})`,
          sortText: `03_var_${v.name}`,
          replaceStartOffset,
          replaceEndOffset: safeOffset
        });
      }
    }

    if (language === 'groovy') {
      for (const op of GROOVY_OPERATORS) {
        if (!lowerPrefix || op.operator.includes(lowerPrefix) || op.label.toLowerCase().includes(lowerPrefix)) {
          results.push({
            label: op.operator.trim(),
            insertText: op.insertText,
            kind: 'operator',
            detail: op.label,
            documentation: op.doc,
            sortText: `04_op_${op.operator}`,
            replaceStartOffset,
            replaceEndOffset: safeOffset,
            isGroovyOnly: true
          });
        }
      }
    }

    for (const clsName of getStaticClassNames()) {
      if (!lowerPrefix || clsName.toLowerCase().startsWith(lowerPrefix)) {
        results.push({
          label: clsName,
          insertText: `${clsName}.`,
          kind: 'class',
          detail: `Classe Java/Jasper (${clsName})`,
          documentation: `Acesso a membros estáticos de ${clsName}.`,
          sortText: `05_cls_${clsName}`,
          replaceStartOffset,
          replaceEndOffset: safeOffset
        });
      }
    }

    for (const fn of JASPER_BUILTIN_FUNCTIONS) {
      if (!lowerPrefix || fn.name.toLowerCase().startsWith(lowerPrefix)) {
        results.push({
          label: fn.name,
          insertText: fn.insertText || `${fn.name}()`,
          kind: 'function',
          detail: fn.signature,
          documentation: fn.doc,
          sortText: `06_fn_${fn.name}`,
          replaceStartOffset,
          replaceEndOffset: safeOffset
        });
      }
    }

    return results;
  }
}
