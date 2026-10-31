import * as fs from 'fs';

export interface JrxmlParameterCondition {
  parameter: string;
  value?: any;
  values?: any[];
  operator?: 'eq' | 'neq' | 'in' | 'notEmpty';
  severity?: 'error' | 'warning';
}

export interface JrxmlParameter {
  name: string;
  className: string;
  defaultValue?: string;
  description?: string;
  isForPrompting?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  validValues?: string[];
  dependsOn?: string | JrxmlParameterCondition;
  conditional?: JrxmlParameterCondition;
  properties?: Record<string, string>;
}

export interface JrxmlField {
  name: string;
  className: string;
  description?: string;
}

export interface JrxmlVariable {
  name: string;
  className: string;
  description?: string;
  calculation?: string;
}

export interface JrxmlMetadata {
  parameters: JrxmlParameter[];
  fields: JrxmlField[];
  variables?: JrxmlVariable[];
  queryString?: string;
}

export interface TextDocumentLike {
  getText(): string;
  uri?: { fsPath: string };
}

const BUILTIN_PARAMETER_PREFIXES = ['REPORT_', 'JASPER_'];

const BUILTIN_PARAMETER_NAMES = new Set<string>([
  'SUBREPORT_DIR',
  'SORT_FIELDS',
  'FILTER',
  'IS_IGNORE_PAGINATION'
]);

/**
 * Verifica se o nome de parâmetro pertence aos parâmetros internos/embutidos do JasperReports.
 */
export function isBuiltInParameter(name: string): boolean {
  const normalized = name.trim().toUpperCase();
  if (!normalized) {
    return true;
  }
  if (BUILTIN_PARAMETER_NAMES.has(normalized)) {
    return true;
  }
  return BUILTIN_PARAMETER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Remove comentários XML (`<!-- ... -->`) preservando blocos `<![CDATA[...]]>`.
 */
function stripXmlComments(xml: string): string {
  const cdataPlaceholders: string[] = [];
  const withoutCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (match) => {
    const idx = cdataPlaceholders.length;
    cdataPlaceholders.push(match);
    return `__JRXML_CDATA_${idx}__`;
  });

  const withoutComments = withoutCdata.replace(/<!--[\s\S]*?-->/g, '');

  return withoutComments.replace(/__JRXML_CDATA_(\d+)__/g, (_, indexStr: string) => {
    return cdataPlaceholders[Number(indexStr)] ?? '';
  });
}

function unwrapCdataAndTrim(raw: string): string {
  const trimmed = raw.trim();
  const cdataMatch = /^<!\[CDATA\[([\s\S]*?)\]\]>$/i.exec(trimmed);
  if (cdataMatch) {
    return cdataMatch[1].trim();
  }
  return decodeXmlEntities(trimmed);
}

function normalizeDefaultValueExpression(rawExpression: string): string | undefined {
  const unwrapped = unwrapCdataAndTrim(rawExpression);
  if (!unwrapped || unwrapped === 'null') {
    return undefined;
  }

  if (unwrapped === 'Boolean.TRUE') {
    return 'true';
  }
  if (unwrapped === 'Boolean.FALSE') {
    return 'false';
  }

  // Caso seja literal de string simples entre aspas duplas (ex: "Maria Silva")
  const simpleStringMatch = /^"([^"\\]*)"$/.exec(unwrapped);
  if (simpleStringMatch) {
    return simpleStringMatch[1];
  }

  return unwrapped;
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const rawVal = match[2] !== undefined ? match[2] : match[3] || '';
    attrs[key] = decodeXmlEntities(rawVal);
  }
  return attrs;
}

function extractChildTagContent(body: string, tagName: string): string | undefined {
  const regex = new RegExp(
    `<(?:[a-zA-Z0-9_]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tagName}>`,
    'i'
  );
  const match = regex.exec(body);
  if (!match) {
    return undefined;
  }
  const text = unwrapCdataAndTrim(match[1]);
  return text.length > 0 ? text : undefined;
}

function extractParameterProperties(body: string): Record<string, string> {
  const props: Record<string, string> = {};
  const propRegex =
    /<(?:[a-zA-Z0-9_]+:)?property\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?property>)/gi;
  let match: RegExpExecArray | null;
  while ((match = propRegex.exec(body)) !== null) {
    const attrs = parseAttributes(match[1] || '');
    const propName = attrs.name?.trim();
    if (!propName) {
      continue;
    }
    const propVal =
      attrs.value !== undefined
        ? attrs.value
        : match[2] !== undefined
          ? unwrapCdataAndTrim(match[2])
          : '';
    props[propName] = propVal;
  }
  return props;
}

