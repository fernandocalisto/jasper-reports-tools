package com.jasper.cli;

import java.net.MalformedURLException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Driver;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Iterator;
import java.util.ServiceConfigurationError;
import java.util.ServiceLoader;

/**
 * Carrega drivers JDBC externos (fornecidos pelo usuário como arquivo {@code .jar}) em um
 * {@link URLClassLoader} isolado e os registra no {@link DriverManager} via {@link DriverShim}.
 *
 * <p>O classloader isolado usa o <em>platform classloader</em> como pai, de modo que as
 * classes do driver externo não colidem com as bibliotecas embutidas no fat jar
 * (inclusive os drivers PostgreSQL/Oracle nativos).</p>
 */
public final class CustomDriverLoader {

    private CustomDriverLoader() {
    }

    /**
     * Carrega e registra o driver.
     *
     * @param jarPath     caminho do arquivo {@code .jar} do driver
     * @param driverClass nome completo da classe do driver; se {@code null}, tenta descobrir
     *                    via {@code META-INF/services/java.sql.Driver} do próprio jar
     * @return o {@link DriverShim} registrado no {@link DriverManager}
     */
    public static DriverShim load(String jarPath, String driverClass) throws CliException {
        Path jar = Paths.get(jarPath).toAbsolutePath().normalize();
        if (!Files.isRegularFile(jar)) {
            throw new CliException(ErrorType.DRIVER_ERROR,
                    "Arquivo JAR do driver não encontrado: " + jar);
        }
        if (!Files.isReadable(jar)) {
            throw new CliException(ErrorType.DRIVER_ERROR,
                    "Sem permissão de leitura no JAR do driver: " + jar);
        }

        URLClassLoader loader;
        try {
            loader = new URLClassLoader(new URL[]{jar.toUri().toURL()},
                    ClassLoader.getPlatformClassLoader());
        } catch (MalformedURLException e) {
            throw new CliException(ErrorType.DRIVER_ERROR,
                    "Caminho inválido para o JAR do driver: " + jar, e);
        }

        Driver driver = (driverClass == null || driverClass.trim().isEmpty())
                ? discover(loader, jar)
                : instantiate(loader, driverClass.trim(), jar);

        DriverShim shim = new DriverShim(driver);
        try {
            DriverManager.registerDriver(shim);
        } catch (SQLException e) {
            throw new CliException(ErrorType.DRIVER_ERROR,
                    "Falha ao registrar o driver no DriverManager: " + CliException.messageOf(e), e);
        }
        return shim;
    }

    private static Driver instantiate(ClassLoader loader, String className, Path jar) throws CliException {
        Class<?> cls;
        try {
            cls = Class.forName(className, true, loader);
        } catch (ClassNotFoundException e) {
            throw new CliException(ErrorType.DRIVER_ERROR,
                    "Classe do driver '" + className + "' não encontrada em " + jar, e);
        } catch (LinkageError e) {
            throw new CliException(ErrorType.DRIVER_ERROR,
                    "Falha ao carregar a classe do driver '" + className + "' (dependência ausente ou "
                            + "versão de Java incompatível): " + CliException.messageOf(e), e);
        }
        if (!Driver.class.isAssignableFrom(cls)) {
            throw new CliException(ErrorType.DRIVER_ERROR,
                    "A classe '" + className + "' não implementa java.sql.Driver.");
        }
        try {
            return (Driver) cls.getDeclaredConstructor().newInstance();
        } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
            throw new CliException(ErrorType.DRIVER_ERROR,
                    "Não foi possível instanciar o driver '" + className + "': " + CliException.messageOf(e), e);
        }
    }

    private static Driver discover(ClassLoader loader, Path jar) throws CliException {
        try {
            Iterator<Driver> it = ServiceLoader.load(Driver.class, loader).iterator();
            while (it.hasNext()) {
                Driver d = it.next();
                if (d.getClass().getClassLoader() == loader) {
                    return d;
                }
            }
        } catch (ServiceConfigurationError e) {
            throw new CliException(ErrorType.DRIVER_ERROR,
                    "Falha ao descobrir o driver declarado em " + jar + ": " + CliException.messageOf(e), e);
        }
        throw new CliException(ErrorType.DRIVER_ERROR,
                "Nenhum driver JDBC declarado em " + jar + ". Informe --custom-driver-class.");
    }
}
