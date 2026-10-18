import * as vscode from 'vscode';
import {
  DatabaseProfile,
  formatConnectionSummary,
  getDefaultPort
} from '../models/database';
import { ConnectionManager } from '../services/connectionManager';
import { RunnerCliError, RunnerService } from '../services/runnerService';
import { DatabaseTreeItem } from '../providers/databaseTreeProvider';
import {
  ConnectionTestResult,
  DatabaseFormPanel,
  WebviewConnectionPayload
} from '../webviewPanels/databaseFormPanel';

interface ProfileQuickPickItem extends vscode.QuickPickItem {
  profile?: DatabaseProfile;
  action?: 'add';
}

function resolveProfileArgument(
  connectionManager: ConnectionManager,
  arg?: DatabaseTreeItem | DatabaseProfile | string
): DatabaseProfile | undefined {
  if (!arg) {
    return undefined;
  }
  if (typeof arg === 'string') {
    return connectionManager.getProfileById(arg);
  }
  if (arg instanceof DatabaseTreeItem) {
    return arg.profile;
  }
  if (typeof arg === 'object' && 'id' in arg && 'driver' in arg) {
    return arg;
  }
  return undefined;
}

async function promptForProfile(
  connectionManager: ConnectionManager,
  placeHolder: string,
  includeAddOption = false
): Promise<DatabaseProfile | 'add' | undefined> {
  const profiles = connectionManager.getProfiles();
  const activeId = connectionManager.getActiveProfileId();

  if (profiles.length === 0 && !includeAddOption) {
    const action = await vscode.window.showInformationMessage(
      'Nenhuma conexão de banco de dados cadastrada.',
      'Adicionar Conexão'
    );
    if (action === 'Adicionar Conexão') {
      await vscode.commands.executeCommand('jasper.addConnection');
    }
    return undefined;
  }

  const items: ProfileQuickPickItem[] = profiles.map((profile) => {
    const isActive = profile.id === activeId;
    return {
      label: `${isActive ? '$(check) ' : '$(database) '}${profile.name}`,
      description: formatConnectionSummary(profile),
      detail: isActive ? 'Conexão Ativa' : undefined,
      profile
    };
  });

  if (includeAddOption) {
    items.push({
      label: '$(add) Adicionar Nova Conexão...',
      description: 'Criar um novo perfil de banco de dados',
      alwaysShow: true,
      action: 'add'
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder,
    matchOnDescription: true
  });

  if (!selected) {
    return undefined;
  }
  if (selected.action === 'add') {
    return 'add';
  }
  return selected.profile;
}

export async function executeConnectionTest(
  context: vscode.ExtensionContext,
  connectionManager: ConnectionManager,
  profile: DatabaseProfile,
  explicitPassword?: string,
  runnerService?: RunnerService,
  outputChannel?: vscode.OutputChannel
): Promise<ConnectionTestResult> {
  const password =
    explicitPassword !== undefined && explicitPassword.length > 0
      ? explicitPassword
      : profile.id
      ? await connectionManager.getPassword(profile.id)
      : undefined;

  const runner = runnerService ?? new RunnerService(context);

  try {
    const response = await runner.testConnection(profile, password);
    const ms =
      typeof response.metadata?.latencyMs === 'number'
        ? response.metadata.latencyMs
        : response.executionTimeMs;
    const dbProduct = response.metadata?.databaseProductName
      ? ` - ${response.metadata.databaseProductName}`
      : '';

    if (outputChannel) {
      outputChannel.appendLine(
        `[Jasper] Teste de conexão "${profile.name}" bem-sucedido (${ms}ms)${dbProduct}.`
      );
    }

    return {
      success: true,
      message: `Conexão estabelecida com sucesso! (${ms}ms)`
    };
  } catch (error) {
    const errMessage =
      error instanceof Error ? error.message : 'Falha ao conectar ao banco de dados.';
    if (outputChannel) {
      outputChannel.appendLine(`[Jasper] Erro ao testar conexão "${profile.name}": ${errMessage}`);
      if (error instanceof RunnerCliError && error.stackTraceSnippet) {
        outputChannel.appendLine(error.stackTraceSnippet);
      }
    }
    return {
      success: false,
      message: errMessage
    };
  }
}

export function registerConnectionCommands(
  context: vscode.ExtensionContext,
  connectionManager: ConnectionManager,
  runnerService?: RunnerService,
  outputChannel?: vscode.OutputChannel
): vscode.Disposable[] {
  const runner = runnerService ?? new RunnerService(context);

  const testCallback = async (payload: WebviewConnectionPayload): Promise<ConnectionTestResult> => {
    const tempProfile: DatabaseProfile = {
      id: payload.id || '',
      name: payload.name || 'Teste',
      driver: payload.driver,
      host: payload.host,
      port: payload.port ?? getDefaultPort(payload.driver),
      database: payload.database,
      user: payload.user,
      customDriverPath: payload.customDriverPath,
      customDriverClass: payload.customDriverClass,
      jdbcUrl: payload.jdbcUrl,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Jasper: Testando conexão com ${tempProfile.host || tempProfile.name}...`,
        cancellable: false
      },
      async () =>
        executeConnectionTest(
          context,
          connectionManager,
          tempProfile,
          payload.password,
          runner,
          outputChannel
        )
    );

    if (result.success) {
      void vscode.window.showInformationMessage(result.message);
    } else {
      void vscode.window.showErrorMessage(`Falha na conexão: ${result.message}`);
    }

    return result;
  };

  const addConnectionCmd = vscode.commands.registerCommand('jasper.addConnection', () => {
    DatabaseFormPanel.createOrShow(context, connectionManager, undefined, testCallback);
  });

  const editConnectionCmd = vscode.commands.registerCommand(
    'jasper.editConnection',
    async (arg?: DatabaseTreeItem | DatabaseProfile | string) => {
      let profile = resolveProfileArgument(connectionManager, arg);
      if (!profile) {
        const picked = await promptForProfile(
          connectionManager,
          'Selecione a conexão que deseja editar'
        );
        if (!picked || picked === 'add') {
          return;
        }
        profile = picked;
      }

      DatabaseFormPanel.createOrShow(context, connectionManager, profile, testCallback);
    }
  );

  const deleteConnectionCmd = vscode.commands.registerCommand(
    'jasper.deleteConnection',
    async (arg?: DatabaseTreeItem | DatabaseProfile | string) => {
      let profile = resolveProfileArgument(connectionManager, arg);
      if (!profile) {
        const picked = await promptForProfile(
          connectionManager,
          'Selecione a conexão que deseja excluir'
        );
        if (!picked || picked === 'add') {
          return;
        }
        profile = picked;
      }

      const confirmation = await vscode.window.showWarningMessage(
        `Tem certeza que deseja excluir a conexão "${profile.name}"? A senha associada também será removida do SecretStorage.`,
        { modal: true },
        'Excluir'
      );

      if (confirmation === 'Excluir') {
        await connectionManager.deleteProfile(profile.id);
        void vscode.window.showInformationMessage(`Conexão "${profile.name}" excluída.`);
      }
    }
  );

  const setActiveConnectionCmd = vscode.commands.registerCommand(
    'jasper.setActiveConnection',
    async (arg?: DatabaseTreeItem | DatabaseProfile | string) => {
      let profile = resolveProfileArgument(connectionManager, arg);

      if (!profile) {
        const picked = await promptForProfile(
          connectionManager,
          'Selecione a conexão de banco de dados ativa para os relatórios Jasper',
          true
        );
        if (!picked) {
          return;
        }
        if (picked === 'add') {
          await vscode.commands.executeCommand('jasper.addConnection');
          return;
        }
        profile = picked;
      }

      await connectionManager.setActiveProfile(profile.id);
      void vscode.window.showInformationMessage(
        `Conexão ativa definida para: ${profile.name}`
      );
    }
  );

  const testConnectionCmd = vscode.commands.registerCommand(
    'jasper.testConnection',
    async (arg?: DatabaseTreeItem | DatabaseProfile | string) => {
      let profile = resolveProfileArgument(connectionManager, arg);
      if (!profile) {
        const picked = await promptForProfile(
          connectionManager,
          'Selecione a conexão que deseja testar'
        );
        if (!picked || picked === 'add') {
          return;
        }
        profile = picked;
      }

      const targetProfile = profile;
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Jasper: Testando conexão "${targetProfile.name}"...`,
          cancellable: false
        },
        async () =>
          executeConnectionTest(
            context,
            connectionManager,
            targetProfile,
            undefined,
            runner,
            outputChannel
          )
      );

      if (result.success) {
        void vscode.window.showInformationMessage(
          `[${targetProfile.name}] ${result.message}`
        );
      } else {
        void vscode.window.showErrorMessage(
          `[${targetProfile.name}] Falha na conexão: ${result.message}`
        );
      }
    }
  );

  return [
    addConnectionCmd,
    editConnectionCmd,
    deleteConnectionCmd,
    setActiveConnectionCmd,
    testConnectionCmd
  ];
}
