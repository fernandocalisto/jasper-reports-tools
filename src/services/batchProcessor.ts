import * as fs from 'fs';
import * as path from 'path';
import { DatabaseProfile } from '../models/database';

export type BatchFormat = 'pdf' | 'jasper' | 'jrprint';

export interface BatchCancellationLike {
  readonly isCancellationRequested: boolean;
}

export interface BatchItemResult {
  inputPath: string;
  outputPath?: string;
  success: boolean;
  error?: string;
  executionTimeMs: number;
}

export interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  cancelled?: number;
  results: BatchItemResult[];
  totalTimeMs: number;
  reportFilePath?: string;
}

export interface BatchOptions {
  inputPaths: string[];           // Caminhos .jrxml absolutos ou diretórios
  format?: BatchFormat;           // 'pdf' | 'jasper' | 'jrprint'
  outputDir?: string;             // Default: dirname de cada arquivo
  recursive?: boolean;            // Default: true
  maxConcurrent?: number;         // Default: 3
  dbProfile?: DatabaseProfile;    // Conexão ativa
  password?: string;
  params?: Record<string, any>;
  cancellationToken?: BatchCancellationLike;
  onItemStart?: (currentIndex: number, total: number, currentFile: string) => void;
  onProgress?: (
    completed: number,
    total: number,
    currentFile: string,
    itemResult: BatchItemResult
  ) => void;
  writeReportFile?: boolean;      // Opcional: gera batch-report-<timestamp>.json no output-dir
}

export interface BatchExecutorCallbacks {
  compileSingle: (inputPath: string, outputPath?: string) => Promise<{
    outputFile?: string;
    executionTimeMs: number;
  }>;
  exportSingle: (options: {
    inputPath: string;
    outputPath?: string;
    format: 'pdf' | 'jrprint';
    dbProfile?: DatabaseProfile;
    password?: string;
    params?: Record<string, any>;
  }) => Promise<{
    outputFile?: string;
    executionTimeMs: number;
  }>;
}

const DEFAULT_MAX_CONCURRENT = 3;
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);

/**
 * Executa processamento assíncrono em lote com limite máximo de concorrência (`maxConcurrent`)
 * e suporte a cancelamento cooperativo (interrompe o agendamento de novos itens e aguarda os atuais).
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  maxConcurrent: number = DEFAULT_MAX_CONCURRENT,
  isCancelled?: () => boolean
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(maxConcurrent || DEFAULT_MAX_CONCURRENT));
  const executing: Promise<void>[] = [];
  const results: R[] = [];

  for (let index = 0; index < items.length; index++) {
    if (isCancelled?.()) {
      break;
    }

    const item = items[index];
    const trackedPromise: Promise<void> = processor(item, index)
      .then((result) => {
        results.push(result);
      })
      .finally(() => {
        const idx = executing.indexOf(trackedPromise);
        if (idx >= 0) {
          executing.splice(idx, 1);
        }
      });

    executing.push(trackedPromise);

    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Coleta todos os arquivos `.jrxml` a partir de uma lista de caminhos (arquivos ou diretórios).
 */
export function collectJrxmlFiles(inputPaths: string[], recursive = true): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();
  const isWin = process.platform === 'win32';

  const addFile = (filePath: string): void => {
    const resolved = path.resolve(filePath);
    const key = isWin ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) {
      seen.add(key);
      collected.push(resolved);
    }
  };

  const scanDirectory = (dirPath: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !IGNORED_DIRECTORIES.has(entry.name)) {
          scanDirectory(fullPath);
        }
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.jrxml') {
        addFile(fullPath);
      }
    }
  };

  for (const rawPath of inputPaths) {
    if (!rawPath || !rawPath.trim()) {
      continue;
    }
    const resolved = path.resolve(rawPath);
    try {
      if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          scanDirectory(resolved);
          continue;
        }
        if (stat.isFile()) {
          if (path.extname(resolved).toLowerCase() === '.jrxml') {
            addFile(resolved);
          }
          continue;
        }
      }
    } catch {
      // Se falhar o stat mas tiver extensão .jrxml, mantém para reportar erro isolado no item
    }

    if (path.extname(resolved).toLowerCase() === '.jrxml') {
      addFile(resolved);
    }
  }

  return collected;
}

/**
 * Resolve o caminho de saída para um item do lote e garante que o diretório de destino exista.
 */
