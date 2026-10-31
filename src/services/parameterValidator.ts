import * as path from 'path';
import {
  JrxmlField,
  JrxmlMetadata,
  JrxmlParameter,
  jrxmlParser,
  TextDocumentLike
} from './jrxmlParser';
import {
  areJavaTypesCompatible,
  BUILTIN_RULES,
  getConditionalErrorMessage,
  getRangeErrorMessage,
  getTypeValidationErrorMessage,
  inRange,
  isBooleanType,
  isDecimalType,
  isEmptyValue,
  isIntegerType,
  isJavaDateType,
  isNumericType,
  isStringType,
  isValidDateFormat,
  validateConditionalDependency,
  validateJavaType,
  ValidationContext,
  ValidationResult,
  ValidationRule,
  ValidationRuleType,
  ValidationSeverity
} from './parameterValidatorRules';

export {
  areJavaTypesCompatible,
  BUILTIN_RULES,
  getConditionalErrorMessage,
  getRangeErrorMessage,
  getTypeValidationErrorMessage,
  inRange,
  isBooleanType,
  isDecimalType,
  isEmptyValue,
  isIntegerType,
  isJavaDateType,
  isNumericType,
  isStringType,
  isValidDateFormat,
  validateConditionalDependency,
  validateJavaType,
  ValidationContext,
  ValidationResult,
  ValidationRule,
  ValidationRuleType,
  ValidationSeverity
};

export interface ValidationAllContext {
  parameter?: JrxmlParameter;
  parameters?: JrxmlParameter[];
  allParameters: Record<string, any>;
  fields: JrxmlField[];
  jrxmlPath?: string;
  showWarningsAsErrors?: boolean;
}

export interface FieldValidationStatus {
  fieldName: string;
  status: 'OK' | 'Tipo incompatível' | 'Obrigatório';
  severity: 'ok' | 'warning' | 'error';
  message: string;
  relatedParameter?: string;
}

export class ParameterValidator {
  private rules: ValidationRule[] = [];
  private cache = new Map<string, ValidationRule[]>(); // key: jrxmlPath
  private metadataCache = new Map<string, JrxmlMetadata>();

  constructor(initialRules: ValidationRule[] = BUILTIN_RULES) {
    this.rules = [...initialRules];
  }

  public registerRule(rule: ValidationRule): void {
    this.rules.push(rule);
    this.cache.clear();
  }

  public getRules(): ValidationRule[] {
    return [...this.rules];
  }

  public getCachedRules(jrxmlPath: string): ValidationRule[] | undefined {
    const normalized = this.normalizeCacheKey(jrxmlPath);
    return this.cache.get(normalized) ?? this.cache.get(jrxmlPath);
  }

  public invalidateCache(jrxmlPath?: string): void {
    if (!jrxmlPath) {
      this.cache.clear();
      this.metadataCache.clear();
      return;
    }
    const normalized = this.normalizeCacheKey(jrxmlPath);
    this.cache.delete(normalized);
    this.cache.delete(jrxmlPath);
    this.metadataCache.delete(normalized);
    this.metadataCache.delete(jrxmlPath);
  }

  public getCachedMetadata(
    jrxmlPath: string,
    document?: TextDocumentLike
  ): JrxmlMetadata {
    if (document) {
      const metadata = jrxmlParser.getMetadata(document);
      const normalized = this.normalizeCacheKey(jrxmlPath);
      this.metadataCache.set(normalized, metadata);
      this.metadataCache.set(jrxmlPath, metadata);
      return metadata;
    }

    const normalized = this.normalizeCacheKey(jrxmlPath);
    const cached =
      this.metadataCache.get(normalized) ?? this.metadataCache.get(jrxmlPath);
    if (cached) {
      return cached;
    }

    const metadata = jrxmlParser.getMetadata(jrxmlPath);
    this.metadataCache.set(normalized, metadata);
    this.metadataCache.set(jrxmlPath, metadata);
    return metadata;
  }

  public validateAll(
    params: Record<string, any>,
    context: ValidationAllContext
  ): ValidationResult[] {
    const allParameters = params || context.allParameters || {};
    const fields = context.fields || [];

    if (context.jrxmlPath && !this.getCachedRules(context.jrxmlPath)) {
      const normalized = this.normalizeCacheKey(context.jrxmlPath);
      const rulesSnapshot = [...this.rules];
      this.cache.set(normalized, rulesSnapshot);
      this.cache.set(context.jrxmlPath, rulesSnapshot);
    }

    let parameterList: JrxmlParameter[] = [];
    if (Array.isArray(context.parameters) && context.parameters.length > 0) {
      parameterList = context.parameters;
    } else if (context.parameter) {
      parameterList = [context.parameter];
    } else if (context.jrxmlPath) {
      try {
        parameterList = this.getCachedMetadata(context.jrxmlPath).parameters;
      } catch {
        parameterList = [];
      }
    }

    const results: ValidationResult[] = [];

    for (const param of parameterList) {
      const val =
        allParameters[param.name] !== undefined
          ? allParameters[param.name]
          : param.defaultValue;

      const singleContext: ValidationContext = {
        parameter: param,
        parameters: parameterList,
        allParameters,
        fields,
        jrxmlPath: context.jrxmlPath,
        showWarningsAsErrors: context.showWarningsAsErrors
      };

      const paramResults = this.validateSingle(param.name, val, singleContext);
      results.push(...paramResults);
    }

    return results;
  }

