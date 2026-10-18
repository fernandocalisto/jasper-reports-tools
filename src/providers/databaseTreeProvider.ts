import * as vscode from 'vscode';
import { DatabaseProfile, formatConnectionSummary } from '../models/database';
import { ConnectionManager } from '../services/connectionManager';

export class DatabaseTreeItem extends vscode.TreeItem {
  constructor(
    public readonly profile: DatabaseProfile,
    public readonly isActive: boolean
  ) {
    super(profile.name, vscode.TreeItemCollapsibleState.None);

    this.id = profile.id;
    this.description = formatConnectionSummary(profile);
    this.contextValue = isActive ? 'databaseProfile-active' : 'databaseProfile-inactive';

    this.iconPath = isActive
      ? new vscode.ThemeIcon('circle-large-filled', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon('circle-large-outline', new vscode.ThemeColor('disabledForeground'));

    const driverLabel =
      profile.driver === 'postgres'
        ? 'PostgreSQL'
        : profile.driver === 'oracle'
        ? 'Oracle'
        : `Personalizado (${profile.customDriverClass || 'JAR'})`;

    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**${profile.name}** ${isActive ? '*(Ativa)*' : '*(Inativa)*'}\n\n`);
    tooltip.appendMarkdown(`- **Driver:** ${driverLabel}\n`);
    if (profile.host) {
      tooltip.appendMarkdown(`- **Host:** \`${profile.host}:${profile.port ?? ''}\`\n`);
    }
    if (profile.database) {
      tooltip.appendMarkdown(`- **Database / Service:** \`${profile.database}\`\n`);
    }
    if (profile.user) {
      tooltip.appendMarkdown(`- **Usuário:** \`${profile.user}\`\n`);
    }
    if (profile.driver === 'custom' && profile.customDriverPath) {
      tooltip.appendMarkdown(`- **JAR:** \`${profile.customDriverPath}\`\n`);
    }
    this.tooltip = tooltip;

    // Clicar no item na árvore permite marcá-lo como conexão ativa
    this.command = {
      command: 'jasper.setActiveConnection',
      title: 'Definir como Conexão Ativa',
      arguments: [this]
    };
  }
}

export class DatabaseTreeProvider implements vscode.TreeDataProvider<DatabaseTreeItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DatabaseTreeItem | undefined | null | void>();
  public readonly onDidChangeTreeData: vscode.Event<DatabaseTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private readonly connectionChangeListener: vscode.Disposable;

  constructor(private readonly connectionManager: ConnectionManager) {
    this.connectionChangeListener = this.connectionManager.onDidChangeConnections(() => {
      this.refresh();
    });
  }

  public dispose(): void {
    this.connectionChangeListener.dispose();
    this._onDidChangeTreeData.dispose();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: DatabaseTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: DatabaseTreeItem): Promise<DatabaseTreeItem[]> {
    if (element) {
      return [];
    }

    const profiles = this.connectionManager.getProfiles();
    const activeId = this.connectionManager.getActiveProfileId();

    return profiles.map((profile) => new DatabaseTreeItem(profile, profile.id === activeId));
  }
}
