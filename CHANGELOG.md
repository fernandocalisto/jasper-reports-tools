# Changelog

Todas as mudanças notáveis da extensão **JasperReports Developer Tools** estão documentadas neste arquivo.

## [0.2.0] - 2026-10-31

### Adicionado

#### Core Engine & CLI
- **JasperServer Scheduler (Etapa 15)**: CRUD completo de Jobs, Triggers (Simple/Cron/Calendar) e Execuções via REST API v2. TreeView "Agendamentos" no JasperServer Explorer com lazy loading, histórico paginado de execuções, download de output, cancelamento de execuções em andamento.
- **Expression Editor Monaco (Etapa 9)**: Editor modal dedicado para expressões JR (Groovy/Java) com autocomplete contextual (`$P{}`, `$F{}`, `$V{}`, métodos por tipo: String, BigDecimal, Date, Boolean, List, Map, Integer), validação real-time (syntax, referências inválidas, type mismatch, métodos inexistentes), inferência de tipo de retorno, preview com mock data, snippets (`if`, `fmt`, `money`, `nullsafe`, `cond`), CodeLens "✏️ Editar Expressão" no XML, HoverProvider com tipo inferido, histórico de 20 expressões.

#### Report Comparison & Validation
- **Report Diff/Compare (Etapa 14)**: Diff visual lado a lado de dois `.jrxml`/`.jasper` (local vs local, local vs servidor). Diff semântico em 9 categorias: Estrutura, Atributos, Query SQL (normalizada), Parâmetros, Campos, Variáveis, Estilos, Expressões, Subrelatórios. UI Monaco/diff2html com navegação F7/Shift+F7, filtros por categoria, estatísticas, export HTML/Markdown/JSON. Performance: 5000+ linhas em ~121ms.
- **Parameter Validation UI (Etapa 13)**: Validação automática de parâmetros (obrigatório, tipo, formato data, range numérico, regex, enum, condicional) com UI inline (borda vermelha/amarela + tooltip), painel lateral agrupado por Erros/Avisos com foco automático, integração no Field Viewer (coluna Validação), settings configuráveis (`jasper.validation.enabled`, `autoValidateOnPreviewOpen`, `debounceMs`, `showWarningsAsErrors`).

#### Batch Operations & UX
- **Batch Compile/Export (Etapa 12)**: Compilação/export em lote de pastas ou multi-select (`.jrxml`/`.jasper`). Formato configurável (PDF, JASPER, JRPRINT), diretório de saída, recursivo, concorrência paralela (padrão 3), barra de progresso com cancelamento, relatório final JSON com erros isolados por arquivo. Keybindings: `Ctrl+Shift+Alt+B` (Batch Compile), `Ctrl+Shift+Alt+E` (Batch Export).
- **JasperServer UX (Etapa 7)**: Busca client-side `Ctrl+F` com highlight, copy/paste `Ctrl+C/V` (download recursivo no paste), breadcrumbs, navegação `Backspace` (subir), F5 (reload), multi-select com checkboxes, copy path `Ctrl+Shift+C`.

#### Decompile & Introspection
- **Decompile `.jasper` → `.jrxml` (Etapa 8)**: `JRXmlWriter` customizado com indent 2 espaços, ordem lógica de elementos (queryString → fields → parameters → variables → bands), UTF-8, preservação de CDATA. Round-trip validado (compile → decompile → compile). Comando `jasper.decompileReport` (`Ctrl+Shift+D`).

#### Preview & Editing Enhancements
- **Split Preview aprimorado (Etapa 4)**: PDF.js lado a lado, formulário dinâmico de parâmetros com inputs tipados, Live Reload ao salvar (`Ctrl+S`), export PDF/.jasper, parâmetros `REPORT_LOCALE=pt_BR` e `SUBREPORT_DIR` injetados automaticamente.
- **Field Viewer (Etapa 6)**: Tabela interativa de campos com Java Class, JDBC Type, Nullable; botão "Atualizar Tipos no Banco" chama `inspect-query`; clique copia `$F{FIELD}`.

#### JasperServer Explorer (Etapa 5)
- Navegação lazy em pastas/relatórios, download `.jrxml`, deploy `.jasper` compilado, atualização remota, exclusão, **criar novo `.jrxml`** direto no servidor.

#### Edição `.jrxml` (Etapa 6)
- Validação XSD 6.21.3 em tempo real (`schemas/jasperreport.xsd`).
- Snippets dedicados (`jtf`, `jband`, `jparam`, `jfield`, `jimg`, `jsub`, `jcurrency`, `jdate`, `jpage`, `jstatic`, `jvar`).
- `JasperCompletionProvider` para `$F{`, `$P{`, `$V{}`, métodos Java por tipo inferido e classes estáticas (`Boolean`, `Integer`, `Long`, `Double`, `BigDecimal`, `String`, `Math`, `DateUtils`, `JRExtendedUtils`).
- Ícones dedicados para `.jrxml` e `.jasper`.

### Alterado
- Versão bump: **0.1.0 → 0.2.0** (todas as 15 etapas = minor release)
- `.vsix` atualizado para v0.2.0
- Documentação expandida: README com todas as features, keybindings completos, CHANGELOG detalhado

---

## [0.1.0] - 2026-10-18

### Adicionado
- **Motor Java Standalone (`bin/jasper-cli.jar`)**:
  - Compilação de `.jrxml` para `.jasper` (`--action compile`).
  - Preenchimento e exportação para PDF e `.jrprint` (`--action fill` e `--action export`) com suporte a modo Mock (`JREmptyDataSource`) e conexões JDBC reais.
  - Teste de conexões JDBC com medição de latência e metadados do banco (`--action test-conn`).
  - Inspeção estática de parâmetros, campos e query (`--action inspect-params`).
  - Introspecção de metadados JDBC reais das colunas da query SQL do relatório (`--action inspect-query`).
  - Drivers PostgreSQL e Oracle (`ojdbc8`) embutidos + suporte dinâmico a drivers JDBC externos via `URLClassLoader`.
- **Gestão Segura de Conexões de Banco de Dados**:
  - TreeView **Conexões de Banco de Dados** na Activity Bar e seletor rápido na Status Bar.
  - Armazenamento de senhas exclusivamente via `vscode.SecretStorage`.
- **Webview Split Preview (PDF.js)**:
  - Visualização lateral de relatórios em PDF com controles de zoom, paginação, formulário dinâmico de parâmetros e **Live Reload** ao salvar (`Ctrl+S`).
- **JasperServer Explorer (REST API v2)**:
  - Navegação em pastas e relatórios remotos, download de `.jrxml`, deploy de `.jasper` compilado, atualização de `.jrxml` e exclusão de recursos.
- **Produtividade de Edição `.jrxml` e Field Viewer**:
  - Validação em tempo real com o schema oficial `schemas/jasperreport.xsd` (JasperReports 6.21.3).
  - Snippets dedicados (`jtf`, `jband`, `jparam`, `jfield`, `jimg`, `jsub`, `jcurrency`, `jdate`, `jpage`, `jstatic`, `jvar`).
  - `JasperCompletionProvider` para `$F{`, `$P{`, `$V{`, métodos Java por tipo inferido e classes estáticas (`Boolean`, `Integer`, `Long`, `Double`, `BigDecimal`, `String`, `Math`, `DateUtils`, `JRExtendedUtils`).
  - Painel **Field Viewer** (`jasper.openFieldViewer`) com tabela interativa de campos, introspecção JDBC no banco e cópia rápida de `$F{...}`.
  - Ícones dedicados para arquivos `.jrxml` e `.jasper` e configuração de linguagem XML (`language-configuration.json`).
