import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  JasperServerProfile,
  formatServerSummary,
  normalizeBaseUrl
} from '../models/jasperserver';
import { ServerManager } from '../services/serverManager';
import { JasperServerClient } from '../services/jasperServerClient';
import { RunnerCliError, RunnerService } from '../services/runnerService';
import {
  BreadcrumbSegment,
  ServerTreeItem,
  ServerTreeProvider
} from '../providers/serverTreeProvider';
import { ServerSearchController } from '../controllers/serverSearchController';
import { ServerClipboardController } from '../controllers/serverClipboardController';
import {
  ServerFormPanel,
  ServerTestResult,
  WebviewServerPayload
} from '../webviewPanels/serverFormPanel';
import { resolveTargetJrxmlPath } from './reportCommands';

interface ServerQuickPickItem extends vscode.QuickPickItem {
  profile?: JasperServerProfile;
  action?: 'add';
}

function resolveServerProfileArgument(
  serverManager: ServerManager,
  arg?: ServerTreeItem | JasperServerProfile | string
): JasperServerProfile | undefined {
  if (!arg) {
    return undefined;
  }
  if (typeof arg === 'string') {
    return serverManager.getProfileById(arg);
  }
  if (arg instanceof ServerTreeItem) {
    return arg.profile;
  }
  if (typeof arg === 'object' && 'id' in arg && 'baseUrl' in arg) {
    return arg;
  }
  return undefined;
}

async function promptForServerProfile(
  serverManager: ServerManager,
  placeHolder: string,
  includeAddOption = false
): Promise<JasperServerProfile | 'add' | undefined> {
  const profiles = serverManager.getProfiles();
  const activeId = serverManager.getActiveProfileId();

  if (profiles.length === 0 && !includeAddOption) {
    const action = await vscode.window.showInformationMessage(
      'Nenhum servidor JasperServer cadastrado.',
      'Adicionar Servidor'
    );
    if (action === 'Adicionar Servidor') {
      await vscode.commands.executeCommand('jasper.addServer');
    }
    return undefined;
  }

  const items: ServerQuickPickItem[] = profiles.map((profile) => {
    const isActive = profile.id === activeId;
    return {
      label: `${isActive ? '$(check) ' : '$(server) '}${profile.name}`,
      description: formatServerSummary(profile),
      detail: isActive ? 'Servidor Ativo' : undefined,
      profile
    };
  });

  if (includeAddOption) {
    items.push({
      label: '$(add) Adicionar Novo Servidor JasperServer...',
      description: 'Cadastrar um novo perfil de servidor JasperServer',
      alwaysShow: true,
      action: 'add'
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder,
    matchOnDescription: true
  });

  if (!selected) {
    return undefined;
  }
  if (selected.action === 'add') {
    return 'add';
  }
  return selected.profile;
}

function sanitizeFileSegment(segment: string): string {
  return segment.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'item';
}

function buildLocalDownloadPath(
  profile: JasperServerProfile,
  resourceUri: string,
  resourceName: string
): string {
  const baseName = resourceName.toLowerCase().endsWith('.jrxml')
    ? resourceName
    : path.posix.basename(resourceUri).toLowerCase().endsWith('.jrxml')
    ? path.posix.basename(resourceUri)
    : `${ sanitizeFileSegment(resourceName) }.jrxml`;

  const cleanUri = resourceUri.startsWith('/') ? resourceUri.slice(1) : resourceUri;
  const folderSegments = cleanUri
    .split('/')
    .slice(0, -1)
    .filter(Boolean)
    .map(sanitizeFileSegment);

  const safeServerFolder = sanitizeFileSegment(profile.name || profile.id);
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  const baseDir = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, '.jasperserver', safeServerFolder)
    : path.join(os.tmpdir(), 'jasper-reports-tools', 'jasperserver', safeServerFolder);

  return path.join(baseDir, ...folderSegments, sanitizeFileSegment(baseName));
}

