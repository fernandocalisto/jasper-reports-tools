import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionManager } from '../services/connectionManager';
import {
  BatchFormat,
  BatchOptions,
  BatchResult,
  RunnerCliError,
  RunnerService
} from '../services/runnerService';
import { collectJrxmlFiles } from '../services/batchProcessor';
import { jrxmlParser } from '../services/jrxmlParser';
import {
  ParameterValidator,
  parameterValidator as defaultParameterValidator
} from '../services/parameterValidator';
import { PreviewPanel } from '../webviewPanels/previewPanel';
import { FieldViewerPanel } from '../webviewPanels/fieldViewerPanel';

export interface BatchCommandInvocationOptions {
  inputPaths?: string[];
  dir?: string;
  format?: BatchFormat;
  outputDir?: string;
  recursive?: boolean;
  maxConcurrent?: number;
  params?: Record<string, any>;
  writeReportFile?: boolean;
}

export function resolveTargetJrxmlPath(uriArg?: vscode.Uri): {
  filePath?: string;
  document?: vscode.TextDocument;
} {
  if (uriArg && uriArg.fsPath) {
    const openDoc = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.fsPath.toLowerCase() === uriArg.fsPath.toLowerCase()
    );
    return {
      filePath: uriArg.fsPath,
      document: openDoc
    };
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && activeEditor.document) {
    return {
      filePath: activeEditor.document.uri.fsPath,
      document: activeEditor.document
    };
  }

  return {};
}

