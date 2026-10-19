import * as path from 'path';
import * as crypto from 'crypto';
import {
  JasperServerProfile,
  RepositoryResource,
  RepositoryResourceType,
  ServerInfoResult,
  normalizeBaseUrl
} from '../models/jasperserver';
import type { ServerManager } from './serverManager';

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

function encodeResourceUri(uri: string): string {
  const normalized = uri.startsWith('/') ? uri : `/${uri}`;
  return normalized
    .split('/')
    .map((segment) => (segment ? encodeURIComponent(segment) : ''))
    .join('/');
}

function mapResourceType(rawType?: string, uri?: string, label?: string): RepositoryResourceType {
  const lowerType = (rawType || '').toLowerCase();
  const candidateName = `${uri || ''} ${label || ''}`.toLowerCase();

  if (lowerType === 'folder') {
    return 'folder';
  }
  if (lowerType === 'reportunit') {
    return 'reportUnit';
  }
  if (lowerType === 'jrxml') {
    return 'jrxml';
  }
  if (lowerType === 'jasper') {
    return 'jasper';
  }
  if (lowerType.includes('datasource')) {
    return 'datasource';
  }
  if (lowerType === 'file' || lowerType === 'other' || !lowerType) {
    if (candidateName.endsWith('.jrxml') || candidateName.includes('.jrxml')) {
      return 'jrxml';
    }
    if (candidateName.endsWith('.jasper') || candidateName.includes('.jasper')) {
      return 'jasper';
    }
  }
  return 'other';
}

function extractParentFolderUri(uri: string, fallbackFolderUri: string): string {
  if (!uri || uri === '/') {
    return '/';
  }
  const normalized = uri.startsWith('/') ? uri : `/${uri}`;
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) {
    return '/';
  }
  return normalized.slice(0, lastSlash) || fallbackFolderUri || '/';
}

function extractCookiesFromHeaders(headers: Headers): string | undefined {
  let setCookieList: string[] = [];

  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') {
    setCookieList = anyHeaders.getSetCookie();
  } else {
    const raw = headers.get('set-cookie');
    if (raw) {
      setCookieList = raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
    }
  }

  if (setCookieList.length === 0) {
    return undefined;
  }

  const cookieMap = new Map<string, string>();
  for (const rawCookie of setCookieList) {
    const firstPart = rawCookie.split(';')[0]?.trim();
    if (!firstPart) {
      continue;
    }
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const name = firstPart.slice(0, eqIdx).trim();
      const val = firstPart.slice(eqIdx + 1).trim();
      cookieMap.set(name, val);
    }
  }

  if (cookieMap.size === 0) {
    return undefined;
  }

  const pairs: string[] = [];
  if (cookieMap.has('JSESSIONID')) {
    pairs.push(`JSESSIONID=${cookieMap.get('JSESSIONID')}`);
  }
  for (const [k, v] of cookieMap.entries()) {
    if (k !== 'JSESSIONID') {
      pairs.push(`${k}=${v}`);
    }
  }

  return pairs.join('; ');
}

function isServerManagerLike(obj: unknown): obj is ServerManager {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as ServerManager).getActiveProfile === 'function' &&
    typeof (obj as ServerManager).getPassword === 'function'
  );
}

export class JasperServerClient {
  private readonly sessionCookies = new Map<string, string>();
  private readonly serverManager?: ServerManager;
  private defaultProfile?: JasperServerProfile;
  private defaultPassword?: string;

  constructor(
    serverManagerOrProfile?: ServerManager | JasperServerProfile,
    defaultPassword?: string
  ) {
    if (isServerManagerLike(serverManagerOrProfile)) {
      this.serverManager = serverManagerOrProfile;
    } else if (serverManagerOrProfile) {
      this.defaultProfile = serverManagerOrProfile;
      this.defaultPassword = defaultPassword;
    }
  }

