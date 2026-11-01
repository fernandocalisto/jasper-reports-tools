import * as vscode from 'vscode';
import {
  isBuiltInParameter,
  JrxmlField,
  JrxmlMetadata,
  JrxmlParameter,
  JrxmlVariable
} from './jrxmlParser';
import {
  EXPRESSION_SNIPPETS,
  ExpressionSnippetDefinition,
  getCombinedMembersForType,
  getCombinedStaticMembers,
  inferMethodReturnType,
  JASPER_BUILTIN_PARAMETERS,
  JASPER_BUILTIN_VARIABLES,
  normalizeJavaTypeName
} from './groovySignatureLibrary';

export type ExpressionLanguage = 'groovy' | 'java';

export type ExpressionDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ExpressionDiagnostic {
  code: string;
  message: string;
  severity: ExpressionDiagnosticSeverity;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  suggestion?: string;
  replacement?: {
    target: string;
    value: string;
  };
}

export interface ExpressionReference {
  raw: string;
  kind: 'F' | 'P' | 'V' | 'R';
  name: string;
  exists: boolean;
  className: string;
  description?: string;
  isBuiltIn?: boolean;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  suggestion?: string;
}

export interface ExpressionValidationResult {
  valid: boolean;
  language: ExpressionLanguage;
  inferredType: string;
  expectedType?: string;
  typeCompatible: boolean;
  diagnostics: ExpressionDiagnostic[];
  references: ExpressionReference[];
}

export interface MockDataEntry {
  refKey: string;
  kind: 'F' | 'P' | 'V' | 'R';
  name: string;
  className: string;
  value: any;
  isNull?: boolean;
  description?: string;
  isReferenced?: boolean;
}

export interface ExpressionPreviewResult {
  success: boolean;
  value: any;
  formattedValue: string;
  resultType: string;
  executionTimeMs: number;
  mockDataUsed: Record<string, any>;
  error?: {
    type: string;
    message: string;
    detail?: string;
  };
}

export interface JrxmlExpressionOccurrence {
  id: string;
  tagName: string;
  expression: string;
  rawInnerContent: string;
  hasCdata: boolean;
  expectedType: string;
  contextLabel: string;
  parentElementName?: string;
  language: ExpressionLanguage;
  tagStartOffset: number;
  tagEndOffset: number;
  contentStartOffset: number;
  contentEndOffset: number;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  contentStartLine: number;
  contentStartCharacter: number;
  contentEndLine: number;
  contentEndCharacter: number;
}

/**
 * Lista de tags XML do JasperReports que contêm expressões Java/Groovy.
 */
export const JRXML_EXPRESSION_TAG_NAMES: readonly string[] = [
  'textFieldExpression',
  'printWhenExpression',
  'initialValueExpression',
  'variableExpression',
  'defaultValueExpression',
  'imageExpression',
  'subreportExpression',
  'subreportParameterExpression',
  'connectionExpression',
  'dataSourceExpression',
  'filterExpression',
  'groupExpression',
  'patternExpression',
  'anchorNameExpression',
  'hyperlinkReferenceExpression',
  'hyperlinkAnchorExpression',
  'hyperlinkPageExpression',
  'hyperlinkTooltipExpression',
  'conditionExpression',
  'labelExpression',
  'valueExpression',
  'seriesExpression',
  'categoryExpression',
  'keyExpression',
  'parametersMapExpression'
];

const BOOLEAN_EXPRESSION_TAGS = new Set<string>([
  'printWhenExpression',
  'filterExpression',
  'conditionExpression'
]);

const STRING_EXPRESSION_TAGS = new Set<string>([
  'patternExpression',
  'anchorNameExpression',
  'hyperlinkReferenceExpression',
  'hyperlinkAnchorExpression',
  'hyperlinkTooltipExpression',
  'labelExpression',
  'subreportExpression',
  'imageExpression'
]);

/**
 * Detecta a linguagem de expressões declarada na tag `<jasperReport ... language="...">`.
 * No JasperReports moderno, o padrão quando omitido pode ser configurado (default: `groovy`).
 */
export function detectReportLanguage(
  xmlContent: string,
  defaultLanguage: ExpressionLanguage = 'groovy'
): ExpressionLanguage {
  const reportTagMatch = /<(?:[a-zA-Z0-9_]+:)?jasperReport\b([^>]*?)>/i.exec(xmlContent);
  if (!reportTagMatch) {
    return defaultLanguage;
  }
  const attrs = reportTagMatch[1] || '';
  const langMatch = /\blanguage\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  if (!langMatch) {
    return defaultLanguage;
  }
  const rawLang = (langMatch[1] ?? langMatch[2] ?? '').trim().toLowerCase();
  if (rawLang === 'java') {
    return 'java';
  }
  if (rawLang === 'groovy' || rawLang === 'javascript') {
    return 'groovy';
  }
  return defaultLanguage;
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

export function offsetToLineCol(
  lineStarts: number[],
  offset: number
): { line: number; character: number } {
  const clamped = Math.max(0, offset);
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid] <= clamped) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const line = Math.max(0, high);
  const character = clamped - lineStarts[line];
  return { line, character };
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function unwrapExpressionCdata(rawInner: string): {
  expression: string;
  hasCdata: boolean;
  innerOffsetDelta: number;
  innerEndDelta: number;
} {
  const cdataRegex = /^(\s*<!\[CDATA\[)([\s\S]*?)(\]\]>\s*)$/i;
  const match = cdataRegex.exec(rawInner);
  if (match) {
    return {
      expression: match[2],
      hasCdata: true,
      innerOffsetDelta: match[1].length,
      innerEndDelta: match[3].length
    };
  }
  return {
    expression: decodeXmlEntities(rawInner.trim()),
    hasCdata: false,
    innerOffsetDelta: 0,
    innerEndDelta: 0
  };
}

/**
 * Infere o contexto (nome do parâmetro, variável, banda ou elemento pai) e o tipo esperado
 * de uma expressão localizada em `tagOffset` no XML.
 */
function resolveExpressionContext(
  xmlContent: string,
  tagName: string,
  tagAttrString: string,
  tagStartOffset: number
): {
  expectedType: string;
  contextLabel: string;
  parentElementName?: string;
} {
  // 1. Verifica atributo explícito `class="..."` na própria tag de expressão (JRXML legado)
  const explicitClassMatch = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tagAttrString);
  const explicitClass = explicitClassMatch
    ? (explicitClassMatch[1] ?? explicitClassMatch[2] ?? '').trim()
    : undefined;

  const beforeXml = xmlContent.slice(Math.max(0, tagStartOffset - 2500), tagStartOffset);

  if (tagName === 'defaultValueExpression') {
    const paramMatches = Array.from(
      beforeXml.matchAll(/<(?:[a-zA-Z0-9_]+:)?parameter\b([^>]*?)>/gi)
    );
    const lastParam = paramMatches[paramMatches.length - 1];
    if (lastParam) {
      const attrs = lastParam[1] || '';
      const nameMatch = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const classMatch = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const paramName = (nameMatch?.[1] ?? nameMatch?.[2] ?? '').trim();
      const paramClass = normalizeJavaTypeName(
        explicitClass || (classMatch?.[1] ?? classMatch?.[2] ?? 'java.lang.String')
      );
      return {
        expectedType: paramClass,
        contextLabel: paramName ? `parameter "${paramName}"` : 'parameter.defaultValueExpression',
        parentElementName: paramName || undefined
      };
    }
  }

  if (tagName === 'variableExpression' || tagName === 'initialValueExpression') {
    const varMatches = Array.from(
      beforeXml.matchAll(/<(?:[a-zA-Z0-9_]+:)?variable\b([^>]*?)>/gi)
    );
    const lastVar = varMatches[varMatches.length - 1];
    if (lastVar) {
      const attrs = lastVar[1] || '';
      const nameMatch = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const classMatch = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const varName = (nameMatch?.[1] ?? nameMatch?.[2] ?? '').trim();
      const varClass = normalizeJavaTypeName(
        explicitClass || (classMatch?.[1] ?? classMatch?.[2] ?? 'java.lang.Object')
      );
      return {
        expectedType: varClass,
        contextLabel: varName
          ? `variable "${varName}" (${tagName})`
          : `variable.${tagName}`,
        parentElementName: varName || undefined
      };
    }
  }

  if (tagName === 'subreportParameterExpression') {
    const subParamMatches = Array.from(
      beforeXml.matchAll(/<(?:[a-zA-Z0-9_]+:)?subreportParameter\b([^>]*?)>/gi)
    );
    const lastSubParam = subParamMatches[subParamMatches.length - 1];
    if (lastSubParam) {
      const attrs = lastSubParam[1] || '';
      const nameMatch = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const subParamName = (nameMatch?.[1] ?? nameMatch?.[2] ?? '').trim();
      return {
        expectedType: explicitClass ? normalizeJavaTypeName(explicitClass) : 'java.lang.Object',
        contextLabel: subParamName
          ? `subreportParameter "${subParamName}"`
          : 'subreportParameterExpression',
        parentElementName: subParamName || undefined
      };
    }
  }

  if (tagName === 'groupExpression') {
    const groupMatches = Array.from(
      beforeXml.matchAll(/<(?:[a-zA-Z0-9_]+:)?group\b([^>]*?)>/gi)
    );
    const lastGroup = groupMatches[groupMatches.length - 1];
    if (lastGroup) {
      const attrs = lastGroup[1] || '';
      const nameMatch = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const groupName = (nameMatch?.[1] ?? nameMatch?.[2] ?? '').trim();
      return {
        expectedType: explicitClass ? normalizeJavaTypeName(explicitClass) : 'java.lang.Object',
        contextLabel: groupName ? `group "${groupName}"` : 'groupExpression',
        parentElementName: groupName || undefined
      };
    }
  }

  if (BOOLEAN_EXPRESSION_TAGS.has(tagName)) {
    return {
      expectedType: 'java.lang.Boolean',
      contextLabel: tagName
    };
  }

  if (tagName === 'connectionExpression') {
    return {
      expectedType: 'java.sql.Connection',
      contextLabel: 'subreport.connectionExpression'
    };
  }

  if (STRING_EXPRESSION_TAGS.has(tagName)) {
    return {
      expectedType: explicitClass ? normalizeJavaTypeName(explicitClass) : 'java.lang.String',
      contextLabel: tagName
    };
  }

  if (tagName === 'textFieldExpression') {
    // Verifica se o <textField> pai possui pattern numérico ou de data
    const tfMatches = Array.from(
      beforeXml.matchAll(/<(?:[a-zA-Z0-9_]+:)?textField\b([^>]*?)>/gi)
    );
    const lastTf = tfMatches[tfMatches.length - 1];
    let inferredExpected = explicitClass ? normalizeJavaTypeName(explicitClass) : 'java.lang.Object';
    let label = 'textFieldExpression';

    if (lastTf) {
      const tfAttrs = lastTf[1] || '';
      const patternMatch = /\bpattern\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tfAttrs);
      const pattern = (patternMatch?.[1] ?? patternMatch?.[2] ?? '').trim();
      if (pattern) {
        label = `textField (pattern="${pattern}")`;
        if (!explicitClass) {
          if (/[#0]+\.[#0]+|#,##0/.test(pattern)) {
            inferredExpected = 'java.lang.Number';
          } else if (/(?:dd|MM|yyyy|HH:mm)/i.test(pattern)) {
            inferredExpected = 'java.util.Date';
          }
        }
      }
    }

    return {
      expectedType: inferredExpected,
      contextLabel: label
    };
  }

  return {
    expectedType: explicitClass ? normalizeJavaTypeName(explicitClass) : 'java.lang.Object',
    contextLabel: tagName
  };
}

