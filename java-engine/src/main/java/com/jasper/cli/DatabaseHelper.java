package com.jasper.cli;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Locale;
import java.util.Properties;

/**
 * Cria {@link Connection}s JDBC para os drivers embutidos (PostgreSQL / Oracle) ou para
 * drivers externos carregados por {@link CustomDriverLoader}.
 */
public final class DatabaseHelper {

    /** Tempo máximo para estabelecer a conexão (segundos). */
    static final int LOGIN_TIMEOUT_SECONDS = 20;

    private static final String PG_PREFIX = "jdbc:postgresql:";
    private static final String ORACLE_PREFIX = "jdbc:oracle:";

    private DatabaseHelper() {
    }

    /**
     * Abre uma conexão.
     *
     * @param url         URL JDBC (obrigatória)
     * @param user        usuário (opcional)
     * @param password    senha (opcional)
     * @param driverJar   JAR de driver externo (opcional)
     * @param driverClass classe do driver externo (opcional)
     */
    public static Connection openConnection(String url, String user, String password,
                                            String driverJar, String driverClass) throws CliException {
        if (isBlank(url)) {
            throw new CliException(ErrorType.INVALID_ARGUMENT,
                    "Informe a URL JDBC em --db-url (ex.: jdbc:postgresql://localhost:5432/banco).");
        }
        url = url.trim();

        DriverShim custom = null;
        if (!isBlank(driverJar)) {
            custom = CustomDriverLoader.load(driverJar.trim(), driverClass);
            try {
                if (!custom.acceptsURL(url)) {
                    throw new CliException(ErrorType.DRIVER_ERROR,
                            "O driver " + custom.getDelegate().getClass().getName()
                                    + " não reconhece a URL JDBC informada: " + url);
                }
            } catch (SQLException e) {
                throw new CliException(ErrorType.DRIVER_ERROR,
                        "Falha ao validar a URL no driver externo: " + CliException.messageOf(e), e);
            }
        } else if (!isBlank(driverClass)) {
            // Classe informada sem JAR: precisa estar no classpath embutido.
            try {
                Class.forName(driverClass.trim());
            } catch (ClassNotFoundException | LinkageError e) {
                throw new CliException(ErrorType.DRIVER_ERROR,
                        "Classe de driver '" + driverClass.trim() + "' não está embutida no motor. "
                                + "Informe também --custom-driver-jar com o arquivo .jar do driver.", e);
            }
        } else {
            ensureBuiltinDriverLoaded(url);
        }

        Properties props = new Properties();
        if (user != null) {
            props.setProperty("user", user);
        }
        if (password != null) {
            props.setProperty("password", password);
        }
        if (url.toLowerCase(Locale.ROOT).startsWith(ORACLE_PREFIX)) {
            props.setProperty("oracle.net.CONNECT_TIMEOUT", String.valueOf(LOGIN_TIMEOUT_SECONDS * 1000));
        }

        DriverManager.setLoginTimeout(LOGIN_TIMEOUT_SECONDS);
        try {
            Connection conn = DriverManager.getConnection(url, props);
            if (conn == null) {
                throw new CliException(ErrorType.DRIVER_ERROR,
                        "O driver não retornou conexão para a URL: " + url);
            }
            return conn;
        } catch (SQLException e) {
            throw translate(e, url);
        }
    }

    /** Converte uma {@link SQLException} de conexão em {@link CliException} categorizada. */
    static CliException translate(SQLException e, String url) {
        String msg = CliException.messageOf(e);
        if ("08001".equals(e.getSQLState()) && msg.startsWith("No suitable driver")) {
            return new CliException(ErrorType.DRIVER_ERROR,
                    "Nenhum driver JDBC compatível com a URL '" + url + "'. Drivers embutidos: "
                            + "PostgreSQL (" + PG_PREFIX + ") e Oracle (" + ORACLE_PREFIX + "). "
                            + "Para outros bancos informe --custom-driver-jar e --custom-driver-class.", e);
        }
        return new CliException(ErrorType.SQL_ERROR,
                "Falha ao conectar ao banco de dados: " + CliException.describeSql(e), e);
    }

    /**
     * Garante o registro dos drivers embutidos. Normalmente o {@code ServiceLoader} já os
     * registra, mas forçar a carga evita surpresas caso o arquivo de serviços seja perdido.
     */
    private static void ensureBuiltinDriverLoaded(String url) {
        String lower = url.toLowerCase(Locale.ROOT);
        String cls = null;
        if (lower.startsWith(PG_PREFIX)) {
            cls = "org.postgresql.Driver";
        } else if (lower.startsWith(ORACLE_PREFIX)) {
            cls = "oracle.jdbc.OracleDriver";
        }
        if (cls != null) {
            try {
                Class.forName(cls);
            } catch (ClassNotFoundException | LinkageError ignored) {
                // DriverManager reportará "No suitable driver" adiante.
            }
        }
    }

    static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }
}