  public setDefaultCredentials(profile: JasperServerProfile, password?: string): void {
    this.defaultProfile = profile;
    this.defaultPassword = password;
  }

  public clearSession(profileId?: string): void {
    if (!profileId) {
      this.sessionCookies.clear();
      return;
    }
    for (const key of this.sessionCookies.keys()) {
      if (key.startsWith(`${profileId}:`)) {
        this.sessionCookies.delete(key);
      }
    }
  }

  private getSessionKey(profile: JasperServerProfile): string {
    const base = normalizeBaseUrl(profile.baseUrl);
    return `${profile.id || 'temp'}:${base}:${profile.username}:${profile.organization || ''}`;
  }

  private async resolveCredentials(
    profile?: JasperServerProfile,
    password?: string
  ): Promise<{ profile: JasperServerProfile; password: string }> {
    const resolvedProfile =
      profile ??
      this.defaultProfile ??
      (this.serverManager ? await this.serverManager.getActiveProfile() : undefined);

    if (!resolvedProfile) {
      throw new Error(
        'Nenhum servidor JasperServer selecionado ou ativo. Configure ou selecione um servidor primeiro.'
      );
    }

    let resolvedPassword = password;
    if (resolvedPassword === undefined) {
      if (this.defaultPassword !== undefined && resolvedProfile.id === this.defaultProfile?.id) {
        resolvedPassword = this.defaultPassword;
      } else if (this.serverManager && resolvedProfile.id) {
        resolvedPassword = await this.serverManager.getPassword(resolvedProfile.id);
      }
    }

    return {
      profile: resolvedProfile,
      password: resolvedPassword ?? ''
    };
  }

  /**
   * Realiza autenticação via POST /rest_v2/login (application/x-www-form-urlencoded)
   * e armazena o cookie JSESSIONID em memória.
   */
  public async login(profile?: JasperServerProfile, password?: string): Promise<string> {
    const creds = await this.resolveCredentials(profile, password);
    const targetProfile = creds.profile;
    const baseUrl = normalizeBaseUrl(targetProfile.baseUrl);
    const loginUrl = `${baseUrl}/rest_v2/login`;

    const loginUsername =
      targetProfile.organization &&
      targetProfile.organization.trim().length > 0 &&
      !targetProfile.username.includes('|')
        ? `${targetProfile.username.trim()}|${targetProfile.organization.trim()}`
        : targetProfile.username.trim();

    const body = new URLSearchParams({
      j_username: loginUsername,
      j_password: creds.password
    }).toString();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_HTTP_TIMEOUT_MS);

