export interface JasperServerProfile {
  id: string;                      // UUID
  name: string;                    // Nome amigável (ex: 'Homologação', 'Produção')
  baseUrl: string;                 // Ex: 'http://servidor:8080/jasperserver'
  organization?: string;           // Organização (para JasperServer Pro/Enterprise), ex: 'organization_1'
  username: string;
  // Senha armazenada APENAS em SecretStorage: chave 'jasper_server_secret_${id}'
  createdAt: number;
  updatedAt: number;
}

export interface JasperServerProfileInput {
  id?: string;
  name: string;
  baseUrl: string;
  organization?: string;
  username: string;
}

export type RepositoryResourceType =
  | 'folder'
  | 'reportUnit'
  | 'jrxml'
  | 'jasper'
  | 'datasource'
  | 'other';

export interface RepositoryResource {
  uri: string;                     // URI completo no repositório (ex: '/reports/hospitalar/Atendimento.jrxml')
  name: string;                    // Nome do arquivo
  resourceType: RepositoryResourceType;
  description?: string;
  version?: number;
  parentFolderUri: string;
}

export interface ServerInfoResult {
  version: string;
  user: string;
  edition?: string;
  build?: string;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function formatServerSummary(profile: JasperServerProfile): string {
  const userPrefix = profile.username
    ? profile.organization
      ? `${profile.username}|${profile.organization}@`
      : `${profile.username}@`
    : '';

  try {
    const parsed = new URL(profile.baseUrl);
    const pathSegment = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return `${userPrefix}${parsed.host}${pathSegment}`;
  } catch {
    return `${userPrefix}${profile.baseUrl}`;
  }
}
