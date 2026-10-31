# Etapa 14: Report Diff / Compare (Comparação de Relatórios)

---

## 1. Objetivo
Permitir comparar dois arquivos `.jrxml` ou `.jasper` visualmente, destacando diferenças na estrutura, queries, parâmetros, campos, estilos e layout. Útil para code review, auditoria de mudanças em produção e migração de versões.

---

## 2. Requisitos Funcionais

### 2.1 Comando Principal
| Comando | Título | Descrição |
|---------|--------|-----------|
| `jasper.compareReports` | Comparar Relatórios | Abre WebView lado a lado com diff visual |

### 2.2 Entrada (Input)
| Origem | Detalhes |
|--------|----------|
| **Dois arquivos no Explorer** | Multi-select (Ctrl+Click) dois `.jrxml` ou `.jasper` → clique direito → "Comparar Relatórios" |
| **Arquivo ativo + outro** | Arquivo aberto no editor + seleção no Explorer → "Comparar com Arquivo Aberto" |
| **Arquivo local vs JasperServer** | Arquivo local vs recurso no JasperServer Explorer |
| **Duas versões no JasperServer** | Histórico de versões no servidor (quando implementado) |

### 2.2 UI de Comparação (WebView Side-by-Side)
| Painel | Conteúdo |
|--------|----------|
| **Esquerda** | Relatório A (origem) |
| **Direita** | Relatório B (destino) |
| **Centro (opcional)** | Resumo consolidado de mudanças |

### 2.3 Tipos de Diff Suportados
| Categoria | Detecção |
|-----------|----------|
| **Estrutura XML** | Adição/remoção/modificação de elementos (`band`, `textField`, `subreport`, etc.) |
| **Atributos** | Mudanças em `x`, `y`, `width`, `height`, `uuid`, `isPrintWhenDetailOverflows`, etc. |
| **Query SQL** | Diff semântico de `queryString` (ignora whitespace, normaliza aliases) |
| **Parâmetros** | Adição/remoção, mudança de `class`, `isForPrompting`, `defaultValueExpression` |
| **Campos (Fields)** | Adição/remoção, mudança de `class`, `description` |
| **Variáveis** | Mudanças em `calculation`, `variableExpression`, `initialValueExpression` |
| **Estilos** | Mudanças em `style`, `parentStyle`, `forecolor`, `backcolor`, `fontName`, `fontSize`, `pdfFontName` |
| **Expressões** | Diff semântico de `textFieldExpression`, `printWhenExpression`, `initialValueExpression` |
| **Subrelatórios** | Mudança em `subreportExpression`, `connectionExpression`, parâmetros passados |

### 2.4 UI de Diff (WebView)
| Elemento | Descrição |
|----------|-----------|
| **Toolbars** | Toolbar superior com: filtro (mostrar apenas mudanças / ignorar whitespace), expandir/recolher tudo, exportar diff |
| **Linha a linha** | Diff lado a lado estilo Git (vermelho = removido, verde = adicionado, amarelo = modificado) |
| **Navegação** | Botões "Próxima Mudança" / "Mudança Anterior" (F7 / Shift+F7) |
| **Estatísticas** | Badge: `+12 -5 ~3` (adicionados, removidos, modificados) |
| **Filtros** | Checkboxes: Estrutura, Atributos, Query, Parâmetros, Campos, Estilos, Expressões |
| **Sincronização Scroll** | Scroll sincronizado entre painéis (toggleável) |

---

## 2.5 Diff Semântico vs Textual
| Abordagem | Quando Usar |
|-----------|-------------|
| **Textual (line-by-line)** | Fallback geral; rápido; bom para atributos simples |
| **Semântico (AST-aware)** | Query SQL, Expressões, Estrutura complexa |
| **Híbrido (Recomendado)** | Parse XML → compara árvores → renderiza diff visual |

---

## 2.5 Diff com JasperServer
| Cenário | Fluxo |
|---------|-------|
| **Local vs Servidor** | Seleciona arquivo local + recurso no JasperServer Explorer → "Comparar com Servidor" |
| **Duas versões no servidor** | Histórico de versões (quando implementado Etapa 15) → seleciona duas versões → compara |

