/* eslint-disable no-restricted-globals */
/**
 * Web Worker para linting e tokenização rápida de expressões JasperReports (Groovy/Java)
 * sem bloquear a thread principal de UI do Monaco Expression Editor.
 */
self.onmessage = function (event) {
  const data = event.data;
  if (!data || !data.type) {
    return;
  }

  if (data.type === 'tokenizeAndCheck') {
    const expression = String(data.expression || '');
    const requestId = data.requestId;
    const brackets = [];
    const quickErrors = [];

    for (let i = 0; i < expression.length; i++) {
      const ch = expression[i];
      if (ch === '(' || ch === '[' || ch === '{') {
        brackets.push({ ch, index: i });
      } else if (ch === ')' || ch === ']' || ch === '}') {
        brackets.pop();
      }
    }

    if (brackets.length > 0) {
      const last = brackets[brackets.length - 1];
      quickErrors.push({
        startOffset: last.index,
        endOffset: last.index + 1,
        message: 'Delimitador "' + last.ch + '" aberto e não fechado.'
      });
    }

    self.postMessage({
      type: 'tokenizeResult',
      requestId: requestId,
      quickErrors: quickErrors
    });
  }
};
