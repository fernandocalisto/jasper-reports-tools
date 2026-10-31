import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JasperServerProfile } from '../models/jasperserver';
import {
  DEFAULT_PAGE_LIMIT,
  DEFAULT_TIMEZONE,
  JasperServerSchedulerService,
  JobExecution,
  ReportJob,
  formatExecutionDuration,
  formatTimestampInTimezone
} from '../services/jasperServerScheduler';
import { SchedulerTreeProvider } from '../providers/schedulerTreeProvider';

export interface FormattedJobExecution extends JobExecution {
  startTimeFormatted: string;
  endTimeFormatted: string;
  durationFormatted: string;
}

export class SchedulerHistoryPanel implements vscode.Disposable {
  public static currentPanel: SchedulerHistoryPanel | undefined;
  private static readonly viewType = 'jasper.schedulerHistory';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private currentProfile: JasperServerProfile;
  private currentJob: ReportJob;
  private currentOffset = 0;
  private readonly pageSize = DEFAULT_PAGE_LIMIT;
  private highlightExecutionId?: string;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly schedulerService: JasperServerSchedulerService,
    private readonly schedulerTreeProvider: SchedulerTreeProvider,
    private readonly outputChannel: vscode.OutputChannel,
    profile: JasperServerProfile,
    job: ReportJob,
    highlightExecutionId?: string
  ) {
    this.panel = panel;
    this.currentProfile = profile;
    this.currentJob = job;
    this.highlightExecutionId = highlightExecutionId;

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
    schedulerService: JasperServerSchedulerService,
    schedulerTreeProvider: SchedulerTreeProvider,
    outputChannel: vscode.OutputChannel,
    profile: JasperServerProfile,
    job: ReportJob,
    highlightExecutionId?: string
  ): SchedulerHistoryPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    const title = `Execuções: ${job.name}`;

    if (SchedulerHistoryPanel.currentPanel) {
      const existing = SchedulerHistoryPanel.currentPanel;
      existing.currentProfile = profile;
      existing.currentJob = job;
      existing.currentOffset = 0;
      existing.highlightExecutionId = highlightExecutionId;
      existing.panel.title = title;
      existing.panel.reveal(column || vscode.ViewColumn.One);
      void existing.loadExecutionsPage(0);
      return existing;
    }

    const webviewRoot = vscode.Uri.file(
      path.join(context.extensionPath, 'webviews', 'scheduler-history')
    );

    const panel = vscode.window.createWebviewPanel(
      SchedulerHistoryPanel.viewType,
      title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot]
      }
    );

    SchedulerHistoryPanel.currentPanel = new SchedulerHistoryPanel(
      panel,
      context,
      schedulerService,
      schedulerTreeProvider,
      outputChannel,
      profile,
      job,
      highlightExecutionId
    );

    return SchedulerHistoryPanel.currentPanel;
  }

  public async loadExecutionsPage(offset: number): Promise<void> {
    this.currentOffset = Math.max(0, offset);
    try {
      const executions = await this.schedulerService.listExecutions(
        this.currentJob.id,
        this.pageSize,
        this.currentOffset,
        this.currentProfile
      );

      const formatted: FormattedJobExecution[] = executions.map((exec) => ({
        ...exec,
        startTimeFormatted: formatTimestampInTimezone(exec.startTime, DEFAULT_TIMEZONE),
        endTimeFormatted: exec.endTime
          ? formatTimestampInTimezone(exec.endTime, DEFAULT_TIMEZONE)
          : '—',
        durationFormatted: formatExecutionDuration(exec.startTime, exec.endTime)
      }));

      await this.panel.webview.postMessage({
        command: 'executionsLoaded',
        job: this.currentJob,
        profileName: this.currentProfile.name,
        timezone: DEFAULT_TIMEZONE,
        offset: this.currentOffset,
        limit: this.pageSize,
        executions: formatted,
        highlightExecutionId: this.highlightExecutionId ?? null
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await this.panel.webview.postMessage({
        command: 'executionsError',
        message: errMsg
      });
    }
  }

  private async handleMessage(message: any): Promise<void> {
    if (!message || typeof message.command !== 'string') {
      return;
    }

    switch (message.command) {
      case 'ready':
      case 'refresh': {
        await this.loadExecutionsPage(this.currentOffset);
        break;
      }

      case 'changePage': {
        const nextOffset = Number(message.offset ?? 0);
        await this.loadExecutionsPage(nextOffset);
        break;
      }

      case 'runJobNow': {
        try {
          const exec = await this.schedulerService.runJobNow(
            this.currentJob.id,
            undefined,
            this.currentProfile
          );
          this.highlightExecutionId = exec.id;
          this.schedulerTreeProvider.refresh();
          void vscode.window.showInformationMessage(
            `Execução imediata iniciada para "${this.currentJob.name}"!`
          );
          await this.loadExecutionsPage(0);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`Falha ao executar agendamento: ${errMsg}`);
        }
        break;
      }

      case 'downloadOutput': {
        const executionId = String(message.executionId || '');
        if (!executionId) {
          return;
        }
        await this.handleDownloadOutput(executionId);
        break;
      }

      case 'cancelExecution': {
        const executionId = String(message.executionId || '');
        if (!executionId) {
          return;
        }
        try {
          await this.schedulerService.cancelExecution(executionId, this.currentProfile);
          this.schedulerTreeProvider.refresh();
          void vscode.window.showInformationMessage(
            `Execução #${executionId} cancelada com sucesso.`
          );
          await this.loadExecutionsPage(this.currentOffset);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`Erro ao cancelar execução: ${errMsg}`);
        }
        break;
      }
    }
  }

  private async handleDownloadOutput(executionId: string): Promise<void> {
    const ext = this.currentJob.outputFormat.toLowerCase();
    const safeJobName = this.currentJob.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const defaultFileName = `${safeJobName}_${executionId}.${ext}`;

    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const defaultUri = workspaceDir
      ? vscode.Uri.file(path.join(workspaceDir, defaultFileName))
      : undefined;

    const saveUri = await vscode.window.showSaveDialog({
      title: `Salvar Output da Execução #${executionId}`,
      defaultUri,
      filters: {
        [this.currentJob.outputFormat]: [ext],
        'Todos os Arquivos': ['*']
      }
    });

    if (!saveUri) {
      return;
    }

    try {
      const bytes = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `JasperServer: Baixando output da execução #${executionId}...`,
          cancellable: false
        },
        async () =>
          this.schedulerService.downloadExecutionOutput(executionId, this.currentProfile)
      );

      fs.writeFileSync(saveUri.fsPath, Buffer.from(bytes));
      this.outputChannel.appendLine(
        `[JasperServer Scheduler] Output da execução #${executionId} salvo em: ${saveUri.fsPath}`
      );

      const action = await vscode.window.showInformationMessage(
        `Output salvo em "${path.basename(saveUri.fsPath)}".`,
        'Abrir Arquivo'
      );
      if (action === 'Abrir Arquivo') {
        await vscode.env.openExternal(saveUri);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Falha ao baixar output: ${errMsg}`);
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = path.join(
      this.context.extensionPath,
      'webviews',
      'scheduler-history',
      'index.html'
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'scheduler-history', 'styles.css')
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'scheduler-history', 'main.js')
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
    SchedulerHistoryPanel.currentPanel = undefined;
    this.panel.dispose();

    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}