function parseConditionExpression(raw: string): JrxmlParameterCondition | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const neqIdx = trimmed.indexOf('!=');
  if (neqIdx > 0) {
    return {
      parameter: trimmed.slice(0, neqIdx).trim(),
      value: trimmed.slice(neqIdx + 2).trim(),
      operator: 'neq'
    };
  }
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx > 0) {
    const paramName = trimmed.slice(0, eqIdx).trim();
    const rhs = trimmed.slice(eqIdx + 1).trim();
    if (rhs.includes(',')) {
      return {
        parameter: paramName,
        values: rhs.split(',').map((s) => s.trim()).filter(Boolean),
        operator: 'in'
      };
    }
    return {
      parameter: paramName,
      value: rhs,
      operator: 'eq'
    };
  }
  return {
    parameter: trimmed,
    operator: 'notEmpty'
  };
}

/**
 * Remove blocos `<subDataset>...</subDataset>` do nível raiz para extrair apenas
 * os parâmetros, campos e query principais do relatório.
 */
function stripSubDatasets(xml: string): string {
  return xml.replace(
    /<(?:[a-zA-Z0-9_]+:)?subDataset\b[^>]*>[\s\S]*?<\/(?:[a-zA-Z0-9_]+:)?subDataset>/gi,
    ''
  );
}

/**
 * Realiza o parse estático de um conteúdo XML `.jrxml` extraindo parâmetros, campos e query SQL.
 */
