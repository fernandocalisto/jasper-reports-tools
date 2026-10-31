(function () {
  const vscode = acquireVsCodeApi();

  const workerSrc = document.body.getAttribute('data-worker-src');
  if (typeof pdfjsLib !== 'undefined' && workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  }

  // Elementos da UI
  const loadingBar = document.getElementById('loadingBar');
  const refreshBtn = document.getElementById('refreshBtn');
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  const exportJasperBtn = document.getElementById('exportJasperBtn');
  const toggleParamsBtn = document.getElementById('toggleParamsBtn');
  const paramCountSpan = document.getElementById('paramCount');
  const validationBadge = document.getElementById('validationBadge');
  const validationBadgeIcon = document.getElementById('validationBadgeIcon');
  const validationBadgeText = document.getElementById('validationBadgeText');
  const validateNowBtn = document.getElementById('validateNowBtn');
  const autoReloadToggle = document.getElementById('autoReloadToggle');

  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const pageIndicator = document.getElementById('pageIndicator');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomIndicator = document.getElementById('zoomIndicator');
  const fitWidthBtn = document.getElementById('fitWidthBtn');
  const resetZoomBtn = document.getElementById('resetZoomBtn');

  const reportTitleLabel = document.getElementById('reportTitleLabel');
  const connectionStatusLabel = document.getElementById('connectionStatusLabel');
  const executionStatsLabel = document.getElementById('executionStatsLabel');

  const paramsSection = document.getElementById('paramsSection');
  const paramsForm = document.getElementById('paramsForm');
  const emptyParamsHint = document.getElementById('emptyParamsHint');

  const statusBanner = document.getElementById('statusBanner');
  const statusTitle = document.getElementById('statusTitle');
  const statusMessage = document.getElementById('statusMessage');
  const openLogBtn = document.getElementById('openLogBtn');
  const dismissBannerBtn = document.getElementById('dismissBannerBtn');

  const viewerViewport = document.getElementById('viewerViewport');
  const emptyState = document.getElementById('emptyState');
  const emptyStateText = document.getElementById('emptyStateText');
  const canvasWrapper = document.getElementById('canvasWrapper');
  const pdfCanvas = document.getElementById('pdfCanvas');

  const validationSidePanel = document.getElementById('validationSidePanel');
  const closeValidationPanelBtn = document.getElementById('closeValidationPanelBtn');
  const validationEmptyHint = document.getElementById('validationEmptyHint');
  const validationErrorsGroup = document.getElementById('validationErrorsGroup');
  const validationErrorsCount = document.getElementById('validationErrorsCount');
  const validationErrorsList = document.getElementById('validationErrorsList');
  const validationWarningsGroup = document.getElementById('validationWarningsGroup');
  const validationWarningsCount = document.getElementById('validationWarningsCount');
  const validationWarningsList = document.getElementById('validationWarningsList');

  // Estado interno
  let currentParameters = [];
  const paramValues = Object.create(null);
  let paramsCollapsed = false;
  let isProcessing = false;
  let validationSettings = {
    enabled: true,
    autoValidateOnPreviewOpen: true,
    debounceMs: 300,
    showWarningsAsErrors: false
  };
  let currentValidationResults = [];
  let hasBlockingErrors = false;
  let validationDebounceTimer = null;
  let sidePanelOpen = false;

  // Estado do PDF.js
  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 0;
  let zoomScale = 1.0;
  let fitWidthMode = false;
  let activeRenderTask = null;
  let pendingRenderPage = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setLoading(loading, message) {
    isProcessing = Boolean(loading);
    if (loadingBar) {
      loadingBar.classList.toggle('hidden', !isProcessing);
    }
    if (refreshBtn) {
      refreshBtn.disabled = isProcessing || (validationSettings.enabled && hasBlockingErrors);
      refreshBtn.textContent = isProcessing ? 'Processando...' : 'Atualizar';
    }
    if (exportPdfBtn) {
      exportPdfBtn.disabled = isProcessing;
    }
    if (exportJasperBtn) {
      exportJasperBtn.disabled = isProcessing;
    }
    if (isProcessing && !pdfDoc && emptyStateText && message) {
      emptyStateText.textContent = message;
    }
  }

  function showBanner(title, message, type, showLogAction) {
    if (!statusBanner) {
      return;
    }
    statusTitle.textContent = title ? title + ': ' : '';
    statusMessage.textContent = message || '';
    statusBanner.className = 'status-banner status-' + (type || 'info');
    if (openLogBtn) {
      openLogBtn.classList.toggle('hidden', !showLogAction);
    }
  }

  function hideBanner() {
    if (!statusBanner) {
      return;
    }
    statusBanner.className = 'status-banner hidden';
    statusTitle.textContent = '';
    statusMessage.textContent = '';
  }

  function getShortClassName(className) {
    if (!className) {
      return 'String';
    }
    const idx = className.lastIndexOf('.');
    return idx >= 0 ? className.slice(idx + 1) : className;
  }

  function getParamCategory(className) {
    const normalized = (className || 'java.lang.String').trim();
    if (normalized === 'java.lang.Boolean' || normalized === 'boolean') {
      return 'boolean';
    }
    if (
      normalized === 'java.util.Date' ||
      normalized === 'Date' ||
      normalized === 'java.sql.Date' ||
      normalized === 'java.sql.Timestamp' ||
      normalized === 'Timestamp' ||
      normalized === 'java.time.LocalDate' ||
      normalized === 'LocalDate' ||
      normalized === 'java.time.LocalDateTime' ||
      normalized === 'LocalDateTime'
    ) {
      return 'date';
    }
    if (
      normalized === 'java.lang.Integer' ||
      normalized === 'Integer' ||
      normalized === 'java.lang.Long' ||
      normalized === 'Long' ||
      normalized === 'java.lang.Short' ||
      normalized === 'Short' ||
      normalized === 'java.lang.Byte' ||
      normalized === 'Byte' ||
      normalized === 'java.math.BigInteger' ||
      normalized === 'BigInteger' ||
      normalized === 'int' ||
      normalized === 'long'
    ) {
      return 'integer';
    }
    if (
      normalized === 'java.math.BigDecimal' ||
      normalized === 'BigDecimal' ||
      normalized === 'java.lang.Double' ||
      normalized === 'Double' ||
      normalized === 'java.lang.Float' ||
      normalized === 'Float' ||
      normalized === 'java.lang.Number' ||
      normalized === 'Number' ||
      normalized === 'double' ||
      normalized === 'float'
    ) {
      return 'decimal';
    }
    return 'string';
  }

  function extractInitialDefaultValue(param, category) {
    const raw = param.defaultValue;
    if (raw === undefined || raw === null) {
      return { value: '', placeholder: '' };
    }
    const trimmed = String(raw).trim();
    if (!trimmed || trimmed === 'null') {
      return { value: '', placeholder: '' };
    }

    if (category === 'boolean') {
      const lower = trimmed.toLowerCase();
      if (lower === 'true' || lower === 'boolean.true' || lower === '1') {
        return { value: true, placeholder: '' };
      }
      if (lower === 'false' || lower === 'boolean.false' || lower === '0') {
        return { value: false, placeholder: '' };
      }
      return { value: false, placeholder: trimmed };
    }

    if (category === 'integer' || category === 'decimal') {
      if (/^-?\d+([.,]\d+)?$/.test(trimmed)) {
        return { value: trimmed, placeholder: '' };
      }
      const wrapperMatch =
        /^(?:new\s+(?:java\.(?:lang|math)\.)?(?:Integer|Long|Short|Byte|BigDecimal|BigInteger|Double|Float)|(?:Integer|Long|BigDecimal|Double|Float)\.valueOf)\s*\(\s*"?(-?\d+(?:\.\d+)?)"?\s*[LDFldf]?\s*\)$/i.exec(
          trimmed
        );
      if (wrapperMatch) {
        return { value: wrapperMatch[1], placeholder: '' };
      }
      return { value: '', placeholder: 'Padrão: ' + trimmed };
    }

    if (category === 'date') {
      const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
      if (isoMatch) {
        return { value: isoMatch[1], placeholder: '' };
      }
      const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
      if (brMatch) {
        return {
          value: trimmed,
          placeholder: ''
        };
      }
      return { value: '', placeholder: 'Padrão: ' + trimmed };
    }

    if (
      trimmed.startsWith('new ') ||
      trimmed.includes('$P{') ||
      trimmed.includes('$F{') ||
      trimmed.includes('$V{')
    ) {
      return { value: '', placeholder: 'Padrão: ' + trimmed };
    }
    return { value: trimmed, placeholder: '' };
  }

  function collectRawParams() {
    const collected = {};
    if (!paramsForm) {
      return collected;
    }
    const inputs = paramsForm.querySelectorAll('[data-param-name]');
    for (let i = 0; i < inputs.length; i++) {
      const el = inputs[i];
      const name = el.dataset.paramName;
      const category = el.dataset.paramCategory;
      if (category === 'boolean') {
        collected[name] = Boolean(el.checked);
        paramValues[name] = Boolean(el.checked);
      } else {
        const rawValue = (el.value || '').trim();
        collected[name] = rawValue;
        paramValues[name] = rawValue;
      }
    }
    return collected;
  }

  function isValidCalendarDateClient(year, month, day) {
    if (year < 1000 || year > 9999 || month < 1 || month > 12) {
      return false;
    }
    let maxDay = 31;
    if (month === 2) {
      const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      maxDay = isLeap ? 29 : 28;
    } else if ([4, 6, 9, 11].includes(month)) {
      maxDay = 30;
    }
    return day >= 1 && day <= maxDay;
  }

  function isValidDateStringClient(str) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?$/.exec(str);
    if (iso) {
      return isValidCalendarDateClient(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    }
    const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/.exec(str);
    if (br) {
      return isValidCalendarDateClient(Number(br[3]), Number(br[2]), Number(br[1]));
    }
    return false;
  }

  function evaluateClientValidation(paramsMap) {
    const results = [];
    const promoteWarnings = Boolean(validationSettings.showWarningsAsErrors);

    currentParameters.forEach(function (param) {
      const category = getParamCategory(param.className);
      const rawVal = paramsMap[param.name];
      const isEmpty =
        rawVal === undefined ||
        rawVal === null ||
        (typeof rawVal === 'string' && rawVal.trim() === '');

      // 1. Condicional
      if (param.conditional || param.dependsOn) {
        const cond = param.conditional;
        if (cond && cond.parameter) {
          const depVal = paramsMap[cond.parameter];
          const depStr = depVal === undefined || depVal === null ? '' : String(depVal).trim();
          const triggered =
            cond.value !== undefined
              ? depStr === String(cond.value).trim()
              : depStr.length > 0;
          if (triggered && isEmpty) {
            results.push({
              parameterName: param.name,
              ruleType: 'conditional',
              passed: false,
              severity: 'error',
              message:
                cond.value !== undefined
                  ? 'Obrigatório quando "' + cond.parameter + '" é "' + cond.value + '"'
                  : 'Obrigatório quando "' + cond.parameter + '" está preenchido'
            });
          }
        }
      } else if (param.isForPrompting !== false && isEmpty) {
        // 2. Obrigatório
        results.push({
          parameterName: param.name,
          ruleType: 'required',
          passed: false,
          severity: 'error',
          message: 'Parâmetro obrigatório'
        });
      }

      if (isEmpty) {
        return;
      }

      const strVal = String(rawVal).trim();

      // 3. Tipo
      if (category === 'integer' && !/^-?\d+$/.test(strVal)) {
        results.push({
          parameterName: param.name,
          ruleType: 'type',
          passed: false,
          severity: 'error',
          message: 'Esperado número inteiro'
        });
        return;
      }

      if (category === 'decimal' && !/^-?\d+([.,]\d+)?$/.test(strVal)) {
        results.push({
          parameterName: param.name,
          ruleType: 'type',
          passed: false,
          severity: 'error',
          message: 'Esperado valor numérico'
        });
        return;
      }

      // 4. Formato Data
      if (category === 'date' && !isValidDateStringClient(strVal)) {
        results.push({
          parameterName: param.name,
          ruleType: 'format',
          passed: false,
          severity: 'error',
          message: 'Data inválida'
        });
      }

      // 5. Range numérico
      if (
        (category === 'integer' || category === 'decimal') &&
        (param.min !== undefined || param.max !== undefined)
      ) {
        const num = Number(strVal.replace(',', '.'));
        if (!Number.isNaN(num)) {
          const belowMin = param.min !== undefined && num < Number(param.min);
          const aboveMax = param.max !== undefined && num > Number(param.max);
          if (belowMin || aboveMax) {
            let msg = 'Valor fora do range permitido';
            if (param.min !== undefined && param.max !== undefined) {
              msg = 'Valor fora do range ' + param.min + '-' + param.max;
            } else if (param.min !== undefined) {
              msg = 'Valor fora do range (mínimo: ' + param.min + ')';
            } else if (param.max !== undefined) {
              msg = 'Valor fora do range (máximo: ' + param.max + ')';
            }
            results.push({
              parameterName: param.name,
              ruleType: 'range',
              passed: false,
              severity: promoteWarnings ? 'error' : 'warning',
              message: msg
            });
          }
        }
      }

      // 6. Pattern/Regex
      if (category === 'string' && param.pattern) {
        try {
          const re = new RegExp(param.pattern);
          if (!re.test(strVal)) {
            results.push({
              parameterName: param.name,
              ruleType: 'pattern',
              passed: false,
              severity: promoteWarnings ? 'error' : 'warning',
              message: 'Formato inválido'
            });
          }
        } catch {
          // Regex inválida no JRXML é ignorada
        }
      }

      // 7. Enum
      if (Array.isArray(param.validValues) && param.validValues.length > 0) {
        const allowed = param.validValues.some(function (v) {
          return String(v).trim() === strVal;
        });
        if (!allowed) {
          results.push({
            parameterName: param.name,
            ruleType: 'enum',
            passed: false,
            severity: 'error',
            message: 'Valor não permitido'
          });
        }
      }
    });

    return results;
  }

  function scheduleValidation(immediate) {
    if (validationDebounceTimer) {
      clearTimeout(validationDebounceTimer);
      validationDebounceTimer = null;
    }

    if (!validationSettings.enabled && !immediate) {
      return;
    }

    const delay = immediate ? 0 : Math.max(50, Number(validationSettings.debounceMs) || 300);
    validationDebounceTimer = setTimeout(function () {
      const currentMap = collectRawParams();
      const localResults = evaluateClientValidation(currentMap);
      applyValidationResults(localResults);
      vscode.postMessage({
        command: 'validateParameters',
        params: currentMap
      });
    }, delay);
  }

  function getRuleLabel(ruleType) {
    switch (ruleType) {
      case 'required':
        return 'Obrigatório';
      case 'type':
        return 'Tipo';
      case 'format':
        return 'Data';
      case 'range':
        return 'Range';
      case 'pattern':
        return 'Regex';
      case 'enum':
        return 'Enum';
      case 'conditional':
        return 'Condicional';
      default:
        return ruleType || 'Regra';
    }
  }

  function focusParameterInput(paramName) {
    if (!paramName) {
      return;
    }
    if (paramsCollapsed && paramsSection) {
      paramsCollapsed = false;
      paramsSection.classList.remove('hidden');
      if (toggleParamsBtn) {
        toggleParamsBtn.setAttribute('aria-expanded', 'true');
      }
    }
    const targetInput = document.getElementById('param_' + paramName);
    if (targetInput) {
      targetInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      targetInput.focus();
      if (typeof targetInput.select === 'function' && targetInput.type === 'text') {
        targetInput.select();
      }
    }
  }

  function applyValidationResults(results) {
    currentValidationResults = Array.isArray(results) ? results : [];

    // 1. Limpa estados inline anteriores
    if (paramsForm) {
      const inputs = paramsForm.querySelectorAll('[data-param-name]');
      for (let i = 0; i < inputs.length; i++) {
        const el = inputs[i];
        el.classList.remove('input-invalid', 'input-error', 'input-warning');
        el.removeAttribute('title');
      }
      const msgEls = paramsForm.querySelectorAll('.param-validation-msg');
      for (let i = 0; i < msgEls.length; i++) {
        msgEls[i].textContent = '';
        msgEls[i].className = 'param-validation-msg hidden';
      }
    }

    const byParam = Object.create(null);
    const errors = [];
    const warnings = [];

    currentValidationResults.forEach(function (res) {
      if (res.passed) {
        return;
      }
      if (!byParam[res.parameterName]) {
        byParam[res.parameterName] = [];
      }
      byParam[res.parameterName].push(res);
      if (res.severity === 'error') {
        errors.push(res);
      } else {
        warnings.push(res);
      }
    });

    hasBlockingErrors = errors.length > 0;

    // 2. Aplica estilos inline por campo (borda vermelha/amarela + tooltip)
    Object.keys(byParam).forEach(function (paramName) {
      const items = byParam[paramName];
      const hasError = items.some(function (it) {
        return it.severity === 'error';
      });
      const messages = items
        .map(function (it) {
          return it.message;
        })
        .join(' | ');

      const inputEl = document.getElementById('param_' + paramName);
      if (inputEl) {
        inputEl.classList.add(hasError ? 'input-error' : 'input-warning');
        if (hasError) {
          inputEl.classList.add('input-invalid');
        }
        inputEl.title = messages;
      }

      const msgEl = document.getElementById('val_msg_' + paramName);
      if (msgEl) {
        msgEl.textContent = messages;
        msgEl.title = messages;
        msgEl.className =
          'param-validation-msg ' + (hasError ? 'msg-error' : 'msg-warning');
      }
    });

    // 3. Atualiza Badge no Header
    if (validationBadge && validationBadgeText && validationBadgeIcon) {
      validationBadge.classList.remove('hidden', 'badge-error', 'badge-warning', 'badge-ok');

      if (!validationSettings.enabled || currentParameters.length === 0) {
        if (errors.length === 0 && warnings.length === 0) {
          validationBadge.classList.add('hidden');
        }
      }

      if (errors.length > 0 || warnings.length > 0) {
        const parts = [];
        if (errors.length > 0) {
          parts.push(errors.length + (errors.length === 1 ? ' erro' : ' erros'));
        }
        if (warnings.length > 0) {
          parts.push(warnings.length + (warnings.length === 1 ? ' aviso' : ' avisos'));
        }
        validationBadgeIcon.textContent = '\u26A0';
        validationBadgeText.textContent = parts.join(', ');
        validationBadge.classList.add(errors.length > 0 ? 'badge-error' : 'badge-warning');
        validationBadge.classList.remove('hidden');
      } else if (validationSettings.enabled && currentParameters.length > 0) {
        validationBadgeIcon.textContent = '\u2713';
        validationBadgeText.textContent = 'Parâmetros válidos';
        validationBadge.classList.add('badge-ok');
      } else {
        validationBadge.classList.add('hidden');
      }
    }

    // 4. Atualiza estado do botão "Atualizar"
    updateActionButtonsState(errors, warnings);

    // 5. Atualiza Painel Lateral de Validação
    renderValidationSidePanel(errors, warnings);
  }

  function updateActionButtonsState(errors, warnings) {
    if (!refreshBtn) {
      return;
    }
    if (validationSettings.enabled && errors.length > 0) {
      refreshBtn.disabled = true;
      const summary = errors
        .map(function (e) {
          return e.parameterName + ': ' + e.message;
        })
        .join('; ');
      refreshBtn.title =
        'Execução bloqueada (' +
        errors.length +
        (errors.length === 1 ? ' erro' : ' erros') +
        '): ' +
        summary;
    } else {
      refreshBtn.disabled = isProcessing;
      if (warnings && warnings.length > 0) {
        refreshBtn.title =
          'Compilar e preencher relatório (' +
          warnings.length +
          (warnings.length === 1 ? ' aviso' : ' avisos') +
          ' não bloqueante(s))';
      } else {
        refreshBtn.title = 'Compilar e preencher relatório com os parâmetros atuais';
      }
    }
  }

  function renderValidationSidePanel(errors, warnings) {
    if (!validationSidePanel) {
      return;
    }
    const hasAny = errors.length > 0 || warnings.length > 0;
    if (validationEmptyHint) {
      validationEmptyHint.classList.toggle('hidden', hasAny);
    }

    if (validationErrorsGroup && validationErrorsCount && validationErrorsList) {
      validationErrorsCount.textContent = String(errors.length);
      validationErrorsGroup.classList.toggle('hidden', errors.length === 0);
      validationErrorsList.innerHTML = errors
        .map(function (err) {
          return (
            '<li class="validation-item item-error" data-param-name="' +
            escapeHtml(err.parameterName) +
            '" title="Clique para focar no campo ' +
            escapeHtml(err.parameterName) +
            '">' +
            '<div class="validation-item-header">' +
            '<span class="validation-item-param">' +
            escapeHtml(err.parameterName) +
            '</span>' +
            '<span class="validation-item-rule">' +
            escapeHtml(getRuleLabel(err.ruleType || (err.rule && err.rule.type))) +
            '</span>' +
            '</div>' +
            '<span class="validation-item-msg">' +
            escapeHtml(err.message) +
            '</span>' +
            '</li>'
          );
        })
        .join('');
    }

    if (validationWarningsGroup && validationWarningsCount && validationWarningsList) {
      validationWarningsCount.textContent = String(warnings.length);
      validationWarningsGroup.classList.toggle('hidden', warnings.length === 0);
      validationWarningsList.innerHTML = warnings
        .map(function (warn) {
          return (
            '<li class="validation-item item-warning" data-param-name="' +
            escapeHtml(warn.parameterName) +
            '" title="Clique para focar no campo ' +
            escapeHtml(warn.parameterName) +
            '">' +
            '<div class="validation-item-header">' +
            '<span class="validation-item-param">' +
            escapeHtml(warn.parameterName) +
            '</span>' +
            '<span class="validation-item-rule">' +
            escapeHtml(getRuleLabel(warn.ruleType || (warn.rule && warn.rule.type))) +
            '</span>' +
            '</div>' +
            '<span class="validation-item-msg">' +
            escapeHtml(warn.message) +
            '</span>' +
            '</li>'
          );
        })
        .join('');
    }
  }

  function toggleSidePanel(forceState) {
    if (!validationSidePanel) {
      return;
    }
    sidePanelOpen = typeof forceState === 'boolean' ? forceState : !sidePanelOpen;
    validationSidePanel.classList.toggle('hidden', !sidePanelOpen);
    if (pdfDoc && fitWidthMode && currentPage >= 1) {
      renderPage(currentPage);
    }
  }

  function renderParametersForm(parameters) {
    currentParameters = Array.isArray(parameters) ? parameters : [];
    if (paramCountSpan) {
      paramCountSpan.textContent = String(currentParameters.length);
    }

    if (!paramsForm) {
      return;
    }
    paramsForm.innerHTML = '';

    if (currentParameters.length === 0) {
      paramsForm.classList.add('hidden');
      if (emptyParamsHint) {
        emptyParamsHint.classList.remove('hidden');
      }
      return;
    }

    paramsForm.classList.remove('hidden');
    if (emptyParamsHint) {
      emptyParamsHint.classList.add('hidden');
    }

    currentParameters.forEach(function (param) {
      const category = getParamCategory(param.className);
      const shortType = getShortClassName(param.className);
      const initial = extractInitialDefaultValue(param, category);

      if (!(param.name in paramValues)) {
        paramValues[param.name] = initial.value;
      }

      const fieldContainer = document.createElement('div');
      fieldContainer.className = 'param-field';

      const header = document.createElement('div');
      header.className = 'param-field-header';

      const label = document.createElement('label');
      label.className = 'param-label';
      label.setAttribute('for', 'param_' + param.name);
      label.textContent = param.name;
      if (param.isForPrompting !== false && !param.conditional && !param.dependsOn) {
        const reqMark = document.createElement('span');
        reqMark.className = 'param-required-mark';
        reqMark.textContent = '*';
        reqMark.title = 'Parâmetro obrigatório';
        label.appendChild(reqMark);
      }
      if (param.description) {
        label.title = param.description + ' (' + param.className + ')';
      } else {
        label.title = param.name + ' (' + param.className + ')';
      }

      const badge = document.createElement('span');
      badge.className = 'param-type-badge';
      badge.textContent = shortType;

      header.appendChild(label);
      header.appendChild(badge);
      fieldContainer.appendChild(header);

      if (category === 'boolean') {
        const wrapper = document.createElement('label');
        wrapper.className = 'param-checkbox-wrapper';
        wrapper.setAttribute('for', 'param_' + param.name);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'param_' + param.name;
        checkbox.name = param.name;
        checkbox.dataset.paramName = param.name;
        checkbox.dataset.paramCategory = category;
        checkbox.checked = Boolean(paramValues[param.name]);

        const statusText = document.createElement('span');
        statusText.textContent = checkbox.checked ? 'true (Sim)' : 'false (Não)';

        checkbox.addEventListener('change', function () {
          paramValues[param.name] = checkbox.checked;
          statusText.textContent = checkbox.checked ? 'true (Sim)' : 'false (Não)';
          scheduleValidation(false);
        });

        wrapper.appendChild(checkbox);
        wrapper.appendChild(statusText);
        fieldContainer.appendChild(wrapper);
      } else {
        const input = document.createElement('input');
        input.id = 'param_' + param.name;
        input.name = param.name;
        input.className = 'param-input';
        input.dataset.paramName = param.name;
        input.dataset.paramCategory = category;
        input.autocomplete = 'off';
        input.type = 'text';

        if (category === 'date') {
          input.placeholder = initial.placeholder || 'dd/MM/yyyy ou yyyy-MM-dd';
        } else if (category === 'integer') {
          input.inputMode = 'numeric';
          if (param.min !== undefined && param.max !== undefined) {
            input.placeholder = initial.placeholder || 'Range: ' + param.min + '-' + param.max;
          } else {
            input.placeholder = initial.placeholder || 'Ex: 12345';
          }
        } else if (category === 'decimal') {
          input.inputMode = 'decimal';
          if (param.min !== undefined && param.max !== undefined) {
            input.placeholder = initial.placeholder || 'Range: ' + param.min + '-' + param.max;
          } else {
            input.placeholder = initial.placeholder || 'Ex: 150,00';
          }
        } else {
          input.placeholder =
            initial.placeholder || param.description || 'Valor para ' + param.name;
        }

        if (Array.isArray(param.validValues) && param.validValues.length > 0) {
          const datalistId = 'datalist_param_' + param.name;
          input.setAttribute('list', datalistId);
          const datalist = document.createElement('datalist');
          datalist.id = datalistId;
          param.validValues.forEach(function (val) {
            const opt = document.createElement('option');
            opt.value = String(val);
            datalist.appendChild(opt);
          });
          fieldContainer.appendChild(datalist);
        }

        input.value =
          paramValues[param.name] !== undefined && paramValues[param.name] !== null
            ? String(paramValues[param.name])
            : '';

        input.addEventListener('input', function () {
          paramValues[param.name] = input.value;
          scheduleValidation(false);
        });

        fieldContainer.appendChild(input);
      }

      const valMsg = document.createElement('div');
      valMsg.id = 'val_msg_' + param.name;
      valMsg.className = 'param-validation-msg hidden';
      fieldContainer.appendChild(valMsg);

      paramsForm.appendChild(fieldContainer);
    });
  }

  function validateAndCollectParams() {
    const collected = collectRawParams();
    if (validationSettings.enabled) {
      const results = evaluateClientValidation(collected);
      applyValidationResults(results);
      vscode.postMessage({
        command: 'validateParameters',
        params: collected
      });
      const errors = results.filter(function (r) {
        return !r.passed && r.severity === 'error';
      });
      if (errors.length > 0) {
        focusParameterInput(errors[0].parameterName);
        showBanner(
          'Erro de Validação',
          errors[0].parameterName + ': ' + errors[0].message,
          'error',
          false
        );
        return { valid: false, params: collected };
      }
    }
    return { valid: true, params: collected };
  }

  function triggerRunReport(isAutoReload) {
    const result = validateAndCollectParams();
    if (!result.valid) {
      return;
    }
    hideBanner();
    setLoading(true, 'Compilando e gerando visualização PDF...');
    vscode.postMessage({
      command: 'runReport',
      params: result.params,
      isAutoReload: Boolean(isAutoReload)
    });
  }

  // Funções de renderização PDF.js
  function base64ToUint8Array(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  function updateViewerControls() {
    const hasDoc = Boolean(pdfDoc && totalPages > 0);
    if (prevPageBtn) {
      prevPageBtn.disabled = !hasDoc || currentPage <= 1;
    }
    if (nextPageBtn) {
      nextPageBtn.disabled = !hasDoc || currentPage >= totalPages;
    }
    if (pageIndicator) {
      pageIndicator.textContent = hasDoc
        ? 'Página ' + currentPage + ' de ' + totalPages
        : 'Página 0 de 0';
    }
    if (zoomOutBtn) {
      zoomOutBtn.disabled = !hasDoc || (!fitWidthMode && zoomScale <= 0.5);
    }
    if (zoomInBtn) {
      zoomInBtn.disabled = !hasDoc || (!fitWidthMode && zoomScale >= 3.0);
    }
    if (fitWidthBtn) {
      fitWidthBtn.disabled = !hasDoc;
    }
    if (resetZoomBtn) {
      resetZoomBtn.disabled = !hasDoc;
    }
    if (zoomIndicator) {
      zoomIndicator.textContent = Math.round(zoomScale * 100) + '%';
    }
  }

  function renderPage(pageNum) {
    if (!pdfDoc) {
      return;
    }

    if (activeRenderTask) {
      pendingRenderPage = pageNum;
      return;
    }

    pdfDoc.getPage(pageNum).then(function (page) {
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      if (fitWidthMode && viewerViewport) {
        const availableWidth = Math.max(240, viewerViewport.clientWidth - 48);
        zoomScale = Math.max(0.3, Math.min(3.0, availableWidth / unscaledViewport.width));
      }

      const viewport = page.getViewport({ scale: zoomScale });
      const outputScale = window.devicePixelRatio || 1;
      const context = pdfCanvas.getContext('2d');

      pdfCanvas.width = Math.floor(viewport.width * outputScale);
      pdfCanvas.height = Math.floor(viewport.height * outputScale);
      pdfCanvas.style.width = Math.floor(viewport.width) + 'px';
      pdfCanvas.style.height = Math.floor(viewport.height) + 'px';

      const transform =
        outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

      const renderContext = {
        canvasContext: context,
        transform: transform,
        viewport: viewport
      };

      activeRenderTask = page.render(renderContext);
      activeRenderTask.promise
        .then(function () {
          activeRenderTask = null;
          updateViewerControls();
          if (pendingRenderPage !== null) {
            const next = pendingRenderPage;
            pendingRenderPage = null;
            renderPage(next);
          }
        })
        .catch(function (err) {
          activeRenderTask = null;
          if (err && err.name === 'RenderingCancelledException') {
            return;
          }
          showBanner(
            'Erro ao renderizar página',
            err && err.message ? err.message : String(err),
            'error',
            false
          );
        });
    });
  }

  function loadPdfDocument(message) {
    if (typeof pdfjsLib === 'undefined') {
      setLoading(false);
      showBanner(
        'PDF.js indisponível',
        'A biblioteca PDF.js não pôde ser carregada na Webview.',
        'error',
        false
      );
      return;
    }

    let docSource = null;
    if (message.base64Data) {
      docSource = { data: base64ToUint8Array(message.base64Data) };
    } else if (message.pdfUri) {
      docSource = { url: message.pdfUri };
    } else {
      setLoading(false);
      showBanner('Erro', 'Nenhum dado de PDF recebido para exibição.', 'error', false);
      return;
    }

    const loadingTask = pdfjsLib.getDocument(docSource);
    loadingTask.promise
      .then(function (loadedPdf) {
        pdfDoc = loadedPdf;
        totalPages = loadedPdf.numPages || 0;

        if (totalPages === 0) {
          currentPage = 0;
          if (canvasWrapper) {
            canvasWrapper.classList.add('hidden');
          }
          if (emptyState && emptyStateText) {
            emptyStateText.textContent =
              'O relatório foi processado, mas não gerou páginas (0 páginas). Verifique os parâmetros ou a consulta SQL.';
            emptyState.classList.remove('hidden');
          }
          setLoading(false);
          updateViewerControls();
          return;
        }

        if (currentPage < 1 || currentPage > totalPages) {
          currentPage = 1;
        }

        if (emptyState) {
          emptyState.classList.add('hidden');
        }
        if (canvasWrapper) {
          canvasWrapper.classList.remove('hidden');
        }

        setLoading(false);
        updateViewerControls();
        renderPage(currentPage);
      })
      .catch(function (err) {
        setLoading(false);
        showBanner(
          'Falha ao carregar PDF',
          err && err.message ? err.message : String(err),
          'error',
          true
        );
      });
  }

  // Listeners de eventos da barra de ações
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function () {
      triggerRunReport(false);
    });
  }

  if (validateNowBtn) {
    validateNowBtn.addEventListener('click', function () {
      const currentMap = collectRawParams();
      const results = evaluateClientValidation(currentMap);
      applyValidationResults(results);
      vscode.postMessage({
        command: 'validateParameters',
        params: currentMap
      });
      if (results.length > 0 && !sidePanelOpen) {
        toggleSidePanel(true);
      }
    });
  }

  if (validationBadge) {
    validationBadge.addEventListener('click', function () {
      toggleSidePanel();
    });
  }

  if (closeValidationPanelBtn) {
    closeValidationPanelBtn.addEventListener('click', function () {
      toggleSidePanel(false);
    });
  }

  if (validationSidePanel) {
    validationSidePanel.addEventListener('click', function (event) {
      const target = event.target;
      const item =
        target && target.closest ? target.closest('.validation-item') : null;
      if (item) {
        const paramName = item.getAttribute('data-param-name');
        focusParameterInput(paramName);
      }
    });
  }

  if (paramsForm) {
    paramsForm.addEventListener('submit', function (event) {
      event.preventDefault();
      triggerRunReport(false);
    });
  }

  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', function () {
      const result = validateAndCollectParams();
      if (!result.valid) {
        return;
      }
      vscode.postMessage({
        command: 'exportPdf',
        params: result.params
      });
    });
  }

  if (exportJasperBtn) {
    exportJasperBtn.addEventListener('click', function () {
      vscode.postMessage({
        command: 'exportJasper'
      });
    });
  }

  if (toggleParamsBtn && paramsSection) {
    toggleParamsBtn.addEventListener('click', function () {
      paramsCollapsed = !paramsCollapsed;
      paramsSection.classList.toggle('hidden', paramsCollapsed);
      toggleParamsBtn.setAttribute('aria-expanded', String(!paramsCollapsed));
    });
  }

  if (autoReloadToggle) {
    autoReloadToggle.addEventListener('change', function () {
      vscode.postMessage({
        command: 'toggleAutoReload',
        enabled: autoReloadToggle.checked
      });
    });
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', function () {
      if (!pdfDoc || currentPage <= 1) {
        return;
      }
      currentPage -= 1;
      updateViewerControls();
      renderPage(currentPage);
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', function () {
      if (!pdfDoc || currentPage >= totalPages) {
        return;
      }
      currentPage += 1;
      updateViewerControls();
      renderPage(currentPage);
    });
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', function () {
      if (!pdfDoc) {
        return;
      }
      fitWidthMode = false;
      zoomScale = Math.min(3.0, Math.round((zoomScale + 0.25) * 100) / 100);
      updateViewerControls();
      renderPage(currentPage);
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', function () {
      if (!pdfDoc) {
        return;
      }
      fitWidthMode = false;
      zoomScale = Math.max(0.5, Math.round((zoomScale - 0.25) * 100) / 100);
      updateViewerControls();
      renderPage(currentPage);
    });
  }

  if (fitWidthBtn) {
    fitWidthBtn.addEventListener('click', function () {
      if (!pdfDoc) {
        return;
      }
      fitWidthMode = true;
      renderPage(currentPage);
    });
  }

  if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', function () {
      if (!pdfDoc) {
        return;
      }
      fitWidthMode = false;
      zoomScale = 1.0;
      updateViewerControls();
      renderPage(currentPage);
    });
  }

  if (openLogBtn) {
    openLogBtn.addEventListener('click', function () {
      vscode.postMessage({ command: 'openLog' });
    });
  }

  if (dismissBannerBtn) {
    dismissBannerBtn.addEventListener('click', function () {
      hideBanner();
    });
  }

  window.addEventListener('resize', function () {
    if (pdfDoc && fitWidthMode && currentPage >= 1) {
      renderPage(currentPage);
    }
  });

  // Comunicação com PreviewPanel.ts
  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || typeof message.command !== 'string') {
      return;
    }

    switch (message.command) {
      case 'initMetadata': {
        if (reportTitleLabel && message.reportName) {
          reportTitleLabel.textContent = 'Relatório: ' + message.reportName;
        }
        if (connectionStatusLabel) {
          connectionStatusLabel.textContent = message.connectionName
            ? 'Conexão: ' + message.connectionName
            : 'Conexão: Modo Mock (JREmptyDataSource)';
        }
        if (autoReloadToggle && typeof message.autoReload === 'boolean') {
          autoReloadToggle.checked = message.autoReload;
        }
        if (message.validationSettings) {
          validationSettings = Object.assign(
            {},
            validationSettings,
            message.validationSettings
          );
        }

        renderParametersForm(message.parameters || []);

        if (
          validationSettings.enabled &&
          validationSettings.autoValidateOnPreviewOpen
        ) {
          if (Array.isArray(message.initialValidationResults)) {
            applyValidationResults(message.initialValidationResults);
          } else {
            const currentMap = collectRawParams();
            applyValidationResults(evaluateClientValidation(currentMap));
          }
          if (hasBlockingErrors && emptyStateText && !pdfDoc) {
            emptyStateText.textContent =
              'Preencha os parâmetros obrigatórios ou corrija os erros de validação para gerar o preview.';
          }
        } else {
          applyValidationResults([]);
        }

        if (message.autoRun && !hasBlockingErrors) {
          triggerRunReport(false);
        }
        break;
      }

      case 'updateValidationSettings': {
        if (message.validationSettings) {
          validationSettings = Object.assign(
            {},
            validationSettings,
            message.validationSettings
          );
          if (!validationSettings.enabled) {
            applyValidationResults([]);
          } else {
            scheduleValidation(true);
          }
        }
        break;
      }

      case 'validationResults': {
        if (Array.isArray(message.results)) {
          applyValidationResults(message.results);
        }
        break;
      }

      case 'updateActionButtons': {
        hasBlockingErrors = Boolean(message.hasErrors);
        if (refreshBtn && validationSettings.enabled && hasBlockingErrors) {
          refreshBtn.disabled = true;
        } else if (refreshBtn && !isProcessing) {
          refreshBtn.disabled = false;
        }
        break;
      }

      case 'updateConnectionStatus': {
        if (connectionStatusLabel) {
          connectionStatusLabel.textContent = message.connectionName
            ? 'Conexão: ' + message.connectionName
            : 'Conexão: Modo Mock (JREmptyDataSource)';
        }
        break;
      }

      case 'triggerAutoReload': {
        if (Array.isArray(message.parameters)) {
          renderParametersForm(message.parameters);
        }
        triggerRunReport(true);
        break;
      }

      case 'setLoading': {
        setLoading(Boolean(message.loading), message.message);
        break;
      }

      case 'loadPdf': {
        hideBanner();
        if (connectionStatusLabel && message.connectionName !== undefined) {
          connectionStatusLabel.textContent = message.connectionName
            ? 'Conexão: ' + message.connectionName
            : 'Conexão: Modo Mock (JREmptyDataSource)';
        }
        if (executionStatsLabel) {
          const statsParts = [];
          if (typeof message.executionTimeMs === 'number') {
            statsParts.push('Gerado em ' + message.executionTimeMs + 'ms');
          }
          if (typeof message.pages === 'number') {
            statsParts.push(message.pages + ' pág.');
          }
          executionStatsLabel.textContent = statsParts.join(' • ');
          executionStatsLabel.classList.toggle('hidden', statsParts.length === 0);
        }
        loadPdfDocument(message);
        break;
      }

      case 'reportError': {
        setLoading(false);
        if (!pdfDoc && emptyState && emptyStateText) {
          emptyStateText.textContent =
            'Não foi possível gerar a visualização do relatório.';
          emptyState.classList.remove('hidden');
        }
        showBanner(
          message.errorType || 'Erro ao gerar relatório',
          message.message || 'Falha durante o processamento do relatório.',
          'error',
          true
        );
        break;
      }
    }
  });

  vscode.postMessage({ command: 'ready' });
})();
