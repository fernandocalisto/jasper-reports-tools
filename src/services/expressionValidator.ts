export {
  ExpressionLanguage,
  ExpressionDiagnosticSeverity,
  ExpressionDiagnostic,
  ExpressionReference,
  ExpressionValidationResult,
  MockDataEntry,
  ExpressionPreviewResult,
  JrxmlExpressionOccurrence,
  JRXML_EXPRESSION_TAG_NAMES,
  detectReportLanguage,
  extractExpressionsFromXml,
  findExpressionAtLine,
  formatExpressionForXmlTag,
  applyExpressionEditToDocument,
  inferExpressionType,
  isNumericJavaType,
  isDateJavaType,
  areJavaTypesCompatible,
  validateExpression,
  generateSyntheticValueForType,
  generateMockDataForMetadata,
  formatJavaDatePattern,
  formatJavaDecimalPattern,
  evaluateExpressionWithMock,
  ExpressionEditorService,
  expressionEditorService
} from './expressionEditor';
import {
  ExpressionEditorService,
  expressionEditorService
} from './expressionEditor';

export const ExpressionValidator = ExpressionEditorService;
export const expressionValidator = expressionEditorService;