export function resolveTargetJasperPath(uriArg?: vscode.Uri): string | undefined {
  if (uriArg && uriArg.fsPath) {
    return uriArg.fsPath;
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (
    activeEditor &&
    activeEditor.document &&
    path.extname(activeEditor.document.uri.fsPath).toLowerCase() === '.jasper'
  ) {
    return activeEditor.document.uri.fsPath;
  }

  const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
  const tabInput = activeTab?.input as { uri?: vscode.Uri } | undefined;
  if (tabInput?.uri?.fsPath) {
    return tabInput.uri.fsPath;
  }

  if (activeEditor && activeEditor.document) {
    return activeEditor.document.uri.fsPath;
  }

  return undefined;
}

export function registerReportCommands(
  context: vscode.ExtensionContext,
  connectionManager: ConnectionManager,
  runnerService: RunnerService,
  outputChannel: vscode.OutputChannel,
  parameterValidator: ParameterValidator = defaultParameterValidator
): vscode.Disposable[] {
  const compileCurrentReportCmd = vscode.commands.registerCommand(
    'jasper.compileCurrentReport',
    async (uriArg?: vscode.Uri) => {
      const { filePath, document } = resolveTargetJrxmlPath(uriArg);

      if (!filePath) {
        void vscode.window.showWarningMessage(
          'Nenhum arquivo aberto no editor. Abra um relatório .jrxml para compilar.'
        );
        return;
      }

      if (path.extname(filePath).toLowerCase() !== '.jrxml') {
        void vscode.window.showWarningMessage(
          `O arquivo "${path.basename(filePath)}" não possui extensão .jrxml.`
        );
        return;
      }

      if (document && document.isDirty) {
        await document.save();
      }

      const fileName = path.basename(filePath);
      const timestamp = new Date().toLocaleTimeString('pt-BR');
      outputChannel.appendLine(`[${timestamp}] Iniciando compilação de: ${filePath}`);

      try {
        const metadata = document
          ? jrxmlParser.getMetadata(document)
          : jrxmlParser.parseFile(filePath);
        outputChannel.appendLine(
          `[${timestamp}] Metadados JRXML detectados: ${metadata.parameters.length} parâmetro(s) de usuário, ${metadata.fields.length} campo(s).`
        );
      } catch {
        // Segue para compilação pelo motor Java mesmo se o XML tiver erro sintático
      }

      try {
        const response = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Jasper: Compilando "${fileName}"...`,
            cancellable: false
          },
          async () => runnerService.compileReport(filePath)
        );

        const outFile =
          response.outputFile ||
          path.join(path.dirname(filePath), `${path.basename(filePath, '.jrxml')}.jasper`);

        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] Compilação concluída com sucesso em ${response.executionTimeMs}ms -> ${outFile}`
        );

        void vscode.window.showInformationMessage(
          `Relatório compilado com sucesso! (${response.executionTimeMs}ms) → ${path.basename(outFile)}`
        );
      } catch (error) {
        const errMessage =
          error instanceof Error ? error.message : 'Falha ao compilar o relatório .jrxml.';
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] ERRO na compilação de "${fileName}": ${errMessage}`
        );
        if (error instanceof RunnerCliError && error.stackTraceSnippet) {
          outputChannel.appendLine(error.stackTraceSnippet);
        }

        const action = await vscode.window.showErrorMessage(
          `Falha ao compilar "${fileName}": ${errMessage}`,
          'Ver Log'
        );
        if (action === 'Ver Log') {
          outputChannel.show(true);
        }
      }
    }
  );

  const openPreviewCmd = vscode.commands.registerCommand(
    'jasper.openPreview',
    async (uriArg?: vscode.Uri) => {
      const { filePath, document } = resolveTargetJrxmlPath(uriArg);

      if (!filePath) {
        void vscode.window.showWarningMessage(
          'Nenhum arquivo aberto no editor. Abra um relatório .jrxml para visualizar o preview.'
        );
        return;
      }

      if (path.extname(filePath).toLowerCase() !== '.jrxml') {
        void vscode.window.showWarningMessage(
          `O arquivo "${path.basename(filePath)}" não possui extensão .jrxml.`
        );
        return;
      }

      if (document && document.isDirty) {
        await document.save();
      }

      PreviewPanel.createOrShow(
        context,
        connectionManager,
        runnerService,
        outputChannel,
        filePath,
        parameterValidator
      );
    }
  );

  const openFieldViewerCmd = vscode.commands.registerCommand(
    'jasper.openFieldViewer',
    async (uriArg?: vscode.Uri) => {
      const { filePath, document } = resolveTargetJrxmlPath(uriArg);

      if (!filePath) {
        void vscode.window.showWarningMessage(
          'Nenhum arquivo aberto no editor. Abra um relatório .jrxml para visualizar os campos.'
        );
        return;
      }

      if (path.extname(filePath).toLowerCase() !== '.jrxml') {
        void vscode.window.showWarningMessage(
          `O arquivo "${path.basename(filePath)}" não possui extensão .jrxml.`
        );
        return;
      }

      if (document && document.isDirty) {
        await document.save();
      }

      FieldViewerPanel.createOrShow(
        context,
        connectionManager,
        runnerService,
        outputChannel,
        filePath,
        parameterValidator
      );
    }
  );

  const decompileJasperCmd = vscode.commands.registerCommand(
    'jasper.decompileJasper',
    async (uriArg?: vscode.Uri) => {
      const filePath = resolveTargetJasperPath(uriArg);

      if (!filePath) {
        void vscode.window.showWarningMessage(
          'Nenhum arquivo .jasper selecionado. Selecione ou abra um relatório .jasper para descompilar.'
        );
        return;
      }

      if (path.extname(filePath).toLowerCase() !== '.jasper') {
        void vscode.window.showWarningMessage(
          `O arquivo "${path.basename(filePath)}" não possui extensão .jasper.`
        );
        return;
      }

      const defaultJrxmlPath = filePath.replace(/\.jasper$/i, '.jrxml');
      const output = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultJrxmlPath),
        filters: { JRXML: ['jrxml'] }
      });

      if (!output) {
        return;
      }

      const fileName = path.basename(filePath);
      const timestamp = new Date().toLocaleTimeString('pt-BR');
      outputChannel.appendLine(
        `[${timestamp}] Iniciando descompilação de: ${filePath} -> ${output.fsPath}`
      );

      try {
        const response = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Jasper: Descompilando "${fileName}"...`,
            cancellable: false
          },
          async () => runnerService.decompileReport(filePath, output.fsPath)
        );

        const outFile = response.outputFile || output.fsPath;
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] Descompilação concluída com sucesso em ${response.executionTimeMs}ms -> ${outFile}`
        );

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(outFile));
        await vscode.window.showTextDocument(doc);

        void vscode.window.showInformationMessage(
          `Relatório descompilado com sucesso! (${response.executionTimeMs}ms) → ${path.basename(outFile)}`
        );
      } catch (error) {
        const errMessage =
          error instanceof Error ? error.message : 'Falha ao descompilar o relatório .jasper.';
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] ERRO na descompilação de "${fileName}": ${errMessage}`
        );
        if (error instanceof RunnerCliError && error.stackTraceSnippet) {
          outputChannel.appendLine(error.stackTraceSnippet);
        }

        const action = await vscode.window.showErrorMessage(
          `Falha ao descompilar "${fileName}": ${errMessage}`,
          'Ver Log'
        );
        if (action === 'Ver Log') {
          outputChannel.show(true);
        }
      }
    }
  );

  const batchCompileCmd = vscode.commands.registerCommand(
    'jasper.batchCompile',
    async (
      uriOrOptions?: vscode.Uri | BatchCommandInvocationOptions,
      selectedUris?: vscode.Uri[],
      extraOptions?: BatchCommandInvocationOptions
    ): Promise<BatchResult | undefined> => {
      return executeBatchCommand({
        mode: 'compile',
        uriOrOptions,
        selectedUris,
        extraOptions,
        connectionManager,
        runnerService,
        outputChannel
      });
    }
  );

  const batchExportCmd = vscode.commands.registerCommand(
    'jasper.batchExport',
    async (
      uriOrOptions?: vscode.Uri | BatchCommandInvocationOptions,
      selectedUris?: vscode.Uri[],
      extraOptions?: BatchCommandInvocationOptions
    ): Promise<BatchResult | undefined> => {
      return executeBatchCommand({
        mode: 'export',
        uriOrOptions,
        selectedUris,
        extraOptions,
        connectionManager,
        runnerService,
        outputChannel
      });
    }
  );

  return [
    compileCurrentReportCmd,
    decompileJasperCmd,
    openPreviewCmd,
    openFieldViewerCmd,
    batchCompileCmd,
    batchExportCmd
  ];
}

