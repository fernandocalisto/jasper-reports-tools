import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { DatabaseProfile, DatabaseProfileInput, getDefaultPort } from '../models/database';

const PROFILES_STORAGE_KEY = 'jasper_db_profiles';
const ACTIVE_PROFILE_KEY = 'jasper_active_db_profile_id';
const SECRET_PREFIX = 'jasper_db_secret_';

export class ConnectionManager implements vscode.Disposable {
  private readonly _onDidChangeConnections = new vscode.EventEmitter<void>();
  public readonly onDidChangeConnections: vscode.Event<void> = this._onDidChangeConnections.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public dispose(): void {
    this._onDidChangeConnections.dispose();
  }

  private getSecretKey(profileId: string): string {
    return `${SECRET_PREFIX}${profileId}`;
  }

  /**
   * Retorna todos os perfis de conexão salvos no globalState.
   */
  public getProfiles(): DatabaseProfile[] {
    return this.context.globalState.get<DatabaseProfile[]>(PROFILES_STORAGE_KEY, []);
  }

  /**
   * Busca um perfil específico pelo ID.
   */
  public getProfileById(id: string): DatabaseProfile | undefined {
    return this.getProfiles().find((profile) => profile.id === id);
  }

  /**
   * Recupera a senha armazenada de forma segura no SecretStorage do VS Code.
   */
  public async getPassword(profileId: string): Promise<string | undefined> {
    return this.context.secrets.get(this.getSecretKey(profileId));
  }

  /**
   * Cria ou atualiza um perfil de conexão.
   * Metadados vão para globalState e a senha vai exclusivamente para o SecretStorage.
   */
  public async saveProfile(input: DatabaseProfileInput, password?: string): Promise<DatabaseProfile> {
    const profiles = [...this.getProfiles()];
    const now = Date.now();
    const normalizedPort = input.port ?? getDefaultPort(input.driver);

    let savedProfile: DatabaseProfile;
    const existingIndex = input.id ? profiles.findIndex((p) => p.id === input.id) : -1;

    if (existingIndex >= 0) {
      const existing = profiles[existingIndex];
      savedProfile = {
        ...existing,
        name: input.name.trim(),
        driver: input.driver,
        host: input.host?.trim() || undefined,
        port: normalizedPort,
        database: input.database?.trim() || undefined,
        user: input.user?.trim() || undefined,
        customDriverPath: input.driver === 'custom' ? input.customDriverPath?.trim() || undefined : undefined,
        customDriverClass: input.driver === 'custom' ? input.customDriverClass?.trim() || undefined : undefined,
        jdbcUrl: input.jdbcUrl?.trim() || undefined,
        updatedAt: now
      };
      profiles[existingIndex] = savedProfile;
    } else {
      const id = input.id || crypto.randomUUID();
      savedProfile = {
        id,
        name: input.name.trim(),
        driver: input.driver,
        host: input.host?.trim() || undefined,
        port: normalizedPort,
        database: input.database?.trim() || undefined,
        user: input.user?.trim() || undefined,
        customDriverPath: input.driver === 'custom' ? input.customDriverPath?.trim() || undefined : undefined,
        customDriverClass: input.driver === 'custom' ? input.customDriverClass?.trim() || undefined : undefined,
        jdbcUrl: input.jdbcUrl?.trim() || undefined,
        createdAt: now,
        updatedAt: now
      };
      profiles.push(savedProfile);
    }

    await this.context.globalState.update(PROFILES_STORAGE_KEY, profiles);

    if (password !== undefined) {
      if (password.length > 0) {
        await this.context.secrets.store(this.getSecretKey(savedProfile.id), password);
      } else if (existingIndex < 0) {
        await this.context.secrets.delete(this.getSecretKey(savedProfile.id));
      }
    }

    // Se for a primeira conexão cadastrada e não houver ativa, define-a como ativa automaticamente
    const activeId = this.getActiveProfileId();
    if (!activeId || !profiles.some((p) => p.id === activeId)) {
      await this.updateActiveProfileState(savedProfile.id);
    }

    this._onDidChangeConnections.fire();
    return savedProfile;
  }

  /**
   * Remove o perfil do globalState e exclui o segredo associado do SecretStorage.
   */
  public async deleteProfile(id: string): Promise<void> {
    const profiles = this.getProfiles().filter((profile) => profile.id !== id);
    await this.context.globalState.update(PROFILES_STORAGE_KEY, profiles);
    await this.context.secrets.delete(this.getSecretKey(id));

    const activeId = this.getActiveProfileId();
    if (activeId === id) {
      const nextActiveId = profiles.length > 0 ? profiles[0].id : undefined;
      await this.updateActiveProfileState(nextActiveId);
    }

    this._onDidChangeConnections.fire();
  }

  /**
   * Obtém o ID da conexão ativa no workspace atual (ou globalState como fallback).
   */
  public getActiveProfileId(): string | undefined {
    const workspaceActiveId = this.context.workspaceState.get<string>(ACTIVE_PROFILE_KEY);
    if (workspaceActiveId) {
      return workspaceActiveId;
    }
    return this.context.globalState.get<string>(ACTIVE_PROFILE_KEY);
  }

  /**
   * Retorna o perfil de conexão atualmente ativo.
   */
  public async getActiveProfile(): Promise<DatabaseProfile | undefined> {
    const activeId = this.getActiveProfileId();
    if (!activeId) {
      return undefined;
    }
    return this.getProfileById(activeId);
  }

  /**
   * Define o perfil informado como a conexão ativa para relatórios.
   */
  public async setActiveProfile(id: string): Promise<void> {
    const profile = this.getProfileById(id);
    if (!profile) {
      throw new Error(`Perfil de conexão não encontrado (ID: ${id}).`);
    }
    await this.updateActiveProfileState(id);
    this._onDidChangeConnections.fire();
  }

  private async updateActiveProfileState(id: string | undefined): Promise<void> {
    await this.context.workspaceState.update(ACTIVE_PROFILE_KEY, id);
    await this.context.globalState.update(ACTIVE_PROFILE_KEY, id);
  }
}
