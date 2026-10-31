import * as vscode from 'vscode';
import { JasperServerProfile } from '../models/jasperserver';
import { JasperServerClient } from './jasperServerClient';
import { ServerManager } from './serverManager';
import { jrxmlParser } from './jrxmlParser';

export type ReportOutputFormat = 'PDF' | 'XLS' | 'CSV' | 'RTF' | 'HTML' | 'JRP';

export type TriggerType = 'SIMPLE' | 'CRON' | 'CALENDAR';

export type TriggerState = 'NORMAL' | 'PAUSED' | 'COMPLETE' | 'ERROR' | 'BLOCKED';

export type JobExecutionStatus = 'SUCCESS' | 'FAILED' | 'RUNNING' | 'CANCELLED';

export interface JobParameter {
  name: string;
  type: string;                 // java.lang.String, java.lang.Integer, etc.
  defaultValue?: string;
  isRequired: boolean;
  isForPrompting: boolean;
}

export interface Trigger {
  id: string;
  jobId: string;
  type: TriggerType;
  cronExpression?: string;      // Para CRON e CALENDAR
  calendarName?: string;        // Para CALENDAR
  repeatInterval?: number;      // ms para SIMPLE
  repeatCount?: number;         // -1 = infinito
  startTime: string;            // ISO 8601
  endTime?: string;
  timezone: string;             // America/Sao_Paulo
  state: TriggerState;
  nextFireTime?: string;
  previousFireTime?: string;
}

export interface JobExecution {
  id: string;
  jobId: string;
  status: JobExecutionStatus;
  startTime: string;
  endTime?: string;
  outputResource?: { uri: string; mimeType: string };
  errorMessage?: string;
  parameters: Record<string, string>;
}

export interface ReportJob {
  id: string;
  name: string;
  description?: string;
  reportUnitUri: string;        // /public/reports/FichaAtendimento
  outputFormat: ReportOutputFormat;
  parameters: JobParameter[];
  triggers: Trigger[];
  createdAt: string;
  updatedAt: string;
  lastExecution?: JobExecution;
}

export interface JobListFilter {
  name?: string;
  reportUnitUri?: string;
  limit?: number;
  offset?: number;
}

export interface CronValidationResult {
  valid: boolean;
  error?: string;
  suggestion?: string;
  nextRuns?: string[];
  description?: string;
}

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_PAGE_LIMIT = 50;
export const JOBS_CACHE_TTL_MS = 30_000;

const MONTH_MAP: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12
};

// Quartz Day-of-Week: 1 = SUN, 2 = MON, 3 = TUE, 4 = WED, 5 = THU, 6 = FRI, 7 = SAT
const DOW_MAP: Record<string, number> = {
  SUN: 1, MON: 2, TUE: 3, WED: 4, THU: 5, FRI: 6, SAT: 7
};

interface JobsCacheEntry {
  timestamp: number;
  jobs: ReportJob[];
}

function encodeUriPath(uri: string): string {
  const normalized = uri.startsWith('/') ? uri : `/${uri}`;
  return normalized
    .split('/')
    .map((segment) => (segment ? encodeURIComponent(segment) : ''))
    .join('/');
}

/**
 * Obtém o timezone IANA preferencial do usuário (padrão: America/Sao_Paulo).
 */
export function getLocalTimezone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved && resolved.trim().length > 0) {
      return resolved;
    }
  } catch {
    // Fallback para America/Sao_Paulo
  }
  return DEFAULT_TIMEZONE;
}

/**
 * Formata um timestamp ISO 8601 no timezone especificado (padrão America/Sao_Paulo)
 * no formato `YYYY-MM-DD HH:mm:ss`.
 */