export async function executeServerConnectionTest(
  serverManager: ServerManager,
  serverClient: JasperServerClient,
  profile: JasperServerProfile,
  explicitPassword?: string,
  outputChannel?: vscode.OutputChannel
): Promise<ServerTestResult> {
  const password =
    explicitPassword !== undefined && explicitPassword.length > 0
      ? explicitPassword
      : profile.id
      ? await serverManager.getPassword(profile.id)
      : undefined;

  try {
    const info = await serverClient.testConnection(profile, password);
    const editionLabel = info.edition ? ` (${info.edition})` : '';
    const message = `Comunicação estabelecida! JasperServer v${info.version}${editionLabel} — Usuário: ${info.user}`;

    if (outputChannel) {
      outputChannel.appendLine(`[JasperServer] Teste "${profile.name}": ${message}`);
    }

    return {
      success: true,
      message,
      version: info.version,
      user: info.user
    };
  } catch (error) {
    const errMessage =
      error instanceof Error ? error.message : 'Falha ao conectar ao JasperServer.';
    if (outputChannel) {
      outputChannel.appendLine(
        `[JasperServer] Erro ao testar servidor "${profile.name}": ${errMessage}`
      );
    }
    return {
      success: false,
      message: errMessage
    };
  }
}

async function resolveDeployDestination(
  serverManager: ServerManager,
  filePath: string,
  arg?: ServerTreeItem | vscode.Uri
): Promise<
  | {
      profile: JasperServerProfile;
      folderUri: string;
      preferredFileName?: string;
    }
  | undefined
> {
  if (arg instanceof ServerTreeItem) {
    const profile = arg.profile;
    if (arg.kind === 'server') {
      return { profile, folderUri: '/' };
    }
    if (arg.resource) {
      if (arg.resource.resourceType === 'folder') {
        return { profile, folderUri: arg.resource.uri };
      }
      return {
        profile,
        folderUri: arg.resource.parentFolderUri || '/',
        preferredFileName: path.posix.basename(arg.resource.uri)
      };
    }
  }

  const origin = serverManager.getDownloadedOrigin(filePath);
  if (origin) {
    const originProfile = serverManager.getProfileById(origin.serverId);
    if (originProfile) {
      return {
        profile: originProfile,
        folderUri: origin.parentFolderUri || '/',
        preferredFileName: path.posix.basename(origin.resourceUri)
      };
    }
  }

  let profile = await serverManager.getActiveProfile();
  if (!profile) {
    const picked = await promptForServerProfile(
      serverManager,
      'Selecione o servidor JasperServer de destino',
      true
    );
    if (!picked) {
      return undefined;
    }
    if (picked === 'add') {
      await vscode.commands.executeCommand('jasper.addServer');
      return undefined;
    }
    profile = picked;
  }

  const folderInput = await vscode.window.showInputBox({
    title: `Pasta de Destino no JasperServer (${profile.name})`,
    prompt: 'Informe o URI da pasta no repositório do JasperServer',
    value: '/reports',
    placeHolder: 'Ex: /reports/hospitalar'
  });

  if (!folderInput) {
    return undefined;
  }

  const normalizedFolder = folderInput.trim().startsWith('/')
    ? folderInput.trim()
    : `/${folderInput.trim()}`;

  return {
    profile,
    folderUri: normalizedFolder
  };
}

