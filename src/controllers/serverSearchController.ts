import * as vscode from 'vscode';
import { RepositoryResource } from '../models/jasperserver';
import {
  CachedRepositoryResource,
  ServerTreeItem,
  ServerTreeProvider
} from '../providers/serverTreeProvider';

interface SearchQuickPickItem extends vscode.QuickPickItem {
  resource?: CachedRepositoryResource;
}

/**
 * Controlador de busca 100% client-side para a TreeView `jasper-servers`.
 * Filtra os recursos já carregados em memória sem realizar chamadas REST durante a digitação.
 */
export class ServerSearchController implements vscode.Disposable {
  public static readonly DEBOUNCE_MS = 150;

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private activeQuickPick: vscode.QuickPick<SearchQuickPickItem> | undefined;
  private currentQuery = '';

  constructor(
    private readonly treeProvider: ServerTreeProvider,
    private readonly treeView: vscode.TreeView<ServerTreeItem>,
    private readonly outputChannel?: vscode.OutputChannel
  ) {}

  public dispose(): void {
    this.cancelDebounce();
    if (this.activeQuickPick) {
      this.activeQuickPick.dispose();
      this.activeQuickPick = undefined;
    }
  }

  public get activeSearchQuery(): string {
    return this.currentQuery;
  }

  /**
   * Injeta tags `<mark>` ao redor dos trechos que coincidem com a busca em um MarkdownString.
   */
  public static highlightWithMark(text: string, query: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.supportHtml = true;

    if (!query || !query.trim()) {
      md.appendMarkdown(ServerSearchController.escapeMarkdown(text));
      return md;
    }

    const ranges = ServerSearchController.computeHighlightRanges(text, query);
    if (ranges.length === 0) {
      md.appendMarkdown(ServerSearchController.escapeMarkdown(text));
      return md;
    }

    let cursor = 0;
    let html = '';
    for (const [start, end] of ranges) {
      if (start > cursor) {
        html += ServerSearchController.escapeHtml(text.slice(cursor, start));
      }
      html += `<mark>${ServerSearchController.escapeHtml(text.slice(start, end))}</mark>`;
      cursor = end;
    }
    if (cursor < text.length) {
      html += ServerSearchController.escapeHtml(text.slice(cursor));
    }

    md.appendMarkdown(html);
    return md;
  }

