# Etapa 03: Runner Service (Java CLI) e Parser de Metadados JRXML

---

## 1. Objetivo da Etapa
Conectar o código TypeScript da extensão ao motor Java CLI (`bin/jasper-cli.jar`) através de um serviço robusto de execução de processos (`child_process`), integrar a ação real de teste de conexão com o banco de dados, implementar o parser estático de arquivos `.jrxml` para extração de parâmetros/campos e criar o comando de compilação de relatórios.

---

## 2. Escopo Técnico e Requisitos

### 2.1 Serviço de Execução Java (`src/services/runnerService.ts`)

* **Localização do JAR:**
  * Resolver o caminho absoluto para `bin/jasper-cli.jar` utilizando `context.asAbsolutePath('bin/jasper-cli.jar')`.
  * Se o arquivo não existir, exibir erro informativo orientando a compilar o motor Java (`mvn package` no `java-engine/`).

* **Validação do Ambiente:**
  * Método para verificar se o comando `java` está acessível no PATH do sistema operacional (`java -version`).
  * Mensagem amigável com botão para documentação caso o JRE/JDK 11+ não seja encontrado.

* **Execução sob Demanda (`child_process.execFile`):**
  * Disparar processos isolados: `java -jar "${jarPath}" <argumentos>`.
  * Definir timeout razoável (ex: 60 segundos) para evitar processos zumbis em queries lentas.
  * Capturar `stdout` e realizar o parse do JSON emitido pelo Java CLI (`OutputPayload`).
  * Tratar `stderr` e erros de processo, convertendo em rejeição de Promise com tipagem estrita de erro.

* **Construção de URLs JDBC:**
  * Utilitário para gerar a string de conexão JDBC com base no perfil:
    * **PostgreSQL:** `jdbc:postgresql://${host}:${port || 5432}/${database}`
    * **Oracle:** `jdbc:oracle:thin:@${host}:${port || 1521}:${database}` (ou sintaxe de service name).
    * **Custom:** Permite ao usuário informar a URL JDBC completa ou utilizar template configurável.

* **Métodos Públicos da Classe `RunnerService`:**
  ```typescript
  export interface CliSuccessResponse {
    status: 'SUCCESS';
    action: string;
    outputFile?: string;
    executionTimeMs: number;
    pages?: number;
    metadata?: Record<string, any>;
  }

  export interface CliErrorResponse {
    status: 'ERROR';
    errorType: string;
    message: string;
    stackTraceSnippet?: string;
  }

  export class RunnerService {
    public async testConnection(profile: DatabaseProfile, password?: string): Promise<CliSuccessResponse>;
    public async compileReport(jrxmlPath: string, outputPath?: string): Promise<CliSuccessResponse>;
    public async fillAndExport(options: FillExportOptions): Promise<CliSuccessResponse>;
  }
  ```

### 2.2 Parser Estático de `.jrxml` (`src/services/jrxmlParser.ts`)

* **Leitura Leve de XML:**
  * Implementar parser rápido utilizando regex otimizada ou biblioteca de parse XML sem dependências de dom nativo pesado.
* **Extração de Parâmetros (`<parameter>`):**
  * Extrair nome (`name`), classe Java (`class`, ex: `java.lang.String`, `java.lang.Integer`, `java.util.Date`, `java.lang.Boolean`) e valor padrão (`<defaultValueExpression>`).
  * **Filtro de Parâmetros Internos:** Ignorar parâmetros embutidos do JasperReports:
    * `REPORT_*` (ex: `REPORT_CONNECTION`, `REPORT_DATA_SOURCE`, `REPORT_LOCALE`, etc.)
    * `JASPER_*`
    * `SUBREPORT_DIR`
* **Extração de Campos (`<field>`):**
  * Extrair nome e classe de cada campo retornado pela query do relatório.
* **Saída Tipada:**
  ```typescript
  export interface JrxmlParameter {
    name: string;
    className: string;
    defaultValue?: string;
    description?: string;
  }

  export interface JrxmlMetadata {
    parameters: JrxmlParameter[];
    fields: { name: string; className: string }[];
    queryString?: string;
  }
  ```

### 2.3 Registro e Implementação de Comandos

1. **`jasper.testConnection`:**
   * Recebe o perfil (via TreeView ou ID).
   * Recupera a senha do `SecretStorage`.
   * Invoca `runnerService.testConnection(profile, password)`.
   * Exibe notificação de sucesso com tempo de resposta (`Conexão estabelecida com sucesso! (120ms)`) ou caixa de erro com o detalhe retornado pelo banco.

2. **`jasper.compileCurrentReport`:**
   * Obtém o documento ativo no editor do VS Code.
   * Valida se o arquivo possui extensão `.jrxml`.
   * Exibe barra de progresso indeterminada (`vscode.window.withProgress`).
   * Invoca `runnerService.compileReport(caminhoJrxml)`.
   * Notifica sucesso e registra detalhes no `OutputChannel` ("JasperReports").

---

## 3. Critérios de Aceite e Validação

1. **Teste do CLI Runner:**
   * Disparar teste de conexão contra um PostgreSQL ou Oracle local e validar recebimento do JSON de sucesso.
   * Disparar teste com credenciais incorretas e validar se a notificação de erro do VS Code exibe a mensagem de falha tratada sem travar o editor.
2. **Teste do Parser:**
   * Carregar um arquivo `.jrxml` com parâmetros e validar se a lista de parâmetros retornada exclui os parâmetros internos (`REPORT_*`).
3. **Compilação no VS Code:**
   * Executar o comando "Jasper: Compilar Relatório Aberto" em um arquivo `.jrxml` e verificar se o arquivo `.jasper` é gerado no mesmo diretório com status de sucesso.

---

## 4. Instruções para o AGY

1. Crie `src/services/runnerService.ts` implementando a chamada ao CLI Java e o tratamento robusto de erros e JSON.
2. Crie `src/services/jrxmlParser.ts` para extrair metadados e parâmetros do XML.
3. Conecte o botão "Testar Conexão" do formulário de banco da Etapa 02 ao `runnerService.testConnection`.
4. Registre o comando `jasper.compileCurrentReport` e vincule ao atalho `Ctrl+Shift+B` (ou correspondente) quando o contexto for um arquivo `.jrxml`.
5. Valide a compilação do TypeScript com `npm run compile`.