  public validateSingle(
    paramName: string,
    value: any,
    context: ValidationContext
  ): ValidationResult[] {
    const activeRules =
      (context.jrxmlPath ? this.getCachedRules(context.jrxmlPath) : undefined) ??
      this.rules;

    const results: ValidationResult[] = [];
    const targetParam: JrxmlParameter = context.parameter || {
      name: paramName,
      className: 'java.lang.String',
      isForPrompting: true
    };

    const singleContext: ValidationContext = {
      ...context,
      parameter: targetParam,
      allParameters: {
        ...(context.allParameters || {}),
        [paramName]: value
      }
    };

    for (const rule of activeRules) {
      let passed = true;
      try {
        passed = rule.validate(value, singleContext);
      } catch {
        passed = false;
      }

      if (!passed) {
        const message = rule.getMessage
          ? rule.getMessage(value, singleContext)
          : rule.message;
        const severity: ValidationSeverity =
          context.showWarningsAsErrors && rule.severity === 'warning'
            ? 'error'
            : rule.severity;

        results.push({
          parameterName: paramName,
          rule,
          passed: false,
          message,
          severity
        });
      }
    }

    return results;
  }

  /**
   * Valida a compatibilidade entre fields do relatório e parâmetros esperados / tipos JDBC.
   */
  public validateFields(
    fields: Array<{
      name: string;
      javaClass?: string;
      className?: string;
      xmlDeclaredClass?: string;
      jdbcSuggestedClass?: string;
      nullable?: string;
    }>,
    parameters: JrxmlParameter[],
    params: Record<string, any> = {}
  ): Map<string, FieldValidationStatus> {
    const statusMap = new Map<string, FieldValidationStatus>();
    const paramByNormalizedName = new Map<string, JrxmlParameter>();

    for (const p of parameters) {
      const lower = p.name.toLowerCase();
      paramByNormalizedName.set(lower, p);
      const stripped = lower.replace(/^(?:p_|param_|prm_)/, '');
      if (stripped && !paramByNormalizedName.has(stripped)) {
        paramByNormalizedName.set(stripped, p);
      }
    }

    for (const field of fields) {
      const fieldType =
        field.javaClass || field.className || field.xmlDeclaredClass || 'java.lang.String';
      const fieldKey = field.name.toLowerCase();
      const matchedParam =
        paramByNormalizedName.get(fieldKey) ??
        paramByNormalizedName.get(fieldKey.replace(/^(?:f_|fld_)/, ''));

      // 1. Verifica incompatibilidade entre tipo XML declarado e tipo JDBC sugerido
      if (
        field.xmlDeclaredClass &&
        field.jdbcSuggestedClass &&
        !areJavaTypesCompatible(field.xmlDeclaredClass, field.jdbcSuggestedClass)
      ) {
        statusMap.set(field.name, {
          fieldName: field.name,
          status: 'Tipo incompatível',
          severity: 'error',
          message: `Tipo no JRXML (${this.shortType(field.xmlDeclaredClass)}) difere do tipo JDBC (${this.shortType(field.jdbcSuggestedClass)})`
        });
        continue;
      }

      // 2. Cross-reference com parâmetro correspondente
      if (matchedParam) {
        if (!areJavaTypesCompatible(fieldType, matchedParam.className)) {
          statusMap.set(field.name, {
            fieldName: field.name,
            status: 'Tipo incompatível',
            severity: 'error',
            relatedParameter: matchedParam.name,
            message: `Tipo do field (${this.shortType(fieldType)}) incompatível com parâmetro $P{${matchedParam.name}} (${this.shortType(matchedParam.className)})`
          });
          continue;
        }

        const currentVal =
          params[matchedParam.name] !== undefined
            ? params[matchedParam.name]
            : matchedParam.defaultValue;

        if (matchedParam.isForPrompting !== false && isEmptyValue(currentVal)) {
          statusMap.set(field.name, {
            fieldName: field.name,
            status: 'Obrigatório',
            severity: 'warning',
            relatedParameter: matchedParam.name,
            message: `Parâmetro associado $P{${matchedParam.name}} é obrigatório`
          });
          continue;
        }
      }

      // 3. Caso coluna JDBC seja NOT NULL e field não possua inconsistências
      if (field.nullable === 'NO' && matchedParam && matchedParam.isForPrompting !== false) {
        const currentVal =
          params[matchedParam.name] !== undefined
            ? params[matchedParam.name]
            : matchedParam.defaultValue;
        if (isEmptyValue(currentVal)) {
          statusMap.set(field.name, {
            fieldName: field.name,
            status: 'Obrigatório',
            severity: 'warning',
            relatedParameter: matchedParam.name,
            message: `Coluna não nula vinculada ao parâmetro obrigatório $P{${matchedParam.name}}`
          });
          continue;
        }
      }

      statusMap.set(field.name, {
        fieldName: field.name,
        status: 'OK',
        severity: 'ok',
        relatedParameter: matchedParam?.name,
        message: matchedParam
          ? `Compatível com $P{${matchedParam.name}} (${this.shortType(matchedParam.className)})`
          : `Tipo válido (${this.shortType(fieldType)})`
      });
    }

    return statusMap;
  }

  private shortType(className: string): string {
    const idx = className.lastIndexOf('.');
    return idx >= 0 ? className.slice(idx + 1) : className;
  }

  private normalizeCacheKey(jrxmlPath: string): string {
    try {
      return path.resolve(jrxmlPath).toLowerCase();
    } catch {
      return jrxmlPath.toLowerCase();
    }
  }
}

export const parameterValidator = new ParameterValidator();
