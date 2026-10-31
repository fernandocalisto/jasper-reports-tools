import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  classifyDiffCategory,
  decodeXmlEntities,
  DiffCategory,
  diffJasperExpressions,
  diffSqlQueries,
  stripNamespacePrefix,
  unwrapCdata
} from './reportDiffSemantic';
import { RunnerService } from './runnerService';

export { DiffCategory };

export type DiffFilter = DiffCategory;

export const ALL_DIFF_CATEGORIES: DiffCategory[] = [
  'structure',
  'attributes',
  'query',
  'parameters',
  'fields',
  'variables',
  'styles',
  'expressions',
  'subreports'
];

export interface DiffCancellationToken {
  isCancellationRequested: boolean;
}

export interface DiffOptions {
  ignoreWhitespace?: boolean;
  ignoreAttributeOrder?: boolean;
  ignoreUUID?: boolean;
  semanticQueryDiff?: boolean;
  semanticExpressionDiff?: boolean;
  filters?: DiffFilter[];
  cancellationToken?: DiffCancellationToken;
  labelA?: string;
  labelB?: string;
}

export interface DiffChange {
  id: string;
  type: 'added' | 'removed' | 'modified' | 'moved';
  path: string;
  category: DiffCategory;
  description?: string;
  elementName?: string;
  attributeName?: string;
  oldValue?: string;
  newValue?: string;
  normalizedOldValue?: string;
  normalizedNewValue?: string;
  lineA?: number;
  lineB?: number;
  endLineA?: number;
  endLineB?: number;
  semantic?: boolean;
  semanticallyEqual?: boolean;
}

export interface InlineHighlightRange {
  start: number;
  end: number;
}

export interface DiffLinePair {
  lineNumberA?: number;
  lineNumberB?: number;
  textA?: string;
  textB?: string;
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  category?: DiffCategory;
  changeId?: string;
  inlineHighlightsA?: InlineHighlightRange[];
  inlineHighlightsB?: InlineHighlightRange[];
}

export interface DiffFileMetadata {
  path: string;
  name: string;
  hash: string;
  size: number;
  lineCount: number;
}

export interface CategorySummaryCounts {
  added: number;
  removed: number;
  modified: number;
  total: number;
}

export interface DiffResult {
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    byCategory: Record<DiffCategory, CategorySummaryCounts>;
  };
  changes: DiffChange[];
  lineDiff: DiffLinePair[];
  contentA: string;
  contentB: string;
  metadata: {
    fileA: DiffFileMetadata;
    fileB: DiffFileMetadata;
    diffTimeMs: number;
    cancelled?: boolean;
  };
}

interface XmlElementNode {
  tagName: string;
  rawTagName: string;
  attributes: Record<string, string>;
  attributeLines: Record<string, number>;
  textContent: string;
  rawInnerXml: string;
  children: XmlElementNode[];
  startLine: number;
  endLine: number;
  xpath: string;
  identityKey: string;
  ancestorTags: string[];
}

const STREAM_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MB

const EXPRESSION_TAG_SET = new Set<string>([
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
  'subreportExpression',
  'connectionExpression',
  'dataSourceExpression',
  'subreportParameterExpression',
  'conditionExpression',
  'groupExpression'
]);

const SINGLETON_REPORT_SECTIONS = new Set<string>([
  'jasperReport',
  'queryString',
  'background',
  'title',
  'pageHeader',
  'columnHeader',
  'detail',
  'columnFooter',
  'pageFooter',
  'lastPageFooter',
  'summary',
  'noData',
  'reportElement',
  'textElement',
  'font',
  'paragraph',
  'box',
  'pen',
  'topPen',
  'leftPen',
  'bottomPen',
  'rightPen',
  'graphicElement'
]);

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToLine(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(1, low);
}

function parseAttributesWithLines(
  attrString: string,
  attrStartOffset: number,
  lineStarts: number[]
): { attributes: Record<string, string>; attributeLines: Record<string, number> } {
  const attributes: Record<string, string> = {};
  const attributeLines: Record<string, number> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const rawVal = match[2] !== undefined ? match[2] : match[3] || '';
    attributes[key] = decodeXmlEntities(rawVal);
    attributeLines[key] = offsetToLine(lineStarts, attrStartOffset + match.index);
  }

  return { attributes, attributeLines };
}

/**
 * Faz o parse rápido de um documento JRXML/XML em árvore de `XmlElementNode` com mapeamento exato de linhas.
 */
function parseXmlTree(xml: string, ignoreUUID = false): XmlElementNode | undefined {
  const lineStarts = computeLineStarts(xml);
  const stack: XmlElementNode[] = [];
  let root: XmlElementNode | undefined;

  const tokenRegex =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/([a-zA-Z0-9_:-]+)\s*>|<([a-zA-Z0-9_:-]+)((?:\s+[a-zA-Z0-9_:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*)(\/?)>/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(xml)) !== null) {
    const fullMatch = match[0];
    const matchStart = match.index;

    // Captura texto acumulado para o nó atual no topo da pilha
    if (stack.length > 0 && matchStart > lastIndex) {
      const textSegment = xml.slice(lastIndex, matchStart);
      stack[stack.length - 1].rawInnerXml += textSegment;
      stack[stack.length - 1].textContent += textSegment;
    }

    if (fullMatch.startsWith('<!\[CDATA\[')) {
      if (stack.length > 0) {
        stack[stack.length - 1].rawInnerXml += fullMatch;
        stack[stack.length - 1].textContent += fullMatch;
      }
      lastIndex = tokenRegex.lastIndex;
      continue;
    }

    if (fullMatch.startsWith('<!--') || fullMatch.startsWith('<?')) {
      lastIndex = tokenRegex.lastIndex;
      continue;
    }

    const closingTag = match[1];
    if (closingTag) {
      const cleanClosing = stripNamespacePrefix(closingTag);
      const endLine = offsetToLine(lineStarts, tokenRegex.lastIndex - 1);

      // Desempilha até encontrar a tag correspondente
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName === cleanClosing) {
          const popped = stack.splice(i);
          for (const node of popped) {
            node.endLine = endLine;
            node.textContent = unwrapCdata(node.textContent);
          }
          break;
        }
      }

      lastIndex = tokenRegex.lastIndex;
      continue;
    }

    const openTagRaw = match[2];
    const attrBlock = match[3] || '';
    const selfClosing = match[4] === '/';

    if (openTagRaw) {
      const cleanTag = stripNamespacePrefix(openTagRaw);
      const startLine = offsetToLine(lineStarts, matchStart);
      const endLine = offsetToLine(lineStarts, tokenRegex.lastIndex - 1);
      const attrOffset = matchStart + 1 + openTagRaw.length;
      const { attributes, attributeLines } = parseAttributesWithLines(
        attrBlock,
        attrOffset,
        lineStarts
      );

      const parent = stack.length > 0 ? stack[stack.length - 1] : undefined;
      const ancestorTags = parent ? [...parent.ancestorTags, parent.tagName] : [];

      const node: XmlElementNode = {
        tagName: cleanTag,
        rawTagName: openTagRaw,
        attributes,
        attributeLines,
        textContent: '',
        rawInnerXml: '',
        children: [],
        startLine,
        endLine,
        xpath: '',
        identityKey: '',
        ancestorTags
      };

      if (parent) {
        parent.children.push(node);
      } else if (!root) {
        root = node;
      }

      if (!selfClosing) {
        stack.push(node);
      }
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (root) {
    assignNodePathsAndKeys(root, '', ignoreUUID);
  }

  return root;
}