export function registerServerCommands(
  context: vscode.ExtensionContext,
  serverManager: ServerManager,
  serverClient: JasperServerClient,
  serverTreeProvider: ServerTreeProvider,
  runnerService: RunnerService,
  outputChannel: vscode.OutputChannel,
  serverTreeView?: vscode.TreeView<ServerTreeItem>,
  searchController?: ServerSearchController,
  clipboardController?: ServerClipboardController
): vscode.Disposable[] {
  const testServerCallback = async (
    payload: WebviewServerPayload
  ): Promise<ServerTestResult> => {
    const tempProfile: JasperServerProfile = {
      id: payload.id || '',
      name: payload.name || 'Teste JasperServer',
      baseUrl: normalizeBaseUrl(payload.baseUrl),
      organization: payload.organization?.trim() || undefined,
      username: payload.username.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Jasper: Testando comunicação com ${tempProfile.baseUrl}...`,
        cancellable: false
      },
      async () =>
        executeServerConnectionTest(
          serverManager,
          serverClient,
          tempProfile,
          payload.password,
          outputChannel
        )
    );

    if (result.success) {
      void vscode.window.showInformationMessage(result.message);
    } else {
      void vscode.window.showErrorMessage(`Falha no JasperServer: ${result.message}`);
    }

    return result;
  };

  const addServerCmd = vscode.commands.registerCommand('jasper.addServer', () => {
    ServerFormPanel.createOrShow(context, serverManager, undefined, testServerCallback);
  });

  const editServerCmd = vscode.commands.registerCommand(
    'jasper.editServer',
    async (arg?: ServerTreeItem | JasperServerProfile | string) => {
      let profile = resolveServerProfileArgument(serverManager, arg);
      if (!profile) {
        const picked = await promptForServerProfile(
          serverManager,
          'Selecione o servidor JasperServer que deseja editar'
        );
        if (!picked || picked === 'add') {
          return;
        }
        profile = picked;
      }

      ServerFormPanel.createOrShow(context, serverManager, profile, testServerCallback);
    }
  );

  const deleteServerCmd = vscode.commands.registerCommand(
    'jasper.deleteServer',
    async (arg?: ServerTreeItem | JasperServerProfile | string) => {
      // Se invocado sobre um recurso da árvore (relatório/arquivo), delega para exclusão de recurso no servidor
      if (arg instanceof ServerTreeItem && arg.kind === 'resource' && arg.resource) {
        await vscode.commands.executeCommand('jasper.deleteServerResource', arg);
        return;
      }

      let profile = resolveServerProfileArgument(serverManager, arg);
      if (!profile) {
        const picked = await promptForServerProfile(
          serverManager,
          'Selecione o servidor JasperServer que deseja excluir'
        );
        if (!picked || picked === 'add') {
          return;
        }
        profile = picked;
      }

      const confirmation = await vscode.window.showWarningMessage(
        `Tem certeza que deseja excluir o servidor "${profile.name}"? A senha associada também será removida do SecretStorage.`,
        { modal: true },
        'Excluir'
      );

      if (confirmation === 'Excluir') {
        serverClient.clearSession(profile.id);
        await serverManager.deleteProfile(profile.id);
        void vscode.window.showInformationMessage(`Servidor "${profile.name}" excluído.`);
      }
    }
  );

  const setActiveServerCmd = vscode.commands.registerCommand(
    'jasper.setActiveServer',
    async (arg?: ServerTreeItem | JasperServerProfile | string) => {
      let profile = resolveServerProfileArgument(serverManager, arg);

      if (!profile) {
        const picked = await promptForServerProfile(
          serverManager,
          'Selecione o servidor JasperServer ativo',
          true
        );
        if (!picked) {
          return;
        }
        if (picked === 'add') {
          await vscode.commands.executeCommand('jasper.addServer');
          return;
        }
        profile = picked;
      }

      await serverManager.setActiveProfile(profile.id);
      void vscode.window.showInformationMessage(
        `Servidor JasperServer ativo definido para: ${profile.name}`
      );
    }
  );

  const refreshServerTreeCmd = vscode.commands.registerCommand(
    'jasper.refreshServerTree',
    async (item?: ServerTreeItem) => {
      const targetLabel =
        item?.kind === 'server'
          ? item.profile.name
          : item?.kind === 'resource' && item.resource
          ? item.resource.name
          : 'JasperServer Explorer';

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `JasperServer: Recarregando "${targetLabel}" do servidor...`,
          cancellable: false
        },
        async () => {
          await serverTreeProvider.reloadFromServer(item);
        }
      );

      void vscode.window.showInformationMessage(
        `Repositório "${targetLabel}" sincronizado com o servidor.`
      );
    }
  );

  const downloadServerReportCmd = vscode.commands.registerCommand(
    'jasper.downloadServerReport',
    async (item?: ServerTreeItem) => {
      let profile: JasperServerProfile | undefined = item?.profile;
      let resourceUri: string | undefined = item?.resource?.uri;
      let resourceName: string | undefined = item?.resource?.name;
      let parentFolderUri: string | undefined = item?.resource?.parentFolderUri;
      let resourceType: 'reportUnit' | 'jrxml' | 'jasper' | 'other' =
        item?.resource?.resourceType === 'reportUnit' ||
        item?.resource?.resourceType === 'jrxml' ||
        item?.resource?.resourceType === 'jasper'
          ? item.resource.resourceType
          : 'jrxml';

      if (!profile) {
        profile = await serverManager.getActiveProfile();
        if (!profile) {
          const picked = await promptForServerProfile(
            serverManager,
            'Selecione o servidor JasperServer para baixar o relatório',
            true
          );
          if (!picked) {
            return;
          }
          if (picked === 'add') {
            await vscode.commands.executeCommand('jasper.addServer');
            return;
          }
          profile = picked;
        }
      }

      if (!resourceUri) {
        const inputUri = await vscode.window.showInputBox({
          title: `Baixar Relatório (${profile.name})`,
          prompt: 'Informe o URI completo do relatório no JasperServer',
          placeHolder: 'Ex: /reports/hospitalar/Atendimento.jrxml'
        });
        if (!inputUri || !inputUri.trim()) {
          return;
        }
        resourceUri = inputUri.trim().startsWith('/')
          ? inputUri.trim()
          : `/${inputUri.trim()}`;
        resourceName = path.posix.basename(resourceUri);
        const lastSlash = resourceUri.lastIndexOf('/');
        parentFolderUri = lastSlash > 0 ? resourceUri.slice(0, lastSlash) : '/';
      }

      const targetProfile = profile;
      const targetUri = resourceUri;
      const targetName = resourceName || path.posix.basename(targetUri);
      const targetFolder = parentFolderUri || '/';

      try {
        const xmlContent = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `JasperServer: Baixando "${targetName}" de ${targetProfile.name}...`,
            cancellable: false
          },
          async () => {
            const password = await serverManager.getPassword(targetProfile.id);
            return serverClient.downloadResource(targetUri, targetProfile, password);
          }
        );

        const localFilePath = buildLocalDownloadPath(targetProfile, targetUri, targetName);
        fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
        fs.writeFileSync(localFilePath, xmlContent, 'utf8');

        await serverManager.registerDownloadedOrigin(localFilePath, {
          serverId: targetProfile.id,
          resourceUri: targetUri,
          parentFolderUri: targetFolder,
          resourceName: targetName,
          resourceType
        });

        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer] Relatório "${targetUri}" baixado para: ${localFilePath}`
        );

        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(localFilePath)
        );
        await vscode.window.showTextDocument(document, { preview: false });

        void vscode.window.showInformationMessage(
          `Relatório "${path.basename(localFilePath)}" baixado de "${targetProfile.name}".`
        );
      } catch (error) {
        const errMessage =
          error instanceof Error ? error.message : 'Falha ao baixar o relatório do JasperServer.';
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer] ERRO ao baixar "${targetUri}": ${errMessage}`
        );
        void vscode.window.showErrorMessage(
          `Falha ao baixar "${targetName}": ${errMessage}`
        );
      }
    }
  );

  const deployJasperToServerCmd = vscode.commands.registerCommand(
    'jasper.deployJasperToServer',
    async (arg?: ServerTreeItem | vscode.Uri) => {
      const uriArg = arg instanceof vscode.Uri ? arg : undefined;
      const { filePath, document } = resolveTargetJrxmlPath(uriArg);

      if (!filePath) {
        void vscode.window.showWarningMessage(
          'Nenhum relatório aberto no editor. Abra um arquivo .jrxml para compilar e fazer deploy.'
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

      const destination = await resolveDeployDestination(serverManager, filePath, arg);
      if (!destination) {
        return;
      }

      const baseReportName = path.basename(filePath, path.extname(filePath));
      const jasperFileName = `${baseReportName}.jasper`;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `JasperServer: Compilando e enviando "${jasperFileName}" para ${destination.profile.name}...`,
            cancellable: false
          },
          async () => {
            const compileRes = await runnerService.compileReport(filePath);
            const compiledJasperPath =
              compileRes.outputFile ||
              path.join(path.dirname(filePath), jasperFileName);

            if (!fs.existsSync(compiledJasperPath)) {
              throw new Error(
                `Arquivo compilado .jasper não encontrado em "${compiledJasperPath}".`
              );
            }

            const jasperBuffer = fs.readFileSync(compiledJasperPath);
            const password = await serverManager.getPassword(destination.profile.id);

            await serverClient.uploadResource(
              destination.folderUri,
              jasperFileName,
              jasperBuffer,
              'jasper',
              destination.profile,
              password
            );
          }
        );

        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer] Deploy de "${jasperFileName}" concluído em "${destination.profile.name}:${destination.folderUri}".`
        );

        serverTreeProvider.refresh();
        void vscode.window.showInformationMessage(
          `Deploy de "${jasperFileName}" concluído com sucesso em "${destination.profile.name}" (${destination.folderUri})!`
        );
      } catch (error) {
        const errMessage =
          error instanceof Error ? error.message : 'Falha durante o deploy do .jasper.';
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer] ERRO no deploy de "${jasperFileName}": ${errMessage}`
        );
        if (error instanceof RunnerCliError && error.stackTraceSnippet) {
          outputChannel.appendLine(error.stackTraceSnippet);
        }

        const action = await vscode.window.showErrorMessage(
          `Falha no deploy de "${jasperFileName}": ${errMessage}`,
          'Ver Log'
        );
        if (action === 'Ver Log') {
          outputChannel.show(true);
        }
      }
    }
  );

  const updateJrxmlOnServerCmd = vscode.commands.registerCommand(
    'jasper.updateJrxmlOnServer',
    async (arg?: ServerTreeItem | vscode.Uri) => {
      const uriArg = arg instanceof vscode.Uri ? arg : undefined;
      const { filePath, document } = resolveTargetJrxmlPath(uriArg);

      if (!filePath) {
        void vscode.window.showWarningMessage(
          'Nenhum relatório aberto no editor. Abra um arquivo .jrxml para atualizar no JasperServer.'
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

      const destination = await resolveDeployDestination(serverManager, filePath, arg);
      if (!destination) {
        return;
      }

      const jrxmlContent = document
        ? document.getText()
        : fs.readFileSync(filePath, 'utf8');

      const defaultFileName = path.basename(filePath);
      const targetFileName =
        destination.preferredFileName &&
        destination.preferredFileName.toLowerCase().endsWith('.jrxml')
          ? destination.preferredFileName
          : defaultFileName;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `JasperServer: Atualizando "${targetFileName}" em ${destination.profile.name}...`,
            cancellable: false
          },
          async () => {
            const password = await serverManager.getPassword(destination.profile.id);
            await serverClient.uploadResource(
              destination.folderUri,
              targetFileName,
              jrxmlContent,
              'jrxml',
              destination.profile,
              password
            );
          }
        );

        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer] Arquivo "${targetFileName}" atualizado em "${destination.profile.name}:${destination.folderUri}".`
        );

        serverTreeProvider.refresh();
        void vscode.window.showInformationMessage(
          `Relatório "${targetFileName}" atualizado com sucesso em "${destination.profile.name}" (${destination.folderUri})!`
        );
      } catch (error) {
        const errMessage =
          error instanceof Error
            ? error.message
            : 'Falha ao atualizar o .jrxml no JasperServer.';
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer] ERRO ao atualizar "${targetFileName}": ${errMessage}`
        );
        void vscode.window.showErrorMessage(
          `Falha ao atualizar "${targetFileName}": ${errMessage}`
        );
      }
    }
  );

  const uploadNewJrxmlToServerCmd = vscode.commands.registerCommand(
    'jasper.uploadNewJrxmlToServer',
    async (arg?: ServerTreeItem) => {
      // Determine target folder and profile
      let profile: JasperServerProfile | undefined;
      let folderUri = '/';

      if (arg instanceof ServerTreeItem && arg.kind === 'resource' && arg.resource) {
        if (arg.resource.resourceType === 'folder') {
          profile = arg.profile;
          folderUri = arg.resource.uri;
        } else {
          // If it's a file, use its parent folder
          profile = arg.profile;
          folderUri = arg.resource.parentFolderUri || '/';
        }
      } else if (arg instanceof ServerTreeItem && arg.kind === 'server') {
        profile = arg.profile;
        folderUri = '/';
      }

      if (!profile) {
        profile = await serverManager.getActiveProfile();
        if (!profile) {
          const picked = await promptForServerProfile(
            serverManager,
            'Selecione o servidor JasperServer de destino',
            true
          );
          if (!picked) {
            return;
          }
          if (picked === 'add') {
            await vscode.commands.executeCommand('jasper.addServer');
            return;
          }
          profile = picked;
        }
      }

      // Pick a .jrxml file from the workspace
      const jrxmlFiles = await vscode.workspace.findFiles('**/*.jrxml');
      if (jrxmlFiles.length === 0) {
        void vscode.window.showWarningMessage(
          'Nenhum arquivo .jrxml encontrado no workspace.'
        );
        return;
      }

      const fileItems = jrxmlFiles.map((uri) => ({
        label: path.basename(uri.fsPath),
        description: vscode.workspace.asRelativePath(uri),
        uri
      }));

      const selectedFile = await vscode.window.showQuickPick(fileItems, {
        placeHolder: 'Selecione o arquivo .jrxml do workspace para enviar como novo recurso',
        matchOnDescription: true
      });

      if (!selectedFile) {
        return;
      }

      // Confirm file name (allow override)
      const defaultFileName = path.basename(selectedFile.uri.fsPath);
      const targetFileName = await vscode.window.showInputBox({
        title: `Nome do recurso no JasperServer (${profile.name}:${folderUri})`,
        prompt: 'Nome do arquivo .jrxml a ser criado no servidor',
        value: defaultFileName,
        validateInput: (value) => {
          if (!value || !value.trim()) {
            return 'Informe um nome válido';
          }
          if (!value.toLowerCase().endsWith('.jrxml')) {
            return 'O nome deve terminar com .jrxml';
          }
          return undefined;
        }
      });

      if (!targetFileName) {
        return;
      }

      // Read file content
      let jrxmlContent: string;
      try {
        jrxmlContent = fs.readFileSync(selectedFile.uri.fsPath, 'utf8');
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : 'Falha ao ler o arquivo local.';
        void vscode.window.showErrorMessage(`Falha ao ler \"${defaultFileName}\": ${errMessage}`);
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `JasperServer: Enviando novo recurso \"${targetFileName}\" para ${profile.name}...`,
            cancellable: false
          },
          async () => {
            const password = await serverManager.getPassword(profile.id);
            await serverClient.uploadResource(
              folderUri,
              targetFileName,
              jrxmlContent,
              'jrxml',
              profile,
              password
            );
          }
        );

        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer] Novo recurso \"${targetFileName}\" criado em \"${profile.name}:${folderUri}\".`
        );

        serverTreeProvider.refresh();
        void vscode.window.showInformationMessage(
          `Novo recurso \"${targetFileName}\" criado com sucesso em \"${profile.name}\" (${folderUri})!`
        );
      } catch (error) {
        const errMessage =
          error instanceof Error
            ? error.message
            : 'Falha ao criar novo recurso no JasperServer.';
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer] ERRO ao criar \"${targetFileName}\": ${errMessage}`
        );
        void vscode.window.showErrorMessage(
          `Falha ao criar \"${targetFileName}\": ${errMessage}`
        );
      }
    }
  );

  const deleteServerResourceCmd = vscode.commands.registerCommand(
    'jasper.deleteServerResource',
    async (item?: ServerTreeItem) => {
      if (!item || item.kind !== 'resource' || !item.resource) {
        void vscode.window.showWarningMessage(
          'Selecione um recurso na árvore do JasperServer Explorer para excluir.'
        );
        return;
      }

      const { profile, resource } = item;
      const confirmation = await vscode.window.showWarningMessage(
        `Tem certeza que deseja excluir "${resource.name}" (${resource.uri}) do servidor "${profile.name}"? Esta operação não pode ser desfeita.`,
        { modal: true },
        'Excluir no Servidor'
      );

      if (confirmation !== 'Excluir no Servidor') {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `JasperServer: Excluindo "${resource.name}" de ${profile.name}...`,
            cancellable: false
          },
          async () => {
            const password = await serverManager.getPassword(profile.id);
            await serverClient.deleteResource(resource.uri, profile, password);
          }
        );

        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer] Recurso "${resource.uri}" excluído de "${profile.name}".`
        );

        serverTreeProvider.refresh();
        void vscode.window.showInformationMessage(
          `Recurso "${resource.name}" excluído do servidor "${profile.name}".`
        );
      } catch (error) {
        const errMessage =
          error instanceof Error ? error.message : 'Falha ao excluir recurso no JasperServer.';
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer] ERRO ao excluir "${resource.uri}": ${errMessage}`
        );
        void vscode.window.showErrorMessage(
          `Falha ao excluir "${resource.name}": ${errMessage}`
        );
      }
    }
  );

  // ===========================================================================
  // Etapa 7: JasperServer UX Commands (Search, Copy/Paste, Multi-Select, Nav)
  // ===========================================================================

  const searchServerResourcesCmd = vscode.commands.registerCommand(
    'jasper.searchServerResources',
    () => {
      searchController?.openSearch();
    }
  );

  const clearServerSearchCmd = vscode.commands.registerCommand(
    'jasper.clearServerSearch',
    () => {
      searchController?.clearSearch();
    }
  );

  const copyServerResourceCmd = vscode.commands.registerCommand(
    'jasper.copyServerResource',
    async (item?: ServerTreeItem, selectedItems?: readonly ServerTreeItem[]) => {
      if (clipboardController) {
        await clipboardController.copyResources(item, selectedItems);
      }
    }
  );

  const pasteServerResourceCmd = vscode.commands.registerCommand(
    'jasper.pasteServerResource',
    async (targetUri?: vscode.Uri) => {
      if (clipboardController) {
        await clipboardController.pasteResources(targetUri);
      }
    }
  );

  const copyServerResourcePathCmd = vscode.commands.registerCommand(
    'jasper.copyServerResourcePath',
    async (item?: ServerTreeItem, selectedItems?: readonly ServerTreeItem[]) => {
      if (clipboardController) {
        await clipboardController.copyResourcePath(item, selectedItems);
      }
    }
  );

  const toggleServerSelectionModeCmd = vscode.commands.registerCommand(
    'jasper.toggleServerSelectionMode',
    () => {
      const enabled = serverTreeProvider.toggleSelectionMode();
      vscode.window.setStatusBarMessage(
        enabled
          ? '$(check-all) JasperServer: Modo de seleção múltipla ativado (marque os checkboxes).'
          : '$(close) JasperServer: Modo de seleção múltipla desativado.',
        3500
      );
    }
  );

  const downloadSelectedServerResourcesCmd = vscode.commands.registerCommand(
    'jasper.downloadSelectedServerResources',
    async () => {
      const selectedItems = serverTreeProvider
        .getCheckedResourceItems()
        .filter(
          (entry): entry is ServerTreeItem & {
            resource: NonNullable<ServerTreeItem['resource']>;
          } =>
            entry.kind === 'resource' &&
            entry.resource !== undefined &&
            entry.resource.resourceType !== 'folder'
        );

      if (selectedItems.length === 0) {
        void vscode.window.showWarningMessage(
          'Nenhum arquivo selecionado para download no JasperServer Explorer.'
        );
        return;
      }

      let firstJrxmlPath: string | undefined;
      const downloadedPaths: string[] = [];

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `JasperServer: Baixando ${selectedItems.length} recurso(s) selecionado(s)...`,
            cancellable: false
          },
          async (progress) => {
            for (let i = 0; i < selectedItems.length; i++) {
              const entry = selectedItems[i];
              const targetProfile = entry.profile;
              const targetResource = entry.resource;

              progress.report({
                message: `(${i + 1}/${selectedItems.length}) ${targetResource.name}`,
                increment: (1 / selectedItems.length) * 100
              });

              const password = await serverManager.getPassword(targetProfile.id);
              const content = await serverClient.downloadResource(
                targetResource.uri,
                targetProfile,
                password
              );

              const localFilePath = buildLocalDownloadPath(
                targetProfile,
                targetResource.uri,
                targetResource.name
              );
              fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
              fs.writeFileSync(localFilePath, content, 'utf8');

              const resourceType: 'reportUnit' | 'jrxml' | 'jasper' | 'other' =
                targetResource.resourceType === 'reportUnit' ||
                targetResource.resourceType === 'jrxml' ||
                targetResource.resourceType === 'jasper'
                  ? targetResource.resourceType
                  : 'jrxml';

              await serverManager.registerDownloadedOrigin(localFilePath, {
                serverId: targetProfile.id,
                resourceUri: targetResource.uri,
                parentFolderUri: targetResource.parentFolderUri || '/',
                resourceName: targetResource.name,
                resourceType
              });

              downloadedPaths.push(localFilePath);
              if (!firstJrxmlPath && localFilePath.toLowerCase().endsWith('.jrxml')) {
                firstJrxmlPath = localFilePath;
              }

              outputChannel.appendLine(
                `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer] Recurso "${targetResource.uri}" baixado para: ${localFilePath}`
              );
            }
          }
        );

        if (firstJrxmlPath) {
          const document = await vscode.workspace.openTextDocument(
            vscode.Uri.file(firstJrxmlPath)
          );
          await vscode.window.showTextDocument(document, { preview: false });
        }

        void vscode.window.showInformationMessage(
          `${downloadedPaths.length} recurso(s) baixado(s) do JasperServer com sucesso.`
        );
      } catch (error) {
        const errMessage =
          error instanceof Error
            ? error.message
            : 'Falha ao baixar recursos selecionados.';
        void vscode.window.showErrorMessage(`Falha no download em lote: ${errMessage}`);
      }
    }
  );

  const navigateServerBreadcrumbCmd = vscode.commands.registerCommand(
    'jasper.navigateServerBreadcrumb',
    async (item?: ServerTreeItem) => {
      const segments = serverTreeProvider.getBreadcrumbs(item);
      if (segments.length === 0) {
        void vscode.window.showInformationMessage(
          'Selecione um item no JasperServer Explorer para navegar pelos breadcrumbs.'
        );
        return;
      }

      const pickItems: Array<vscode.QuickPickItem & { segment: BreadcrumbSegment }> =
        segments.map((seg, idx) => {
          const pathTrail = segments
            .slice(0, idx + 1)
            .map((s) => s.label)
            .join(' > ');
          const icon = seg.isServer
            ? '$(server)'
            : seg.resourceType === 'folder'
            ? '$(folder)'
            : '$(file-code)';
          return {
            label: `${icon} ${seg.label}`,
            description: seg.uri,
            detail: pathTrail,
            segment: seg
          };
        });

      const chosen = await vscode.window.showQuickPick(pickItems, {
        title: `Breadcrumbs: ${serverTreeProvider.getBreadcrumbText(item)}`,
        placeHolder: 'Clique em um nível para navegar diretamente na árvore'
      });

      if (!chosen || !serverTreeView) {
        return;
      }

      const targetTreeItem = serverTreeProvider.findTreeItemByResource(
        chosen.segment.profileId,
        chosen.segment.uri
      );
      if (targetTreeItem) {
        serverTreeProvider.setCurrentBreadcrumbItem(targetTreeItem);
        await serverTreeView.reveal(targetTreeItem, {
          select: true,
          focus: true,
          expand: true
        });
      }
    }
  );

  const navigateServerUpCmd = vscode.commands.registerCommand(
    'jasper.navigateServerUp',
    async () => {
      if (!serverTreeView) {
        return;
      }
      const current =
        serverTreeView.selection[0] ?? serverTreeProvider.getCurrentBreadcrumbItem();
      if (!current) {
        return;
      }
      const parent = await serverTreeProvider.getParent(current);
      if (parent) {
        serverTreeProvider.setCurrentBreadcrumbItem(parent);
        await serverTreeView.reveal(parent, {
          select: true,
          focus: true,
          expand: true
        });
      }
    }
  );

  return [
    addServerCmd,
    editServerCmd,
    deleteServerCmd,
    setActiveServerCmd,
    refreshServerTreeCmd,
    downloadServerReportCmd,
    deployJasperToServerCmd,
    updateJrxmlOnServerCmd,
    uploadNewJrxmlToServerCmd,
    deleteServerResourceCmd,
    searchServerResourcesCmd,
    clearServerSearchCmd,
    copyServerResourceCmd,
    pasteServerResourceCmd,
    copyServerResourcePathCmd,
    toggleServerSelectionModeCmd,
    downloadSelectedServerResourcesCmd,
    navigateServerBreadcrumbCmd,
    navigateServerUpCmd
  ];
}
