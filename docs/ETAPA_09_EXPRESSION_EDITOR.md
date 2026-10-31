# Etapa 9: Expression Editor Avançado

---

## 1. Objetivo
Editor dedicado para expressões JasperReports (Java/Groovy) com **syntax highlighting**, **autocomplete contextual**, **validação em tempo real** e **preview de resultado**, substituindo o editor de texto simples atual.

---

## 2. Contexto e Dor Atual
- Expressões hoje são editadas no XML como string simples: `<textFieldExpression><![CDATA[$F{VL_TOTAL}.multiply(1.1).setScale(2)]]></textFieldExpression>`
- Sem highlight, sem autocomplete, sem validação
- Erros só aparecem na compilação (feedback lento)
- Groovy vs Java: sintaxe diferente, métodos diferentes

---

## 3. Requisitos Funcionais

### 3.1 Editor Dedicado (WebView ou Custom Editor)
- **Abertura**: Clique no ícone `pencil` ao lado de `<textFieldExpression>`, `<parameter>`, `<variable>`, `<initialValueExpression>`, `<printWhenExpression>`, etc.
- **UI**: Modal ou painel lateral com:
  - Editor Monaco/CodeMirror com syntax highlighting (Groovy/Java)
  - Barra de ferramentas: snippets, funções comuns, campos/parâmetros disponíveis
  - Painel lateral: lista de `$F{}`, `$P{}`, `$V{}` do relatório atual
  - Preview: avalia expressão com dados mock e mostra resultado tipado

### 3.2 Autocomplete Contextual
- **Trigger**: `Ctrl+Space` ou digitação
- **Contexto**:
  - `$F{` → lista campos do relatório (com tipo)
  - `$P{` → lista parâmetros (com tipo)
  - `$V{` → lista variáveis + built-ins (`PAGE_NUMBER`, `REPORT_COUNT`...)
  - `.` após campo → métodos do tipo inferido (`String`, `BigDecimal`, `Date`, `Integer`...)
  - Classes estáticas: `Boolean.`, `Integer.`, `BigDecimal.`, `DateUtils.`, `JRExtendedUtils.`, `Math.`
  - Groovy operators: `?.`, `?:`, `**.`, `collect`, `findAll`, `sum`, `groupBy`

### 3.3 Validação em Tempo Real
- **Linting**: Parse da expressão (Groovy/Java) → erros/warnings inline (squiggly)
- **Tipagem**: Inferência de tipo de retorno → avisa se incompatível com contexto (ex: String em campo numérico)
- **Referências quebradas**: `$F{CAMPO_INEXISTENTE}` → erro imediato

### 3.4 Preview / Avaliação
- **Dados mock**: Gera dados sintéticos baseados nos tipos dos campos
- **Execução**: Avalia expressão com mock → mostra valor + tipo
- **Erros runtime**: Mostra exceção se expressão falhar

### 3.4 Snippets de Expressão
| Prefixo | Expansão |
|---------|----------|
| `if` | `$F{CAMPO} != null ? $F{CAMPO} : \"\"` |
| `fmt` | `new java.text.SimpleDateFormat(\"dd/MM/yyyy\").format($F{DATA})` |
| `money` | `new java.text.DecimalFormat(\"#,##0.00\").format($F{VALOR})` |
| `nullsafe` | `$F{CAMPO}?.toString() ?: \"\"` |
| `cond` | `$F{COND} ? \"SIM\" : \"NÃO\"` |

---

## 3. Integração Técnica

### 3.1 Editor Engine
- **Monaco Editor** (mesmo do VS Code) → carrega localmente via `media/monaco/`
- **Language ID**: `groovy` (ou `java` configurável)
- **Worker**: Web Worker para linting/autocomplete sem travar UI

### 3.2 Integração com JRXML Parser
- `jrxmlParser.getMetadata(document)` → fornece `fields[]`, `parameters[]`, `variables[]` com tipos
- Contexto passado para WebView via `postMessage`

### 3.3 Language Server (Futuro)
- Groovy Language Server (`groovy-language-server`) para validação real
- MVP: regex + heurísticas + CompletionProvider atual estendido

---

## 4. Integração no VS Code

### 4.1 Custom Editor (CustomEditorProvider)
- **Provider**: `jasperExpressionEditor` para arquivos `.jrexpr` (virtual) ou inline no XML
- **Abertura**: `vscode.window.showCustomDocument()` ou WebView modal

### 3.2 Inline no XML (MVP)
- **CodeLens** em `<textFieldExpression>` → "Editar Expressão"
- **Hover** mostra preview da expressão
- **Quick Fix**: "Abrir no Expression Editor"

---

## 4. Critérios de Aceite
- [ ] Abre editor modal ao clicar CodeLens em expressão
- [ ] Syntax highlighting Groovy/Java funcional
- [ ] Autocomplete `$F{`, `$P{`, `$V{`, classes estáticas, métodos por tipo
- [ ] Validação inline (squiggly) para referências inválidas
- [ ] Preview com dados mock mostra resultado tipado
- [ ] Salvar no editor atualiza XML original corretamente
- [ ] Snippets `if`, `fmt`, `money`, `nullsafe`, `cond` funcionam

---

## 4. Arquivos a Criar/Modificar
| Arquivo | Tipo |
|---------|------|
| `src/webviewPanels/expressionEditorPanel.ts` | Novo (controller) |
| `webviews/expression-editor/` | Novo (HTML/CSS/JS + Monaco) |
| `src/services/expressionValidator.ts` | Novo (linting/parse) |
| `src/services/groovySignatureLibrary.ts` | Novo (assinaturas Groovy) |
| `src/commands/reportCommands.ts` | Modificado (comando abrir editor) |
| `package.json` | Modificado (customEditor, keybinding) |
| `src/extension.ts` | Modificado (registro) |