import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  JasperServerProfile,
  RepositoryResource,
  RepositoryResourceType
} from '../models/jasperserver';
import { ServerManager } from '../services/serverManager';
import { JasperServerClient } from '../services/jasperServerClient';
import { ServerTreeItem, ServerTreeProvider } from '../providers/serverTreeProvider';

export interface JasperClipboardResourceItem {
  uri: string;
  name: string;
  type: RepositoryResourceType;
  serverId: string;
  parentFolderUri?: string;
}

export interface JasperClipboardPayload {
  type: 'jasperServerResources';
  items: JasperClipboardResourceItem[];
}

function sanitizeFileSegment(segment: string): string {
  return segment.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'item';
}

function ensureResourceFileName(item: JasperClipboardResourceItem): string {
  const lowerName = item.name.toLowerCase();
  const baseUriName = path.posix.basename(item.uri);

  if (item.type === 'jasper') {
    if (lowerName.endsWith('.jasper')) {
      return sanitizeFileSegment(item.name);
    }
    if (baseUriName.toLowerCase().endsWith('.jasper')) {
      return sanitizeFileSegment(baseUriName);
    }
    return `${sanitizeFileSegment(item.name)}.jasper`;
  }

  if (lowerName.endsWith('.jrxml')) {
    return sanitizeFileSegment(item.name);
  }
  if (baseUriName.toLowerCase().endsWith('.jrxml')) {
    return sanitizeFileSegment(baseUriName);
  }
  return `${sanitizeFileSegment(item.name)}.jrxml`;
}

/**
 * Controlador de integração com o Clipboard (Ctrl+C / Ctrl+V / Ctrl+Shift+C)
 * para copiar recursos do JasperServer Explorer e colá-los no workspace local.
 */
export class ServerClipboardController implements vscode.Disposable {
  private lastCopiedPayload?: JasperClipboardPayload;

  constructor(
    private readonly serverManager: ServerManager,
    private readonly serverClient: JasperServerClient,
    private readonly treeProvider: ServerTreeProvider,
    private readonly treeView: vscode.TreeView<ServerTreeItem>,
    private readonly outputChannel?: vscode.OutputChannel
  ) {}

  public dispose(): void {
    this.lastCopiedPayload = undefined;
  }

  /**
   * Copia um ou mais recursos selecionados na TreeView para o clipboard em formato JSON.
   */
  public async copyResources(
    item?: ServerTreeItem,
    selectedItems?: readonly ServerTreeItem[]
  ): Promise<void> {
    const targets = this.resolveTargetItems(item, selectedItems).filter(
      (entry): entry is ServerTreeItem & { resource: RepositoryResource } =>
        entry.kind === 'resource' && Boolean(entry.resource)
    );

    if (targets.length === 0) {
      void vscode.window.showWarningMessage(
        'Selecione pelo menos um recurso (.jrxml, .jasper ou pasta) no JasperServer Explorer para copiar.'
      );
      return;
    }

    const payload: JasperClipboardPayload = {
      type: 'jasperServerResources',
      items: targets.map((entry) => ({
        uri: entry.resource.uri,
        name: entry.resource.name,
        type: entry.resource.resourceType,
        serverId: entry.profile.id,
        parentFolderUri: entry.resource.parentFolderUri
      }))
    };

    this.lastCopiedPayload = payload;
    await vscode.env.clipboard.writeText(JSON.stringify(payload));
    void vscode.commands.executeCommand('setContext', 'jasper.hasClipboardResources', true);

    const summary =
      payload.items.length === 1
        ? `"${payload.items[0].name}"`
        : `${payload.items.length} recursos`;

    if (this.outputChannel) {
      this.outputChannel.appendLine(
        `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer Clipboard] Copiado: ${summary}`
      );
    }

    vscode.window.setStatusBarMessage(
      `$(copy) JasperServer: ${summary} copiado(s) (use Ctrl+V no Explorer para baixar)`,
      4500
    );
  }

