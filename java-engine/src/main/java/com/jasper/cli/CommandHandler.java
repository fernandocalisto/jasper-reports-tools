package com.jasper.cli;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import net.sf.jasperreports.engine.JRReport;
import net.sf.jasperreports.engine.JasperPrint;
import net.sf.jasperreports.engine.JasperReport;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Roteia a execução conforme {@code --action} e devolve o {@link OutputPayload} de sucesso.
 * Qualquer falha é sinalizada via {@link CliException} (ou exceção não verificada), que o
 * {@link Main} converte no payload de erro.
 */
public class CommandHandler {

    public static final List<String> ACTIONS =
            Arrays.asList("compile", "fill", "export", "test-conn", "inspect-params");
    public static final List<String> FORMATS = Arrays.asList("pdf", "jasper", "jrprint");

    /** Variável de ambiente alternativa a {@code --db-pass} (evita expor a senha na linha de comando). */
    public static final String DB_PASS_ENV = "JASPER_CLI_DB_PASS";

    private static final ObjectMapper JSON = new ObjectMapper()
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);

    private final Main opts;
    private final long startNanos = System.nanoTime();

    public CommandHandler(Main opts) {
        this.opts = opts;
    }

    public OutputPayload handle() throws CliException {
        String action = normalize(opts.getAction());
        String format = normalize(opts.getFormat());
        if (format == null) {
            format = "pdf";
        }
        if (!FORMATS.contains(format)) {
            throw new CliException(ErrorType.INVALID_ARGUMENT,
                    "Formato inválido: '" + opts.getFormat() + "'. Valores aceitos: " + String.join(", ", FORMATS));
        }
        if (action == null || !ACTIONS.contains(action)) {
            throw new CliException(ErrorType.INVALID_ARGUMENT,
                    "Ação inválida: '" + opts.getAction() + "'. Valores aceitos: " + String.join(", ", ACTIONS));
        }

        switch (action) {
            case "test-conn":
                return testConnection();
            case "compile":
                return compile();
            case "fill":
                return fill();
            case "export":
                return export(format);
            case "inspect-params":
                return inspectParams();
            default:
                throw new IllegalStateException("Ação não mapeada: " + action);
        }
    }

    // ================================================================== ações

    private OutputPayload testConnection() throws CliException {
        long t0 = System.nanoTime();
        try (Connection conn = openConnection(true)) {
            long latencyMs = elapsedMs(t0);
            OutputPayload out = OutputPayload.success("test-conn").meta("latencyMs", latencyMs);
            try {
                DatabaseMetaData md = conn.getMetaData();
                out.meta("databaseProductName", md.getDatabaseProductName())
                        .meta("databaseProductVersion", md.getDatabaseProductVersion())
                        .meta("driverName", md.getDriverName())
                        .meta("driverVersion", md.getDriverVersion())
                        .meta("userName", md.getUserName());
            } catch (SQLException | RuntimeException | AbstractMethodError ignored) {
                // Metadados são opcionais; a conexão em si já foi validada.
            }
            try {
                out.meta("valid", conn.isValid(5));
            } catch (SQLException | RuntimeException | AbstractMethodError ignored) {
                // Drivers antigos podem não implementar isValid.
            }
            return out.executionTimeMs(elapsedMs(startNanos));
        } catch (SQLException e) {
            // Falha ao fechar a conexão: não invalida o teste, mas reporta como erro SQL.
            throw new CliException(ErrorType.SQL_ERROR,
                    "Erro ao encerrar a conexão: " + CliException.describeSql(e), e);
        }
    }

    private OutputPayload compile() throws CliException {
        Path input = requireInput("jrxml");
        Path output = resolveOutput(input, "jasper");
        JasperProcessor jp = new JasperProcessor(input);
        JasperReport report = jp.compileToFile(input, output);
        return OutputPayload.success("compile")
                .outputFile(output.toString())
                .executionTimeMs(elapsedMs(startNanos))
                .meta("reportName", report.getName())
                .meta("sourceFile", input.toString());
    }

    private OutputPayload fill() throws CliException {
        Path input = requireInput("jrxml", "jasper");
        Path output = resolveOutput(input, "jrprint");
        JasperProcessor jp = new JasperProcessor(input);
        FillResult r = fillReport(jp, input);
        jp.saveJrprint(r.print, output);
        return r.describe(OutputPayload.success("fill"))
                .outputFile(output.toString())
                .executionTimeMs(elapsedMs(startNanos));
    }

    private OutputPayload export(String format) throws CliException {
        if ("jasper".equals(format)) {
            throw new CliException(ErrorType.INVALID_ARGUMENT,
                    "O formato 'jasper' não se aplica a 'export'. Use --action compile para gerar o .jasper.");
        }
        Path input = requireInput("jrxml", "jasper", "jrprint");
        Path output = resolveOutput(input, format);
        JasperProcessor jp = new JasperProcessor(input);

        OutputPayload out = OutputPayload.success("export");
        JasperPrint print;
        if ("jrprint".equals(JasperProcessor.extension(input))) {
            print = jp.loadPrint(input);
            out.meta("reportName", print.getName()).meta("dataSource", "jrprint");
        } else {
            FillResult r = fillReport(jp, input);
            print = r.print;
            r.describe(out);
        }

        if ("pdf".equals(format)) {
            jp.exportPdf(print, output);
        } else {
            jp.saveJrprint(print, output);
        }
        return out.outputFile(output.toString())
                .pages(print.getPages() != null ? print.getPages().size() : 0)
                .meta("format", format)
                .executionTimeMs(elapsedMs(startNanos));
    }

    private OutputPayload inspectParams() throws CliException {
        Path input = requireInput("jrxml", "jasper");
        JasperProcessor jp = new JasperProcessor(input);
        JRReport report = "jrxml".equals(JasperProcessor.extension(input))
                ? jp.loadDesign(input)
                : jp.loadReport(input);
        OutputPayload out = OutputPayload.success("inspect-params");
        JasperProcessor.describe(report).forEach(out::meta);
        return out.executionTimeMs(elapsedMs(startNanos));
    }

    // ================================================================== preenchimento compartilhado

    private static final class FillResult {
        JasperPrint print;
        JasperReport report;
        boolean compiled;
        boolean usedConnection;
        String subreportDir;
        List<String> unknownParameters;

        OutputPayload describe(OutputPayload out) {
            out.pages(print.getPages() != null ? print.getPages().size() : 0)
                    .meta("reportName", report.getName())
                    .meta("compiledOnTheFly", compiled)
                    .meta("dataSource", usedConnection ? "jdbc" : "empty")
                    .meta("subreportDir", subreportDir);
            if (!unknownParameters.isEmpty()) {
                out.meta("unknownParameters", unknownParameters);
            }
            return out;
        }
    }

    private FillResult fillReport(JasperProcessor jp, Path input) throws CliException {
        Map<String, Object> rawParams = parseParams(opts.getParams());

        FillResult r = new FillResult();
        r.compiled = "jrxml".equals(JasperProcessor.extension(input));
        r.report = jp.loadReport(input);
        r.unknownParameters = new ArrayList<>();
        Map<String, Object> params = jp.buildParameters(r.report, rawParams, r.unknownParameters);
        r.subreportDir = jp.getSubreportDir();

        Connection conn = openConnection(false);
        r.usedConnection = conn != null;
        try {
            r.print = jp.fill(r.report, params, conn);
        } finally {
            closeQuietly(conn);
        }
        return r;
    }

    // ================================================================== helpers

    /**
     * Abre a conexão JDBC.
     *
     * @param required se {@code true}, exige {@code --db-url}; caso contrário retorna
     *                 {@code null} quando a URL não for informada (modo mock)
     */
    private Connection openConnection(boolean required) throws CliException {
        if (DatabaseHelper.isBlank(opts.getDbUrl()) && !required) {
            return null;
        }
        String pass = opts.getDbPass();
        if (pass == null) {
            pass = System.getenv(DB_PASS_ENV);
        }
        return DatabaseHelper.openConnection(opts.getDbUrl(), opts.getDbUser(), pass,
                opts.getCustomDriverJar(), opts.getCustomDriverClass());
    }

    /** Interpreta {@code --params}: JSON inline ou {@code @caminho/arquivo.json}. */
    static Map<String, Object> parseParams(String raw) throws CliException {
        if (raw == null || raw.trim().isEmpty()) {
            return new LinkedHashMap<>();
        }
        String json = raw.trim();
        if (json.startsWith("@")) {
            Path file = toPath(json.substring(1), "--params");
            try {
                json = new String(Files.readAllBytes(file), StandardCharsets.UTF_8).trim();
                if (json.startsWith("\uFEFF")) {
                    json = json.substring(1);
                }
            } catch (IOException e) {
                throw new CliException(ErrorType.IO_ERROR,
                        "Não foi possível ler o arquivo de parâmetros: " + file, e);
            }
        }
        try {
            JsonNode node = JSON.readTree(json);
            if (node == null || !node.isObject()) {
                throw new CliException(ErrorType.INVALID_ARGUMENT,
                        "--params deve ser um objeto JSON, ex.: {\"CD_ATENDIMENTO\": 1050}");
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> map = JSON.convertValue(node, LinkedHashMap.class);
            return map;
        } catch (JsonProcessingException e) {
            throw new CliException(ErrorType.INVALID_ARGUMENT,
                    "JSON inválido em --params: " + e.getOriginalMessage(), e);
        }
    }

    private Path requireInput(String... allowedExtensions) throws CliException {
        if (DatabaseHelper.isBlank(opts.getInput())) {
            throw new CliException(ErrorType.INVALID_ARGUMENT,
                    "A ação '" + opts.getAction() + "' exige --input (" + extList(allowedExtensions) + ").");
        }
        Path input = toPath(opts.getInput(), "--input");
        if (!Files.exists(input)) {
            throw new CliException(ErrorType.IO_ERROR, "Arquivo de entrada não encontrado: " + input);
        }
        if (!Files.isRegularFile(input) || !Files.isReadable(input)) {
            throw new CliException(ErrorType.IO_ERROR, "Arquivo de entrada inválido ou sem permissão de leitura: " + input);
        }
        String ext = JasperProcessor.extension(input);
        if (!Arrays.asList(allowedExtensions).contains(ext)) {
            throw new CliException(ErrorType.INVALID_ARGUMENT,
                    "A ação '" + opts.getAction() + "' aceita apenas " + extList(allowedExtensions)
                            + " em --input (recebido: " + input.getFileName() + ").");
        }
        return input;
    }

    private Path resolveOutput(Path input, String ext) throws CliException {
        if (DatabaseHelper.isBlank(opts.getOutput())) {
            return JasperProcessor.withExtension(input, ext);
        }
        Path out = toPath(opts.getOutput(), "--output");
        if (Files.isDirectory(out)) {
            out = out.resolve(JasperProcessor.withExtension(input, ext).getFileName());
        }
        if (out.equals(input)) {
            throw new CliException(ErrorType.INVALID_ARGUMENT,
                    "--output não pode ser o próprio arquivo de entrada: " + out);
        }
        return out;
    }

    private static Path toPath(String raw, String option) throws CliException {
        try {
            return Paths.get(raw.trim()).toAbsolutePath().normalize();
        } catch (InvalidPathException e) {
            throw new CliException(ErrorType.INVALID_ARGUMENT,
                    "Caminho inválido em " + option + ": " + raw, e);
        }
    }

    private static String extList(String... exts) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < exts.length; i++) {
            if (i > 0) {
                sb.append(i == exts.length - 1 ? " ou " : ", ");
            }
            sb.append('.').append(exts[i]);
        }
        return sb.toString();
    }

    private static String normalize(String s) {
        return s == null || s.trim().isEmpty() ? null : s.trim().toLowerCase(Locale.ROOT);
    }

    private static long elapsedMs(long t0) {
        return (System.nanoTime() - t0) / 1_000_000L;
    }

    private static void closeQuietly(Connection c) {
        if (c != null) {
            try {
                c.close();
            } catch (SQLException | RuntimeException ignored) {
                // nada a fazer
            }
        }
    }
}
