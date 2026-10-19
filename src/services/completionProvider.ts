import * as vscode from 'vscode';
import { JrxmlParser } from './jrxmlParser';
import { JAVA_STANDARD_LIBRARY, JAVA_STATIC_MEMBERS } from './javaSignatureLibrary';

export const PROVIDER_SELECTOR: vscode.DocumentSelector = {
  language: 'xml',
  pattern: '**/*.jrxml'
};

export class JasperCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly jrxmlParser: JrxmlParser) {}

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const fullLine = document.lineAt(position).text;
    const line = fullLine.substring(0, position.character);

    // 1. Contexto: $F{...} ou $P{...} ou $V{...} — completa nome do campo/parâmetro/variável
    const varMatch = line.match(/\$(F|P|V)\{([^}]*)$/);
    if (varMatch) {
      const type = varMatch[1] as 'F' | 'P' | 'V';
      const prefix = varMatch[2];
      const startCol = line.length - varMatch[0].length;
      const hasClosingBrace = fullLine[position.character] === '}';
      const endCol = hasClosingBrace ? position.character + 1 : position.character;
      const replaceRange = new vscode.Range(position.line, startCol, position.line, endCol);

      const metadata = this.jrxmlParser.getMetadata(document);
      const items =
        type === 'F'
          ? metadata.fields
          : type === 'P'
            ? metadata.parameters
            : metadata.variables || [];

      const kind =
        type === 'F'
          ? vscode.CompletionItemKind.Field
          : type === 'P'
            ? vscode.CompletionItemKind.Property
            : vscode.CompletionItemKind.Variable;

      return items
        .filter((item) => item.name.toLowerCase().startsWith(prefix.toLowerCase()))
        .map((item) => {
          const exprText = `$${type}{${item.name}}`;
          const ci = new vscode.CompletionItem(exprText, kind);
          ci.detail = item.description
            ? `${item.className} • ${item.description}`
            : item.className;
          ci.documentation = new vscode.MarkdownString(
            `\`\`\`xml\n${exprText}\n\`\`\`\n\n**Tipo:** \`${item.className}\`${
              item.description ? `\n\n${item.description}` : ''
            }`
          );
          ci.range = replaceRange;
          ci.filterText = `${exprText} ${item.name}`;
          ci.sortText = `0_${item.name}`;
          return ci;
        });
    }

    // 1b. Contexto: usuário digitou apenas '$' ou '$F' / '$P' / '$V'
    const dollarMatch = line.match(/\$(F|P|V)?$/);
    if (dollarMatch) {
      const filterType = dollarMatch[1] as 'F' | 'P' | 'V' | undefined;
      const startCol = line.length - dollarMatch[0].length;
      const replaceRange = new vscode.Range(
        position.line,
        startCol,
        position.line,
        position.character
      );
      const metadata = this.jrxmlParser.getMetadata(document);
      const results: vscode.CompletionItem[] = [];

      const addGroup = (
        type: 'F' | 'P' | 'V',
        list: Array<{ name: string; className: string; description?: string }>,
        kind: vscode.CompletionItemKind,
        sortPrefix: string
      ) => {
        if (filterType && filterType !== type) {
          return;
        }
        for (const item of list) {
          const exprText = `$${type}{${item.name}}`;
          const ci = new vscode.CompletionItem(exprText, kind);
          ci.detail = item.description
            ? `${item.className} • ${item.description}`
            : item.className;
          ci.documentation = new vscode.MarkdownString(
            `\`\`\`xml\n${exprText}\n\`\`\`\n\n**Tipo:** \`${item.className}\``
          );
          ci.range = replaceRange;
          ci.filterText = `${exprText} ${item.name}`;
          ci.sortText = `${sortPrefix}_${item.name}`;
          results.push(ci);
        }
      };

      addGroup('F', metadata.fields, vscode.CompletionItemKind.Field, '0');
      addGroup('P', metadata.parameters, vscode.CompletionItemKind.Property, '1');
      addGroup('V', metadata.variables || [], vscode.CompletionItemKind.Variable, '2');
      return results;
    }

    // 2. Contexto: dentro de expressão Java/Groovy — ex: $F{field}.eq<cursor> ou $F{VL_TOTAL}.add(<cursor>
    const exprMatch = line.match(/\$\w\{[^}]+\}\.([a-zA-Z_$][\w$]*)?(\()?$/);
    if (exprMatch) {
      const prefix = exprMatch[1] || '';
      const hasOpenParen = Boolean(exprMatch[2]);
      return this.getJavaMemberCompletions(line, prefix, document, hasOpenParen);
    }

    // 3. Contexto: chamada de método estático ou classe — ex: Boolean.valueOf(<cursor> ou DateUtils.addD<cursor>
    const staticMatch = line.match(/\b([A-Z][a-zA-Z0-9_]*)\.([a-zA-Z_$][\w$]*)?(\()?$/);
    if (staticMatch) {
      const className = staticMatch[1];
      const prefix = staticMatch[2] || '';
      const hasOpenParen = Boolean(staticMatch[3]);
      return this.getStaticMemberCompletions(className, prefix, hasOpenParen);
    }

    return [];
  }

  /**
   * Completar membros de instância (métodos/campos) do tipo do campo/parâmetro.
   * Ex: $F{NM_PACIENTE}.toUpp<cursor> → toUpperCase(), toLowerCase(), trim(), etc.
   */
  private getJavaMemberCompletions(
    line: string,
    prefix: string,
    document?: vscode.TextDocument,
    includeAllOnParen = false
  ): vscode.CompletionItem[] {
    const type = this.inferExpressionType(line, document);
    if (!type) {
      return [];
    }

    const members = JAVA_STANDARD_LIBRARY[type] || JAVA_STANDARD_LIBRARY['java.lang.Object'] || [];
    const normalizedPrefix = prefix.toLowerCase();

    const filtered = includeAllOnParen
      ? members
      : members.filter((m) => m.name.toLowerCase().startsWith(normalizedPrefix));

    return filtered.map((m, idx) => {
      const isPrefixMatch = m.name.toLowerCase().startsWith(normalizedPrefix);
      const ci = new vscode.CompletionItem(m.name, m.kind);
      ci.detail = `${m.signature} — ${m.description}`;
      ci.documentation = new vscode.MarkdownString(
        `**${m.signature}**\n\n${m.doc}\n\n*Tipo base:* \`${type}\``
      );
      ci.filterText = m.name;
      ci.sortText = `${isPrefixMatch ? '0' : '1'}_${String(idx).padStart(2, '0')}_${m.name}`;
      return ci;
    });
  }

  /**
   * Completar membros estáticos de classes Java conhecidas.
   * Ex: Boolean.valueO<cursor> → valueOf(boolean), valueOf(String), etc.
   */
  private getStaticMemberCompletions(
    className: string,
    prefix: string,
    includeAllOnParen = false
  ): vscode.CompletionItem[] {
    const members = JAVA_STATIC_MEMBERS[className] || [];
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

  /**
   * Infere o tipo Java da expressão à esquerda do ponto.
   * Suporta: $F{name}, $P{name}, $V{name}, literais, casts.
   */
  public inferExpressionType(line: string, document?: vscode.TextDocument): string | null {
    const doc = document ?? vscode.window.activeTextEditor?.document;

    // $F{fieldName}
    const fieldMatch = line.match(/\$F\{([^}]+)\}\s*\.\s*[a-zA-Z0-9_$]*\(?$/);
    if (fieldMatch) {
      const metadata = this.jrxmlParser.getMetadata(doc);
      const field = metadata.fields.find((f) => f.name === fieldMatch[1].trim());
      return field?.className || null;
    }

    // $P{paramName}
    const paramMatch = line.match(/\$P\{([^}]+)\}\s*\.\s*[a-zA-Z0-9_$]*\(?$/);
    if (paramMatch) {
      const metadata = this.jrxmlParser.getMetadata(doc);
      const param = metadata.parameters.find((p) => p.name === paramMatch[1].trim());
      return param?.className || null;
    }

    // $V{varName}
    const varMatch = line.match(/\$V\{([^}]+)\}\s*\.\s*[a-zA-Z0-9_$]*\(?$/);
    if (varMatch) {
      const metadata = this.jrxmlParser.getMetadata(doc);
      const variable = metadata.variables?.find((v) => v.name === varMatch[1].trim());
      return variable?.className || null;
    }

    // Literais simples
    const beforeDot = line.replace(/\.\s*[a-zA-Z0-9_$]*\(?$/, '').trim();
    if (/["'`]$/.test(beforeDot)) {
      return 'java.lang.String';
    }
    if (/(?:^|[^\w$])\d+(?:\.\d+)?$/.test(beforeDot)) {
      return 'java.lang.Number';
    }
    if (/\b(?:true|false)$/.test(beforeDot)) {
      return 'java.lang.Boolean';
    }

    return null;
  }
}
