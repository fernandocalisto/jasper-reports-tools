import { JrxmlField, JrxmlParameter, JrxmlParameterCondition } from './jrxmlParser';

export type ValidationRuleType =
  | 'required'
  | 'type'
  | 'format'
  | 'range'
  | 'pattern'
  | 'enum'
  | 'conditional';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationContext {
  parameter: JrxmlParameter; // Metadados do parâmetro do JRXML
  parameters?: JrxmlParameter[]; // Lista completa de parâmetros do relatório
  allParameters: Record<string, any>; // Todos valores atuais
  fields: JrxmlField[]; // Fields do relatório (para cross-ref)
  jrxmlPath?: string;
  showWarningsAsErrors?: boolean;
}

export interface ValidationRule {
  type: ValidationRuleType;
  severity: ValidationSeverity;
  message: string;
  validate: (value: any, context: ValidationContext) => boolean;
  getMessage?: (value: any, context: ValidationContext) => string;
}

export interface ValidationResult {
  parameterName: string;
  rule: ValidationRule;
  passed: boolean;
  message: string;
  severity: ValidationSeverity;
}

const INTEGER_TYPES = new Set<string>([
  'java.lang.integer',
  'integer',
  'int',
  'java.lang.long',
  'long',
  'java.lang.short',
  'short',
  'java.lang.byte',
  'byte',
  'java.math.biginteger',
  'biginteger'
]);

const DECIMAL_TYPES = new Set<string>([
  'java.math.bigdecimal',
  'bigdecimal',
  'java.lang.double',
  'double',
  'java.lang.float',
  'float',
  'java.lang.number',
  'number'
]);

const BOOLEAN_TYPES = new Set<string>([
  'java.lang.boolean',
  'boolean'
]);

const DATE_TYPES = new Set<string>([
  'java.util.date',
  'date',
  'java.sql.date',
  'java.sql.timestamp',
  'timestamp',
  'java.sql.time',
  'time',
  'java.time.localdate',
  'localdate',
  'java.time.localdatetime',
  'localdatetime',
  'java.time.offsetdatetime',
  'offsetdatetime',
  'java.time.zoneddatetime',
  'zoneddatetime'
]);

const STRING_TYPES = new Set<string>([
  'java.lang.string',
  'string',
  'java.lang.character',
  'character',
  'char',
  'java.lang.charsequence'
]);

export function normalizeClassName(className?: string): string {
  return (className || 'java.lang.String').trim().toLowerCase();
}

export function isEmptyValue(value: any): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

export function isIntegerType(className?: string): boolean {
  return INTEGER_TYPES.has(normalizeClassName(className));
}

export function isDecimalType(className?: string): boolean {
  return DECIMAL_TYPES.has(normalizeClassName(className));
}

export function isNumericType(className?: string): boolean {
  const normalized = normalizeClassName(className);
  return INTEGER_TYPES.has(normalized) || DECIMAL_TYPES.has(normalized);
}

export function isBooleanType(className?: string): boolean {
  return BOOLEAN_TYPES.has(normalizeClassName(className));
}

export function isJavaDateType(className?: string): boolean {
  return DATE_TYPES.has(normalizeClassName(className));
}

export function isStringType(className?: string): boolean {
  return STRING_TYPES.has(normalizeClassName(className));
}

export function validateJavaType(value: any, className?: string): boolean {
  if (isEmptyValue(value)) {
    return true;
  }

  const normalized = normalizeClassName(className);

  if (INTEGER_TYPES.has(normalized)) {
    if (typeof value === 'number') {
      return Number.isInteger(value) && Number.isFinite(value);
    }
    const str = String(value).trim();
    if (!/^-?\d+$/.test(str)) {
      return false;
    }
    if (normalized.endsWith('byte')) {
      const n = Number(str);
      return n >= -128 && n <= 127;
    }
    if (normalized.endsWith('short')) {
      const n = Number(str);
      return n >= -32768 && n <= 32767;
    }
    if (normalized.endsWith('integer') || normalized === 'int') {
      const n = Number(str);
      return n >= -2147483648 && n <= 2147483647;
    }
    return true;
  }

  if (DECIMAL_TYPES.has(normalized)) {
    if (typeof value === 'number') {
      return Number.isFinite(value);
    }
    const str = String(value).trim();
    if (!/^-?\d+([.,]\d+)?$/.test(str)) {
      return false;
    }
    const num = Number(str.replace(',', '.'));
    return Number.isFinite(num);
  }

  if (BOOLEAN_TYPES.has(normalized)) {
    if (typeof value === 'boolean') {
      return true;
    }
    const str = String(value).trim().toLowerCase();
    return str === 'true' || str === 'false' || str === '1' || str === '0';
  }

  if (DATE_TYPES.has(normalized)) {
    // O formato específico de data (yyyy-MM-dd ou dd/MM/yyyy) é validado pela regra 'format'
    return typeof value === 'string' || value instanceof Date || typeof value === 'number';
  }

  if (STRING_TYPES.has(normalized)) {
    return (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    );
  }

  return true;
}

