# Etapa 01: Core Engine Java (`jasper-cli`)

---

## 1. Objetivo da Etapa
Criar o subprojeto Maven `java-engine/` que compila o motor utilitário CLI standalone (`bin/jasper-cli.jar`). Este motor é invocado sob demanda pela extensão VS Code para compilar relatórios, testar conexões com bancos de dados e exportar relatórios preenchidos para PDF.

---

## 2. Escopo Técnico e Requisitos

### 2.1 Dependências Maven (`pom.xml`)
O projeto deve ser configurado com Java 11 ou 17 e conter as seguintes dependências:
* **JasperReports Library:** `net.sf.jasperreports:jasperreports:6.21.3` (ou versão 6.21.x estável).
* **Driver PostgreSQL:** `org.postgresql:postgresql:42.7.2`
* **Driver Oracle:** `com.oracle.database.jdbc:ojdbc8:23.3.0.23.09`
* **CLI Parser:** `info.picocli:picocli:4.7.5` (ou `commons-cli:commons-cli:1.6.0`)
* **JSON Serializer:** `com.fasterxml.jackson.core:jackson-databind:2.17.0`
* **Build Plugin:** `maven-shade-plugin` configurado para gerar um "fat jar" executável único com todas as dependências embutidas, salvando o artefato final diretamente em `../bin/jasper-cli.jar` e definindo a classe principal `com.jasper.cli.Main`.

### 2.2 Estrutura de Classes (`src/main/java/com/jasper/cli/`)

1. **`Main.java`:**
   * Entrypoint da aplicação.
   * Definição das opções de linha de comando:
     * `--action` (obrigatório): `compile`, `fill`, `export`, `test-conn`, `inspect-params`.
     * `--format` (opcional, padrão `pdf`): `pdf`, `jasper`, `jrprint`.
     * `--input` (opcional dependendo da action): Caminho do arquivo `.jrxml` ou `.jasper`.
     * `--output` (opcional): Caminho do arquivo gerado (`.pdf`, `.jasper`, etc.).
     * `--db-url`: URL JDBC de conexão (ex: `jdbc:postgresql://localhost:5432/hospital`).
     * `--db-user`: Usuário do banco de dados.
     * `--db-pass`: Senha do banco de dados.
     * `--custom-driver-jar`: Caminho absoluto para arquivo `.jar` de driver externo fornecido pelo usuário.
     * `--custom-driver-class`: Nome completo da classe do driver externo (ex: `com.microsoft.sqlserver.jdbc.SQLServerDriver`).
     * `--params`: String JSON contendo chave/valor para preenchimento de parâmetros do relatório (ex: `'{"CD_ATENDIMENTO": 1050}'`).
   * Captura exceções não tratadas e garante que qualquer erro termine com saída em JSON formatada na `stdout` (ou `stderr`) com exit code 1.

2. **`CommandHandler.java`:**
   * Roteador de comandos baseado no valor de `--action`:
     * `test-conn`: Testa a conexão com o banco e retorna sucesso com latência em milissegundos.
     * `compile`: Compila o arquivo `.jrxml` gerando o `.jasper`.
     * `export`: Compila (se necessário), preenche o relatório via conexão JDBC ou Mock com os parâmetros e exporta para o formato requisitado (PDF).
     * `inspect-params`: Inspeciona o arquivo compilado ou `.jrxml` e retorna a lista de parâmetros em JSON.

3. **`DatabaseHelper.java` e `CustomDriverLoader.java`:**
   * Gerencia a criação da `java.sql.Connection`.
   * Se `--custom-driver-jar` e `--custom-driver-class` forem informados:
     * Instanciar um `URLClassLoader` apontando para o arquivo `.jar` informado.
     * Carregar a classe do driver dinamicamente.
     * Usar um `DriverShim` (implementação de `java.sql.Driver` que delega para o driver carregado) para contornar a restrição de classloader do `DriverManager`.
     * Criar e retornar a conexão.
   * Se for driver nativo (Postgres/Oracle), obter conexão padrão via `DriverManager.getConnection(url, user, pass)`.

4. **`JasperProcessor.java`:**
   * Centraliza chamadas ao `JasperCompileManager`, `JasperFillManager` e `JasperExportManager`.
   * **Injeção de Parâmetros Automáticos:**
     * `SUBREPORT_DIR`: Extrai o diretório pai do arquivo informado em `--input` e adiciona ao mapa de parâmetros (com barra final `/`).
     * `REPORT_LOCALE`: Define `new java.util.Locale("pt", "BR")`.
   * Tratamento de parâmetros recebidos via JSON: converter para tipos esperados (String, Integer, Long, Date, etc.) quando necessário.

5. **`OutputPayload.java`:**
   * Classe POJO para serialização padronizada com Jackson.
   * Sucesso:
     ```json
     {
       "status": "SUCCESS",
       "action": "export",
       "outputFile": "caminho/do/saida.pdf",
       "executionTimeMs": 450,
       "pages": 1,
       "metadata": {}
     }
     ```
   * Erro:
     ```json
     {
       "status": "ERROR",
       "errorType": "SQL_ERROR | COMPILATION_ERROR | IO_ERROR | DRIVER_ERROR",
       "message": "Mensagem detalhada e legível",
       "stackTraceSnippet": "Primeiras linhas do stack trace..."
     }
     ```

---

## 3. Critérios de Aceite e Validação

1. **Build do Maven:**
   * Executar `mvn clean package` dentro de `java-engine/` deve finalizar com `BUILD SUCCESS`.
   * O arquivo `bin/jasper-cli.jar` deve ser gerado na raiz da extensão e ser um fat JAR executável.

2. **Teste de Linha de Comando (CLI):**
   * `java -jar bin/jasper-cli.jar --help` deve exibir a lista de opções e comandos.
   * `java -jar bin/jasper-cli.jar --action test-conn --db-url "jdbc:postgresql://localhost:5432/teste" --db-user fake --db-pass fake` deve retornar JSON estruturado com `"status": "ERROR"` e exit code 1 sem quebrar silenciosamente.
   * Teste com um arquivo `.jrxml` simples de teste compilando para `.jasper` e exportando para `.pdf` retornando `"status": "SUCCESS"` e exit code 0.

---

## 4. Instruções para o AGY

Execute as seguintes ações:
1. Crie a pasta `java-engine/` e o arquivo `pom.xml` com as dependências e o `maven-shade-plugin` configurado para gerar `../bin/jasper-cli.jar`.
2. Implemente as classes Java descritas em `java-engine/src/main/java/com/jasper/cli/`.
3. Crie um `.jrxml` mínimo de teste em uma pasta de testes temporários para validar compilação.
4. Execute `mvn clean package` e teste os comandos via terminal para assegurar que o JSON de saída atende ao contrato estipulado.
