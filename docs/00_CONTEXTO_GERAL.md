# Contexto Geral do Projeto: JasperReports Tools (Standalone)

---

## 1. Identificação do Projeto

* **Nome do Repositório/Pacote:** `jasper-reports-tools`
* **Nome de Exibição (VS Code Marketplace):** `JasperReports Developer Tools`
* **Finalidade:** Extensão profissional e leve para o VS Code para criação, manutenção, compilação, teste e deploy de relatórios JasperReports (`.jrxml` e `.jasper`), substituindo o Jaspersoft Studio em ambientes corporativos e hospitalares.
* **Repositório / Workdir:** `C:\Users\ferna\OneDrive\Documentos\Projetos\jasper-reports-tools`

---

## 2. Princípios de Arquitetura e Decisões Técnicas

1. **Zero Serviços Ativos em Background (Zero-Daemon):**
   * A extensão **NÃO** mantém processos Java rodando em background nem abre portas HTTP locais no computador do usuário.
   * Toda compilação, teste de banco ou geração de PDF é disparada sob demanda via `child_process.execFile` chamando um fat JAR compilado (`bin/jasper-cli.jar`). O processo executa, gera a saída estruturada e encerra imediatamente.

2. **Segurança Rigorosa e Isolamento de Credenciais:**
   * **NENHUMA** senha de banco de dados ou token/senha de JasperServer pode ser persistida em arquivos de texto plano, configurações do VS Code (`settings.json`) ou repositório Git.
   * Todos os segredos devem ser armazenados exclusivamente através da API nativa `vscode.SecretStorage` (que integra com o Windows Credential Manager, macOS Keychain e Linux Secret Service).
   * Apenas metadados não sensíveis (Host, Porta, Usuário, Driver, Database/SID) são gravados em `context.globalState`.

3. **Arquitetura de Drivers JDBC Híbrida (Embutidos + Customizados):**
   * O motor Java (`jasper-cli.jar`) inclui nativamente apenas os drivers mais comuns no mercado hospitalar/corporativo:
     * **PostgreSQL** (`org.postgresql:postgresql`)
     * **Oracle** (`com.oracle.database.jdbc:ojdbc8`)
   * Para qualquer outro banco (SQL Server, MySQL, Firebird, DB2, etc.), o usuário aponta o caminho de um arquivo `.jar` externo no disco e informa o nome da classe do driver.
   * O motor Java carrega drivers externos dinamicamente em runtime utilizando `URLClassLoader` isolado, sem poluir o classpath global.

4. **Comunicação JasperServer 100% Node.js / REST API v2:**
   * A navegação em pastas, download de relatórios e deploy no JasperServer **NÃO** utilizam Java.
   * São executadas diretamente pelo processo Node.js da extensão via requisições HTTP (`fetch`) contra a REST API v2 do JasperServer (`/rest_v2/login`, `/rest_v2/resources`, etc.). Isso garante latência mínima e navegação instantânea na árvore de arquivos.

5. **Visualização Fiel via Split View (PDF.js):**
   * Ao contrário de extensões que tentam recriar o Jasper em JavaScript com dados falsos, esta extensão executa o **motor oficial do JasperReports em Java**, processa a query real contra o banco conectado e renderiza o PDF gerado diretamente em uma Webview lateral com PDF.js.
   * 100% de fidelidade visual às regras do Jasper (quebras de página, formatações de moeda/data, sub-relatórios e expressões).

6. **Resiliência a Sub-relatórios e Localização:**
   * O motor Java injeta automaticamente:
     * `SUBREPORT_DIR`: Caminho do diretório base do relatório atual, permitindo que sub-relatórios modulares funcionem imediatamente sem ajustes de caminho absoluto.
     * `REPORT_LOCALE`: Configurado por padrão para `pt_BR`.

7. **Consistência Visual com o VS Code (Taste Design):**
   * As telas Webview devem usar estritamente as variáveis de CSS do VS Code (`var(--vscode-editor-background)`, `var(--vscode-button-background)`, `var(--vscode-foreground)`, etc.).
   * **Proibido o uso de padrões genéricos de IA:** sem pílulas excessivas (`rounded-full`), sem efeitos de glow neon, sem ilustrações genéricas, sem clichês de copy. A interface deve parecer nativa do próprio ecossistema do VS Code.

---

## 3. Stack Tecnológica

| Camada | Tecnologia | Detalhes |
| :--- | :--- | :--- |
| **Extensão VS Code** | TypeScript 5.x | Compilado com `tsc`, empacotado para VSIX via `@vscode/vsce`. |
| **UI das Webviews** | HTML5, CSS3 Nativo, Vanilla JS | Estilização orientada às variáveis de tema do VS Code. |
| **Visualizador de PDF** | PDF.js (Mozilla) | Biblioteca estática empacotada em `media/pdfjs/` para uso offline em sandbox. |
| **Motor de Execução** | Java 11 LTS (compatível com 17/21) | Subprojeto Maven em `java-engine/`. |
| **Core de Relatórios** | JasperReports Library 6.21.x | Motor oficial de compilação, preenchimento e exportação. |
| **Drivers Embutidos** | PostgreSQL JDBC + Oracle JDBC (ojdbc8) | Compactados no `jasper-cli.jar` via `maven-shade-plugin`. |
| **CLI Argument Parser** | Picocli ou Commons CLI | Parsing robusto de flags no Java. |
| **Serialização de Saída** | Jackson Databind | Respostas estruturadas em JSON na `stdout`. |
| **Protocolo de Servidor** | JasperServer REST API v2 | Consumo via HTTP/HTTPS direto no TypeScript. |