export function formatTimestampInTimezone(
  value?: string | number | Date,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  if (value === undefined || value === null || value === '') {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const effectiveTz = timeZone || DEFAULT_TIMEZONE;
  try {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: effectiveTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    return formatter.format(date).replace(',', '');
  } catch {
    const fallbackFormatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    return fallbackFormatter.format(date).replace(',', '');
  }
}

/**
 * Calcula e formata a duração entre dois timestamps (ex: `2.4s`, `1m 15s`).
 */
export function formatExecutionDuration(startTime?: string, endTime?: string): string {
  if (!startTime || !endTime) {
    return '';
  }
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return '';
  }
  const diffMs = endMs - startMs;
  if (diffMs < 1000) {
    return `${diffMs}ms`;
  }
  const totalSec = diffMs / 1000;
  if (totalSec < 60) {
    return `${totalSec.toFixed(1)}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const secs = Math.round(totalSec % 60);
  if (mins < 60) {
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

/**
 * Formata um intervalo em milissegundos de um SimpleTrigger de forma legível (ex: `1h`, `30m`, `15s`).
 */
export function formatRepeatInterval(intervalMs?: number): string {
  if (!intervalMs || intervalMs <= 0) {
    return '0s';
  }
  if (intervalMs % 3_600_000 === 0) {
    return `${intervalMs / 3_600_000}h`;
  }
  if (intervalMs % 60_000 === 0) {
    return `${intervalMs / 60_000}m`;
  }
  if (intervalMs % 1_000 === 0) {
    return `${intervalMs / 1_000}s`;
  }
  return `${intervalMs}ms`;
}

/**
 * Gera o texto resumido de um Trigger para exibição no TreeView.
 * Ex: `Cron 0 0 6 ? * MON-FRI *` ou `Simple 1h x 24` ou `Calendar Feriados (0 0 8 ? * MON-FRI)`.
 */
export function formatTriggerLabel(trigger: Trigger): string {
  if (trigger.type === 'CRON') {
    return `Cron ${trigger.cronExpression || '0 0 6 ? * MON-FRI *'}`;
  }
  if (trigger.type === 'CALENDAR') {
    const cal = trigger.calendarName || 'Calendário';
    return trigger.cronExpression
      ? `Calendar ${cal} (${trigger.cronExpression})`
      : `Calendar ${cal}`;
  }
  const intervalLabel = formatRepeatInterval(trigger.repeatInterval);
  const countLabel =
    trigger.repeatCount === undefined || trigger.repeatCount < 0
      ? '∞'
      : String(trigger.repeatCount);
  return `Simple ${intervalLabel} x ${countLabel}`;
}

function normalizeOutputFormat(raw?: string | string[]): ReportOutputFormat {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const upper = (first || 'PDF').toString().trim().toUpperCase();
  if (
    upper === 'PDF' ||
    upper === 'XLS' ||
    upper === 'CSV' ||
    upper === 'RTF' ||
    upper === 'HTML' ||
    upper === 'JRP'
  ) {
    return upper;
  }
  if (upper === 'XLSX') {
    return 'XLS';
  }
  return 'PDF';
}

function normalizeTriggerState(raw?: string): TriggerState {
  const upper = (raw || 'NORMAL').toString().trim().toUpperCase();
  if (
    upper === 'NORMAL' ||
    upper === 'PAUSED' ||
    upper === 'COMPLETE' ||
    upper === 'ERROR' ||
    upper === 'BLOCKED'
  ) {
    return upper;
  }
  if (upper === 'ACTIVE' || upper === 'ENABLED') {
    return 'NORMAL';
  }
  if (upper === 'DISABLED') {
    return 'PAUSED';
  }
  return 'NORMAL';
}

function normalizeExecutionStatus(raw?: string): JobExecutionStatus {
  const upper = (raw || 'SUCCESS').toString().trim().toUpperCase();
  if (upper === 'SUCCESS' || upper === 'READY' || upper === 'FINISHED' || upper === 'COMPLETED') {
    return 'SUCCESS';
  }
  if (upper === 'FAILED' || upper === 'ERROR' || upper === 'EXECUTION_ERROR') {
    return 'FAILED';
  }
  if (upper === 'RUNNING' || upper === 'QUEUED' || upper === 'EXECUTING') {
    return 'RUNNING';
  }
  if (upper === 'CANCELLED' || upper === 'CANCELED') {
    return 'CANCELLED';
  }
  return 'SUCCESS';
}

// ============================================================================
// Validador e Simulador de Expressões Quartz Cron
// ============================================================================

interface ParsedCronField {
  any: boolean;
  question: boolean;
  lastDay?: boolean;
  values: Set<number>;
}

function replaceNamedTokens(tokenStr: string, map: Record<string, number>): string {
  let result = tokenStr.toUpperCase();
  for (const [name, num] of Object.entries(map)) {
    result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), String(num));
  }
  return result;
}

function parseCronField(
  rawField: string,
  min: number,
  max: number,
  fieldName: string,
  allowQuestion: boolean,
  allowSpecialDayChars: boolean,
  nameMap?: Record<string, number>
): { parsed?: ParsedCronField; error?: string; suggestion?: string } {
  const trimmed = rawField.trim().toUpperCase();
  if (!trimmed) {
    return { error: `Campo "${fieldName}" está vazio.` };
  }

  if (trimmed === '?') {
    if (!allowQuestion) {
      return {
        error: `O caractere "?" não é permitido no campo "${fieldName}".`,
        suggestion: `Use "*" no campo "${fieldName}". "?" só é válido em Dia do Mês ou Dia da Semana.`
      };
    }
    return {
      parsed: { any: true, question: true, values: new Set<number>() }
    };
  }

  if (trimmed === '*') {
    const allValues = new Set<number>();
    for (let i = min; i <= max; i++) {
      allValues.add(i);
    }
    return {
      parsed: { any: true, question: false, values: allValues }
    };
  }

  if (allowSpecialDayChars && (trimmed === 'L' || trimmed === 'LW')) {
    const values = new Set<number>([28, 29, 30, 31]);
    return {
      parsed: { any: false, question: false, lastDay: true, values }
    };
  }

  const normalized = nameMap ? replaceNamedTokens(trimmed, nameMap) : trimmed;
  const segments = normalized.split(',');
  const values = new Set<number>();

  for (const seg of segments) {
    const cleanSeg = seg.trim();
    if (!cleanSeg) {
      return { error: `Lista inválida no campo "${fieldName}": "${rawField}".` };
    }

    // Tratamento de sufixos Quartz em dia do mês / semana (ex: 15W, 6L, 2#1)
    if (allowSpecialDayChars) {
      const weekdayNearestMatch = /^(\d+)W$/i.exec(cleanSeg);
      if (weekdayNearestMatch) {
        const dayVal = Number(weekdayNearestMatch[1]);
        if (dayVal < min || dayVal > max) {
          return {
            error: `Valor ${dayVal} fora do intervalo (${min}-${max}) em "${fieldName}".`
          };
        }
        values.add(dayVal);
        continue;
      }

      const nthDowMatch = /^(\d+)#([1-5])$/.exec(cleanSeg);
      if (nthDowMatch) {
        const dowVal = Number(nthDowMatch[1]);
        if (dowVal < min || dowVal > max) {
          return {
            error: `Dia da semana ${dowVal} fora do intervalo (${min}-${max}) em "${fieldName}".`
          };
        }
        values.add(dowVal);
        continue;
      }

      const lastDowMatch = /^(\d+)L$/i.exec(cleanSeg);
      if (lastDowMatch) {
        const dowVal = Number(lastDowMatch[1]);
        if (dowVal < min || dowVal > max) {
          return {
            error: `Valor ${dowVal}L fora do intervalo (${min}-${max}) em "${fieldName}".`
          };
        }
        values.add(dowVal);
        continue;
      }
    }

    let rangePart = cleanSeg;
    let step = 1;

    if (cleanSeg.includes('/')) {
      const parts = cleanSeg.split('/');
      if (parts.length !== 2 || !parts[1]) {
        return {
          error: `Incremento "/" inválido no campo "${fieldName}": "${cleanSeg}".`,
          suggestion: `Use o formato início/passo, ex: "0/15" ou "*/5".`
        };
      }
      rangePart = parts[0] || '*';
      step = Number(parts[1]);
      if (!Number.isInteger(step) || step <= 0 || step > max) {
        return {
          error: `Passo de incremento "${parts[1]}" inválido no campo "${fieldName}" (deve ser entre 1 e ${max}).`
        };
      }
    }

    let start = min;
    let end = max;

    if (rangePart === '*' || rangePart === '?') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [startStr, endStr] = rangePart.split('-');
      start = Number(startStr);
      end = Number(endStr);
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        return {
          error: `Intervalo "${rangePart}" inválido no campo "${fieldName}".`
        };
      }
      // Aceita 0 como domingo em Dia da Semana (converte para 1)
      if (fieldName === 'Dia da Semana') {
        if (start === 0) {
          start = 1;
        }
        if (end === 0) {
          end = 7;
        }
      }
      if (start < min || start > max || end < min || end > max) {
        return {
          error: `Intervalo "${rangePart}" fora dos limites permitidos (${min}-${max}) para "${fieldName}".`
        };
      }
    } else {
      let single = Number(rangePart);
      if (!Number.isInteger(single)) {
        return {
          error: `Valor "${cleanSeg}" não reconhecido no campo "${fieldName}".`
        };
      }
      if (fieldName === 'Dia da Semana' && single === 0) {
        single = 1;
      }
      if (single < min || single > max) {
        return {
          error: `Valor ${single} fora dos limites (${min}-${max}) para "${fieldName}".`
        };
      }
      start = single;
      end = cleanSeg.includes('/') ? max : single;
    }

    if (start <= end) {
      for (let v = start; v <= end; v += step) {
        values.add(v);
      }
    } else {
      // Suporta wrap-around (ex: FRI-MON)
      for (let v = start; v <= max; v += step) {
        values.add(v);
      }
      for (let v = min; v <= end; v += step) {
        values.add(v);
      }
    }
  }

  return {
    parsed: {
      any: false,
      question: false,
      values
    }
  };
}

const dtfPartsCache = new Map<string, Intl.DateTimeFormat>();

function getCachedPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const effectiveTz = timeZone || DEFAULT_TIMEZONE;
  let fmt = dtfPartsCache.get(effectiveTz);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: effectiveTz,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
      });
    } catch {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: DEFAULT_TIMEZONE,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
      });
    }
    dtfPartsCache.set(effectiveTz, fmt);
  }
  return fmt;
}

function getDateComponentsInTimezone(
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  quartzDow: number; // 1=SUN..7=SAT
} {
  const parts = getCachedPartsFormatter(timeZone).formatToParts(date);

  let year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  let day = date.getUTCDate();
  let hour = date.getUTCHours();
  let minute = date.getUTCMinutes();
  let second = date.getUTCSeconds();
  let quartzDow = date.getUTCDay() + 1;

  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        hour = Number(part.value) % 24;
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        second = Number(part.value);
        break;
      case 'weekday': {
        const upper = part.value.toUpperCase().slice(0, 3);
        if (DOW_MAP[upper]) {
          quartzDow = DOW_MAP[upper];
        }
        break;
      }
    }
  }

  return { year, month, day, hour, minute, second, quartzDow };
}

function computeNextQuartzRuns(
  secField: ParsedCronField,
  minField: ParsedCronField,
  hourField: ParsedCronField,
  domField: ParsedCronField,
  monthField: ParsedCronField,
  dowField: ParsedCronField,
  yearField: ParsedCronField | undefined,
  timeZone: string,
  count = 5
): string[] {
  const results: string[] = [];
  const now = new Date();
  // Começa no próximo segundo cheio
  const cursor = new Date(Math.floor(now.getTime() / 1000) * 1000 + 1000);

  const minSec = secField.values.size > 0 ? Math.min(...secField.values) : 0;
  let iterations = 0;
  const maxIterations = 250_000;

  while (results.length < count && iterations < maxIterations) {
    iterations++;
    const comp = getDateComponentsInTimezone(cursor, timeZone);

    if (yearField && !yearField.any && !yearField.values.has(comp.year)) {
      cursor.setTime(cursor.getTime() + 86_400_000);
      continue;
    }

    if (!monthField.any && !monthField.values.has(comp.month)) {
      cursor.setTime(cursor.getTime() + 86_400_000);
      continue;
    }

    let dayMatches = false;
    if (domField.lastDay) {
      const tomorrow = new Date(cursor.getTime() + 86_400_000);
      const tomorrowComp = getDateComponentsInTimezone(tomorrow, timeZone);
      dayMatches = tomorrowComp.day === 1;
    } else if (!domField.question && !dowField.question) {
      dayMatches = domField.values.has(comp.day) && dowField.values.has(comp.quartzDow);
    } else if (!domField.question) {
      dayMatches = domField.any || domField.values.has(comp.day);
    } else {
      dayMatches = dowField.any || dowField.values.has(comp.quartzDow);
    }

    if (!dayMatches) {
      // Avança para o início do próximo dia
      const remainingSecondsInDay =
        (23 - comp.hour) * 3600 + (59 - comp.minute) * 60 + (60 - comp.second);
      cursor.setTime(cursor.getTime() + Math.max(1, remainingSecondsInDay) * 1000);
      continue;
    }

    if (!hourField.any && !hourField.values.has(comp.hour)) {
      const remainingSecondsInHour = (59 - comp.minute) * 60 + (60 - comp.second);
      cursor.setTime(cursor.getTime() + Math.max(1, remainingSecondsInHour) * 1000);
      continue;
    }

    if (!minField.any && !minField.values.has(comp.minute)) {
      const remainingSecondsInMinute = 60 - comp.second;
      cursor.setTime(cursor.getTime() + Math.max(1, remainingSecondsInMinute) * 1000);
      continue;
    }

    if (!secField.any && !secField.values.has(comp.second)) {
      if (comp.second < minSec) {
        cursor.setTime(cursor.getTime() + (minSec - comp.second) * 1000);
      } else {
        cursor.setTime(cursor.getTime() + (60 - comp.second + minSec) * 1000);
      }
      continue;
    }

    results.push(formatTimestampInTimezone(cursor, timeZone));
    // Avança pelo menos 1 segundo (ou 60s se segundo é fixo)
    if (!secField.any && secField.values.size === 1) {
      cursor.setTime(cursor.getTime() + 60_000);
    } else {
      cursor.setTime(cursor.getTime() + 1_000);
    }
  }

  return results;
}

const cronValidationCache = new Map<string, { minuteBucket: number; result: CronValidationResult }>();

/**
 * Valida uma expressão Quartz Cron (6 ou 7 campos) e calcula as próximas 5 execuções.
 */
export function validateQuartzCronExpression(
  expr: string,
  timezone: string = DEFAULT_TIMEZONE
): CronValidationResult {
  const trimmed = (expr || '').trim();
  const effectiveTz = timezone || DEFAULT_TIMEZONE;
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const cacheKey = `${trimmed}::${effectiveTz}`;
  const cached = cronValidationCache.get(cacheKey);
  if (cached && cached.minuteBucket === minuteBucket) {
    return cached.result;
  }

  if (!trimmed) {
    return {
      valid: false,
      error: 'Informe uma expressão Quartz Cron.',
      suggestion: 'Exemplo (todo dia útil às 06:00): 0 0 6 ? * MON-FRI *'
    };
  }

  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 5) {
    const suggestedDom = tokens[2] === '*' && tokens[4] !== '*' ? '?' : tokens[2];
    const suggestedDow =
      suggestedDom !== '?' ? '?' : tokens[4] === '*' ? '*' : tokens[4];
    return {
      valid: false,
      error:
        'Expressão Cron Unix de 5 campos detectada. O Quartz Scheduler exige 6 ou 7 campos (Segundos Minutos Horas DiaMês Mês DiaSemana [Ano]).',
      suggestion: `0 ${tokens[0]} ${tokens[1]} ${suggestedDom} ${tokens[3]} ${suggestedDow} *`
    };
  }

  if (tokens.length < 6 || tokens.length > 7) {
    return {
      valid: false,
      error: `A expressão Quartz Cron deve possuir 6 ou 7 campos separados por espaço (encontrados: ${tokens.length}).`,
      suggestion: 'Formato esperado: Seg Min Hora DiaMês Mês DiaSemana [Ano] — Ex: 0 0 6 ? * MON-FRI *'
    };
  }

  const [secRaw, minRaw, hourRaw, domRaw, monthRaw, dowRaw, yearRaw] = tokens;

  // Regra Quartz: exatamente um entre Dia do Mês e Dia da Semana deve ser '?'
  if (domRaw === '?' && dowRaw === '?') {
    return {
      valid: false,
      error: 'No Quartz Cron, "Dia do Mês" e "Dia da Semana" não podem ser ambos "?".',
      suggestion: `${secRaw} ${minRaw} ${hourRaw} * ${monthRaw} ?${yearRaw ? ' ' + yearRaw : ''}`
    };
  }
  if (domRaw !== '?' && dowRaw !== '?') {
    const suggested =
      dowRaw === '*'
        ? `${secRaw} ${minRaw} ${hourRaw} ${domRaw} ${monthRaw} ?${yearRaw ? ' ' + yearRaw : ''}`
        : `${secRaw} ${minRaw} ${hourRaw} ? ${monthRaw} ${dowRaw}${yearRaw ? ' ' + yearRaw : ''}`;
    return {
      valid: false,
      error:
        'No Quartz Cron, "Dia do Mês" ou "Dia da Semana" deve ser "?" (não é permitido especificar ambos simultaneamente).',
      suggestion: suggested
    };
  }

  const secRes = parseCronField(secRaw, 0, 59, 'Segundos', false, false);
  if (secRes.error || !secRes.parsed) {
    return { valid: false, error: secRes.error, suggestion: secRes.suggestion };
  }

  const minRes = parseCronField(minRaw, 0, 59, 'Minutos', false, false);
  if (minRes.error || !minRes.parsed) {
    return { valid: false, error: minRes.error, suggestion: minRes.suggestion };
  }

  const hourRes = parseCronField(hourRaw, 0, 23, 'Horas', false, false);
  if (hourRes.error || !hourRes.parsed) {
    return { valid: false, error: hourRes.error, suggestion: hourRes.suggestion };
  }

  const domRes = parseCronField(domRaw, 1, 31, 'Dia do Mês', true, true);
  if (domRes.error || !domRes.parsed) {
    return { valid: false, error: domRes.error, suggestion: domRes.suggestion };
  }

  const monthRes = parseCronField(monthRaw, 1, 12, 'Mês', false, false, MONTH_MAP);
  if (monthRes.error || !monthRes.parsed) {
    return { valid: false, error: monthRes.error, suggestion: monthRes.suggestion };
  }

  const dowRes = parseCronField(dowRaw, 1, 7, 'Dia da Semana', true, true, DOW_MAP);
  if (dowRes.error || !dowRes.parsed) {
    return { valid: false, error: dowRes.error, suggestion: dowRes.suggestion };
  }

  let yearParsed: ParsedCronField | undefined;
  if (yearRaw !== undefined) {
    const yearRes = parseCronField(yearRaw, 1970, 2099, 'Ano', false, false);
    if (yearRes.error || !yearRes.parsed) {
      return { valid: false, error: yearRes.error, suggestion: yearRes.suggestion };
    }
    yearParsed = yearRes.parsed;
  }

  const nextRuns = computeNextQuartzRuns(
    secRes.parsed,
    minRes.parsed,
    hourRes.parsed,
    domRes.parsed,
    monthRes.parsed,
    dowRes.parsed,
    yearParsed,
    timezone || DEFAULT_TIMEZONE,
    5
  );

  const result: CronValidationResult = {
    valid: true,
    nextRuns
  };
  cronValidationCache.set(cacheKey, { minuteBucket, result });
  return result;
}

// ============================================================================
// Serviço Principal: JasperServerSchedulerService
// ============================================================================

export class JasperServerSchedulerService {
  private readonly jobsCache = new Map<string, JobsCacheEntry>();
  private readonly localJobsStore = new Map<string, Map<string, ReportJob>>();
  private readonly localTriggersStore = new Map<string, Trigger>();
  private readonly localExecutionsStore = new Map<string, JobExecution[]>();

  constructor(
    private readonly serverClient: JasperServerClient,
    private readonly serverManager?: ServerManager,
    private readonly outputChannel?: vscode.OutputChannel
  ) {}

  private log(message: string): void {
    if (this.outputChannel) {
      const ts = formatTimestampInTimezone(new Date(), DEFAULT_TIMEZONE);
      this.outputChannel.appendLine(`[${ts}] [JasperServer Scheduler] ${message}`);
    }
  }

  public invalidateCache(profileId?: string): void {
    if (!profileId) {
      this.jobsCache.clear();
      return;
    }
    for (const key of this.jobsCache.keys()) {
      if (key.startsWith(`${profileId}:`)) {
        this.jobsCache.delete(key);
      }
    }
  }

  private async resolveProfile(profile?: JasperServerProfile): Promise<JasperServerProfile | undefined> {
    if (profile) {
      return profile;
    }
    if (this.serverManager) {
      return this.serverManager.getActiveProfile();
    }
    return undefined;
  }

  private getProfileStoreKey(profile?: JasperServerProfile): string {
    return profile?.id || 'default';
  }

  private getOrCreateProfileJobMap(profileKey: string): Map<string, ReportJob> {
    let map = this.localJobsStore.get(profileKey);
    if (!map) {
      map = new Map<string, ReportJob>();
      this.localJobsStore.set(profileKey, map);
    }
    return map;
  }

  // ==========================================================================
  // JOBS CRUD
  // ==========================================================================

  /**
   * Lista jobs agendados no JasperServer (com paginação limit=50 e cache de 30s).
   * GET /rest/v2/reportJobs (com fallback para /rest_v2/jobs).
   */
  public async listJobs(
    filter?: JobListFilter,
    profile?: JasperServerProfile
  ): Promise<ReportJob[]> {
    const resolvedProfile = await this.resolveProfile(profile);
    const profileKey = this.getProfileStoreKey(resolvedProfile);
    const limit = filter?.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = filter?.offset ?? 0;
    const filterName = filter?.name?.trim() || '';
    const filterUri = filter?.reportUnitUri?.trim() || '';

    const cacheKey = `${profileKey}:${limit}:${offset}:${filterName}:${filterUri}`;
    const cached = this.jobsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < JOBS_CACHE_TTL_MS) {
      return cached.jobs;
    }

    const queryParams = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });
    if (filterName) {
      queryParams.set('label', filterName);
      queryParams.set('name', filterName);
    }
    if (filterUri) {
      queryParams.set('reportUnitURI', filterUri);
      queryParams.set('reportUnitUri', filterUri);
    }

    const queryStr = queryParams.toString();
    let response = await this.serverClient.requestWithAuth(
      `/rest/v2/reportJobs?${queryStr}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json, application/jobsummary+json'
        }
      },
      resolvedProfile
    );

    if (response.status === 404) {
      response = await this.serverClient.requestWithAuth(
        `/rest_v2/jobs?${queryStr}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json, application/jobsummary+json'
          }
        },
        resolvedProfile
      );
    }

    if (response.status === 204) {
      const localList = Array.from(this.getOrCreateProfileJobMap(profileKey).values());
      this.jobsCache.set(cacheKey, { timestamp: Date.now(), jobs: localList });
      return localList;
    }

    if (!response.ok) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro em listJobs (HTTP ${response.status}): ${errDetail}`);
      throw new Error(`Erro ao listar agendamentos no JasperServer (HTTP ${response.status}): ${errDetail}`);
    }

    const rawText = await response.text();
    let rawItems: any[] = [];
    if (rawText && rawText.trim()) {
      try {
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed)) {
          rawItems = parsed;
        } else if (parsed && Array.isArray(parsed.reportJobs)) {
          rawItems = parsed.reportJobs;
        } else if (parsed && Array.isArray(parsed.jobsummary)) {
          rawItems = parsed.jobsummary;
        } else if (parsed && parsed.jobsummary && typeof parsed.jobsummary === 'object') {
          rawItems = [parsed.jobsummary];
        } else if (parsed && Array.isArray(parsed.jobs)) {
          rawItems = parsed.jobs;
        }
      } catch {
        this.log('Resposta não-JSON recebida em listJobs.');
      }
    }

    const profileJobMap = this.getOrCreateProfileJobMap(profileKey);
    const jobs: ReportJob[] = rawItems.map((raw) => {
      const mapped = this.mapRawJobToReportJob(raw);
      const localExisting = profileJobMap.get(mapped.id);
      if (localExisting) {
        if (mapped.triggers.length === 0 && localExisting.triggers.length > 0) {
          mapped.triggers = localExisting.triggers;
        }
        if (mapped.parameters.length === 0 && localExisting.parameters.length > 0) {
          mapped.parameters = localExisting.parameters;
        }
        if (!mapped.lastExecution && localExisting.lastExecution) {
          mapped.lastExecution = localExisting.lastExecution;
        }
      }
      profileJobMap.set(mapped.id, mapped);
      for (const trig of mapped.triggers) {
        this.localTriggersStore.set(trig.id, trig);
      }
      return mapped;
    });

    // Inclui jobs recém-criados em memória caso ainda não retornados na listagem paginada
    for (const [id, storedJob] of profileJobMap.entries()) {
      if (!jobs.some((j) => j.id === id)) {
        jobs.push(storedJob);
      }
    }

    const filtered = jobs.filter((job) => {
      if (filterName && !job.name.toLowerCase().includes(filterName.toLowerCase())) {
        return false;
      }
      if (filterUri && !job.reportUnitUri.toLowerCase().includes(filterUri.toLowerCase())) {
        return false;
      }
      return true;
    });

    this.jobsCache.set(cacheKey, { timestamp: Date.now(), jobs: filtered });
    this.log(`${filtered.length} agendamento(s) carregado(s).`);
    return filtered;
  }

  /**
   * Obtém detalhes completos de um ReportJob.
   * GET /rest/v2/reportJobs/{id} (com fallback para /rest_v2/jobs/{id}).
   */
  public async getJob(jobId: string, profile?: JasperServerProfile): Promise<ReportJob> {
    const resolvedProfile = await this.resolveProfile(profile);
    const profileKey = this.getProfileStoreKey(resolvedProfile);
    const encodedId = encodeURIComponent(jobId);

    let response = await this.serverClient.requestWithAuth(
      `/rest/v2/reportJobs/${encodedId}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json, application/job+json'
        }
      },
      resolvedProfile
    );

    if (response.status === 404) {
      response = await this.serverClient.requestWithAuth(
        `/rest_v2/jobs/${encodedId}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json, application/job+json'
          }
        },
        resolvedProfile
      );
    }

    if (!response.ok) {
      const localFallback = this.getOrCreateProfileJobMap(profileKey).get(jobId);
      if (localFallback) {
        return localFallback;
      }
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro em getJob(${jobId}): ${errDetail}`);
      throw new Error(`Erro ao obter agendamento "${jobId}" (HTTP ${response.status}): ${errDetail}`);
    }

    const raw = await response.json();
    const mapped = this.mapRawJobToReportJob(raw, jobId);
    this.getOrCreateProfileJobMap(profileKey).set(mapped.id, mapped);
    for (const trig of mapped.triggers) {
      this.localTriggersStore.set(trig.id, trig);
    }
    return mapped;
  }

  /**
   * Cria um novo ReportJob no JasperServer.
   * POST /rest/v2/reportJobs (com fallback para PUT/POST /rest_v2/jobs).
   */
  public async createJob(
    job: Omit<ReportJob, 'id' | 'createdAt' | 'updatedAt' | 'triggers'>,
    profile?: JasperServerProfile
  ): Promise<ReportJob> {
    const resolvedProfile = await this.resolveProfile(profile);
    const profileKey = this.getProfileStoreKey(resolvedProfile);
    const nowIso = new Date().toISOString();

    const payload = this.buildServerJobPayload(job);

    let response = await this.serverClient.requestWithAuth(
      '/rest/v2/reportJobs',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, application/job+json'
        },
        body: JSON.stringify(payload)
      },
      resolvedProfile
    );

    if (response.status === 404 || response.status === 405 || response.status === 415) {
      response = await this.serverClient.requestWithAuth(
        '/rest_v2/jobs/',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/job+json',
            Accept: 'application/job+json, application/json'
          },
          body: JSON.stringify(payload)
        },
        resolvedProfile
      );
    }

    if (!response.ok) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro ao criar job "${job.name}" (HTTP ${response.status}): ${errDetail}`);
      throw new Error(`Falha ao criar agendamento "${job.name}" (HTTP ${response.status}): ${errDetail}`);
    }

    let createdJob: ReportJob;
    const rawText = await response.text();
    if (rawText && rawText.trim()) {
      try {
        const parsed = JSON.parse(rawText);
        createdJob = this.mapRawJobToReportJob(parsed);
        createdJob.name = job.name || createdJob.name;
        createdJob.description = job.description ?? createdJob.description;
        createdJob.reportUnitUri = job.reportUnitUri || createdJob.reportUnitUri;
        createdJob.outputFormat = job.outputFormat || createdJob.outputFormat;
        if (job.parameters && job.parameters.length > 0) {
          createdJob.parameters = job.parameters;
        }
      } catch {
        createdJob = {
          id: String(Date.now()),
          name: job.name,
          description: job.description,
          reportUnitUri: job.reportUnitUri,
          outputFormat: job.outputFormat,
          parameters: job.parameters || [],
          triggers: [],
          createdAt: nowIso,
          updatedAt: nowIso
        };
      }
    } else {
      createdJob = {
        id: String(Date.now()),
        name: job.name,
        description: job.description,
        reportUnitUri: job.reportUnitUri,
        outputFormat: job.outputFormat,
        parameters: job.parameters || [],
        triggers: [],
        createdAt: nowIso,
        updatedAt: nowIso
      };
    }

    this.getOrCreateProfileJobMap(profileKey).set(createdJob.id, createdJob);
    this.invalidateCache(resolvedProfile?.id);
    this.log(`Agendamento "${createdJob.name}" (ID: ${createdJob.id}) criado com sucesso.`);
    return createdJob;
  }

  /**
   * Atualiza um ReportJob existente.
   * PUT /rest/v2/reportJobs/{id} (com fallback para POST/PUT /rest_v2/jobs/{id}).
   */
  public async updateJob(
    jobId: string,
    patch: Partial<ReportJob>,
    profile?: JasperServerProfile
  ): Promise<ReportJob> {
    const resolvedProfile = await this.resolveProfile(profile);
    const profileKey = this.getProfileStoreKey(resolvedProfile);
    const encodedId = encodeURIComponent(jobId);

    const existing = this.getOrCreateProfileJobMap(profileKey).get(jobId);
    const mergedInput = {
      name: patch.name ?? existing?.name ?? `Job ${jobId}`,
      description: patch.description ?? existing?.description,
      reportUnitUri: patch.reportUnitUri ?? existing?.reportUnitUri ?? '/',
      outputFormat: patch.outputFormat ?? existing?.outputFormat ?? 'PDF',
      parameters: patch.parameters ?? existing?.parameters ?? []
    };

    const payload = {
      id: Number.isNaN(Number(jobId)) ? jobId : Number(jobId),
      version: 0,
      ...this.buildServerJobPayload(mergedInput)
    };

    let response = await this.serverClient.requestWithAuth(
      `/rest/v2/reportJobs/${encodedId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, application/job+json'
        },
        body: JSON.stringify(payload)
      },
      resolvedProfile
    );

    if (response.status === 404 || response.status === 405 || response.status === 415) {
      response = await this.serverClient.requestWithAuth(
        `/rest_v2/jobs/${encodedId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/job+json',
            Accept: 'application/job+json, application/json'
          },
          body: JSON.stringify(payload)
        },
        resolvedProfile
      );
    }

    if (!response.ok) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro ao atualizar job "${jobId}" (HTTP ${response.status}): ${errDetail}`);
      throw new Error(`Falha ao atualizar agendamento "${jobId}" (HTTP ${response.status}): ${errDetail}`);
    }

    const nowIso = new Date().toISOString();
    const updatedJob: ReportJob = {
      id: jobId,
      name: mergedInput.name,
      description: mergedInput.description,
      reportUnitUri: mergedInput.reportUnitUri,
      outputFormat: mergedInput.outputFormat,
      parameters: mergedInput.parameters,
      triggers: patch.triggers ?? existing?.triggers ?? [],
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      lastExecution: patch.lastExecution ?? existing?.lastExecution
    };

    this.getOrCreateProfileJobMap(profileKey).set(jobId, updatedJob);
    this.invalidateCache(resolvedProfile?.id);
    this.log(`Agendamento "${updatedJob.name}" (ID: ${jobId}) atualizado.`);
    return updatedJob;
  }

  /**
   * Remove um ReportJob e seus triggers associados.
   * DELETE /rest/v2/reportJobs/{id} (com fallback para DELETE /rest_v2/jobs/{id}).
   */
  public async deleteJob(jobId: string, profile?: JasperServerProfile): Promise<void> {
    const resolvedProfile = await this.resolveProfile(profile);
    const profileKey = this.getProfileStoreKey(resolvedProfile);
    const encodedId = encodeURIComponent(jobId);

    let response = await this.serverClient.requestWithAuth(
      `/rest/v2/reportJobs/${encodedId}`,
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/json'
        }
      },
      resolvedProfile
    );

    if (response.status === 404) {
      response = await this.serverClient.requestWithAuth(
        `/rest_v2/jobs/${encodedId}`,
        {
          method: 'DELETE',
          headers: {
            Accept: 'application/json'
          }
        },
        resolvedProfile
      );
    }

    if (!response.ok && response.status !== 404) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro ao deletar job "${jobId}" (HTTP ${response.status}): ${errDetail}`);
      throw new Error(`Falha ao excluir agendamento "${jobId}" (HTTP ${response.status}): ${errDetail}`);
    }

    const existing = this.getOrCreateProfileJobMap(profileKey).get(jobId);
    if (existing) {
      for (const trig of existing.triggers) {
        this.localTriggersStore.delete(trig.id);
      }
    }
    this.getOrCreateProfileJobMap(profileKey).delete(jobId);
    this.localExecutionsStore.delete(jobId);
    this.invalidateCache(resolvedProfile?.id);
    this.log(`Agendamento "${jobId}" excluído com sucesso.`);
  }

  /**
   * Dispara execução imediata de um ReportJob.
   * PUT /rest/v2/reportJobs/{id}/runNow (com fallback para POST /rest_v2/reportExecutions).
   */
  public async runJobNow(
    jobId: string,
    overrideParams?: Record<string, string>,
    profile?: JasperServerProfile
  ): Promise<JobExecution> {
    const resolvedProfile = await this.resolveProfile(profile);
    const profileKey = this.getProfileStoreKey(resolvedProfile);
    const encodedId = encodeURIComponent(jobId);
    const existingJob = this.getOrCreateProfileJobMap(profileKey).get(jobId);

    const effectiveParams: Record<string, string> = {};
    if (existingJob?.parameters) {
      for (const p of existingJob.parameters) {
        if (p.defaultValue !== undefined && p.defaultValue !== '') {
          effectiveParams[p.name] = p.defaultValue;
        }
      }
    }
    if (overrideParams) {
      Object.assign(effectiveParams, overrideParams);
    }

    let response = await this.serverClient.requestWithAuth(
      `/rest/v2/reportJobs/${encodedId}/runNow`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ parameters: effectiveParams })
      },
      resolvedProfile
    );

    if (response.status === 404 && existingJob) {
      const execRequestPayload = {
        reportUnitUri: existingJob.reportUnitUri,
        async: true,
        outputFormat: existingJob.outputFormat.toLowerCase(),
        parameters: {
          reportParameter: Object.entries(effectiveParams).map(([name, val]) => ({
            name,
            value: [val]
          }))
        }
      };
      response = await this.serverClient.requestWithAuth(
        '/rest_v2/reportExecutions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify(execRequestPayload)
        },
        resolvedProfile
      );
    }

    if (!response.ok) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro ao executar job "${jobId}" agora (HTTP ${response.status}): ${errDetail}`);
      throw new Error(`Falha ao disparar execução do job "${jobId}" (HTTP ${response.status}): ${errDetail}`);
    }

    const startIso = new Date().toISOString();
    let execution: JobExecution = {
      id: `exec-${jobId}-${Date.now()}`,
      jobId,
      status: 'SUCCESS',
      startTime: startIso,
      endTime: new Date(Date.now() + 850).toISOString(),
      outputResource: existingJob
        ? {
            uri: `${existingJob.reportUnitUri}.${existingJob.outputFormat.toLowerCase()}`,
            mimeType: this.getMimeTypeForFormat(existingJob.outputFormat)
          }
        : undefined,
      parameters: effectiveParams
    };

    const rawText = await response.text();
    if (rawText && rawText.trim()) {
      try {
        const parsed = JSON.parse(rawText);
        execution = this.mapRawExecutionToJobExecution(parsed, jobId, effectiveParams);
      } catch {
        // Mantém execução construída
      }
    }

    this.recordLocalExecution(jobId, execution, profileKey);
    this.invalidateCache(resolvedProfile?.id);
    this.log(`Execução imediata iniciada para o job "${jobId}" (Execution ID: ${execution.id}).`);
    return execution;
  }

  // ==========================================================================
  // TRIGGERS CRUD
  // ==========================================================================

  /**
   * Lista triggers vinculados a um job.
   * GET /rest/v2/reportJobs/{jobId}/triggers
   */
  public async listTriggers(jobId: string, profile?: JasperServerProfile): Promise<Trigger[]> {
    const resolvedProfile = await this.resolveProfile(profile);
    const profileKey = this.getProfileStoreKey(resolvedProfile);
    const encodedJobId = encodeURIComponent(jobId);

    const response = await this.serverClient.requestWithAuth(
      `/rest/v2/reportJobs/${encodedJobId}/triggers`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      },
      resolvedProfile
    );

    if (response.status === 404) {
      const job = await this.getJob(jobId, resolvedProfile);
      return job.triggers;
    }

    if (!response.ok) {
      const cachedJob = this.getOrCreateProfileJobMap(profileKey).get(jobId);
      if (cachedJob) {
        return cachedJob.triggers;
      }
      const errDetail = await this.serverClient.extractErrorMessage(response);
      throw new Error(`Erro ao listar triggers do job "${jobId}" (HTTP ${response.status}): ${errDetail}`);
    }

    const rawText = await response.text();
    let items: any[] = [];
    if (rawText && rawText.trim()) {
      try {
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed)) {
          items = parsed;
        } else if (parsed && Array.isArray(parsed.triggers)) {
          items = parsed.triggers;
        }
      } catch {
        // Ignora
      }
    }

    const triggers = items.map((item) => this.mapRawTriggerToTrigger(item, jobId));
    for (const trig of triggers) {
      this.localTriggersStore.set(trig.id, trig);
    }

    const cachedJob = this.getOrCreateProfileJobMap(profileKey).get(jobId);
    if (cachedJob && triggers.length > 0) {
      cachedJob.triggers = triggers;
    }

    return triggers;
  }

  /**
   * Cria um SimpleTrigger, CronTrigger ou CalendarTrigger para um Job.
   * POST /rest/v2/reportJobs/{jobId}/triggers
   */
  public async createTrigger(
    jobId: string,
    trigger: Omit<Trigger, 'id' | 'jobId' | 'state' | 'nextFireTime' | 'previousFireTime'>,
    profile?: JasperServerProfile
  ): Promise<Trigger> {
    if ((trigger.type === 'CRON' || trigger.type === 'CALENDAR') && trigger.cronExpression) {
      const validation = this.validateCronExpression(trigger.cronExpression, trigger.timezone);
      if (!validation.valid) {
        throw new Error(validation.error || 'Expressão Quartz Cron inválida.');
      }
    }

    const resolvedProfile = await this.resolveProfile(profile);
    const profileKey = this.getProfileStoreKey(resolvedProfile);
    const encodedJobId = encodeURIComponent(jobId);

    const response = await this.serverClient.requestWithAuth(
      `/rest/v2/reportJobs/${encodedJobId}/triggers`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(trigger)
      },
      resolvedProfile
    );

    if (!response.ok && response.status !== 404) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro ao criar trigger no job "${jobId}" (HTTP ${response.status}): ${errDetail}`);
      throw new Error(`Falha ao criar trigger para o job "${jobId}" (HTTP ${response.status}): ${errDetail}`);
    }

    let nextFireTime: string | undefined;
    if ((trigger.type === 'CRON' || trigger.type === 'CALENDAR') && trigger.cronExpression) {
      const cronRes = this.validateCronExpression(trigger.cronExpression, trigger.timezone);
      nextFireTime = cronRes.nextRuns?.[0];
    }

    let createdTrigger: Trigger = {
      id: `trig-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      jobId,
      type: trigger.type,
      cronExpression: trigger.cronExpression,
      calendarName: trigger.calendarName,
      repeatInterval: trigger.repeatInterval,
      repeatCount: trigger.repeatCount,
      startTime: trigger.startTime || new Date().toISOString(),
      endTime: trigger.endTime,
      timezone: trigger.timezone || DEFAULT_TIMEZONE,
      state: 'NORMAL',
      nextFireTime
    };

    if (response.ok) {
      const rawText = await response.text();
      if (rawText && rawText.trim()) {
        try {
          const parsed = JSON.parse(rawText);
          createdTrigger = this.mapRawTriggerToTrigger(parsed, jobId, createdTrigger);
        } catch {
          // Mantém trigger construído
        }
      }
    }

    this.localTriggersStore.set(createdTrigger.id, createdTrigger);
    const existingJob = this.getOrCreateProfileJobMap(profileKey).get(jobId);
    if (existingJob) {
      existingJob.triggers = [
        ...existingJob.triggers.filter((t) => t.id !== createdTrigger.id),
        createdTrigger
      ];
    }

    this.invalidateCache(resolvedProfile?.id);
    this.log(`Trigger "${createdTrigger.id}" (${createdTrigger.type}) criado para o job "${jobId}".`);
    return createdTrigger;
  }

  /**
   * Obtém detalhes de um Trigger pelo ID.
   * GET /rest/v2/scheduler/triggers/{triggerId}
   */
  public async getTrigger(triggerId: string, profile?: JasperServerProfile): Promise<Trigger> {
    const resolvedProfile = await this.resolveProfile(profile);
    const encodedId = encodeURIComponent(triggerId);

    const response = await this.serverClient.requestWithAuth(
      `/rest/v2/scheduler/triggers/${encodedId}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      },
      resolvedProfile
    );

    if (!response.ok) {
      const local = this.localTriggersStore.get(triggerId);
      if (local) {
        return local;
      }
      const errDetail = await this.serverClient.extractErrorMessage(response);
      throw new Error(`Erro ao obter trigger "${triggerId}" (HTTP ${response.status}): ${errDetail}`);
    }

    const raw: any = await response.json();
    const mapped = this.mapRawTriggerToTrigger(raw, raw?.jobId || '', this.localTriggersStore.get(triggerId));
    this.localTriggersStore.set(mapped.id, mapped);
    return mapped;
  }

  /**
   * Atualiza expressão cron, recorrência ou timezone de um Trigger.
   * PUT /rest/v2/scheduler/triggers/{triggerId}
   */
  public async updateTrigger(
    triggerId: string,
    patch: Partial<Trigger>,
    profile?: JasperServerProfile
  ): Promise<Trigger> {
    const existing = this.localTriggersStore.get(triggerId);
    const effectiveType = patch.type ?? existing?.type ?? 'CRON';
    const effectiveCron = patch.cronExpression ?? existing?.cronExpression;
    const effectiveTz = patch.timezone ?? existing?.timezone ?? DEFAULT_TIMEZONE;

    if ((effectiveType === 'CRON' || effectiveType === 'CALENDAR') && effectiveCron) {
      const validation = this.validateCronExpression(effectiveCron, effectiveTz);
      if (!validation.valid) {
        throw new Error(validation.error || 'Expressão Quartz Cron inválida.');
      }
    }

    const resolvedProfile = await this.resolveProfile(profile);
    const encodedId = encodeURIComponent(triggerId);

    const response = await this.serverClient.requestWithAuth(
      `/rest/v2/scheduler/triggers/${encodedId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(patch)
      },
      resolvedProfile
    );

    if (!response.ok && response.status !== 404) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro ao atualizar trigger "${triggerId}" (HTTP ${response.status}): ${errDetail}`);
      throw new Error(`Falha ao atualizar trigger "${triggerId}" (HTTP ${response.status}): ${errDetail}`);
    }

    let nextFireTime = existing?.nextFireTime;
    if ((effectiveType === 'CRON' || effectiveType === 'CALENDAR') && effectiveCron) {
      const cronRes = this.validateCronExpression(effectiveCron, effectiveTz);
      nextFireTime = cronRes.nextRuns?.[0];
    }

    const updated: Trigger = {
      id: triggerId,
      jobId: patch.jobId ?? existing?.jobId ?? '',
      type: effectiveType,
      cronExpression: effectiveCron,
      calendarName: patch.calendarName ?? existing?.calendarName,
      repeatInterval: patch.repeatInterval ?? existing?.repeatInterval,
      repeatCount: patch.repeatCount ?? existing?.repeatCount,
      startTime: patch.startTime ?? existing?.startTime ?? new Date().toISOString(),
      endTime: patch.endTime ?? existing?.endTime,
      timezone: effectiveTz,
      state: patch.state ?? existing?.state ?? 'NORMAL',
      nextFireTime,
      previousFireTime: existing?.previousFireTime
    };

    this.localTriggersStore.set(triggerId, updated);
    this.syncTriggerInLocalJobs(updated);
    this.invalidateCache(resolvedProfile?.id);
    this.log(`Trigger "${triggerId}" atualizado.`);
    return updated;
  }

  /**
   * Remove um Trigger.
   * DELETE /rest/v2/scheduler/triggers/{triggerId}
   */
  public async deleteTrigger(triggerId: string, profile?: JasperServerProfile): Promise<void> {
    const resolvedProfile = await this.resolveProfile(profile);
    const encodedId = encodeURIComponent(triggerId);

    const response = await this.serverClient.requestWithAuth(
      `/rest/v2/scheduler/triggers/${encodedId}`,
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/json'
        }
      },
      resolvedProfile
    );

    if (!response.ok && response.status !== 404) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro ao deletar trigger "${triggerId}" (HTTP ${response.status}): ${errDetail}`);
      throw new Error(`Falha ao excluir trigger "${triggerId}" (HTTP ${response.status}): ${errDetail}`);
    }

    this.localTriggersStore.delete(triggerId);
    for (const jobMap of this.localJobsStore.values()) {
      for (const job of jobMap.values()) {
        job.triggers = job.triggers.filter((t) => t.id !== triggerId);
      }
    }

    this.invalidateCache(resolvedProfile?.id);
    this.log(`Trigger "${triggerId}" removido.`);
  }

  /**
   * Pausa um Trigger ativo.
   * PUT /rest/v2/scheduler/triggers/{triggerId}/pause
   */
  public async pauseTrigger(triggerId: string, profile?: JasperServerProfile): Promise<void> {
    const resolvedProfile = await this.resolveProfile(profile);
    const encodedId = encodeURIComponent(triggerId);
    const existing = this.localTriggersStore.get(triggerId);

    let response = await this.serverClient.requestWithAuth(
      `/rest/v2/scheduler/triggers/${encodedId}/pause`,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json'
        }
      },
      resolvedProfile
    );

    if (response.status === 404 && existing?.jobId) {
      response = await this.serverClient.requestWithAuth(
        '/rest_v2/jobs/pause',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({ jobId: [existing.jobId] })
        },
        resolvedProfile
      );
    }

    if (!response.ok && response.status !== 404) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro ao pausar trigger "${triggerId}" (HTTP ${response.status}): ${errDetail}`);
      throw new Error(`Falha ao pausar trigger "${triggerId}" (HTTP ${response.status}): ${errDetail}`);
    }

    if (existing) {
      existing.state = 'PAUSED';
      this.localTriggersStore.set(triggerId, existing);
      this.syncTriggerInLocalJobs(existing);
    }

    this.invalidateCache(resolvedProfile?.id);
    this.log(`Trigger "${triggerId}" pausado.`);
  }

  /**
   * Retoma um Trigger pausado.
   * PUT /rest/v2/scheduler/triggers/{triggerId}/resume
   */
  public async resumeTrigger(triggerId: string, profile?: JasperServerProfile): Promise<void> {
    const resolvedProfile = await this.resolveProfile(profile);
    const encodedId = encodeURIComponent(triggerId);
    const existing = this.localTriggersStore.get(triggerId);

    let response = await this.serverClient.requestWithAuth(
      `/rest/v2/scheduler/triggers/${encodedId}/resume`,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json'
        }
      },
      resolvedProfile
    );

    if (response.status === 404 && existing?.jobId) {
      response = await this.serverClient.requestWithAuth(
        '/rest_v2/jobs/resume',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({ jobId: [existing.jobId] })
        },
        resolvedProfile
      );
    }

    if (!response.ok && response.status !== 404) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro ao retomar trigger "${triggerId}" (HTTP ${response.status}): ${errDetail}`);
      throw new Error(`Falha ao retomar trigger "${triggerId}" (HTTP ${response.status}): ${errDetail}`);
    }

    if (existing) {
      existing.state = 'NORMAL';
      this.localTriggersStore.set(triggerId, existing);
      this.syncTriggerInLocalJobs(existing);
    }

    this.invalidateCache(resolvedProfile?.id);
    this.log(`Trigger "${triggerId}" retomado (NORMAL).`);
  }

  // ==========================================================================
  // EXECUTIONS CRUD
  // ==========================================================================

  /**
   * Lista o histórico paginado de execuções de um Job.
   * GET /rest/v2/reportJobs/{jobId}/executions
   */
  public async listExecutions(
    jobId: string,
    limit: number = DEFAULT_PAGE_LIMIT,
    offset: number = 0,
    profile?: JasperServerProfile
  ): Promise<JobExecution[]> {
    const resolvedProfile = await this.resolveProfile(profile);
    const encodedJobId = encodeURIComponent(jobId);
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    }).toString();

    let response = await this.serverClient.requestWithAuth(
      `/rest/v2/reportJobs/${encodedJobId}/executions?${query}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      },
      resolvedProfile
    );

    if (response.status === 404) {
      response = await this.serverClient.requestWithAuth(
        `/rest_v2/reportExecutions?jobId=${encodedJobId}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        },
        resolvedProfile
      );
    }

    const localHistory = this.localExecutionsStore.get(jobId) || [];

    if (response.status === 204 || response.status === 404) {
      return localHistory.slice(offset, offset + limit);
    }

    if (!response.ok) {
      if (localHistory.length > 0) {
        return localHistory.slice(offset, offset + limit);
      }
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro em listExecutions(${jobId}): ${errDetail}`);
      throw new Error(`Erro ao listar execuções do job "${jobId}" (HTTP ${response.status}): ${errDetail}`);
    }

    const rawText = await response.text();
    let items: any[] = [];
    if (rawText && rawText.trim()) {
      try {
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed)) {
          items = parsed;
        } else if (parsed && Array.isArray(parsed.executions)) {
          items = parsed.executions;
        } else if (parsed && Array.isArray(parsed.reportExecution)) {
          items = parsed.reportExecution;
        }
      } catch {
        // Ignora
      }
    }

    const mapped = items.map((item) => this.mapRawExecutionToJobExecution(item, jobId));
    const merged: JobExecution[] = [...mapped];
    for (const loc of localHistory) {
      if (!merged.some((m) => m.id === loc.id)) {
        merged.push(loc);
      }
    }

    merged.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    this.localExecutionsStore.set(jobId, merged);
    return merged.slice(offset, offset + limit);
  }

  /**
   * Obtém detalhes de uma execução específica.
   * GET /rest/v2/reportExecutions/{executionId}
   */
  public async getExecution(
    executionId: string,
    profile?: JasperServerProfile
  ): Promise<JobExecution> {
    const resolvedProfile = await this.resolveProfile(profile);
    const encodedId = encodeURIComponent(executionId);

    let response = await this.serverClient.requestWithAuth(
      `/rest/v2/reportExecutions/${encodedId}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      },
      resolvedProfile
    );

    if (response.status === 404) {
      response = await this.serverClient.requestWithAuth(
        `/rest_v2/reportExecutions/${encodedId}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        },
        resolvedProfile
      );
    }

    if (!response.ok) {
      const localMatch = this.findLocalExecutionById(executionId);
      if (localMatch) {
        return localMatch;
      }
      const errDetail = await this.serverClient.extractErrorMessage(response);
      throw new Error(`Erro ao obter execução "${executionId}" (HTTP ${response.status}): ${errDetail}`);
    }

    const raw: any = await response.json();
    return this.mapRawExecutionToJobExecution(raw, raw?.jobId || '');
  }

  /**
   * Faz download do binário de saída (PDF, XLS, CSV, etc.) gerado por uma execução.
   * GET /rest/v2/reportExecutions/{executionId} (outputResource)
   */
  public async downloadExecutionOutput(
    executionId: string,
    profile?: JasperServerProfile
  ): Promise<Uint8Array> {
    const resolvedProfile = await this.resolveProfile(profile);
    const encodedId = encodeURIComponent(executionId);

    // 1. Tenta endpoint direto de output da execução
    let response = await this.serverClient.requestWithAuth(
      `/rest/v2/reportExecutions/${encodedId}/output`,
      {
        method: 'GET',
        headers: {
          Accept: '*/*'
        }
      },
      resolvedProfile
    );

    // 2. Fallback: consulta detalhes da execução e baixa pelo outputResource.uri ou exports
    if (!response.ok) {
      const localExec = this.findLocalExecutionById(executionId);
      const outputUri = localExec?.outputResource?.uri;
      if (outputUri) {
        const resByUri = await this.serverClient.requestWithAuth(
          `/rest_v2/resources${encodeUriPath(outputUri)}`,
          {
            method: 'GET',
            headers: {
              Accept: '*/*'
            }
          },
          resolvedProfile
        );
        if (resByUri.ok) {
          response = resByUri;
        }
      }
    }

    if (!response.ok) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro ao baixar output da execução "${executionId}" (HTTP ${response.status}): ${errDetail}`);
      throw new Error(
        `Falha ao baixar output da execução "${executionId}" (HTTP ${response.status}): ${errDetail}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  /**
   * Cancela uma execução em andamento (RUNNING).
   * PUT /rest/v2/reportExecutions/{executionId}/cancel
   */
  public async cancelExecution(
    executionId: string,
    profile?: JasperServerProfile
  ): Promise<void> {
    const resolvedProfile = await this.resolveProfile(profile);
    const encodedId = encodeURIComponent(executionId);

    let response = await this.serverClient.requestWithAuth(
      `/rest/v2/reportExecutions/${encodedId}/cancel`,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json'
        }
      },
      resolvedProfile
    );

    if (response.status === 404) {
      response = await this.serverClient.requestWithAuth(
        `/rest_v2/reportExecutions/${encodedId}/status`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/status+json',
            Accept: 'application/json'
          },
          body: JSON.stringify({ value: 'cancelled' })
        },
        resolvedProfile
      );
    }

    if (!response.ok && response.status !== 404) {
      const errDetail = await this.serverClient.extractErrorMessage(response);
      this.log(`Erro ao cancelar execução "${executionId}" (HTTP ${response.status}): ${errDetail}`);
      throw new Error(`Falha ao cancelar execução "${executionId}" (HTTP ${response.status}): ${errDetail}`);
    }

    const localMatch = this.findLocalExecutionById(executionId);
    if (localMatch) {
      localMatch.status = 'CANCELLED';
      localMatch.endTime = new Date().toISOString();
    }

    this.invalidateCache(resolvedProfile?.id);
    this.log(`Execução "${executionId}" cancelada.`);
  }

  // ==========================================================================
  // UTILITÁRIOS
  // ==========================================================================

  /**
   * Valida expressão Quartz Cron client-side e retorna preview das próximas 5 execuções.
   */
  public validateCronExpression(
    expr: string,
    timezone: string = DEFAULT_TIMEZONE
  ): CronValidationResult {
    return validateQuartzCronExpression(expr, timezone);
  }

  /**
   * Inspeciona um Report Unit no JasperServer para sugerir parâmetros padrão no Job Editor.
   */
  public async getReportUnitParameters(
    reportUnitUri: string,
    profile?: JasperServerProfile
  ): Promise<JobParameter[]> {
    const resolvedProfile = await this.resolveProfile(profile);
    const cleanUri = reportUnitUri.trim().startsWith('/')
      ? reportUnitUri.trim()
      : `/${reportUnitUri.trim()}`;

    // 1. Tenta consultar inputControls REST v2 do relatório
    try {
      const icResponse = await this.serverClient.requestWithAuth(
        `/rest_v2/reports${encodeUriPath(cleanUri)}/inputControls`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        },
        resolvedProfile
      );

      if (icResponse.ok && icResponse.status !== 204) {
        const rawText = await icResponse.text();
        if (rawText && rawText.trim()) {
          const parsed = JSON.parse(rawText);
          const controls: any[] = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.inputControl)
            ? parsed.inputControl
            : [];
          if (controls.length > 0) {
            return controls.map((ic) => ({
              name: String(ic.id || ic.label || 'PARAM'),
              type: String(ic.dataType?.type || ic.type || 'java.lang.String'),
              defaultValue:
                ic.state?.value !== undefined ? String(ic.state.value) : undefined,
              isRequired: Boolean(ic.mandatory),
              isForPrompting: ic.visible !== false
            }));
          }
        }
      }
    } catch {
      // Fallback para download e parse estático do JRXML
    }

    // 2. Baixa o JRXML do Report Unit e extrai os parâmetros via jrxmlParser
    try {
      const xmlContent = await this.serverClient.downloadResource(cleanUri, resolvedProfile);
      const metadata = jrxmlParser.parse(xmlContent);
      return metadata.parameters.map((param) => ({
        name: param.name,
        type: param.className || 'java.lang.String',
        defaultValue: param.defaultValue,
        isForPrompting: param.isForPrompting !== false,
        isRequired:
          param.isForPrompting !== false &&
          (param.defaultValue === undefined || param.defaultValue === '')
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log(`Não foi possível inspecionar parâmetros de "${cleanUri}": ${msg}`);
      return [];
    }
  }

  // ==========================================================================
  // MAPEADORES E AUXILIARES INTERNOS
  // ==========================================================================

  private buildServerJobPayload(
    job: Omit<ReportJob, 'id' | 'createdAt' | 'updatedAt' | 'triggers'>
  ): Record<string, any> {
    const paramValues: Record<string, any> = {};
    for (const param of job.parameters || []) {
      if (param.defaultValue !== undefined) {
        paramValues[param.name] = [param.defaultValue];
      }
    }

    return {
      label: job.name,
      name: job.name,
      description: job.description || '',
      reportUnitURI: job.reportUnitUri,
      reportUnitUri: job.reportUnitUri,
      outputFormat: job.outputFormat,
      outputFormats: {
        outputFormat: [job.outputFormat]
      },
      source: {
        reportUnitURI: job.reportUnitUri,
        parameters: {
          parameterValues: paramValues
        }
      },
      parameters: job.parameters || []
    };
  }

  private mapRawJobToReportJob(raw: any, fallbackId?: string): ReportJob {
    const nowIso = new Date().toISOString();
    const id = String(raw?.id ?? fallbackId ?? Date.now());
    const name = String(raw?.name || raw?.label || `Job #${id}`);
    const description = raw?.description ? String(raw.description) : undefined;
    const reportUnitUri = String(
      raw?.reportUnitUri ||
        raw?.reportUnitURI ||
        raw?.source?.reportUnitURI ||
        '/reports/Report'
    );
    const outputFormat = normalizeOutputFormat(
      raw?.outputFormat || raw?.outputFormats?.outputFormat
    );

    const parameters: JobParameter[] = [];
    if (Array.isArray(raw?.parameters)) {
      for (const p of raw.parameters) {
        if (p && p.name) {
          parameters.push({
            name: String(p.name),
            type: String(p.type || 'java.lang.String'),
            defaultValue: p.defaultValue !== undefined ? String(p.defaultValue) : undefined,
            isRequired: Boolean(p.isRequired),
            isForPrompting: p.isForPrompting !== false
          });
        }
      }
    } else if (raw?.source?.parameters?.parameterValues) {
      const pv = raw.source.parameters.parameterValues;
      for (const [k, v] of Object.entries(pv)) {
        const val = Array.isArray(v) ? v[0] : v;
        parameters.push({
          name: k,
          type: 'java.lang.String',
          defaultValue: val !== undefined ? String(val) : undefined,
          isRequired: false,
          isForPrompting: true
        });
      }
    }

    const triggers: Trigger[] = [];
    if (Array.isArray(raw?.triggers)) {
      for (const t of raw.triggers) {
        triggers.push(this.mapRawTriggerToTrigger(t, id));
      }
    } else if (raw?.trigger) {
      const trigObj = raw.trigger.simpleTrigger || raw.trigger.calendarTrigger || raw.trigger;
      triggers.push(this.mapRawTriggerToTrigger(trigObj, id));
    }

    let lastExecution: JobExecution | undefined;
    if (raw?.lastExecution) {
      lastExecution = this.mapRawExecutionToJobExecution(raw.lastExecution, id);
    } else if (raw?.state?.previousFireTime) {
      lastExecution = {
        id: `exec-prev-${id}`,
        jobId: id,
        status: raw?.state?.value === 'ERROR' ? 'FAILED' : 'SUCCESS',
        startTime: String(raw.state.previousFireTime),
        endTime: String(raw.state.previousFireTime),
        parameters: {}
      };
    }

    return {
      id,
      name,
      description,
      reportUnitUri,
      outputFormat,
      parameters,
      triggers,
      createdAt: String(raw?.createdAt || raw?.creationDate || nowIso),
      updatedAt: String(raw?.updatedAt || raw?.updateDate || nowIso),
      lastExecution
    };
  }

  private mapRawTriggerToTrigger(raw: any, jobId: string, fallback?: Trigger): Trigger {
    const id = String(raw?.id ?? fallback?.id ?? `trig-${jobId || '0'}-1`);
    let type: TriggerType = fallback?.type ?? 'CRON';

    if (raw?.type) {
      const upperType = String(raw.type).toUpperCase();
      if (upperType === 'SIMPLE' || upperType === 'CRON' || upperType === 'CALENDAR') {
        type = upperType;
      }
    } else if (raw?.calendarName) {
      type = 'CALENDAR';
    } else if (raw?.repeatInterval !== undefined || raw?.recurrenceInterval !== undefined) {
      type = 'SIMPLE';
    }

    const cronExpression =
      raw?.cronExpression !== undefined
        ? String(raw.cronExpression)
        : fallback?.cronExpression;

    const repeatInterval =
      raw?.repeatInterval !== undefined
        ? Number(raw.repeatInterval)
        : raw?.recurrenceInterval !== undefined
        ? Number(raw.recurrenceInterval) * 60_000
        : fallback?.repeatInterval;

    const repeatCount =
      raw?.repeatCount !== undefined
        ? Number(raw.repeatCount)
        : raw?.occurrenceCount !== undefined
        ? Number(raw.occurrenceCount)
        : fallback?.repeatCount;

    const timezone = String(raw?.timezone || fallback?.timezone || DEFAULT_TIMEZONE);
    const state = normalizeTriggerState(raw?.state || raw?.triggerState || fallback?.state);

    let nextFireTime = raw?.nextFireTime
      ? String(raw.nextFireTime)
      : fallback?.nextFireTime;
    if (!nextFireTime && (type === 'CRON' || type === 'CALENDAR') && cronExpression) {
      const cronRes = validateQuartzCronExpression(cronExpression, timezone);
      nextFireTime = cronRes.nextRuns?.[0];
    }

    return {
      id,
      jobId: String(raw?.jobId || jobId || fallback?.jobId || ''),
      type,
      cronExpression,
      calendarName: raw?.calendarName ?? fallback?.calendarName,
      repeatInterval,
      repeatCount,
      startTime: String(raw?.startTime || raw?.startDate || fallback?.startTime || new Date().toISOString()),
      endTime: raw?.endTime || raw?.endDate ? String(raw.endTime || raw.endDate) : fallback?.endTime,
      timezone,
      state,
      nextFireTime,
      previousFireTime: raw?.previousFireTime ? String(raw.previousFireTime) : fallback?.previousFireTime
    };
  }

  private mapRawExecutionToJobExecution(
    raw: any,
    jobId: string,
    fallbackParams: Record<string, string> = {}
  ): JobExecution {
    const id = String(raw?.id || raw?.requestId || `exec-${Date.now()}`);
    const status = normalizeExecutionStatus(raw?.status?.value ?? raw?.status);
    const startTime = String(raw?.startTime || raw?.startDate || new Date().toISOString());
    const endTime = raw?.endTime || raw?.endDate ? String(raw.endTime || raw.endDate) : undefined;

    let outputResource: { uri: string; mimeType: string } | undefined;
    if (raw?.outputResource && typeof raw.outputResource.uri === 'string') {
      outputResource = {
        uri: raw.outputResource.uri,
        mimeType: String(raw.outputResource.mimeType || 'application/pdf')
      };
    } else if (Array.isArray(raw?.exports) && raw.exports[0]?.outputResource) {
      outputResource = {
        uri: String(raw.exports[0].outputResource.uri || `/executions/${id}/output`),
        mimeType: String(raw.exports[0].outputResource.contentType || 'application/pdf')
      };
    }

    const errorMessage =
      raw?.errorMessage ||
      raw?.errorDescriptor?.message ||
      raw?.exports?.[0]?.errorDescriptor?.message;

    const parameters: Record<string, string> = { ...fallbackParams };
    if (raw?.parameters && typeof raw.parameters === 'object' && !Array.isArray(raw.parameters)) {
      for (const [k, v] of Object.entries(raw.parameters)) {
        parameters[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
      }
    }

    return {
      id,
      jobId: String(raw?.jobId || jobId),
      status,
      startTime,
      endTime,
      outputResource,
      errorMessage: errorMessage ? String(errorMessage) : undefined,
      parameters
    };
  }

  private syncTriggerInLocalJobs(trigger: Trigger): void {
    for (const jobMap of this.localJobsStore.values()) {
      for (const job of jobMap.values()) {
        const idx = job.triggers.findIndex((t) => t.id === trigger.id);
        if (idx >= 0) {
          job.triggers[idx] = trigger;
        }
      }
    }
  }

  private recordLocalExecution(
    jobId: string,
    execution: JobExecution,
    profileKey: string
  ): void {
    const list = this.localExecutionsStore.get(jobId) || [];
    this.localExecutionsStore.set(jobId, [
      execution,
      ...list.filter((e) => e.id !== execution.id)
    ]);

    const job = this.getOrCreateProfileJobMap(profileKey).get(jobId);
    if (job) {
      job.lastExecution = execution;
    }
  }

  private findLocalExecutionById(executionId: string): JobExecution | undefined {
    for (const list of this.localExecutionsStore.values()) {
      const found = list.find((e) => e.id === executionId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private getMimeTypeForFormat(format: ReportOutputFormat): string {
    switch (format) {
      case 'PDF':
        return 'application/pdf';
      case 'XLS':
        return 'application/vnd.ms-excel';
      case 'CSV':
        return 'text/csv';
      case 'RTF':
        return 'application/rtf';
      case 'HTML':
        return 'text/html';
      case 'JRP':
        return 'application/octet-stream';
      default:
        return 'application/pdf';
    }
  }
}
