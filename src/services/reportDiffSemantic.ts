export type DiffCategory =
  | 'structure'
  | 'attributes'
  | 'query'
  | 'parameters'
  | 'fields'
  | 'variables'
  | 'styles'
  | 'expressions'
  | 'subreports';

export interface SqlNormalizeOptions {
  stripComments?: boolean;
  normalizeWhitespace?: boolean;
  uppercaseKeywords?: boolean;
  normalizeAliases?: boolean;
  sortWhereConditions?: boolean;
}

export interface SemanticSqlClauseDiff {
  clause: 'SELECT' | 'FROM' | 'JOIN' | 'WHERE' | 'GROUP BY' | 'HAVING' | 'ORDER BY' | 'OTHER';
  oldClause?: string;
  newClause?: string;
  type: 'added' | 'removed' | 'modified';
}

export interface SemanticSqlDiffResult {
  rawA: string;
  rawB: string;
  normalizedA: string;
  normalizedB: string;
  textuallyEqual: boolean;
  semanticallyEqual: boolean;
  clauseDiffs: SemanticSqlClauseDiff[];
  summary: string;
}

export interface ExpressionToken {
  type: 'jasperRef' | 'string' | 'number' | 'boolean' | 'null' | 'operator' | 'identifier' | 'punctuation';
  value: string;
}

export interface SemanticExpressionDiffResult {
  rawA: string;
  rawB: string;
  normalizedA: string;
  normalizedB: string;
  textuallyEqual: boolean;
  semanticallyEqual: boolean;
  addedReferences: string[];
  removedReferences: string[];
  summary: string;
}

const SQL_KEYWORDS = new Set<string>([
  'SELECT',
  'DISTINCT',
  'ALL',
  'AS',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'ILIKE',
  'IS',
  'NULL',
  'TRUE',
  'FALSE',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'OUTER',
  'CROSS',
  'NATURAL',
  'ON',
  'USING',
  'GROUP',
  'BY',
  'HAVING',
  'ORDER',
  'ASC',
  'DESC',
  'NULLS',
  'FIRST',
  'LAST',
  'LIMIT',
  'OFFSET',
  'FETCH',
  'NEXT',
  'ROWS',
  'ONLY',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'CAST',
  'COALESCE',
  'NULLIF',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'OVER',
  'PARTITION',
  'WITH',
  'RECURSIVE',
  'INTO',
  'VALUES',
  'TOP'
]);

const STYLE_ATTRIBUTES = new Set<string>([
  'style',
  'parentStyle',
  'forecolor',
  'backcolor',
  'mode',
  'fontName',
  'fontSize',
  'isBold',
  'isItalic',
  'isUnderline',
  'isStrikeThrough',
  'pdfFontName',
  'pdfEncoding',
  'isPdfEmbedded',
  'hAlign',
  'vAlign',
  'hTextAlign',
  'vTextAlign',
  'hImageAlign',
  'vImageAlign',
  'textAlignment',
  'verticalAlignment',
  'rotation',
  'lineSpacing',
  'markup',
  'radius',
  'fill',
  'lineWidth',
  'lineStyle',
  'lineColor',
  'padding',
  'topPadding',
  'leftPadding',
  'bottomPadding',
  'rightPadding',
  'pen'
]);

const STYLE_TAGS = new Set<string>([
  'style',
  'conditionalStyle',
  'conditionExpression',
  'box',
  'pen',
  'topPen',
  'leftPen',
  'bottomPen',
  'rightPen',
  'font',
  'paragraph',
  'tabStop'
]);

const EXPRESSION_TAGS = new Set<string>([
  'textFieldExpression',
  'printWhenExpression',
  'initialValueExpression',
  'variableExpression',
  'defaultValueExpression',
  'imageExpression',
  'patternExpression',
  'anchorNameExpression',
  'hyperlinkReferenceExpression',
  'hyperlinkAnchorExpression',
  'hyperlinkPageExpression',
  'hyperlinkTooltipExpression',
  'filterExpression',
  'groupExpression',
  'bucketExpression',
  'measureExpression',
  'labelExpression',
  'valueExpression',
  'seriesExpression',
  'categoryExpression',
  'keyExpression'
]);

