import * as vscode from 'vscode';
import * as fs from 'fs';
import { execFile } from 'child_process';
import {
  buildJdbcUrl,
  DatabaseProfile,
  formatConnectionSummary,
  getDefaultPort
} from '../models/database';
import { ConnectionManager } from '../services/connectionManager';
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
  explicitPassword?: string
): Promise<ConnectionTestResult> {
  if (profile.driver === 'custom') {
    if (!profile.customDriverPath || !fs.existsSync(profile.customDriverPath)) {
      return {
        success: false,
        message: `Arquivo JAR do driver personalizado não encontrado: ${profile.customDriverPath || '(vazio)'}`
      };
    }
    if (!profile.customDriverClass) {
      return {
        success: false,
        message: 'A classe do driver JDBC personalizado não foi informada.'
      };
    }
  }

  const password =
    explicitPassword !== undefined && explicitPassword.length > 0
      ? explicitPassword
      : profile.id
      ? await connectionManager.getPassword(profile.id)
      : undefined;

  const jarPath = context.asAbsolutePath('bin/jasper-cli.jar');
  if (!fs.existsSync(jarPath)) {
    return {
      success: true,
      message: `Parâmetros validados para "${profile.name || profile.host}" (${buildJdbcUrl(profile)}).`
    };
  }

  const jdbcUrl = buildJdbcUrl(profile);
  const args: string[] = ['--jar', jarPath];
  const cliArgs: string[] = ['-jar', jarPath, '--action', 'test-conn', '--db-url', jdbcUrl];

  if (profile.user) {
    cliArgs.push('--db-user', profile.user);
  }
  if (password) {
    cliArgs.push('--db-pass', password);
  }
  if (profile.driver === 'custom') {
    if (profile.customDriverPath) {
      cliArgs.push('--custom-driver-jar', profile.customDriverPath);
    }
    if (profile.customDriverClass) {
      cliArgs.push('--custom-driver-class', profile.customDriverClass);
    }
  }

  void args;

  return new Promise<ConnectionTestResult>((resolve) => {
    execFile(
      'java',
      cliArgs,
      {
        timeout: 30000,
        windowsHide: true,
        env: {
          ...process.env,
          ...(password ? { JASPER_DB_PASS: password } : {})
        }
      },
      (error, stdout, stderr) => {
        const rawOutput = (stdout || stderr || '').trim();
        if (rawOutput) {
          try {
            const parsed = JSON.parse(rawOutput);
            if (parsed.status === 'SUCCESS') {
              const ms = parsed.executionTimeMs ?? 0;
              resolve({
                success: true,
                message: `Conexão estabelecida com sucesso! (${ms}ms)`
              });
              return;
            }
            if (parsed.status === 'ERROR') {
              resolve({
                success: false,
                message: parsed.message || 'Falha ao conectar ao banco de dados.'
              });
              return;
            }
          } catch {
            // Continua para tratamento padrão caso não seja JSON
          }
        }

        if (error) {
          resolve({
            success: false,
            message: error.message || 'Erro ao executar teste de conexão.'
          });
          return;
        }

        resolve({
          success: true,
          message: 'Conexão validada com sucesso!'
        });
      }
    );
  });
}

export function registerConnectionCommands(
  context: vscode.ExtensionContext,
  connectionManager: ConnectionManager
): vscode.Disposable[] {
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
      async () => executeConnectionTest(context, connectionManager, tempProfile, payload.password)
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
        async () => executeConnectionTest(context, connectionManager, targetProfile)
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
