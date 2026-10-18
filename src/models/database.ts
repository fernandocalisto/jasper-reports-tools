export type SupportedDriver = 'postgres' | 'oracle' | 'custom';

export interface DatabaseProfile {
  id: string;                      // Identificador único (UUID)
  name: string;                    // Nome amigável (ex: 'Docker Local', 'Hospital Prod')
  driver: SupportedDriver;         // 'postgres' | 'oracle' | 'custom'
  host?: string;                   // Host do banco
  port?: number;                   // Porta (padrão 5432 p/ postgres, 1521 p/ oracle)
  database?: string;               // Database, SID ou Service Name
  user?: string;                   // Usuário
  customDriverPath?: string;       // Caminho absoluto para o .jar customizado
  customDriverClass?: string;      // Nome da classe (ex: com.microsoft.sqlserver.jdbc.SQLServerDriver)
  jdbcUrl?: string;                // URL JDBC customizada opcional
  createdAt: number;
  updatedAt: number;
}

export interface DatabaseProfileInput {
  id?: string;
  name: string;
  driver: SupportedDriver;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  customDriverPath?: string;
  customDriverClass?: string;
  jdbcUrl?: string;
}

export function getDefaultPort(driver: SupportedDriver): number | undefined {
  switch (driver) {
    case 'postgres':
      return 5432;
    case 'oracle':
      return 1521;
    default:
      return undefined;
  }
}

export function formatConnectionSummary(profile: DatabaseProfile): string {
  const userPrefix = profile.user ? `${profile.user}@` : '';
  const host = profile.host || 'localhost';
  const port = profile.port ?? getDefaultPort(profile.driver);
  const portSegment = port ? `:${port}` : '';
  const dbSegment = profile.database ? `/${profile.database}` : '';
  return `${userPrefix}${host}${portSegment}${dbSegment}`;
}

export function buildJdbcUrl(profile: DatabaseProfile): string {
  if (profile.jdbcUrl && profile.jdbcUrl.trim().length > 0) {
    return profile.jdbcUrl.trim();
  }

  const host = profile.host || 'localhost';
  const database = profile.database || '';

  switch (profile.driver) {
    case 'postgres': {
      const port = profile.port || 5432;
      return `jdbc:postgresql://${host}:${port}/${database}`;
    }
    case 'oracle': {
      const port = profile.port || 1521;
      if (database.startsWith('/')) {
        return `jdbc:oracle:thin:@//${host}:${port}${database}`;
      }
      return `jdbc:oracle:thin:@${host}:${port}:${database}`;
    }
    case 'custom': {
      const portSegment = profile.port ? `:${profile.port}` : '';
      const dbSegment = database ? `/${database}` : '';
      return `jdbc:custom://${host}${portSegment}${dbSegment}`;
    }
  }
}
