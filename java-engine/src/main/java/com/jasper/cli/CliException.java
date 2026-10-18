package com.jasper.cli;

import java.io.IOException;
import java.sql.SQLException;

/**
 * Exceção de domínio do CLI: carrega a categoria ({@link ErrorType}) e uma mensagem
 * legível que será repassada ao usuário final pela extensão.
 */
public class CliException extends Exception {

    private static final long serialVersionUID = 1L;

    private final ErrorType errorType;

    public CliException(ErrorType errorType, String message) {
        this(errorType, message, null);
    }

    public CliException(ErrorType errorType, String message, Throwable cause) {
        super(message, cause);
        this.errorType = errorType;
    }

    public ErrorType getErrorType() {
        return errorType;
    }

    /**
     * Converte uma exceção arbitrária em {@link CliException}, inspecionando a cadeia de
     * causas: falhas SQL viram {@link ErrorType#SQL_ERROR} e falhas de I/O viram
     * {@link ErrorType#IO_ERROR}; caso contrário usa {@code fallback}.
     *
     * @param t        exceção original
     * @param fallback categoria quando nenhuma causa mais específica é encontrada
     * @param context  prefixo descritivo da etapa (ex.: "Falha ao compilar o relatório")
     */
    public static CliException wrap(Throwable t, ErrorType fallback, String context) {
        if (t instanceof CliException) {
            return (CliException) t;
        }
        SQLException sql = findCause(t, SQLException.class);
        if (sql != null) {
            return new CliException(ErrorType.SQL_ERROR,
                    context + ": " + describeSql(sql), t);
        }
        IOException io = findCause(t, IOException.class);
        if (io != null && fallback != ErrorType.COMPILATION_ERROR) {
            return new CliException(ErrorType.IO_ERROR,
                    context + ": " + messageOf(io), t);
        }
        return new CliException(fallback, context + ": " + messageOf(t), t);
    }

    /** Mensagem de um {@link SQLException} incluindo o SQLState, quando disponível. */
    public static String describeSql(SQLException e) {
        String msg = messageOf(e);
        if (e.getSQLState() != null && !e.getSQLState().isEmpty()) {
            msg += " [SQLState: " + e.getSQLState() + "]";
        }
        return msg;
    }

    /** Primeira causa (incluindo a própria exceção) que seja instância de {@code type}. */
    public static <T extends Throwable> T findCause(Throwable t, Class<T> type) {
        Throwable cur = t;
        int guard = 0;
        while (cur != null && guard++ < 20) {
            if (type.isInstance(cur)) {
                return type.cast(cur);
            }
            if (cur.getCause() == cur) {
                break;
            }
            cur = cur.getCause();
        }
        return null;
    }

    /** Mensagem não vazia: usa a mensagem da exceção ou, na falta dela, o nome da classe. */
    public static String messageOf(Throwable t) {
        String m = t.getMessage();
        if (m == null || m.trim().isEmpty()) {
            Throwable c = t.getCause();
            if (c != null && c != t) {
                return messageOf(c);
            }
            return t.getClass().getName();
        }
        return m.trim();
    }
}
