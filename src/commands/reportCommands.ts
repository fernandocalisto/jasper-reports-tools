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
import { ServerManager } from '../services/serverManager';
import { JasperServerClient } from '../services/jasperServerClient';
import { ServerTreeItem, ServerTreeProvider } from '../providers/serverTreeProvider';
import { DiffOptions } from '../services/reportDiffEngine';
import { PreviewPanel } from '../webviewPanels/previewPanel';
import { FieldViewerPanel } from '../webviewPanels/fieldViewerPanel';
import { DiffSessionInput, DiffViewerPanel } from '../webviewPanels/diffViewerPanel';
import { ExpressionEditorPanel } from '../webviewPanels/expressionEditorPanel';

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
  parameterValidator: ParameterValidator = defaultParameterValidator,
  serverManager?: ServerManager,
  serverClient?: JasperServerClient,
  serverTreeProvider?: ServerTreeProvider
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

  const compareReportsCmd = vscode.commands.registerCommand(
    'jasper.compareReports',
    async (
      firstArg?: vscode.Uri | string,
      secondArg?: vscode.Uri[] | vscode.Uri | string,
      options?: DiffOptions
    ) => {
      await executeCompareReportsCommand(
        context,
        runnerService,
        outputChannel,
        firstArg,
        secondArg,
        options
      );
    }
  );

  const compareWithServerCmd = vscode.commands.registerCommand(
    'jasper.compareWithServer',
    async (
      arg?: ServerTreeItem | vscode.Uri | string,
      secondArg?: ServerTreeItem | vscode.Uri | string,
      options?: DiffOptions
    ) => {
      await executeCompareWithServerCommand(
        context,
        runnerService,
        outputChannel,
        serverManager,
        serverClient,
        serverTreeProvider,
        arg,
        secondArg,
        options
      );
    }
  );

  const openDiffViewerCmd = vscode.commands.registerCommand(
    'jasper.openDiffViewer',
    async (
      sessionOrLeft?: DiffSessionInput | vscode.Uri | string,
      rightArg?: vscode.Uri | string,
      options?: DiffOptions
    ) => {
      if (
        sessionOrLeft &&
        typeof sessionOrLeft === 'object' &&
        'left' in sessionOrLeft &&
        'right' in sessionOrLeft
      ) {
        return DiffViewerPanel.createOrShow(
          context,
          runnerService,
          outputChannel,
          sessionOrLeft as DiffSessionInput
        );
      }

      await executeCompareReportsCommand(
        context,
        runnerService,
        outputChannel,
        sessionOrLeft as vscode.Uri | string | undefined,
        rightArg,
        options
      );
      return DiffViewerPanel.currentPanel;
    }
  );

  const openExpressionEditorCmd = vscode.commands.registerCommand(
    'jasper.openExpressionEditor',
    async (
      uriOrString?: vscode.Uri | string,
      expressionId?: string,
      lineZeroBased?: number
    ) => {
      let documentUri: vscode.Uri | undefined;
      if (isVscodeUri(uriOrString)) {
        documentUri = uriOrString;
      } else if (typeof uriOrString === 'string' && uriOrString.trim().length > 0) {
        documentUri = uriOrString.startsWith('file:')
          ? vscode.Uri.parse(uriOrString)
          : vscode.Uri.file(uriOrString);
      }

      return ExpressionEditorPanel.createOrShow(context, jrxmlParser, outputChannel, {
        documentUri,
        expressionId: typeof expressionId === 'string' ? expressionId : undefined,
        lineZeroBased: typeof lineZeroBased === 'number' ? lineZeroBased : undefined
      });
    }
  );

  return [
    compileCurrentReportCmd,
    decompileJasperCmd,
    openPreviewCmd,
    openFieldViewerCmd,
    batchCompileCmd,
    batchExportCmd,
    compareReportsCmd,
    compareWithServerCmd,
    openDiffViewerCmd,
    openExpressionEditorCmd
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

function isReportFileExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.jrxml' || ext === '.jasper';
}