/**
 * Extrai todas as ocorrências de tags de expressão de um documento `.jrxml`.
 */
export function extractExpressionsFromXml(xmlContent: string): JrxmlExpressionOccurrence[] {
  const occurrences: JrxmlExpressionOccurrence[] = [];
  const lineStarts = computeLineStarts(xmlContent);
  const reportLanguage = detectReportLanguage(xmlContent);
  const tagsAlternation = JRXML_EXPRESSION_TAG_NAMES.join('|');
  const exprTagRegex = new RegExp(
    `<(?:[a-zA-Z0-9_]+:)?(${tagsAlternation})\\b([^>]*?)>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?\\1>`,
    'gi'
  );

  let match: RegExpExecArray | null;
  while ((match = exprTagRegex.exec(xmlContent)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1];
    const attrStr = match[2] || '';
    const rawInnerContent = match[3] || '';

    const tagStartOffset = match.index;
    const tagEndOffset = tagStartOffset + fullMatch.length;

    const openTagEndIdx = fullMatch.indexOf('>') + 1;
    const rawInnerStartOffset = tagStartOffset + openTagEndIdx;
    const rawInnerEndOffset = rawInnerStartOffset + rawInnerContent.length;

    const unwrapped = unwrapExpressionCdata(rawInnerContent);
    const contentStartOffset = rawInnerStartOffset + unwrapped.innerOffsetDelta;
    const contentEndOffset = rawInnerEndOffset - unwrapped.innerEndDelta;

    const tagStartPos = offsetToLineCol(lineStarts, tagStartOffset);
    const tagEndPos = offsetToLineCol(lineStarts, tagEndOffset);
    const contentStartPos = offsetToLineCol(lineStarts, contentStartOffset);
    const contentEndPos = offsetToLineCol(lineStarts, contentEndOffset);

    const ctx = resolveExpressionContext(xmlContent, tagName, attrStr, tagStartOffset);

    occurrences.push({
      id: `${tagName}:${tagStartPos.line + 1}:${tagStartPos.character + 1}`,
      tagName,
      expression: unwrapped.expression.trim(),
      rawInnerContent,
      hasCdata: unwrapped.hasCdata,
      expectedType: ctx.expectedType,
      contextLabel: ctx.contextLabel,
      parentElementName: ctx.parentElementName,
      language: reportLanguage,
      tagStartOffset,
      tagEndOffset,
      contentStartOffset,
      contentEndOffset,
      startLine: tagStartPos.line,
      startCharacter: tagStartPos.character,
      endLine: tagEndPos.line,
      endCharacter: tagEndPos.character,
      contentStartLine: contentStartPos.line,
      contentStartCharacter: contentStartPos.character,
      contentEndLine: contentEndPos.line,
      contentEndCharacter: contentEndPos.character
    });
  }

  return occurrences;
}

/**
 * Localiza a expressão correspondente a uma linha/coluna do editor XML (ou no bloco pai `<textField>`, `<parameter>`, `<variable>`).
 */
export function findExpressionAtLine(
  xmlContent: string,
  lineZeroBased: number,
  characterZeroBased = 0
): JrxmlExpressionOccurrence | undefined {
  const occurrences = extractExpressionsFromXml(xmlContent);
  if (occurrences.length === 0) {
    return undefined;
  }

  // 1. Verifica se o cursor está diretamente dentro da faixa de linhas da expressão
  const direct = occurrences.find(
    (occ) => lineZeroBased >= occ.startLine && lineZeroBased <= occ.endLine
  );
  if (direct) {
    return direct;
  }

  // 2. Verifica se o cursor está na declaração de um <parameter>, <variable> ou <textField> próximo (até 12 linhas acima)
  const nearby = occurrences.find(
    (occ) => lineZeroBased < occ.startLine && occ.startLine - lineZeroBased <= 10
  );
  if (nearby) {
    return nearby;
  }

  // 3. Caso contrário, retorna a expressão mais próxima da linha atual
  let closest = occurrences[0];
  let minDistance = Math.abs(occurrences[0].startLine - lineZeroBased);
  for (const occ of occurrences) {
    const dist = Math.abs(occ.startLine - lineZeroBased);
    if (dist < minDistance) {
      minDistance = dist;
      closest = occ;
    }
  }
  void characterZeroBased;
  return closest;
}

/**
 * Formata uma expressão para gravação de volta na tag XML original (preservando `<![CDATA[...]]>`).
 */
export function formatExpressionForXmlTag(
  newExpression: string,
  occurrence: JrxmlExpressionOccurrence
): string {
  const cleaned = newExpression.trim();
  return `<${occurrence.tagName}><![CDATA[${cleaned}]]></${occurrence.tagName}>`;
}

/**
 * Atualiza a expressão diretamente no `vscode.TextDocument` original.
 */
export async function applyExpressionEditToDocument(
  document: vscode.TextDocument,
  occurrence: JrxmlExpressionOccurrence,
  newExpression: string
): Promise<boolean> {
  const currentXml = document.getText();
  const refreshedOccurrences = extractExpressionsFromXml(currentXml);
  const target =
    refreshedOccurrences.find((o) => o.id === occurrence.id) ||
    refreshedOccurrences.find(
      (o) =>
        o.tagName === occurrence.tagName &&
        Math.abs(o.startLine - occurrence.startLine) <= 5
    ) ||
    occurrence;

  const startPos = document.positionAt(target.tagStartOffset);
  const endPos = document.positionAt(target.tagEndOffset);
  const range = new vscode.Range(startPos, endPos);

  const replacementXml = formatExpressionForXmlTag(newExpression, target);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, range, replacementXml);
  return vscode.workspace.applyEdit(edit);
}

/**
 * Calcula distância de edição (Levenshtein) para sugerir nomes de campos/parâmetros/variáveis próximos.
 */
function levenshteinDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const dp: number[][] = Array.from({ length: s.length + 1 }, () =>
    new Array<number>(t.length + 1).fill(0)
  );
  for (let i = 0; i <= s.length; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= t.length; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[s.length][t.length];
}

function findClosestName(target: string, candidates: string[]): string | undefined {
  if (!target || candidates.length === 0) {
    return undefined;
  }
  let best: string | undefined;
  let bestScore = Infinity;
  for (const cand of candidates) {
    const dist = levenshteinDistance(target, cand);
    if (
      dist < bestScore &&
      (dist <= 3 ||
        cand.toLowerCase().includes(target.toLowerCase()) ||
        target.toLowerCase().includes(cand.toLowerCase()))
    ) {
      bestScore = dist;
      best = cand;
    }
  }
  return best;
}

/**
 * Infere o tipo de retorno Java de uma expressão JasperReports (Java/Groovy).
 */
