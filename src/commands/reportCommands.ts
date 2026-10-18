import * as vscode from 'vscode';
import * as path from 'path';
import { RunnerCliError, RunnerService } from '../services/runnerService';
import { jrxmlParser } from '../services/jrxmlParser';

function resolveTargetJrxmlPath(uriArg?: vscode.Uri): {
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

export function registerReportCommands(
  context: vscode.ExtensionContext,
  runnerService: RunnerService,
  outputChannel: vscode.OutputChannel
): vscode.Disposable[] {
  void context;

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

  return [compileCurrentReportCmd];
}