/**
 * Atribui `xpath` legível e `identityKey` para pareamento inteligente entre relatórios A e B.
 */
function assignNodePathsAndKeys(
  node: XmlElementNode,
  parentXpath: string,
  ignoreUUID: boolean
): void {
  const tagCounts = new Map<string, number>();

  for (const child of node.children) {
    const idx = (tagCounts.get(child.tagName) ?? 0) + 1;
    tagCounts.set(child.tagName, idx);

    const nameAttr = child.attributes.name;
    const keyAttr = child.attributes.key || child.children.find((c) => c.tagName === 'reportElement')?.attributes.key;
    const uuidAttr =
      !ignoreUUID
        ? child.attributes.uuid || child.children.find((c) => c.tagName === 'reportElement')?.attributes.uuid
        : undefined;

    let descriptor = child.tagName;
    let identityKey: string;

    if (nameAttr) {
      descriptor = `${child.tagName}[@name="${nameAttr}"]`;
      identityKey = `${child.tagName}:name:${nameAttr}`;
    } else if (keyAttr) {
      descriptor = `${child.tagName}[@key="${keyAttr}"]`;
      identityKey = `${child.tagName}:key:${keyAttr}`;
    } else if (SINGLETON_REPORT_SECTIONS.has(child.tagName)) {
      descriptor = child.tagName;
      identityKey = `${child.tagName}:singleton`;
    } else if (uuidAttr) {
      descriptor = `${child.tagName}[${idx}]`;
      identityKey = `${child.tagName}:uuid:${uuidAttr}`;
    } else {
      descriptor = `${child.tagName}[${idx}]`;
      identityKey = `${child.tagName}:index:${idx}`;
    }

    child.xpath = `${parentXpath}/${descriptor}`;
    child.identityKey = identityKey;

    assignNodePathsAndKeys(child, child.xpath, ignoreUUID);
  }

  if (!parentXpath) {
    node.xpath = `/${node.tagName}`;
    node.identityKey = `${node.tagName}:root`;
  }
}

/**
 * Pareia filhos de dois nós XML usando chaves semânticas (`name`, `key`, `singleton`, `uuid`) e fallback posicional por tipo de tag.
 */
function matchChildNodes(
  childrenA: XmlElementNode[],
  childrenB: XmlElementNode[]
): Array<{
  nodeA?: XmlElementNode;
  nodeB?: XmlElementNode;
  moved?: boolean;
}> {
  const paired: Array<{ nodeA?: XmlElementNode; nodeB?: XmlElementNode; moved?: boolean }> = [];
  const usedB = new Set<number>();
  const matchedA = new Set<number>();

  // Passo 1: Match exato por identityKey semântica (name, key, singleton, uuid)
  const keyMapB = new Map<string, number[]>();
  childrenB.forEach((childB, idxB) => {
    if (!childB.identityKey.includes(':index:')) {
      const list = keyMapB.get(childB.identityKey) ?? [];
      list.push(idxB);
      keyMapB.set(childB.identityKey, list);
    }
  });

  childrenA.forEach((childA, idxA) => {
    if (childA.identityKey.includes(':index:')) {
      return;
    }
    const candidates = keyMapB.get(childA.identityKey);
    if (candidates && candidates.length > 0) {
      const idxB = candidates.shift()!;
      usedB.add(idxB);
      matchedA.add(idxA);
      paired.push({
        nodeA: childA,
        nodeB: childrenB[idxB],
        moved: idxA !== idxB
      });
    }
  });

  // Passo 2: Para nós posicionais de mesma tagName (ex: <textField>, <staticText>, <band>),
  // tenta primeiro casar por conteúdo de expressão/texto idêntico, depois por ordem posicional da tag.
  const unmatchedByTagA = new Map<string, Array<{ node: XmlElementNode; idx: number }>>();
  const unmatchedByTagB = new Map<string, Array<{ node: XmlElementNode; idx: number }>>();

  childrenA.forEach((childA, idxA) => {
    if (!matchedA.has(idxA)) {
      const list = unmatchedByTagA.get(childA.tagName) ?? [];
      list.push({ node: childA, idx: idxA });
      unmatchedByTagA.set(childA.tagName, list);
    }
  });

  childrenB.forEach((childB, idxB) => {
    if (!usedB.has(idxB)) {
      const list = unmatchedByTagB.get(childB.tagName) ?? [];
      list.push({ node: childB, idx: idxB });
      unmatchedByTagB.set(childB.tagName, list);
    }
  });

  const allUnmatchedTags = new Set<string>([
    ...unmatchedByTagA.keys(),
    ...unmatchedByTagB.keys()
  ]);

  for (const tag of allUnmatchedTags) {
    const listA = unmatchedByTagA.get(tag) ?? [];
    const listB = unmatchedByTagB.get(tag) ?? [];
    const localUsedB = new Set<number>();
    const localMatchedA = new Set<number>();

    // Sub-passo 2a: Assinatura de conteúdo (ex: mesmo texto de <staticText> ou <textFieldExpression>)
    for (let i = 0; i < listA.length; i++) {
      const sigA = getElementContentSignature(listA[i].node);
      if (!sigA) {
        continue;
      }
      for (let j = 0; j < listB.length; j++) {
        if (localUsedB.has(j)) {
          continue;
        }
        const sigB = getElementContentSignature(listB[j].node);
        if (sigA === sigB) {
          localMatchedA.add(i);
          localUsedB.add(j);
          matchedA.add(listA[i].idx);
          usedB.add(listB[j].idx);
          paired.push({
            nodeA: listA[i].node,
            nodeB: listB[j].node,
            moved: i !== j
          });
          break;
        }
      }
    }

    // Sub-passo 2b: Pareamento posicional entre os restantes de mesma tag
    const remA = listA.filter((_, i) => !localMatchedA.has(i));
    const remB = listB.filter((_, j) => !localUsedB.has(j));
    const minLen = Math.min(remA.length, remB.length);

    for (let k = 0; k < minLen; k++) {
      matchedA.add(remA[k].idx);
      usedB.add(remB[k].idx);
      paired.push({
        nodeA: remA[k].node,
        nodeB: remB[k].node,
        moved: false
      });
    }

    for (let k = minLen; k < remA.length; k++) {
      matchedA.add(remA[k].idx);
      paired.push({ nodeA: remA[k].node });
    }

    for (let k = minLen; k < remB.length; k++) {
      usedB.add(remB[k].idx);
      paired.push({ nodeB: remB[k].node });
    }
  }

  return paired.sort((x, y) => {
    const lineX = x.nodeA?.startLine ?? x.nodeB?.startLine ?? 0;
    const lineY = y.nodeA?.startLine ?? y.nodeB?.startLine ?? 0;
    return lineX - lineY;
  });
}

function getElementContentSignature(node: XmlElementNode): string | undefined {
  if (node.textContent) {
    return node.textContent;
  }
  for (const child of node.children) {
    if (
      child.tagName === 'text' ||
      child.tagName === 'textFieldExpression' ||
      child.tagName === 'subreportExpression' ||
      child.tagName === 'imageExpression'
    ) {
      if (child.textContent) {
        return `${child.tagName}:${child.textContent}`;
      }
    }
  }
  return undefined;
}

