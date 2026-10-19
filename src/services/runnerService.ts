import type * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { buildJdbcUrl, DatabaseProfile } from '../models/database';

export { buildJdbcUrl };

export interface InspectQueryColumn {
  name: string;
  jdbcType: string;
  precision: number;
  scale: number;
  nullable: number;
  javaClass: string;
}

export interface InspectQueryOptions {
  reportPath: string;
  dbProfile: DatabaseProfile;
  password?: string;
  params?: Record<string, any>;
}

export interface CliSuccessResponse {
  status: 'SUCCESS';
  action: string;
  outputFile?: string;
  executionTimeMs: number;
  pages?: number;
  columns?: InspectQueryColumn[];
  metadata?: Record<string, any>;
}

export interface CliErrorResponse {
  status: 'ERROR';
  errorType: string;
  message: string;
  stackTraceSnippet?: string;
}

export interface FillExportOptions {
  jrxmlPath?: string;
  inputPath?: string;
  outputPath?: string;
  format?: 'pdf' | 'jrprint';
  dbProfile?: DatabaseProfile;
  profile?: DatabaseProfile;
  password?: string;
  params?: Record<string, any>;
}

export interface JavaEnvironmentInfo {
  available: boolean;
  executable: string;
  version?: string;
  majorVersion?: number;
  message?: string;
}

export interface ExtensionContextLike {
  asAbsolutePath(relativePath: string): string;
}

export interface RunnerServiceOptions {
  timeoutMs?: number;
  javaExecutable?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const JAVA_DOWNLOAD_URL = 'https://adoptium.net/';

/**
 * Erro tipado retornado quando o `jasper-cli.jar` falha ou quando o ambiente/processo apresenta erro.
 */
export class RunnerCliError extends Error implements CliErrorResponse {
  public readonly status: 'ERROR' = 'ERROR';
  public readonly errorType: string;
  public readonly stackTraceSnippet?: string;

  constructor(errorType: string, message: string, stackTraceSnippet?: string) {
    super(message);
    this.name = 'RunnerCliError';
    this.errorType = errorType;
    this.stackTraceSnippet = stackTraceSnippet;
    Object.setPrototypeOf(this, RunnerCliError.prototype);
  }

  public toJSON(): CliErrorResponse {
    return {
      status: 'ERROR',
      errorType: this.errorType,
      message: this.message,
      ...(this.stackTraceSnippet ? { stackTraceSnippet: this.stackTraceSnippet } : {})
    };
  }
}

function getVscodeApi(): typeof vscode | undefined {
  try {
    // Carregamento condicional para permitir execução do RunnerService também em testes Node.js puros
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('vscode') as typeof vscode;
  } catch {
    return undefined;
  }
}

function parseJavaMajorVersion(versionOutput: string): { version?: string; major?: number } {
  const match = /(?:version\s+"|openjdk\s+|java\s+)(\d+)(?:\.(\d+))?(?:\.(\d+))?/i.exec(
    versionOutput
  );
  if (!match) {
    return {};
  }
  const first = parseInt(match[1], 10);
  const second = match[2] ? parseInt(match[2], 10) : 0;
  const major = first === 1 ? second : first;
  const rawVerMatch = /version\s+"([^"]+)"/i.exec(versionOutput);
  return {
    version: rawVerMatch ? rawVerMatch[1] : match[0],
    major
  };
}