---

## 3. Requisitos Não-Funcionais
| Requisito | Especificação |
|-----------|---------------|
| **Performance** | Diff de relatório 5000 linhas < 2s |
| **Memória** | Streaming para arquivos > 10MB |
| **Cancelamento** | Botão "Cancelar" durante diff longo |
| **Exportação** | Exportar diff como HTML/Markdown/JSON |

---

## 4. Arquitetura Técnica

### 4.1 Novo Serviço: `ReportDiffEngine` (`src/services/reportDiffEngine.ts`)
```typescript
interface DiffOptions {
  ignoreWhitespace?: boolean;
  ignoreAttributeOrder?: boolean;
  ignoreUUID?: boolean;           // Ignorar uuid gerados automaticamente
  semanticQueryDiff?: boolean;    // Diff semântico de SQL
  semanticExpressionDiff?: boolean; // Diff de expressões
  filters?: DiffFilter[];         // Filtros ativos
}

interface DiffResult {
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  changes: DiffChange[];
  metadata: {
    fileA: { path: string; hash: string; size: number };
    fileB: { path: string; hash: string; size: number };
    diffTimeMs: number;
  };
}

interface DiffChange {
  type: 'added' | 'removed' | 'modified' | 'moved';
  path: string;                    // XPath ou CSS-like path no XML
  category: DiffCategory;
  oldValue?: string;
  newValue?: string;
  lineA?: number;                  // Linha no arquivo A
  lineB?: number;                  // Linha no arquivo B
  semantic?: boolean;              // true se diff semântico (não textual)
}

type DiffCategory = 
  | 'structure' 
  | 'attributes' 
  | 'query' 
  | 'parameters' 
  | 'fields' 
  | 'variables' 
  | 'styles' 
  | 'expressions' 
  | 'subreports' 
  | 'styles';

export class ReportDiffEngine {
  diff(fileA: string, fileB: string, options?: DiffOptions): Promise<DiffResult>;
  diffContent(contentA: string, contentB: string, options?: DiffOptions): Promise<DiffResult>;
}
```

### 4.2 Algoritmo de Diff
| Estratégia | Implementação |
|------------|---------------|
| **XML Parse** | `DOMParser` (browser) ou `xmldom` (Node) → árvore DOM |
| **Tree Diff** | Algoritmo Zhang-Shasha ou `diff-match-patch` adaptado para árvores XML |
| **Semantic Query** | Parse SQL → normaliza (remove comments, normaliza aliases, ordena WHERE) → diff textual |
| **Expressions** | Parse Groovy/Java → AST → diff de AST |
| **Attribute Order** | Ordena atributos alfabeticamente antes de comparar (opção) |

### 4.3 WebView Diff Viewer (`webviews/report-diff/`)
| Componente | Tecnologia |
|------------|------------|
| **Diff Viewer** | `diff2html` ou `monaco-diff-editor` (Monaco Editor diff) |
| **Syntax Highlight** | XML/HTML/SQL/Groovy |
| **Navigation** | F7 / Shift+F7 para next/prev change |
| **Filters** | Checkbox toolbar para categorias |

---

## 5. Integração VS Code

### 5.1 Comando (package.json)
```json
{
  "command": "jasper.compareReports",
  "title": "Comparar Relatórios",
  "category": "Jasper",
  "icon": "$(diff)",
  "keybindings": [{ "command": "jasper.compareReports", "key": "ctrl+shift+alt+c", "when": "explorerViewletFocus" }]
}
```

### 5.2 Menus
| Menu | When | Group |
|------|------|-------|
| `explorer/context` | `resourceExtname == .jrxml || resourceExtname == .jasper` | `1_jasper@7` |
| `editor/title` | `resourceExtname == .jrxml || resourceExtname == .jasper` | `1_jasper@8` |
| `view/item/context` (jasper-servers) | `view == jasper-servers && viewItem =~ /^serverReport/` | `1_jasper@6` |