export function resolveBatchOutputPath(
  inputPath: string,
  format: BatchFormat,
  outputDir?: string
): string {
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const targetDir =
    outputDir && outputDir.trim().length > 0
      ? path.resolve(outputDir.trim())
      : path.dirname(path.resolve(inputPath));

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return path.join(targetDir, `${baseName}.${format}`);
}

/**
 * Salva opcionalmente um arquivo JSON com o relatório consolidado do processamento em lote.
 */
export function writeBatchReportJson(result: BatchResult, targetDir: string): string {
  const resolvedDir = path.resolve(targetDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }
  const reportFilePath = path.join(resolvedDir, `batch-report-${Date.now()}.json`);
  const payload = {
    generatedAt: new Date().toISOString(),
    total: result.total,
    succeeded: result.succeeded,
    failed: result.failed,
    cancelled: result.cancelled ?? 0,
    totalTimeMs: result.totalTimeMs,
    results: result.results
  };
  fs.writeFileSync(reportFilePath, JSON.stringify(payload, null, 2), 'utf8');
  return reportFilePath;
}

/**
 * Orquestrador de operações de compilação e exportação em lote (Batch Compile / Batch Export).
 */
export class BatchProcessor {
  constructor(private readonly callbacks: BatchExecutorCallbacks) {}

  public async batchCompile(options: BatchOptions): Promise<BatchResult> {
    return this.executeBatch({
      ...options,
      format: 'jasper'
    });
  }

  public async batchExport(options: BatchOptions): Promise<BatchResult> {
    return this.executeBatch({
      ...options,
      format: options.format || 'pdf'
    });
  }

  private async executeBatch(options: BatchOptions): Promise<BatchResult> {
    const startTime = Date.now();
    const format: BatchFormat = options.format || 'pdf';
    const recursive = options.recursive ?? true;
    const maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
    const files = collectJrxmlFiles(options.inputPaths || [], recursive);
    const total = files.length;

    if (total === 0) {
      return {
        total: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        results: [],
        totalTimeMs: 0
      };
    }

    let completedCount = 0;
    const isCancelled = (): boolean => Boolean(options.cancellationToken?.isCancellationRequested);

    const itemResults = await processWithConcurrency<string, BatchItemResult>(
      files,
      async (filePath, index) => {
        const itemStart = Date.now();
        options.onItemStart?.(index + 1, total, filePath);

        try {
          const targetOutputPath = resolveBatchOutputPath(filePath, format, options.outputDir);

          let response: { outputFile?: string; executionTimeMs: number };
          if (format === 'jasper') {
            response = await this.callbacks.compileSingle(filePath, targetOutputPath);
          } else {
            response = await this.callbacks.exportSingle({
              inputPath: filePath,
              outputPath: targetOutputPath,
              format,
              dbProfile: options.dbProfile,
              password: options.password,
              params: options.params
            });
          }

          const elapsed = Date.now() - itemStart;
          const itemResult: BatchItemResult = {
            inputPath: filePath,
            outputPath: response.outputFile || targetOutputPath,
            success: true,
            executionTimeMs: response.executionTimeMs > 0 ? response.executionTimeMs : elapsed
          };

          completedCount += 1;
          options.onProgress?.(completedCount, total, filePath, itemResult);
          return itemResult;
        } catch (error) {
          const elapsed = Date.now() - itemStart;
          const errorMessage =
            error instanceof Error ? error.message : 'Erro desconhecido ao processar relatório.';
          const itemResult: BatchItemResult = {
            inputPath: filePath,
            success: false,
            error: errorMessage,
            executionTimeMs: elapsed
          };

          completedCount += 1;
          options.onProgress?.(completedCount, total, filePath, itemResult);
          return itemResult;
        }
      },
      maxConcurrent,
      isCancelled
    );

    const totalTimeMs = Date.now() - startTime;
    const succeeded = itemResults.filter((r) => r.success).length;
    const failed = itemResults.filter((r) => !r.success).length;
    const cancelled = Math.max(0, total - itemResults.length);

    const batchResult: BatchResult = {
      total,
      succeeded,
      failed,
      ...(cancelled > 0 ? { cancelled } : {}),
      results: itemResults,
      totalTimeMs
    };

    if (options.writeReportFile) {
      const reportDir =
        options.outputDir && options.outputDir.trim().length > 0
          ? options.outputDir
          : path.dirname(files[0]);
      try {
        batchResult.reportFilePath = writeBatchReportJson(batchResult, reportDir);
      } catch {
        // Ignora falha ao gravar relatório opcional em disco
      }
    }

    return batchResult;
  }
}