function getActiveReportFilePath(): string | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  if (
    activeEditor &&
    activeEditor.document &&
    isReportFileExtension(activeEditor.document.uri.fsPath)
  ) {
    return activeEditor.document.uri.fsPath;
  }

  const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
  const tabInput = activeTab?.input as { uri?: vscode.Uri } | undefined;
  if (tabInput?.uri?.fsPath && isReportFileExtension(tabInput.uri.fsPath)) {
    return tabInput.uri.fsPath;
  }

  return undefined;
}

async function promptForLocalReportFile(
  title: string,
  excludePath?: string
): Promise<string | undefined> {
  const foundFiles = await vscode.workspace.findFiles('**/*.{jrxml,jasper}');
  const excludeLower = excludePath ? path.resolve(excludePath).toLowerCase() : undefined;

  interface ReportQuickPickItem extends vscode.QuickPickItem {
    filePath?: string;
    browseDisk?: boolean;
  }

  const items: ReportQuickPickItem[] = foundFiles
    .map((uri) => uri.fsPath)
    .filter((fsPath) => !excludeLower || path.resolve(fsPath).toLowerCase() !== excludeLower)
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'pt-BR'))
    .map((fsPath) => ({
      label: `$(file-code) ${path.basename(fsPath)}`,
      description: vscode.workspace.asRelativePath(fsPath),
      filePath: fsPath
    }));

  items.push({
    label: '$(folder-opened) Selecionar outro arquivo (.jrxml / .jasper) no computador...',
    description: 'Abrir seletor de arquivos do sistema',
    alwaysShow: true,
    browseDisk: true
  });

  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: 'Selecione um relatório .jrxml ou .jasper',
    matchOnDescription: true
  });

  if (!picked) {
    return undefined;
  }

  if (picked.browseDisk) {
    const dialogUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Selecionar Relatório',
      filters: {
        'Relatórios JasperReports (.jrxml, .jasper)': ['jrxml', 'jasper']
      }
    });
    return dialogUris?.[0]?.fsPath;
  }

  return picked.filePath;
}

async function executeCompareReportsCommand(
  context: vscode.ExtensionContext,
  runnerService: RunnerService,
  outputChannel: vscode.OutputChannel,
  firstArg?: vscode.Uri | string,
  secondArg?: vscode.Uri[] | vscode.Uri | string,
  options?: DiffOptions
): Promise<void> {
  let fileA: string | undefined;
  let fileB: string | undefined;

  // Caso 1: Multi-select no Explorer (secondArg é vscode.Uri[] com >= 2 itens)
  if (Array.isArray(secondArg) && secondArg.length >= 2) {
    const validUris = secondArg.filter(
      (u) => isVscodeUri(u) && isReportFileExtension(u.fsPath)
    );
    if (validUris.length >= 2) {
      fileA = validUris[0].fsPath;
      fileB = validUris[1].fsPath;
    }
  }

  // Caso 2: Chamada programática com dois caminhos/URIs explícitos
  if (!fileA || !fileB) {
    if (typeof firstArg === 'string' && typeof secondArg === 'string') {
      fileA = firstArg;
      fileB = secondArg;
    } else if (isVscodeUri(firstArg) && isVscodeUri(secondArg)) {
      fileA = firstArg.fsPath;
      fileB = secondArg.fsPath;
    }
  }

  // Caso 3: Um arquivo passado no Explorer + Arquivo ativo diferente no Editor
  if (!fileA || !fileB) {
    const clickedPath =
      typeof firstArg === 'string'
        ? firstArg
        : isVscodeUri(firstArg)
        ? firstArg.fsPath
        : undefined;
    const activePath = getActiveReportFilePath();

    if (
      clickedPath &&
      activePath &&
      path.resolve(clickedPath).toLowerCase() !== path.resolve(activePath).toLowerCase()
    ) {
      fileA = activePath;
      fileB = clickedPath;
    } else {
      fileA = clickedPath || activePath;
    }
  }

  if (!fileA) {
    fileA = await promptForLocalReportFile('Jasper Diff: Selecione o Relatório A (Origem)');
    if (!fileA) {
      return;
    }
  }

  if (!fileB) {
    fileB = await promptForLocalReportFile(
      `Jasper Diff: Comparar "${path.basename(fileA)}" com...`,
      fileA
    );
    if (!fileB) {
      return;
    }
  }

  // Salva documentos caso estejam abertos e modificados
  for (const openDoc of vscode.workspace.textDocuments) {
    const docPath = path.resolve(openDoc.uri.fsPath).toLowerCase();
    if (
      openDoc.isDirty &&
      (docPath === path.resolve(fileA).toLowerCase() ||
        docPath === path.resolve(fileB).toLowerCase())
    ) {
      await openDoc.save();
    }
  }

  DiffViewerPanel.createOrShow(context, runnerService, outputChannel, {
    left: {
      filePath: fileA,
      label: path.basename(fileA),
      subtitle: fileA,
      origin: 'local'
    },
    right: {
      filePath: fileB,
      label: path.basename(fileB),
      subtitle: fileB,
      origin: 'local'
    },
    options
  });
}