function isVscodeUri(value: unknown): value is vscode.Uri {
  return Boolean(value && typeof value === 'object' && 'fsPath' in (value as Record<string, unknown>));
}

async function promptInputSourcePaths(): Promise<{
  inputPaths: string[];
  recursive: boolean;
} | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  const activeEditor = vscode.window.activeTextEditor;
  const activeJrxmlPath =
    activeEditor &&
    activeEditor.document &&
    path.extname(activeEditor.document.uri.fsPath).toLowerCase() === '.jrxml'
      ? activeEditor.document.uri.fsPath
      : undefined;

  interface SourcePickItem extends vscode.QuickPickItem {
    id: 'workspace' | 'folder' | 'files' | 'active';
  }

  const items: SourcePickItem[] = [];
  if (workspaceFolders.length > 0) {
    items.push({
      id: 'workspace',
      label: '$(folder-library) Pasta do Workspace (Recursivo)',
      description: workspaceFolders.map((f) => f.name).join(', '),
      detail: 'Processa todos os arquivos .jrxml do workspace recursivamente'
    });
  }
  items.push(
    {
      id: 'folder',
      label: '$(folder-opened) Selecionar Pasta...',
      description: 'Escolher um diretório no computador',
      detail: 'Processa todos os arquivos .jrxml da pasta selecionada'
    },
    {
      id: 'files',
      label: '$(files) Selecionar Arquivos .jrxml...',
      description: 'Multi-seleção de arquivos',
      detail: 'Escolher múltiplos relatórios .jrxml específicos'
    }
  );
  if (activeJrxmlPath) {
    items.push({
      id: 'active',
      label: `$(file-code) Arquivo Ativo no Editor (${path.basename(activeJrxmlPath)})`,
      description: activeJrxmlPath,
      detail: 'Fallback: processa apenas o relatório .jrxml aberto atualmente'
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Jasper: Origem dos Relatórios (.jrxml)',
    placeHolder: 'Escolha a pasta ou arquivos .jrxml para processar em lote'
  });

  if (!picked) {
    return undefined;
  }

  if (picked.id === 'active' && activeJrxmlPath) {
    return { inputPaths: [activeJrxmlPath], recursive: false };
  }

  if (picked.id === 'workspace') {
    if (workspaceFolders.length === 1) {
      return { inputPaths: [workspaceFolders[0].uri.fsPath], recursive: true };
    }
    const chosenFolder = await vscode.window.showWorkspaceFolderPick({
      placeHolder: 'Selecione a pasta do workspace para processar em lote'
    });
    if (!chosenFolder) {
      return undefined;
    }
    return { inputPaths: [chosenFolder.uri.fsPath], recursive: true };
  }

  if (picked.id === 'folder') {
    const folderUris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Selecionar Pasta com .jrxml'
    });
    if (!folderUris || folderUris.length === 0) {
      return undefined;
    }

    const recursivePick = await vscode.window.showQuickPick(
      [
        {
          label: '$(check) Sim — Incluir subpastas recursivamente (Padrão)',
          value: true
        },
        {
          label: '$(dash) Não — Apenas arquivos na raiz da pasta selecionada',
          value: false
        }
      ],
      {
        title: 'Jasper: Processamento Recursivo (--recursive)',
        placeHolder: 'Deseja processar subpastas recursivamente?'
      }
    );
    if (!recursivePick) {
      return undefined;
    }

    return {
      inputPaths: [folderUris[0].fsPath],
      recursive: recursivePick.value
    };
  }

  const fileUris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    openLabel: 'Selecionar Relatórios .jrxml',
    filters: { 'JasperReports JRXML': ['jrxml'] }
  });
  if (!fileUris || fileUris.length === 0) {
    return undefined;
  }

  return {
    inputPaths: fileUris.map((u) => u.fsPath),
    recursive: false
  };
}