  /**
   * Calcula os intervalos `[início, fim]` de match para highlight nativo no `TreeItemLabel`.
   */
  public static computeHighlightRanges(text: string, query: string): [number, number][] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed || !text) {
      return [];
    }

    const lowerText = text.toLowerCase();
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const rawRanges: [number, number][] = [];

    for (const token of tokens) {
      let startIndex = 0;
      while (startIndex < lowerText.length) {
        const matchIdx = lowerText.indexOf(token, startIndex);
        if (matchIdx === -1) {
          break;
        }
        rawRanges.push([matchIdx, matchIdx + token.length]);
        startIndex = matchIdx + token.length;
      }
    }

    if (rawRanges.length <= 1) {
      return rawRanges;
    }

    // Ordena e mescla intervalos sobrepostos
    rawRanges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: [number, number][] = [rawRanges[0]];

    for (let i = 1; i < rawRanges.length; i++) {
      const current = rawRanges[i];
      const previous = merged[merged.length - 1];
      if (current[0] <= previous[1]) {
        previous[1] = Math.max(previous[1], current[1]);
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  /**
   * Cria função de filtro 100% em memória por nome, caminho (URI) e tipo do recurso.
   */
  public static createFilterPredicate(
    query: string
  ): ((resource: RepositoryResource) => boolean) | undefined {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    return (resource: RepositoryResource): boolean => {
      const nameLower = resource.name.toLowerCase();
      const uriLower = resource.uri.toLowerCase();
      const typeLower = resource.resourceType.toLowerCase();
      const descLower = resource.description ? resource.description.toLowerCase() : '';

      for (const token of tokens) {
        const matchesToken =
          nameLower.includes(token) ||
          uriLower.includes(token) ||
          typeLower.includes(token) ||
          descLower.includes(token);
        if (!matchesToken) {
          return false;
        }
      }
      return true;
    };
  }

  /**
   * Abre a busca inline/QuickPick sobre os recursos já carregados em memória.
   * Zero chamadas REST são feitas durante a digitação.
   */
  public openSearch(): void {
    if (this.activeQuickPick) {
      this.activeQuickPick.show();
      return;
    }

    const quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
    this.activeQuickPick = quickPick;

    const clearButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('close'),
      tooltip: 'Limpar busca (×)'
    };

    quickPick.title = 'Buscar no JasperServer (Client-Side)';
    quickPick.placeholder =
      'Digite nome, caminho ou tipo (ex: Atendimento, /reports, jrxml) — ESC ou × para limpar';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.value = this.currentQuery;
    quickPick.buttons = [clearButton];

    // Popula estado inicial a partir do cache em memória
    this.updateQuickPickItems(quickPick, this.currentQuery);

    let accepted = false;

    quickPick.onDidChangeValue((value) => {
      this.cancelDebounce();
      this.debounceTimer = setTimeout(() => {
        this.applySearchFilter(value);
        this.updateQuickPickItems(quickPick, value);
      }, ServerSearchController.DEBOUNCE_MS);
    });

    quickPick.onDidTriggerButton((button) => {
      if (button === clearButton) {
        accepted = true;
        quickPick.value = '';
        this.clearSearch();
        quickPick.hide();
      }
    });

    quickPick.onDidAccept(async () => {
      accepted = true;
      this.cancelDebounce();

      const currentVal = quickPick.value.trim();
      this.applySearchFilter(currentVal);

      const selected = quickPick.selectedItems[0];
      quickPick.hide();

      if (selected?.resource) {
        const item = this.treeProvider.findTreeItemByResource(
          selected.resource.serverId,
          selected.resource.uri
        );
        if (item) {
          try {
            await this.treeView.reveal(item, {
              select: true,
              focus: true,
              expand: true
            });
          } catch {
            // Ignora falha caso o item não esteja visível no momento
          }
        }
      }
    });

    quickPick.onDidHide(() => {
      this.cancelDebounce();
      // Se fechado com Escape (sem confirmação), limpa a busca conforme requisito 2.1
      if (!accepted) {
        this.clearSearch();
      }
      quickPick.dispose();
      if (this.activeQuickPick === quickPick) {
        this.activeQuickPick = undefined;
      }
    });

    quickPick.show();
  }

  /**
   * Aplica o filtro em memória na TreeView sem disparar requisições REST.
   */
  public applySearchFilter(query: string): void {
    const trimmed = query.trim();
    this.currentQuery = trimmed;

    const filterFn = ServerSearchController.createFilterPredicate(trimmed);
    const startTime = performance.now();
    const matchCount = this.treeProvider.filterTree(filterFn ?? null, trimmed);
    const elapsedMs = performance.now() - startTime;

    void vscode.commands.executeCommand('setContext', 'jasper.searchActive', Boolean(trimmed));

    if (trimmed && this.outputChannel) {
      this.outputChannel.appendLine(
        `[JasperServer Search] Filtro "${trimmed}" aplicado em ${elapsedMs.toFixed(2)}ms (${matchCount} resultado(s) em memória).`
      );
    }
  }

  /**
   * Limpa o filtro ativo e restaura a árvore em memória.
   */
  public clearSearch(): void {
    this.cancelDebounce();
    this.currentQuery = '';
    this.treeProvider.filterTree(null, '');
    void vscode.commands.executeCommand('setContext', 'jasper.searchActive', false);
  }

  private updateQuickPickItems(
    quickPick: vscode.QuickPick<SearchQuickPickItem>,
    query: string
  ): void {
    const allLoaded = this.treeProvider.getAllResourcesFlat();
    const trimmed = query.trim();
    const filterFn = ServerSearchController.createFilterPredicate(trimmed);

    const matched = filterFn ? allLoaded.filter(filterFn) : allLoaded;

    if (allLoaded.length === 0) {
      quickPick.items = [
        {
          label: '$(info) Nenhum recurso carregado em memória ainda',
          description: 'Expanda um servidor na árvore JasperServer Explorer para carregar recursos',
          alwaysShow: true
        }
      ];
      return;
    }

    const maxPreviewItems = 250;
    const slice = matched.slice(0, maxPreviewItems);

    quickPick.items = slice.map((res) => {
      const icon = ServerSearchController.getIconForType(res.resourceType);
      const highlightedDetail = trimmed ? `<mark>${trimmed}</mark> em ${res.uri}` : res.uri;
      return {
        label: `${icon} ${res.name}`,
        description: `[${res.resourceType}] ${res.serverName}`,
        detail: res.description ? `${res.uri} — ${res.description}` : highlightedDetail,
        alwaysShow: true,
        resource: res
      };
    });
  }

  private cancelDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  private static getIconForType(type: RepositoryResource['resourceType']): string {
    switch (type) {
      case 'folder':
        return '$(folder)';
      case 'reportUnit':
        return '$(book)';
      case 'jrxml':
        return '$(file-code)';
      case 'jasper':
        return '$(file-binary)';
      case 'datasource':
        return '$(database)';
      default:
        return '$(file)';
    }
  }

  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private static escapeMarkdown(text: string): string {
    return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
  }
}
