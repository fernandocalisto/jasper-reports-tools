import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DatabaseProfile, DatabaseProfileInput } from '../models/database';
import { ConnectionManager } from '../services/connectionManager';

export interface WebviewConnectionPayload extends DatabaseProfileInput {
  password?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export type TestConnectionCallback = (
  payload: WebviewConnectionPayload
) => Promise<ConnectionTestResult>;

export class DatabaseFormPanel {
  public static currentPanel: DatabaseFormPanel | undefined;
  private static readonly viewType = 'jasper.databaseForm';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private currentProfile: DatabaseProfile | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly connectionManager: ConnectionManager,
    profile: DatabaseProfile | undefined,
    private readonly onTestConnection: TestConnectionCallback
  ) {
    this.panel = panel;
    this.currentProfile = profile;

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    profile: DatabaseProfile | undefined,
    onTestConnection: TestConnectionCallback
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    const title = profile ? `Editar Conexão: ${profile.name}` : 'Nova Conexão Jasper';

    if (DatabaseFormPanel.currentPanel) {
      DatabaseFormPanel.currentPanel.currentProfile = profile;
      DatabaseFormPanel.currentPanel.panel.title = title;
      DatabaseFormPanel.currentPanel.panel.reveal(column);
      void DatabaseFormPanel.currentPanel.sendProfileData();
      return;
    }

    const webviewRoot = vscode.Uri.file(
      path.join(context.extensionPath, 'webviews', 'connection-form')
    );

    const panel = vscode.window.createWebviewPanel(
      DatabaseFormPanel.viewType,
      title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot]
      }
    );

    DatabaseFormPanel.currentPanel = new DatabaseFormPanel(
      panel,
      context,
      connectionManager,
      profile,
      onTestConnection
    );
  }

  private async sendProfileData(): Promise<void> {
    let hasSavedPassword = false;
    if (this.currentProfile) {
      const existingSecret = await this.connectionManager.getPassword(this.currentProfile.id);
      hasSavedPassword = Boolean(existingSecret && existingSecret.length > 0);
    }

    await this.panel.webview.postMessage({
      command: 'loadProfile',
      profile: this.currentProfile ?? null,
      hasSavedPassword
    });
  }

  private async handleMessage(message: any): Promise<void> {
    if (!message || typeof message.command !== 'string') {
      return;
    }

    switch (message.command) {
      case 'ready': {
        await this.sendProfileData();
        break;
      }

      case 'browseJar': {
        const selectedUris = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          openLabel: 'Selecionar Driver JAR',
          title: 'Selecione o arquivo .jar do Driver JDBC',
          filters: {
            'Arquivos JAR': ['jar'],
            'Todos os Arquivos': ['*']
          }
        });

        if (selectedUris && selectedUris.length > 0) {
          await this.panel.webview.postMessage({
            command: 'jarSelected',
            path: selectedUris[0].fsPath
          });
        }
        break;
      }

      case 'testConnection': {
        const payload = message.payload as WebviewConnectionPayload;
        try {
          const result = await this.onTestConnection(payload);
          await this.panel.webview.postMessage({
            command: 'testResult',
            success: result.success,
            message: result.message
          });
        } catch (error) {
          const errMessage = error instanceof Error ? error.message : String(error);
          await this.panel.webview.postMessage({
            command: 'testResult',
            success: false,
            message: errMessage
          });
        }
        break;
      }

      case 'saveConnection': {
        const payload = message.payload as WebviewConnectionPayload;
        try {
          const passwordToSave =
            payload.id && (!payload.password || payload.password.length === 0)
              ? undefined
              : payload.password;

          const savedProfile = await this.connectionManager.saveProfile(
            {
              id: payload.id,
              name: payload.name,
              driver: payload.driver,
              host: payload.host,
              port: payload.port,
              database: payload.database,
              user: payload.user,
              customDriverPath: payload.customDriverPath,
              customDriverClass: payload.customDriverClass,
              jdbcUrl: payload.jdbcUrl
            },
            passwordToSave
          );

          void vscode.window.showInformationMessage(
            `Conexão "${savedProfile.name}" salva com sucesso.`
          );
          this.panel.dispose();
        } catch (error) {
          const errMessage = error instanceof Error ? error.message : String(error);
          await this.panel.webview.postMessage({
            command: 'saveError',
            message: errMessage
          });
        }
        break;
      }
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = path.join(
      this.context.extensionPath,
      'webviews',
      'connection-form',
      'index.html'
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'connection-form', 'styles.css')
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'connection-form', 'main.js')
      )
    );

    const nonce = crypto.randomBytes(16).toString('base64');
    let html = fs.readFileSync(htmlPath, 'utf8');

    html = html
      .replace(/\{\{cspSource\}\}/g, webview.cspSource)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{styleUri\}\}/g, styleUri.toString())
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString());

    return html;
  }

  public dispose(): void {
    DatabaseFormPanel.currentPanel = undefined;
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
