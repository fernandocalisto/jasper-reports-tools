package com.jasper.cli;

import net.sf.jasperreports.engine.DefaultJasperReportsContext;
import net.sf.jasperreports.engine.JREmptyDataSource;
import net.sf.jasperreports.engine.JRException;
import net.sf.jasperreports.engine.JRExpression;
import net.sf.jasperreports.engine.JRField;
import net.sf.jasperreports.engine.JRParameter;
import net.sf.jasperreports.engine.JRQuery;
import net.sf.jasperreports.engine.JRReport;
import net.sf.jasperreports.engine.JasperCompileManager;
import net.sf.jasperreports.engine.JasperExportManager;
import net.sf.jasperreports.engine.JasperFillManager;
import net.sf.jasperreports.engine.JasperPrint;
import net.sf.jasperreports.engine.JasperReport;
import net.sf.jasperreports.engine.SimpleJasperReportsContext;
import net.sf.jasperreports.engine.design.JasperDesign;
import net.sf.jasperreports.engine.util.JRLoader;
import net.sf.jasperreports.engine.util.JRSaver;
import net.sf.jasperreports.engine.xml.JRXmlLoader;
import net.sf.jasperreports.repo.FileRepositoryService;
import net.sf.jasperreports.repo.RepositoryService;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Time;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * Centraliza as chamadas ao JasperReports ({@link JasperCompileManager},
 * {@link JasperFillManager} e {@link JasperExportManager}) e a preparação dos parâmetros.
 *
 * <p>Cada instância é vinculada ao diretório do relatório de entrada: esse diretório é
 * registrado como repositório de arquivos (para resolver sub-relatórios e imagens com
 * caminhos relativos) e é injetado em {@code SUBREPORT_DIR}.</p>
 */
public final class JasperProcessor {

    public static final String SUBREPORT_DIR = "SUBREPORT_DIR";
    public static final Locale DEFAULT_LOCALE = new Locale("pt", "BR");

    private static final DateTimeFormatter[] DATE_TIME_FORMATS = {
            DateTimeFormatter.ISO_LOCAL_DATE_TIME,
            strict("uuuu-MM-dd HH:mm[:ss][.SSS]"),
            strict("dd/MM/uuuu HH:mm[:ss]"),
    };
    private static final DateTimeFormatter[] DATE_FORMATS = {
            DateTimeFormatter.ISO_LOCAL_DATE,
            strict("dd/MM/uuuu"),
    };
    private static final DateTimeFormatter TIME_FORMAT = strict("HH:mm[:ss][.SSS]");

    private final SimpleJasperReportsContext context;
    private final Path baseDir;

    /**
     * @param reportFile arquivo de entrada ({@code .jrxml}, {@code .jasper} ou {@code .jrprint})
     */
    public JasperProcessor(Path reportFile) {
        Path abs = reportFile.toAbsolutePath().normalize();
        this.baseDir = abs.getParent();
        this.context = new SimpleJasperReportsContext(DefaultJasperReportsContext.getInstance());
        // Preview tolerante: fontes ausentes na JVM não abortam o preenchimento/exportação.
        context.setProperty("net.sf.jasperreports.awt.ignore.missing.font", "true");
        if (baseDir != null) {
            context.setExtensions(RepositoryService.class, Collections.singletonList(
                    new FileRepositoryService(context, baseDir.toString(), true)));
        }
    }

    // ================================================================== compilação / carga

    /** Lê o {@code .jrxml} sem compilar (usado na inspeção de parâmetros). */
    public JasperDesign loadDesign(Path jrxml) throws CliException {
        try {
            return JRXmlLoader.load(jrxml.toFile());
        } catch (JRException | RuntimeException e) {
            throw CliException.wrap(e, ErrorType.COMPILATION_ERROR,
                    "JRXML inválido (" + jrxml.getFileName() + ")");
        }
    }

    /** Compila um {@code .jrxml} em memória. */
    public JasperReport compile(Path jrxml) throws CliException {
        JasperDesign design = loadDesign(jrxml);
        ensureSupportedLanguage(design);
        try {
            return JasperCompileManager.getInstance(context).compile(design);
        } catch (JRException | RuntimeException | LinkageError e) {
            throw CliException.wrap(e, ErrorType.COMPILATION_ERROR,
                    "Falha ao compilar o relatório " + jrxml.getFileName());
        }
    }

