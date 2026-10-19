# Etapa 06: Snippets, XSD, Completion Provider, Field Viewer, Empacotamento e README

---

## 1. Objetivo da Etapa
Finalizar a extensão com produtividade de edição (XSD + Snippets + Completion Provider), visualização de campos da query, empacotamento `.vsix` validado e documentação completa para publicação no VS Code Marketplace.

---

## 2. Escopo Técnico e Requisitos

### 2.1 Schema XSD Oficial (`schemas/jasperreport.xsd`)
* Baixar/copiar o `jasperreport.xsd` oficial da versão do JasperReports usada (6.21.x).
* Registrar no `package.json`:
  ```json
  "jsonValidation": [
    { "fileMatch": "*.jrxml", "url": "./schemas/jasperreport.xsd" }
  ]
  ```
* **Resultado:** Validação em tempo real (squiggly vermelho), autocomplete de tags (`<band>`, `<textField>`, `<parameter>`, etc.) e atributos obrigatórios (`x`, `y`, `width`, `height` em `<reportElement>`).

### 2.2 Snippets Customizados (`snippets/jasper-snippets.json`)
Criar snippets para blocos hospitalares/genéricos:
| Prefixo | Expansão |
|---------|----------|
| `jtf` | `<textField>` completo com `reportElement`, `textElement`, `textFieldExpression` |
| `jband` | `<band>` com `splitType="Stretch"` |
| `jparam` | `<parameter name="" class="java.lang.String">` |
| `jfield` | `<field name="" class="java.lang.String">` |
| `jimg` | `<image>` com `onErrorType="Icon"` |
| `jsub` | `<subreport>` com `subreportExpression` e `connectionExpression` |
| `jcurrency` | `<textField>` formatado moeda BR (`R$ #,##0.00`) |
| `jdate` | `<textField>` formatado data BR (`dd/MM/yyyy`) |
| `jpage` | `<pageFooter>` com número de página `Page $V{PAGE_NUMBER} of $V{PAGE_COUNT}` |

Registrar no `package.json`:
```json
"snippets": [
  { "language": "xml", "path": "./snippets/jasper-snippets.json" }
]
```

### 2.3 Language Configuration (`.jrxml` como XML nativo)
No `package.json` → `contributes.languages` + `configuration`:
```json
"languages": [{
  "id": "xml",
  "extensions": [".jrxml"],
  "aliases": ["JRXML", "JasperReports XML"],
  "configuration": "./language-configuration.json"
}]
```
Criar `language-configuration.json`:
```json
{
  "comments": { "blockComment": ["<!--", "-->"] },
  "brackets": [["<!--", "-->"], ["<", ">"]],
  "autoClosingPairs": [
    { "open": "<", "close": ">" },
    { "open": "\"", "close": "\"", "notIn": ["string"] },
    { "open": "'", "close": "'", "notIn": ["string", "comment"] }
  ],
  "indentationRules": {
    "increaseIndentPattern": "^\\s*<(?![/!?])([\\w:.-]+)(?:\\s[^>]*)?>.*$",
    "decreaseIndentPattern": "^\\s*</([\\w:.-]+)>\\s*$"
  }
}
```

### 2.4 Completion Provider para `$F{` e `$P{` (`src/services/completionProvider.ts`)
Implementar `vscode.CompletionItemProvider` para disparar autocomplete dentro de expressões JasperReports:

```typescript
// Trigger characters: '$', '{'
const PROVIDER_SELECTOR = { language: 'xml', pattern: '**/*.jrxml' };

export class JasperCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly jrxmlParser: JrxmlParser) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const line = document.lineAt(position).text.substr(0, position.character);
    
    // 1. Contexto: $F{...} ou $P{...} ou $V{...} — completa nome do campo/parâmetro/variável
    const varMatch = line.match(/\$(F|P|V)\{([^}]*)$/);
    if (varMatch) {
      const type = varMatch[1]; // 'F' | 'P' | 'V'
      const prefix = varMatch[2];

      const metadata = this.jrxmlParser.getMetadata(document);
      const items = type === 'F'
        ? metadata.fields
        : type === 'P'
          ? metadata.parameters
          : metadata.variables || [];

      return items
        .filter(item => item.name.toLowerCase().startsWith(prefix.toLowerCase()))
        .map(item => {
          const ci = new vscode.CompletionItem(`$${type}{${item.name}}`, vscode.CompletionItemKind.Field);
          ci.detail = `${item.className} • ${item.description || ''}`;
          ci.documentation = new vscode.MarkdownString(
            `\`\`\`xml\n$${type}{${item.name}}\n\`\`\`\n\n**Tipo:** ${item.className}`
          );
          ci.filterText = item.name;
          ci.sortText = `0_${item.name}`;
          return ci;
        });
    }

    // 2. Contexto: dentro de expressão Java/Groovy — ex: $F{field}.eq<cursor>
    const exprMatch = line.match(/\$\w\{[^}]+\}\.([a-zA-Z_$][\w$]*)$/);
    if (exprMatch) {
      return this.getJavaMemberCompletions(line, exprMatch[1]);
    }

    // 3. Contexto: chamada de método estático ou classe — ex: Boolean.valueOf(<cursor>
    const staticMatch = line.match(/([A-Z][a-zA-Z0-9_]*)\.([a-zA-Z_$][\w$]*)$/);
    if (staticMatch) {
      return this.getStaticMemberCompletions(staticMatch[1], staticMatch[2]);
    }

    return [];
  }

  /**
   * Completar membros de instância (métodos/campos) do tipo do campo/parâmetro.
   * Ex: $F{NM_PACIENTE}.toUpp<cursor> → toUpperCase(), toLowerCase(), trim(), etc.
   */
  private getJavaMemberCompletions(line: string, prefix: string): vscode.CompletionItem[] {
    // Extrai o tipo do campo/parâmetro anterior ao '.'
    const type = this.inferExpressionType(line);
    if (!type) return [];

    const members = JAVA_STANDARD_LIBRARY[type] || JAVA_STANDARD_LIBRARY['java.lang.Object'];
    return members
      .filter(m => m.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .map(m => {
        const ci = new vscode.CompletionItem(m.name, m.kind);
        ci.detail = `${m.signature} — ${m.description}`;
        ci.documentation = new vscode.MarkdownString(m.doc);
        ci.filterText = m.name;
        return ci;
      });
  }

  /**
   * Completar membros estáticos de classes Java conhecidas.
   * Ex: Boolean.valueO<cursor> → valueOf(boolean), valueOf(String), etc.
   */
  private getStaticMemberCompletions(className: string, prefix: string): vscode.CompletionItem[] {
    const members = JAVA_STATIC_MEMBERS[className] || [];
    return members
      .filter(m => m.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .map(m => {
        const ci = new vscode.CompletionItem(m.name, m.kind);
        ci.detail = `${className}.${m.signature}`;
        ci.documentation = new vscode.MarkdownString(m.doc);
        ci.filterText = m.name;
        return ci;
      });
  }

  /**
   * Infere o tipo Java da expressão à esquerda do ponto.
   * Suporta: $F{name}, $P{name}, $V{name}, literais, casts.
   */
  private inferExpressionType(line: string): string | null {
    // $F{fieldName}
    const fieldMatch = line.match(/\$F\{(\w+)\}\s*\.\s*$/);
    if (fieldMatch) {
      const metadata = this.jrxmlParser.getMetadata(vscode.window.activeTextEditor?.document);
      const field = metadata.fields.find(f => f.name === fieldMatch[1]);
      return field?.className || null;
    }
    // $P{paramName}
    const paramMatch = line.match(/\$P\{(\w+)\}\s*\.\s*$/);
    if (paramMatch) {
      const metadata = this.jrxmlParser.getMetadata(vscode.window.activeTextEditor?.document);
      const param = metadata.parameters.find(p => p.name === paramMatch[1]);
      return param?.className || null;
    }
    // $V{varName}
    const varMatch = line.match(/\$V\{(\w+)\}\s*\.\s*$/);
    if (varMatch) {
      const metadata = this.jrxmlParser.getMetadata(vscode.window.activeTextEditor?.document);
      const variable = metadata.variables?.find(v => v.name === varMatch[1]);
      return variable?.className || null;
    }
    // Literais simples
    if (/["'`]/.test(line.slice(-1))) return 'java.lang.String';
    if (/^\d+(\.\d+)?$/.test(line.trim().split('.').pop() || '')) return 'java.lang.Number';
    if (/^(true|false)\s*\.\s*$/.test(line.trim())) return 'java.lang.Boolean';
    return null;
  }
}
```

**Biblioteca de assinaturas Java padrão** (`src/services/javaSignatureLibrary.ts`):

```typescript
// Membros de instância por tipo Java
export const JAVA_STANDARD_LIBRARY: Record<string, JavaMember[]> = {
  'java.lang.String': [
    { name: 'equals', kind: CompletionItemKind.Method, signature: 'equals(Object): boolean', description: 'Compara strings', doc: 'Retorna true se as strings são iguais.' },
    { name: 'equalsIgnoreCase', kind: CompletionItemKind.Method, signature: 'equalsIgnoreCase(String): boolean', description: 'Compara ignorando case', doc: '...' },
    { name: 'toString', kind: CompletionItemKind.Method, signature: 'toString(): String', description: 'Retorna a própria string', doc: '...' },
    { name: 'toUpperCase', kind: CompletionItemKind.Method, signature: 'toUpperCase(): String', description: 'Maiúsculas', doc: '...' },
    { name: 'toLowerCase', kind: CompletionItemKind.Method, signature: 'toLowerCase(): String', description: 'Minúsculas', doc: '...' },
    { name: 'trim', kind: CompletionItemKind.Method, signature: 'trim(): String', description: 'Remove espaços nas pontas', doc: '...' },
    { name: 'length', kind: CompletionItemKind.Property, signature: 'length: int', description: 'Tamanho da string', doc: '...' },
    { name: 'substring', kind: CompletionItemKind.Method, signature: 'substring(int, int): String', description: 'Substring', doc: '...' },
    { name: 'indexOf', kind: CompletionItemKind.Method, signature: 'indexOf(String): int', description: 'Posição da substring', doc: '...' },
    { name: 'contains', kind: CompletionItemKind.Method, signature: 'contains(CharSequence): boolean', description: 'Contém substring', doc: '...' },
    { name: 'startsWith', kind: CompletionItemKind.Method, signature: 'startsWith(String): boolean', description: 'Começa com', doc: '...' },
    { name: 'endsWith', kind: CompletionItemKind.Method, signature: 'endsWith(String): boolean', description: 'Termina com', doc: '...' },
    { name: 'replace', kind: CompletionItemKind.Method, signature: 'replace(CharSequence, CharSequence): String', description: 'Substitui', doc: '...' },
    { name: 'split', kind: CompletionItemKind.Method, signature: 'split(String): String[]', description: 'Divide por regex', doc: '...' },
    { name: 'format', kind: CompletionItemKind.Method, signature: 'format(String, Object...): String', description: 'Formata (printf)', doc: '...' },
    { name: 'valueOf', kind: CompletionItemKind.Method, signature: 'valueOf(Object): String', description: 'Converte para String', doc: '...' },
  ],
  'java.lang.Integer': [
    { name: 'intValue', kind: CompletionItemKind.Method, signature: 'intValue(): int', description: 'Valor primitivo', doc: '...' },
    { name: 'toString', kind: CompletionItemKind.Method, signature: 'toString(): String', description: 'Converte para String', doc: '...' },
    { name: 'equals', kind: CompletionItemKind.Method, signature: 'equals(Object): boolean', description: 'Compara valores', doc: '...' },
    { name: 'compareTo', kind: CompletionItemKind.Method, signature: 'compareTo(Integer): int', description: 'Compara ordenação', doc: '...' },
  ],
  'java.lang.Long': [ /* similar */ ],
  'java.lang.Double': [ /* similar */ ],
  'java.lang.Float': [ /* similar */ ],
  'java.math.BigDecimal': [
    { name: 'add', kind: CompletionItemKind.Method, signature: 'add(BigDecimal): BigDecimal', description: 'Soma', doc: '...' },
    { name: 'subtract', kind: CompletionItemKind.Method, signature: 'subtract(BigDecimal): BigDecimal', description: 'Subtração', doc: '...' },
    { name: 'multiply', kind: CompletionItemKind.Method, signature: 'multiply(BigDecimal): BigDecimal', description: 'Multiplicação', doc: '...' },
    { name: 'divide', kind: CompletionItemKind.Method, signature: 'divide(BigDecimal, RoundingMode): BigDecimal', description: 'Divisão com arredondamento', doc: '...' },
    { name: 'setScale', kind: CompletionItemKind.Method, signature: 'setScale(int, RoundingMode): BigDecimal', description: 'Define casas decimais', doc: '...' },
    { name: 'compareTo', kind: CompletionItemKind.Method, signature: 'compareTo(BigDecimal): int', description: 'Compara', doc: '...' },
    { name: 'toString', kind: CompletionItemKind.Method, signature: 'toString(): String', description: 'Para String', doc: '...' },
  ],
  'java.util.Date': [
    { name: 'getTime', kind: CompletionItemKind.Method, signature: 'getTime(): long', description: 'Timestamp (ms)', doc: '...' },
    { name: 'before', kind: CompletionItemKind.Method, signature: 'before(Date): boolean', description: 'É anterior?', doc: '...' },
    { name: 'after', kind: CompletionItemKind.Method, signature: 'after(Date): boolean', description: 'É posterior?', doc: '...' },
    { name: 'equals', kind: CompletionItemKind.Method, signature: 'equals(Object): boolean', description: 'Compara datas', doc: '...' },
    { name: 'compareTo', kind: CompletionItemKind.Method, signature: 'compareTo(Date): int', description: 'Ordenação', doc: '...' },
  ],
  'java.lang.Boolean': [
    { name: 'booleanValue', kind: CompletionItemKind.Method, signature: 'booleanValue(): boolean', description: 'Valor primitivo', doc: '...' },
    { name: 'toString', kind: CompletionItemKind.Method, signature: 'toString(): String', description: 'String "true"/"false"', doc: '...' },
  ],
  'java.lang.Object': [
    { name: 'toString', kind: CompletionItemKind.Method, signature: 'toString(): String', description: 'Representação textual', doc: '...' },
    { name: 'equals', kind: CompletionItemKind.Method, signature: 'equals(Object): boolean', description: 'Igualdade', doc: '...' },
    { name: 'hashCode', kind: CompletionItemKind.Method, signature: 'hashCode(): int', description: 'Hash code', doc: '...' },
    { name: 'getClass', kind: CompletionItemKind.Method, signature: 'getClass(): Class<?>', description: 'Runtime class', doc: '...' },
  ],
};

// Membros estáticos de classes comuns
export const JAVA_STATIC_MEMBERS: Record<string, JavaMember[]> = {
  'Boolean': [
    { name: 'valueOf', kind: CompletionItemKind.Method, signature: 'valueOf(boolean): Boolean', description: 'Boxing', doc: '...' },
    { name: 'valueOf', kind: CompletionItemKind.Method, signature: 'valueOf(String): Boolean', description: 'Parse "true"/"false"', doc: '...' },
    { name: 'parseBoolean', kind: CompletionItemKind.Method, signature: 'parseBoolean(String): boolean', description: 'Parse primitivo', doc: '...' },
    { name: 'TRUE', kind: CompletionItemKind.Constant, signature: 'TRUE: Boolean', description: 'Constante true', doc: '...' },
    { name: 'FALSE', kind: CompletionItemKind.Constant, signature: 'FALSE: Boolean', description: 'Constante false', doc: '...' },
  ],
  'Integer': [
    { name: 'valueOf', kind: CompletionItemKind.Method, signature: 'valueOf(int): Integer', description: 'Boxing', doc: '...' },
    { name: 'valueOf', kind: CompletionItemKind.Method, signature: 'valueOf(String): Integer', description: 'Parse int', doc: '...' },
    { name: 'parseInt', kind: CompletionItemKind.Method, signature: 'parseInt(String): int', description: 'Parse primitivo', doc: '...' },
    { name: 'toString', kind: CompletionItemKind.Method, signature: 'toString(int): String', description: 'Int para String', doc: '...' },
    { name: 'MAX_VALUE', kind: CompletionItemKind.Constant, signature: 'MAX_VALUE: int', description: '2^31-1', doc: '...' },
    { name: 'MIN_VALUE', kind: CompletionItemKind.Constant, signature: 'MIN_VALUE: int', description: '-2^31', doc: '...' },
  ],
  'Long': [ /* similar */ ],
  'Double': [ /* similar */ ],
  'BigDecimal': [
    { name: 'valueOf', kind: CompletionItemKind.Method, signature: 'valueOf(double): BigDecimal', description: 'Cria a partir de double', doc: '...' },
    { name: 'valueOf', kind: CompletionItemKind.Method, signature: 'valueOf(String): BigDecimal', description: 'Parse String', doc: '...' },
    { name: 'ZERO', kind: CompletionItemKind.Constant, signature: 'ZERO: BigDecimal', description: 'Constante 0', doc: '...' },
    { name: 'ONE', kind: CompletionItemKind.Constant, signature: 'ONE: BigDecimal', description: 'Constante 1', doc: '...' },
    { name: 'TEN', kind: CompletionItemKind.Constant, signature: 'TEN: BigDecimal', description: 'Constante 10', doc: '...' },
    { name: 'ROUND_HALF_UP', kind: CompletionItemKind.Constant, signature: 'ROUND_HALF_UP: RoundingMode', description: 'Arredondamento padrão', doc: '...' },
    { name: 'ROUND_HALF_EVEN', kind: CompletionItemKind.Constant, signature: 'ROUND_HALF_EVEN: RoundingMode', description: 'Arredondamento bancário', doc: '...' },
  ],
  'String': [
    { name: 'valueOf', kind: CompletionItemKind.Method, signature: 'valueOf(Object): String', description: 'Qualquer objeto para String', doc: '...' },
    { name: 'format', kind: CompletionItemKind.Method, signature: 'format(String, Object...): String', description: 'Format estilo printf', doc: '...' },
    { name: 'join', kind: CompletionItemKind.Method, signature: 'join(CharSequence, Iterable): String', description: 'Junta com delimitador', doc: '...' },
  ],
  'Math': [
    { name: 'round', kind: CompletionItemKind.Method, signature: 'round(double): long', description: 'Arredonda', doc: '...' },
    { name: 'floor', kind: CompletionItemKind.Method, signature: 'floor(double): double', description: 'Chão', doc: '...' },
    { name: 'ceil', kind: CompletionItemKind.Method, signature: 'ceil(double): double', description: 'Teto', doc: '...' },
    { name: 'abs', kind: CompletionItemKind.Method, signature: 'abs(double): double', description: 'Valor absoluto', doc: '...' },
    { name: 'max', kind: CompletionItemKind.Method, signature: 'max(double, double): double', description: 'Máximo', doc: '...' },
    { name: 'min', kind: CompletionItemKind.Method, signature: 'min(double, double): double', description: 'Mínimo', doc: '...' },
    { name: 'PI', kind: CompletionItemKind.Constant, signature: 'PI: double', description: '3.14159...', doc: '...' },
  ],
  'DateUtils': [ // JasperReports built-in
    { name: 'addDays', kind: CompletionItemKind.Method, signature: 'addDays(Date, int): Date', description: 'Adiciona dias', doc: '...' },
    { name: 'addMonths', kind: CompletionItemKind.Method, signature: 'addMonths(Date, int): Date', description: 'Adiciona meses', doc: '...' },
    { name: 'addYears', kind: CompletionItemKind.Method, signature: 'addYears(Date, int): Date', description: 'Adiciona anos', doc: '...' },
    { name: 'toDate', kind: CompletionItemKind.Method, signature: 'toDate(String, String): Date', description: 'Parse com formato', doc: '...' },
    { name: 'format', kind: CompletionItemKind.Method, signature: 'format(Date, String): String', description: 'Formata data', doc: '...' },
  ],
  'JRExtendedUtils': [ // JasperReports built-in
    { name: 'formatCurrency', kind: CompletionItemKind.Method, signature: 'formatCurrency(Number, Locale): String', description: 'Formata moeda', doc: '...' },
    { name: 'formatNumber', kind: CompletionItemKind.Method, signature: 'formatNumber(Number, String, Locale): String', description: 'Formata número', doc: '...' },
  ],
};

interface JavaMember {
  name: string;
  kind: vscode.CompletionItemKind;
  signature: string;
  description: string;
  doc: string;
}
```

Registrar no `extension.ts`:
```typescript
context.subscriptions.push(
  vscode.languages.registerCompletionItemProvider(
    { language: 'xml', pattern: '**/*.jrxml' },
    new JasperCompletionProvider(jrxmlParser),
    '$', '{', '.', '(' // trigger chars
  )
);
```

---

### 2.5 Field Viewer Panel — Visualização de Fields da Query (`src/webviewPanels/fieldViewerPanel.ts` + `webviews/field-viewer/`)
Painel lateral (TreeView ou Webview) que mostra **campos extraídos da query SQL do relatório** com tipos:

| Coluna | Fonte |
|--------|-------|
| **Nome** | `<field name="...">` |
| **Tipo Java** | `<field class="java.lang.String|Integer|Date|...">` |
| **Tipo JDBC** | (se disponível via `DatabaseMetaData` ao testar conexão) |
| **Origem** | `queryString` do `<queryString>` |

**Funcionamento:**
1. Ao abrir um `.jrxml`, o `jrxmlParser` extrai `fields[]` + `queryString`.
2. Se houver `queryString` e conexão ativa, opção **"Analisar Query no Banco"** executa `EXPLAIN` / `DESCRIBE` ou `SELECT * FROM (...) LIMIT 0` via `RunnerService` para obter metadados JDBC reais (nome da coluna, tipo SQL, nullable).
3. Exibe em TreeView ou Webview tabelar:
   ```
   │ Field Name        │ Java Class           │ JDBC Type    │ Nullable │
   ├───────────────────┼──────────────────────┼──────────────┼──────────┤
   │ CD_ATENDIMENTO    │ java.lang.Integer    │ INTEGER      │ NO       │
   │ NM_PACIENTE       │ java.lang.String     │ VARCHAR(200) │ YES      │
   │ DT_NASCIMENTO     │ java.util.Date       │ DATE         │ YES      │
   │ VL_TOTAL          │ java.math.BigDecimal │ DECIMAL(10,2)│ NO       │
   ```
4. Clique no field → copia `$F{CD_ATENDIMENTO}` para clipboard.
5. Botão "Atualizar Tipos" re-executa a introspecção no banco.

**Arquivos:**
* `src/services/fieldAnalyzer.ts` — usa `runnerService` + `DatabaseMetaData` via CLI Java (nova action `inspect-query`) ou JDBC direto.
* `src/webviewPanels/fieldViewerPanel.ts` — Webview com tabela interativa.
* `webviews/field-viewer/` — HTML/CSS/JS (tabela, cópia, refresh).
* Comando `jasper.openFieldViewer` + entrada no menu de contexto do editor `.jrxml`.

### 2.6 CLI Java — Nova Action `inspect-query` (`java-engine/`)
Adicionar em `CommandHandler.java` / `JasperProcessor.java`:
* `--action inspect-query` — recebe `--input` (`.jrxml`), `--db-url`, `--db-user`, `--db-pass`, `--params` (opcional).
* Executa a query do relatório com `LIMIT 0` (ou `TOP 0` / `WHERE 1=0`) via `PreparedStatement`.
* Retorna `ResultSetMetaData` → JSON:
  ```json
  {
    "status": "SUCCESS",
    "columns": [
      { "name": "CD_ATENDIMENTO", "jdbcType": "INTEGER", "precision": 10, "scale": 0, "nullable": 0, "javaClass": "java.lang.Integer" },
      { "name": "NM_PACIENTE", "jdbcType": "VARCHAR", "precision": 200, "scale": 0, "nullable": 1, "javaClass": "java.lang.String" }
    ]
  }
  ```

### 2.7 Ícones de Arquivo Customizados
* `media/icons/file-jrxml.svg` + `media/icons/file-jasper.svg`
* `package.json` → `contributes.iconThemes` ou `file associations` (VS Code 1.85+ suporta `iconDefinitions` + `fileExtensions`).

### 2.8 Build, Package e Validação `.vsix`
1. `npm install -g @vscode/vsce` (ou `npx vsce`)
2. `npm run compile` → `npm run package` (script: `"package": "vsce package"`)
3. Validações:
   * `vsce ls` — lista arquivos que entram no pacote
   * `code --install-extension jasper-reports-tools-0.1.0.vsix` — teste instalação local
   * Verificar: ativação, comandos, views, snippets, XSD, preview, JasperServer

### 2.9 README.md Completo
Estrutura mínima:
```markdown
# JasperReports Developer Tools
Extensão leve para VS Code — substitui Jaspersoft Studio.

## Requisitos
- Java 11+ no PATH
- VS Code 1.85+

## Instalação
1. Baixe `.vsix` → `Extensões → ... → Instalar a partir de VSIX`
2. Ou publique no Marketplace.

## Configuração Rápida
1. Abra a view **JasperReports** (barra lateral).
2. **Conexões de Banco** → `+` → PostgreSQL/Oracle/Personalizado → **Testar** → **Salvar**.
3. Defina como ativa (Status Bar).

## Funcionalidades
- **Edição .jrxml**: XSD validation, snippets (`jtf`, `jband`...), autocomplete `$F{`/`$P{`.
- **Preview Dividido (Split)**: `Ctrl+Shift+V` → formulário parâmetros, PDF.js, Live Reload.
- **Compilar**: `Ctrl+Shift+B` → gera `.jasper`.
- **JasperServer Explorer**: navegar, baixar, deploy `.jasper`, criar novo `.jrxml`.
- **Field Viewer**: veja campos da query com tipos JDBC reais.

## Atalhos
| Ação | Atalho |
|------|--------|
| Compilar | `Ctrl+Shift+B` |
| Preview Split | `Ctrl+Shift+V` |
| Abrir Field Viewer | `Ctrl+Shift+F` (sugerido) |

## Troubleshooting
- "Java not found" → instale JDK 11+ e adicione ao PATH.
- "Driver não encontrado" → use driver customizado (.jar) na conexão.
- PDF não renderiza → verifique Output → JasperReports.
```

---

## 3. Critérios de Aceite

| Critério | Validação |
|----------|-----------|
| XSD ativo | Abrir `.jrxml` inválido → squiggly vermelho em tag/atributo errado |
| Snippets | Digitar `jtf` + Tab → insere textField completo |
| Completion `$F{` | Digitar `$F{CD_` → lista `CD_ATENDIMENTO`, `CD_PACIENTE`... |
| Completion `$P{` | Digitar `$P{` → lista parâmetros do relatório |
| **Completion Java em expressão** | Digitar `$F{NM_PACIENTE}.toUpp` → sugere `toUpperCase()`, `toLowerCase()`, `trim()` |
| **Completion estático** | Digitar `Boolean.valueO` → sugere `valueOf(boolean)`, `valueOf(String)`, `parseBoolean` |
| **Completion BigDecimal** | Digitar `$F{VL_TOTAL}.add(` → sugere `add(BigDecimal)`, `subtract`, `multiply`, `divide`, `setScale` |
| **Completion DateUtils (JR)** | Digitar `DateUtils.addD` → sugere `addDays(Date, int)`, `addMonths`, `addYears` |
| Field Viewer | Abre painel → mostra campos com tipo Java + JDBC → clica → copia `$F{...}` |
| `inspect-query` CLI | `java -jar jasper-cli.jar --action inspect-query ...` → JSON com colunas |
| `.vsix` gera | `npm run package` → arquivo `.vsix` válido |
| Instalação local | `code --install-extension *.vsix` → extensão carrega sem erros |
| README | Existe, completo, em português |

---

## 4. Instruções para o AGY

1. **Criar/baixar** `schemas/jasperreport.xsd` (versão 6.21.x).
2. **Criar** `snippets/jasper-snippets.json` com tabela acima.
3. **Criar** `language-configuration.json` + registrar em `package.json`.
4. **Implementar** `src/services/completionProvider.ts` + `src/services/javaSignatureLibrary.ts` + registrar em `extension.ts`.
5. **Adicionar action `inspect-query`** no `java-engine` (Main, CommandHandler, JasperProcessor, OutputPayload) → rebuild `bin/jasper-cli.jar`.
6. **Criar** `src/services/fieldAnalyzer.ts` (usa `runnerService` + nova action CLI).
7. **Criar** `src/webviewPanels/fieldViewerPanel.ts` + `webviews/field-viewer/` (HTML/CSS/JS).
8. **Registrar** comando `jasper.openFieldViewer` + menu de contexto editor `.jrxml`.
9. **Adicionar ícones** `file-jrxml.svg`, `file-jasper.svg` + `iconTheme` no `package.json`.
10. **Atualizar** `package.json` com `jsonValidation`, `snippets`, `languages`, `iconThemes`.
11. **Executar** `npm run compile` → `npm run package` → validar `.vsix`.
12. **Criar** `README.md` + `CHANGELOG.md` + bump `package.json` version.

---

## 5. Arquivos Novos/Modificados Esperados

| Caminho | Tipo |
|---------|------|
| `schemas/jasperreport.xsd` | Novo (asset) |
| `snippets/jasper-snippets.json` | Novo |
| `language-configuration.json` | Novo |
| `media/icons/file-jrxml.svg` | Novo |
| `media/icons/file-jasper.svg` | Novo |
| `src/services/completionProvider.ts` | Novo |
| `src/services/javaSignatureLibrary.ts` | Novo |
| `src/services/fieldAnalyzer.ts` | Novo |
| `src/webviewPanels/fieldViewerPanel.ts` | Novo |
| `webviews/field-viewer/` | Novo (3 arquivos) |
| `java-engine/src/main/java/.../CommandHandler.java` | Modificado (inspect-query) |
| `java-engine/src/main/java/.../JasperProcessor.java` | Modificado |
| `java-engine/src/main/java/.../OutputPayload.java` | Modificado |
| `package.json` | Modificado (contributes + scripts) |
| `README.md` | Novo |
| `CHANGELOG.md` | Novo |