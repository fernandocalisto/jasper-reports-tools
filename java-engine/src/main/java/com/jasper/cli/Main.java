package com.jasper.cli;

import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.IVersionProvider;
import picocli.CommandLine.Option;

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.Properties;
import java.util.concurrent.Callable;

/**
 * Entrypoint do {@code jasper-cli}.
 *
 * <p>Contrato de saída: a stdout recebe <strong>exclusivamente</strong> um documento JSON
 * ({@link OutputPayload}) — exceto em {@code --help}/{@code --version}, que exibem texto.
 * Qualquer coisa que bibliotecas tentem escrever em {@code System.out} é redirecionada para
 * a stderr, preservando a integridade do JSON. Sucesso termina com exit code 0; qualquer
 * erro (inclusive de parsing de argumentos) termina com exit code 1.</p>
 */
@Command(
        name = "jasper-cli",
        mixinStandardHelpOptions = true,
        versionProvider = Main.VersionProvider.class,
        sortOptions = false,
        usageHelpAutoWidth = true,
        headerHeading = "%n",
        header = "Motor CLI sob demanda do JasperReports Developer Tools.",
        descriptionHeading = "%n",
        description = {
                "Compila, preenche e exporta relatórios JasperReports e testa conexões JDBC.",
                "A saída é sempre um JSON estruturado na stdout (exit code 0 = sucesso, 1 = erro)."
        },
        optionListHeading = "%nOpções:%n",
        footerHeading = "%n",
        footer = {
                "Ações:",
                "  compile         Compila --input (.jrxml) gerando o .jasper.",
                "  fill            Preenche --input (.jrxml/.jasper) e grava o .jrprint.",
                "  export          Compila (se .jrxml), preenche e exporta para --format (pdf|jrprint).",
                "                  Também aceita um .jrprint como --input.",
                "  test-conn       Testa a conexão JDBC e retorna a latência em ms.",
                "  inspect-params  Lista parâmetros, campos e query de --input (.jrxml/.jasper).",
                "",
                "Sem --db-url, fill/export usam uma fonte de dados vazia com 1 registro (modo mock).",
                "Parâmetros injetados automaticamente: SUBREPORT_DIR (diretório de --input, com '/' final)",
                "e REPORT_LOCALE (pt_BR), a menos que sejam informados em --params.",
                "A senha também pode ser fornecida pela variável de ambiente " + CommandHandler.DB_PASS_ENV + ".",
                "",
                "Exemplos:",
                "  java -jar jasper-cli.jar --action compile --input relatorio.jrxml",
                "  java -jar jasper-cli.jar --action export --input relatorio.jrxml --output saida.pdf \\",
                "       --db-url jdbc:postgresql://localhost:5432/hospital --db-user app --db-pass segredo \\",
                "       --params \"{\\\"CD_ATENDIMENTO\\\": 1050}\"",
                "  java -jar jasper-cli.jar --action test-conn --db-url jdbc:oracle:thin:@host:1521:ORCL \\",
                "       --db-user app --db-pass segredo"
        }
)
public class Main implements Callable<Integer> {

    @Option(names = "--action", required = true, paramLabel = "<action>", order = 1,
            description = "Obrigatório. compile | fill | export | test-conn | inspect-params")
    private String action;

    @Option(names = "--format", defaultValue = "pdf", paramLabel = "<format>", order = 2,
            description = "pdf | jasper | jrprint (padrão: ${DEFAULT-VALUE}).")
    private String format;

    @Option(names = "--input", paramLabel = "<arquivo>", order = 3,
            description = "Arquivo .jrxml, .jasper ou .jrprint (conforme a ação).")
    private String input;

    @Option(names = "--output", paramLabel = "<arquivo>", order = 4,
            description = "Arquivo (ou diretório) de saída. Padrão: mesmo nome de --input com a nova extensão.")
    private String output;

    @Option(names = "--db-url", paramLabel = "<jdbc-url>", order = 5,
            description = "URL JDBC, ex.: jdbc:postgresql://localhost:5432/hospital")
    private String dbUrl;

    @Option(names = "--db-user", paramLabel = "<usuário>", order = 6,
            description = "Usuário do banco de dados.")
    private String dbUser;