    /** Compila um {@code .jrxml} e grava o {@code .jasper} resultante. */
    public JasperReport compileToFile(Path jrxml, Path destination) throws CliException {
        JasperReport report = compile(jrxml);
        save(report, destination, "Falha ao gravar o arquivo compilado");
        return report;
    }

    /** Obtém um {@link JasperReport} a partir de {@code .jrxml} (compilando) ou {@code .jasper}. */
    public JasperReport loadReport(Path input) throws CliException {
        String ext = extension(input);
        if ("jrxml".equals(ext)) {
            return compile(input);
        }
        if ("jasper".equals(ext)) {
            Object obj = loadObject(input, "Não foi possível ler o arquivo .jasper "
                    + "(arquivo corrompido ou compilado com versão incompatível do JasperReports)");
            if (!(obj instanceof JasperReport)) {
                throw new CliException(ErrorType.INVALID_ARGUMENT,
                        "O arquivo não contém um relatório compilado: " + input);
            }
            JasperReport report = (JasperReport) obj;
            ensureSupportedLanguage(report);
            return report;
        }
        throw new CliException(ErrorType.INVALID_ARGUMENT,
                "Extensão não suportada para --input: '" + input.getFileName()
                        + "'. Use .jrxml ou .jasper.");
    }

    /** Carrega um {@code .jrprint} previamente preenchido. */
    public JasperPrint loadPrint(Path jrprint) throws CliException {
        Object obj = loadObject(jrprint, "Não foi possível ler o arquivo .jrprint");
        if (!(obj instanceof JasperPrint)) {
            throw new CliException(ErrorType.INVALID_ARGUMENT,
                    "O arquivo não contém um relatório preenchido (.jrprint): " + jrprint);
        }
        return (JasperPrint) obj;
    }

    // ================================================================== preenchimento / exportação

    /**
     * Preenche o relatório. Sem conexão, usa um {@link JREmptyDataSource} de 1 registro
     * (modo "mock"), útil para validar layout sem banco.
     */
    public JasperPrint fill(JasperReport report, Map<String, Object> params, Connection conn) throws CliException {
        try {
            JasperFillManager fm = JasperFillManager.getInstance(context);
            return conn != null
                    ? fm.fill(report, params, conn)
                    : fm.fill(report, params, new JREmptyDataSource(1));
        } catch (JRException | RuntimeException | LinkageError e) {
            throw CliException.wrap(e, ErrorType.FILL_ERROR,
                    "Falha ao preencher o relatório " + report.getName());
        }
    }

    public void exportPdf(JasperPrint print, Path destination) throws CliException {
        ensureParentDir(destination);
        try {
            JasperExportManager.getInstance(context).exportToPdfFile(print, destination.toString());
        } catch (JRException | RuntimeException | LinkageError e) {
            throw CliException.wrap(e, ErrorType.EXPORT_ERROR, "Falha ao exportar o PDF");
        }
    }

    public void saveJrprint(JasperPrint print, Path destination) throws CliException {
        save(print, destination, "Falha ao gravar o arquivo .jrprint");
    }

    // ================================================================== parâmetros

    /**
     * Converte os parâmetros recebidos via JSON para os tipos declarados no relatório e
     * injeta {@code SUBREPORT_DIR} e {@code REPORT_LOCALE} (se não informados).
     *
     * @param report  relatório (define as classes esperadas)
     * @param raw     valores vindos do JSON (pode ser vazio)
     * @param unknown recebe os nomes que não estão declarados no relatório
     */
    public Map<String, Object> buildParameters(JasperReport report, Map<String, Object> raw,
                                               List<String> unknown) throws CliException {
        Map<String, JRParameter> declared = new HashMap<>();
        for (JRParameter p : report.getParameters()) {
            declared.put(p.getName(), p);
        }

        Map<String, Object> out = new HashMap<>();
        for (Map.Entry<String, Object> e : raw.entrySet()) {
            String name = e.getKey();
            JRParameter p = declared.get(name);
            Class<?> target = null;
            if (p == null) {
                unknown.add(name);
            } else {
                target = safeValueClass(p);
            }
            out.put(name, convert(name, e.getValue(), target));
        }

        if (!out.containsKey(SUBREPORT_DIR) && baseDir != null) {
            out.put(SUBREPORT_DIR, getSubreportDir());
        }
        if (!out.containsKey(JRParameter.REPORT_LOCALE)) {
            out.put(JRParameter.REPORT_LOCALE, DEFAULT_LOCALE);
        }
        return out;
    }