### 5.3 Comandos
| Comando | Descrição |
|---------|-----------|
| `jasper.compareReports` | Compara dois arquivos selecionados ou arquivo ativo + selecionado |
| `jasper.compareWithServer` | Compara arquivo local com recurso no JasperServer |
| `jasper.openDiffViewer` | Abre WebView de diff (programático) |

---

## 6. Critérios de Aceite

| Critério | Validação |
|----------|-----------|
| **Diff dois arquivos locais** | Seleciona 2 `.jrxml` no Explorer → "Comparar Relatórios" → WebView abre com diff lado a lado |
| **Diff arquivo vs servidor** | Arquivo local + recurso no JasperServer Explorer → "Comparar com Servidor" |
| **Cores corretas** | Vermelho = removido, Verde = adicionado, Amarelo = modificado |
| **Navegação F7** | F7 → próxima mudança; Shift+F7 → anterior |
| **Filtros funcionam** | Desmarca "Estilos" → mudanças de estilo ocultas |
| **Sincronização Scroll** | Scroll em um painel → outro acompanha (toggleável) |
| **Estatísticas corretas** | Badge `+12 -5 ~3` corresponde ao diff real |
| **Export HTML** | Botão "Exportar" → salva `.html` com diff standalone |
| **Performance** | Diff de 5000 linhas < 2s |
| **Cancelamento** | Botão "Cancelar" durante diff longo → para processamento |

---

## 6. Arquivos a Criar/Modificar

| Arquivo | Tipo |
|---------|------|
| `src/services/reportDiffEngine.ts` | **Novo** (core diff engine) |
| `src/services/reportDiffEngine.ts` | **Novo** (diff semantic helpers) |
| `src/webviewPanels/diffViewerPanel.ts` | **Novo** (controller WebView) |
| `webviews/report-diff/` | **Novo** (HTML/CSS/JS + Monaco diff) |
| `src/commands/reportCommands.ts` | Modificado (comandos `compareReports`, `compareWithServer`) |
| `src/extension.ts` | Modificado (registro) |
| `package.json` | Modificado (comandos, keybindings, menus) |
| `src/commands/reportCommands.ts` | Modificado (comando `compareWithServer`) |

---

## 8. Critérios de Validação Técnica

| Teste | Comando | Esperado |
|-------|---------|----------|
| Compilação TS | `npm run compile` | Exit code 0 |
| Diff 2 arquivos locais | Seleciona 2 `.jrxml` → "Comparar Relatórios" | WebView abre com diff lado a lado |
| Diff com servidor | Arquivo local + recurso no Server Explorer | WebView abre com diff local vs servidor |
| Cores | Vermelho/Verde/Amarelo | Cores corretas no diff |
| Navegação F7 | F7 / Shift+F7 | Navega entre mudanças |
| Filtros | Desmarca categorias | Mudanças filtradas corretamente |
| Sincronização Scroll | Scroll em um painel | Outro acompanha (toggle) |
| Estatísticas | Badge `+12 -5 ~3` | Números corretos |
| Export HTML | Botão "Exportar" | Gera `.html` standalone |
| Performance | 5000 linhas | < 2s |
| Cancelamento | Botão "Cancelar" | Para processamento |

---

## 8. Arquivos a Criar/Modificar

| Arquivo | Tipo |
|---------|------|
| `src/services/reportDiffEngine.ts` | **Novo** (core diff engine) |
| `src/services/reportDiffSemantic.ts` | **Novo** (semantic helpers: SQL, expressions) |
| `src/webviewPanels/diffViewerPanel.ts` | **Novo** (controller WebView) |
| `webviews/report-diff/` | **Novo** (HTML/CSS/JS + Monaco diff) |
| `src/commands/reportCommands.ts` | Modificado (comandos `compareReports`, `compareWithServer`) |
| `src/extension.ts` | Modificado (registro) |
| `package.json` | Modificado (comandos, keybindings, menus) |