async function promptBatchExportOptions(
  askFormat: boolean
): Promise<{
  format: BatchFormat;
  outputDir?: string;
  maxConcurrent: number;
  writeReportFile: boolean;
} | undefined> {
  let format: BatchFormat = 'jasper';

  if (askFormat) {
    const formatPick = await vscode.window.showQuickPick(
      [
        {
          label: '$(file-pdf) PDF (.pdf)',
          description: 'Padrão (--format pdf)',
          detail: 'Compila, preenche com a conexão ativa e exporta para PDF',
          format: 'pdf' as BatchFormat
        },
        {
          label: '$(package) Jasper Compilado (.jasper)',
          description: '--format jasper',
          detail: 'Compila os relatórios .jrxml gerando binários .jasper',
          format: 'jasper' as BatchFormat
        },
        {
          label: '$(file-binary) JasperPrint (.jrprint)',
          description: '--format jrprint',
          detail: 'Compila e preenche gerando arquivos serializados .jrprint',
          format: 'jrprint' as BatchFormat
        }
      ],
      {
        title: 'Jasper Batch Export: Formato de Saída (--format)',
        placeHolder: 'Selecione o formato de exportação em lote'
      }
    );

    if (!formatPick) {
      return undefined;
    }
    format = formatPick.format;
  }

  const outputDirPick = await vscode.window.showQuickPick(
    [
      {
        id: 'same' as const,
        label: '$(folder) Mesma pasta de cada arquivo fonte (Padrão)',
        description: 'Salva o arquivo gerado ao lado do .jrxml original',
        writeReportFile: false
      },
      {
        id: 'custom' as const,
        label: '$(folder-opened) Escolher diretório de saída (--output-dir)...',
        description: 'Consolidar todos os arquivos gerados em uma pasta específica',
        writeReportFile: false
      },
      {
        id: 'custom_with_report' as const,
        label: '$(json) Escolher diretório de saída + Salvar batch-report-<timestamp>.json...',
        description: 'Salva arquivos gerados e relatório JSON detalhado na pasta escolhida',
        writeReportFile: true
      }
    ],
    {
      title: 'Jasper Batch: Diretório de Saída (--output-dir)',
      placeHolder: 'Onde deseja salvar os arquivos gerados?'
    }
  );

  if (!outputDirPick) {
    return undefined;
  }

  let outputDir: string | undefined;
  if (outputDirPick.id === 'custom' || outputDirPick.id === 'custom_with_report') {
    const chosenDir = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Selecionar Diretório de Saída'
    });
    if (!chosenDir || chosenDir.length === 0) {
      return undefined;
    }
    outputDir = chosenDir[0].fsPath;
  }

  const concurrencyPick = await vscode.window.showQuickPick(
    [
      {
        label: '$(pulse) 3 processos simultâneos (Padrão)',
        description: '--max-concurrent 3',
        value: 3
      },
      {
        label: '$(debug-step-over) 1 processo por vez (Sequencial)',
        description: '--max-concurrent 1',
        value: 1
      },
      {
        label: '$(pulse) 2 processos simultâneos',
        description: '--max-concurrent 2',
        value: 2
      },
      {
        label: '$(rocket) 5 processos simultâneos',
        description: '--max-concurrent 5',
        value: 5
      },
      {
        label: '$(settings-gear) Definir paralelismo personalizado...',
        description: 'Informar número de processos simultâneos',
        value: -1
      }
    ],
    {
      title: 'Jasper Batch: Paralelismo (--max-concurrent)',
      placeHolder: 'Selecione o máximo de processos Java simultâneos'
    }
  );

  if (!concurrencyPick) {
    return undefined;
  }

  let maxConcurrent = concurrencyPick.value;
  if (maxConcurrent === -1) {
    const customInput = await vscode.window.showInputBox({
      title: 'Jasper Batch: Paralelismo Máximo (--max-concurrent)',
      prompt: 'Informe o número máximo de processos simultâneos (1 a 16)',
      value: '3',
      validateInput: (val) => {
        const num = Number(val);
        if (!Number.isInteger(num) || num < 1 || num > 16) {
          return 'Informe um número inteiro entre 1 e 16.';
        }
        return undefined;
      }
    });
    if (!customInput) {
      return undefined;
    }
    maxConcurrent = parseInt(customInput, 10);
  }

  return {
    format,
    outputDir,
    maxConcurrent,
    writeReportFile: outputDirPick.writeReportFile
  };
}