    /** Diretório do relatório com separador {@code /} e barra final. */
    public String getSubreportDir() {
        if (baseDir == null) {
            return null;
        }
        String dir = baseDir.toString().replace('\\', '/');
        return dir.endsWith("/") ? dir : dir + "/";
    }

    /** Converte um valor JSON para a classe esperada pelo parâmetro. */
    static Object convert(String name, Object value, Class<?> target) throws CliException {
        if (value == null || target == null || target == Object.class || target.isInstance(value)) {
            return value;
        }
        try {
            if (value instanceof String && ((String) value).trim().isEmpty() && target != String.class) {
                return null;
            }
            if (target == String.class) {
                return String.valueOf(value);
            }
            if (Number.class.isAssignableFrom(target)) {
                return toNumber(value, target);
            }
            if (target == Boolean.class) {
                return toBoolean(value);
            }
            if (target == Character.class) {
                String s = String.valueOf(value);
                if (s.length() == 1) {
                    return s.charAt(0);
                }
            }
            if (Date.class.isAssignableFrom(target)) {
                return toDate(value, target);
            }
            if (target == LocalDate.class) {
                return toLocalDateTime(value).toLocalDate();
            }
            if (target == LocalDateTime.class) {
                return toLocalDateTime(value);
            }
            if (target == LocalTime.class) {
                return toLocalTime(value);
            }
            if (target == Locale.class) {
                return Locale.forLanguageTag(String.valueOf(value).trim().replace('_', '-'));
            }
            if (target == TimeZone.class) {
                return TimeZone.getTimeZone(String.valueOf(value).trim());
            }
            if (Collection.class.isAssignableFrom(target)) {
                return toCollection(value, target);
            }
            Object reflected = viaStringFactory(String.valueOf(value), target);
            if (reflected != null) {
                return reflected;
            }
        } catch (RuntimeException e) {
            throw paramError(name, value, target, e);
        }
        throw paramError(name, value, target, null);
    }

    // ================================================================== inspeção

    /** Descreve parâmetros (exceto os de sistema), campos e query de um relatório/design. */
    public static Map<String, Object> describe(JRReport report) {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("reportName", report.getName());
        meta.put("language", report.getLanguage());

        List<Map<String, Object>> params = new ArrayList<>();
        JRParameter[] declared = report.getParameters();
        if (declared != null) {
            for (JRParameter p : declared) {
                if (p.isSystemDefined()) {
                    continue;
                }
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("name", p.getName());
                m.put("className", p.getValueClassName());
                putIfNotNull(m, "description", p.getDescription());
                JRExpression def = p.getDefaultValueExpression();
                putIfNotNull(m, "defaultValue", def != null ? def.getText() : null);
                m.put("isForPrompting", p.isForPrompting());
                params.add(m);
            }
        }
        meta.put("parameters", params);

        List<Map<String, Object>> fields = new ArrayList<>();
        JRField[] declaredFields = report.getFields();
        if (declaredFields != null) {
            for (JRField f : declaredFields) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("name", f.getName());
                m.put("className", f.getValueClassName());
                putIfNotNull(m, "description", f.getDescription());
                fields.add(m);
            }
        }
        meta.put("fields", fields);