    try {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json, text/plain, */*'
        },
        body,
        redirect: 'manual',
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'Autenticação recusada pelo JasperServer (HTTP 401/403). Verifique usuário, organização e senha.'
        );
      }

      const location = response.headers.get('location') || '';
      if (
        (response.status === 301 || response.status === 302 || response.status === 303) &&
        location.toLowerCase().includes('login') &&
        location.toLowerCase().includes('error')
      ) {
        throw new Error(
          'Falha de login no JasperServer: credenciais inválidas.'
        );
      }

      if (response.status >= 400) {
        throw new Error(
          `Falha ao autenticar no JasperServer (HTTP ${response.status} ${response.statusText}). Verifique a URL Base.`
        );
      }

      const cookieHeader = extractCookiesFromHeaders(response.headers) || '';
      const sessionKey = this.getSessionKey(targetProfile);
      this.sessionCookies.set(sessionKey, cookieHeader);
      return cookieHeader;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Tempo limite excedido ao tentar conectar em "${baseUrl}". Verifique se o servidor está acessível.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Executa uma requisição autenticada contra o JasperServer, tratando expiração de sessão (401)
   * com re-login automático transparente.
   */
  private async requestWithAuth(
    relativePath: string,
    init: RequestInit = {},
    profile?: JasperServerProfile,
    password?: string
  ): Promise<Response> {
    const creds = await this.resolveCredentials(profile, password);
    const targetProfile = creds.profile;
    const baseUrl = normalizeBaseUrl(targetProfile.baseUrl);
    const sessionKey = this.getSessionKey(targetProfile);

    let sessionCookie = this.sessionCookies.get(sessionKey);
    if (sessionCookie === undefined) {
      sessionCookie = await this.login(targetProfile, creds.password);
    }

    const executeFetch = async (cookieStr: string): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_HTTP_TIMEOUT_MS);

      const headers = new Headers(init.headers || {});
      if (cookieStr) {
        headers.set('Cookie', cookieStr);
      } else {
        // Fallback para Basic Auth caso o servidor não tenha retornado Set-Cookie no /rest_v2/login
        const loginUser =
          targetProfile.organization &&
          targetProfile.organization.trim().length > 0 &&
          !targetProfile.username.includes('|')
            ? `${targetProfile.username.trim()}|${targetProfile.organization.trim()}`
            : targetProfile.username.trim();
        const encodedBasic = Buffer.from(`${loginUser}:${creds.password}`, 'utf8').toString(
          'base64'
        );
        headers.set('Authorization', `Basic ${encodedBasic}`);
      }

      try {
        return await fetch(`${baseUrl}${relativePath}`, {
          ...init,
          headers,
          signal: controller.signal
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`Tempo limite excedido na requisição para "${baseUrl}${relativePath}".`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };

    let response = await executeFetch(sessionCookie);

    // Re-login automático transparente em caso de sessão expirada (401)
    if (response.status === 401) {
      this.sessionCookies.delete(sessionKey);
      const freshCookie = await this.login(targetProfile, creds.password);
      response = await executeFetch(freshCookie);
    }

    return response;
  }

  /**
   * Testa a conexão autenticando e consultando GET /rest_v2/serverInfo.
   */
  public async testConnection(
    profile?: JasperServerProfile,
    password?: string
  ): Promise<ServerInfoResult> {
    const creds = await this.resolveCredentials(profile, password);
    const targetProfile = creds.profile;

    // Força novo login para validar as credenciais atuais
    await this.login(targetProfile, creds.password);

    const response = await this.requestWithAuth(
      '/rest_v2/serverInfo',
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      },
      targetProfile,
      creds.password
    );

    if (!response.ok) {
      throw new Error(
        `Falha ao consultar /rest_v2/serverInfo (HTTP ${response.status} ${response.statusText}).`
      );
    }

    const rawText = await response.text();
    let version = 'Desconhecida';
    let edition: string | undefined;
    let build: string | undefined;

    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object') {
        version = parsed.version || parsed.serverInfo?.version || version;
        edition = parsed.edition || parsed.serverInfo?.edition;
        build = parsed.build || parsed.serverInfo?.build;
      }
    } catch {
      const verMatch = /<version>([^<]+)<\/version>/i.exec(rawText);
      if (verMatch) {
        version = verMatch[1].trim();
      }
    }

    const displayUser = targetProfile.organization
      ? `${targetProfile.username}|${targetProfile.organization}`
      : targetProfile.username;