async function executeBatchCommand(params: {
  mode: 'compile' | 'export';
  uriOrOptions?: vscode.Uri | BatchCommandInvocationOptions;
  selectedUris?: vscode.Uri[];
  extraOptions?: BatchCommandInvocationOptions;
  connectionManager: ConnectionManager;
  runnerService: RunnerService;
  outputChannel: vscode.OutputChannel;
}): Promise<BatchResult | undefined> {
  const { mode, uriOrOptions, selectedUris, extraOptions, connectionManager, runnerService, outputChannel } =
    params;

  const isProgrammaticOptions = Boolean(
    uriOrOptions && !isVscodeUri(uriOrOptions) && typeof uriOrOptions === 'object'
  );
  const directOptions: BatchCommandInvocationOptions | undefined = isProgrammaticOptions
    ? (uriOrOptions as BatchCommandInvocationOptions)
    : extraOptions;

  let inputPaths: string[] = [];
  let recursive = directOptions?.recursive ?? true;

  if (directOptions?.inputPaths && directOptions.inputPaths.length > 0) {
    inputPaths = directOptions.inputPaths;
  } else if (directOptions?.dir) {
    inputPaths = [directOptions.dir];
  } else if (selectedUris && Array.isArray(selectedUris) && selectedUris.length > 0) {
    inputPaths = selectedUris.filter(isVscodeUri).map((u) => u.fsPath);
  } else if (isVscodeUri(uriOrOptions) && uriOrOptions.fsPath) {
    inputPaths = [uriOrOptions.fsPath];
  } else {
    const pickedSource = await promptInputSourcePaths();
    if (!pickedSource) {
      return undefined;
    }
    inputPaths = pickedSource.inputPaths;
    recursive = pickedSource.recursive;
  }

  let format: BatchFormat = mode === 'compile' ? 'jasper' : directOptions?.format || 'pdf';
  let outputDir: string | undefined = directOptions?.outputDir;
  let maxConcurrent: number = directOptions?.maxConcurrent ?? 3;
  let writeReportFile: boolean = directOptions?.writeReportFile ?? false;

  // Quando batchExport é invocado interativamente (sem opções diretas de formato), solicita opções ao usuário
  if (mode === 'export' && !directOptions?.format && !isProgrammaticOptions) {
    const chosenExportOpts = await promptBatchExportOptions(true);
    if (!chosenExportOpts) {
      return undefined;
    }
    format = chosenExportOpts.format;
    outputDir = chosenExportOpts.outputDir;
    maxConcurrent = chosenExportOpts.maxConcurrent;
    writeReportFile = chosenExportOpts.writeReportFile;
  }

  const files = collectJrxmlFiles(inputPaths, recursive);
  if (files.length === 0) {
    void vscode.window.showWarningMessage(
      'Nenhum arquivo .jrxml encontrado na seleção ou diretório informado.'
    );
    return undefined;
  }

  // Salva documentos .jrxml abertos e modificados antes de compilar/exportar
  const fileSetLower = new Set(files.map((f) => f.toLowerCase()));
  for (const openDoc of vscode.workspace.textDocuments) {
    if (openDoc.isDirty && fileSetLower.has(openDoc.uri.fsPath.toLowerCase())) {
      await openDoc.save();
    }
  }

  const activeProfile =
    format !== 'jasper' ? await connectionManager.getActiveProfile() : undefined;
  const password = activeProfile
    ? await connectionManager.getPassword(activeProfile.id)
    : undefined;

  const operationLabel = mode === 'compile' ? 'Batch Compile' : 'Batch Export';
  const startTimestamp = new Date().toLocaleTimeString('pt-BR');

  outputChannel.appendLine(
    '================================================================================'
  );
  outputChannel.appendLine(
    `[${startTimestamp}] Iniciando ${operationLabel} | Arquivos: ${files.length} | Formato: ${format} | Paralelismo: ${maxConcurrent} | Recursivo: ${recursive ? 'sim' : 'não'}${
      outputDir ? ` | Output Dir: ${outputDir}` : ''
    }${activeProfile ? ` | Conexão: ${activeProfile.name}` : ''}`
  );

  let wasCancelled = false;

  const result = await vscode.window.withProgress<BatchResult>(
    {
      location: vscode.ProgressLocation.Notification,
      title:
        mode === 'compile'
          ? 'Jasper: Compilando em Lote'
          : `Jasper: Exportando em Lote (${format.toUpperCase()})`,
      cancellable: true
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        wasCancelled = true;
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] Cancelamento solicitado pelo usuário. Aguardando conclusão dos processos em andamento...`
        );
      });

      progress.report({
        message: `(0/${files.length}) Preparando lote...`,
        increment: 0
      });

      const incrementStep = 100 / files.length;

      const batchOptions: BatchOptions = {
        inputPaths: files,
        format,
        outputDir,
        recursive,
        maxConcurrent,
        dbProfile: activeProfile,
        password,
        params: directOptions?.params,
        writeReportFile,
        cancellationToken: token,
        onItemStart: (currentIndex, total, currentFile) => {
          progress.report({
            message: `(${currentIndex}/${total}) ${path.basename(currentFile)}`
          });
        },
        onProgress: (completed, total, currentFile, itemResult) => {
          const fileName = path.basename(currentFile);
          progress.report({
            message: `(${completed}/${total}) ${fileName}`,
            increment: incrementStep
          });

          const ts = new Date().toLocaleTimeString('pt-BR');
          if (itemResult.success) {
            outputChannel.appendLine(
              `[${ts}] [SUCESSO] (${completed}/${total}) ${fileName} -> ${
                itemResult.outputPath ? path.basename(itemResult.outputPath) : ''
              } (${itemResult.executionTimeMs}ms)`
            );
          } else {
            outputChannel.appendLine(
              `[${ts}] [FALHA] (${completed}/${total}) ${fileName} (${itemResult.executionTimeMs}ms) -> ${itemResult.error}`
            );
          }
        }
      };

      return mode === 'compile'
        ? runnerService.batchCompile(batchOptions)
        : runnerService.batchExport(batchOptions);
    }
  );

  const endTimestamp = new Date().toLocaleTimeString('pt-BR');
  const durationSec = (result.totalTimeMs / 1000).toFixed(1);

  outputChannel.appendLine(
    `[${endTimestamp}] ${operationLabel} ${
      wasCancelled ? 'cancelado' : 'concluído'
    } -> Sucessos: ${result.succeeded}, Falhas: ${result.failed}${
      result.cancelled ? `, Cancelados: ${result.cancelled}` : ''
    }, Tempo: ${result.totalTimeMs}ms (${durationSec}s)`
  );
  if (result.reportFilePath) {
    outputChannel.appendLine(
      `[${endTimestamp}] Relatório JSON salvo em: ${result.reportFilePath}`
    );
  }
  outputChannel.appendLine(
    '================================================================================'
  );

  const toastMessage = `${operationLabel} ${
    wasCancelled ? 'cancelado' : 'concluído'
  }: ${result.succeeded} ${result.succeeded === 1 ? 'sucesso' : 'sucessos'}, ${
    result.failed
  } ${result.failed === 1 ? 'falha' : 'falhas'} em ${durationSec}s (Sucessos: ${
    result.succeeded
  }, Falhas: ${result.failed}, Tempo: ${result.totalTimeMs}ms)`;

  if (result.failed > 0 || wasCancelled) {
    void vscode.window.showWarningMessage(toastMessage, 'Ver Log').then((action) => {
      if (action === 'Ver Log') {
        outputChannel.show(true);
      }
    });
  } else {
    void vscode.window.showInformationMessage(toastMessage, 'Ver Log').then((action) => {
      if (action === 'Ver Log') {
        outputChannel.show(true);
      }
    });
  }

  return result;
}