function summarizeNodeValue(node: XmlElementNode): string {
  const attrs = Object.entries(node.attributes)
    .filter(([k]) => k !== 'uuid')
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  const header = attrs ? `<${node.tagName} ${attrs}>` : `<${node.tagName}>`;
  if (node.textContent) {
    const shortText =
      node.textContent.length > 140
        ? `${node.textContent.slice(0, 140)}...`
        : node.textContent;
    return `${header} ${shortText}`;
  }
  return header;
}

/**
 * Calcula highlights inline (intervalos de caracteres alterados) entre duas linhas modificadas.
 */
function computeInlineHighlights(
  lineA: string,
  lineB: string
): { highlightsA: InlineHighlightRange[]; highlightsB: InlineHighlightRange[] } {
  let prefixLen = 0;
  const minLen = Math.min(lineA.length, lineB.length);
  while (prefixLen < minLen && lineA.charCodeAt(prefixLen) === lineB.charCodeAt(prefixLen)) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    lineA.charCodeAt(lineA.length - 1 - suffixLen) ===
      lineB.charCodeAt(lineB.length - 1 - suffixLen)
  ) {
    suffixLen++;
  }

  const endA = lineA.length - suffixLen;
  const endB = lineB.length - suffixLen;

  return {
    highlightsA: endA > prefixLen ? [{ start: prefixLen, end: endA }] : [],
    highlightsB: endB > prefixLen ? [{ start: prefixLen, end: endB }] : []
  };
}

/**
 * Normaliza uma linha XML de acordo com as opções de diff (`ignoreWhitespace`, `ignoreUUID`, `ignoreAttributeOrder`).
 */
