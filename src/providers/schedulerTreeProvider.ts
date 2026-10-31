import * as vscode from 'vscode';
import { JasperServerProfile, formatServerSummary } from '../models/jasperserver';
import { ServerManager } from '../services/serverManager';
import {
  DEFAULT_TIMEZONE,
  JasperServerSchedulerService,
  JobExecution,
  ReportJob,
  Trigger,
  formatExecutionDuration,
  formatTimestampInTimezone,
  formatTriggerLabel
} from '../services/jasperServerScheduler';
import { ServerSearchController } from '../controllers/serverSearchController';

export type SchedulerTreeItemKind =
  | 'schedulesRoot'
  | 'job'
  | 'trigger'
  | 'execution'
  | 'createAction';

export interface SchedulerClipboardJobPayload {
  type: 'jasperScheduleJob';
  serverId: string;
  job: Omit<ReportJob, 'id' | 'createdAt' | 'updatedAt'>;
}

function getTriggerStateDisplay(state: Trigger['state']): string {
  switch (state) {
    case 'NORMAL':
      return 'Ativo';
    case 'PAUSED':
      return 'Pausado';
    case 'COMPLETE':
      return 'Concluído';
    case 'ERROR':
      return 'Erro';
    case 'BLOCKED':
      return 'Bloqueado';
    default:
      return state;
  }
}

function getExecutionStatusSymbol(status: JobExecution['status']): string {
  switch (status) {
    case 'SUCCESS':
      return '✓';
    case 'FAILED':
      return '✗';
    case 'RUNNING':
      return '⏳';
    case 'CANCELLED':
      return '⏸';
    default:
      return '';
  }
}

export class SchedulerTreeItem extends vscode.TreeItem {
  public readonly kind: SchedulerTreeItemKind;
  public readonly profile: JasperServerProfile;
  public readonly job?: ReportJob;
  public readonly trigger?: Trigger;
  public readonly execution?: JobExecution;