export function inferExpressionType(
  rawExpression: string,
  metadata: JrxmlMetadata,
  language: ExpressionLanguage = 'groovy'
): string {
  const expr = rawExpression.trim();
  if (!expr || expr === 'null') {
    return 'java.lang.Object';
  }

  // Remove parênteses externos redundantes
  let unwrapped = expr;
  while (unwrapped.startsWith('(') && unwrapped.endsWith(')')) {
    let depth = 0;
    let balancedOuter = true;
    for (let i = 0; i < unwrapped.length - 1; i++) {
      if (unwrapped[i] === '(') {
        depth++;
      } else if (unwrapped[i] === ')') {
        depth--;
      }
      if (depth === 0) {
        balancedOuter = false;
        break;
      }
    }
    if (balancedOuter) {
      unwrapped = unwrapped.slice(1, -1).trim();
    } else {
      break;
    }
  }

  // 1. Operador ternário no nível superior: cond ? ramoVerdadeiro : ramoFalso
  const ternaryParts = splitTopLevelTernary(unwrapped);
  if (ternaryParts) {
    const trueType = inferExpressionType(ternaryParts.whenTrue, metadata, language);
    const falseType = inferExpressionType(ternaryParts.whenFalse, metadata, language);
    if (trueType !== 'java.lang.Object') {
      return trueType;
    }
    return falseType;
  }

  // 2. Operador Elvis Groovy: exprA ?: exprB
  const elvisParts = splitTopLevelBinaryOperator(unwrapped, '?:');
  if (elvisParts) {
    const rightType = inferExpressionType(elvisParts.right, metadata, language);
    const leftType = inferExpressionType(elvisParts.left, metadata, language);
    if (rightType && rightType !== 'java.lang.Object') {
      return rightType;
    }
    return leftType;
  }

  // 3. Expressões booleanas lógicas ou relacionais no nível superior
  if (hasTopLevelBooleanOperator(unwrapped) || /^!\s*/.test(unwrapped)) {
    return 'java.lang.Boolean';
  }

  // 4. Literais diretos
  if (/^(?:true|false|Boolean\.TRUE|Boolean\.FALSE|java\.lang\.Boolean\.TRUE|java\.lang\.Boolean\.FALSE)$/.test(unwrapped)) {
    return 'java.lang.Boolean';
  }
  if (/^(?:"[^"]*"|'[^']*')$/.test(unwrapped)) {
    return 'java.lang.String';
  }
  if (/^-?\d+$/.test(unwrapped)) {
    return 'java.lang.Integer';
  }
  if (/^-?\d+[Ll]$/.test(unwrapped)) {
    return 'java.lang.Long';
  }
  if (/^-?\d+\.\d+[BGbg]?$/.test(unwrapped)) {
    return language === 'groovy' ? 'java.math.BigDecimal' : 'java.lang.Double';
  }

  // 5. Formatadores conhecidos: SimpleDateFormat / DecimalFormat / NumberFormat / String.format / DateUtils.format
  if (
    /\b(?:SimpleDateFormat|DecimalFormat|NumberFormat)\b[\s\S]*\.format\s*\(/.test(unwrapped) ||
    /\b(?:String|DateUtils|JRExtendedUtils)\.(?:format|formatCurrency|formatNumber|valueOf|join)\s*\(/.test(unwrapped) ||
    /^(?:CONCATENATE|UPPER|LOWER|TRIM|DATEFORMAT)\s*\(/.test(unwrapped)
  ) {
    return 'java.lang.String';
  }

  // 6. Construtores `new Classe(...)` sem chamadas encadeadas posteriores
  const constructorMatch = /^new\s+([a-zA-Z0-9_.]+)\s*\([^)]*\)$/.exec(unwrapped);
  if (constructorMatch) {
    const cls = constructorMatch[1].replace(/^java\.(?:lang|math|util|sql|text)\./, '');
    return normalizeJavaTypeName(cls);
  }

  // 7. Referência pura ou encadeamento de métodos: $F{X}.metodo1().metodo2()
  const refChainType = inferReferenceAndMethodChainType(unwrapped, metadata, language);
  if (refChainType) {
    return refChainType;
  }

  // 8. Chamada estática: Boolean.valueOf(...), Integer.parseInt(...), BigDecimal.valueOf(...), DateUtils.addDays(...)
  const staticCallMatch = /^([A-Z][a-zA-Z0-9_]*)\.([a-zA-Z0-9_]+)(?:\s*\([\s\S]*\))?$/.exec(unwrapped);
  if (staticCallMatch) {
    const className = staticCallMatch[1];
    const memberName = staticCallMatch[2];
    const staticMembers = getCombinedStaticMembers(className);
    const matched = staticMembers.find((m) => m.name === memberName);
    if (matched?.returnType) {
      return matched.returnType;
    }
  }

  // 9. Concatenação com String literal (`"..." + ...` ou `... + "..."`)
  const plusParts = splitTopLevelBinaryOperator(unwrapped, '+');
  if (plusParts) {
    const leftT = inferExpressionType(plusParts.left, metadata, language);
    const rightT = inferExpressionType(plusParts.right, metadata, language);
    if (leftT === 'java.lang.String' || rightT === 'java.lang.String') {
      return 'java.lang.String';
    }
    if (isNumericJavaType(leftT) && isNumericJavaType(rightT)) {
      if (leftT === 'java.math.BigDecimal' || rightT === 'java.math.BigDecimal') {
        return 'java.math.BigDecimal';
      }
      if (leftT === 'java.lang.Double' || rightT === 'java.lang.Double') {
        return 'java.lang.Double';
      }
      return leftT;
    }
  }

  // 10. Operações aritméticas (-, *, /)
  for (const op of ['*', '/', '-']) {
    const arithParts = splitTopLevelBinaryOperator(unwrapped, op);
    if (arithParts && arithParts.left.trim().length > 0) {
      const leftT = inferExpressionType(arithParts.left, metadata, language);
      const rightT = inferExpressionType(arithParts.right, metadata, language);
      if (isNumericJavaType(leftT) || isNumericJavaType(rightT)) {
        if (leftT === 'java.math.BigDecimal' || rightT === 'java.math.BigDecimal') {
          return 'java.math.BigDecimal';
        }
        if (op === '/' && language === 'groovy') {
          return 'java.math.BigDecimal';
        }
        return isNumericJavaType(leftT) ? leftT : rightT;
      }
    }
  }

  return 'java.lang.Object';
}

function lookupReferenceType(
  kind: 'F' | 'P' | 'V' | 'R',
  name: string,
  metadata: JrxmlMetadata
): { exists: boolean; className: string; description?: string; isBuiltIn?: boolean } {
  const cleanName = name.trim();
  if (kind === 'R') {
    return {
      exists: Boolean(cleanName),
      className: 'java.lang.String',
      description: 'Recurso de internacionalização (ResourceBundle)'
    };
  }

  if (kind === 'F') {
    const found = metadata.fields.find((f) => f.name === cleanName);
    if (found) {
      return {
        exists: true,
        className: normalizeJavaTypeName(found.className),
        description: found.description
      };
    }
    return { exists: false, className: 'java.lang.Object' };
  }

  if (kind === 'P') {
    const found = metadata.parameters.find((p) => p.name === cleanName);
    if (found) {
      return {
        exists: true,
        className: normalizeJavaTypeName(found.className),
        description: found.description
      };
    }
    const builtIn = JASPER_BUILTIN_PARAMETERS.find((p) => p.name === cleanName);
    if (builtIn) {
      return {
        exists: true,
        className: normalizeJavaTypeName(builtIn.className),
        description: builtIn.description,
        isBuiltIn: true
      };
    }
    if (isBuiltInParameter(cleanName)) {
      return {
        exists: true,
        className: 'java.lang.Object',
        description: 'Parâmetro nativo do JasperReports',
        isBuiltIn: true
      };
    }
    return { exists: false, className: 'java.lang.Object' };
  }

  // kind === 'V'
  const allVars = [...(metadata.variables || []), ...JASPER_BUILTIN_VARIABLES];
  const foundVar = allVars.find((v) => v.name === cleanName);
  if (foundVar) {
    const isBuiltIn = JASPER_BUILTIN_VARIABLES.some((b) => b.name === cleanName);
    return {
      exists: true,
      className: normalizeJavaTypeName(foundVar.className),
      description: foundVar.description,
      isBuiltIn
    };
  }
  return { exists: false, className: 'java.lang.Object' };
}

function inferReferenceAndMethodChainType(
  expr: string,
  metadata: JrxmlMetadata,
  language: ExpressionLanguage
): string | null {
  const refStartMatch = /^\$(F|P|V|R)!?\{([^}]+)\}([\s\S]*)$/.exec(expr);
  if (!refStartMatch) {
    return null;
  }

  const kind = refStartMatch[1] as 'F' | 'P' | 'V' | 'R';
  const name = refStartMatch[2].trim();
  const tail = refStartMatch[3].trim();

  const refInfo = lookupReferenceType(kind, name, metadata);
  let currentType = refInfo.className;

  if (!tail) {
    return currentType;
  }

  // Se o restante começa com `.` ou `?.` ou `*.`, percorre os métodos encadeados
  if (!tail.startsWith('.') && !tail.startsWith('?.') && !tail.startsWith('*.')) {
    return null;
  }

  const methodCalls = Array.from(tail.matchAll(/(?:\?\.|\*\.|\.)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g));
  if (methodCalls.length === 0) {
    return currentType;
  }

  for (const call of methodCalls) {
    const methodName = call[1];
    const nextType = inferMethodReturnType(currentType, methodName, language);
    if (nextType) {
      currentType = nextType;
    } else if (methodName === 'toString' || methodName === 'format') {
      currentType = 'java.lang.String';
    } else if (
      methodName === 'equals' ||
      methodName === 'equalsIgnoreCase' ||
      methodName === 'contains' ||
      methodName === 'startsWith' ||
      methodName === 'endsWith' ||
      methodName === 'isEmpty' ||
      methodName === 'isBlank' ||
      methodName === 'before' ||
      methodName === 'after'
    ) {
      currentType = 'java.lang.Boolean';
    } else if (
      methodName === 'intValue' ||
      methodName === 'length' ||
      methodName === 'size' ||
      methodName === 'compareTo' ||
      methodName === 'indexOf'
    ) {
      currentType = 'java.lang.Integer';
    } else if (methodName === 'doubleValue') {
      currentType = 'java.lang.Double';
    } else if (methodName === 'longValue' || methodName === 'getTime') {
      currentType = 'java.lang.Long';
    } else if (
      methodName === 'add' ||
      methodName === 'subtract' ||
      methodName === 'multiply' ||
      methodName === 'divide' ||
      methodName === 'setScale' ||
      methodName === 'abs' ||
      methodName === 'negate' ||
      methodName === 'round'
    ) {
      currentType = 'java.math.BigDecimal';
    }
  }

  return currentType;
}

function splitTopLevelTernary(
  expr: string
): { condition: string; whenTrue: string; whenFalse: string } | null {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let questionIdx = -1;
  let colonIdx = -1;
  let nestedTernary = 0;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    const next = expr[i + 1];

    if (inSingle) {
      if (ch === '\\') {
        i++;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i++;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) {
      // Ignora `?.` e `?:`
      if (ch === '?' && next !== '.' && next !== ':') {
        if (questionIdx < 0) {
          questionIdx = i;
        } else {
          nestedTernary++;
        }
      } else if (ch === ':' && expr[i - 1] !== '?') {
        if (questionIdx >= 0) {
          if (nestedTernary === 0) {
            colonIdx = i;
            break;
          } else {
            nestedTernary--;
          }
        }
      }
    }
  }

  if (questionIdx > 0 && colonIdx > questionIdx) {
    return {
      condition: expr.slice(0, questionIdx).trim(),
      whenTrue: expr.slice(questionIdx + 1, colonIdx).trim(),
      whenFalse: expr.slice(colonIdx + 1).trim()
    };
  }
  return null;
}

function splitTopLevelBinaryOperator(
  expr: string,
  operator: string
): { left: string; right: string } | null {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i <= expr.length - operator.length; i++) {
    const ch = expr[i];
    if (inSingle) {
      if (ch === '\\') {
        i++;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i++;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && expr.slice(i, i + operator.length) === operator) {
      // Evita confundir `==` ou `+=` com `=` ou `+`
      if (operator.length === 1) {
        const prev = expr[i - 1] || '';
        const next = expr[i + 1] || '';
        if ('=!<>+-*/?:'.includes(prev) || '=:>.'.includes(next)) {
          continue;
        }
      }
      return {
        left: expr.slice(0, i).trim(),
        right: expr.slice(i + operator.length).trim()
      };
    }
  }
  return null;
}

function hasTopLevelBooleanOperator(expr: string): boolean {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    const two = expr.slice(i, i + 2);
    const three = expr.slice(i, i + 3);

    if (inSingle) {
      if (ch === '\\') {
        i++;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i++;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) {
      if (three === '<=>') {
        i += 2;
        continue;
      }
      if (['==', '!=', '>=', '<=', '&&', '||', '==~'].includes(two)) {
        return true;
      }
      if ((ch === '>' || ch === '<') && expr[i + 1] !== '=' && expr[i - 1] !== '=') {
        return true;
      }
    }
  }
  return false;
}

export function isNumericJavaType(typeName?: string): boolean {
  if (!typeName) {
    return false;
  }
  const norm = normalizeJavaTypeName(typeName);
  return (
    norm === 'java.math.BigDecimal' ||
    norm === 'java.lang.Integer' ||
    norm === 'java.lang.Long' ||
    norm === 'java.lang.Double' ||
    norm === 'java.lang.Float' ||
    norm === 'java.lang.Number'
  );
}

export function isDateJavaType(typeName?: string): boolean {
  if (!typeName) {
    return false;
  }
  const norm = normalizeJavaTypeName(typeName);
  return (
    norm === 'java.util.Date' ||
    norm === 'java.sql.Date' ||
    norm === 'java.sql.Timestamp'
  );
}

export function areJavaTypesCompatible(
  inferredType: string,
  expectedType?: string
): boolean {
  if (!expectedType || expectedType === 'java.lang.Object' || inferredType === 'java.lang.Object') {
    return true;
  }
  const normInferred = normalizeJavaTypeName(inferredType);
  const normExpected = normalizeJavaTypeName(expectedType);

  if (normInferred === normExpected) {
    return true;
  }
  if (isNumericJavaType(normInferred) && isNumericJavaType(normExpected)) {
    return true;
  }
  if (isDateJavaType(normInferred) && isDateJavaType(normExpected)) {
    return true;
  }
  // Em textFieldExpression, String é sempre aceita mesmo se o pattern sugerir número/data (ex: formatador manual)
  return false;
}

/**
 * Realiza a validação em tempo real de uma expressão JasperReports (Groovy/Java):
 * 1. Linting sintático (delimitadores, strings, operadores, tokens Jasper incompletos)
 * 2. Validação de referências `$F{}`, `$P{}`, `$V{}` contra os metadados do relatório
 * 3. Validação de métodos chamados sobre tipos conhecidos
 * 4. Inferência e compatibilidade de tipo de retorno com o contexto XML
 */
export function validateExpression(
  rawExpression: string,
  metadata: JrxmlMetadata,
  options: {
    language?: ExpressionLanguage;
    expectedType?: string;
    tagName?: string;
  } = {}
): ExpressionValidationResult {
  const language: ExpressionLanguage = options.language || 'groovy';
  const expectedType = options.expectedType;
  const lineStarts = computeLineStarts(rawExpression);
  const diagnostics: ExpressionDiagnostic[] = [];
  const references: ExpressionReference[] = [];

  const addDiag = (
    code: string,
    message: string,
    severity: ExpressionDiagnosticSeverity,
    startOffset: number,
    endOffset: number,
    suggestion?: string,
    replacement?: { target: string; value: string }
  ) => {
    const safeStart = Math.max(0, Math.min(rawExpression.length, startOffset));
    const safeEnd = Math.max(safeStart + 1, Math.min(rawExpression.length, endOffset));
    const startPos = offsetToLineCol(lineStarts, safeStart);
    const endPos = offsetToLineCol(lineStarts, safeEnd);
    diagnostics.push({
      code,
      message,
      severity,
      startOffset: safeStart,
      endOffset: safeEnd,
      startLine: startPos.line + 1,
      startColumn: startPos.character + 1,
      endLine: endPos.line + 1,
      endColumn: endPos.character + 1,
      suggestion,
      replacement
    });
  };

  // 1. Verifica balanceamento de aspas, comentários e delimitadores (), [], {}
  const bracketStack: Array<{ char: string; expected: string; offset: number }> = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let quoteStartOffset = 0;

  for (let i = 0; i < rawExpression.length; i++) {
    const ch = rawExpression[i];
    const next = rawExpression[i + 1];

    if (inSingleQuote) {
      if (ch === '\\') {
        i++;
      } else if (ch === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '\\') {
        i++;
      } else if (ch === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    // Comentário de linha
    if (ch === '/' && next === '/') {
      while (i < rawExpression.length && rawExpression[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Comentário de bloco
    if (ch === '/' && next === '*') {
      const commentStart = i;
      i += 2;
      let closed = false;
      while (i < rawExpression.length) {
        if (rawExpression[i] === '*' && rawExpression[i + 1] === '/') {
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (!closed) {
        addDiag(
          'UNCLOSED_COMMENT',
          'Comentário de bloco /* ... */ não foi fechado.',
          'error',
          commentStart,
          rawExpression.length
        );
      }
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      quoteStartOffset = i;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      quoteStartOffset = i;
      continue;
    }

    if (ch === '(') {
      bracketStack.push({ char: '(', expected: ')', offset: i });
    } else if (ch === '[') {
      bracketStack.push({ char: '[', expected: ']', offset: i });
    } else if (ch === '{') {
      bracketStack.push({ char: '{', expected: '}', offset: i });
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const last = bracketStack.pop();
      if (!last) {
        addDiag(
          'UNEXPECTED_CLOSING_BRACKET',
          `Delimitador de fechamento '${ch}' sem abertura correspondente.`,
          'error',
          i,
          i + 1
        );
      } else if (last.expected !== ch) {
        addDiag(
          'MISMATCHED_BRACKET',
          `Delimitador '${ch}' incompatível com '${last.char}' aberto anteriormente (esperado '${last.expected}').`,
          'error',
          i,
          i + 1
        );
      }
    }
  }

  if (inSingleQuote || inDoubleQuote) {
    const qChar = inDoubleQuote ? '"' : "'";
    addDiag(
      'UNCLOSED_STRING',
      `Literal de string (${qChar}) não foi fechado.`,
      'error',
      quoteStartOffset,
      rawExpression.length
    );
  }

  for (const unclosed of bracketStack) {
    addDiag(
      'UNCLOSED_BRACKET',
      `Delimitador '${unclosed.char}' não foi fechado (esperado '${unclosed.expected}').`,
      'error',
      unclosed.offset,
      unclosed.offset + 1
    );
  }

  // 2. Verifica referências Jasper malformadas (ex: `$F{` sem `}`, `$F{}`, `$Z{...}`)
  const emptyRefRegex = /\$(F|P|V|R)!?\{\s*\}/g;
  let emptyMatch: RegExpExecArray | null;
  while ((emptyMatch = emptyRefRegex.exec(rawExpression)) !== null) {
    const kind = emptyMatch[1];
    const kindLabel =
      kind === 'F' ? 'campo' : kind === 'P' ? 'parâmetro' : kind === 'V' ? 'variável' : 'recurso';
    addDiag(
      'EMPTY_JASPER_REF',
      `Referência $${kind}{} vazia: informe o nome do ${kindLabel}.`,
      'error',
      emptyMatch.index,
      emptyMatch.index + emptyMatch[0].length
    );
  }

  const invalidPrefixRegex = /\$([A-Za-z])!?\{([^}]*)\}/g;
  let prefixMatch: RegExpExecArray | null;
  while ((prefixMatch = invalidPrefixRegex.exec(rawExpression)) !== null) {
    const prefixLetter = prefixMatch[1];
    if (!['F', 'P', 'V', 'R', 'X'].includes(prefixLetter)) {
      addDiag(
        'INVALID_JASPER_PREFIX',
        `Prefixo de referência '$${prefixLetter}{' inválido no JasperReports. Use $F{}, $P{}, $V{} ou $R{}.`,
        'error',
        prefixMatch.index,
        prefixMatch.index + prefixMatch[0].length
      );
    } else if (prefixLetter === 'X') {
      addDiag(
        'SQL_ONLY_CLAUSE_IN_EXPR',
        'A cláusula $X{...} é exclusiva de queries SQL (<queryString>) e não é válida em expressões Java/Groovy.',
        'error',
        prefixMatch.index,
        prefixMatch.index + prefixMatch[0].length
      );
    }
  }

  // 3. Extrai e valida todas as referências $F{...}, $P{...}, $V{...}, $R{...}
  const refRegex = /\$(F|P|V|R)!?\{([^}]+)\}/g;
  let refMatch: RegExpExecArray | null;

  const fieldNames = metadata.fields.map((f) => f.name);
  const paramNames = [
    ...metadata.parameters.map((p) => p.name),
    ...JASPER_BUILTIN_PARAMETERS.map((p) => p.name)
  ];
  const varNames = [
    ...(metadata.variables || []).map((v) => v.name),
    ...JASPER_BUILTIN_VARIABLES.map((v) => v.name)
  ];

  while ((refMatch = refRegex.exec(rawExpression)) !== null) {
    const rawToken = refMatch[0];
    const kind = refMatch[1] as 'F' | 'P' | 'V' | 'R';
    const rawName = refMatch[2].trim();
    const startOffset = refMatch.index;
    const endOffset = startOffset + rawToken.length;
    const startPos = offsetToLineCol(lineStarts, startOffset);
    const endPos = offsetToLineCol(lineStarts, endOffset);

    const lookup = lookupReferenceType(kind, rawName, metadata);
    let suggestion: string | undefined;

    if (!lookup.exists) {
      const candidatePool =
        kind === 'F' ? fieldNames : kind === 'P' ? paramNames : kind === 'V' ? varNames : [];
      const closest = findClosestName(rawName, candidatePool);
      const kindTitle =
        kind === 'F' ? 'Campo' : kind === 'P' ? 'Parâmetro' : 'Variável';

      if (closest) {
        suggestion = `$${kind}{${closest}}`;
      }

      addDiag(
        `UNKNOWN_${kind}_REFERENCE`,
        `${kindTitle} '$${kind}{${rawName}}' não existe no relatório atual.${
          suggestion ? ` Você quis dizer ${suggestion}?` : ''
        }`,
        'error',
        startOffset,
        endOffset,
        suggestion,
        suggestion ? { target: rawToken, value: suggestion } : undefined
      );
    }

    references.push({
      raw: rawToken,
      kind,
      name: rawName,
      exists: lookup.exists,
      className: lookup.className,
      description: lookup.description,
      isBuiltIn: lookup.isBuiltIn,
      startOffset,
      endOffset,
      startLine: startPos.line + 1,
      startColumn: startPos.character + 1,
      endLine: endPos.line + 1,
      endColumn: endPos.character + 1,
      suggestion
    });
  }

  // 4. Verifica ponto pendente no final (ex: `$F{CAMPO}.`)
  const trailingDotMatch = /(\.\s*|\?\.\s*)$/.exec(rawExpression);
  if (trailingDotMatch) {
    const idx = trailingDotMatch.index;
    addDiag(
      'TRAILING_DOT',
      'Acesso a membro incompleto após o ponto (.). Selecione um método ou propriedade.',
      'error',
      idx,
      rawExpression.length
    );
  }

  // 5. Verifica uso de operadores exclusivos de Groovy quando a linguagem está em modo `java`
  if (language === 'java') {
    const safeNavRegex = /\?\./g;
    let snMatch: RegExpExecArray | null;
    while ((snMatch = safeNavRegex.exec(rawExpression)) !== null) {
      addDiag(
        'GROOVY_OPERATOR_IN_JAVA',
        "O operador Safe Navigation '?.' é exclusivo de Groovy e causará erro de compilação em Java.",
        'error',
        snMatch.index,
        snMatch.index + 2,
        'Altere a linguagem para Groovy ou use operador ternário (? :)'
      );
    }

    const elvisRegex = /\?:/g;
    let elvisMatch: RegExpExecArray | null;
    while ((elvisMatch = elvisRegex.exec(rawExpression)) !== null) {
      addDiag(
        'GROOVY_ELVIS_IN_JAVA',
        "O operador Elvis '?:' é exclusivo de Groovy e não é suportado em modo Java.",
        'error',
        elvisMatch.index,
        elvisMatch.index + 2,
        'Altere a linguagem para Groovy ou utilize expr != null ? expr : padrao'
      );
    }
  }

  // 6. Valida métodos chamados sobre referências de tipo conhecido ($F{X}.metodoInvalido())
  const memberAccessRegex = /\$(F|P|V)\{([^}]+)\}\s*(?:\?\.|\.)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  let memberMatch: RegExpExecArray | null;
  while ((memberMatch = memberAccessRegex.exec(rawExpression)) !== null) {
    const kind = memberMatch[1] as 'F' | 'P' | 'V';
    const refName = memberMatch[2].trim();
    const methodName = memberMatch[3];
    const lookup = lookupReferenceType(kind, refName, metadata);

    if (lookup.exists && lookup.className !== 'java.lang.Object') {
      const availableMembers = getCombinedMembersForType(lookup.className, language);
      const existsOnType = availableMembers.some((m) => m.name === methodName);
      if (!existsOnType) {
        const methodOffset =
          memberMatch.index + memberMatch[0].lastIndexOf(methodName);
        const closestMethod = findClosestName(
          methodName,
          availableMembers.map((m) => m.name)
        );
        addDiag(
          'UNKNOWN_METHOD_FOR_TYPE',
          `O método '${methodName}()' não é reconhecido para o tipo '${lookup.className}' de $${kind}{${refName}}.${
            closestMethod ? ` Sugestão: '${closestMethod}()'` : ''
          }`,
          'warning',
          methodOffset,
          methodOffset + methodName.length,
          closestMethod ? `${closestMethod}()` : undefined
        );
      }
    }
  }

  // 7. Inferência de tipo e verificação de compatibilidade com o contexto XML
  const inferredType = inferExpressionType(rawExpression, metadata, language);
  let typeCompatible = areJavaTypesCompatible(inferredType, expectedType);

  if (
    expectedType &&
    expectedType !== 'java.lang.Object' &&
    inferredType !== 'java.lang.Object' &&
    !typeCompatible
  ) {
    // Em textFieldExpression, formatar para String (ex: SimpleDateFormat / DecimalFormat) é válido mesmo se o pattern era de data/número
    if (options.tagName === 'textFieldExpression' && inferredType === 'java.lang.String') {
      typeCompatible = true;
    } else {
      addDiag(
        'TYPE_MISMATCH',
        `Tipo de retorno inferido '${inferredType}' pode ser incompatível com o tipo esperado '${expectedType}' neste contexto${
          options.tagName ? ` (<${options.tagName}>)` : ''
        }.`,
        'warning',
        0,
        Math.max(1, rawExpression.length)
      );
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  return {
    valid: !hasErrors,
    language,
    inferredType,
    expectedType,
    typeCompatible,
    diagnostics,
    references
  };
}

/**
 * Gera valor sintético (mock) realista baseado no nome e na classe Java do campo/parâmetro/variável.
 */
export function generateSyntheticValueForType(
  name: string,
  className: string,
  defaultValue?: string
): any {
  const normType = normalizeJavaTypeName(className);
  const upperName = name.toUpperCase();

  if (defaultValue !== undefined && defaultValue !== '' && defaultValue !== 'null') {
    if (normType === 'java.lang.Boolean') {
      return defaultValue.toLowerCase() === 'true';
    }
    if (isNumericJavaType(normType) && !Number.isNaN(Number(defaultValue))) {
      return Number(defaultValue);
    }
    if (normType === 'java.lang.String') {
      return defaultValue.replace(/^["']|["']$/g, '');
    }
  }

  if (normType === 'java.lang.Boolean') {
    return true;
  }

  if (
    normType === 'java.math.BigDecimal' ||
    normType === 'java.lang.Double' ||
    normType === 'java.lang.Float'
  ) {
    if (upperName.includes('PERC') || upperName.includes('TAXA') || upperName.includes('ALIQ')) {
      return 12.5;
    }
    if (upperName.includes('DESC')) {
      return 25.0;
    }
    if (upperName.includes('TOTAL') || upperName.includes('VALOR') || upperName.includes('VL_')) {
      return 1250.75;
    }
    return 150.5;
  }

  if (
    normType === 'java.lang.Integer' ||
    normType === 'java.lang.Long' ||
    normType === 'java.lang.Number'
  ) {
    if (upperName === 'PAGE_NUMBER' || upperName === 'COLUMN_NUMBER' || upperName === 'MASTER_CURRENT_PAGE') {
      return 1;
    }
    if (upperName === 'PAGE_COUNT' || upperName === 'MASTER_TOTAL_PAGES') {
      return 5;
    }
    if (upperName === 'REPORT_COUNT' || upperName === 'COLUMN_COUNT') {
      return 42;
    }
    if (upperName.includes('IDADE')) {
      return 34;
    }
    if (upperName.includes('ANO')) {
      return 2026;
    }
    if (upperName.includes('MES')) {
      return 10;
    }
    if (upperName.includes('QT') || upperName.includes('QTD') || upperName.includes('QUANT')) {
      return 10;
    }
    if (upperName.startsWith('CD_') || upperName.startsWith('ID_') || upperName.includes('CODIGO')) {
      return 1024;
    }
    return 100;
  }

  if (isDateJavaType(normType)) {
    return '2026-10-31T14:30:00.000Z';
  }

  // Strings com heurística semântica por nome de coluna/parâmetro
  if (upperName === 'SUBREPORT_DIR') {
    return '/reports/';
  }
  if (upperName.includes('PACIENTE') || upperName.includes('CLIENTE') || upperName.includes('PESSOA') || upperName === 'NOME' || upperName.startsWith('NM_')) {
    return 'Maria da Silva';
  }
  if (upperName.includes('MEDICO') || upperName.includes('PROFISSIONAL')) {
    return 'Dr. Carlos Eduardo';
  }
  if (upperName.includes('CPF')) {
    return '123.456.789-00';
  }
  if (upperName.includes('CNPJ')) {
    return '12.345.678/0001-90';
  }
  if (upperName.includes('CIDADE') || upperName.includes('MUNICIPIO')) {
    return 'São Paulo';
  }
  if (upperName === 'UF' || upperName.includes('ESTADO')) {
    return 'SP';
  }
  if (upperName.includes('EMAIL')) {
    return 'contato@hospitalexemplo.com.br';
  }
  if (upperName.includes('FONE') || upperName.includes('CELULAR') || upperName.includes('TEL')) {
    return '(11) 98765-4321';
  }
  if (upperName.includes('STATUS') || upperName.includes('SITUACAO')) {
    return 'ATIVO';
  }
  if (upperName.includes('SEXO') || upperName.includes('GENERO')) {
    return 'F';
  }
  if (upperName.startsWith('DS_') || upperName.includes('DESCRICAO') || upperName.includes('OBS')) {
    return 'Atendimento Clínico Geral';
  }
  return `Exemplo_${name}`;
}

/**
 * Gera a lista de entradas Mock para os campos, parâmetros e variáveis do relatório
 * (incluindo quaisquer referências presentes na expressão atual).
 */
export function generateMockDataForMetadata(
  metadata: JrxmlMetadata,
  expression?: string
): MockDataEntry[] {
  const entries: MockDataEntry[] = [];
  const seenKeys = new Set<string>();

  const referencedKeys = new Set<string>();
  if (expression) {
    const refRegex = /\$(F|P|V|R)!?\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = refRegex.exec(expression)) !== null) {
      referencedKeys.add(`$${m[1]}{${m[2].trim()}}`);
    }
  }

  const addEntry = (
    kind: 'F' | 'P' | 'V' | 'R',
    name: string,
    className: string,
    description?: string,
    defaultValue?: string
  ) => {
    const refKey = `$${kind}{${name}}`;
    if (seenKeys.has(refKey)) {
      return;
    }
    seenKeys.add(refKey);
    entries.push({
      refKey,
      kind,
      name,
      className: normalizeJavaTypeName(className),
      value: generateSyntheticValueForType(name, className, defaultValue),
      isNull: false,
      description,
      isReferenced: referencedKeys.has(refKey)
    });
  };

  for (const field of metadata.fields) {
    addEntry('F', field.name, field.className, field.description);
  }
  for (const param of metadata.parameters) {
    addEntry('P', param.name, param.className, param.description, param.defaultValue);
  }
  for (const variable of metadata.variables || []) {
    addEntry('V', variable.name, variable.className, variable.description);
  }
  for (const builtInVar of JASPER_BUILTIN_VARIABLES) {
    addEntry('V', builtInVar.name, builtInVar.className, builtInVar.description);
  }
  for (const builtInParam of JASPER_BUILTIN_PARAMETERS) {
    if (referencedKeys.has(`$P{${builtInParam.name}}`) || builtInParam.name === 'SUBREPORT_DIR') {
      addEntry(
        'P',
        builtInParam.name,
        builtInParam.className,
        builtInParam.description,
        builtInParam.defaultValue
      );
    }
  }

  // Se a expressão usa placeholders de snippets como $F{CAMPO}, $F{DATA}, $F{VALOR}, $F{COND}, inclui no mock para o preview funcionar imediatamente!
  if (expression) {
    const snippetDefaults: Record<string, { className: string; value: any; desc: string }> = {
      CAMPO: { className: 'java.lang.String', value: 'Maria da Silva', desc: 'Campo de exemplo (Snippet)' },
      DATA: { className: 'java.util.Date', value: '2026-10-31T14:30:00.000Z', desc: 'Data de exemplo (Snippet)' },
      VALOR: { className: 'java.math.BigDecimal', value: 1250.75, desc: 'Valor monetário de exemplo (Snippet)' },
      VL_TOTAL: { className: 'java.math.BigDecimal', value: 1250.75, desc: 'Valor total de exemplo' },
      COND: { className: 'java.lang.Boolean', value: true, desc: 'Condição booleana de exemplo (Snippet)' }
    };

    const refRegex = /\$(F|P|V|R)!?\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = refRegex.exec(expression)) !== null) {
      const kind = m[1] as 'F' | 'P' | 'V' | 'R';
      const name = m[2].trim();
      const refKey = `$${kind}{${name}}`;
      if (!seenKeys.has(refKey)) {
        const preset = snippetDefaults[name];
        seenKeys.add(refKey);
        entries.push({
          refKey,
          kind,
          name,
          className: preset ? preset.className : 'java.lang.String',
          value: preset ? preset.value : generateSyntheticValueForType(name, 'java.lang.String'),
          isNull: false,
          description: preset?.desc || 'Referência detectada na expressão',
          isReferenced: true
        });
      }
    }
  }

  // Ordena priorizando os itens referenciados na expressão atual
  return entries.sort((a, b) => {
    if (a.isReferenced && !b.isReferenced) {
      return -1;
    }
    if (!a.isReferenced && b.isReferenced) {
      return 1;
    }
    return a.refKey.localeCompare(b.refKey);
  });
}

/**
 * Formata uma data Java/JS segundo uma máscara `SimpleDateFormat` (`dd/MM/yyyy HH:mm:ss`).
 */
export function formatJavaDatePattern(dateInput: any, pattern: string): string {
  if (dateInput === null || dateInput === undefined) {
    throw new Error('NullPointerException: Cannot format null Date');
  }
  const d =
    dateInput instanceof Date
      ? dateInput
      : typeof dateInput === 'object' && typeof dateInput.__rawDate === 'object'
        ? (dateInput.__rawDate as Date)
        : new Date(dateInput);

  if (Number.isNaN(d.getTime())) {
    throw new Error(`IllegalArgumentException: Invalid Date value "${String(dateInput)}"`);
  }

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');

  const yyyy = String(d.getFullYear());
  const yy = yyyy.slice(-2);
  const MM = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const HH = pad2(d.getHours());
  const hh = pad2(d.getHours() % 12 || 12);
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  const SSS = pad3(d.getMilliseconds());

  return pattern
    .replace(/yyyy/g, yyyy)
    .replace(/yy/g, yy)
    .replace(/MM/g, MM)
    .replace(/dd/g, dd)
    .replace(/HH/g, HH)
    .replace(/hh/g, hh)
    .replace(/mm/g, mm)
    .replace(/ss/g, ss)
    .replace(/SSS/g, SSS);
}

/**
 * Formata um número segundo uma máscara `DecimalFormat` (`#,##0.00`, `R$ #,##0.00`, `0.00`).
 */
export function formatJavaDecimalPattern(numInput: any, pattern: string): string {
  if (numInput === null || numInput === undefined) {
    throw new Error('NullPointerException: Cannot format null Number');
  }
  const rawNum =
    typeof numInput === 'object' && numInput !== null && '__rawNumber' in numInput
      ? Number(numInput.__rawNumber)
      : Number(numInput);

  if (Number.isNaN(rawNum)) {
    throw new Error(`IllegalArgumentException: Cannot format given Object as a Number ("${String(numInput)}")`);
  }

  // Extrai prefixo e sufixo (ex: "R$ #,##0.00")
  const patternMatch = /^([^#0.,+-]*)([#0.,]+)(.*)$/.exec(pattern);
  const prefix = patternMatch ? patternMatch[1] : '';
  const corePattern = patternMatch ? patternMatch[2] : pattern;
  const suffix = patternMatch ? patternMatch[3] : '';

  const dotIdx = corePattern.lastIndexOf('.');
  const fractionPart = dotIdx >= 0 ? corePattern.slice(dotIdx + 1) : '';
  const minFractionDigits = (fractionPart.match(/0/g) || []).length;
  const maxFractionDigits = fractionPart.length;
  const useGrouping = corePattern.includes(',');

  const formatted = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: Math.max(minFractionDigits, maxFractionDigits),
    useGrouping
  }).format(rawNum);

  return `${prefix}${formatted}${suffix}`;
}

/**
 * Cria um objeto wrapper em tempo de execução que simula métodos Java + Groovy GDK
 * sobre `String`, `BigDecimal`, `Integer`, `Date` e `Boolean` para o avaliador de Preview.
 */
function installRuntimePrototypes(): void {
  const strProto = String.prototype as any;
  if (!strProto.__jasperPatched) {
    Object.defineProperty(strProto, '__jasperPatched', { value: true, enumerable: false });
    strProto.equals = function (other: any): boolean {
      if (other === null || other === undefined) {
        return false;
      }
      return String(this) === String(other);
    };
    strProto.equalsIgnoreCase = function (other: any): boolean {
      if (other === null || other === undefined) {
        return false;
      }
      return String(this).toLowerCase() === String(other).toLowerCase();
    };
    strProto.isEmpty = function (): boolean {
      return String(this).length === 0;
    };
    strProto.isBlank = function (): boolean {
      return String(this).trim().length === 0;
    };
    strProto.contains = function (sub: any): boolean {
      return String(this).includes(String(sub ?? ''));
    };
    strProto.replaceAll = function (regexStr: string, replacement: string): string {
      return String(this).replace(new RegExp(regexStr, 'g'), replacement);
    };
    strProto.capitalize = function (): string {
      const s = String(this);
      return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
    };
    strProto.uncapitalize = function (): string {
      const s = String(this);
      return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s;
    };
    strProto.padLeft = function (len: number, pad = ' '): string {
      return String(this).padStart(Number(len), String(pad));
    };
    strProto.padRight = function (len: number, pad = ' '): string {
      return String(this).padEnd(Number(len), String(pad));
    };
    strProto.center = function (len: number, pad = ' '): string {
      const s = String(this);
      const target = Number(len);
      if (s.length >= target) {
        return s;
      }
      const left = Math.floor((target - s.length) / 2);
      return s.padStart(s.length + left, String(pad)).padEnd(target, String(pad));
    };
    strProto.reverse = function (): string {
      return String(this).split('').reverse().join('');
    };
    strProto.toInteger = function (): number {
      const n = parseInt(String(this).trim(), 10);
      if (Number.isNaN(n)) {
        throw new Error(`NumberFormatException: For input string: "${String(this)}"`);
      }
      return n;
    };
    strProto.toBigDecimal = function (): number {
      const n = Number(String(this).trim());
      if (Number.isNaN(n)) {
        throw new Error(`NumberFormatException: For input string: "${String(this)}"`);
      }
      return n;
    };
    strProto.toDouble = strProto.toBigDecimal;
    strProto.toBoolean = function (): boolean {
      const s = String(this).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'y';
    };
    strProto.isNumber = function (): boolean {
      const s = String(this).trim();
      return s.length > 0 && !Number.isNaN(Number(s));
    };
    strProto.take = function (n: number): string {
      return String(this).slice(0, Math.max(0, Number(n)));
    };
    strProto.drop = function (n: number): string {
      return String(this).slice(Math.max(0, Number(n)));
    };
    strProto.tokenize = function (sep = ' '): string[] {
      return String(this)
        .split(sep)
        .filter((part) => part.length > 0);
    };
  }

  const numProto = Number.prototype as any;
  if (!numProto.__jasperPatched) {
    Object.defineProperty(numProto, '__jasperPatched', { value: true, enumerable: false });
    numProto.add = function (other: any): number {
      return Number(this) + Number(other);
    };
    numProto.plus = numProto.add;
    numProto.subtract = function (other: any): number {
      return Number(this) - Number(other);
    };
    numProto.minus = numProto.subtract;
    numProto.multiply = function (other: any): number {
      return Number(this) * Number(other);
    };
    numProto.divide = function (divisor: any, scaleOrMode?: number): number {
      const d = Number(divisor);
      if (d === 0) {
        throw new Error('ArithmeticException: Division by zero');
      }
      const res = Number(this) / d;
      if (typeof scaleOrMode === 'number' && scaleOrMode >= 0 && scaleOrMode <= 10) {
        return Number(res.toFixed(scaleOrMode));
      }
      return res;
    };
    numProto.div = numProto.divide;
    numProto.setScale = function (scale: number): number {
      const s = Math.max(0, Math.min(20, Number(scale) || 0));
      return Number(Number(this).toFixed(s));
    };
    numProto.round = function (scale = 0): number {
      const s = Math.max(0, Math.min(20, Number(scale) || 0));
      return Number(Number(this).toFixed(s));
    };
    numProto.abs = function (): number {
      return Math.abs(Number(this));
    };
    numProto.negate = function (): number {
      return -Number(this);
    };
    numProto.intValue = function (): number {
      return Math.trunc(Number(this));
    };
    numProto.longValue = numProto.intValue;
    numProto.doubleValue = function (): number {
      return Number(this);
    };
    numProto.floatValue = numProto.doubleValue;
    numProto.compareTo = function (other: any): number {
      const a = Number(this);
      const b = Number(other);
      return a < b ? -1 : a > b ? 1 : 0;
    };
    numProto.equals = function (other: any): boolean {
      return Number(this) === Number(other);
    };
  }

  const boolProto = Boolean.prototype as any;
  if (!boolProto.__jasperPatched) {
    Object.defineProperty(boolProto, '__jasperPatched', { value: true, enumerable: false });
    boolProto.booleanValue = function (): boolean {
      return Boolean(this.valueOf());
    };
    boolProto.equals = function (other: any): boolean {
      return Boolean(this.valueOf()) === Boolean(other);
    };
  }

  const dateProto = Date.prototype as any;
  if (!dateProto.__jasperPatched) {
    Object.defineProperty(dateProto, '__jasperPatched', { value: true, enumerable: false });
    dateProto.format = function (pattern = 'dd/MM/yyyy'): string {
      return formatJavaDatePattern(this, pattern);
    };
    dateProto.before = function (other: Date): boolean {
      return this.getTime() < new Date(other).getTime();
    };
    dateProto.after = function (other: Date): boolean {
      return this.getTime() > new Date(other).getTime();
    };
    dateProto.equals = function (other: any): boolean {
      if (!other) {
        return false;
      }
      return this.getTime() === new Date(other).getTime();
    };
    dateProto.compareTo = function (other: Date): number {
      const t1 = this.getTime();
      const t2 = new Date(other).getTime();
      return t1 < t2 ? -1 : t1 > t2 ? 1 : 0;
    };
    dateProto.clearTime = function (): Date {
      const copy = new Date(this.getTime());
      copy.setHours(0, 0, 0, 0);
      return copy;
    };
    dateProto.plus = function (days: number): Date {
      const copy = new Date(this.getTime());
      copy.setDate(copy.getDate() + Number(days));
      return copy;
    };
    dateProto.minus = function (days: number): Date {
      const copy = new Date(this.getTime());
      copy.setDate(copy.getDate() - Number(days));
      return copy;
    };
  }
}

/**
 * Transpila uma expressão JasperReports (Java/Groovy) para uma expressão avaliável
 * no sandbox de Preview com suporte a `$F{}`, `$P{}`, `$V{}`, `?.`, `?:`, `<=>`,
 * `SimpleDateFormat`, `DecimalFormat`, `BigDecimal`, `DateUtils`, `JRExtendedUtils`, etc.
 */
function transpileJasperExpressionForPreview(
  rawExpression: string,
  refMap: Map<string, string>
): string {
  let code = rawExpression.trim();

  // 1. Substitui referências $F{...}, $P{...}, $V{...}, $R{...} por acessos ao objeto __MOCK__
  code = code.replace(/\$(F|P|V|R)!?\{([^}]+)\}/g, (_, kind: string, name: string) => {
    const cleanKey = `$${kind}{${name.trim()}}`;
    const varIdent = `__ref_${refMap.size}`;
    if (!refMap.has(cleanKey)) {
      refMap.set(cleanKey, varIdent);
    }
    return refMap.get(cleanKey)!;
  });

  // 2. Normaliza classes com pacote Java completo para equivalentes do runtime de preview
  code = code
    .replace(/\bnew\s+java\.text\.SimpleDateFormat\b/g, 'new __SimpleDateFormat')
    .replace(/\bnew\s+SimpleDateFormat\b/g, 'new __SimpleDateFormat')
    .replace(/\bnew\s+java\.text\.DecimalFormat\b/g, 'new __DecimalFormat')
    .replace(/\bnew\s+DecimalFormat\b/g, 'new __DecimalFormat')
    .replace(/\bnew\s+java\.math\.BigDecimal\b/g, '__BigDecimal.valueOf')
    .replace(/\bnew\s+BigDecimal\b/g, '__BigDecimal.valueOf')
    .replace(/\bnew\s+(?:java\.lang\.)?Boolean\b/g, '__Boolean.valueOf')
    .replace(/\bnew\s+(?:java\.lang\.)?(?:Integer|Long|Short|Byte)\b/g, '__Integer.valueOf')
    .replace(/\bnew\s+(?:java\.lang\.)?(?:Double|Float)\b/g, '__Double.valueOf')
    .replace(/\bnew\s+java\.util\.Date\b/g, 'new Date')
    .replace(/\bnew\s+java\.util\.Locale\b/g, '__Locale.create')
    .replace(/\bnew\s+Locale\b/g, '__Locale.create')
    .replace(/\bjava\.math\.RoundingMode\./g, '__RoundingMode.')
    .replace(/\bRoundingMode\./g, '__RoundingMode.')
    .replace(/\bjava\.math\.BigDecimal\./g, '__BigDecimal.')
    .replace(/\bBigDecimal\./g, '__BigDecimal.')
    .replace(/\bjava\.lang\.Boolean\./g, '__Boolean.')
    .replace(/\bBoolean\./g, '__Boolean.')
    .replace(/\bjava\.lang\.Integer\./g, '__Integer.')
    .replace(/\bInteger\./g, '__Integer.')
    .replace(/\bjava\.lang\.Long\./g, '__Long.')
    .replace(/\bLong\./g, '__Long.')
    .replace(/\bjava\.lang\.Double\./g, '__Double.')
    .replace(/\bDouble\./g, '__Double.')
    .replace(/\bjava\.lang\.Float\./g, '__Double.')
    .replace(/\bFloat\./g, '__Double.')
    .replace(/\bjava\.lang\.String\./g, '__String.')
    .replace(/\bString\.format\b/g, '__String.format')
    .replace(/\bString\.valueOf\b/g, '__String.valueOf')
    .replace(/\bString\.join\b/g, '__String.join')
    .replace(/\bjava\.lang\.Math\./g, 'Math.')
    .replace(/\bjava\.util\.Objects\./g, '__Objects.')
    .replace(/\bObjects\./g, '__Objects.');

  // 3. Converte chamadas `.length()` de String Java para helper compatível
  code = code.replace(/\.length\s*\(\s*\)/g, '.length');

  // 4. Converte operador Spaceship Groovy `a <=> b`
  if (code.includes('<=>')) {
    const parts = splitTopLevelBinaryOperator(code, '<=>');
    if (parts) {
      code = `__spaceship((${parts.left}), (${parts.right}))`;
    }
  }

  // 5. Converte operador Elvis Groovy `a ?: b`
  let elvisGuard = 0;
  while (code.includes('?:') && elvisGuard < 10) {
    elvisGuard++;
    const parts = splitTopLevelBinaryOperator(code, '?:');
    if (parts) {
      code = `__elvis((${parts.left}), (${parts.right}))`;
    } else {
      break;
    }
  }

  return code;
}

/**
 * Avalia uma expressão JasperReports utilizando dados sintéticos (mock) ou customizados,
 * retornando o valor resultante, o tipo Java inferido/real e eventuais exceções em tempo de execução.
 */
export function evaluateExpressionWithMock(
  rawExpression: string,
  metadata: JrxmlMetadata,
  customMockValues?: Record<string, any>,
  language: ExpressionLanguage = 'groovy'
): ExpressionPreviewResult {
  const startTime = performance.now();
  installRuntimePrototypes();

  const trimmed = rawExpression.trim();
  if (!trimmed) {
    return {
      success: true,
      value: null,
      formattedValue: 'null',
      resultType: 'java.lang.Object',
      executionTimeMs: 0,
      mockDataUsed: {}
    };
  }

  const defaultMockEntries = generateMockDataForMetadata(metadata, trimmed);
  const mockDataUsed: Record<string, any> = {};

  for (const entry of defaultMockEntries) {
    if (customMockValues && Object.prototype.hasOwnProperty.call(customMockValues, entry.refKey)) {
      const rawCustom = customMockValues[entry.refKey];
      mockDataUsed[entry.refKey] = coerceMockValueToType(rawCustom, entry.className);
    } else {
      mockDataUsed[entry.refKey] = entry.isNull
        ? null
        : coerceMockValueToType(entry.value, entry.className);
    }
  }

  // Inclui também chaves extras passadas em customMockValues
  if (customMockValues) {
    for (const [key, val] of Object.entries(customMockValues)) {
      if (!Object.prototype.hasOwnProperty.call(mockDataUsed, key)) {
        mockDataUsed[key] = val;
      }
    }
  }

  const refMap = new Map<string, string>();
  const transpiled = transpileJasperExpressionForPreview(trimmed, refMap);

  const argNames: string[] = [];
  const argValues: any[] = [];
  for (const [refKey, identName] of refMap.entries()) {
    argNames.push(identName);
    const val = Object.prototype.hasOwnProperty.call(mockDataUsed, refKey)
      ? mockDataUsed[refKey]
      : null;
    argValues.push(val);
  }

  // Runtime helpers injetados no escopo da avaliação
  const runtimeHelpers: Record<string, any> = {
    __SimpleDateFormat: class {
      constructor(private readonly pattern: string) {}
      public format(dateVal: any): string {
        return formatJavaDatePattern(dateVal, this.pattern);
      }
      public parse(strVal: string): Date {
        return new Date(strVal);
      }
    },
    __DecimalFormat: class {
      constructor(private readonly pattern: string) {}
      public format(numVal: any): string {
        return formatJavaDecimalPattern(numVal, this.pattern);
      }
    },
    __BigDecimal: {
      ZERO: 0,
      ONE: 1,
      TEN: 10,
      ROUND_HALF_UP: 4,
      ROUND_HALF_EVEN: 6,
      valueOf: (v: any) => {
        if (v === null || v === undefined) {
          throw new Error('NullPointerException: BigDecimal.valueOf(null)');
        }
        const n = Number(v);
        if (Number.isNaN(n)) {
          throw new Error(`NumberFormatException: "${String(v)}" is not a valid BigDecimal`);
        }
        return n;
      }
    },
    __RoundingMode: {
      HALF_UP: 4,
      HALF_EVEN: 6,
      HALF_DOWN: 5,
      UP: 0,
      DOWN: 1,
      CEILING: 2,
      FLOOR: 3
    },
    __Boolean: {
      TRUE: true,
      FALSE: false,
      valueOf: (v: any) => {
        if (typeof v === 'boolean') {
          return v;
        }
        return String(v).toLowerCase() === 'true';
      },
      parseBoolean: (v: any) => String(v).toLowerCase() === 'true'
    },
    __Integer: {
      MAX_VALUE: 2147483647,
      MIN_VALUE: -2147483648,
      valueOf: (v: any) => {
        const n = parseInt(String(v), 10);
        if (Number.isNaN(n)) {
          throw new Error(`NumberFormatException: For input string: "${String(v)}"`);
        }
        return n;
      },
      parseInt: (v: any) => {
        const n = parseInt(String(v), 10);
        if (Number.isNaN(n)) {
          throw new Error(`NumberFormatException: For input string: "${String(v)}"`);
        }
        return n;
      },
      toString: (v: any) => String(v)
    },
    __Long: {
      MAX_VALUE: Number.MAX_SAFE_INTEGER,
      MIN_VALUE: Number.MIN_SAFE_INTEGER,
      valueOf: (v: any) => parseInt(String(v), 10),
      parseLong: (v: any) => parseInt(String(v), 10),
      toString: (v: any) => String(v)
    },
    __Double: {
      valueOf: (v: any) => {
        const n = Number(v);
        if (Number.isNaN(n)) {
          throw new Error(`NumberFormatException: For input string: "${String(v)}"`);
        }
        return n;
      },
      parseDouble: (v: any) => Number(v),
      parseFloat: (v: any) => Number(v),
      toString: (v: any) => String(v)
    },
    __String: {
      valueOf: (v: any) => (v === null || v === undefined ? 'null' : String(v)),
      join: (delim: string, items: any[]) => (Array.isArray(items) ? items.join(delim) : String(items)),
      format: (mask: string, ...args: any[]) => {
        let argIdx = 0;
        return String(mask).replace(/%(\.\d+)?([sdfb%])/g, (full, prec, spec) => {
          if (spec === '%') {
            return '%';
          }
          const val = args[argIdx++];
          if (spec === 'd') {
            return String(Math.trunc(Number(val) || 0));
          }
          if (spec === 'f') {
            const digits = prec ? parseInt(prec.slice(1), 10) : 2;
            return Number(val || 0).toFixed(digits);
          }
          return val === null || val === undefined ? 'null' : String(val);
        });
      }
    },
    __Objects: {
      equals: (a: any, b: any) => a === b,
      nonNull: (a: any) => a !== null && a !== undefined,
      isNull: (a: any) => a === null || a === undefined,
      toString: (a: any, nullDefault = 'null') =>
        a === null || a === undefined ? nullDefault : String(a)
    },
    __Locale: {
      create: (lang = 'pt', country = 'BR') => `${lang}_${country}`
    },
    DateUtils: {
      addDays: (d: any, days: number) => {
        const copy = new Date(d);
        copy.setDate(copy.getDate() + Number(days));
        return copy;
      },
      addMonths: (d: any, months: number) => {
        const copy = new Date(d);
        copy.setMonth(copy.getMonth() + Number(months));
        return copy;
      },
      addYears: (d: any, years: number) => {
        const copy = new Date(d);
        copy.setFullYear(copy.getFullYear() + Number(years));
        return copy;
      },
      toDate: (str: string, _pattern?: string) => new Date(str),
      format: (d: any, pattern = 'dd/MM/yyyy') => formatJavaDatePattern(d, pattern)
    },
    JRExtendedUtils: {
      formatCurrency: (num: any) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(num) || 0),
      formatNumber: (num: any, mask = '#,##0.00') => formatJavaDecimalPattern(num, mask)
    },
    __elvis: (left: any, right: any) => {
      if (left !== null && left !== undefined && left !== false && left !== '') {
        return left;
      }
      return right;
    },
    __spaceship: (a: any, b: any) => {
      if (a === b) {
        return 0;
      }
      if (a === null || a === undefined) {
        return -1;
      }
      if (b === null || b === undefined) {
        return 1;
      }
      return a < b ? -1 : 1;
    },
    // Funções built-in do JasperReports
    IF: (cond: any, tVal: any, fVal: any) => (cond ? tVal : fVal),
    CONCATENATE: (...parts: any[]) => parts.map((p) => (p === null || p === undefined ? '' : String(p))).join(''),
    NVL: (val: any, fallback: any) => (val !== null && val !== undefined ? val : fallback),
    ISNULL: (val: any) => val === null || val === undefined,
    UPPER: (s: any) => (s === null || s === undefined ? '' : String(s).toUpperCase()),
    LOWER: (s: any) => (s === null || s === undefined ? '' : String(s).toLowerCase()),
    TRIM: (s: any) => (s === null || s === undefined ? '' : String(s).trim()),
    LEN: (s: any) => (s === null || s === undefined ? 0 : String(s).length),
    LEFT: (s: any, n = 1) => String(s ?? '').slice(0, Number(n)),
    RIGHT: (s: any, n = 1) => String(s ?? '').slice(-Number(n)),
    MID: (s: any, start = 1, len = 1) => String(s ?? '').substr(Math.max(0, Number(start) - 1), Number(len)),
    DATEFORMAT: (d: any, pat = 'dd/MM/yyyy') => formatJavaDatePattern(d, pat),
    NOW: () => new Date(),
    TODAY: () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    },
    YEAR: (d: any) => new Date(d).getFullYear(),
    MONTH: (d: any) => new Date(d).getMonth() + 1,
    DAY: (d: any) => new Date(d).getDate(),
    ABS: (n: any) => Math.abs(Number(n)),
    ROUND: (n: any, scale = 0) => Number(Number(n).toFixed(Number(scale))),
    CEIL: (n: any) => Math.ceil(Number(n)),
    FLOOR: (n: any) => Math.floor(Number(n)),
    MIN: (...nums: any[]) => Math.min(...nums.map(Number)),
    MAX: (...nums: any[]) => Math.max(...nums.map(Number))
  };

  const helperNames = Object.keys(runtimeHelpers);
  const helperValues = helperNames.map((k) => runtimeHelpers[k]);

  try {
    const fn = new Function(
      ...helperNames,
      ...argNames,
      `"use strict"; return (${transpiled});`
    );
    const evaluated = fn(...helperValues, ...argValues);
    const executionTimeMs = Math.max(1, Math.round(performance.now() - startTime));

    const inferred = inferExpressionType(trimmed, metadata, language);
    const resultType = resolveRuntimeResultJavaType(evaluated, inferred);
    const formattedValue = formatRuntimeResultValue(evaluated);

    return {
      success: true,
      value: serializePreviewValue(evaluated),
      formattedValue,
      resultType,
      executionTimeMs,
      mockDataUsed: serializeMockRecord(mockDataUsed)
    };
  } catch (err) {
    const executionTimeMs = Math.max(1, Math.round(performance.now() - startTime));
    const rawMsg = err instanceof Error ? err.message : String(err);
    const normalizedErr = normalizeRuntimeExceptionMessage(rawMsg, refMap);

    return {
      success: false,
      value: null,
      formattedValue: 'Erro de Execução',
      resultType: inferExpressionType(trimmed, metadata, language),
      executionTimeMs,
      mockDataUsed: serializeMockRecord(mockDataUsed),
      error: normalizedErr
    };
  }
}

function coerceMockValueToType(rawVal: any, className: string): any {
  if (rawVal === null || rawVal === undefined || rawVal === '__NULL__') {
    return null;
  }
  const norm = normalizeJavaTypeName(className);
  if (norm === 'java.lang.Boolean') {
    if (typeof rawVal === 'boolean') {
      return rawVal;
    }
    return String(rawVal).toLowerCase() === 'true';
  }
  if (isNumericJavaType(norm)) {
    if (typeof rawVal === 'number') {
      return rawVal;
    }
    const parsed = Number(String(rawVal).replace(',', '.'));
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (isDateJavaType(norm)) {
    if (rawVal instanceof Date) {
      return rawVal;
    }
    const d = new Date(rawVal);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  return String(rawVal);
}

function resolveRuntimeResultJavaType(value: any, staticallyInferred: string): string {
  if (value === null || value === undefined) {
    return staticallyInferred !== 'java.lang.Object' ? `${staticallyInferred} (null)` : 'null';
  }
  if (value instanceof Date) {
    return staticallyInferred === 'java.sql.Timestamp' ? 'java.sql.Timestamp' : 'java.util.Date';
  }
  if (typeof value === 'boolean') {
    return 'java.lang.Boolean';
  }
  if (typeof value === 'number') {
    if (staticallyInferred && isNumericJavaType(staticallyInferred)) {
      return staticallyInferred;
    }
    return Number.isInteger(value) ? 'java.lang.Integer' : 'java.math.BigDecimal';
  }
  if (typeof value === 'string') {
    return 'java.lang.String';
  }
  if (Array.isArray(value)) {
    return 'java.util.List';
  }
  return staticallyInferred || 'java.lang.Object';
}

function formatRuntimeResultValue(value: any): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (value instanceof Date) {
    return formatJavaDatePattern(value, 'dd/MM/yyyy HH:mm:ss');
  }
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serializePreviewValue(value: any): any {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function serializeMockRecord(record: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

function normalizeRuntimeExceptionMessage(
  rawMsg: string,
  refMap: Map<string, string>
): { type: string; message: string; detail?: string } {
  let friendly = rawMsg;
  for (const [jasperRef, tempIdent] of refMap.entries()) {
    friendly = friendly.replace(new RegExp(`\\b${tempIdent}\\b`, 'g'), jasperRef);
  }

  if (
    friendly.includes('Cannot read properties of null') ||
    friendly.includes('Cannot read properties of undefined') ||
    friendly.includes('NullPointerException')
  ) {
    const propMatch = /reading '([^']+)'/.exec(friendly);
    const propName = propMatch ? propMatch[1] : 'método/propriedade';
    return {
      type: 'java.lang.NullPointerException',
      message: `NullPointerException: Tentativa de invocar '${propName}' sobre uma referência nula (null).`,
      detail: 'Dica: Use o operador Groovy Safe Navigation (?.) ou verifique se o campo é != null.'
    };
  }

  if (friendly.includes('ArithmeticException')) {
    return {
      type: 'java.lang.ArithmeticException',
      message: friendly.replace(/^Error:\s*/, ''),
      detail: 'Verifique se o divisor pode ser zero antes de realizar a divisão.'
    };
  }

  if (friendly.includes('NumberFormatException')) {
    return {
      type: 'java.lang.NumberFormatException',
      message: friendly.replace(/^Error:\s*/, ''),
      detail: 'O texto informado não pôde ser convertido em valor numérico.'
    };
  }

  if (friendly.includes('is not a function')) {
    return {
      type: 'groovy.lang.MissingMethodException',
      message: `Método não encontrado ou não suportado na expressão: ${friendly}`,
      detail: 'Verifique o nome do método e os tipos dos argumentos.'
    };
  }

  return {
    type: 'net.sf.jasperreports.engine.fill.JRExpressionEvalException',
    message: `Erro ao avaliar expressão: ${friendly}`
  };
}

/**
 * Serviço central do Expression Editor (Etapa 9).
 */
export class ExpressionEditorService {
  public getSnippets(metadata?: JrxmlMetadata, fields?: JrxmlField[]): ExpressionSnippetDefinition[] {
    void metadata;
    void fields;
    return EXPRESSION_SNIPPETS;
  }

  public detectLanguage(xmlContent: string): ExpressionLanguage {
    return detectReportLanguage(xmlContent);
  }

  public extractExpressions(xmlContent: string): JrxmlExpressionOccurrence[] {
    return extractExpressionsFromXml(xmlContent);
  }

  public findExpressionAtLine(
    xmlContent: string,
    lineZeroBased: number,
    characterZeroBased = 0
  ): JrxmlExpressionOccurrence | undefined {
    return findExpressionAtLine(xmlContent, lineZeroBased, characterZeroBased);
  }

  public validate(
    expression: string,
    metadata: JrxmlMetadata,
    options?: {
      language?: ExpressionLanguage;
      expectedType?: string;
      tagName?: string;
    }
  ): ExpressionValidationResult {
    return validateExpression(expression, metadata, options);
  }

  public inferType(
    expression: string,
    metadata: JrxmlMetadata,
    language: ExpressionLanguage = 'groovy'
  ): string {
    return inferExpressionType(expression, metadata, language);
  }

  public generateMockData(metadata: JrxmlMetadata, expression?: string): MockDataEntry[] {
    return generateMockDataForMetadata(metadata, expression);
  }

  public evaluatePreview(
    expression: string,
    metadata: JrxmlMetadata,
    customMockValues?: Record<string, any>,
    language: ExpressionLanguage = 'groovy'
  ): ExpressionPreviewResult {
    return evaluateExpressionWithMock(expression, metadata, customMockValues, language);
  }

  public async applyEdit(
    document: vscode.TextDocument,
    occurrence: JrxmlExpressionOccurrence,
    newExpression: string
  ): Promise<boolean> {
    return applyExpressionEditToDocument(document, occurrence, newExpression);
  }
}

export const expressionEditorService = new ExpressionEditorService();