---

## 4. Estrutura Canônica de Diretórios

```text
jasper-reports-tools/
├── docs/                                     # Documentos de especificação e etapas para o AGY
│   ├── 00_CONTEXTO_GERAL.md
│   ├── ETAPA_01_CORE_JAVA_ENGINE.md
│   ├── ETAPA_02_SCAFFOLD_EXTENSAO_E_CONEXOES.md
│   ├── ETAPA_03_RUNNER_E_PARSER_JRXML.md
│   ├── ETAPA_04_WEBVIEW_SPLIT_PREVIEW.md
│   ├── ETAPA_05_JASPERSERVER_EXPLORER.md
│   └── ETAPA_06_SNIPPETS_XSD_EMPACOTAMENTO.md
│
├── .vscode/                                  # Configurações de desenvolvimento e launch
│   ├── launch.json
│   └── tasks.json
│
├── bin/                                      # Artefato gerado do motor Java
│   └── jasper-cli.jar                        # Fat JAR executável (gerado pelo build do Maven)
│
├── schemas/                                  # Schemas XSD locais
│   └── jasperreport.xsd                      # Schema oficial para validação e intellisense
│
├── snippets/                                 # Produtividade na edição de .jrxml
│   └── jasper-snippets.json                  # Snippets para tags frequentes
│
├── media/                                    # Assets compartilhados
│   ├── icons/                                # Ícones de banco, status e servidor
│   └── pdfjs/                                # Distribuição estática da biblioteca PDF.js
│
├── webviews/                                 # Interfaces HTML/CSS/JS das Webviews
│   ├── preview/                              # Painel lateral de visualização de PDF
│   ├── connection-form/                      # Formulário de configuração de Banco de Dados
│   └── jasperserver-form/                    # Formulário de conexão JasperServer
│
├── src/                                      # Código-fonte da Extensão (TypeScript)
│   ├── extension.ts                          # Ponto de entrada (activate / deactivate)
│   ├── commands/                             # Registro dos comandos VS Code
│   ├── providers/                            # TreeDataProviders para a Activity Bar
│   ├── services/                             # Lógica de negócio (Connection, Runner, Parser, JasperServer)
│   ├── webviewPanels/                        # Controladores de ciclo de vida das Webviews
│   ├── models/                               # Interfaces e tipos de dados
│   └── utils/                                # Constantes, paths, logger
│
├── java-engine/                              # Subprojeto Maven (CLI sob demanda)
│   ├── pom.xml
│   └── src/main/java/com/jasper/cli/         # Código Java do CLI
│
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## 5. Contrato de Comunicação CLI (TypeScript <-> Java)

### Chamada (TypeScript via `child_process.execFile`):
```bash
java -jar "bin/jasper-cli.jar" \
  --action <compile|fill|export|test-conn|inspect-params> \
  --format <pdf|jasper|jrprint> \
  --input "/caminho/do/relatorio.jrxml" \
  --output "/caminho/do/saida.pdf" \
  --db-url "jdbc:postgresql://localhost:5432/meubanco" \
  --db-user "postgres" \
  --db-pass "segredo" \
  --custom-driver-jar "/caminho/opcional/driver.jar" \
  --custom-driver-class "com.microsoft.sqlserver.jdbc.SQLServerDriver" \
  --params '{"PARAM_1": 100, "FL_ATIVO": "S"}'
```

### Resposta de Sucesso (`stdout`, exit code 0):
```json
{
  "status": "SUCCESS",
  "action": "export",
  "outputFile": "/tmp/relatorio_preview.pdf",
  "executionTimeMs": 620,
  "pages": 3,
  "metadata": {}
}
```

### Resposta de Erro (`stdout` ou `stderr`, exit code 1):
```json
{
  "status": "ERROR",
  "errorType": "SQL_ERROR | COMPILATION_ERROR | IO_ERROR | DRIVER_ERROR",
  "message": "Descrição amigável da falha para exibir ao usuário.",
  "stackTraceSnippet": "Resumo do stack trace relevante para log e diagnóstico."
}
```

---

## 6. Instruções de Execução para o Agente AGY

Ao implementar qualquer etapa deste projeto:
1. Trabalhe estritamente dentro da pasta raiz: `C:\Users\ferna\OneDrive\Documentos\Projetos\jasper-reports-tools`.
2. Siga as especificações detalhadas no documento `ETAPA_XX_*.md` correspondente à etapa solicitada.
3. Não crie dependências com bibliotecas pesadas de terceiros além das especificadas.
4. Garanta que testes e builds sejam executados e validados no terminal antes de declarar a tarefa concluída.