export function getTypeValidationErrorMessage(className?: string): string {
  if (isIntegerType(className)) {
    return 'Esperado número inteiro';
  }
  if (isDecimalType(className)) {
    return 'Esperado valor numérico';
  }
  if (isBooleanType(className)) {
    return 'Esperado valor booleano (true/false)';
  }
  if (isJavaDateType(className)) {
    return 'Data inválida';
  }
  return `Valor incompatível com o tipo ${className || 'String'}`;
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  if ([4, 6, 9, 11].includes(month)) {
    return 30;
  }
  return 31;
}

function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): boolean {
  if (year < 1000 || year > 9999) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  const maxDay = getDaysInMonth(year, month);
  if (day < 1 || day > maxDay) {
    return false;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return false;
  }
  return true;
}

export function isValidDateFormat(value: any): boolean {
  if (isEmptyValue(value)) {
    return true;
  }
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  const str = String(value).trim();

  // Formato ISO: yyyy-MM-dd (com hora opcional)
  const isoMatch =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      str
    );
  if (isoMatch) {
    return isValidCalendarDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
      isoMatch[4] ? Number(isoMatch[4]) : 0,
      isoMatch[5] ? Number(isoMatch[5]) : 0,
      isoMatch[6] ? Number(isoMatch[6]) : 0
    );
  }

  // Formato BR: dd/MM/yyyy (com hora opcional)
  const brMatch =
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(str);
  if (brMatch) {
    return isValidCalendarDate(
      Number(brMatch[3]),
      Number(brMatch[2]),
      Number(brMatch[1]),
      brMatch[4] ? Number(brMatch[4]) : 0,
      brMatch[5] ? Number(brMatch[5]) : 0,
      brMatch[6] ? Number(brMatch[6]) : 0
    );
  }

  return false;
}

export function inRange(value: any, min?: number, max?: number): boolean {
  if (isEmptyValue(value)) {
    return true;
  }
  if (min === undefined && max === undefined) {
    return true;
  }

  const num =
    typeof value === 'number'
      ? value
      : Number(String(value).trim().replace(',', '.'));
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    return false;
  }

  if (min !== undefined && min !== null && num < Number(min)) {
    return false;
  }
  if (max !== undefined && max !== null && num > Number(max)) {
    return false;
  }

  return true;
}

export function getRangeErrorMessage(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) {
    return `Valor fora do range ${min}-${max}`;
  }
  if (min !== undefined) {
    return `Valor fora do range (mínimo: ${min})`;
  }
  if (max !== undefined) {
    return `Valor fora do range (máximo: ${max})`;
  }
  return 'Valor fora do range permitido';
}

function resolveCondition(param: JrxmlParameter): JrxmlParameterCondition | undefined {
  if (param.conditional) {
    return param.conditional;
  }
  if (!param.dependsOn) {
    return undefined;
  }
  if (typeof param.dependsOn === 'object') {
    return param.dependsOn;
  }
  const raw = String(param.dependsOn).trim();
  if (!raw) {
    return undefined;
  }
  const neqIdx = raw.indexOf('!=');
  if (neqIdx > 0) {
    return {
      parameter: raw.slice(0, neqIdx).trim(),
      value: raw.slice(neqIdx + 2).trim(),
      operator: 'neq'
    };
  }
  const eqIdx = raw.indexOf('=');
  if (eqIdx > 0) {
    const depParam = raw.slice(0, eqIdx).trim();
    const rhs = raw.slice(eqIdx + 1).trim();
    if (rhs.includes(',')) {
      return {
        parameter: depParam,
        values: rhs.split(',').map((s) => s.trim()).filter(Boolean),
        operator: 'in'
      };
    }
    return {
      parameter: depParam,
      value: rhs,
      operator: 'eq'
    };
  }
  return {
    parameter: raw,
    operator: 'notEmpty'
  };
}

export function isConditionTriggered(
  condition: JrxmlParameterCondition,
  allParameters: Record<string, any>
): boolean {
  const actualValue = allParameters ? allParameters[condition.parameter] : undefined;
  const op = condition.operator || (condition.value !== undefined ? 'eq' : 'notEmpty');

  if (op === 'notEmpty') {
    return !isEmptyValue(actualValue);
  }

  const normalizedActual =
    actualValue === undefined || actualValue === null ? '' : String(actualValue).trim();

  if (op === 'neq') {
    return normalizedActual !== String(condition.value ?? '').trim();
  }

  if (op === 'in' && Array.isArray(condition.values)) {
    return condition.values.some((v) => String(v).trim() === normalizedActual);
  }

  return normalizedActual === String(condition.value ?? '').trim();
}