    return {
      version,
      user: displayUser,
      edition,
      build
    };
  }

  /**
   * Lista recursos e pastas não-recursivamente a partir de folderUri.
   * GET /rest_v2/resources?folderUri=...&recursive=false
   */
  public async listResources(
    folderUri = '/',
    profile?: JasperServerProfile,
    password?: string
  ): Promise<RepositoryResource[]> {
    const normalizedFolder =
      !folderUri || folderUri.trim() === ''
        ? '/'
        : folderUri.startsWith('/')
        ? folderUri
        : `/${folderUri}`;

    const query = new URLSearchParams({
      folderUri: normalizedFolder,
      recursive: 'false'
    }).toString();

    const response = await this.requestWithAuth(
      `/rest_v2/resources?${query}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      },
      profile,
      password
    );

    if (response.status === 204) {
      return [];
    }

    if (!response.ok) {
      const errorDetail = await this.extractErrorMessage(response);
      throw new Error(
        `Erro ao listar recursos em "${normalizedFolder}" (HTTP ${response.status}): ${errorDetail}`
      );
    }

    const rawText = await response.text();
    if (!rawText || !rawText.trim()) {
      return [];
    }

    let items: any[] = [];
    try {
      const parsed = JSON.parse(rawText);
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (parsed && Array.isArray(parsed.resourceLookup)) {
        items = parsed.resourceLookup;
      } else if (parsed && parsed.resourceLookup && typeof parsed.resourceLookup === 'object') {
        items = [parsed.resourceLookup];
      }
    } catch {
      throw new Error('Resposta inválida da API /rest_v2/resources (JSON esperado).');
    }

    const resources: RepositoryResource[] = items
      .filter((item) => item && typeof item.uri === 'string')
      .map((item) => {
        const uri: string = item.uri;
        const name: string = item.label || path.posix.basename(uri) || uri;
        const resourceType = mapResourceType(item.resourceType, uri, name);
        const parentFolderUri = extractParentFolderUri(uri, normalizedFolder);

        return {
          uri,
          name,
          resourceType,
          description: item.description || undefined,
          version: typeof item.version === 'number' ? item.version : undefined,
          parentFolderUri
        };
      });

    return resources.sort((a, b) => {
      if (a.resourceType === 'folder' && b.resourceType !== 'folder') {
        return -1;
      }
      if (a.resourceType !== 'folder' && b.resourceType === 'folder') {
        return 1;
      }
      return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    });
  }

  /**
   * Faz download do conteúdo XML bruto de um recurso (.jrxml ou reportUnit).
   * GET /rest_v2/resources{uri}?file=jrxml
   */
  public async downloadResource(
    uri: string,
    profile?: JasperServerProfile,
    password?: string
  ): Promise<string> {
    const encodedUri = encodeResourceUri(uri);
    const acceptHeader = 'application/jrxml, application/xml, text/xml, text/plain, */*';

    let response = await this.requestWithAuth(
      `/rest_v2/resources${encodedUri}?file=jrxml`,
      {
        method: 'GET',
        headers: {
          Accept: acceptHeader
        }
      },
      profile,
      password
    );

    // Caso o recurso seja um arquivo direto ou reportUnit cujo JRXML principal está em _files/main_jrxml
    if (response.status === 400 || response.status === 404) {
      const directResponse = await this.requestWithAuth(
        `/rest_v2/resources${encodedUri}`,
        {
          method: 'GET',
          headers: {
            Accept: acceptHeader
          }
        },
        profile,
        password
      );
      if (directResponse.ok) {
        response = directResponse;
      }
    }

    if (!response.ok) {
      const errorDetail = await this.extractErrorMessage(response);
      throw new Error(
        `Erro ao baixar recurso "${uri}" (HTTP ${response.status}): ${errorDetail}`
      );
    }

    const content = await response.text();

    // Se a resposta vier como descritor de reportUnit JSON/XML com referência ao main_jrxml, baixa o arquivo interno
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || (trimmed.startsWith('<reportUnit') && !trimmed.includes('<jasperReport'))) {
      const mainJrxmlUri = `${uri.replace(/\/+$/, '')}_files/main_jrxml`;
      const mainResponse = await this.requestWithAuth(
        `/rest_v2/resources${encodeResourceUri(mainJrxmlUri)}`,
        {
          method: 'GET',
          headers: {
            Accept: acceptHeader
          }
        },
        profile,
        password
      );
      if (mainResponse.ok) {
        return await mainResponse.text();
      }
    }

    return content;
  }

  /**
   * Realiza upload/atualização de um recurso (.jrxml ou .jasper) no JasperServer.
   * PUT /rest_v2/resources{uri} com multipart/form-data (ou fallback para descritor repository.file+json).
   */
  public async uploadResource(
    folderUri: string,
    fileName: string,
    content: string | Buffer,
    resourceType: 'jrxml' | 'jasper',
    profile?: JasperServerProfile,
    password?: string
  ): Promise<void> {
    const cleanFolder =
      !folderUri || folderUri.trim() === '' || folderUri.trim() === '/'
        ? ''
        : (folderUri.startsWith('/') ? folderUri : `/${folderUri}`).replace(/\/+$/, '');
    const cleanFileName = fileName.replace(/^\/+/, '');
    const targetUri = cleanFolder.endsWith(`/${cleanFileName}`)
      ? cleanFolder
      : `${cleanFolder}/${cleanFileName}`;
    const encodedTargetUri = encodeResourceUri(targetUri);

    const fileBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const boundary = `----JasperToolsBoundary${crypto.randomBytes(12).toString('hex')}`;
    const descriptorJson = JSON.stringify({
      version: 0,
      permissionMask: 1,
      uri: targetUri,
      label: cleanFileName,
      description: cleanFileName,
      type: resourceType === 'jrxml' ? 'jrxml' : 'file'
    });

    const contentMime =
      resourceType === 'jrxml' ? 'application/jrxml' : 'application/octet-stream';

    const preamble = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="resource"\r\n` +
        `Content-Type: application/repository.file+json; charset=UTF-8\r\n\r\n` +
        `${descriptorJson}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="content"; filename="${cleanFileName}"\r\n` +
        `Content-Type: ${contentMime}\r\n\r\n`,
      'utf8'
    );
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const multipartBody = Buffer.concat([preamble, fileBuffer, epilogue]);

    let response = await this.requestWithAuth(
      `/rest_v2/resources${encodedTargetUri}?overwrite=true&createFolders=true`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          Accept: 'application/json'
        },
        body: multipartBody
      },
      profile,
      password
    );

    // Fallback para descritor JSON base64 caso a instância do JasperServer rejeite multipart em arquivo direto
    if (response.status === 400 || response.status === 415) {
      const jsonDescriptorBody = JSON.stringify({
        version: 0,
        permissionMask: 1,
        uri: targetUri,
        label: cleanFileName,
        description: cleanFileName,
        type: resourceType === 'jrxml' ? 'jrxml' : 'file',
        content: fileBuffer.toString('base64')
      });

      response = await this.requestWithAuth(
        `/rest_v2/resources${encodedTargetUri}?overwrite=true&createFolders=true`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/repository.file+json',
            Accept: 'application/json'
          },
          body: jsonDescriptorBody
        },
        profile,
        password
      );
    }

    if (!response.ok) {
      const errorDetail = await this.extractErrorMessage(response);
      throw new Error(
        `Erro ao enviar recurso "${targetUri}" para o JasperServer (HTTP ${response.status}): ${errorDetail}`
      );
    }
  }

  /**
   * Remove um recurso no JasperServer via DELETE /rest_v2/resources{uri}.
   */
  public async deleteResource(
    uri: string,
    profile?: JasperServerProfile,
    password?: string
  ): Promise<void> {
    const encodedUri = encodeResourceUri(uri);
    const response = await this.requestWithAuth(
      `/rest_v2/resources${encodedUri}`,
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/json'
        }
      },
      profile,
      password
    );

    if (!response.ok) {
      const errorDetail = await this.extractErrorMessage(response);
      throw new Error(
        `Erro ao excluir recurso "${uri}" no JasperServer (HTTP ${response.status}): ${errorDetail}`
      );
    }
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    try {
      const text = await response.text();
      if (!text || !text.trim()) {
        return response.statusText || `HTTP ${response.status}`;
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.message === 'string') {
          return parsed.message;
        }
        if (parsed && typeof parsed.errorCode === 'string') {
          return parsed.errorCode;
        }
      } catch {
        // Não é JSON
      }
      return text.trim().slice(0, 300);
    } catch {
      return response.statusText || `HTTP ${response.status}`;
    }
  }
}