const SUBREPORT_TAGS = new Set<string>([
  'subreport',
  'subreportExpression',
  'connectionExpression',
  'dataSourceExpression',
  'subreportParameter',
  'subreportParameterExpression',
  'returnValue',
  'parametersMapExpression'
]);

const PARAMETER_TAGS = new Set<string>([
  'parameter',
  'parameterDescription'
]);

const FIELD_TAGS = new Set<string>([
  'field',
  'fieldDescription'
]);

const VARIABLE_TAGS = new Set<string>([
  'variable',
  'variableDescription'
]);

const QUERY_TAGS = new Set<string>([
  'queryString'
]);

/**
 * Decodifica entidades XML padrão (&lt;, &gt;, &quot;, &apos;, &amp;).
 */
export function decodeXmlEntities(value: string): string {
  if (!value || !value.includes('&')) {
    return value;
  }
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Remove envoltórios `<![CDATA[ ... ]]>` e decodifica entidades caso não seja CDATA.
 */
export function unwrapCdata(raw: string): string {
  if (!raw) {
    return '';
  }
  const trimmed = raw.trim();
  const cdataMatch = /^<!\[CDATA\[([\s\S]*?)\]\]>$/i.exec(trimmed);
  if (cdataMatch) {
    return cdataMatch[1].trim();
  }
  if (trimmed.includes('<![CDATA[')) {
    return trimmed
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, (_, inner: string) => inner)
      .trim();
  }
  return decodeXmlEntities(trimmed);
}

/**
 * Classifica o elemento ou atributo XML em uma das categorias de diff (`DiffCategory`).
 */
export function classifyDiffCategory(
  tagName: string,
  ancestorTags: string[] = [],
  attributeName?: string
): DiffCategory {
  const cleanTag = stripNamespacePrefix(tagName);
  const cleanAncestors = ancestorTags.map(stripNamespacePrefix);

  if (QUERY_TAGS.has(cleanTag) || cleanAncestors.includes('queryString')) {
    return 'query';
  }

  if (SUBREPORT_TAGS.has(cleanTag) || cleanAncestors.includes('subreport')) {
    if (attributeName && STYLE_ATTRIBUTES.has(attributeName)) {
      return 'styles';
    }
    if (
      attributeName &&
      cleanTag === 'reportElement' &&
      !SUBREPORT_TAGS.has(cleanTag)
    ) {
      return 'attributes';
    }
    return 'subreports';
  }

  if (PARAMETER_TAGS.has(cleanTag) || cleanAncestors.includes('parameter')) {
    return 'parameters';
  }

  if (FIELD_TAGS.has(cleanTag) || cleanAncestors.includes('field')) {
    return 'fields';
  }

  if (VARIABLE_TAGS.has(cleanTag) || cleanAncestors.includes('variable')) {
    if (EXPRESSION_TAGS.has(cleanTag) && cleanTag !== 'variableExpression' && cleanTag !== 'initialValueExpression') {
      return 'expressions';
    }
    return 'variables';
  }

  if (STYLE_TAGS.has(cleanTag) || cleanAncestors.includes('style')) {
    return 'styles';
  }

  if (EXPRESSION_TAGS.has(cleanTag)) {
    return 'expressions';
  }

  if (attributeName) {
    if (STYLE_ATTRIBUTES.has(attributeName)) {
      return 'styles';
    }
    return 'attributes';
  }

  return 'structure';
}

export function stripNamespacePrefix(tagName: string): string {
  const colonIdx = tagName.indexOf(':');
  return colonIdx >= 0 ? tagName.slice(colonIdx + 1) : tagName;
}

/**
 * Remove comentários SQL (`-- ...` e `/* ... * /`) preservando literais de string e tokens `$P{...}`.
 */