function normalizeLineForComparison(line: string, options: DiffOptions): string {
  let result = line;

  if (options.ignoreUUID) {
    result = result.replace(/\s+uuid\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  }

  if (options.ignoreAttributeOrder && result.includes('=')) {
    result = result.replace(
      /<([a-zA-Z0-9_:-]+)((?:\s+[a-zA-Z0-9_:-]+\s*=\s*(?:"[^"]*"|'[^']*'))+)(\s*\/?>)/g,
      (_, tag: string, attrsBlock: string, closing: string) => {
        const attrs: string[] = [];
        const attrRegex = /([a-zA-Z0-9_:-]+\s*=\s*(?:"[^"]*"|'[^']*'))/g;
        let m: RegExpExecArray | null;
        while ((m = attrRegex.exec(attrsBlock)) !== null) {
          attrs.push(m[1].trim());
        }
        attrs.sort((a, b) => a.localeCompare(b));
        return `<${tag} ${attrs.join(' ')}${closing}`;
      }
    );
  }

  if (options.ignoreWhitespace) {
    result = result.replace(/\s+/g, ' ').trim();
  }

  return result;
}

/**
 * Algoritmo rápido de Diff de Linhas (Myers O(ND) com ancoragem de prefixo/sufixo e janela adaptativa)
 * garantindo que diffs de 5.000+ linhas executem em poucos milissegundos.
 */
function computeLineDiff(
  linesA: string[],
  linesB: string[],
  options: DiffOptions,
  changes: DiffChange[]
): DiffLinePair[] {
  const n = linesA.length;
  const m = linesB.length;

  const normA = linesA.map((l) => normalizeLineForComparison(l, options));
  const normB = linesB.map((l) => normalizeLineForComparison(l, options));

  // Mapa rápido de linha -> categoria e changeId vindo da árvore semântica
  const lineCategoryA = new Map<number, { category: DiffCategory; changeId: string }>();
  const lineCategoryB = new Map<number, { category: DiffCategory; changeId: string }>();

  for (const ch of changes) {
    if (ch.lineA !== undefined) {
      const endA = ch.endLineA ?? ch.lineA;
      for (let l = ch.lineA; l <= endA; l++) {
        if (!lineCategoryA.has(l) || ch.category !== 'structure') {
          lineCategoryA.set(l, { category: ch.category, changeId: ch.id });
        }
      }
    }
    if (ch.lineB !== undefined) {
      const endB = ch.endLineB ?? ch.lineB;
      for (let l = ch.lineB; l <= endB; l++) {
        if (!lineCategoryB.has(l) || ch.category !== 'structure') {
          lineCategoryB.set(l, { category: ch.category, changeId: ch.id });
        }
      }
    }
  }

  // Ancoragem rápida de prefixo e sufixo idênticos
  let start = 0;
  while (start < n && start < m && normA[start] === normB[start]) {
    start++;
  }

  let endA = n - 1;
  let endB = m - 1;
  while (endA >= start && endB >= start && normA[endA] === normB[endB]) {
    endA--;
    endB--;
  }

  const pairs: DiffLinePair[] = [];

  for (let i = 0; i < start; i++) {
    pairs.push({
      lineNumberA: i + 1,
      lineNumberB: i + 1,
      textA: linesA[i],
      textB: linesB[i],
      type: 'unchanged'
    });
  }

  const midA = normA.slice(start, endA + 1);
  const midB = normB.slice(start, endB + 1);
  const ops = diffSequencesFast(midA, midB, options.cancellationToken);

  // Converte sequência de operações ('equal', 'delete', 'insert') em pares lado-a-lado,
  // combinando blocos adjacentes de delete + insert em linhas 'modified'.
  let idxOp = 0;
  while (idxOp < ops.length) {
    const op = ops[idxOp];
    if (op.type === 'equal') {
      const realLineA = start + op.indexA! + 1;
      const realLineB = start + op.indexB! + 1;
      pairs.push({
        lineNumberA: realLineA,
        lineNumberB: realLineB,
        textA: linesA[realLineA - 1],
        textB: linesB[realLineB - 1],
        type: 'unchanged'
      });
      idxOp++;
      continue;
    }

    // Coleta hunk contíguo de deletes e inserts
    const dels: number[] = [];
    const ins: number[] = [];
    while (idxOp < ops.length && ops[idxOp].type !== 'equal') {
      if (ops[idxOp].type === 'delete') {
        dels.push(start + ops[idxOp].indexA! + 1);
      } else if (ops[idxOp].type === 'insert') {
        ins.push(start + ops[idxOp].indexB! + 1);
      }
      idxOp++;
    }

    const common = Math.min(dels.length, ins.length);
    for (let k = 0; k < common; k++) {
      const lA = dels[k];
      const lB = ins[k];
      const txtA = linesA[lA - 1];
      const txtB = linesB[lB - 1];
      const { highlightsA, highlightsB } = computeInlineHighlights(txtA, txtB);
      const catInfo =
        lineCategoryA.get(lA) ??
        lineCategoryB.get(lB) ??
        inferLineCategoryFromText(txtA, txtB);

      pairs.push({
        lineNumberA: lA,
        lineNumberB: lB,
        textA: txtA,
        textB: txtB,
        type: 'modified',
        category: catInfo.category,
        changeId: catInfo.changeId,
        inlineHighlightsA: highlightsA,
        inlineHighlightsB: highlightsB
      });
    }

    for (let k = common; k < dels.length; k++) {
      const lA = dels[k];
      const txtA = linesA[lA - 1];
      const catInfo = lineCategoryA.get(lA) ?? inferLineCategoryFromText(txtA, '');
      pairs.push({
        lineNumberA: lA,
        textA: txtA,
        type: 'removed',
        category: catInfo.category,
        changeId: catInfo.changeId
      });
    }

    for (let k = common; k < ins.length; k++) {
      const lB = ins[k];
      const txtB = linesB[lB - 1];
      const catInfo = lineCategoryB.get(lB) ?? inferLineCategoryFromText('', txtB);
      pairs.push({
        lineNumberB: lB,
        textB: txtB,
        type: 'added',
        category: catInfo.category,
        changeId: catInfo.changeId
      });
    }
  }

  const suffixCount = n - 1 - endA;
  for (let i = 0; i < suffixCount; i++) {
    const lA = endA + 1 + i + 1;
    const lB = endB + 1 + i + 1;
    pairs.push({
      lineNumberA: lA,
      lineNumberB: lB,
      textA: linesA[lA - 1],
      textB: linesB[lB - 1],
      type: 'unchanged'
    });
  }

  return pairs;
}

interface SeqOp {
  type: 'equal' | 'delete' | 'insert';
  indexA?: number;
  indexB?: number;
}

/**
 * Diff de sequências baseado em âncoras de linhas únicas (Patience-like) + Myers/LCS,
 * garantindo complexidade quase-linear mesmo em arquivos de 5.000 a 20.000 linhas.
 */
function diffSequencesFast(
  seqA: string[],
  seqB: string[],
  token?: DiffCancellationToken
): SeqOp[] {
  const N = seqA.length;
  const M = seqB.length;

  if (N === 0 && M === 0) {
    return [];
  }
  if (N === 0) {
    return seqB.map((_, j) => ({ type: 'insert' as const, indexB: j }));
  }
  if (M === 0) {
    return seqA.map((_, i) => ({ type: 'delete' as const, indexA: i }));
  }

  // Se o produto N * M for pequeno, executa LCS/Myers exato diretamente
  if (N * M <= 400_000) {
    return lcsDiffSmall(seqA, 0, N, seqB, 0, M);
  }

  // Para arquivos grandes (ex: 5000 linhas), encontra âncoras de linhas e divide em subproblemas pequenos
  const anchors = findMonotonicAnchors(seqA, seqB);
  const result: SeqOp[] = [];
  let prevA = 0;
  let prevB = 0;

  for (const anchor of anchors) {
    if (token?.isCancellationRequested) {
      break;
    }
    const subA = anchor.indexA - prevA;
    const subB = anchor.indexB - prevB;
    if (subA > 0 || subB > 0) {
      result.push(...diffSubrange(seqA, prevA, anchor.indexA, seqB, prevB, anchor.indexB));
    }
    result.push({
      type: 'equal',
      indexA: anchor.indexA,
      indexB: anchor.indexB
    });
    prevA = anchor.indexA + 1;
    prevB = anchor.indexB + 1;
  }

  if (prevA < N || prevB < M) {
    result.push(...diffSubrange(seqA, prevA, N, seqB, prevB, M));
  }

  return result;
}

function diffSubrange(
  seqA: string[],
  startA: number,
  endA: number,
  seqB: string[],
  startB: number,
  endB: number
): SeqOp[] {
  let sA = startA;
  let sB = startB;
  while (sA < endA && sB < endB && seqA[sA] === seqB[sB]) {
    sA++;
    sB++;
  }

  let eA = endA - 1;
  let eB = endB - 1;
  while (eA >= sA && eB >= sB && seqA[eA] === seqB[eB]) {
    eA--;
    eB--;
  }

  const ops: SeqOp[] = [];
  for (let i = 0; i < sA - startA; i++) {
    ops.push({ type: 'equal', indexA: startA + i, indexB: startB + i });
  }

  const lenA = eA - sA + 1;
  const lenB = eB - sB + 1;

  if (lenA > 0 && lenB > 0) {
    if (lenA * lenB <= 400_000) {
      ops.push(...lcsDiffSmall(seqA, sA, eA + 1, seqB, sB, eB + 1));
    } else {
      // Fallback greedy por hash quando um bloco sem âncoras únicas é muito grande
      ops.push(...greedyHashDiff(seqA, sA, eA + 1, seqB, sB, eB + 1));
    }
  } else if (lenA > 0) {
    for (let i = sA; i <= eA; i++) {
      ops.push({ type: 'delete', indexA: i });
    }
  } else if (lenB > 0) {
    for (let j = sB; j <= eB; j++) {
      ops.push({ type: 'insert', indexB: j });
    }
  }

  const suffixLen = endA - 1 - eA;
  for (let i = 0; i < suffixLen; i++) {
    ops.push({ type: 'equal', indexA: eA + 1 + i, indexB: eB + 1 + i });
  }

  return ops;
}

function findMonotonicAnchors(
  seqA: string[],
  seqB: string[]
): Array<{ indexA: number; indexB: number }> {
  const countA = new Map<string, number>();
  const posA = new Map<string, number>();
  const countB = new Map<string, number>();
  const posB = new Map<string, number>();

  for (let i = 0; i < seqA.length; i++) {
    const s = seqA[i];
    if (!s) {
      continue;
    }
    countA.set(s, (countA.get(s) ?? 0) + 1);
    posA.set(s, i);
  }

  for (let j = 0; j < seqB.length; j++) {
    const s = seqB[j];
    if (!s) {
      continue;
    }
    countB.set(s, (countB.get(s) ?? 0) + 1);
    posB.set(s, j);
  }

  const candidates: Array<{ indexA: number; indexB: number }> = [];
  for (const [line, cA] of countA.entries()) {
    if (cA === 1 && countB.get(line) === 1) {
      candidates.push({
        indexA: posA.get(line)!,
        indexB: posB.get(line)!
      });
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  candidates.sort((a, b) => a.indexA - b.indexA);

  // Longest Increasing Subsequence (LIS) em indexB
  const tails: number[] = [];
  const prevIndices = new Int32Array(candidates.length).fill(-1);

  for (let i = 0; i < candidates.length; i++) {
    const valB = candidates[i].indexB;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (candidates[tails[mid]].indexB < valB) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo > 0) {
      prevIndices[i] = tails[lo - 1];
    }
    tails[lo] = i;
  }

  const lis: Array<{ indexA: number; indexB: number }> = [];
  let curr = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (curr !== -1) {
    lis.push(candidates[curr]);
    curr = prevIndices[curr];
  }
  return lis.reverse();
}

function lcsDiffSmall(
  seqA: string[],
  startA: number,
  endA: number,
  seqB: string[],
  startB: number,
  endB: number
): SeqOp[] {
  const n = endA - startA;
  const m = endB - startB;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    const rowOffset = i * width;
    const nextRowOffset = (i + 1) * width;
    const valA = seqA[startA + i];
    for (let j = m - 1; j >= 0; j--) {
      if (valA === seqB[startB + j]) {
        dp[rowOffset + j] = 1 + dp[nextRowOffset + j + 1];
      } else {
        const down = dp[nextRowOffset + j];
        const right = dp[rowOffset + j + 1];
        dp[rowOffset + j] = down >= right ? down : right;
      }
    }
  }

  const ops: SeqOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (seqA[startA + i] === seqB[startB + j]) {
      ops.push({ type: 'equal', indexA: startA + i, indexB: startB + j });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      ops.push({ type: 'delete', indexA: startA + i });
      i++;
    } else {
      ops.push({ type: 'insert', indexB: startB + j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'delete', indexA: startA + i });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'insert', indexB: startB + j });
    j++;
  }

  return ops;
}

function greedyHashDiff(
  seqA: string[],
  startA: number,
  endA: number,
  seqB: string[],
  startB: number,
  endB: number
): SeqOp[] {
  const ops: SeqOp[] = [];
  let i = startA;
  let j = startB;
  const lookahead = 25;

  while (i < endA && j < endB) {
    if (seqA[i] === seqB[j]) {
      ops.push({ type: 'equal', indexA: i, indexB: j });
      i++;
      j++;
      continue;
    }

    let foundMatch = false;
    for (let dist = 1; dist <= lookahead; dist++) {
      if (i + dist < endA && seqA[i + dist] === seqB[j]) {
        for (let k = 0; k < dist; k++) {
          ops.push({ type: 'delete', indexA: i + k });
        }
        i += dist;
        foundMatch = true;
        break;
      }
      if (j + dist < endB && seqA[i] === seqB[j + dist]) {
        for (let k = 0; k < dist; k++) {
          ops.push({ type: 'insert', indexB: j + k });
        }
        j += dist;
        foundMatch = true;
        break;
      }
    }

    if (!foundMatch) {
      ops.push({ type: 'delete', indexA: i });
      ops.push({ type: 'insert', indexB: j });
      i++;
      j++;
    }
  }

  while (i < endA) {
    ops.push({ type: 'delete', indexA: i++ });
  }
  while (j < endB) {
    ops.push({ type: 'insert', indexB: j++ });
  }

  return ops;
}

function inferLineCategoryFromText(
  textA: string,
  textB: string
): { category: DiffCategory; changeId?: string } {
  const combined = `${textA} ${textB}`;

  if (/<\/?queryString\b/i.test(combined) || /\bSELECT\b|\bFROM\b|\bWHERE\b/i.test(combined)) {
    return { category: 'query' };
  }
  if (/<\/?(?:subreport|subreportParameter|subreportExpression|connectionExpression|returnValue)\b/i.test(combined)) {
    return { category: 'subreports' };
  }
  if (/<\/?(?:parameter|parameterDescription)\b/i.test(combined)) {
    return { category: 'parameters' };
  }
  if (/<\/?(?:field|fieldDescription)\b/i.test(combined)) {
    return { category: 'fields' };
  }
  if (/<\/?(?:variable|variableExpression|initialValueExpression)\b/i.test(combined)) {
    return { category: 'variables' };
  }
  if (/<\/?(?:style|conditionalStyle|font|box|pen|topPen|leftPen|bottomPen|rightPen|paragraph)\b/i.test(combined) || /\b(?:forecolor|backcolor|fontName|fontSize|pdfFontName|isBold|isItalic)\s*=/i.test(combined)) {
    return { category: 'styles' };
  }
  if (/<\/?[a-zA-Z]+Expression\b/i.test(combined) || /\$[PFVR]!?\{/.test(combined)) {
    return { category: 'expressions' };
  }
  if (/<reportElement\b/i.test(combined) || /\b(?:x|y|width|height|uuid)\s*=/i.test(combined)) {
    return { category: 'attributes' };
  }
  return { category: 'structure' };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createEmptyCategoryMap(): Record<DiffCategory, CategorySummaryCounts> {
  return {
    structure: { added: 0, removed: 0, modified: 0, total: 0 },
    attributes: { added: 0, removed: 0, modified: 0, total: 0 },
    query: { added: 0, removed: 0, modified: 0, total: 0 },
    parameters: { added: 0, removed: 0, modified: 0, total: 0 },
    fields: { added: 0, removed: 0, modified: 0, total: 0 },
    variables: { added: 0, removed: 0, modified: 0, total: 0 },
    styles: { added: 0, removed: 0, modified: 0, total: 0 },
    expressions: { added: 0, removed: 0, modified: 0, total: 0 },
    subreports: { added: 0, removed: 0, modified: 0, total: 0 }
  };
}

/**
 * Motor principal de comparação híbrida (XML AST + Semântico SQL/Expressões + Linha-a-linha)
 * para relatórios JasperReports (`.jrxml` e `.jasper`).
 */
export class ReportDiffEngine {
  private activeCancellation?: DiffCancellationToken;

  constructor(private readonly runnerService?: RunnerService) {}

  /**
   * Cancela a operação de diff em andamento.
   */
  public cancel(): void {
    if (this.activeCancellation) {
      this.activeCancellation.isCancellationRequested = true;
    }
  }

  /**
   * Compara dois arquivos de relatório (`.jrxml` ou `.jasper`) no sistema de arquivos.
   * Caso algum arquivo seja binário `.jasper`, descompila-o automaticamente em memória/temp antes do diff.
   */
  public async diff(
    fileA: string,
    fileB: string,
    options: DiffOptions = {}
  ): Promise<DiffResult> {
    const resolvedA = path.resolve(fileA);
    const resolvedB = path.resolve(fileB);

    const [loadedA, loadedB] = await Promise.all([
      this.loadReportContent(resolvedA),
      this.loadReportContent(resolvedB)
    ]);

    return this.diffContent(
      loadedA.content,
      loadedB.content,
      options,
      {
        path: options.labelA || resolvedA,
        name: path.basename(options.labelA || resolvedA),
        size: loadedA.size
      },
      {
        path: options.labelB || resolvedB,
        name: path.basename(options.labelB || resolvedB),
        size: loadedB.size
      }
    );
  }

  /**
   * Compara diretamente dois conteúdos XML (`.jrxml`).
   */
  public async diffContent(
    contentA: string,
    contentB: string,
    options: DiffOptions = {},
    metaA?: Partial<DiffFileMetadata>,
    metaB?: Partial<DiffFileMetadata>
  ): Promise<DiffResult> {
    const startTime = Date.now();
    const effectiveOptions: Required<
      Pick<
        DiffOptions,
        | 'ignoreWhitespace'
        | 'ignoreAttributeOrder'
        | 'ignoreUUID'
        | 'semanticQueryDiff'
        | 'semanticExpressionDiff'
      >
    > &
      DiffOptions = {
      ignoreWhitespace: options.ignoreWhitespace ?? false,
      ignoreAttributeOrder: options.ignoreAttributeOrder ?? true,
      ignoreUUID: options.ignoreUUID ?? false,
      semanticQueryDiff: options.semanticQueryDiff ?? true,
      semanticExpressionDiff: options.semanticExpressionDiff ?? true,
      ...options
    };

    const cancellationToken: DiffCancellationToken = options.cancellationToken ?? {
      isCancellationRequested: false
    };
    this.activeCancellation = cancellationToken;

    const normalizedEolA = contentA.replace(/\r\n/g, '\n');
    const normalizedEolB = contentB.replace(/\r\n/g, '\n');

    const linesA = normalizedEolA.split('\n');
    const linesB = normalizedEolB.split('\n');

    const hashA = crypto.createHash('md5').update(normalizedEolA, 'utf8').digest('hex').slice(0, 12);
    const hashB = crypto.createHash('md5').update(normalizedEolB, 'utf8').digest('hex').slice(0, 12);

    const rawChanges: DiffChange[] = [];
    let changeCounter = 0;
    const nextChangeId = (): string => `change-${++changeCounter}`;

    const treeA = parseXmlTree(normalizedEolA, effectiveOptions.ignoreUUID);
    const treeB = parseXmlTree(normalizedEolB, effectiveOptions.ignoreUUID);

    if (treeA && treeB && !cancellationToken.isCancellationRequested) {
      this.compareXmlNodes(
        treeA,
        treeB,
        effectiveOptions,
        rawChanges,
        nextChangeId,
        cancellationToken
      );
    }

    // Aplica filtro de categorias caso options.filters tenha sido fornecido
    const activeFilterSet =
      effectiveOptions.filters && effectiveOptions.filters.length > 0
        ? new Set<DiffCategory>(effectiveOptions.filters)
        : null;

    const filteredChanges = activeFilterSet
      ? rawChanges.filter((c) => activeFilterSet.has(c.category))
      : rawChanges;

    const lineDiff = cancellationToken.isCancellationRequested
      ? []
      : computeLineDiff(linesA, linesB, effectiveOptions, rawChanges);

    const byCategory = createEmptyCategoryMap();
    for (const change of filteredChanges) {
      const bucket = byCategory[change.category] ?? byCategory.structure;
      if (change.type === 'added') {
        bucket.added++;
      } else if (change.type === 'removed') {
        bucket.removed++;
      } else {
        bucket.modified++;
      }
      bucket.total++;
    }

    // Calcula estatísticas globais considerando os filtros ativos
    let addedCount = 0;
    let removedCount = 0;
    let modifiedCount = 0;
    let unchangedCount = 0;

    for (const pair of lineDiff) {
      if (pair.type === 'unchanged') {
        unchangedCount++;
        continue;
      }
      if (activeFilterSet && pair.category && !activeFilterSet.has(pair.category)) {
        unchangedCount++;
        continue;
      }
      if (pair.type === 'added') {
        addedCount++;
      } else if (pair.type === 'removed') {
        removedCount++;
      } else if (pair.type === 'modified') {
        modifiedCount++;
      }
    }

    // Se houve mudanças semânticas registradas mas 0 linhas no lineDiff (ou vice-versa), sincroniza
    if (addedCount === 0 && removedCount === 0 && modifiedCount === 0 && filteredChanges.length > 0) {
      for (const ch of filteredChanges) {
        if (ch.type === 'added') {
          addedCount++;
        } else if (ch.type === 'removed') {
          removedCount++;
        } else {
          modifiedCount++;
        }
      }
    }

    const diffTimeMs = Math.max(1, Date.now() - startTime);

    return {
      summary: {
        added: addedCount,
        removed: removedCount,
        modified: modifiedCount,
        unchanged: unchangedCount,
        byCategory
      },
      changes: filteredChanges,
      lineDiff,
      contentA: normalizedEolA,
      contentB: normalizedEolB,
      metadata: {
        fileA: {
          path: metaA?.path || effectiveOptions.labelA || 'Relatório A.jrxml',
          name:
            metaA?.name ||
            path.basename(metaA?.path || effectiveOptions.labelA || 'Relatório A.jrxml'),
          hash: hashA,
          size: metaA?.size ?? Buffer.byteLength(normalizedEolA, 'utf8'),
          lineCount: linesA.length
        },
        fileB: {
          path: metaB?.path || effectiveOptions.labelB || 'Relatório B.jrxml',
          name:
            metaB?.name ||
            path.basename(metaB?.path || effectiveOptions.labelB || 'Relatório B.jrxml'),
          hash: hashB,
          size: metaB?.size ?? Buffer.byteLength(normalizedEolB, 'utf8'),
          lineCount: linesB.length
        },
        diffTimeMs,
        cancelled: cancellationToken.isCancellationRequested
      }
    };
  }

  private compareXmlNodes(
    nodeA: XmlElementNode,
    nodeB: XmlElementNode,
    options: DiffOptions,
    changes: DiffChange[],
    nextChangeId: () => string,
    token: DiffCancellationToken
  ): void {
    if (token.isCancellationRequested) {
      return;
    }

    // 1. Compara atributos do nó atual
    this.compareNodeAttributes(nodeA, nodeB, options, changes, nextChangeId);

    // 2. Compara conteúdo textual / query SQL / Expressões
    const hasTextA = nodeA.textContent.length > 0;
    const hasTextB = nodeB.textContent.length > 0;

    if (hasTextA || hasTextB) {
      if (nodeA.tagName === 'queryString') {
        const sqlDiff = diffSqlQueries(nodeA.textContent, nodeB.textContent);
        const shouldReport = options.semanticQueryDiff
          ? !sqlDiff.semanticallyEqual || (!options.ignoreWhitespace && !sqlDiff.textuallyEqual)
          : !sqlDiff.textuallyEqual;

        if (shouldReport && !(options.semanticQueryDiff && sqlDiff.semanticallyEqual)) {
          changes.push({
            id: nextChangeId(),
            type: !hasTextA ? 'added' : !hasTextB ? 'removed' : 'modified',
            path: nodeB.xpath || nodeA.xpath,
            category: 'query',
            elementName: 'queryString',
            description: sqlDiff.summary,
            oldValue: sqlDiff.rawA,
            newValue: sqlDiff.rawB,
            normalizedOldValue: sqlDiff.normalizedA,
            normalizedNewValue: sqlDiff.normalizedB,
            lineA: nodeA.startLine,
            endLineA: nodeA.endLine,
            lineB: nodeB.startLine,
            endLineB: nodeB.endLine,
            semantic: Boolean(options.semanticQueryDiff),
            semanticallyEqual: sqlDiff.semanticallyEqual
          });
        }
      } else if (EXPRESSION_TAG_SET.has(nodeA.tagName)) {
        const exprDiff = diffJasperExpressions(nodeA.textContent, nodeB.textContent);
        const category = classifyDiffCategory(nodeA.tagName, nodeA.ancestorTags);
        const shouldReport = options.semanticExpressionDiff
          ? !exprDiff.semanticallyEqual
          : !exprDiff.textuallyEqual;

        if (shouldReport) {
          changes.push({
            id: nextChangeId(),
            type: !hasTextA ? 'added' : !hasTextB ? 'removed' : 'modified',
            path: nodeB.xpath || nodeA.xpath,
            category,
            elementName: nodeA.tagName,
            description: `${nodeA.tagName}: ${exprDiff.summary}`,
            oldValue: exprDiff.rawA,
            newValue: exprDiff.rawB,
            normalizedOldValue: exprDiff.normalizedA,
            normalizedNewValue: exprDiff.normalizedB,
            lineA: nodeA.startLine,
            endLineA: nodeA.endLine,
            lineB: nodeB.startLine,
            endLineB: nodeB.endLine,
            semantic: Boolean(options.semanticExpressionDiff),
            semanticallyEqual: exprDiff.semanticallyEqual
          });
        }
      } else {
        const valA = options.ignoreWhitespace
          ? nodeA.textContent.replace(/\s+/g, ' ').trim()
          : nodeA.textContent;
        const valB = options.ignoreWhitespace
          ? nodeB.textContent.replace(/\s+/g, ' ').trim()
          : nodeB.textContent;

        if (valA !== valB) {
          const category = classifyDiffCategory(nodeA.tagName, nodeA.ancestorTags);
          changes.push({
            id: nextChangeId(),
            type: !hasTextA ? 'added' : !hasTextB ? 'removed' : 'modified',
            path: nodeB.xpath || nodeA.xpath,
            category,
            elementName: nodeA.tagName,
            description: `Conteúdo de <${nodeA.tagName}> alterado`,
            oldValue: nodeA.textContent,
            newValue: nodeB.textContent,
            lineA: nodeA.startLine,
            endLineA: nodeA.endLine,
            lineB: nodeB.startLine,
            endLineB: nodeB.endLine,
            semantic: false
          });
        }
      }
    }

    // 3. Pareia e compara elementos filhos
    const childPairs = matchChildNodes(nodeA.children, nodeB.children);

    for (const pair of childPairs) {
      if (token.isCancellationRequested) {
        return;
      }

      if (pair.nodeA && !pair.nodeB) {
        const category = classifyDiffCategory(
          pair.nodeA.tagName,
          pair.nodeA.ancestorTags
        );
        changes.push({
          id: nextChangeId(),
          type: 'removed',
          path: pair.nodeA.xpath,
          category,
          elementName: pair.nodeA.tagName,
          description: `Removido <${pair.nodeA.tagName}>${
            pair.nodeA.attributes.name ? ` (${pair.nodeA.attributes.name})` : ''
          }`,
          oldValue: summarizeNodeValue(pair.nodeA),
          lineA: pair.nodeA.startLine,
          endLineA: pair.nodeA.endLine,
          semantic: true
        });
      } else if (!pair.nodeA && pair.nodeB) {
        const category = classifyDiffCategory(
          pair.nodeB.tagName,
          pair.nodeB.ancestorTags
        );
        changes.push({
          id: nextChangeId(),
          type: 'added',
          path: pair.nodeB.xpath,
          category,
          elementName: pair.nodeB.tagName,
          description: `Adicionado <${pair.nodeB.tagName}>${
            pair.nodeB.attributes.name ? ` (${pair.nodeB.attributes.name})` : ''
          }`,
          newValue: summarizeNodeValue(pair.nodeB),
          lineB: pair.nodeB.startLine,
          endLineB: pair.nodeB.endLine,
          semantic: true
        });
      } else if (pair.nodeA && pair.nodeB) {
        this.compareXmlNodes(
          pair.nodeA,
          pair.nodeB,
          options,
          changes,
          nextChangeId,
          token
        );
      }
    }
  }

  private compareNodeAttributes(
    nodeA: XmlElementNode,
    nodeB: XmlElementNode,
    options: DiffOptions,
    changes: DiffChange[],
    nextChangeId: () => string
  ): void {
    const keysA = Object.keys(nodeA.attributes);
    const keysB = Object.keys(nodeB.attributes);
    const allKeys = new Set<string>([...keysA, ...keysB]);

    for (const attrName of allKeys) {
      if (options.ignoreUUID && attrName.toLowerCase() === 'uuid') {
        continue;
      }

      const rawValA = nodeA.attributes[attrName];
      const rawValB = nodeB.attributes[attrName];

      const valA =
        rawValA !== undefined && options.ignoreWhitespace
          ? rawValA.trim()
          : rawValA;
      const valB =
        rawValB !== undefined && options.ignoreWhitespace
          ? rawValB.trim()
          : rawValB;

      if (valA === valB) {
        continue;
      }

      const category = classifyDiffCategory(
        nodeB.tagName || nodeA.tagName,
        nodeB.ancestorTags,
        attrName
      );
      const lineA = nodeA.attributeLines[attrName] ?? nodeA.startLine;
      const lineB = nodeB.attributeLines[attrName] ?? nodeB.startLine;
      const baseXpath = nodeB.xpath || nodeA.xpath;

      if (valA === undefined && valB !== undefined) {
        changes.push({
          id: nextChangeId(),
          type: 'added',
          path: `${baseXpath}/@${attrName}`,
          category,
          elementName: nodeB.tagName,
          attributeName: attrName,
          description: `Atributo @${attrName} adicionado em <${nodeB.tagName}>`,
          newValue: valB,
          lineA,
          lineB,
          semantic: false
        });
      } else if (valA !== undefined && valB === undefined) {
        changes.push({
          id: nextChangeId(),
          type: 'removed',
          path: `${baseXpath}/@${attrName}`,
          category,
          elementName: nodeA.tagName,
          attributeName: attrName,
          description: `Atributo @${attrName} removido de <${nodeA.tagName}>`,
          oldValue: valA,
          lineA,
          lineB,
          semantic: false
        });
      } else {
        changes.push({
          id: nextChangeId(),
          type: 'modified',
          path: `${baseXpath}/@${attrName}`,
          category,
          elementName: nodeB.tagName,
          attributeName: attrName,
          description: `Atributo @${attrName} alterado em <${nodeB.tagName}>: "${valA}" → "${valB}"`,
          oldValue: valA,
          newValue: valB,
          lineA,
          lineB,
          semantic: false
        });
      }
    }
  }

  /**
   * Lê um arquivo `.jrxml` ou `.jasper` do disco.
   * Utiliza streaming (`fs.createReadStream`) para arquivos > 10MB e descompilação automática para `.jasper`.
   */
  public async loadReportContent(
    filePath: string
  ): Promise<{ content: string; size: number }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo não encontrado: "${filePath}"`);
    }

    const stat = await fs.promises.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.jasper') {
      const content = await this.decompileJasperToXml(filePath);
      return {
        content,
        size: stat.size
      };
    }

    if (stat.size > STREAM_THRESHOLD_BYTES) {
      const content = await this.readLargeFileStreaming(filePath);
      return {
        content,
        size: stat.size
      };
    }

    const content = await fs.promises.readFile(filePath, 'utf8');
    return {
      content,
      size: stat.size
    };
  }

  private readLargeFileStreaming(filePath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];
      const stream = fs.createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: 256 * 1024
      });
      stream.on('data', (chunk: string | Buffer) => {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      });
      stream.on('end', () => resolve(chunks.join('')));
      stream.on('error', (err) => reject(err));
    });
  }

  private async decompileJasperToXml(jasperPath: string): Promise<string> {
    // Primeiro verifica se o arquivo já contém XML texto (por exemplo, em ambientes de teste)
    const sampleBuf = Buffer.alloc(64);
    const fd = await fs.promises.open(jasperPath, 'r');
    try {
      const { bytesRead } = await fd.read(sampleBuf, 0, 64, 0);
      const sampleText = sampleBuf.slice(0, bytesRead).toString('utf8').trim();
      if (sampleText.startsWith('<?xml') || sampleText.startsWith('<jasperReport')) {
        return await fs.promises.readFile(jasperPath, 'utf8');
      }
    } finally {
      await fd.close();
    }

    const runner = this.runnerService ?? new RunnerService();
    const tempOut = path.join(
      os.tmpdir(),
      `jasper_diff_${crypto.randomBytes(8).toString('hex')}.jrxml`
    );

    try {
      const res = await runner.decompileReport(jasperPath, tempOut);
      const targetXmlPath = res.outputFile || tempOut;
      if (!fs.existsSync(targetXmlPath)) {
        throw new Error(`Falha ao obter JRXML descompilado de "${path.basename(jasperPath)}".`);
      }
      return await fs.promises.readFile(targetXmlPath, 'utf8');
    } finally {
      if (fs.existsSync(tempOut)) {
        try {
          await fs.promises.unlink(tempOut);
        } catch {
          // Ignora falha ao limpar temp
        }
      }
    }
  }

  /**
   * Gera um arquivo HTML standalone completo com o diff lado a lado e resumo semântico.
   */
  public exportToHtml(result: DiffResult, options: DiffOptions = {}): string {
    const activeFilterSet =
      options.filters && options.filters.length > 0
        ? new Set<DiffCategory>(options.filters)
        : null;

    const visibleChanges = activeFilterSet
      ? result.changes.filter((c) => activeFilterSet.has(c.category))
      : result.changes;

    const categoryLabels: Record<DiffCategory, string> = {
      structure: 'Estrutura',
      attributes: 'Atributos',
      query: 'Query SQL',
      parameters: 'Parâmetros',
      fields: 'Campos',
      variables: 'Variáveis',
      styles: 'Estilos',
      expressions: 'Expressões',
      subreports: 'Subrelatórios'
    };

    const rowsHtml = result.lineDiff
      .filter((pair) => {
        if (!activeFilterSet || !pair.category) {
          return true;
        }
        return activeFilterSet.has(pair.category);
      })
      .map((pair) => {
        const rowClass = `diff-row diff-${pair.type}`;
        const numA = pair.lineNumberA ?? '';
        const numB = pair.lineNumberB ?? '';
        const textA = pair.textA !== undefined ? escapeHtml(pair.textA) : '';
        const textB = pair.textB !== undefined ? escapeHtml(pair.textB) : '';
        const catBadge = pair.category
          ? `<span class="cat-tag cat-${pair.category}">${categoryLabels[pair.category]}</span>`
          : '';

        return `<tr class="${rowClass}">
          <td class="line-num">${numA}</td>
          <td class="line-code code-a">${catBadge}${textA}</td>
          <td class="line-num">${numB}</td>
          <td class="line-code code-b">${textB}</td>
        </tr>`;
      })
      .join('\n');

    const semanticRowsHtml = visibleChanges
      .map((ch) => {
        const badgeLabel =
          ch.type === 'added'
            ? '+ Adicionado'
            : ch.type === 'removed'
            ? '- Removido'
            : '~ Modificado';
        return `<tr>
          <td><span class="type-badge badge-${ch.type}">${badgeLabel}</span></td>
          <td><span class="cat-tag cat-${ch.category}">${categoryLabels[ch.category]}</span></td>
          <td class="mono">${escapeHtml(ch.path)}</td>
          <td>${escapeHtml(ch.description || '')}</td>
          <td class="mono">${escapeHtml(ch.oldValue ?? '-')}</td>
          <td class="mono">${escapeHtml(ch.newValue ?? '-')}</td>
          <td class="mono">${ch.lineA ?? '-'} / ${ch.lineB ?? '-'}</td>
        </tr>`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Jasper Report Diff: ${escapeHtml(result.metadata.fileA.name)} vs ${escapeHtml(result.metadata.fileB.name)}</title>
  <style>
    :root {
      --bg: #1e1e1e;
      --panel: #252526;
      --border: #3c3c3c;
      --fg: #d4d4d4;
      --muted: #858585;
      --added-bg: rgba(46, 160, 67, 0.18);
      --added-fg: #73c991;
      --removed-bg: rgba(248, 81, 73, 0.18);
      --removed-fg: #f48771;
      --modified-bg: rgba(210, 153, 34, 0.18);
      --modified-fg: #e2c08d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
    }
    header {
      background: var(--panel);
      border: 1px solid var(--border);
      padding: 16px;
      border-radius: 4px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    h1 { margin: 0 0 6px 0; font-size: 16px; }
    .meta { color: var(--muted); font-size: 12px; }
    .stats { display: flex; gap: 10px; font-weight: 600; font-size: 13px; }
    .stat-added { color: var(--added-fg); }
    .stat-removed { color: var(--removed-fg); }
    .stat-modified { color: var(--modified-fg); }
    h2 { font-size: 14px; margin: 20px 0 8px 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--border);
      font-size: 12px;
    }
    th, td {
      border-bottom: 1px solid var(--border);
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    th { background: var(--panel); font-weight: 600; }
    .diff-table { font-family: Consolas, "Courier New", monospace; table-layout: fixed; }
    .line-num {
      width: 48px;
      text-align: right;
      color: var(--muted);
      background: var(--panel);
      user-select: none;
      border-right: 1px solid var(--border);
    }
    .line-code {
      white-space: pre-wrap;
      word-break: break-all;
      width: calc(50% - 48px);
    }
    .diff-added .code-b { background: var(--added-bg); }
    .diff-removed .code-a { background: var(--removed-bg); }
    .diff-modified .code-a, .diff-modified .code-b { background: var(--modified-bg); }
    .type-badge, .cat-tag {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      margin-right: 6px;
    }
    .badge-added { background: var(--added-bg); color: var(--added-fg); }
    .badge-removed { background: var(--removed-bg); color: var(--removed-fg); }
    .badge-modified { background: var(--modified-bg); color: var(--modified-fg); }
    .cat-tag { background: rgba(255,255,255,0.08); color: var(--fg); }
    .mono { font-family: Consolas, monospace; word-break: break-word; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Comparação de Relatórios JasperReports</h1>
      <div class="meta">
        <strong>A:</strong> ${escapeHtml(result.metadata.fileA.path)} (${result.metadata.fileA.hash}) &nbsp;|&nbsp;
        <strong>B:</strong> ${escapeHtml(result.metadata.fileB.path)} (${result.metadata.fileB.hash}) &nbsp;|&nbsp;
        Tempo: ${result.metadata.diffTimeMs}ms
      </div>
    </div>
    <div class="stats">
      <span class="stat-added">+${result.summary.added} adicionados</span>
      <span class="stat-removed">-${result.summary.removed} removidos</span>
      <span class="stat-modified">~${result.summary.modified} modificados</span>
    </div>
  </header>

  <h2>Resumo Semântico de Mudanças (${visibleChanges.length})</h2>
  <table>
    <thead>
      <tr>
        <th>Tipo</th>
        <th>Categoria</th>
        <th>Caminho XML (XPath)</th>
        <th>Descrição</th>
        <th>Valor Anterior (A)</th>
        <th>Novo Valor (B)</th>
        <th>Linhas (A/B)</th>
      </tr>
    </thead>
    <tbody>
      ${semanticRowsHtml || '<tr><td colspan="7">Nenhuma diferença semântica encontrada.</td></tr>'}
    </tbody>
  </table>

  <h2>Diff Lado a Lado</h2>
  <table class="diff-table">
    <thead>
      <tr>
        <th class="line-num">#A</th>
        <th>${escapeHtml(result.metadata.fileA.name)}</th>
        <th class="line-num">#B</th>
        <th>${escapeHtml(result.metadata.fileB.name)}</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
  }

  /**
   * Exporta o resultado do diff em formato Markdown.
   */
  public exportToMarkdown(result: DiffResult): string {
    const lines: string[] = [
      `# Comparação de Relatórios: ${result.metadata.fileA.name} vs ${result.metadata.fileB.name}`,
      '',
      `- **Relatório A:** \`${result.metadata.fileA.path}\` (hash: \`${result.metadata.fileA.hash}\`)`,
      `- **Relatório B:** \`${result.metadata.fileB.path}\` (hash: \`${result.metadata.fileB.hash}\`)`,
      `- **Estatísticas:** \`+${result.summary.added} -${result.summary.removed} ~${result.summary.modified}\` (${result.metadata.diffTimeMs}ms)`,
      '',
      '## Mudanças Detectadas',
      '',
      '| Tipo | Categoria | Caminho | Descrição | Linhas (A/B) |',
      '|------|-----------|---------|-----------|--------------|'
    ];

    for (const ch of result.changes) {
      const desc = (ch.description || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      lines.push(
        `| ${ch.type} | ${ch.category} | \`${ch.path}\` | ${desc} | ${ch.lineA ?? '-'}/${ch.lineB ?? '-'} |`
      );
    }

    return lines.join('\n');
  }

  /**
   * Exporta o resultado do diff em formato JSON estruturado.
   */
  public exportToJson(result: DiffResult): string {
    const { contentA: _a, contentB: _b, ...serializable } = result;
    return JSON.stringify(serializable, null, 2);
  }
}

export const reportDiffEngine = new ReportDiffEngine();
