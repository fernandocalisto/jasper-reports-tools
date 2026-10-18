package com.jasper.cli;

/**
 * Categorias de erro expostas no campo {@code errorType} do {@link OutputPayload}.
 *
 * <p>As quatro primeiras fazem parte do contrato base definido em
 * {@code docs/00_CONTEXTO_GERAL.md}; as demais refinam falhas que não se encaixam
 * nelas (argumentos inválidos, preenchimento, exportação, etc.).</p>
 */
public enum ErrorType {
    SQL_ERROR,
    COMPILATION_ERROR,
    IO_ERROR,
    DRIVER_ERROR,
    INVALID_ARGUMENT,
    PARAMETER_ERROR,
    FILL_ERROR,
    EXPORT_ERROR,
    UNKNOWN_ERROR
}