  /**
   * Copia o caminho (URI) do recurso no servidor (ex: `/reports/hospitalar/Atendimento.jrxml`).
   */
  public async copyResourcePath(
    item?: ServerTreeItem,
    selectedItems?: readonly ServerTreeItem[]
  ): Promise<void> {
    const targets = this.resolveTargetItems(item, selectedItems);
    if (targets.length === 0) {
      void vscode.window.showWarningMessage(
        'Selecione um recurso no JasperServer Explorer para copiar o caminho.'
      );
      return;
    }

    const paths = targets.map((entry) =>
      entry.kind === 'resource' && entry.resource ? entry.resource.uri : '/'
    );
    const joinedPaths = paths.join('\n');

    await vscode.env.clipboard.writeText(joinedPaths);

    vscode.window.setStatusBarMessage(
      `$(check) Caminho copiado: ${paths.length === 1 ? paths[0] : `${paths.length} caminhos`}`,
      3500
    );
    void vscode.window.showInformationMessage(
      paths.length === 1
        ? `Caminho copiado: ${paths[0]}`
        : `${paths.length} caminhos do JasperServer copiados para a área de transferência.`
    );
  }

  /**
   * Cola os recursos copiados do JasperServer no Explorer / workspace local,
   * realizando download de cada item e abrindo automaticamente o primeiro `.jrxml`.
   */
  public async pasteResources(targetFolderUri?: vscode.Uri): Promise<void> {
    const payload = await this.readClipboardPayload();

    if (!payload || payload.items.length === 0) {
      // Se o clipboard não contiver recursos do JasperServer, delega para o paste nativo do Explorer
      try {
        await vscode.commands.executeCommand('filesExplorer.paste');
      } catch {
        // Ignora caso o comando nativo não esteja disponível no contexto atual
      }
      return;
    }

    const destinationDir = await this.resolveLocalPasteDirectory(targetFolderUri);
    if (!destinationDir) {
      return;
    }

    const downloadedFiles: string[] = [];
    let firstJrxmlPath: string | undefined;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `JasperServer: Colando ${payload.items.length} recurso(s) em "${path.basename(destinationDir)}"...`,
          cancellable: false
        },
        async (progress) => {
          const expandedItems = await this.expandFolderItems(payload.items);

          for (let i = 0; i < expandedItems.length; i++) {
            const entry = expandedItems[i];
            progress.report({
              message: `(${i + 1}/${expandedItems.length}) ${entry.item.name}`,
              increment: (1 / Math.max(expandedItems.length, 1)) * 100
            });

            const profile =
              this.serverManager.getProfileById(entry.item.serverId) ??
              (await this.serverManager.getActiveProfile());

            if (!profile) {
              throw new Error(
                `Servidor JasperServer (ID: ${entry.item.serverId}) não encontrado.`
              );
            }

            const password = await this.serverManager.getPassword(profile.id);
            const content = await this.serverClient.downloadResource(
              entry.item.uri,
              profile,
              password
            );

            const fileName = ensureResourceFileName(entry.item);
            const subDir = entry.relativeSubfolder
              ? path.join(destinationDir, ...entry.relativeSubfolder.split('/').filter(Boolean).map(sanitizeFileSegment))
              : destinationDir;

            fs.mkdirSync(subDir, { recursive: true });
            const localFilePath = path.join(subDir, fileName);
            fs.writeFileSync(localFilePath, content, 'utf8');

            const mappedType: 'reportUnit' | 'jrxml' | 'jasper' | 'other' =
              entry.item.type === 'reportUnit' ||
              entry.item.type === 'jrxml' ||
              entry.item.type === 'jasper'
                ? entry.item.type
                : 'jrxml';

            await this.serverManager.registerDownloadedOrigin(localFilePath, {
              serverId: profile.id,
              resourceUri: entry.item.uri,
              parentFolderUri: entry.item.parentFolderUri || '/',
              resourceName: entry.item.name,
              resourceType: mappedType
            });

            downloadedFiles.push(localFilePath);

            if (!firstJrxmlPath && localFilePath.toLowerCase().endsWith('.jrxml')) {
              firstJrxmlPath = localFilePath;
            }

            if (this.outputChannel) {
              this.outputChannel.appendLine(
                `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer Paste] "${entry.item.uri}" salvo em "${localFilePath}".`
              );
            }
          }
        }
      );

      if (firstJrxmlPath) {
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(firstJrxmlPath)
        );
        await vscode.window.showTextDocument(document, { preview: false });
      }

      if (downloadedFiles.length > 0) {
        void vscode.window.showInformationMessage(
          downloadedFiles.length === 1
            ? `Recurso "${path.basename(downloadedFiles[0])}" colado com sucesso no workspace.`
            : `${downloadedFiles.length} recursos colados com sucesso em "${destinationDir}".`
        );
      }
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : 'Falha ao colar recursos do JasperServer.';
      if (this.outputChannel) {
        this.outputChannel.appendLine(
          `[${new Date().toLocaleTimeString('pt-BR')}] [JasperServer Paste] ERRO: ${errMessage}`
        );
      }
      void vscode.window.showErrorMessage(`Falha ao colar do JasperServer: ${errMessage}`);
    }
  }

  private resolveTargetItems(
    item?: ServerTreeItem,
    selectedItems?: readonly ServerTreeItem[]
  ): ServerTreeItem[] {
    // 1. Verifica itens marcados via checkboxes (modo seleção múltipla)
    const checkedItems = this.treeProvider.getCheckedResourceItems();
    if (checkedItems.length > 0) {
      return checkedItems;
    }

    // 2. Verifica seleção múltipla passada pelo VS Code ou presente na TreeView
    if (selectedItems && selectedItems.length > 0) {
      return [...selectedItems];
    }

    if (this.treeView.selection && this.treeView.selection.length > 1) {
      return [...this.treeView.selection];
    }

    // 3. Item alvo direto ou seleção única na TreeView
    if (item) {
      return [item];
    }

    if (this.treeView.selection && this.treeView.selection.length > 0) {
      return [...this.treeView.selection];
    }

    return [];
  }

  private async readClipboardPayload(): Promise<JasperClipboardPayload | undefined> {
    try {
      const rawText = await vscode.env.clipboard.readText();
      if (rawText && rawText.trim().startsWith('{')) {
        const parsed = JSON.parse(rawText);
        if (
          parsed &&
          parsed.type === 'jasperServerResources' &&
          Array.isArray(parsed.items)
        ) {
          return parsed as JasperClipboardPayload;
        }
      }
    } catch {
      // Clipboard não contém JSON válido de recursos JasperServer
    }
    return undefined;
  }

  private async resolveLocalPasteDirectory(
    targetUri?: vscode.Uri
  ): Promise<string | undefined> {
    if (targetUri && targetUri.scheme === 'file') {
      try {
        const stat = fs.statSync(targetUri.fsPath);
        return stat.isDirectory() ? targetUri.fsPath : path.dirname(targetUri.fsPath);
      } catch {
        return path.dirname(targetUri.fsPath);
      }
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.scheme === 'file') {
      return path.dirname(activeEditor.document.uri.fsPath);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      return workspaceFolder.uri.fsPath;
    }

    return path.join(os.tmpdir(), 'jasper-reports-tools', 'paste');
  }

  /**
   * Expande pastas copiadas em lista de arquivos mantendo estrutura de pastas relativa.
   */
  private async expandFolderItems(
    items: JasperClipboardResourceItem[]
  ): Promise<Array<{ item: JasperClipboardResourceItem; relativeSubfolder?: string }>> {
    const result: Array<{ item: JasperClipboardResourceItem; relativeSubfolder?: string }> = [];

    for (const item of items) {
      if (item.type !== 'folder') {
        result.push({ item });
        continue;
      }

      const profile =
        this.serverManager.getProfileById(item.serverId) ??
        (await this.serverManager.getActiveProfile());
      if (!profile) {
        continue;
      }

      const folderBaseName = sanitizeFileSegment(item.name || path.posix.basename(item.uri));
      await this.collectFolderResourcesRecursive(
        profile,
        item.uri,
        folderBaseName,
        result
      );
    }

    return result;
  }

  private async collectFolderResourcesRecursive(
    profile: JasperServerProfile,
    folderUri: string,
    relativePathPrefix: string,
    accumulator: Array<{ item: JasperClipboardResourceItem; relativeSubfolder?: string }>
  ): Promise<void> {
    // Tenta usar cache em memória primeiro antes de recorrer ao servidor
    let children = this.treeProvider.getCachedResources(folderUri, profile.id);
    if (!children) {
      const password = await this.serverManager.getPassword(profile.id);
      children = await this.serverClient.listResources(folderUri, profile, password);
    }

    for (const child of children) {
      if (child.resourceType === 'folder') {
        const childFolderSegment = `${relativePathPrefix}/${sanitizeFileSegment(child.name)}`;
        await this.collectFolderResourcesRecursive(
          profile,
          child.uri,
          childFolderSegment,
          accumulator
        );
      } else if (
        child.resourceType === 'jrxml' ||
        child.resourceType === 'jasper' ||
        child.resourceType === 'reportUnit'
      ) {
        accumulator.push({
          item: {
            uri: child.uri,
            name: child.name,
            type: child.resourceType,
            serverId: profile.id,
            parentFolderUri: child.parentFolderUri
          },
          relativeSubfolder: relativePathPrefix
        });
      }
    }
  }
}
