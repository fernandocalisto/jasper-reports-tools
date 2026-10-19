import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JasperServerProfile, JasperServerProfileInput } from '../models/jasperserver';
import { ServerManager } from '../services/serverManager';

export interface WebviewServerPayload extends JasperServerProfileInput {
  password?: string;
}

export interface ServerTestResult {
  success: boolean;
  message: string;
  version?: string;
  user?: string;
}

export type TestServerCallback = (
  payload: WebviewServerPayload
) => Promise<ServerTestResult>;

export class ServerFormPanel {
  public static currentPanel: ServerFormPanel | undefined;
  private static readonly viewType = 'jasper.serverForm';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private currentProfile: JasperServerProfile | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly serverManager: ServerManager,
    profile: JasperServerProfile | undefined,
    private readonly onTestServer: TestServerCallback
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
    serverManager: ServerManager,
    profile: JasperServerProfile | undefined,
    onTestServer: TestServerCallback
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    const title = profile
      ? `Editar Servidor: ${profile.name}`
      : 'Novo Servidor JasperServer';

    if (ServerFormPanel.currentPanel) {
      ServerFormPanel.currentPanel.currentProfile = profile;
      ServerFormPanel.currentPanel.panel.title = title;
      ServerFormPanel.currentPanel.panel.reveal(column);
      void ServerFormPanel.currentPanel.sendProfileData();
      return;
    }

    const webviewRoot = vscode.Uri.file(
      path.join(context.extensionPath, 'webviews', 'jasperserver-form')
    );

    const panel = vscode.window.createWebviewPanel(
      ServerFormPanel.viewType,
      title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot]
      }
    );

    ServerFormPanel.currentPanel = new ServerFormPanel(
      panel,
      context,
      serverManager,
      profile,
      onTestServer
    );
  }

  private async sendProfileData(): Promise<void> {
    let hasSavedPassword = false;
    if (this.currentProfile) {
      const existingSecret = await this.serverManager.getPassword(this.currentProfile.id);
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

      case 'testConnection': {
        const payload = message.payload as WebviewServerPayload;
        try {
          const result = await this.onTestServer(payload);
          await this.panel.webview.postMessage({
            command: 'testResult',
            success: result.success,
            message: result.message,
            version: result.version,
            user: result.user
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

      case 'saveServer': {
        const payload = message.payload as WebviewServerPayload;
        try {
          const passwordToSave =
            payload.id && (!payload.password || payload.password.length === 0)
              ? undefined
              : payload.password;

          const savedProfile = await this.serverManager.saveProfile(
            {
              id: payload.id,
              name: payload.name,
              baseUrl: payload.baseUrl,
              organization: payload.organization,
              username: payload.username
            },
            passwordToSave
          );

          void vscode.window.showInformationMessage(
            `Servidor "${savedProfile.name}" salvo com sucesso.`
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
      'jasperserver-form',
      'index.html'
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'jasperserver-form', 'styles.css')
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'jasperserver-form', 'main.js')
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
    ServerFormPanel.currentPanel = undefined;
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