export function parseJrxml(xmlContent: string): JrxmlMetadata {
  const cleanedXml = stripSubDatasets(stripXmlComments(xmlContent));

  const parameters: JrxmlParameter[] = [];
  const fields: JrxmlField[] = [];

  const paramRegex =
    /<(?:[a-zA-Z0-9_]+:)?parameter\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?parameter>)/gi;
  let paramMatch: RegExpExecArray | null;

  while ((paramMatch = paramRegex.exec(cleanedXml)) !== null) {
    const attrs = parseAttributes(paramMatch[1] || '');
    const rawName = attrs.name?.trim();
    if (!rawName || isBuiltInParameter(rawName)) {
      continue;
    }

    const className = attrs.class?.trim() || 'java.lang.String';
    const isForPrompting =
      attrs.isForPrompting !== undefined
        ? attrs.isForPrompting.trim().toLowerCase() !== 'false'
        : true;

    const body = paramMatch[2] || '';
    const rawDefaultExpr = extractChildTagContent(body, 'defaultValueExpression');
    const defaultValue =
      rawDefaultExpr !== undefined ? normalizeDefaultValueExpression(rawDefaultExpr) : undefined;
    const description = extractChildTagContent(body, 'parameterDescription');
    const properties = extractParameterProperties(body);

    const paramEntry: JrxmlParameter = {
      name: rawName,
      className,
      isForPrompting
    };

    if (defaultValue !== undefined) {
      paramEntry.defaultValue = defaultValue;
    }
    if (description !== undefined) {
      paramEntry.description = description;
    }
    if (Object.keys(properties).length > 0) {
      paramEntry.properties = properties;
    }

    const rawMin =
      attrs.min ??
      properties['min'] ??
      properties['validation.min'] ??
      properties['net.sf.jasperreports.validation.min'];
    if (rawMin !== undefined && rawMin.trim() !== '' && !Number.isNaN(Number(rawMin))) {
      paramEntry.min = Number(rawMin);
    }

    const rawMax =
      attrs.max ??
      properties['max'] ??
      properties['validation.max'] ??
      properties['net.sf.jasperreports.validation.max'];
    if (rawMax !== undefined && rawMax.trim() !== '' && !Number.isNaN(Number(rawMax))) {
      paramEntry.max = Number(rawMax);
    }

    const rawPattern =
      attrs.pattern ??
      properties['pattern'] ??
      properties['regex'] ??
      properties['validation.pattern'] ??
      properties['net.sf.jasperreports.validation.pattern'];
    if (rawPattern !== undefined && rawPattern.trim() !== '') {
      paramEntry.pattern = rawPattern.trim();
    }

    const rawValidValues =
      attrs.validValues ??
      attrs.enum ??
      attrs.allowedValues ??
      properties['validValues'] ??
      properties['enum'] ??
      properties['allowedValues'] ??
      properties['options'] ??
      properties['validation.enum'] ??
      properties['validation.validValues'] ??
      properties['net.sf.jasperreports.validation.enum'];
    if (rawValidValues !== undefined && rawValidValues.trim() !== '') {
      paramEntry.validValues = rawValidValues
        .split(/[|,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    const rawDependsOn =
      attrs.dependsOn ??
      attrs.requiredIf ??
      attrs.requiredWhen ??
      attrs.conditional ??
      properties['dependsOn'] ??
      properties['requiredIf'] ??
      properties['requiredWhen'] ??
      properties['conditional'] ??
      properties['validation.conditional'] ??
      properties['net.sf.jasperreports.validation.conditional'];
    if (rawDependsOn !== undefined && rawDependsOn.trim() !== '') {
      const parsedCond = parseConditionExpression(rawDependsOn);
      if (parsedCond) {
        paramEntry.dependsOn = rawDependsOn.trim();
        paramEntry.conditional = parsedCond;
      }
    }

    parameters.push(paramEntry);
  }

  const fieldRegex =
    /<(?:[a-zA-Z0-9_]+:)?field\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?field>)/gi;
  let fieldMatch: RegExpExecArray | null;

  while ((fieldMatch = fieldRegex.exec(cleanedXml)) !== null) {
    const attrs = parseAttributes(fieldMatch[1] || '');
    const rawName = attrs.name?.trim();
    if (!rawName) {
      continue;
    }

    const className = attrs.class?.trim() || 'java.lang.String';
    const body = fieldMatch[2] || '';
    const description = extractChildTagContent(body, 'fieldDescription');

    const fieldEntry: JrxmlField = {
      name: rawName,
      className
    };
    if (description !== undefined) {
      fieldEntry.description = description;
    }

    fields.push(fieldEntry);
  }

  const variables: JrxmlVariable[] = [
    { name: 'PAGE_NUMBER', className: 'java.lang.Integer', description: 'Número da página atual' },
    { name: 'PAGE_COUNT', className: 'java.lang.Integer', description: 'Quantidade de registros na página' },
    { name: 'COLUMN_NUMBER', className: 'java.lang.Integer', description: 'Número da coluna atual' },
    { name: 'COLUMN_COUNT', className: 'java.lang.Integer', description: 'Quantidade de registros na coluna' },
    { name: 'REPORT_COUNT', className: 'java.lang.Integer', description: 'Total de registros processados no relatório' }
  ];

  const varRegex =
    /<(?:[a-zA-Z0-9_]+:)?variable\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?variable>)/gi;
  let varMatch: RegExpExecArray | null;

  while ((varMatch = varRegex.exec(cleanedXml)) !== null) {
    const attrs = parseAttributes(varMatch[1] || '');
    const rawName = attrs.name?.trim();
    if (!rawName || variables.some((v) => v.name === rawName)) {
      continue;
    }

    const className = attrs.class?.trim() || 'java.lang.Object';
    const calculation = attrs.calculation?.trim();
    const body = varMatch[2] || '';
    const description = extractChildTagContent(body, 'variableDescription');

    const varEntry: JrxmlVariable = {
      name: rawName,
      className,
      ...(calculation ? { calculation } : {}),
      ...(description ? { description } : calculation ? { description: `Cálculo: ${calculation}` } : {})
    };

    variables.push(varEntry);
  }

  const queryString = extractChildTagContent(cleanedXml, 'queryString');

  return {
    parameters,
    fields,
    variables,
    ...(queryString !== undefined ? { queryString } : {})
  };
}

/**
 * Lê um arquivo `.jrxml` do disco e retorna seus metadados.
 */
export function parseJrxmlFile(filePath: string): JrxmlMetadata {
  const content = fs.readFileSync(filePath, 'utf8');
  return parseJrxml(content);
}

/**
 * Extrai metadados de um `vscode.TextDocument`, caminho de arquivo ou string XML.
 */
export function getMetadata(source?: string | TextDocumentLike): JrxmlMetadata {
  if (typeof source === 'object' && source !== null && typeof source.getText === 'function') {
    return parseJrxml(source.getText());
  }
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed.startsWith('<')) {
      return parseJrxml(source);
    }
    if (fs.existsSync(source)) {
      return parseJrxmlFile(source);
    }
    return parseJrxml(source);
  }
  return { parameters: [], fields: [], variables: [] };
}

export class JrxmlParser {
  public parse(xmlContent: string): JrxmlMetadata {
    return parseJrxml(xmlContent);
  }

  public parseFile(filePath: string): JrxmlMetadata {
    return parseJrxmlFile(filePath);
  }

  public getMetadata(source?: string | TextDocumentLike): JrxmlMetadata {
    return getMetadata(source);
  }

  public isBuiltInParameter(name: string): boolean {
    return isBuiltInParameter(name);
  }
}

export const jrxmlParser = new JrxmlParser();
