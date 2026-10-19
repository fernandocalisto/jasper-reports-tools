import * as vscode from 'vscode';
import * as crypto from 'crypto';
import {
  JasperServerProfile,
  JasperServerProfileInput,
  normalizeBaseUrl
} from '../models/jasperserver';

const PROFILES_STORAGE_KEY = 'jasper_server_profiles';
const ACTIVE_PROFILE_KEY = 'jasper_active_server_profile_id';
const SECRET_PREFIX = 'jasper_server_secret_';
const DOWNLOADED_MAPPINGS_KEY = 'jasper_server_downloaded_mappings';

export interface DownloadedReportOrigin {
  serverId: string;
  resourceUri: string;
  parentFolderUri: string;
  resourceName: string;
  resourceType: 'reportUnit' | 'jrxml' | 'jasper' | 'other';
}

export class ServerManager implements vscode.Disposable {
  private readonly _onDidChangeServers = new vscode.EventEmitter<void>();
  public readonly onDidChangeServers: vscode.Event<void> = this._onDidChangeServers.event;

  private readonly memoryOrigins = new Map<string, DownloadedReportOrigin>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  public dispose(): void {
    this._onDidChangeServers.dispose();
  }

  private getSecretKey(profileId: string): string {
    return `${SECRET_PREFIX}${profileId}`;
  }

  /**
   * Retorna todos os perfis de servidor JasperServer salvos no globalState.
   */
  public getProfiles(): JasperServerProfile[] {
    return this.context.globalState.get<JasperServerProfile[]>(PROFILES_STORAGE_KEY, []);
  }

  /**
   * Busca um perfil específico de servidor pelo ID.
   */
  public getProfileById(id: string): JasperServerProfile | undefined {
    return this.getProfiles().find((profile) => profile.id === id);
  }

  /**
   * Recupera a senha armazenada exclusivamente no SecretStorage do VS Code.
   */
  public async getPassword(profileId: string): Promise<string | undefined> {
    return this.context.secrets.get(this.getSecretKey(profileId));
  }

  /**
   * Cria ou atualiza um perfil de servidor JasperServer.
   * Metadados vão para globalState e a senha vai exclusivamente para o SecretStorage.
   */
  public async saveProfile(
    input: JasperServerProfileInput,
    password?: string
  ): Promise<JasperServerProfile> {
    const profiles = [...this.getProfiles()];
    const now = Date.now();
    const cleanedBaseUrl = normalizeBaseUrl(input.baseUrl);
    const cleanedOrg = input.organization?.trim() || undefined;

    let savedProfile: JasperServerProfile;
    const existingIndex = input.id ? profiles.findIndex((p) => p.id === input.id) : -1;

    if (existingIndex >= 0) {
      const existing = profiles[existingIndex];
      savedProfile = {
        ...existing,
        name: input.name.trim(),
        baseUrl: cleanedBaseUrl,
        organization: cleanedOrg,
        username: input.username.trim(),
        updatedAt: now
      };
      profiles[existingIndex] = savedProfile;
    } else {
      const id = input.id || crypto.randomUUID();
      savedProfile = {
        id,
        name: input.name.trim(),
        baseUrl: cleanedBaseUrl,
        organization: cleanedOrg,
        username: input.username.trim(),
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

    // Se for o primeiro servidor cadastrado e não houver ativo, define-o como ativo automaticamente
    const activeId = this.getActiveProfileId();
    if (!activeId || !profiles.some((p) => p.id === activeId)) {
      await this.updateActiveProfileState(savedProfile.id);
    }

    this._onDidChangeServers.fire();
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

    this._onDidChangeServers.fire();
  }

  /**
   * Obtém o ID do servidor ativo no workspace atual (ou globalState como fallback).
   */
  public getActiveProfileId(): string | undefined {
    const workspaceActiveId = this.context.workspaceState.get<string>(ACTIVE_PROFILE_KEY);
    if (workspaceActiveId) {
      return workspaceActiveId;
    }
    return this.context.globalState.get<string>(ACTIVE_PROFILE_KEY);
  }

  /**
   * Retorna o perfil de servidor atualmente ativo.
   */
  public async getActiveProfile(): Promise<JasperServerProfile | undefined> {
    const activeId = this.getActiveProfileId();
    if (!activeId) {
      return undefined;
    }
    return this.getProfileById(activeId);
  }

  /**
   * Define o perfil informado como o servidor ativo.
   */
  public async setActiveProfile(id: string): Promise<void> {
    const profile = this.getProfileById(id);
    if (!profile) {
      throw new Error(`Perfil de servidor não encontrado (ID: ${id}).`);
    }
    await this.updateActiveProfileState(id);
    this._onDidChangeServers.fire();
  }

  /**
   * Registra a origem de um arquivo baixado do JasperServer para facilitar deploy subsequente.
   */
  public async registerDownloadedOrigin(
    localFilePath: string,
    origin: DownloadedReportOrigin
  ): Promise<void> {
    const normalizedKey = localFilePath.toLowerCase();
    this.memoryOrigins.set(normalizedKey, origin);
    const stored = this.context.workspaceState.get<Record<string, DownloadedReportOrigin>>(
      DOWNLOADED_MAPPINGS_KEY,
      {}
    );
    stored[normalizedKey] = origin;
    await this.context.workspaceState.update(DOWNLOADED_MAPPINGS_KEY, stored);
  }

  /**
   * Recupera a origem associada a um arquivo local baixado do JasperServer.
   */
  public getDownloadedOrigin(localFilePath: string): DownloadedReportOrigin | undefined {
    const normalizedKey = localFilePath.toLowerCase();
    if (this.memoryOrigins.has(normalizedKey)) {
      return this.memoryOrigins.get(normalizedKey);
    }
    const stored = this.context.workspaceState.get<Record<string, DownloadedReportOrigin>>(
      DOWNLOADED_MAPPINGS_KEY,
      {}
    );
    return stored[normalizedKey];
  }

  private async updateActiveProfileState(id: string | undefined): Promise<void> {
    await this.context.workspaceState.update(ACTIVE_PROFILE_KEY, id);
    await this.context.globalState.update(ACTIVE_PROFILE_KEY, id);
  }
}
