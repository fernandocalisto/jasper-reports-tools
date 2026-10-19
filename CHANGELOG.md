# Changelog

Todas as mudanças notáveis da extensão **JasperReports Developer Tools** estão documentadas neste arquivo.

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