        JRQuery query = report.getQuery();
        if (query != null) {
            putIfNotNull(meta, "queryString", query.getText());
            putIfNotNull(meta, "queryLanguage", query.getLanguage());
        }
        return meta;
    }

    // ================================================================== utilitários

    public static String extension(Path p) {
        String n = p.getFileName() != null ? p.getFileName().toString() : "";
        int i = n.lastIndexOf('.');
        return i >= 0 ? n.substring(i + 1).toLowerCase(Locale.ROOT) : "";
    }

    /** Troca a extensão do arquivo (ex.: relatorio.jrxml -> relatorio.pdf). */
    public static Path withExtension(Path p, String newExt) {
        String n = p.getFileName().toString();
        int i = n.lastIndexOf('.');
        String base = i > 0 ? n.substring(0, i) : n;
        return p.resolveSibling(base + "." + newExt);
    }

    private static void ensureSupportedLanguage(JRReport report) throws CliException {
        String lang = report.getLanguage();
        if (lang != null && !JRReport.LANGUAGE_JAVA.equalsIgnoreCase(lang.trim())) {
            throw new CliException(ErrorType.COMPILATION_ERROR,
                    "O relatório '" + report.getName() + "' usa language=\"" + lang + "\", que não é suportada "
                            + "por este motor. Altere o atributo language do <jasperReport> para \"java\".");
        }
    }

    private Object loadObject(Path file, String errorMessage) throws CliException {
        try {
            return JRLoader.loadObject(context, file.toFile());
        } catch (JRException | RuntimeException | LinkageError e) {
            throw new CliException(ErrorType.IO_ERROR,
                    errorMessage + ": " + CliException.messageOf(e), e);
        }
    }

    private static void save(Object obj, Path destination, String errorMessage) throws CliException {
        ensureParentDir(destination);
        try {
            JRSaver.saveObject(obj, destination.toFile());
        } catch (JRException | RuntimeException e) {
            throw new CliException(ErrorType.IO_ERROR,
                    errorMessage + " (" + destination + "): " + CliException.messageOf(e), e);
        }
    }

    private static void ensureParentDir(Path destination) throws CliException {
        Path parent = destination.toAbsolutePath().getParent();
        if (parent == null) {
            return;
        }
        try {
            Files.createDirectories(parent);
        } catch (Exception e) {
            throw new CliException(ErrorType.IO_ERROR,
                    "Não foi possível criar o diretório de saída: " + parent, e);
        }
    }

    private static Class<?> safeValueClass(JRParameter p) {
        try {
            return p.getValueClass();
        } catch (RuntimeException | LinkageError e) {
            return null; // classe não carregável: repassa o valor bruto
        }
    }

    private static void putIfNotNull(Map<String, Object> m, String k, Object v) {
        if (v != null) {
            m.put(k, v);
        }
    }

    private static CliException paramError(String name, Object value, Class<?> target, Throwable cause) {
        return new CliException(ErrorType.PARAMETER_ERROR,
                "Não foi possível converter o parâmetro '" + name + "' (valor: " + value + ") para "
                        + target.getName() + (cause != null ? ": " + CliException.messageOf(cause) : "."),
                cause);
    }

    private static DateTimeFormatter strict(String pattern) {
        return DateTimeFormatter.ofPattern(pattern).withResolverStyle(ResolverStyle.STRICT);
    }

    // ---------------------------------------------------------------- números

    private static Object toNumber(Object value, Class<?> target) {
        BigDecimal bd = toBigDecimal(value);
        if (target == Integer.class) {
            return bd.intValueExact();
        }
        if (target == Long.class) {
            return bd.longValueExact();
        }
        if (target == Short.class) {
            return bd.shortValueExact();
        }
        if (target == Byte.class) {
            return bd.byteValueExact();
        }
        if (target == Double.class) {
            return bd.doubleValue();
        }
        if (target == Float.class) {
            return bd.floatValue();
        }
        if (target == BigInteger.class) {
            return bd.toBigIntegerExact();
        }
        // BigDecimal, Number e demais subclasses genéricas
        return bd;
    }

    private static BigDecimal toBigDecimal(Object v) {
        if (v instanceof BigDecimal) {
            return (BigDecimal) v;
        }
        if (v instanceof BigInteger) {
            return new BigDecimal((BigInteger) v);
        }
        if (v instanceof Double || v instanceof Float) {
            return BigDecimal.valueOf(((Number) v).doubleValue());
        }
        if (v instanceof Number) {
            return BigDecimal.valueOf(((Number) v).longValue());
        }
        if (v instanceof Boolean) {
            return (Boolean) v ? BigDecimal.ONE : BigDecimal.ZERO;
        }
        String s = String.valueOf(v).trim();
        if (s.indexOf(',') >= 0) {
            // Aceita formato brasileiro: "1.234,56" ou "10,5"
            s = s.replace(".", "").replace(',', '.');
        }
        return new BigDecimal(s);
    }

    private static Boolean toBoolean(Object v) {
        if (v instanceof Number) {
            return ((Number) v).doubleValue() != 0d;
        }
        String s = String.valueOf(v).trim().toLowerCase(Locale.ROOT);
        switch (s) {
            case "true": case "t": case "1": case "s": case "sim": case "y": case "yes":
                return Boolean.TRUE;
            case "false": case "f": case "0": case "n": case "nao": case "não": case "no":
                return Boolean.FALSE;
            default:
                throw new IllegalArgumentException("valor booleano não reconhecido");
        }
    }

    // ---------------------------------------------------------------- datas

    private static Object toDate(Object value, Class<?> target) {
        if (target == Time.class) {
            if (value instanceof Number) {
                return new Time(((Number) value).longValue());
            }
            if (value instanceof Date) {
                return new Time(((Date) value).getTime());
            }
            String s = String.valueOf(value).trim();
            if (s.length() <= 12 && s.indexOf(':') > 0) {
                return Time.valueOf(LocalTime.parse(s, TIME_FORMAT));
            }
            return new Time(toEpochMillis(value));
        }
        long ms = toEpochMillis(value);
        if (target == Timestamp.class) {
            return new Timestamp(ms);
        }
        if (target == java.sql.Date.class) {
            return new java.sql.Date(ms);
        }
        return new Date(ms);
    }

    private static long toEpochMillis(Object value) {
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        if (value instanceof Date) {
            return ((Date) value).getTime();
        }
        String s = String.valueOf(value).trim();
        if (s.matches("-?\\d{9,}")) {
            return Long.parseLong(s);
        }
        try {
            return OffsetDateTime.parse(s).toInstant().toEpochMilli(); // 2024-01-31T10:00:00Z / -03:00
        } catch (DateTimeParseException ignored) {
            // tenta formatos locais
        }
        return toLocalDateTime(s).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }

    private static LocalDateTime toLocalDateTime(Object value) {
        if (value instanceof Number || value instanceof Date) {
            long ms = value instanceof Number ? ((Number) value).longValue() : ((Date) value).getTime();
            return LocalDateTime.ofInstant(Instant.ofEpochMilli(ms), ZoneId.systemDefault());
        }
        String s = String.valueOf(value).trim();
        for (DateTimeFormatter f : DATE_TIME_FORMATS) {
            try {
                return LocalDateTime.parse(s, f);
            } catch (DateTimeParseException ignored) {
                // próximo formato
            }
        }
        for (DateTimeFormatter f : DATE_FORMATS) {
            try {
                return LocalDate.parse(s, f).atStartOfDay();
            } catch (DateTimeParseException ignored) {
                // próximo formato
            }
        }
        try {
            return LocalDateTime.ofInstant(OffsetDateTime.parse(s).toInstant(), ZoneId.systemDefault());
        } catch (DateTimeParseException ignored) {
            // cai no erro abaixo
        }
        throw new IllegalArgumentException("formato de data não reconhecido (use yyyy-MM-dd, "
                + "yyyy-MM-dd HH:mm:ss, dd/MM/yyyy, ISO-8601 ou epoch em ms)");
    }

    private static LocalTime toLocalTime(Object value) {
        String s = String.valueOf(value).trim();
        try {
            return LocalTime.parse(s, TIME_FORMAT);
        } catch (DateTimeParseException e) {
            return toLocalDateTime(value).toLocalTime();
        }
    }

    // ---------------------------------------------------------------- coleções / reflexão

    private static Collection<Object> toCollection(Object value, Class<?> target) {
        Collection<Object> out = Set.class.isAssignableFrom(target) ? new LinkedHashSet<>() : new ArrayList<>();
        if (value instanceof Collection) {
            out.addAll((Collection<?>) value);
        } else if (value.getClass().isArray()) {
            Collections.addAll(out, (Object[]) value);
        } else {
            out.add(value);
        }
        return out;
    }

    private static Object viaStringFactory(String s, Class<?> target) {
        try {
            Method m = target.getMethod("valueOf", String.class);
            if (Modifier.isStatic(m.getModifiers()) && target.isAssignableFrom(m.getReturnType())) {
                return m.invoke(null, s.trim());
            }
        } catch (ReflectiveOperationException ignored) {
            // tenta construtor
        }
        try {
            Constructor<?> c = target.getConstructor(String.class);
            return c.newInstance(s);
        } catch (ReflectiveOperationException ignored) {
            return null;
        }
    }
}
