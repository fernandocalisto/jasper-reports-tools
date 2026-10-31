import * as vscode from 'vscode';
import * as path from 'path';
import {
  JasperServerProfile,
  RepositoryResource,
  formatServerSummary
} from '../models/jasperserver';
import { ServerManager } from '../services/serverManager';
import { JasperServerClient } from '../services/jasperServerClient';
import { ServerSearchController } from '../controllers/serverSearchController';

export type ServerTreeItemKind = 'server' | 'resource';

export type ResourceFilterFn = (resource: RepositoryResource) => boolean;

export interface CachedRepositoryResource extends RepositoryResource {
  serverId: string;
  serverName: string;
}

export interface BreadcrumbSegment {
  label: string;
  uri: string;
  profileId: string;
  profileName: string;
  isServer: boolean;
  resourceType?: RepositoryResource['resourceType'];
}

function normalizeFolderUri(folderUri?: string): string {
  if (!folderUri || !folderUri.trim() || folderUri.trim() === '/') {
    return '/';
  }
  const withLeadingSlash = folderUri.trim().startsWith('/')
    ? folderUri.trim()
    : `/${folderUri.trim()}`;
  return withLeadingSlash.replace(/\/+$/, '') || '/';
}

export class ServerTreeItem extends vscode.TreeItem {
  public readonly kind: ServerTreeItemKind;
  public readonly profile: JasperServerProfile;
  public readonly resource?: RepositoryResource;
  public readonly isActiveServer: boolean;
  public readonly highlightedMarkdownLabel?: vscode.MarkdownString;