export function validateConditionalDependency(
  value: any,
  context: ValidationContext
): boolean {
  const condition = resolveCondition(context.parameter);
  if (!condition) {
    return true;
  }
  const triggered = isConditionTriggered(condition, context.allParameters);
  if (!triggered) {
    return true;
  }
  return !isEmptyValue(value);
}

export function getConditionalErrorMessage(context: ValidationContext): string {
  const condition = resolveCondition(context.parameter);
  if (!condition) {
    return 'Parâmetro condicional obrigatório';
  }
  if (condition.value !== undefined) {
    return `Obrigatório quando "${condition.parameter}" é "${condition.value}"`;
  }
  if (Array.isArray(condition.values) && condition.values.length > 0) {
    return `Obrigatório quando "${condition.parameter}" está em [${condition.values.join(', ')}]`;
  }
  return `Obrigatório quando "${condition.parameter}" está preenchido`;
}

export function areJavaTypesCompatible(
  firstClass?: string,
  secondClass?: string
): boolean {
  if (!firstClass || !secondClass) {
    return true;
  }
  const a = normalizeClassName(firstClass);
  const b = normalizeClassName(secondClass);
  if (a === b || a === 'java.lang.object' || b === 'java.lang.object') {
    return true;
  }
  if (isIntegerType(a) && isIntegerType(b)) {
    return true;
  }
  if (isDecimalType(a) && isDecimalType(b)) {
    return true;
  }
  if (isNumericType(a) && isNumericType(b)) {
    return true;
  }
  if (isJavaDateType(a) && isJavaDateType(b)) {
    return true;
  }
  if (isBooleanType(a) && isBooleanType(b)) {
    return true;
  }
  if (isStringType(a) && isStringType(b)) {
    return true;
  }
  return false;
}

export const BUILTIN_RULES: ValidationRule[] = [
  // Obrigatório
  {
    type: 'required',
    severity: 'error',
    message: 'Parâmetro obrigatório',
    validate: (v, ctx) => {
      // Se o parâmetro possui regra condicional, a obrigatoriedade é tratada pela regra 'conditional'
      if (ctx.parameter.conditional || ctx.parameter.dependsOn) {
        return true;
      }
      const isPrompt = ctx.parameter.isForPrompting !== false;
      if (!isPrompt) {
        return true;
      }
      return !isEmptyValue(v);
    }
  },

  // Tipo - Java primitives / wrappers
  {
    type: 'type',
    severity: 'error',
    message: 'Esperado valor compatível com o tipo do parâmetro',
    getMessage: (_v, ctx) => getTypeValidationErrorMessage(ctx.parameter.className),
    validate: (v, ctx) => {
      if (isEmptyValue(v)) {
        return true;
      }
      return validateJavaType(v, ctx.parameter.className);
    }
  },

  // Formato Data
  {
    type: 'format',
    severity: 'error',
    message: 'Data inválida',
    validate: (v, ctx) => {
      if (isEmptyValue(v) || !isJavaDateType(ctx.parameter.className)) {
        return true;
      }
      return isValidDateFormat(v);
    }
  },

  // Range numérico
  {
    type: 'range',
    severity: 'warning',
    message: 'Valor fora do range permitido',
    getMessage: (_v, ctx) => getRangeErrorMessage(ctx.parameter.min, ctx.parameter.max),
    validate: (v, ctx) => {
      if (isEmptyValue(v) || !isNumericType(ctx.parameter.className)) {
        return true;
      }
      if (ctx.parameter.min === undefined && ctx.parameter.max === undefined) {
        return true;
      }
      // Se o valor não é numérico, a regra 'type' já aponta o erro de tipo
      if (!validateJavaType(v, ctx.parameter.className)) {
        return true;
      }
      return inRange(v, ctx.parameter.min, ctx.parameter.max);
    }
  },

  // Pattern/Regex
  {
    type: 'pattern',
    severity: 'warning',
    message: 'Formato inválido',
    validate: (v, ctx) => {
      if (isEmptyValue(v) || !ctx.parameter.pattern) {
        return true;
      }
      if (!isStringType(ctx.parameter.className)) {
        return true;
      }
      try {
        return new RegExp(ctx.parameter.pattern).test(String(v));
      } catch {
        return true;
      }
    }
  },

  // Enum / Valores permitidos
  {
    type: 'enum',
    severity: 'error',
    message: 'Valor não permitido',
    validate: (v, ctx) => {
      if (
        isEmptyValue(v) ||
        !Array.isArray(ctx.parameter.validValues) ||
        ctx.parameter.validValues.length === 0
      ) {
        return true;
      }
      const normalizedVal = String(v).trim();
      return ctx.parameter.validValues.some(
        (allowed) => String(allowed).trim() === normalizedVal
      );
    }
  },

  // Dependências condicionais
  {
    type: 'conditional',
    severity: 'error',
    message: 'Parâmetro condicional obrigatório',
    getMessage: (_v, ctx) => getConditionalErrorMessage(ctx),
    validate: (v, ctx) => validateConditionalDependency(v, ctx)
  }
];
