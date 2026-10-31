import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JasperServerProfile, RepositoryResource } from '../models/jasperserver';
import { ServerManager } from '../services/serverManager';
import { JasperServerClient } from '../services/jasperServerClient';
import {
  DEFAULT_TIMEZONE,
  JasperServerSchedulerService,
  JobParameter,
  ReportJob,
  ReportOutputFormat,
  Trigger
} from '../services/jasperServerScheduler';
import { SchedulerTreeProvider } from '../providers/schedulerTreeProvider';

export interface WebviewJobSavePayload {
  id?: string;
  name: string;
  description?: string;
  reportUnitUri: string;
  outputFormat: ReportOutputFormat;
  parameters: JobParameter[];
  triggers: Array<{
    id?: string;
    isNew?: boolean;
    type: 'SIMPLE' | 'CRON' | 'CALENDAR';
    cronExpression?: string;
    calendarName?: string;
    repeatInterval?: number;
    repeatCount?: number;
    startTime: string;
    endTime?: string;
    timezone: string;
    state?: Trigger['state'];
  }>;
}

export class SchedulerJobEditorPanel implements vscode.Disposable {
  public static currentPanel: SchedulerJobEditorPanel | undefined;
  private static readonly viewType = 'jasper.schedulerJobEditor';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private currentProfile: JasperServerProfile;
  private currentJob?: ReportJob;
  private focusTriggerId?: string;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly serverManager: ServerManager,
    private readonly serverClient: JasperServerClient,
    private readonly schedulerService: JasperServerSchedulerService,
    private readonly schedulerTreeProvider: SchedulerTreeProvider,
    private readonly outputChannel: vscode.OutputChannel,
    profile: JasperServerProfile,
    job?: ReportJob,
    focusTriggerId?: string
  ) {
    this.panel = panel;
    this.currentProfile = profile;
    this.currentJob = job;
    this.focusTriggerId = focusTriggerId;

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
    serverClient: JasperServerClient,
    schedulerService: JasperServerSchedulerService,
    schedulerTreeProvider: SchedulerTreeProvider,
    outputChannel: vscode.OutputChannel,
    profile: JasperServerProfile,
    job?: ReportJob,
    focusTriggerId?: string
  ): SchedulerJobEditorPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    const title = job
      ? `Editar Agendamento: ${job.name}`
      : 'Criar Novo Agendamento (JasperServer)';

    if (SchedulerJobEditorPanel.currentPanel) {
      const existing = SchedulerJobEditorPanel.currentPanel;
      existing.currentProfile = profile;
      existing.currentJob = job;
      existing.focusTriggerId = focusTriggerId;
      existing.panel.title = title;
      existing.panel.reveal(column || vscode.ViewColumn.One);
      void existing.sendInitialData();
      return existing;
    }

    const jobEditorRoot = vscode.Uri.file(
      path.join(context.extensionPath, 'webviews', 'scheduler-job-editor')
    );
    const triggerEditorRoot = vscode.Uri.file(
      path.join(context.extensionPath, 'webviews', 'scheduler-trigger-editor')
    );

    const panel = vscode.window.createWebviewPanel(
      SchedulerJobEditorPanel.viewType,
      title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [jobEditorRoot, triggerEditorRoot]
      }
    );

    SchedulerJobEditorPanel.currentPanel = new SchedulerJobEditorPanel(
      panel,
      context,
      serverManager,
      serverClient,
      schedulerService,
      schedulerTreeProvider,
      outputChannel,
      profile,
      job,
      focusTriggerId
    );

    return SchedulerJobEditorPanel.currentPanel;
  }

  private async sendInitialData(): Promise<void> {
    await this.panel.webview.postMessage({
      command: 'loadJobData',
      job: this.currentJob ?? null,
      profile: {
        id: this.currentProfile.id,
        name: this.currentProfile.name,
        baseUrl: this.currentProfile.baseUrl
      },
      defaultTimezone: DEFAULT_TIMEZONE,
      focusTriggerId: this.focusTriggerId ?? null
    });
  }

  private async handleMessage(message: any): Promise<void> {
    if (!message || typeof message.command !== 'string') {
      return;
    }

    switch (message.command) {
      case 'ready': {
        await this.sendInitialData();
        break;
      }

      case 'browseFolder': {
        const folderUri =
          typeof message.folderUri === 'string' && message.folderUri.trim()
            ? message.folderUri.trim()
            : '/';
        try {
          const password = await this.serverManager.getPassword(this.currentProfile.id);
          const resources: RepositoryResource[] = await this.serverClient.listResources(
            folderUri,
            this.currentProfile,
            password
          );
          const selectableResources = resources.filter(
            (r) =>
              r.resourceType === 'folder' ||
              r.resourceType === 'reportUnit' ||
              r.resourceType === 'jrxml' ||
              r.resourceType === 'jasper'
          );
          await this.panel.webview.postMessage({
            command: 'folderResourcesLoaded',
            folderUri,
            resources: selectableResources
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          await this.panel.webview.postMessage({
            command: 'folderResourcesError',
            folderUri,
            message: errMsg
          });
        }
        break;
      }

      case 'inspectReportParameters': {
        const reportUnitUri = String(message.reportUnitUri || '').trim();
        if (!reportUnitUri) {
          return;
        }
        try {
          const parameters = await this.schedulerService.getReportUnitParameters(
            reportUnitUri,
            this.currentProfile
          );
          await this.panel.webview.postMessage({
            command: 'parametersLoaded',
            reportUnitUri,
            parameters
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          await this.panel.webview.postMessage({
            command: 'statusMessage',
            type: 'warning',
            message: `Não foi possível extrair parâmetros automaticamente de "${reportUnitUri}": ${errMsg}`
          });
        }
        break;
      }

      case 'validateCron': {
        const expr = String(message.cronExpression || '');
        const tz = String(message.timezone || DEFAULT_TIMEZONE);
        const result = this.schedulerService.validateCronExpression(expr, tz);
        await this.panel.webview.postMessage({
          command: 'cronValidationResult',
          ...result
        });
        break;
      }

      case 'saveJob': {
        const payload = message.payload as WebviewJobSavePayload;
        await this.handleSaveJob(payload);
        break;
      }

      case 'runJobNow': {
        if (!this.currentJob) {
          return;
        }
        try {
          const exec = await this.schedulerService.runJobNow(
            this.currentJob.id,
            undefined,
            this.currentProfile
          );
          this.schedulerTreeProvider.refresh();
          void vscode.window.showInformationMessage(
            `Execução imediata iniciada para "${this.currentJob.name}" (ID: ${exec.id}).`
          );
          await this.panel.webview.postMessage({
            command: 'statusMessage',
            type: 'success',
            message: `Execução #${exec.id} iniciada com sucesso (${exec.status}).`
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`Falha ao executar job: ${errMsg}`);
          await this.panel.webview.postMessage({
            command: 'statusMessage',
            type: 'error',
            message: errMsg
          });
        }
        break;
      }

      case 'cancel': {
        this.panel.dispose();
        break;
      }
    }
  }

  private async handleSaveJob(payload: WebviewJobSavePayload): Promise<void> {
    if (!payload.name || !payload.name.trim()) {
      await this.panel.webview.postMessage({
        command: 'saveError',
        message: 'Informe o nome do agendamento.'
      });
      return;
    }

    if (!payload.reportUnitUri || !payload.reportUnitUri.trim()) {
      await this.panel.webview.postMessage({
        command: 'saveError',
        message: 'Selecione ou informe o URI do Report Unit.'
      });
      return;
    }

    // Valida expressões Quartz Cron de todos os triggers Cron/Calendar
    for (const trig of payload.triggers || []) {
      if (trig.type === 'CRON' || trig.type === 'CALENDAR') {
        const validation = this.schedulerService.validateCronExpression(
          trig.cronExpression || '',
          trig.timezone || DEFAULT_TIMEZONE
        );
        if (!validation.valid) {
          await this.panel.webview.postMessage({
            command: 'saveError',
            message: `Trigger Cron inválido ("${trig.cronExpression || ''}"): ${validation.error}${
              validation.suggestion ? ` — Sugestão: ${validation.suggestion}` : ''
            }`
          });
          return;
        }
      }
    }

    try {
      let savedJob: ReportJob;
      const isEditing = Boolean(payload.id && this.currentJob);

      if (isEditing && payload.id) {
        savedJob = await this.schedulerService.updateJob(
          payload.id,
          {
            name: payload.name.trim(),
            description: payload.description?.trim() || undefined,
            reportUnitUri: payload.reportUnitUri.trim(),
            outputFormat: payload.outputFormat,
            parameters: payload.parameters || []
          },
          this.currentProfile
        );

        // Sincroniza triggers (deleta removidos, atualiza existentes, cria novos)
        const previousTriggers = this.currentJob?.triggers || [];
        const incomingIds = new Set(
          (payload.triggers || [])
            .filter((t) => !t.isNew && t.id)
            .map((t) => String(t.id))
        );

        for (const prev of previousTriggers) {
          if (!incomingIds.has(prev.id)) {
            await this.schedulerService.deleteTrigger(prev.id, this.currentProfile);
          }
        }

        const syncedTriggers: Trigger[] = [];
        for (const trig of payload.triggers || []) {
          if (trig.isNew || !trig.id) {
            const createdTrig = await this.schedulerService.createTrigger(
              savedJob.id,
              {
                type: trig.type,
                cronExpression: trig.cronExpression,
                calendarName: trig.calendarName,
                repeatInterval: trig.repeatInterval,
                repeatCount: trig.repeatCount,
                startTime: trig.startTime || new Date().toISOString(),
                endTime: trig.endTime,
                timezone: trig.timezone || DEFAULT_TIMEZONE
              },
              this.currentProfile
            );
            if (trig.state === 'PAUSED') {
              await this.schedulerService.pauseTrigger(createdTrig.id, this.currentProfile);
              createdTrig.state = 'PAUSED';
            }
            syncedTriggers.push(createdTrig);
          } else {
            const updatedTrig = await this.schedulerService.updateTrigger(
              trig.id,
              {
                jobId: savedJob.id,
                type: trig.type,
                cronExpression: trig.cronExpression,
                calendarName: trig.calendarName,
                repeatInterval: trig.repeatInterval,
                repeatCount: trig.repeatCount,
                startTime: trig.startTime,
                endTime: trig.endTime,
                timezone: trig.timezone || DEFAULT_TIMEZONE,
                state: trig.state || 'NORMAL'
              },
              this.currentProfile
            );
            syncedTriggers.push(updatedTrig);
          }
        }
        savedJob.triggers = syncedTriggers;
      } else {
        savedJob = await this.schedulerService.createJob(
          {
            name: payload.name.trim(),
            description: payload.description?.trim() || undefined,
            reportUnitUri: payload.reportUnitUri.trim(),
            outputFormat: payload.outputFormat,
            parameters: payload.parameters || []
          },
          this.currentProfile
        );

        const createdTriggers: Trigger[] = [];
        for (const trig of payload.triggers || []) {
          const createdTrig = await this.schedulerService.createTrigger(
            savedJob.id,
            {
              type: trig.type,
              cronExpression: trig.cronExpression,
              calendarName: trig.calendarName,
              repeatInterval: trig.repeatInterval,
              repeatCount: trig.repeatCount,
              startTime: trig.startTime || new Date().toISOString(),
              endTime: trig.endTime,
              timezone: trig.timezone || DEFAULT_TIMEZONE
            },
            this.currentProfile
          );
          if (trig.state === 'PAUSED') {
            await this.schedulerService.pauseTrigger(createdTrig.id, this.currentProfile);
            createdTrig.state = 'PAUSED';
          }
          createdTriggers.push(createdTrig);
        }
        savedJob.triggers = createdTriggers;
      }

      this.schedulerTreeProvider.refresh();
      void vscode.window.showInformationMessage(
        isEditing
          ? `Agendamento "${savedJob.name}" atualizado com sucesso!`
          : `Agendamento "${savedJob.name}" criado com sucesso com ${savedJob.triggers.length} trigger(s)!`
      );
      this.panel.dispose();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[JasperServer Scheduler] Erro ao salvar Job: ${errMsg}`);
      void vscode.window.showErrorMessage(`Erro ao salvar agendamento: ${errMsg}`);
      await this.panel.webview.postMessage({
        command: 'saveError',
        message: errMsg
      });
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = path.join(
      this.context.extensionPath,
      'webviews',
      'scheduler-job-editor',
      'index.html'
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'scheduler-job-editor', 'styles.css')
      )
    );
    const triggerStyleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(
          this.context.extensionPath,
          'webviews',
          'scheduler-trigger-editor',
          'styles.css'
        )
      )
    );
    const triggerScriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(
          this.context.extensionPath,
          'webviews',
          'scheduler-trigger-editor',
          'main.js'
        )
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, 'webviews', 'scheduler-job-editor', 'main.js')
      )
    );

    const nonce = crypto.randomBytes(16).toString('base64');
    let html = fs.readFileSync(htmlPath, 'utf8');

    html = html
      .replace(/\{\{cspSource\}\}/g, webview.cspSource)
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{styleUri\}\}/g, styleUri.toString())
      .replace(/\{\{triggerStyleUri\}\}/g, triggerStyleUri.toString())
      .replace(/\{\{triggerScriptUri\}\}/g, triggerScriptUri.toString())
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString());

    return html;
  }

  public dispose(): void {
    SchedulerJobEditorPanel.currentPanel = undefined;
    this.panel.dispose();

    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}
