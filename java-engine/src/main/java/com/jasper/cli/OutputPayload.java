package com.jasper.cli;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * POJO serializado com Jackson que representa a única saída do CLI na stdout.
 *
 * <p>Sucesso:</p>
 * <pre>{"status":"SUCCESS","action":"export","outputFile":"...","executionTimeMs":450,"pages":1,"metadata":{}}</pre>
 * <p>Erro:</p>
 * <pre>{"status":"ERROR","errorType":"SQL_ERROR","message":"...","stackTraceSnippet":"..."}</pre>
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonPropertyOrder({"status", "action", "outputFile", "executionTimeMs", "pages", "metadata",
        "errorType", "message", "stackTraceSnippet"})
public class OutputPayload {

    public static final String STATUS_SUCCESS = "SUCCESS";
    public static final String STATUS_ERROR = "ERROR";

    private static final int MAX_CAUSES = 5;
    private static final int MAX_FRAMES_PER_CAUSE = 6;

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT)
            .disable(SerializationFeature.FAIL_ON_EMPTY_BEANS);

    private String status;
    private String action;
    private String outputFile;
    private Long executionTimeMs;
    private Integer pages;
    private Map<String, Object> metadata;
    private String errorType;
    private String message;
    private String stackTraceSnippet;

    public OutputPayload() {
    }

    // ------------------------------------------------------------------ fábricas

    public static OutputPayload success(String action) {
        OutputPayload p = new OutputPayload();
        p.status = STATUS_SUCCESS;
        p.action = action;
        p.metadata = new LinkedHashMap<>();
        return p;
    }

    public static OutputPayload error(ErrorType type, String message, Throwable cause) {
        OutputPayload p = new OutputPayload();
        p.status = STATUS_ERROR;
        p.errorType = (type != null ? type : ErrorType.UNKNOWN_ERROR).name();
        p.message = message;
        p.stackTraceSnippet = cause != null ? snippet(cause) : null;
        return p;
    }

    /** Constrói um payload de erro a partir de qualquer {@link Throwable}. */
    public static OutputPayload fromThrowable(Throwable t) {
        if (t instanceof CliException) {
            CliException ce = (CliException) t;
            return error(ce.getErrorType(), ce.getMessage(), ce.getCause() != null ? ce.getCause() : ce);
        }
        CliException wrapped = CliException.wrap(t, ErrorType.UNKNOWN_ERROR, "Erro inesperado");
        return error(wrapped.getErrorType(), wrapped.getMessage(), t);
    }

    // ------------------------------------------------------------------ fluent helpers

    public OutputPayload outputFile(String path) {
        this.outputFile = path;
        return this;
    }

    public OutputPayload executionTimeMs(long ms) {
        this.executionTimeMs = ms;
        return this;
    }

    public OutputPayload pages(int pages) {
        this.pages = pages;
        return this;
    }

    public OutputPayload meta(String key, Object value) {
        if (metadata == null) {
            metadata = new LinkedHashMap<>();
        }
        if (value != null) {
            metadata.put(key, value);
        }
        return this;
    }

    // ------------------------------------------------------------------ serialização

    public String toJson() {
        try {
            return MAPPER.writeValueAsString(this);
        } catch (Throwable e) {
            // Fallback sem Jackson: nunca deixa a stdout sem JSON válido.
            return fallbackJson(e);
        }
    }

    private String fallbackJson(Throwable serializationError) {
        StringBuilder sb = new StringBuilder("{");
        appendField(sb, "status", status != null ? status : STATUS_ERROR);
        if (STATUS_SUCCESS.equals(status)) {
            appendField(sb, "action", action);
            appendField(sb, "outputFile", outputFile);
            if (executionTimeMs != null) {
                sb.append(",\"executionTimeMs\":").append(executionTimeMs);
            }
            if (pages != null) {
                sb.append(",\"pages\":").append(pages);
            }
            sb.append(",\"metadata\":{}");
        } else {
            appendField(sb, "errorType", errorType != null ? errorType : ErrorType.UNKNOWN_ERROR.name());
            appendField(sb, "message", message != null ? message
                    : "Falha ao serializar a saída: " + serializationError);
            appendField(sb, "stackTraceSnippet", stackTraceSnippet);
        }
        return sb.append('}').toString();
    }

    private static void appendField(StringBuilder sb, String key, String value) {
        if (value == null) {
            return;
        }
        if (sb.length() > 1) {
            sb.append(',');
        }
        sb.append('"').append(key).append("\":\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
    }

    /**
     * Resumo compacto do stack trace: para cada exceção da cadeia (até {@value #MAX_CAUSES}),
     * uma linha de cabeçalho seguida das primeiras {@value #MAX_FRAMES_PER_CAUSE} chamadas.
     */
    static String snippet(Throwable t) {
        StringBuilder sb = new StringBuilder();
        Throwable cur = t;
        int depth = 0;
        while (cur != null && depth < MAX_CAUSES) {
            if (depth > 0) {
                sb.append("Caused by: ");
            }
            String msg = cur.getMessage();
            sb.append(cur.getClass().getName());
            if (msg != null) {
                String firstLine = msg.trim().split("\\R", 2)[0];
                sb.append(": ").append(firstLine);
            }
            sb.append('\n');
            StackTraceElement[] frames = cur.getStackTrace();
            int n = Math.min(frames.length, MAX_FRAMES_PER_CAUSE);
            for (int i = 0; i < n; i++) {
                sb.append("\tat ").append(frames[i]).append('\n');
            }
            if (frames.length > n) {
                sb.append("\t... ").append(frames.length - n).append(" more\n");
            }
            if (cur.getCause() == cur) {
                break;
            }
            cur = cur.getCause();
            depth++;
        }
        return sb.toString().trim();
    }

    // ------------------------------------------------------------------ getters (Jackson)

    public String getStatus() {
        return status;
    }

    public String getAction() {
        return action;
    }

    public String getOutputFile() {
        return outputFile;
    }

    public Long getExecutionTimeMs() {
        return executionTimeMs;
    }

    public Integer getPages() {
        return pages;
    }

    public Map<String, Object> getMetadata() {
        return metadata;
    }

    public String getErrorType() {
        return errorType;
    }

    public String getMessage() {
        return message;
    }

    public String getStackTraceSnippet() {
        return stackTraceSnippet;
    }

    // ------------------------------------------------------------------ setters (Jackson)

    public void setStatus(String status) {
        this.status = status;
    }

    public void setAction(String action) {
        this.action = action;
    }

    public void setOutputFile(String outputFile) {
        this.outputFile = outputFile;
    }

    public void setExecutionTimeMs(Long executionTimeMs) {
        this.executionTimeMs = executionTimeMs;
    }

    public void setPages(Integer pages) {
        this.pages = pages;
    }

    public void setMetadata(Map<String, Object> metadata) {
        this.metadata = metadata;
    }

    public void setErrorType(String errorType) {
        this.errorType = errorType;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public void setStackTraceSnippet(String stackTraceSnippet) {
        this.stackTraceSnippet = stackTraceSnippet;
    }
}