  constructor(options: {
    kind: SchedulerTreeItemKind;
    profile: JasperServerProfile;
    job?: ReportJob;
    trigger?: Trigger;
    execution?: JobExecution;
    collapsibleState?: vscode.TreeItemCollapsibleState;
    highlightRanges?: [number, number][];
    highlightedMarkdownLabel?: vscode.MarkdownString;
  }) {
    const { kind, profile, job, trigger, execution } = options;

    let rawLabel = '';
    let defaultCollapsible = vscode.TreeItemCollapsibleState.None;

    if (kind === 'schedulesRoot') {
      rawLabel = 'Schedules';
      defaultCollapsible = vscode.TreeItemCollapsibleState.Collapsed;
    } else if (kind === 'job' && job) {
      rawLabel = `Job: "${job.name}"`;
      defaultCollapsible = vscode.TreeItemCollapsibleState.Collapsed;
    } else if (kind === 'trigger' && trigger) {
      const stateLabel = getTriggerStateDisplay(trigger.state);
      rawLabel = `Trigger: "${formatTriggerLabel(trigger)}" (${stateLabel})`;
      defaultCollapsible = vscode.TreeItemCollapsibleState.None;
    } else if (kind === 'execution' && execution) {
      const formattedStart = formatTimestampInTimezone(execution.startTime, DEFAULT_TIMEZONE);
      const symbol = getExecutionStatusSymbol(execution.status);
      rawLabel = `Última execução: ${formattedStart} ${symbol}`;
      defaultCollapsible = vscode.TreeItemCollapsibleState.None;
    } else if (kind === 'createAction') {
      rawLabel = '[Criar Novo Agendamento...]';
      defaultCollapsible = vscode.TreeItemCollapsibleState.None;
    }

    const itemLabel: string | vscode.TreeItemLabel =
      options.highlightRanges && options.highlightRanges.length > 0
        ? { label: rawLabel, highlights: options.highlightRanges }
        : rawLabel;

    super(itemLabel, options.collapsibleState ?? defaultCollapsible);

    this.kind = kind;
    this.profile = profile;
    this.job = job;
    this.trigger = trigger;
    this.execution = execution;

    if (kind === 'schedulesRoot') {
      this.id = `schedulesRoot:${profile.id}`;
      this.description = `${profile.name} (${formatServerSummary(profile)})`;
      this.contextValue = 'schedulesRoot';
      this.iconPath = new vscode.ThemeIcon('calendar', new vscode.ThemeColor('charts.blue'));

      const md = new vscode.MarkdownString(undefined, true);
      md.appendMarkdown(`**Agendamentos (Schedules) — ${profile.name}**\n\n`);
      md.appendMarkdown(`- **Servidor:** \`${profile.baseUrl}\`\n`);
      md.appendMarkdown(`- Expanda para listar os jobs agendados no JasperServer.\n`);
      this.tooltip = md;
    } else if (kind === 'job' && job) {
      this.id = `scheduleJob:${profile.id}:${job.id}`;
      this.description = `${job.outputFormat} • ${job.reportUnitUri}`;
      this.contextValue = 'scheduleJob';
      this.iconPath = new vscode.ThemeIcon('tasklist', new vscode.ThemeColor('charts.blue'));

      const md = new vscode.MarkdownString(undefined, true);
      md.supportHtml = true;
      if (options.highlightedMarkdownLabel) {
        md.appendMarkdown(`**${options.highlightedMarkdownLabel.value}**\n\n`);
      } else {
        md.appendMarkdown(`**Job: ${job.name}** (#${job.id})\n\n`);
      }
      md.appendMarkdown(`- **Report Unit:** \`${job.reportUnitUri}\`\n`);
      md.appendMarkdown(`- **Formato de Saída:** \`${job.outputFormat}\`\n`);
      if (job.description) {
        md.appendMarkdown(`- **Descrição:** ${job.description}\n`);
      }
      md.appendMarkdown(`- **Triggers:** ${job.triggers.length}\n`);
      md.appendMarkdown(`- **Parâmetros:** ${job.parameters.length}\n`);
      md.appendMarkdown(
        `- **Atualizado em:** ${formatTimestampInTimezone(job.updatedAt, DEFAULT_TIMEZONE)} (${DEFAULT_TIMEZONE})\n`
      );
      this.tooltip = md;
    } else if (kind === 'trigger' && trigger) {
      this.id = `scheduleTrigger:${profile.id}:${trigger.jobId}:${trigger.id}`;
      const tz = trigger.timezone || DEFAULT_TIMEZONE;
      const nextRunFormatted = trigger.nextFireTime
        ? formatTimestampInTimezone(trigger.nextFireTime, tz)
        : undefined;
      this.description = nextRunFormatted ? `Próx: ${nextRunFormatted} (${tz})` : tz;
      this.contextValue = `scheduleTrigger;state=${trigger.state}`;

      if (trigger.state === 'NORMAL') {
        this.iconPath = new vscode.ThemeIcon('watch', new vscode.ThemeColor('charts.green'));
      } else if (trigger.state === 'PAUSED') {
        this.iconPath = new vscode.ThemeIcon(
          'debug-pause',
          new vscode.ThemeColor('charts.yellow')
        );
      } else if (trigger.state === 'ERROR') {
        this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      } else {
        this.iconPath = new vscode.ThemeIcon('clock');
      }

      const md = new vscode.MarkdownString(undefined, true);
      md.appendMarkdown(`**Trigger #${trigger.id}** (${trigger.type})\n\n`);
      md.appendMarkdown(`- **Estado:** \`${trigger.state}\` (${getTriggerStateDisplay(trigger.state)})\n`);
      if (trigger.cronExpression) {
        md.appendMarkdown(`- **Expressão Cron:** \`${trigger.cronExpression}\`\n`);
      }
      if (trigger.calendarName) {
        md.appendMarkdown(`- **Calendário:** \`${trigger.calendarName}\`\n`);
      }
      if (trigger.repeatInterval !== undefined) {
        md.appendMarkdown(`- **Intervalo:** ${trigger.repeatInterval} ms\n`);
      }
      md.appendMarkdown(`- **Timezone:** \`${tz}\`\n`);
      md.appendMarkdown(
        `- **Início:** ${formatTimestampInTimezone(trigger.startTime, tz)}\n`
      );
      if (trigger.endTime) {
        md.appendMarkdown(`- **Fim:** ${formatTimestampInTimezone(trigger.endTime, tz)}\n`);
      }
      if (nextRunFormatted) {
        md.appendMarkdown(`- **Próxima Execução:** ${nextRunFormatted}\n`);
      }
      this.tooltip = md;
    } else if (kind === 'execution' && execution) {
      this.id = `scheduleExecution:${profile.id}:${execution.jobId}:${execution.id}`;
      const duration = formatExecutionDuration(execution.startTime, execution.endTime);
      this.description = duration
        ? `${execution.status} (${duration})`
        : execution.status;
      this.contextValue = `scheduleExecution;status=${execution.status}`;

      if (execution.status === 'SUCCESS') {
        this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
      } else if (execution.status === 'FAILED') {
        this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      } else if (execution.status === 'RUNNING') {
        this.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
      } else {
        this.iconPath = new vscode.ThemeIcon('circle-slash');
      }

      const md = new vscode.MarkdownString(undefined, true);
      md.appendMarkdown(`**Execução #${execution.id}** — \`${execution.status}\`\n\n`);
      md.appendMarkdown(
        `- **Início:** ${formatTimestampInTimezone(execution.startTime, DEFAULT_TIMEZONE)} (${DEFAULT_TIMEZONE})\n`
      );
      if (execution.endTime) {
        md.appendMarkdown(
          `- **Fim:** ${formatTimestampInTimezone(execution.endTime, DEFAULT_TIMEZONE)}${duration ? ` (${duration})` : ''}\n`
        );
      }
      if (execution.outputResource) {
        md.appendMarkdown(`- **Output:** \`${execution.outputResource.uri}\`\n`);
      }
      if (execution.errorMessage) {
        md.appendMarkdown(`\n**Erro:**\n\`\`\`\n${execution.errorMessage}\n\`\`\`\n`);
      }
      this.tooltip = md;
    } else if (kind === 'createAction') {
      this.id = `scheduleCreateAction:${profile.id}`;
      this.contextValue = 'scheduleCreateAction';
      this.iconPath = new vscode.ThemeIcon('add', new vscode.ThemeColor('charts.green'));
      this.tooltip = 'Criar um novo agendamento de relatório no JasperServer (Ctrl+N)';
      this.command = {
        command: 'jasper.createScheduleJob',
        title: 'Criar Novo Agendamento',
        arguments: [this]
      };
    }
  }
}

