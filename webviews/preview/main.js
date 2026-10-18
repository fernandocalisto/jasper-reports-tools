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

  // Estado interno
  let currentParameters = [];
  const paramValues = Object.create(null);
  let paramsCollapsed = false;
  let isProcessing = false;

  // Estado do PDF.js
  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 0;
  let zoomScale = 1.0;
  let fitWidthMode = false;
  let activeRenderTask = null;
  let pendingRenderPage = null;

  function setLoading(loading, message) {
    isProcessing = Boolean(loading);
    if (loadingBar) {
      loadingBar.classList.toggle('hidden', !isProcessing);
    }
    if (refreshBtn) {
      refreshBtn.disabled = isProcessing;
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
      normalized === 'java.sql.Date' ||
      normalized === 'java.sql.Timestamp' ||
      normalized === 'java.time.LocalDate' ||
      normalized === 'java.time.LocalDateTime'
    ) {
      return 'date';
    }
    if (
      normalized === 'java.lang.Integer' ||
      normalized === 'java.lang.Long' ||
      normalized === 'java.lang.Short' ||
      normalized === 'java.lang.Byte' ||
      normalized === 'java.math.BigInteger' ||
      normalized === 'int' ||
      normalized === 'long'
    ) {
      return 'integer';
    }
    if (
      normalized === 'java.math.BigDecimal' ||
      normalized === 'java.lang.Double' ||
      normalized === 'java.lang.Float' ||
      normalized === 'java.lang.Number' ||
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
          value: brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1],
          placeholder: ''
        };
      }
      return { value: '', placeholder: 'Padrão: ' + trimmed };
    }

    // String e demais tipos
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

        if (category === 'date') {
          input.type = 'date';
        } else {
          input.type = 'text';
          if (category === 'integer') {
            input.inputMode = 'numeric';
            input.placeholder = initial.placeholder || 'Ex: 12345';
          } else if (category === 'decimal') {
            input.inputMode = 'decimal';
            input.placeholder = initial.placeholder || 'Ex: 150,00';
          } else {
            input.placeholder =
              initial.placeholder || param.description || 'Valor para ' + param.name;
          }
        }

        input.value =
          paramValues[param.name] !== undefined && paramValues[param.name] !== null
            ? String(paramValues[param.name])
            : '';

        input.addEventListener('input', function () {
          if (category === 'integer') {
            const sanitized = input.value.replace(/[^0-9-]/g, '').replace(/(?!^)-/g, '');
            if (sanitized !== input.value) {
              input.value = sanitized;
            }
            const valid = sanitized === '' || /^-?\d+$/.test(sanitized);
            input.classList.toggle('input-invalid', !valid);
          } else if (category === 'decimal') {
            const sanitized = input.value
              .replace(/[^0-9.,-]/g, '')
              .replace(/(?!^)-/g, '');
            if (sanitized !== input.value) {
              input.value = sanitized;
            }
            const valid = sanitized === '' || /^-?\d+([.,]\d+)?$/.test(sanitized);
            input.classList.toggle('input-invalid', !valid);
          }
          paramValues[param.name] = input.value;
        });

        fieldContainer.appendChild(input);
      }

      paramsForm.appendChild(fieldContainer);
    });
  }

  function validateAndCollectParams() {
    const collected = {};
    if (!paramsForm) {
      return { valid: true, params: collected };
    }

    const inputs = paramsForm.querySelectorAll('[data-param-name]');
    for (let i = 0; i < inputs.length; i++) {
      const el = inputs[i];
      const name = el.dataset.paramName;
      const category = el.dataset.paramCategory;

      if (category === 'boolean') {
        collected[name] = Boolean(el.checked);
        paramValues[name] = Boolean(el.checked);
        continue;
      }

      const rawValue = (el.value || '').trim();
      paramValues[name] = rawValue;

      if (!rawValue) {
        continue;
      }

      if (category === 'integer' && !/^-?\d+$/.test(rawValue)) {
        el.classList.add('input-invalid');
        el.focus();
        showBanner(
          'Parâmetro inválido',
          'O parâmetro "' + name + '" requer um número inteiro válido.',
          'error',
          false
        );
        return { valid: false, params: collected };
      }

      if (category === 'decimal' && !/^-?\d+([.,]\d+)?$/.test(rawValue)) {
        el.classList.add('input-invalid');
        el.focus();
        showBanner(
          'Parâmetro inválido',
          'O parâmetro "' + name + '" requer um valor numérico válido.',
          'error',
          false
        );
        return { valid: false, params: collected };
      }

      el.classList.remove('input-invalid');
      collected[name] = rawValue;
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
        renderParametersForm(message.parameters || []);

        if (message.autoRun) {
          triggerRunReport(false);
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
          emptyStateText.textContent = 'Não foi possível gerar a visualização do relatório.';
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