function findFallbackJavaOnDisk(): string | undefined {
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'java.exe' : 'java';

  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, 'bin', binName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (isWin) {
    const vendorDirs = [
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Amazon Corretto',
      'C:\\Program Files\\BellSoft'
    ];
    for (const vendorDir of vendorDirs) {
      if (!fs.existsSync(vendorDir)) {
        continue;
      }
      try {
        const subdirs = fs
          .readdirSync(vendorDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort()
          .reverse();
        for (const sub of subdirs) {
          const candidate = path.join(vendorDir, sub, 'bin', binName);
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      } catch {
        // Ignora diretórios sem permissão de leitura
      }
    }
  }

  return undefined;
}

export class RunnerService {
  private readonly context?: ExtensionContextLike;
  private readonly explicitJarPath?: string;
  private readonly timeoutMs: number;
  private resolvedJavaExecutable?: string;

  constructor(
    contextOrJarPath?: ExtensionContextLike | string,
    options?: RunnerServiceOptions
  ) {
    if (typeof contextOrJarPath === 'string') {
      this.explicitJarPath = contextOrJarPath;
    } else if (contextOrJarPath && typeof contextOrJarPath.asAbsolutePath === 'function') {
      this.context = contextOrJarPath;
    }
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (options?.javaExecutable) {
      this.resolvedJavaExecutable = options.javaExecutable;
    }
  }

  /**
   * Resolve o caminho absoluto para `bin/jasper-cli.jar`.
   */
  public getJarPath(): string {
    if (this.explicitJarPath) {
      return path.resolve(this.explicitJarPath);
    }
    if (this.context) {
      return this.context.asAbsolutePath('bin/jasper-cli.jar');
    }
    return path.resolve(__dirname, '..', '..', 'bin', 'jasper-cli.jar');
  }

  /**
   * Verifica se o arquivo `bin/jasper-cli.jar` existe no disco.
   */
  private ensureJarExists(notifyUser = true): string {
    const jarPath = this.getJarPath();
    if (!fs.existsSync(jarPath)) {
      const msg =
        `Motor Java não encontrado em "${jarPath}". ` +
        'Compile o subprojeto Java executando "mvn clean package" dentro da pasta java-engine/.';
      const vscodeApi = getVscodeApi();
      if (notifyUser && vscodeApi) {
        void vscodeApi.window.showErrorMessage(msg);
      }
      throw new RunnerCliError('JAR_NOT_FOUND', msg);
    }
    return jarPath;
  }

  /**
   * Verifica se o comando `java` (JRE/JDK 11+) está acessível no sistema operacional.
   */
  public async checkJavaEnvironment(notifyUser = true): Promise<JavaEnvironmentInfo> {
    const candidates: string[] = [];
    if (this.resolvedJavaExecutable) {
      candidates.push(this.resolvedJavaExecutable);
    } else {
      candidates.push('java');
      const fallback = findFallbackJavaOnDisk();
      if (fallback && !candidates.includes(fallback)) {
        candidates.push(fallback);
      }
    }

    for (const candidate of candidates) {
      const checkResult = await this.probeJavaBinary(candidate);
      if (checkResult.available && (checkResult.majorVersion ?? 11) >= 11) {
        this.resolvedJavaExecutable = candidate;
        return checkResult;
      }
      if (checkResult.available && (checkResult.majorVersion ?? 0) < 11) {
        const msg =
          `Versão do Java incompatível (${checkResult.version || 'desconhecida'}). ` +
          'O JasperReports Developer Tools requer JRE/JDK 11 ou superior.';
        if (notifyUser) {
          this.promptJavaDocumentation(msg);
        }
        return {
          available: false,
          executable: candidate,
          version: checkResult.version,
          majorVersion: checkResult.majorVersion,
          message: msg
        };
      }
    }

    const notFoundMsg =
      'JRE/JDK 11+ não foi encontrado no PATH do sistema operacional. ' +
      'Instale o Java 11 ou superior e verifique a variável JAVA_HOME / PATH.';
    if (notifyUser) {
      this.promptJavaDocumentation(notFoundMsg);
    }

    return {
      available: false,
      executable: candidates[0] || 'java',
      message: notFoundMsg
    };
  }

  private promptJavaDocumentation(message: string): void {
    const vscodeApi = getVscodeApi();
    if (!vscodeApi) {
      return;
    }
    void vscodeApi.window
      .showErrorMessage(message, 'Baixar Java 11+ (Documentação)')
      .then((selection) => {
        if (selection === 'Baixar Java 11+ (Documentação)') {
          void vscodeApi.env.openExternal(vscodeApi.Uri.parse(JAVA_DOWNLOAD_URL));
        }
      });
  }

  private probeJavaBinary(executable: string): Promise<JavaEnvironmentInfo> {
    return new Promise<JavaEnvironmentInfo>((resolve) => {
      execFile(
        executable,
        ['-version'],
        { timeout: 10_000, windowsHide: true },
        (error, stdout, stderr) => {
          const combined = `${stderr || ''}\n${stdout || ''}`.trim();
          if (error && !combined) {
            resolve({
              available: false,
              executable,
              message: error.message
            });
            return;
          }
          const parsed = parseJavaMajorVersion(combined);
          resolve({
            available: true,
            executable,
            version: parsed.version,
            majorVersion: parsed.major ?? 11
          });
        }
      );
    });
  }

  /**
   * Testa a conexão com o banco de dados invocando `--action test-conn`.
   */
  public async testConnection(
    profile: DatabaseProfile,
    password?: string
  ): Promise<CliSuccessResponse> {
    if (profile.driver === 'custom') {
      if (!profile.customDriverPath || !fs.existsSync(profile.customDriverPath)) {
        throw new RunnerCliError(
          'DRIVER_ERROR',
          `Arquivo JAR do driver personalizado não encontrado: ${profile.customDriverPath || '(vazio)'}`
        );
      }
      if (!profile.customDriverClass || profile.customDriverClass.trim().length === 0) {
        throw new RunnerCliError(
          'DRIVER_ERROR',
          'A classe do driver JDBC personalizado não foi informada.'
        );
      }
    }

    const jdbcUrl = buildJdbcUrl(profile);
    const args: string[] = ['--action', 'test-conn', '--db-url', jdbcUrl];

    if (profile.user) {
      args.push('--db-user', profile.user);
    }
    if (password) {
      args.push('--db-pass', password);
    }
    if (profile.driver === 'custom') {
      if (profile.customDriverPath) {
        args.push('--custom-driver-jar', profile.customDriverPath);
      }
      if (profile.customDriverClass) {
        args.push('--custom-driver-class', profile.customDriverClass);
      }
    }

    return this.executeCli(args, password);
  }

  /**
   * Compila um arquivo `.jrxml` gerando o `.jasper` correspondente.
   */
  public async compileReport(
    jrxmlPath: string,
    outputPath?: string
  ): Promise<CliSuccessResponse> {
    const args: string[] = ['--action', 'compile', '--input', jrxmlPath];
    if (outputPath) {
      args.push('--output', outputPath);
    }
    return this.executeCli(args);
  }

  /**
   * Preenche o relatório (compilando em memória se for `.jrxml`) e exporta para PDF ou `.jrprint`.
   */
  public async fillAndExport(options: FillExportOptions): Promise<CliSuccessResponse> {
    const input = options.jrxmlPath || options.inputPath;
    if (!input) {
      throw new RunnerCliError(
        'INVALID_ARGUMENT',
        'O caminho do relatório (jrxmlPath) é obrigatório para fillAndExport.'
      );
    }

    const format = options.format || 'pdf';
    const args: string[] = ['--action', 'export', '--format', format, '--input', input];

    if (options.outputPath) {
      args.push('--output', options.outputPath);
    }

    const dbProfile = options.dbProfile || options.profile;
    if (dbProfile) {
      const jdbcUrl = buildJdbcUrl(dbProfile);
      args.push('--db-url', jdbcUrl);
      if (dbProfile.user) {
        args.push('--db-user', dbProfile.user);
      }
      if (options.password) {
        args.push('--db-pass', options.password);
      }
      if (dbProfile.driver === 'custom') {
        if (dbProfile.customDriverPath) {
          args.push('--custom-driver-jar', dbProfile.customDriverPath);
        }
        if (dbProfile.customDriverClass) {
          args.push('--custom-driver-class', dbProfile.customDriverClass);
        }
      }
    }

    if (options.params && Object.keys(options.params).length > 0) {
      args.push('--params', JSON.stringify(options.params));
    }

    return this.executeCli(args, options.password);
  }

  /**
   * Inspeciona parâmetros, campos e query de um relatório via `--action inspect-params`.
   */
  public async inspectParams(reportPath: string): Promise<CliSuccessResponse> {
    return this.executeCli(['--action', 'inspect-params', '--input', reportPath]);
  }

  /**
   * Inspeciona os metadados JDBC reais das colunas da query SQL do relatório via `--action inspect-query`.
   */
  public async inspectQuery(options: InspectQueryOptions): Promise<CliSuccessResponse> {
    if (!options.reportPath) {
      throw new RunnerCliError(
        'INVALID_ARGUMENT',
        'O caminho do relatório (reportPath) é obrigatório para inspectQuery.'
      );
    }

    const dbProfile = options.dbProfile;
    const jdbcUrl = buildJdbcUrl(dbProfile);
    const args: string[] = [
      '--action',
      'inspect-query',
      '--input',
      options.reportPath,
      '--db-url',
      jdbcUrl
    ];

    if (dbProfile.user) {
      args.push('--db-user', dbProfile.user);
    }
    if (options.password) {
      args.push('--db-pass', options.password);
    }
    if (dbProfile.driver === 'custom') {
      if (dbProfile.customDriverPath) {
        args.push('--custom-driver-jar', dbProfile.customDriverPath);
      }
      if (dbProfile.customDriverClass) {
        args.push('--custom-driver-class', dbProfile.customDriverClass);
      }
    }
    if (options.params && Object.keys(options.params).length > 0) {
      args.push('--params', JSON.stringify(options.params));
    }

    return this.executeCli(args, options.password);
  }

  /**
   * Executa o `jasper-cli.jar` via `child_process.execFile` e converte a saída JSON (`OutputPayload`).
   */
  private async executeCli(
    cliArgs: string[],
    password?: string
  ): Promise<CliSuccessResponse> {
    const jarPath = this.ensureJarExists(true);

    if (!this.resolvedJavaExecutable) {
      const javaEnv = await this.checkJavaEnvironment(true);
      if (!javaEnv.available) {
        throw new RunnerCliError(
          'JAVA_NOT_FOUND',
          javaEnv.message || 'JRE/JDK 11+ não encontrado no sistema.'
        );
      }
    }

    const javaExec = this.resolvedJavaExecutable || 'java';
    const fullArgs = ['-Dfile.encoding=UTF-8', '-jar', jarPath, ...cliArgs];

    return new Promise<CliSuccessResponse>((resolve, reject) => {
      execFile(
        javaExec,
        fullArgs,
        {
          timeout: this.timeoutMs,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            ...(password ? { JASPER_CLI_DB_PASS: password } : {})
          }
        },
        (error, stdout, stderr) => {
          const parsedPayload = this.tryParsePayload(stdout) ?? this.tryParsePayload(stderr);

          if (parsedPayload) {
            if (parsedPayload.status === 'SUCCESS') {
              resolve({
                status: 'SUCCESS',
                action: parsedPayload.action,
                outputFile: parsedPayload.outputFile,
                executionTimeMs: parsedPayload.executionTimeMs ?? 0,
                pages: parsedPayload.pages,
                columns: parsedPayload.columns ?? parsedPayload.metadata?.columns,
                metadata: parsedPayload.metadata
              });
              return;
            }

            if (parsedPayload.status === 'ERROR') {
              reject(
                new RunnerCliError(
                  parsedPayload.errorType || 'UNKNOWN_ERROR',
                  parsedPayload.message || 'Erro durante a execução do motor Jasper.',
                  parsedPayload.stackTraceSnippet
                )
              );
              return;
            }
          }

          if (error) {
            const anyErr = error as NodeJS.ErrnoException & { killed?: boolean };
            if (anyErr.killed || anyErr.code === 'ETIMEDOUT') {
              reject(
                new RunnerCliError(
                  'TIMEOUT_ERROR',
                  `A execução do relatório excedeu o tempo limite de ${Math.round(
                    this.timeoutMs / 1000
                  )} segundos.`,
                  stderr?.trim() || undefined
                )
              );
              return;
            }

            if (anyErr.code === 'ENOENT') {
              this.promptJavaDocumentation(
                'Comando "java" não encontrado no PATH. Instale o JRE/JDK 11 ou superior.'
              );
              reject(
                new RunnerCliError(
                  'JAVA_NOT_FOUND',
                  'Comando "java" não encontrado no sistema operacional. Instale o JRE/JDK 11+.'
                )
              );
              return;
            }

            const fallbackMsg = (stderr || stdout || error.message || '').trim();
            reject(
              new RunnerCliError(
                'PROCESS_ERROR',
                fallbackMsg || 'Falha ao executar o processo Java do JasperReports.',
                stderr?.trim() || undefined
              )
            );
            return;
          }

          reject(
            new RunnerCliError(
              'INVALID_OUTPUT',
              'O motor Java finalizou sem retornar um payload JSON válido.',
              (stdout || stderr || '').trim() || undefined
            )
          );
        }
      );
    });
  }

  private tryParsePayload(raw?: string): (CliSuccessResponse | CliErrorResponse) | undefined {
    if (!raw) {
      return undefined;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && (parsed.status === 'SUCCESS' || parsed.status === 'ERROR')) {
        return parsed;
      }
    } catch {
      // Caso alguma biblioteca tenha emitido linhas extras, tenta localizar o bloco JSON
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          const candidate = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
          if (candidate && (candidate.status === 'SUCCESS' || candidate.status === 'ERROR')) {
            return candidate;
          }
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }
}
