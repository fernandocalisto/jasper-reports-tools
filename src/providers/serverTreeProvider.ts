import * as vscode from 'vscode';
import {
  JasperServerProfile,
  RepositoryResource,
  formatServerSummary
} from '../models/jasperserver';
import { ServerManager } from '../services/serverManager';
import { JasperServerClient } from '../services/jasperServerClient';

export type ServerTreeItemKind = 'server' | 'resource';

export class ServerTreeItem extends vscode.TreeItem {
  public readonly kind: ServerTreeItemKind;
  public readonly profile: JasperServerProfile;
  public readonly resource?: RepositoryResource;
  public readonly isActiveServer: boolean;

  constructor(options: {
    kind: ServerTreeItemKind;
    profile: JasperServerProfile;
    isActiveServer?: boolean;
    resource?: RepositoryResource;
  }) {
    const isServer = options.kind === 'server';
    const resource = options.resource;
    const isFolder = !isServer && resource?.resourceType === 'folder';

    const label = isServer ? options.profile.name : resource?.name || '';
    const collapsibleState =
      isServer || isFolder
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    super(label, collapsibleState);

    this.kind = options.kind;
    this.profile = options.profile;
    this.resource = resource;
    this.isActiveServer = Boolean(options.isActiveServer);

    if (isServer) {
      this.id = `server:${options.profile.id}`;
      this.description = formatServerSummary(options.profile);
      this.contextValue = this.isActiveServer ? 'serverProfile-active' : 'serverProfile-inactive';
      this.iconPath = this.isActiveServer
        ? new vscode.ThemeIcon('server-environment', new vscode.ThemeColor('charts.green'))
        : new vscode.ThemeIcon('server');

      const tooltip = new vscode.MarkdownString(undefined, true);
      tooltip.appendMarkdown(
        `**${options.profile.name}** ${this.isActiveServer ? '*(Ativo)*' : '*(Inativo)*'}\n\n`
      );
      tooltip.appendMarkdown(`- **URL Base:** \`${options.profile.baseUrl}\`\n`);
      if (options.profile.organization) {
        tooltip.appendMarkdown(`- **Organização:** \`${options.profile.organization}\`\n`);
      }
      tooltip.appendMarkdown(`- **Usuário:** \`${options.profile.username}\`\n`);
      this.tooltip = tooltip;
    } else if (resource) {
      this.id = `resource:${options.profile.id}:${resource.uri}`;
      this.description =
        resource.resourceType === 'folder' ? undefined : resource.uri;

      const tooltip = new vscode.MarkdownString(undefined, true);
      tooltip.appendMarkdown(`**${resource.name}**\n\n`);
      tooltip.appendMarkdown(`- **URI:** \`${resource.uri}\`\n`);
      tooltip.appendMarkdown(`- **Tipo:** \`${resource.resourceType}\`\n`);
      if (resource.version !== undefined) {
        tooltip.appendMarkdown(`- **Versão:** ${resource.version}\n`);
      }
      if (resource.description) {
        tooltip.appendMarkdown(`- **Descrição:** ${resource.description}\n`);
      }
      this.tooltip = tooltip;

      switch (resource.resourceType) {
        case 'folder':
          this.contextValue = 'serverFolder';
          this.iconPath = new vscode.ThemeIcon('folder');
          break;
        case 'reportUnit':
          this.contextValue = 'serverReport-reportUnit';
          this.iconPath = new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.blue'));
          break;
        case 'jrxml':
          this.contextValue = 'serverReport-jrxml';
          this.iconPath = new vscode.ThemeIcon(
            'file-code',
            new vscode.ThemeColor('charts.orange')
          );
          break;
        case 'jasper':
          this.contextValue = 'serverReport-jasper';
          this.iconPath = new vscode.ThemeIcon(
            'file-binary',
            new vscode.ThemeColor('charts.purple')
          );
          break;
        case 'datasource':
          this.contextValue = 'serverResource-datasource';
          this.iconPath = new vscode.ThemeIcon('database');
          break;
        default:
          this.contextValue = 'serverResource-other';
          this.iconPath = new vscode.ThemeIcon('file');
          break;
      }
    }
  }
}

export class ServerTreeProvider
  implements vscode.TreeDataProvider<ServerTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ServerTreeItem | undefined | null | void
  >();
  public readonly onDidChangeTreeData: vscode.Event<
    ServerTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private readonly serverChangeListener: vscode.Disposable;

  constructor(
    private readonly serverManager: ServerManager,
    private readonly serverClient: JasperServerClient,
    private readonly outputChannel?: vscode.OutputChannel
  ) {
    this.serverChangeListener = this.serverManager.onDidChangeServers(() => {
      this.refresh();
    });
  }

  public dispose(): void {
    this.serverChangeListener.dispose();
    this._onDidChangeTreeData.dispose();
  }

  public refresh(element?: ServerTreeItem): void {
    if (!element) {
      this.serverClient.clearSession();
    }
    this._onDidChangeTreeData.fire(element);
  }

  public getTreeItem(element: ServerTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: ServerTreeItem): Promise<ServerTreeItem[]> {
    // Raiz da árvore: lista os servidores cadastrados
    if (!element) {
      const profiles = this.serverManager.getProfiles();
      const activeId = this.serverManager.getActiveProfileId();

      return profiles.map(
        (profile) =>
          new ServerTreeItem({
            kind: 'server',
            profile,
            isActiveServer: profile.id === activeId
          })
      );
    }

    // Expansão preguiçosa (Lazy Loading): servidor -> '/' | pasta -> folderUri
    const targetFolderUri =
      element.kind === 'server'
        ? '/'
        : element.resource?.resourceType === 'folder'
        ? element.resource.uri
        : undefined;

    if (!targetFolderUri) {
      return [];
    }

    try {
      const password = await this.serverManager.getPassword(element.profile.id);
      const resources = await this.serverClient.listResources(
        targetFolderUri,
        element.profile,
        password
      );

      return resources.map(
        (resource) =>
          new ServerTreeItem({
            kind: 'resource',
            profile: element.profile,
            resource
          })
      );
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : 'Falha ao carregar recursos do JasperServer.';
      if (this.outputChannel) {
        this.outputChannel.appendLine(
          `[JasperServer] Erro ao listar "${targetFolderUri}" em "${element.profile.name}": ${errMessage}`
        );
      }
      void vscode.window.showErrorMessage(
        `[${element.profile.name}] Não foi possível carregar "${targetFolderUri}": ${errMessage}`
      );
      return [];
    }
  }
}