    @Option(names = "--db-pass", paramLabel = "<senha>", order = 7,
            description = "Senha do banco de dados (alternativa: variável " + CommandHandler.DB_PASS_ENV + ").")
    private String dbPass;

    @Option(names = "--custom-driver-jar", paramLabel = "<jar>", order = 8,
            description = "Caminho absoluto de um .jar de driver JDBC externo.")
    private String customDriverJar;

    @Option(names = "--custom-driver-class", paramLabel = "<classe>", order = 9,
            description = "Classe do driver externo, ex.: com.microsoft.sqlserver.jdbc.SQLServerDriver")
    private String customDriverClass;

    @Option(names = "--params", paramLabel = "<json>", order = 10,
            description = "Objeto JSON com os parâmetros do relatório, ex.: '{\"CD_ATENDIMENTO\": 1050}'. "
                    + "Use @arquivo.json para ler de um arquivo.")
    private String params;

    /** Stdout real (UTF-8), reservada para o JSON de saída. */
    private static PrintStream jsonOut;

    public static void main(String[] args) {
        System.setProperty("java.awt.headless", "true");
        jsonOut = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        PrintStream err = new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8);
        // Isola a stdout: logs/prints de bibliotecas vão para a stderr.
        System.setOut(err);
        System.setErr(err);

        int exitCode;
        try {
            CommandLine cmd = new CommandLine(new Main());
            cmd.setOut(new PrintWriter(new OutputStreamWriter(jsonOut, StandardCharsets.UTF_8), true));
            cmd.setErr(new PrintWriter(new OutputStreamWriter(err, StandardCharsets.UTF_8), true));
            cmd.setCaseInsensitiveEnumValuesAllowed(true);
            cmd.setParameterExceptionHandler((ex, argv) -> {
                emit(OutputPayload.error(ErrorType.INVALID_ARGUMENT,
                        ex.getMessage() + ". Use --help para ver as opções disponíveis.", null));
                return 1;
            });
            cmd.setExecutionExceptionHandler((ex, commandLine, parseResult) -> {
                emit(OutputPayload.fromThrowable(ex));
                return 1;
            });
            exitCode = cmd.execute(args);
        } catch (Throwable t) {
            emit(OutputPayload.fromThrowable(t));
            exitCode = 1;
        }
        jsonOut.flush();
        err.flush();
        // Encerra explicitamente: drivers JDBC/AWT podem deixar threads não-daemon vivas.
        System.exit(exitCode);
    }

    @Override
    public Integer call() throws Exception {
        OutputPayload payload = new CommandHandler(this).handle();
        emit(payload);
        return 0;
    }

    static void emit(OutputPayload payload) {
        PrintStream out = jsonOut != null ? jsonOut : System.out;
        out.println(payload.toJson());
        out.flush();
    }

    // ------------------------------------------------------------------ getters

    public String getAction() {
        return action;
    }

    public String getFormat() {
        return format;
    }

    public String getInput() {
        return input;
    }

    public String getOutput() {
        return output;
    }

    public String getDbUrl() {
        return dbUrl;
    }

    public String getDbUser() {
        return dbUser;
    }

    public String getDbPass() {
        return dbPass;
    }

    public String getCustomDriverJar() {
        return customDriverJar;
    }

    public String getCustomDriverClass() {
        return customDriverClass;
    }

    public String getParams() {
        return params;
    }

    /** Lê as versões do recurso filtrado pelo Maven ({@code jasper-cli.properties}). */
    static final class VersionProvider implements IVersionProvider {
        @Override
        public String[] getVersion() {
            Properties p = new Properties();
            try (InputStream in = Main.class.getResourceAsStream("/jasper-cli.properties")) {
                if (in != null) {
                    p.load(in);
                }
            } catch (Exception ignored) {
                // usa valores padrão
            }
            return new String[]{
                    "jasper-cli " + p.getProperty("cli.version", "dev"),
                    "JasperReports " + p.getProperty("jasperreports.version", "?"),
                    "Java " + System.getProperty("java.version") + " (" + System.getProperty("java.vendor") + ")"
            };
        }
    }
}
