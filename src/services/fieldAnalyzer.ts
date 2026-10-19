import * as path from 'path';
import { ConnectionManager } from './connectionManager';
import { JrxmlField, JrxmlParser, jrxmlParser as defaultParser, TextDocumentLike } from './jrxmlParser';
import { InspectQueryColumn, RunnerService } from './runnerService';

export interface AnalyzedField {
  name: string;
  javaClass: string;
  jdbcType: string;
  nullable: 'YES' | 'NO' | 'UNKNOWN' | '-';
  description?: string;
  source: 'jrxml' | 'jdbc' | 'both';
  xmlDeclaredClass?: string;
  jdbcSuggestedClass?: string;
  expression: string;
}

export interface FieldAnalysisResult {
  reportName: string;
  reportPath: string;
  queryString?: string;
  connectionName: string | null;
  inspectedWithDb: boolean;
  executionTimeMs?: number;
  fields: AnalyzedField[];
}

export function formatJdbcType(col: InspectQueryColumn): string {
  const baseType = (col.jdbcType || 'OTHER').toUpperCase();
  const precision = col.precision ?? 0;
  const scale = col.scale ?? 0;

  if (
    ['VARCHAR', 'CHAR', 'NVARCHAR', 'NCHAR'].includes(baseType) &&
    precision > 0 &&
    precision <= 65535
  ) {
    return `${baseType}(${precision})`;
  }

  if (['DECIMAL', 'NUMERIC'].includes(baseType) && precision > 0 && precision <= 100) {
    return scale > 0 ? `${baseType}(${precision},${scale})` : `${baseType}(${precision})`;
  }

  return baseType;
}

export function formatNullable(nullableCode?: number): 'YES' | 'NO' | 'UNKNOWN' | '-' {
  if (nullableCode === 0) {
    return 'NO';
  }
  if (nullableCode === 1) {
    return 'YES';
  }
  if (nullableCode === 2) {
    return 'UNKNOWN';
  }
  return '-';
}

export class FieldAnalyzer {
  private readonly parser: JrxmlParser;

  constructor(
    private readonly runnerService: RunnerService,
    private readonly connectionManager: ConnectionManager,
    parser: JrxmlParser = defaultParser
  ) {
    this.parser = parser;
  }

  /**
   * Analisa estaticamente os `<field>` e `<queryString>` do relatório `.jrxml`.
   */
  public async analyzeStatic(
    reportPath: string,
    document?: TextDocumentLike
  ): Promise<FieldAnalysisResult> {
    const metadata = document
      ? this.parser.getMetadata(document)
      : this.parser.getMetadata(reportPath);
    const activeProfile = await this.connectionManager.getActiveProfile();

    const fields: AnalyzedField[] = metadata.fields.map((f: JrxmlField) => ({
      name: f.name,
      javaClass: f.className,
      jdbcType: '-',
      nullable: '-',
      description: f.description,
      source: 'jrxml',
      xmlDeclaredClass: f.className,
      expression: `$F{${f.name}}`
    }));

    return {
      reportName: path.basename(reportPath),
      reportPath,
      queryString: metadata.queryString,
      connectionName: activeProfile?.name ?? null,
      inspectedWithDb: false,
      fields
    };
  }

  /**
   * Executa a introspecção da query SQL no banco de dados ativo (`--action inspect-query`)
   * e mescla os metadados JDBC reais com os `<field>` declarados no `.jrxml`.
   */
  public async analyzeDatabase(
    reportPath: string,
    document?: TextDocumentLike,
    params?: Record<string, any>
  ): Promise<FieldAnalysisResult> {
    const metadata = document
      ? this.parser.getMetadata(document)
      : this.parser.getMetadata(reportPath);

    const activeProfile = await this.connectionManager.getActiveProfile();
    if (!activeProfile) {
      throw new Error(
        'Nenhuma conexão de banco de dados ativa. Selecione ou cadastre uma conexão na barra lateral JasperReports.'
      );
    }

    if (!metadata.queryString || metadata.queryString.trim().length === 0) {
      throw new Error(
        'O relatório atual não possui uma tag <queryString> com consulta SQL para analisar no banco.'
      );
    }

    const password = await this.connectionManager.getPassword(activeProfile.id);

    const cliResponse = await this.runnerService.inspectQuery({
      reportPath,
      dbProfile: activeProfile,
      password,
      params
    });

    const columns: InspectQueryColumn[] =
      cliResponse.columns ??
      (Array.isArray(cliResponse.metadata?.columns) ? cliResponse.metadata.columns : []);

    const fields = this.mergeFieldsAndColumns(metadata.fields, columns);

    return {
      reportName: path.basename(reportPath),
      reportPath,
      queryString: metadata.queryString,
      connectionName: activeProfile.name,
      inspectedWithDb: true,
      executionTimeMs: cliResponse.executionTimeMs,
      fields
    };
  }

  private mergeFieldsAndColumns(
    jrxmlFields: JrxmlField[],
    jdbcColumns: InspectQueryColumn[]
  ): AnalyzedField[] {
    const result: AnalyzedField[] = [];
    const colMap = new Map<string, InspectQueryColumn>();

    for (const col of jdbcColumns) {
      if (col && col.name) {
        colMap.set(col.name.toLowerCase(), col);
      }
    }

    const matchedColKeys = new Set<string>();

    for (const field of jrxmlFields) {
      const key = field.name.toLowerCase();
      const col = colMap.get(key);

      if (col) {
        matchedColKeys.add(key);
        result.push({
          name: field.name,
          javaClass: field.className || col.javaClass || 'java.lang.String',
          jdbcType: formatJdbcType(col),
          nullable: formatNullable(col.nullable),
          description: field.description,
          source: 'both',
          xmlDeclaredClass: field.className,
          jdbcSuggestedClass: col.javaClass,
          expression: `$F{${field.name}}`
        });
      } else {
        result.push({
          name: field.name,
          javaClass: field.className,
          jdbcType: '-',
          nullable: '-',
          description: field.description,
          source: 'jrxml',
          xmlDeclaredClass: field.className,
          expression: `$F{${field.name}}`
        });
      }
    }

    for (const col of jdbcColumns) {
      if (!col || !col.name) {
        continue;
      }
      const key = col.name.toLowerCase();
      if (matchedColKeys.has(key)) {
        continue;
      }

      const javaClass = col.javaClass || 'java.lang.Object';
      result.push({
        name: col.name,
        javaClass,
        jdbcType: formatJdbcType(col),
        nullable: formatNullable(col.nullable),
        source: 'jdbc',
        jdbcSuggestedClass: javaClass,
        expression: `$F{${col.name}}`
      });
    }

    return result;
  }
}