export function stripSqlComments(sql: string): string {
  let result = '';
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1];

    // String literal com aspas simples
    if (ch === "'") {
      result += ch;
      i++;
      while (i < len) {
        result += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") {
          result += sql[i + 1];
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Identificador entre aspas duplas
    if (ch === '"') {
      result += ch;
      i++;
      while (i < len) {
        result += sql[i];
        if (sql[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Comentário de linha `--`
    if (ch === '-' && next === '-') {
      i += 2;
      while (i < len && sql[i] !== '\n' && sql[i] !== '\r') {
        i++;
      }
      result += ' ';
      continue;
    }

    // Comentário de bloco `/* ... */`
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
        i++;
      }
      i += 2;
      result += ' ';
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Divide uma string SQL pelo delimitador no nível superior (fora de parênteses, strings e `$P{...}`).
 */
function splitTopLevelSql(input: string, separatorRegex: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let braceDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let lastIndex = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inSingleQuote) {
      if (ch === "'" && input[i + 1] === "'") {
        i++;
      } else if (ch === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === '{') {
      braceDepth++;
      continue;
    }
    if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (depth === 0 && braceDepth === 0) {
      const slice = input.slice(i);
      const match = separatorRegex.exec(slice);
      if (match && match.index === 0) {
        parts.push(input.slice(lastIndex, i).trim());
        i += match[0].length - 1;
        lastIndex = i + 1;
      }
    }
  }

  const tail = input.slice(lastIndex).trim();
  if (tail) {
    parts.push(tail);
  }
  return parts;
}

/**
 * Normaliza um item de projeção SELECT ou tabela FROM padronizando alias explícito (`AS alias`)
 * e case de identificadores fora de literais.
 */
function normalizeSelectProjectionItem(item: string): string {
  const trimmed = item.trim();
  if (!trimmed) {
    return '';
  }

  // Se já tem `AS alias` no final (nível superior), normaliza para `expr AS alias_lower`
  const explicitAsMatch = /^([\s\S]+?)\s+\bAS\b\s+([a-zA-Z_][a-zA-Z0-9_$]*|"[^"]+")$/i.exec(trimmed);
  if (explicitAsMatch) {
    const expr = explicitAsMatch[1].trim();
    const alias = explicitAsMatch[2].startsWith('"')
      ? explicitAsMatch[2]
      : explicitAsMatch[2].toLowerCase();
    return `${expr} AS ${alias}`;
  }

  // Verifica se há alias implícito no final: ex. `t.nome_paciente nome_paciente`
  const implicitAliasMatch = /^([\s\S]+?[a-zA-Z0-9_)\]}'"])\s+([a-zA-Z_][a-zA-Z0-9_$]*)$/.exec(
    trimmed
  );
  if (implicitAliasMatch) {
    const exprPart = implicitAliasMatch[1].trim();
    const candidateAlias = implicitAliasMatch[2];
    const upperCandidate = candidateAlias.toUpperCase();
    const exprUpper = exprPart.toUpperCase();

    if (
      !SQL_KEYWORDS.has(upperCandidate) &&
      !exprUpper.endsWith(' IS') &&
      !exprUpper.endsWith(' NOT') &&
      !exprUpper.endsWith(' AND') &&
      !exprUpper.endsWith(' OR') &&
      !exprUpper.endsWith(' CASE') &&
      !exprUpper.endsWith(' THEN') &&
      !exprUpper.endsWith(' ELSE')
    ) {
      return `${exprPart} AS ${candidateAlias.toLowerCase()}`;
    }
  }

  return trimmed;
}

/**
 * Normaliza query SQL para comparação semântica:
 * - Remove comentários
 * - Normaliza parâmetros Jasper `$P{ ... }`, `$P!{ ... }`, `$X{ ... }`
 * - Padroniza operadores (`!=` -> `<>`, espaços ao redor de `=`, `,`, `(`, `)`)
 * - Converte keywords SQL para UPPERCASE
 * - Normaliza aliases (`col alias` -> `col AS alias`)
 * - Ordena condições `AND` de nível superior na cláusula `WHERE` (quando aplicável)
 */
export function normalizeSqlQuery(
  rawSql: string,
  options: SqlNormalizeOptions = {}
): string {
  const {
    stripComments = true,
    normalizeWhitespace = true,
    uppercaseKeywords = true,
    normalizeAliases = true,
    sortWhereConditions = true
  } = options;

  let sql = unwrapCdata(rawSql);
  if (!sql) {
    return '';
  }

  if (stripComments) {
    sql = stripSqlComments(sql);
  }

  // Preserva literais de string e expressões Jasper ($P{}, $P!{}, $X{})
  const placeholders: string[] = [];
  sql = sql.replace(
    /(\$P!?\{[^}]*\}|\$X\{[^}]*\}|'[^']*(?:''[^']*)*'|"[^"]*")/g,
    (match) => {
      let normalizedToken = match;
      if (match.startsWith('$P')) {
        normalizedToken = match.replace(/\s+/g, '');
      } else if (match.startsWith('$X')) {
        normalizedToken = match
          .replace(/\s*,\s*/g, ', ')
          .replace(/^\$X\{\s*/, '$X{')
          .replace(/\s*\}$/, '}');
      }
      const idx = placeholders.length;
      placeholders.push(normalizedToken);
      return `__SQL_TOKEN_${idx}__`;
    }
  );

  // Normaliza operadores relacionais e pontuação
  sql = sql
    .replace(/!=/g, '<>')
    .replace(/\s*(<>|<=|>=|=|<|>)\s*/g, ' $1 ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/;\s*$/, '');

  if (normalizeWhitespace) {
    sql = sql.replace(/\s+/g, ' ').trim();
  }

  if (uppercaseKeywords) {
    sql = sql.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (word) => {
      if (word.startsWith('__SQL_TOKEN_')) {
        return word;
      }
      const upper = word.toUpperCase();
      return SQL_KEYWORDS.has(upper) ? upper : word.toLowerCase();
    });
  }

  // Restaura tokens antes de analisar cláusulas estruturais
  const restoreTokens = (str: string): string =>
    str.replace(/__SQL_TOKEN_(\d+)__/g, (_, idxStr: string) => placeholders[Number(idxStr)] ?? '');

  sql = restoreTokens(sql);

  if (normalizeAliases) {
    // Normaliza lista de colunas do SELECT principal
    const selectFromMatch = /^SELECT\s+(DISTINCT\s+)?([\s\S]+?)\s+FROM\s+([\s\S]+)$/i.exec(sql);
    if (selectFromMatch) {
      const distinctPrefix = selectFromMatch[1] ? 'DISTINCT ' : '';
      const selectPart = selectFromMatch[2];
      const restFromPart = selectFromMatch[3];
      const columns = splitTopLevelSql(selectPart, /^,\s*/);
      const normalizedCols = columns.map(normalizeSelectProjectionItem);
      sql = `SELECT ${distinctPrefix}${normalizedCols.join(', ')} FROM ${restFromPart}`;
    }

    // Normaliza `FROM table AS alias` vs `FROM table alias`
    sql = sql.replace(
      /\b(FROM|JOIN)\s+([a-zA-Z0-9_.]+)\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b/gi,
      (full, kw: string, table: string, alias: string) => {
        if (SQL_KEYWORDS.has(alias.toUpperCase())) {
          return full;
        }
        return `${kw.toUpperCase()} ${table.toLowerCase()} AS ${alias.toLowerCase()}`;
      }
    );
  }

  if (sortWhereConditions) {
    // Localiza cláusula WHERE de nível 0 e ordena predicados conectados exclusivamente por AND
    const whereMatch =
      /^([\s\S]+?\bWHERE\s+)([\s\S]+?)(\s+\b(?:GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|FETCH|UNION)\b[\s\S]*|$)/i.exec(
        sql
      );
    if (whereMatch) {
      const prefix = whereMatch[1];
      const whereBody = whereMatch[2].trim();
      const suffix = whereMatch[3] || '';

      // Só ordena se não houver OR no nível superior
      const topOrParts = splitTopLevelSql(whereBody, /^\bOR\b\s*/i);
      if (topOrParts.length === 1) {
        const andParts = splitTopLevelSql(whereBody, /^\bAND\b\s*/i);
        if (andParts.length > 1) {
          const sortedPredicates = andParts
            .map((p) => p.replace(/^\(([\s\S]+)\)$/, '$1').trim())
            .sort((a, b) => a.localeCompare(b));
          sql = `${prefix}${sortedPredicates.join(' AND ')}${suffix}`;
        }
      }
    }
  }

  return sql.trim();
}

/**
 * Extrai cláusulas principais de uma query SQL para diagnóstico granular de mudanças.
 */
function extractSqlClauses(normalizedSql: string): Record<string, string> {
  const clauses: Record<string, string> = {};
  if (!normalizedSql) {
    return clauses;
  }

  const clauseRegex =
    /\b(SELECT|FROM|(?:(?:INNER|LEFT|RIGHT|FULL|CROSS)\s+(?:OUTER\s+)?)?JOIN|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY)\b/gi;
  const matches: Array<{ name: string; start: number; bodyStart: number }> = [];
  let match: RegExpExecArray | null;

  // Ignora matches dentro de parênteses
  const parenDepthAt: number[] = new Array(normalizedSql.length).fill(0);
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < normalizedSql.length; i++) {
    const ch = normalizedSql[i];
    if (ch === "'") {
      inQuote = !inQuote;
    } else if (!inQuote) {
      if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth = Math.max(0, depth - 1);
      }
    }
    parenDepthAt[i] = depth;
  }

  while ((match = clauseRegex.exec(normalizedSql)) !== null) {
    if (parenDepthAt[match.index] === 0) {
      const rawName = match[1].replace(/\s+/g, ' ').toUpperCase();
      const canonicalName = rawName.includes('JOIN') ? 'JOIN' : rawName;
      matches.push({
        name: canonicalName,
        start: match.index,
        bodyStart: match.index + match[0].length
      });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : normalizedSql.length;
    const body = normalizedSql.slice(current.bodyStart, nextStart).trim();
    if (clauses[current.name]) {
      clauses[current.name] += ` | ${body}`;
    } else {
      clauses[current.name] = body;
    }
  }

  return clauses;
}