  constructor(options: {
    kind: ServerTreeItemKind;
    profile: JasperServerProfile;
    isActiveServer?: boolean;
    resource?: RepositoryResource;
    collapsibleState?: vscode.TreeItemCollapsibleState;
    highlightRanges?: [number, number][];
    highlightedMarkdownLabel?: vscode.MarkdownString;
    checkboxState?: vscode.TreeItemCheckboxState;
  }) {
    const isServer = options.kind === 'server';
    const resource = options.resource;
    const isFolder = !isServer && resource?.resourceType === 'folder';

    const rawLabel = isServer ? options.profile.name : resource?.name || '';
    const collapsibleState =
      options.collapsibleState !== undefined
        ? options.collapsibleState
        : isServer || isFolder
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    const itemLabel: string | vscode.TreeItemLabel =
      options.highlightRanges && options.highlightRanges.length > 0
        ? { label: rawLabel, highlights: options.highlightRanges }
        : rawLabel;

    super(itemLabel, collapsibleState);

    this.kind = options.kind;
    this.profile = options.profile;
    this.resource = resource;
    this.isActiveServer = Boolean(options.isActiveServer);
    this.highlightedMarkdownLabel = options.highlightedMarkdownLabel;

    if (options.checkboxState !== undefined) {
      this.checkboxState = options.checkboxState;
    }

    if (isServer) {
      this.id = `server:${options.profile.id}`;
      this.description = formatServerSummary(options.profile);
      this.contextValue = this.isActiveServer ? 'serverProfile-active' : 'serverProfile-inactive';
      this.iconPath = this.isActiveServer
        ? new vscode.ThemeIcon('server-environment', new vscode.ThemeColor('charts.green'))
        : new vscode.ThemeIcon('server');

      const tooltip = new vscode.MarkdownString(undefined, true);
      tooltip.supportHtml = true;
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
      tooltip.supportHtml = true;
      if (options.highlightedMarkdownLabel) {
        tooltip.appendMarkdown(`**${options.highlightedMarkdownLabel.value}**\n\n`);
      } else {
        tooltip.appendMarkdown(`**${resource.name}**\n\n`);
      }
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

  /**
   * Cache em memória de recursos carregados por `${profileId}:${folderUri}`.
   * Garante busca 100% client-side (zero chamadas REST durante digitação).
   */
  private readonly resourceCache = new Map<string, RepositoryResource[]>();

  /**
   * Índice em memória de `ServerTreeItem` instanciados para navegação rápida (`getParent` / `reveal`).
   */
  private readonly treeItemIndex = new Map<string, ServerTreeItem>();

  /**
   * Conjunto de `folderUri` expandidos (`${profileId}:${folderUri}`), preservado entre reloads.
   */
  private readonly expandedFolders = new Set<string>();
  private readonly expandedServers = new Set<string>();

  /**
   * Estado de busca client-side ativa.
   */
  private activeFilterFn?: ResourceFilterFn;
  private activeSearchQuery = '';
  private readonly matchedResourceKeys = new Set<string>();
  private readonly matchedFolderKeys = new Set<string>();
  private readonly matchedServerIds = new Set<string>();

  /**
   * Estado de seleção múltipla (checkboxes).
   */
  private selectionMode = false;
  private readonly checkedResourceKeys = new Set<string>();

  /**
   * Elemento atual para exibição de Breadcrumbs no header da TreeView.
   */
  private currentBreadcrumbItem?: ServerTreeItem;
  private treeView?: vscode.TreeView<ServerTreeItem>;

  constructor(
    private readonly serverManager: ServerManager,
    private readonly serverClient: JasperServerClient,
    private readonly outputChannel?: vscode.OutputChannel
  ) {
    this.serverChangeListener = this.serverManager.onDidChangeServers(() => {
      this.refresh(undefined, false);
    });
  }

  public dispose(): void {
    this.serverChangeListener.dispose();
    this._onDidChangeTreeData.dispose();
  }

  /**
   * Vincula a instância da `TreeView` ao provider para sincronizar expansão, seleção, checkboxes e breadcrumbs.
   */
  public bindTreeView(treeView: vscode.TreeView<ServerTreeItem>): vscode.Disposable {
    this.treeView = treeView;
    this.updateHeaderMessage();

    const expandSub = treeView.onDidExpandElement((event) => {
      this.setElementExpanded(event.element, true);
      this.setCurrentBreadcrumbItem(event.element);
    });

    const collapseSub = treeView.onDidCollapseElement((event) => {
      this.setElementExpanded(event.element, false);
    });

    const selectionSub = treeView.onDidChangeSelection((event) => {
      this.handleTreeViewSelectionChange(event.selection);
    });

    const disposables: vscode.Disposable[] = [expandSub, collapseSub, selectionSub];

    const anyTreeView = treeView as vscode.TreeView<ServerTreeItem> & {
      onDidChangeCheckboxState?: vscode.Event<
        vscode.TreeCheckboxChangeEvent<ServerTreeItem>
      >;
    };
    if (typeof anyTreeView.onDidChangeCheckboxState === 'function') {
      const checkboxSub = anyTreeView.onDidChangeCheckboxState((event) => {
        this.handleCheckboxChange(event.items);
      });
      disposables.push(checkboxSub);
    }

    return vscode.Disposable.from(...disposables);
  }

  private getCacheKey(profileId: string, folderUri: string): string {
    return `${profileId}:${normalizeFolderUri(folderUri)}`;
  }

  private getResourceKey(profileId: string, resourceUri: string): string {
    return `${profileId}:${resourceUri}`;
  }

  /**
   * Retorna os recursos em cache para um `folderUri` específico, se já carregados.
   */
  public getCachedResources(
    folderUri: string,
    profileId?: string
  ): RepositoryResource[] | undefined {
    const normalized = normalizeFolderUri(folderUri);
    if (profileId) {
      return this.resourceCache.get(this.getCacheKey(profileId, normalized));
    }

    const activeId = this.serverManager.getActiveProfileId();
    if (activeId) {
      const activeCached = this.resourceCache.get(this.getCacheKey(activeId, normalized));
      if (activeCached) {
        return activeCached;
      }
    }

    for (const [key, list] of this.resourceCache.entries()) {
      if (key.endsWith(`:${normalized}`)) {
        return list;
      }
    }
    return undefined;
  }

  /**
   * Retorna lista plana de todos os recursos já carregados em memória (para busca client-side).
   */
  public getAllResourcesFlat(serverId?: string): CachedRepositoryResource[] {
    const profilesById = new Map<string, JasperServerProfile>(
      this.serverManager.getProfiles().map((p) => [p.id, p])
    );

    const flat: CachedRepositoryResource[] = [];
    const seenKeys = new Set<string>();

    for (const [cacheKey, resources] of this.resourceCache.entries()) {
      const colonIdx = cacheKey.indexOf(':');
      if (colonIdx <= 0) {
        continue;
      }
      const profileId = cacheKey.slice(0, colonIdx);
      if (serverId && profileId !== serverId) {
        continue;
      }

      const profile = profilesById.get(profileId);
      const serverName = profile?.name || profileId;

      for (const resource of resources) {
        const uniqueKey = this.getResourceKey(profileId, resource.uri);
        if (seenKeys.has(uniqueKey)) {
          continue;
        }
        seenKeys.add(uniqueKey);
        flat.push({
          ...resource,
          serverId: profileId,
          serverName
        });
      }
    }

    return flat;
  }

  /**
   * Aplica filtro 100% em memória sobre os itens carregados e atualiza a árvore sem requisições REST.
   * Expande automaticamente as pastas que contêm matches.
   */
  public filterTree(
    filterFn?: ResourceFilterFn | null,
    searchQuery = ''
  ): number {
    this.activeFilterFn = filterFn ?? undefined;
    this.activeSearchQuery = searchQuery.trim();
    this.matchedResourceKeys.clear();
    this.matchedFolderKeys.clear();
    this.matchedServerIds.clear();

    if (!this.activeFilterFn) {
      this.updateHeaderMessage();
      this._onDidChangeTreeData.fire();
      return 0;
    }

    for (const [cacheKey, resources] of this.resourceCache.entries()) {
      const colonIdx = cacheKey.indexOf(':');
      if (colonIdx <= 0) {
        continue;
      }
      const profileId = cacheKey.slice(0, colonIdx);

      for (const resource of resources) {
        if (this.activeFilterFn(resource)) {
          const resKey = this.getResourceKey(profileId, resource.uri);
          this.matchedResourceKeys.add(resKey);
          this.matchedServerIds.add(profileId);

          // Marca todas as pastas ancestrais para expansão automática
          this.markAncestorFoldersMatched(profileId, resource.parentFolderUri);
          if (resource.resourceType === 'folder') {
            this.matchedFolderKeys.add(this.getCacheKey(profileId, resource.uri));
          }
        }
      }
    }

    this.updateHeaderMessage();
    this._onDidChangeTreeData.fire();
    return this.matchedResourceKeys.size;
  }

  private markAncestorFoldersMatched(profileId: string, folderUri: string): void {
    let current = normalizeFolderUri(folderUri);
    this.matchedFolderKeys.add(this.getCacheKey(profileId, '/'));

    while (current && current !== '/') {
      this.matchedFolderKeys.add(this.getCacheKey(profileId, current));
      const lastSlash = current.lastIndexOf('/');
      current = lastSlash > 0 ? current.slice(0, lastSlash) : '/';
    }
  }

  /**
   * Atualiza a árvore. Quando `clearCache = true`, limpa o cache em memória para sincronizar com o servidor.
   */
  public refresh(element?: ServerTreeItem, clearCache = true): void {
    if (clearCache) {
      if (!element) {
        this.resourceCache.clear();
        this.serverClient.clearSession();
      } else if (element.kind === 'server') {
        this.clearServerCache(element.profile.id);
        this.serverClient.clearSession(element.profile.id);
      } else if (element.kind === 'resource' && element.resource) {
        const targetUri =
          element.resource.resourceType === 'folder'
            ? element.resource.uri
            : element.resource.parentFolderUri;
        this.resourceCache.delete(this.getCacheKey(element.profile.id, targetUri));
      }
    }

    if (this.activeFilterFn) {
      this.filterTree(this.activeFilterFn, this.activeSearchQuery);
      return;
    }

    this.updateHeaderMessage();
    this._onDidChangeTreeData.fire(element);
  }

  /**
   * Recarrega os dados do servidor mantendo o estado das pastas expandidas e seleção.
   */
  public async reloadFromServer(element?: ServerTreeItem): Promise<void> {
    const targetServers =
      element?.kind === 'server'
        ? [element.profile]
        : element?.kind === 'resource'
        ? [element.profile]
        : this.serverManager.getProfiles().filter((p) =>
            this.expandedServers.has(p.id) || p.id === this.serverManager.getActiveProfileId()
          );

    if (!element) {
      this.resourceCache.clear();
      this.serverClient.clearSession();
    } else if (element.kind === 'server') {
      this.clearServerCache(element.profile.id);
      this.serverClient.clearSession(element.profile.id);
    } else if (element.kind === 'resource' && element.resource) {
      const folderUri =
        element.resource.resourceType === 'folder'
          ? element.resource.uri
          : element.resource.parentFolderUri;
      this.resourceCache.delete(this.getCacheKey(element.profile.id, folderUri));
    }

    // Pré-carrega a raiz e as pastas que estavam expandidas antes do reload
    for (const profile of targetServers) {
      try {
        const password = await this.serverManager.getPassword(profile.id);
        const rootResources = await this.serverClient.listResources('/', profile, password);
        this.resourceCache.set(this.getCacheKey(profile.id, '/'), rootResources);

        const expandedForProfile = Array.from(this.expandedFolders)
          .filter((key) => key.startsWith(`${profile.id}:`))
          .map((key) => key.slice(profile.id.length + 1))
          .filter((uri) => uri !== '/')
          .sort((a, b) => a.length - b.length);

        for (const folderUri of expandedForProfile) {
          try {
            const children = await this.serverClient.listResources(
              folderUri,
              profile,
              password
            );
            this.resourceCache.set(this.getCacheKey(profile.id, folderUri), children);
          } catch {
            // Ignora pasta removida no servidor
          }
        }
      } catch {
        // O erro será reportado normalmente no getChildren se necessário
      }
    }

    if (this.activeFilterFn) {
      this.filterTree(this.activeFilterFn, this.activeSearchQuery);
    } else {
      this.updateHeaderMessage();
      this._onDidChangeTreeData.fire(element);
    }

    // Re-expande os elementos na TreeView após atualização
    if (this.treeView && this.currentBreadcrumbItem) {
      const refreshedItem =
        this.currentBreadcrumbItem.kind === 'resource' && this.currentBreadcrumbItem.resource
          ? this.findTreeItemByResource(
              this.currentBreadcrumbItem.profile.id,
              this.currentBreadcrumbItem.resource.uri
            )
          : this.treeItemIndex.get(`server:${this.currentBreadcrumbItem.profile.id}`);
      if (refreshedItem) {
        try {
          await this.treeView.reveal(refreshedItem, {
            expand: true,
            select: false,
            focus: false
          });
        } catch {
          // Ignora caso a view esteja oculta
        }
      }
    }
  }

  private clearServerCache(profileId: string): void {
    const prefix = `${profileId}:`;
    for (const key of this.resourceCache.keys()) {
      if (key.startsWith(prefix)) {
        this.resourceCache.delete(key);
      }
    }
  }

  public setElementExpanded(element: ServerTreeItem, expanded: boolean): void {
    if (element.kind === 'server') {
      if (expanded) {
        this.expandedServers.add(element.profile.id);
        this.expandedFolders.add(this.getCacheKey(element.profile.id, '/'));
      } else {
        this.expandedServers.delete(element.profile.id);
      }
      return;
    }

    if (element.kind === 'resource' && element.resource?.resourceType === 'folder') {
      const key = this.getCacheKey(element.profile.id, element.resource.uri);
      if (expanded) {
        this.expandedFolders.add(key);
      } else {
        this.expandedFolders.delete(key);
      }
    }
  }

  public getExpandedFolders(): ReadonlySet<string> {
    return this.expandedFolders;
  }

  // =========================================================================
  // Multi-Select & Checkboxes
  // =========================================================================

  public isSelectionMode(): boolean {
    return this.selectionMode;
  }

  public toggleSelectionMode(forceState?: boolean): boolean {
    this.selectionMode = forceState !== undefined ? forceState : !this.selectionMode;
    if (!this.selectionMode) {
      this.checkedResourceKeys.clear();
    }
    this.syncSelectionContextKeys();
    this.updateHeaderMessage();
    this._onDidChangeTreeData.fire();
    return this.selectionMode;
  }

  public handleCheckboxChange(
    items: ReadonlyArray<readonly [ServerTreeItem, vscode.TreeItemCheckboxState]>
  ): void {
    for (const [item, state] of items) {
      const isChecked = state === vscode.TreeItemCheckboxState.Checked;
      if (item.kind !== 'resource' || !item.resource) {
        continue;
      }

      const itemKey = this.getResourceKey(item.profile.id, item.resource.uri);
      if (isChecked) {
        this.checkedResourceKeys.add(itemKey);
      } else {
        this.checkedResourceKeys.delete(itemKey);
      }

      // Selecionar tudo na pasta: quando o checkbox da pasta é alterado, marca/desmarca todos os filhos carregados
      if (item.resource.resourceType === 'folder') {
        this.setFolderDescendantsChecked(
          item.profile.id,
          item.resource.uri,
          isChecked
        );
      }
    }

    this.syncSelectionContextKeys();
    this.updateHeaderMessage();
    this._onDidChangeTreeData.fire();
  }

  private setFolderDescendantsChecked(
    profileId: string,
    folderUri: string,
    checked: boolean
  ): void {
    const normalizedFolder = normalizeFolderUri(folderUri);
    const prefix = normalizedFolder === '/' ? '/' : `${normalizedFolder}/`;

    for (const [cacheKey, resources] of this.resourceCache.entries()) {
      if (!cacheKey.startsWith(`${profileId}:`)) {
        continue;
      }
      for (const res of resources) {
        if (res.uri === normalizedFolder || res.uri.startsWith(prefix)) {
          const resKey = this.getResourceKey(profileId, res.uri);
          if (checked) {
            this.checkedResourceKeys.add(resKey);
          } else {
            this.checkedResourceKeys.delete(resKey);
          }
        }
      }
    }
  }

  private handleTreeViewSelectionChange(selection: readonly ServerTreeItem[]): void {
    if (selection.length > 0) {
      this.setCurrentBreadcrumbItem(selection[selection.length - 1]);
    }

    // Modo seleção: Shift+Click ou Ctrl+Click (múltiplos itens) ativa checkboxes automaticamente
    const resourceSelection = selection.filter(
      (i) => i.kind === 'resource' && Boolean(i.resource)
    );

    if (resourceSelection.length > 1) {
      const wasSelectionMode = this.selectionMode;
      this.selectionMode = true;
      for (const item of resourceSelection) {
        if (item.resource) {
          const key = this.getResourceKey(item.profile.id, item.resource.uri);
          this.checkedResourceKeys.add(key);
          if (item.resource.resourceType === 'folder') {
            this.setFolderDescendantsChecked(item.profile.id, item.resource.uri, true);
          }
        }
      }
      this.syncSelectionContextKeys(resourceSelection.length);
      this.updateHeaderMessage();
      if (!wasSelectionMode) {
        this._onDidChangeTreeData.fire();
      }
    } else {
      this.syncSelectionContextKeys(resourceSelection.length);
    }
  }

  private syncSelectionContextKeys(treeSelectionCount = 0): void {
    const effectiveCount = Math.max(this.checkedResourceKeys.size, treeSelectionCount);
    void vscode.commands.executeCommand(
      'setContext',
      'jasper.selectionMode',
      this.selectionMode
    );
    void vscode.commands.executeCommand('setContext', 'selectionCount', effectiveCount);
  }

  /**
   * Retorna todos os `ServerTreeItem` marcados via checkboxes (ou selecionados na TreeView).
   */
  public getCheckedResourceItems(): ServerTreeItem[] {
    const result: ServerTreeItem[] = [];
    for (const key of this.checkedResourceKeys) {
      const item = this.treeItemIndex.get(`resource:${key}`);
      if (item && item.kind === 'resource' && item.resource) {
        result.push(item);
      }
    }

    if (result.length === 0 && this.treeView?.selection) {
      return this.treeView.selection.filter(
        (i) => i.kind === 'resource' && Boolean(i.resource)
      );
    }

    return result;
  }

  // =========================================================================
  // Breadcrumbs & Navegação
  // =========================================================================

  public setCurrentBreadcrumbItem(item?: ServerTreeItem): void {
    this.currentBreadcrumbItem = item;
    this.updateHeaderMessage();
  }

  public getCurrentBreadcrumbItem(): ServerTreeItem | undefined {
    return this.currentBreadcrumbItem;
  }

  /**
   * Constrói os segmentos de breadcrumb para o elemento atual:
   * `Servidor > reports > hospitalar > Atendimento.jrxml`
   */
  public getBreadcrumbs(item?: ServerTreeItem): BreadcrumbSegment[] {
    const target = item ?? this.currentBreadcrumbItem;
    if (!target) {
      return [];
    }

    const segments: BreadcrumbSegment[] = [
      {
        label: target.profile.name,
        uri: '/',
        profileId: target.profile.id,
        profileName: target.profile.name,
        isServer: true
      }
    ];

    if (target.kind === 'resource' && target.resource) {
      const cleanUri = target.resource.uri.replace(/^\/+/, '');
      const parts = cleanUri.split('/').filter(Boolean);
      let cumulativeUri = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        cumulativeUri += `/${part}`;
        const isLast = i === parts.length - 1;
        segments.push({
          label: isLast ? target.resource.name : part,
          uri: cumulativeUri,
          profileId: target.profile.id,
          profileName: target.profile.name,
          isServer: false,
          resourceType: isLast ? target.resource.resourceType : 'folder'
        });
      }
    }

    return segments;
  }

  public getBreadcrumbText(item?: ServerTreeItem): string {
    const segments = this.getBreadcrumbs(item);
    if (segments.length === 0) {
      return '';
    }
    return segments.map((s) => s.label).join(' > ');
  }

  private updateHeaderMessage(): void {
    if (!this.treeView) {
      return;
    }

    const parts: string[] = [];

    const breadcrumbText = this.getBreadcrumbText();
    if (breadcrumbText) {
      parts.push(`$(folder-opened) ${breadcrumbText}`);
    }

    if (this.activeFilterFn && this.activeSearchQuery) {
      parts.push(
        `$(search) Filtro: "${this.activeSearchQuery}" (${this.matchedResourceKeys.size})`
      );
    }

    if (this.selectionMode || this.checkedResourceKeys.size > 0) {
      parts.push(`$(check-all) ${this.checkedResourceKeys.size} selecionado(s)`);
    }

    this.treeView.message = parts.length > 0 ? parts.join('   |   ') : undefined;
  }

  public findTreeItemByResource(
    profileId: string,
    resourceUri: string
  ): ServerTreeItem | undefined {
    const normalized = normalizeFolderUri(resourceUri);
    if (normalized === '/') {
      return this.treeItemIndex.get(`server:${profileId}`);
    }
    const existing = this.treeItemIndex.get(`resource:${profileId}:${normalized}`);
    if (existing) {
      return existing;
    }

    const profile = this.serverManager.getProfileById(profileId);
    if (!profile) {
      return undefined;
    }

    // Procura nos recursos carregados em memória
    const parentUri = path.posix.dirname(normalized);
    const siblings = this.getCachedResources(parentUri, profileId);
    const matchedRes = siblings?.find((r) => r.uri === normalized);
    if (matchedRes) {
      return this.createResourceTreeItem(profile, matchedRes);
    }
    return undefined;
  }

  // =========================================================================
  // TreeDataProvider Implementation
  // =========================================================================

  public getTreeItem(element: ServerTreeItem): vscode.TreeItem {
    return element;
  }

  public getParent(element: ServerTreeItem): vscode.ProviderResult<ServerTreeItem> {
    if (element.kind === 'server') {
      return undefined;
    }

    if (element.kind === 'resource' && element.resource) {
      const parentUri = normalizeFolderUri(element.resource.parentFolderUri);
      if (parentUri === '/') {
        const activeId = this.serverManager.getActiveProfileId();
        return (
          this.treeItemIndex.get(`server:${element.profile.id}`) ??
          new ServerTreeItem({
            kind: 'server',
            profile: element.profile,
            isActiveServer: element.profile.id === activeId
          })
        );
      }

      return this.findTreeItemByResource(element.profile.id, parentUri);
    }

    return undefined;
  }

  public async getChildren(element?: ServerTreeItem): Promise<ServerTreeItem[]> {
    // Raiz da árvore: lista os servidores cadastrados
    if (!element) {
      const profiles = this.serverManager.getProfiles();
      const activeId = this.serverManager.getActiveProfileId();

      const visibleProfiles = this.activeFilterFn
        ? profiles.filter(
            (p) =>
              this.matchedServerIds.has(p.id) ||
              p.name.toLowerCase().includes(this.activeSearchQuery.toLowerCase())
          )
        : profiles;

      return visibleProfiles.map((profile) => {
        const shouldExpand =
          Boolean(this.activeFilterFn && this.matchedServerIds.has(profile.id)) ||
          this.expandedServers.has(profile.id);

        const serverItem = new ServerTreeItem({
          kind: 'server',
          profile,
          isActiveServer: profile.id === activeId,
          collapsibleState: shouldExpand
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed
        });
        this.treeItemIndex.set(`server:${profile.id}`, serverItem);
        return serverItem;
      });
    }

    // Expansão preguiçosa (Lazy Loading): servidor -> '/' | pasta -> folderUri
    const targetFolderUri =
      element.kind === 'server'
        ? '/'
        : element.resource?.resourceType === 'folder'
        ? normalizeFolderUri(element.resource.uri)
        : undefined;

    if (!targetFolderUri) {
      return [];
    }

    const cacheKey = this.getCacheKey(element.profile.id, targetFolderUri);
    let resources = this.resourceCache.get(cacheKey);

    // IMPORTANTE: durante filtro/busca ativa, usa 100% cache em memória (ZERO chamadas REST)
    if (!resources) {
      if (this.activeFilterFn) {
        return [];
      }

      try {
        const password = await this.serverManager.getPassword(element.profile.id);
        resources = await this.serverClient.listResources(
          targetFolderUri,
          element.profile,
          password
        );
        this.resourceCache.set(cacheKey, resources);
      } catch (error) {
        const errMessage =
          error instanceof Error
            ? error.message
            : 'Falha ao carregar recursos do JasperServer.';
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

    const filteredResources = this.activeFilterFn
      ? resources.filter((res) => {
          const resKey = this.getResourceKey(element.profile.id, res.uri);
          if (this.matchedResourceKeys.has(resKey)) {
            return true;
          }
          if (res.resourceType === 'folder') {
            return this.matchedFolderKeys.has(
              this.getCacheKey(element.profile.id, res.uri)
            );
          }
          return false;
        })
      : resources;

    return filteredResources.map((resource) =>
      this.createResourceTreeItem(element.profile, resource)
    );
  }

  private createResourceTreeItem(
    profile: JasperServerProfile,
    resource: RepositoryResource
  ): ServerTreeItem {
    const isFolder = resource.resourceType === 'folder';
    const folderCacheKey = isFolder ? this.getCacheKey(profile.id, resource.uri) : undefined;
    const resKey = this.getResourceKey(profile.id, resource.uri);

    const shouldExpandFolder =
      isFolder &&
      folderCacheKey !== undefined &&
      ((this.activeFilterFn && this.matchedFolderKeys.has(folderCacheKey)) ||
        this.expandedFolders.has(folderCacheKey));

    const collapsibleState = isFolder
      ? shouldExpandFolder
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    const highlightRanges =
      this.activeSearchQuery.length > 0
        ? ServerSearchController.computeHighlightRanges(
            resource.name,
            this.activeSearchQuery
          )
        : undefined;

    const highlightedMarkdownLabel =
      this.activeSearchQuery.length > 0
        ? ServerSearchController.highlightWithMark(resource.name, this.activeSearchQuery)
        : undefined;

    const checkboxState = this.selectionMode
      ? this.checkedResourceKeys.has(resKey)
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked
      : undefined;

    const treeItem = new ServerTreeItem({
      kind: 'resource',
      profile,
      resource,
      collapsibleState,
      highlightRanges,
      highlightedMarkdownLabel,
      checkboxState
    });

    this.treeItemIndex.set(`resource:${resKey}`, treeItem);
    return treeItem;
  }
}
