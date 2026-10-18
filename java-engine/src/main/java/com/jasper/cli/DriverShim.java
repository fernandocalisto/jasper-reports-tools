package com.jasper.cli;

import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverPropertyInfo;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.Properties;
import java.util.logging.Logger;

/**
 * Driver "casca" carregado pelo classloader da aplicação que delega para um driver
 * carregado por um {@link java.net.URLClassLoader} isolado.
 *
 * <p>O {@link java.sql.DriverManager} só entrega conexões de drivers cuja classe seja
 * visível ao classloader de quem chama; registrar o driver externo diretamente faria
 * com que ele fosse ignorado. Registrando este shim, o {@code DriverManager} passa a
 * enxergar o driver externo normalmente.</p>
 */
final class DriverShim implements Driver {

    private final Driver delegate;

    DriverShim(Driver delegate) {
        this.delegate = delegate;
    }

    Driver getDelegate() {
        return delegate;
    }

    @Override
    public Connection connect(String url, Properties info) throws SQLException {
        return delegate.connect(url, info);
    }

    @Override
    public boolean acceptsURL(String url) throws SQLException {
        return delegate.acceptsURL(url);
    }

    @Override
    public DriverPropertyInfo[] getPropertyInfo(String url, Properties info) throws SQLException {
        return delegate.getPropertyInfo(url, info);
    }

    @Override
    public int getMajorVersion() {
        return delegate.getMajorVersion();
    }

    @Override
    public int getMinorVersion() {
        return delegate.getMinorVersion();
    }

    @Override
    public boolean jdbcCompliant() {
        return delegate.jdbcCompliant();
    }

    @Override
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        return delegate.getParentLogger();
    }

    @Override
    public String toString() {
        return "DriverShim[" + delegate.getClass().getName() + "]";
    }
}