/**
 * Verifica se duas queries SQL são semanticamente equivalentes.
 */
export function areSqlQueriesSemanticallyEqual(sqlA: string, sqlB: string): boolean {
  return normalizeSqlQuery(sqlA) === normalizeSqlQuery(sqlB);
}

/**
 * Executa o diff semântico entre duas queries SQL de relatórios Jasper.
 */
export function diffSqlQueries(sqlA: string, sqlB: string): SemanticSqlDiffResult {
  const cleanRawA = unwrapCdata(sqlA);
  const cleanRawB = unwrapCdata(sqlB);
  const textuallyEqual = cleanRawA === cleanRawB;

  const normalizedA = normalizeSqlQuery(cleanRawA);
  const normalizedB = normalizeSqlQuery(cleanRawB);
  const semanticallyEqual = normalizedA === normalizedB;

  const clauseDiffs: SemanticSqlClauseDiff[] = [];

  if (!semanticallyEqual) {
    const clausesA = extractSqlClauses(normalizedA);
    const clausesB = extractSqlClauses(normalizedB);
    const orderedKeys: Array<SemanticSqlClauseDiff['clause']> = [
      'SELECT',
      'FROM',
      'JOIN',
      'WHERE',
      'GROUP BY',
      'HAVING',
      'ORDER BY'
    ];

    for (const key of orderedKeys) {
      const valA = clausesA[key];
      const valB = clausesB[key];
      if (valA === valB) {
        continue;
      }
      if (valA === undefined && valB !== undefined) {
        clauseDiffs.push({ clause: key, newClause: valB, type: 'added' });
      } else if (valA !== undefined && valB === undefined) {
        clauseDiffs.push({ clause: key, oldClause: valA, type: 'removed' });
      } else {
        clauseDiffs.push({
          clause: key,
          oldClause: valA,
          newClause: valB,
          type: 'modified'
        });
      }
    }

    if (clauseDiffs.length === 0) {
      clauseDiffs.push({
        clause: 'OTHER',
        oldClause: normalizedA,
        newClause: normalizedB,
        type: 'modified'
      });
    }
  }

  let summary = 'Queries SQL idênticas';
  if (semanticallyEqual && !textuallyEqual) {
    summary = 'Queries SQL semanticamente equivalentes (apenas formatação/aliases/ordem WHERE)';
  } else if (!semanticallyEqual) {
    const affected = clauseDiffs.map((c) => c.clause).join(', ');
    summary = `Mudança semântica na query SQL (${affected})`;
  }

  return {
    rawA: cleanRawA,
    rawB: cleanRawB,
    normalizedA,
    normalizedB,
    textuallyEqual,
    semanticallyEqual,
    clauseDiffs,
    summary
  };
}