async function executeCompareWithServerCommand(
  context: vscode.ExtensionContext,
  runnerService: RunnerService,
  outputChannel: vscode.OutputChannel,
  serverManager?: ServerManager,
  serverClient?: JasperServerClient,
  serverTreeProvider?: ServerTreeProvider,
  arg?: ServerTreeItem | vscode.Uri | string,
  secondArg?: ServerTreeItem | vscode.Uri | string,
  options?: DiffOptions
): Promise<void> {
  if (!serverManager || !serverClient) {
    void vscode.window.showErrorMessage(
      'Serviço JasperServer não está disponível para comparação.'
    );
    return;
  }

  let serverItem: ServerTreeItem | undefined;
  let localFilePath: string | undefined;

  if (arg instanceof ServerTreeItem) {
    serverItem = arg;
  } else if (secondArg instanceof ServerTreeItem) {
    serverItem = secondArg;
  }

  if (typeof arg === 'string') {
    localFilePath = arg;
  } else if (isVscodeUri(arg)) {
    localFilePath = arg.fsPath;
  } else if (typeof secondArg === 'string') {
    localFilePath = secondArg;
  } else if (isVscodeUri(secondArg)) {
    localFilePath = secondArg.fsPath;
  }

  if (!localFilePath) {
    localFilePath = getActiveReportFilePath();
  }

  if (!localFilePath) {
    localFilePath = await promptForLocalReportFile(
      'Jasper Diff: Selecione o Relatório Local para comparar com o JasperServer'
    );
    if (!localFilePath) {
      return;
    }
  }

  let profile = serverItem?.profile;
  let resourceUri = serverItem?.resource?.uri;
  let resourceName = serverItem?.resource?.name;

  // Verifica se o arquivo local já possui origem mapeada no JasperServer
  if (!resourceUri) {
    const mappedOrigin = serverManager.getDownloadedOrigin(localFilePath);
    if (mappedOrigin) {
      const originProfile = serverManager.getProfileById(mappedOrigin.serverId);
      if (originProfile) {
        const useOriginPick = await vscode.window.showQuickPick(
          [
            {
              id: 'mapped' as const,
              label: `$(cloud) ${mappedOrigin.resourceName} (${originProfile.name})`,
              description: mappedOrigin.resourceUri,
              detail: 'Recurso original vinculado a este arquivo local'
            },
            {
              id: 'choose' as const,
              label: '$(search) Escolher outro recurso no JasperServer...',
              description: 'Selecionar manualmente outro relatório no repositório'
            }
          ],
          {
            title: 'Comparar com JasperServer',
            placeHolder: 'Selecione o recurso do servidor para comparar'
          }
        );

        if (!useOriginPick) {
          return;
        }

        if (useOriginPick.id === 'mapped') {
          profile = originProfile;
          resourceUri = mappedOrigin.resourceUri;
          resourceName = mappedOrigin.resourceName;
        }
      }
    }
  }

  if (!profile) {
    profile = await serverManager.getActiveProfile();
    if (!profile) {
      const profiles = serverManager.getProfiles();
      if (profiles.length === 0) {
        void vscode.window.showWarningMessage(
          'Nenhum servidor JasperServer configurado. Adicione um servidor primeiro.'
        );
        return;
      }
      const pickedProfile = await vscode.window.showQuickPick(
        profiles.map((p) => ({
          label: `$(server) ${p.name}`,
          description: p.baseUrl,
          profile: p
        })),
        {
          title: 'Selecione o Servidor JasperServer',
          placeHolder: 'Escolha o servidor para buscar o relatório'
        }
      );
      if (!pickedProfile) {
        return;
      }
      profile = pickedProfile.profile;
    }
  }

  if (!resourceUri) {
    const cachedResources =
      serverTreeProvider
        ?.getAllResourcesFlat(profile.id)
        .filter(
          (r) =>
            r.resourceType === 'reportUnit' ||
            r.resourceType === 'jrxml' ||
            r.resourceType === 'jasper'
        ) ?? [];

    interface ServerResourcePickItem extends vscode.QuickPickItem {
      uri?: string;
      name?: string;
      manualInput?: boolean;
    }

    const pickItems: ServerResourcePickItem[] = cachedResources.map((res) => ({
      label: `$(file-code) ${res.name}`,
      description: res.uri,
      uri: res.uri,
      name: res.name
    }));

    pickItems.push({
      label: '$(edit) Informar URI do relatório manualmente...',
      description: `Ex: /reports/${path.basename(localFilePath)}`,
      alwaysShow: true,
      manualInput: true
    });

    const chosenResource = await vscode.window.showQuickPick(pickItems, {
      title: `Comparar com JasperServer (${profile.name})`,
      placeHolder: 'Selecione o relatório do servidor ou informe o URI',
      matchOnDescription: true
    });

    if (!chosenResource) {
      return;
    }

    if (chosenResource.manualInput) {
      const manualUri = await vscode.window.showInputBox({
        title: `URI do Relatório no JasperServer (${profile.name})`,
        prompt: 'Informe o URI completo do relatório no JasperServer',
        value: `/reports/${path.basename(localFilePath)}`,
        placeHolder: 'Ex: /reports/hospitalar/Atendimento.jrxml'
      });
      if (!manualUri || !manualUri.trim()) {
        return;
      }
      resourceUri = manualUri.trim().startsWith('/')
        ? manualUri.trim()
        : `/${manualUri.trim()}`;
      resourceName = path.posix.basename(resourceUri);
    } else {
      resourceUri = chosenResource.uri;
      resourceName = chosenResource.name;
    }
  }

  if (!resourceUri || !profile) {
    return;
  }

  const targetProfile = profile;
  const targetUri = resourceUri;
  const targetName = resourceName || path.posix.basename(targetUri);

  try {
    const serverXmlContent = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `JasperServer: Baixando "${targetName}" de ${targetProfile.name} para comparação...`,
        cancellable: false
      },
      async () => {
        const password = await serverManager.getPassword(targetProfile.id);
        return serverClient.downloadResource(targetUri, targetProfile, password);
      }
    );

    DiffViewerPanel.createOrShow(context, runnerService, outputChannel, {
      left: {
        filePath: localFilePath,
        label: `${path.basename(localFilePath)} (Local)`,
        subtitle: localFilePath,
        origin: 'local'
      },
      right: {
        content: serverXmlContent,
        label: `${targetName} (${targetProfile.name})`,
        subtitle: `${targetProfile.name}:${targetUri}`,
        origin: 'server'
      },
      options
    });
  } catch (error) {
    const errMessage =
      error instanceof Error
        ? error.message
        : 'Falha ao obter relatório do JasperServer para comparação.';
    outputChannel.appendLine(
      `[${new Date().toLocaleTimeString('pt-BR')}] [ReportDiff] ERRO ao baixar "${targetUri}": ${errMessage}`
    );
    void vscode.window.showErrorMessage(
      `Falha ao comparar com servidor "${targetProfile.name}": ${errMessage}`
    );
  }
}