export class SchedulerTreeProvider
  implements vscode.TreeDataProvider<SchedulerTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SchedulerTreeItem | undefined | null | void
  >();
  public readonly onDidChangeTreeData: vscode.Event<
    SchedulerTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private readonly serverChangeListener: vscode.Disposable;
  private treeView?: vscode.TreeView<SchedulerTreeItem>;

  /**
   * Cache em memória por servidor para busca 100% client-side (Ctrl+F).
   */
  private readonly jobsByServerCache = new Map<string, ReportJob[]>();
  private readonly expandedRoots = new Set<string>();
  private readonly expandedJobs = new Set<string>();
  private readonly itemIndex = new Map<string, SchedulerTreeItem>();

  private activeSearchQuery = '';
  private lastCopiedJobPayload?: SchedulerClipboardJobPayload;

  constructor(
    private readonly serverManager: ServerManager,
    private readonly schedulerService: JasperServerSchedulerService,
    private readonly outputChannel?: vscode.OutputChannel
  ) {
    this.serverChangeListener = this.serverManager.onDidChangeServers(() => {
      this.syncConnectedContext();
      this.refresh(undefined, false);
    });
    this.syncConnectedContext();
  }

  public dispose(): void {
    this.serverChangeListener.dispose();
    this._onDidChangeTreeData.dispose();
  }

  private syncConnectedContext(): void {
    void vscode.commands.executeCommand('setContext', 'jasperServerConnected', true);
  }

  public bindTreeView(treeView: vscode.TreeView<SchedulerTreeItem>): vscode.Disposable {
    this.treeView = treeView;
    this.updateHeaderMessage();

    const expandSub = treeView.onDidExpandElement((e) => {
      if (e.element.kind === 'schedulesRoot') {
        this.expandedRoots.add(e.element.profile.id);
      } else if (e.element.kind === 'job' && e.element.job) {
        this.expandedJobs.add(`${e.element.profile.id}:${e.element.job.id}`);
      }
    });

    const collapseSub = treeView.onDidCollapseElement((e) => {
      if (e.element.kind === 'schedulesRoot') {
        this.expandedRoots.delete(e.element.profile.id);
      } else if (e.element.kind === 'job' && e.element.job) {
        this.expandedJobs.delete(`${e.element.profile.id}:${e.element.job.id}`);
      }
    });

    return vscode.Disposable.from(expandSub, collapseSub);
  }

  public getTreeView(): vscode.TreeView<SchedulerTreeItem> | undefined {
    return this.treeView;
  }

  public refresh(element?: SchedulerTreeItem, invalidateServiceCache = true): void {
    if (invalidateServiceCache) {
      if (element?.profile) {
        this.schedulerService.invalidateCache(element.profile.id);
        this.jobsByServerCache.delete(element.profile.id);
      } else {
        this.schedulerService.invalidateCache();
        this.jobsByServerCache.clear();
      }
    }
    this.updateHeaderMessage();
    this._onDidChangeTreeData.fire(element);
  }

  // =========================================================================
  // Busca Client-Side (Integração com ServerSearchController / Ctrl+F)
  // =========================================================================

  public applySearchFilter(query: string): number {
    this.activeSearchQuery = query.trim();
    const lower = this.activeSearchQuery.toLowerCase();

    let matchCount = 0;
    if (lower) {
      for (const jobs of this.jobsByServerCache.values()) {
        for (const job of jobs) {
          if (this.matchesJobQuery(job, lower)) {
            matchCount++;
          }
        }
      }
    }

    void vscode.commands.executeCommand(
      'setContext',
      'jasper.scheduleSearchActive',
      Boolean(this.activeSearchQuery)
    );
    this.updateHeaderMessage(matchCount);
    this._onDidChangeTreeData.fire();
    return matchCount;
  }

  public clearSearchFilter(): void {
    this.activeSearchQuery = '';
    void vscode.commands.executeCommand('setContext', 'jasper.scheduleSearchActive', false);
    this.updateHeaderMessage();
    this._onDidChangeTreeData.fire();
  }

  public openClientSideSearch(): void {
    const quickPick = vscode.window.createQuickPick<
      vscode.QuickPickItem & { job?: ReportJob; profileId?: string }
    >();
    quickPick.title = 'Buscar Agendamentos no JasperServer (Client-Side)';
    quickPick.placeholder =
      'Digite o nome do job, Report Unit, formato ou expressão Cron — ESC para limpar';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.value = this.activeSearchQuery;

    const refreshItems = (query: string) => {
      const lower = query.trim().toLowerCase();
      const items: Array<vscode.QuickPickItem & { job?: ReportJob; profileId?: string }> = [];

      for (const [profileId, jobs] of this.jobsByServerCache.entries()) {
        for (const job of jobs) {
          if (!lower || this.matchesJobQuery(job, lower)) {
            items.push({
              label: `$(tasklist) ${job.name}`,
              description: `[${job.outputFormat}] ${job.reportUnitUri}`,
              detail:
                job.triggers.length > 0
                  ? job.triggers.map((t) => formatTriggerLabel(t)).join(' | ')
                  : job.description || 'Sem triggers configurados',
              alwaysShow: true,
              job,
              profileId
            });
          }
        }
      }

      if (items.length === 0) {
        quickPick.items = [
          {
            label: '$(info) Nenhum agendamento correspondente em memória',
            description: 'Expanda a pasta "Schedules" para carregar os agendamentos do servidor',
            alwaysShow: true
          }
        ];
      } else {
        quickPick.items = items;
      }
    };

    refreshItems(this.activeSearchQuery);

    let accepted = false;
    quickPick.onDidChangeValue((value) => {
      this.applySearchFilter(value);
      refreshItems(value);
    });

    quickPick.onDidAccept(async () => {
      accepted = true;
      const selected = quickPick.selectedItems[0];
      quickPick.hide();

      if (selected?.job && selected.profileId && this.treeView) {
        const treeItem = this.itemIndex.get(`scheduleJob:${selected.profileId}:${selected.job.id}`);
        if (treeItem) {
          try {
            await this.treeView.reveal(treeItem, {
              select: true,
              focus: true,
              expand: true
            });
          } catch {
            // Ignora se view oculta
          }
        }
      }
    });

    quickPick.onDidHide(() => {
      if (!accepted) {
        this.clearSearchFilter();
      }
      quickPick.dispose();
    });

    quickPick.show();
  }

  private matchesJobQuery(job: ReportJob, lowerQuery: string): boolean {
    if (!lowerQuery) {
      return true;
    }
    const tokens = lowerQuery.split(/\s+/).filter(Boolean);
    const haystack = [
      job.name,
      job.description || '',
      job.reportUnitUri,
      job.outputFormat,
      ...job.triggers.map((t) => `${t.type} ${t.cronExpression || ''} ${t.calendarName || ''}`)
    ]
      .join(' ')
      .toLowerCase();

    return tokens.every((tok) => haystack.includes(tok));
  }

  // =========================================================================
  // Clipboard (Ctrl+C / Ctrl+V para duplicar Jobs)
  // =========================================================================

  public async copyJobToClipboard(item?: SchedulerTreeItem): Promise<void> {
    const targetItem = item ?? this.treeView?.selection[0];
    if (!targetItem || targetItem.kind !== 'job' || !targetItem.job) {
      void vscode.window.showWarningMessage(
        'Selecione um Agendamento (Job) na árvore para copiar.'
      );
      return;
    }

    const job = targetItem.job;
    const payload: SchedulerClipboardJobPayload = {
      type: 'jasperScheduleJob',
      serverId: targetItem.profile.id,
      job: {
        name: `${job.name} (Cópia)`,
        description: job.description,
        reportUnitUri: job.reportUnitUri,
        outputFormat: job.outputFormat,
        parameters: job.parameters,
        triggers: job.triggers
      }
    };

    this.lastCopiedJobPayload = payload;
    await vscode.env.clipboard.writeText(JSON.stringify(payload));
    vscode.window.setStatusBarMessage(
      `$(copy) Agendamento "${job.name}" copiado (use Ctrl+V em Agendamentos para duplicar).`,
      4000
    );
  }

  public async pasteJobFromClipboard(targetItem?: SchedulerTreeItem): Promise<ReportJob | undefined> {
    let payload = this.lastCopiedJobPayload;
    if (!payload) {
      try {
        const text = await vscode.env.clipboard.readText();
        if (text && text.trim().startsWith('{')) {
          const parsed = JSON.parse(text);
          if (parsed && parsed.type === 'jasperScheduleJob' && parsed.job) {
            payload = parsed as SchedulerClipboardJobPayload;
          }
        }
      } catch {
        // Ignora
      }
    }

    if (!payload) {
      void vscode.window.showWarningMessage(
        'Nenhum agendamento copiado na área de transferência para duplicar.'
      );
      return undefined;
    }

    const profile =
      targetItem?.profile ??
      this.serverManager.getProfileById(payload.serverId) ??
      (await this.serverManager.getActiveProfile());

    if (!profile) {
      void vscode.window.showWarningMessage(
        'Nenhum servidor JasperServer ativo para colar o agendamento.'
      );
      return undefined;
    }

    const created = await this.schedulerService.createJob(
      {
        name: payload.job.name,
        description: payload.job.description,
        reportUnitUri: payload.job.reportUnitUri,
        outputFormat: payload.job.outputFormat,
        parameters: payload.job.parameters || []
      },
      profile
    );

    for (const trig of payload.job.triggers || []) {
      await this.schedulerService.createTrigger(
        created.id,
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
        profile
      );
    }

    this.refresh(undefined, true);
    void vscode.window.showInformationMessage(
      `Agendamento "${created.name}" duplicado com sucesso!`
    );
    return created;
  }

  private updateHeaderMessage(matchCount?: number): void {
    if (!this.treeView) {
      return;
    }
    if (this.activeSearchQuery) {
      this.treeView.message = `$(search) Filtro: "${this.activeSearchQuery}" (${matchCount ?? 0} job(s))`;
    } else {
      this.treeView.message = undefined;
    }
  }

  // =========================================================================
  // TreeDataProvider Implementation
  // =========================================================================

  public getTreeItem(element: SchedulerTreeItem): vscode.TreeItem {
    return element;
  }

  public getParent(element: SchedulerTreeItem): vscode.ProviderResult<SchedulerTreeItem> {
    if (element.kind === 'schedulesRoot') {
      return undefined;
    }
    if (element.kind === 'job' || element.kind === 'createAction') {
      return this.itemIndex.get(`schedulesRoot:${element.profile.id}`);
    }
    if (element.kind === 'trigger' && element.trigger) {
      return this.itemIndex.get(`scheduleJob:${element.profile.id}:${element.trigger.jobId}`);
    }
    if (element.kind === 'execution' && element.execution) {
      return this.itemIndex.get(`scheduleJob:${element.profile.id}:${element.execution.jobId}`);
    }
    return undefined;
  }

  public async getChildren(element?: SchedulerTreeItem): Promise<SchedulerTreeItem[]> {
    // Raiz: retorna a pasta "Schedules" para o servidor ativo (ou todos os servidores)
    if (!element) {
      const activeProfile = await this.serverManager.getActiveProfile();
      const profiles = activeProfile ? [activeProfile] : this.serverManager.getProfiles();

      if (profiles.length === 0) {
        return [];
      }

      return profiles.map((profile) => {
        const shouldExpand =
          this.expandedRoots.has(profile.id) || Boolean(this.activeSearchQuery);
        const rootItem = new SchedulerTreeItem({
          kind: 'schedulesRoot',
          profile,
          collapsibleState: shouldExpand
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed
        });
        this.itemIndex.set(`schedulesRoot:${profile.id}`, rootItem);
        return rootItem;
      });
    }

    // Lazy Loading: ao expandir a pasta "Schedules", carrega os jobs do servidor
    if (element.kind === 'schedulesRoot') {
      const profile = element.profile;
      let jobs = this.jobsByServerCache.get(profile.id);

      if (!jobs) {
        try {
          jobs = await this.schedulerService.listJobs(
            { limit: 50, offset: 0 },
            profile
          );
          this.jobsByServerCache.set(profile.id, jobs);
        } catch (error) {
          const errMessage =
            error instanceof Error ? error.message : 'Falha ao carregar agendamentos.';
          if (this.outputChannel) {
            this.outputChannel.appendLine(
              `[JasperServer Scheduler] Erro ao listar jobs em "${profile.name}": ${errMessage}`
            );
          }
          void vscode.window.showErrorMessage(
            `[${profile.name}] Erro ao carregar agendamentos: ${errMessage}`
          );
          jobs = [];
        }
      }

      const lowerQuery = this.activeSearchQuery.toLowerCase();
      const visibleJobs = lowerQuery
        ? jobs.filter((job) => this.matchesJobQuery(job, lowerQuery))
        : jobs;

      const jobItems = visibleJobs.map((job) => {
        const rawLabel = `Job: "${job.name}"`;
        const highlightRanges = this.activeSearchQuery
          ? ServerSearchController.computeHighlightRanges(rawLabel, this.activeSearchQuery)
          : undefined;
        const highlightedMarkdownLabel = this.activeSearchQuery
          ? ServerSearchController.highlightWithMark(rawLabel, this.activeSearchQuery)
          : undefined;

        const isExpanded =
          this.expandedJobs.has(`${profile.id}:${job.id}`) ||
          Boolean(this.activeSearchQuery);

        const jobItem = new SchedulerTreeItem({
          kind: 'job',
          profile,
          job,
          collapsibleState: isExpanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed,
          highlightRanges,
          highlightedMarkdownLabel
        });
        this.itemIndex.set(`scheduleJob:${profile.id}:${job.id}`, jobItem);
        return jobItem;
      });

      const createActionItem = new SchedulerTreeItem({
        kind: 'createAction',
        profile
      });

      return [...jobItems, createActionItem];
    }

    // Filhos de um Job: lista de Triggers + Última execução
    if (element.kind === 'job' && element.job) {
      const { profile, job } = element;
      const children: SchedulerTreeItem[] = [];

      let triggers = job.triggers || [];
      if (triggers.length === 0 && !this.activeSearchQuery) {
        try {
          triggers = await this.schedulerService.listTriggers(job.id, profile);
          job.triggers = triggers;
        } catch {
          // Mantém lista vazia
        }
      }

      for (const trigger of triggers) {
        const triggerItem = new SchedulerTreeItem({
          kind: 'trigger',
          profile,
          job,
          trigger
        });
        this.itemIndex.set(
          `scheduleTrigger:${profile.id}:${job.id}:${trigger.id}`,
          triggerItem
        );
        children.push(triggerItem);
      }

      let lastExecution = job.lastExecution;
      if (!lastExecution && !this.activeSearchQuery) {
        try {
          const recentExecs = await this.schedulerService.listExecutions(
            job.id,
            1,
            0,
            profile
          );
          if (recentExecs.length > 0) {
            lastExecution = recentExecs[0];
            job.lastExecution = lastExecution;
          }
        } catch {
          // Ignora caso servidor não retorne execuções anteriores
        }
      }

      if (lastExecution) {
        const execItem = new SchedulerTreeItem({
          kind: 'execution',
          profile,
          job,
          execution: lastExecution
        });
        this.itemIndex.set(
          `scheduleExecution:${profile.id}:${job.id}:${lastExecution.id}`,
          execItem
        );
        children.push(execItem);
      }

      return children;
    }

    return [];
  }
}