/**
 * Tokeniza uma expressão Java/Groovy do JasperReports para análise de AST/tokens.
 */
export function tokenizeExpression(rawExpr: string): ExpressionToken[] {
  const expr = unwrapCdata(rawExpr);
  const tokens: ExpressionToken[] = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const ch = expr[i];

    // Ignora whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Ignora comentário de linha `//`
    if (ch === '/' && expr[i + 1] === '/') {
      i += 2;
      while (i < len && expr[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Ignora comentário de bloco `/* ... */`
    if (ch === '/' && expr[i + 1] === '*') {
      i += 2;
      while (i < len && !(expr[i] === '*' && expr[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }

    // Referências Jasper: $P{...}, $P!{...}, $F{...}, $V{...}, $R{...}
    if (ch === '$' && /^[PFVR]!?\{/.test(expr.slice(i + 1))) {
      const closeIdx = expr.indexOf('}', i);
      if (closeIdx > i) {
        const rawRef = expr.slice(i, closeIdx + 1).replace(/\s+/g, '');
        tokens.push({ type: 'jasperRef', value: rawRef });
        i = closeIdx + 1;
        continue;
      }
    }

    // String literal ("..." ou '...')
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let strVal = quote;
      i++;
      while (i < len) {
        const c = expr[i];
        strVal += c;
        if (c === '\\' && i + 1 < len) {
          strVal += expr[i + 1];
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        i++;
      }
      tokens.push({ type: 'string', value: strVal });
      continue;
    }

    // Números
    if (/[0-9]/.test(ch)) {
      let numVal = '';
      while (i < len && /[0-9._LlFfDd]/.test(expr[i])) {
        numVal += expr[i];
        i++;
      }
      tokens.push({ type: 'number', value: numVal.replace(/[LlFfDd]$/, '') });
      continue;
    }

    // Operadores compostos
    const twoChar = expr.slice(i, i + 2);
    const threeChar = expr.slice(i, i + 3);
    if (['===', '!==', '<=>'].includes(threeChar)) {
      tokens.push({ type: 'operator', value: threeChar });
      i += 3;
      continue;
    }
    if (['==', '!=', '<=', '>=', '&&', '||', '?:', '?.', '+=', '-=', '*=', '/='].includes(twoChar)) {
      tokens.push({ type: 'operator', value: twoChar });
      i += 2;
      continue;
    }
    if ('+-*/%<>=!?&|:'.includes(ch)) {
      tokens.push({ type: 'operator', value: ch });
      i++;
      continue;
    }

    // Pontuação
    if ('()[]{},.;'.includes(ch)) {
      tokens.push({ type: 'punctuation', value: ch });
      i++;
      continue;
    }

    // Identificadores / Keywords / Boolean / Null
    if (/[a-zA-Z_$]/.test(ch)) {
      let ident = '';
      while (i < len && /[a-zA-Z0-9_$.]/.test(expr[i])) {
        ident += expr[i];
        i++;
      }

      if (ident === 'Boolean.TRUE' || ident === 'java.lang.Boolean.TRUE' || ident === 'true') {
        tokens.push({ type: 'boolean', value: 'true' });
      } else if (
        ident === 'Boolean.FALSE' ||
        ident === 'java.lang.Boolean.FALSE' ||
        ident === 'false'
      ) {
        tokens.push({ type: 'boolean', value: 'false' });
      } else if (ident === 'null') {
        tokens.push({ type: 'null', value: 'null' });
      } else {
        // Normaliza prefixo `java.lang.` redundante
        const shortIdent = ident.replace(/^java\.lang\./, '');
        tokens.push({ type: 'identifier', value: shortIdent });
      }
      continue;
    }

    i++;
  }

  return tokens;
}

/**
 * Normaliza uma expressão JasperReports (Java/Groovy) para comparação semântica:
 * - Remove CDATA e comentários
 * - Normaliza wrappers legados (`new Boolean(true)` -> `true`, `new Integer(10)` -> `10`, `Boolean.TRUE` -> `true`)
 * - Remove parênteses externos redundantes
 * - Padroniza espaçamento entre tokens e operadores
 */
export function normalizeJasperExpression(rawExpr: string): string {
  let cleaned = unwrapCdata(rawExpr);
  if (!cleaned) {
    return '';
  }

  // Normaliza construtores wrapper comuns do JasperReports legado (iReport / Jaspersoft Studio)
  cleaned = cleaned
    .replace(
      /\bnew\s+(?:java\.lang\.)?Boolean\s*\(\s*(true|false|"true"|"false"|Boolean\.TRUE|Boolean\.FALSE)\s*\)/gi,
      (_, val: string) => {
        const lower = val.replace(/"/g, '').toLowerCase();
        return lower.includes('true') ? 'true' : 'false';
      }
    )
    .replace(
      /\bnew\s+(?:java\.lang\.)?(?:Integer|Long|Short|Byte|Double|Float)\s*\(\s*([0-9]+(?:\.[0-9]+)?)\s*\)/g,
      '$1'
    )
    .replace(/\b(?:java\.lang\.)?Boolean\.TRUE\b/g, 'true')
    .replace(/\b(?:java\.lang\.)?Boolean\.FALSE\b/g, 'false')
    .replace(/\b(?:java\.lang\.)?(?:Integer|Long|Double|Float|Boolean)\.valueOf\s*\(\s*([^)]+?)\s*\)/g, '$1');

  const tokens = tokenizeExpression(cleaned);

  // Remove parênteses externos redundantes se envolverem a expressão inteira
  while (
    tokens.length >= 2 &&
    tokens[0].type === 'punctuation' &&
    tokens[0].value === '(' &&
    tokens[tokens.length - 1].type === 'punctuation' &&
    tokens[tokens.length - 1].value === ')'
  ) {
    let depth = 0;
    let wrapsEntire = true;
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i].type === 'punctuation' && tokens[i].value === '(') {
        depth++;
      } else if (tokens[i].type === 'punctuation' && tokens[i].value === ')') {
        depth--;
      }
      if (depth === 0) {
        wrapsEntire = false;
        break;
      }
    }
    if (wrapsEntire) {
      tokens.shift();
      tokens.pop();
    } else {
      break;
    }
  }

  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const curr = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : undefined;

    if (!prev) {
      parts.push(curr.value);
      continue;
    }

    if (curr.type === 'operator' || prev.type === 'operator') {
      parts.push(` ${curr.value}`);
    } else if (curr.type === 'punctuation') {
      if (curr.value === ',') {
        parts.push(', ');
      } else {
        parts.push(curr.value);
      }
    } else if (prev.type === 'punctuation') {
      if (prev.value === ',') {
        parts.push(curr.value);
      } else if (prev.value === '(' || prev.value === '[' || prev.value === '.') {
        parts.push(curr.value);
      } else {
        parts.push(` ${curr.value}`);
      }
    } else {
      parts.push(` ${curr.value}`);
    }
  }

  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * Verifica se duas expressões Jasper são semanticamente equivalentes.
 */
export function areExpressionsSemanticallyEqual(exprA: string, exprB: string): boolean {
  return normalizeJasperExpression(exprA) === normalizeJasperExpression(exprB);
}

/**
 * Compara duas expressões JasperReports semanticamente, identificando referências `$P/$F/$V` adicionadas ou removidas.
 */
export function diffJasperExpressions(
  exprA: string,
  exprB: string
): SemanticExpressionDiffResult {
  const cleanRawA = unwrapCdata(exprA);
  const cleanRawB = unwrapCdata(exprB);
  const textuallyEqual = cleanRawA === cleanRawB;

  const normalizedA = normalizeJasperExpression(cleanRawA);
  const normalizedB = normalizeJasperExpression(cleanRawB);
  const semanticallyEqual = normalizedA === normalizedB;

  const tokensA = tokenizeExpression(cleanRawA);
  const tokensB = tokenizeExpression(cleanRawB);

  const refsA = new Set(tokensA.filter((t) => t.type === 'jasperRef').map((t) => t.value));
  const refsB = new Set(tokensB.filter((t) => t.type === 'jasperRef').map((t) => t.value));

  const addedReferences = Array.from(refsB).filter((r) => !refsA.has(r));
  const removedReferences = Array.from(refsA).filter((r) => !refsB.has(r));

  let summary = 'Expressões idênticas';
  if (semanticallyEqual && !textuallyEqual) {
    summary = 'Expressões semanticamente equivalentes';
  } else if (!semanticallyEqual) {
    const details: string[] = [];
    if (addedReferences.length > 0) {
      details.push(`+${addedReferences.join(', ')}`);
    }
    if (removedReferences.length > 0) {
      details.push(`-${removedReferences.join(', ')}`);
    }
    summary =
      details.length > 0
        ? `Expressão alterada (${details.join(' ')})`
        : 'Expressão modificada';
  }

  return {
    rawA: cleanRawA,
    rawB: cleanRawB,
    normalizedA,
    normalizedB,
    textuallyEqual,
    semanticallyEqual,
    addedReferences,
    removedReferences,
    summary
  };
}
