(function () {
  const vscode = acquireVsCodeApi();

  // Snippets padrão caso ainda não tenham chegado do host
  const DEFAULT_SNIPPETS = {
    if: '$F{CAMPO} != null ? $F{CAMPO} : ""',
    fmt: 'new java.text.SimpleDateFormat("dd/MM/yyyy").format($F{DATA})',
    money: 'new java.text.DecimalFormat("#,##0.00").format($F{VALOR})',
    nullsafe: '$F{CAMPO}?.toString() ?: ""',
    cond: '$F{COND} ? "SIM" : "NÃO"'
  };

  // DOM References
  const activeTagBadge = document.getElementById('activeTagBadge');
  const activeLineBadge = document.getElementById('activeLineBadge');
  const activeFileName = document.getElementById('activeFileName');
  const selExpressionSwitch = document.getElementById('selExpressionSwitch');
  const selLanguage = document.getElementById('selLanguage');

  const btnRevealXml = document.getElementById('btnRevealXml');
  const btnSaveExpression = document.getElementById('btnSaveExpression');
  const btnSaveAndClose = document.getElementById('btnSaveAndClose');

  const selCommonFunctions = document.getElementById('selCommonFunctions');
  const btnTriggerSuggest = document.getElementById('btnTriggerSuggest');

  const feedbackBanner = document.getElementById('feedbackBanner');
  const feedbackBannerText = document.getElementById('feedbackBannerText');

  const monacoContainer = document.getElementById('monacoContainer');
  const cursorStatus = document.getElementById('cursorStatus');
  const validationSummaryBadge = document.getElementById('validationSummaryBadge');
  const inferredTypeBadge = document.getElementById('inferredTypeBadge');
  const expectedTypeBadge = document.getElementById('expectedTypeBadge');

  const diagCountPill = document.getElementById('diagCountPill');
  const diagnosticsList = document.getElementById('diagnosticsList');

  const previewTimeBadge = document.getElementById('previewTimeBadge');
  const btnRegenerateMock = document.getElementById('btnRegenerateMock');
  const previewResultCard = document.getElementById('previewResultCard');
  const previewFormattedValue = document.getElementById('previewFormattedValue');
  const previewResultTypeBadge = document.getElementById('previewResultTypeBadge');
  const previewErrorBox = document.getElementById('previewErrorBox');
  const previewErrorType = document.getElementById('previewErrorType');
  const previewErrorMessage = document.getElementById('previewErrorMessage');
  const previewErrorDetail = document.getElementById('previewErrorDetail');
  const mockInputsContainer = document.getElementById('mockInputsContainer');

  const sidebarSearchInput = document.getElementById('sidebarSearchInput');
  const metadataItemsList = document.getElementById('metadataItemsList');

  // State
  let editor = null;
  let worker = null;
  let currentLanguage = 'groovy';
  let currentMetadata = { fields: [], parameters: [], variables: [] };
  let snippetsMap = Object.assign({}, DEFAULT_SNIPPETS);
  let customMockValues = {};
  let activeSidebarTab = 'all';
  let debounceTimer = null;
  let completionRequestCounter = 0;
  const pendingCompletionResolvers = new Map();

  function escapeHtml(str) {
    if (str === null || str === undefined) {
      return '';
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function shortenType(fullType) {
    if (!fullType) {
      return 'Object';
    }
    const idx = String(fullType).lastIndexOf('.');
    return idx >= 0 ? String(fullType).slice(idx + 1) : String(fullType);
  }

  function showBanner(text, isError = false) {
    if (!text) {
      feedbackBanner.classList.add('hidden');
      return;
    }
    feedbackBanner.classList.remove('hidden', 'banner-error', 'banner-ok');
    feedbackBanner.classList.add(isError ? 'banner-error' : 'banner-ok');
    feedbackBannerText.textContent = text;
    setTimeout(() => {
      feedbackBanner.classList.add('hidden');
    }, 3500);
  }

  // Inicializa Web Worker opcional para linting assíncrono
  function initWorker() {
    const workerUri = document.body.getAttribute('data-worker-uri');
    if (!workerUri || typeof Worker === 'undefined') {
      return;
    }
    try {
      worker = new Worker(workerUri);
    } catch {
      worker = null;
    }
  }

  // Inicializa Monaco Editor e registra provedor de Autocomplete
  function initMonaco() {
    if (!window.monaco) {
      return;
    }

    window.monaco.languages.registerCompletionItemProvider('*', {
      provideCompletionItems: (_model, _position, offset, language) => {
        return new Promise((resolve) => {
          const reqId = ++completionRequestCounter;
          pendingCompletionResolvers.set(reqId, resolve);
          vscode.postMessage({
            command: 'requestCompletions',
            requestId: reqId,
            expression: editor ? editor.getValue() : '',
            cursorOffset: offset,
            language: language || currentLanguage
          });
          setTimeout(() => {
            if (pendingCompletionResolvers.has(reqId)) {
              pendingCompletionResolvers.delete(reqId);
              resolve({ suggestions: [] });
            }
          }, 1200);
        });
      }
    });

    editor = window.monaco.editor.create(monacoContainer, {
      value: '',
      language: 'groovy',
      theme: 'vs-dark',
      automaticLayout: true
    });

    editor.onDidChangeModelContent(() => {
      scheduleValidationAndPreview();
      if (worker) {
        worker.postMessage({
          type: 'tokenizeAndCheck',
          requestId: Date.now(),
          expression: editor.getValue()
        });
      }
    });

    editor.onDidChangeCursorPosition((ev) => {
      if (ev && ev.position) {
        cursorStatus.textContent = `Ln ${ev.position.lineNumber}, Col ${ev.position.column}`;
      }
    });

    // Atalho Ctrl+S (Salvar)
    editor.addCommand(
      (ev) => (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 's',
      () => saveExpression(false)
    );

    // Atalho Ctrl+Enter (Salvar e Fechar)
    editor.addCommand(
      (ev) => (ev.ctrlKey || ev.metaKey) && ev.key === 'Enter',
      () => saveExpression(true)
    );
  }

  function scheduleValidationAndPreview() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      requestValidationAndPreview();
    }, 140);
  }

  function requestValidationAndPreview() {
    if (!editor) {
      return;
    }
    vscode.postMessage({
      command: 'validateAndPreview',
      expression: editor.getValue(),
      language: currentLanguage,
      customMockValues
    });
  }

  function saveExpression(closeAfterSave) {
    if (!editor) {
      return;
    }
    vscode.postMessage({
      command: 'saveExpression',
      expression: editor.getValue(),
      closeAfterSave: Boolean(closeAfterSave)
    });
  }

  function populateOccurrencesDropdown(allOccurrences, activeId) {
    if (!Array.isArray(allOccurrences) || allOccurrences.length === 0) {
      selExpressionSwitch.innerHTML = '<option value="">Expressão Atual</option>';
      return;
    }
    selExpressionSwitch.innerHTML = allOccurrences
      .map((occ) => {
        const selected = occ.id === activeId ? ' selected' : '';
        const previewText = (occ.expression || '').replace(/\s+/g, ' ').slice(0, 42);
        return `<option value="${escapeHtml(occ.id)}"${selected}>L${occ.startLine} • ${escapeHtml(
          occ.contextLabel
        )} — ${escapeHtml(previewText)}</option>`;
      })
      .join('');
  }

  function populateCommonFunctionsDropdown(builtinFunctions) {
    const commonItems = [
      {
        label: 'SimpleDateFormat("dd/MM/yyyy").format(...)',
        insert: 'new java.text.SimpleDateFormat("dd/MM/yyyy").format($F{DATA})'
      },
      {
        label: 'DecimalFormat("#,##0.00").format(...)',
        insert: 'new java.text.DecimalFormat("#,##0.00").format($F{VALOR})'
      },
      {
        label: 'BigDecimal.valueOf(...)',
        insert: 'BigDecimal.valueOf($F{VALOR})'
      },
      {
        label: 'DateUtils.addDays(data, dias)',
        insert: 'DateUtils.addDays($F{DATA}, 7)'
      },
      {
        label: 'JRExtendedUtils.formatCurrency(valor)',
        insert: 'JRExtendedUtils.formatCurrency($F{VALOR})'
      },
      {
        label: 'String.format("%.2f", valor)',
        insert: 'String.format("%.2f", $F{VALOR})'
      },
      {
        label: 'Boolean.valueOf(...)',
        insert: 'Boolean.valueOf($F{COND})'
      }
    ];

    if (Array.isArray(builtinFunctions)) {
      for (const fn of builtinFunctions) {
        commonItems.push({
          label: `${fn.name} — ${fn.description}`,
          insert: fn.insertText || `${fn.name}()`
        });
      }
    }

    selCommonFunctions.innerHTML =
      '<option value="">+ Inserir função / utilitário...</option>' +
      commonItems
        .map(
          (item) =>
            `<option value="${escapeHtml(item.insert)}">${escapeHtml(item.label)}</option>`
        )
        .join('');
  }

  function renderValidationResult(validation) {
    if (!validation) {
      return;
    }

    const diags = validation.diagnostics || [];
    const errorCount = diags.filter((d) => d.severity === 'error').length;
    const warnCount = diags.filter((d) => d.severity === 'warning').length;

    inferredTypeBadge.textContent = validation.inferredType || 'java.lang.Object';
    if (validation.expectedType) {
      expectedTypeBadge.textContent = validation.expectedType;
    }

    // Atualiza marcadores squiggly no Monaco Editor
    if (editor && window.monaco) {
      window.monaco.editor.setModelMarkers(editor.getModel(), 'jasper-expr', diags);
    }

    if (errorCount > 0) {
      validationSummaryBadge.className = 'status-error';
      validationSummaryBadge.textContent = `\u2716 ${errorCount} erro(s)${
        warnCount > 0 ? `, ${warnCount} aviso(s)` : ''
      }`;
      diagCountPill.textContent = `${diags.length} problema(s)`;
      diagCountPill.className = 'count-pill pill-error';
    } else if (warnCount > 0) {
      validationSummaryBadge.className = 'status-warn';
      validationSummaryBadge.textContent = `\u26A0 ${warnCount} aviso(s)`;
      diagCountPill.textContent = `${warnCount} aviso(s)`;
      diagCountPill.className = 'count-pill pill-warn';
    } else {
      validationSummaryBadge.className = 'status-valid';
      validationSummaryBadge.textContent = '\u2713 Expressão válida';
      diagCountPill.textContent = '0 problemas';
      diagCountPill.className = 'count-pill pill-ok';
    }

    if (diags.length === 0) {
      diagnosticsList.innerHTML =
        '<div class="empty-ok">&#10003; Nenhum erro de sintaxe, referência quebrada ou incompatibilidade de tipo.</div>';
      return;
    }

    diagnosticsList.innerHTML = diags
      .map((d, idx) => {
        const sevCls = d.severity === 'error' ? 'diag-error' : 'diag-warn';
        const sevLabel = d.severity === 'error' ? 'ERRO' : 'AVISO';
        const fixBtn =
          d.replacement && d.replacement.target && d.replacement.value
            ? `<button type="button" class="btn-quickfix" data-target="${escapeHtml(
                d.replacement.target
              )}" data-value="${escapeHtml(d.replacement.value)}">Substituir por ${escapeHtml(
                d.replacement.value
              )}</button>`
            : '';

        return `<div class="diag-item ${sevCls}" data-line="${d.startLine || 1}" data-col="${
          d.startColumn || 1
        }" data-idx="${idx}">
          <div class="diag-top">
            <span class="diag-badge">${sevLabel}</span>
            <span class="diag-loc">Ln ${d.startLine || 1}, Col ${d.startColumn || 1}</span>
            ${fixBtn}
          </div>
          <div class="diag-msg">${escapeHtml(d.message)}</div>
        </div>`;
      })
      .join('');

    diagnosticsList.querySelectorAll('.diag-item').forEach((el) => {
      el.addEventListener('click', (ev) => {
        if (ev.target && ev.target.classList.contains('btn-quickfix')) {
          return;
        }
        const ln = Number(el.getAttribute('data-line')) || 1;
        const col = Number(el.getAttribute('data-col')) || 1;
        if (editor) {
          editor.setPosition({ lineNumber: ln, column: col });
        }
      });
    });

    diagnosticsList.querySelectorAll('.btn-quickfix').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const target = btn.getAttribute('data-target');
        const value = btn.getAttribute('data-value');
        if (editor && target && value) {
          const updated = editor.getValue().replace(target, value);
          editor.setValue(updated);
        }
      });
    });
  }

  function renderPreviewResult(preview) {
    if (!preview) {
      return;
    }

    previewTimeBadge.textContent = `${preview.executionTimeMs || 0}ms`;
    previewResultTypeBadge.textContent = shortenType(preview.resultType || 'Object');

    if (preview.success) {
      previewResultCard.classList.remove('card-error');
      previewFormattedValue.textContent = preview.formattedValue;
      previewErrorBox.classList.add('hidden');
    } else {
      previewResultCard.classList.add('card-error');
      previewFormattedValue.textContent = 'Falha na Avaliação';
      previewErrorBox.classList.remove('hidden');
      previewErrorType.textContent = (preview.error && preview.error.type) || 'RuntimeException';
      previewErrorMessage.textContent =
        (preview.error && preview.error.message) || 'Erro ao avaliar expressão';
      previewErrorDetail.textContent = (preview.error && preview.error.detail) || '';
    }
  }

  function renderMockDataInputs(mockEntries) {
    if (!Array.isArray(mockEntries) || mockEntries.length === 0) {
      mockInputsContainer.innerHTML =
        '<div class="empty-mock">Nenhuma referência $F{}, $P{} ou $V{} detectada.</div>';
      return;
    }

    // Mostra prioritariamente as referências usadas na expressão + até 12 variáveis do relatório
    const visibleEntries = mockEntries.slice(0, 16);

    mockInputsContainer.innerHTML = visibleEntries
      .map((entry) => {
        const isNull = Boolean(entry.isNull || customMockValues[entry.refKey] === null);
        const rawVal =
          customMockValues[entry.refKey] !== undefined && customMockValues[entry.refKey] !== null
            ? customMockValues[entry.refKey]
            : entry.value;
        const activeRefCls = entry.isReferenced ? ' mock-row-referenced' : '';

        return `<div class="mock-row${activeRefCls}" data-ref-key="${escapeHtml(entry.refKey)}">
          <div class="mock-ref-info">
            <code class="mock-ref-key">${escapeHtml(entry.refKey)}</code>
            <span class="mock-ref-type">${escapeHtml(shortenType(entry.className))}</span>
          </div>
          <div class="mock-ref-controls">
            <input
              type="text"
              class="mock-val-input"
              data-ref="${escapeHtml(entry.refKey)}"
              value="${escapeHtml(rawVal ?? '')}"
              ${isNull ? 'disabled' : ''}
            >
            <label class="mock-null-toggle" title="Simular valor null para testar NullPointerException / null-safety">
              <input
                type="checkbox"
                class="mock-null-chk"
                data-ref="${escapeHtml(entry.refKey)}"
                ${isNull ? 'checked' : ''}
              >
              <span>null</span>
            </label>
          </div>
        </div>`;
      })
      .join('');

    mockInputsContainer.querySelectorAll('.mock-val-input').forEach((inputEl) => {
      inputEl.addEventListener('input', () => {
        const refKey = inputEl.getAttribute('data-ref');
        if (refKey) {
          customMockValues[refKey] = inputEl.value;
          scheduleValidationAndPreview();
        }
      });
    });

    mockInputsContainer.querySelectorAll('.mock-null-chk').forEach((chkEl) => {
      chkEl.addEventListener('change', () => {
        const refKey = chkEl.getAttribute('data-ref');
        if (!refKey) {
          return;
        }
        const row = chkEl.closest('.mock-row');
        const valInput = row ? row.querySelector('.mock-val-input') : null;
        if (chkEl.checked) {
          customMockValues[refKey] = null;
          if (valInput) {
            valInput.disabled = true;
          }
        } else {
          customMockValues[refKey] = valInput ? valInput.value : '';
          if (valInput) {
            valInput.disabled = false;
          }
        }
        scheduleValidationAndPreview();
      });
    });
  }

  function renderSidebarMetadata() {
    const query = (sidebarSearchInput.value || '').trim().toLowerCase();
    const allItems = [];

    if (activeSidebarTab === 'all' || activeSidebarTab === 'F') {
      for (const f of currentMetadata.fields || []) {
        allItems.push({
          kind: 'F',
          token: `$F{${f.name}}`,
          name: f.name,
          className: f.className,
          description: f.description || ''
        });
      }
    }
    if (activeSidebarTab === 'all' || activeSidebarTab === 'P') {
      for (const p of currentMetadata.parameters || []) {
        allItems.push({
          kind: 'P',
          token: `$P{${p.name}}`,
          name: p.name,
          className: p.className,
          description: p.description || ''
        });
      }
    }
    if (activeSidebarTab === 'all' || activeSidebarTab === 'V') {
      for (const v of currentMetadata.variables || []) {
        allItems.push({
          kind: 'V',
          token: `$V{${v.name}}`,
          name: v.name,
          className: v.className,
          description: v.description || ''
        });
      }
    }

    const filtered = allItems.filter((item) => {
      if (!query) {
        return true;
      }
      return (
        item.token.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        item.className.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      metadataItemsList.innerHTML =
        '<div class="empty-sidebar">Nenhum campo, parâmetro ou variável encontrado.</div>';
      return;
    }

    metadataItemsList.innerHTML = filtered
      .map((item) => {
        const kindBadgeCls =
          item.kind === 'F'
            ? 'badge-field'
            : item.kind === 'P'
            ? 'badge-param'
            : 'badge-var';
        return `<div class="meta-item" data-token="${escapeHtml(item.token)}">
          <div class="meta-item-main">
            <span class="meta-kind-badge ${kindBadgeCls}">$${item.kind}</span>
            <span class="meta-name" title="${escapeHtml(item.token)}">${escapeHtml(item.name)}</span>
            <span class="meta-type" title="${escapeHtml(item.className)}">${escapeHtml(
              shortenType(item.className)
            )}</span>
          </div>
          ${
            item.description
              ? `<div class="meta-desc">${escapeHtml(item.description)}</div>`
              : ''
          }
          <div class="meta-item-actions">
            <button type="button" class="mini-btn btn-insert-ref" data-insert="${escapeHtml(
              item.token
            )}" title="Inserir ${escapeHtml(item.token)} no cursor">Inserir</button>
            <button type="button" class="mini-btn btn-insert-dot" data-insert="${escapeHtml(
              item.token
            )}." title="Inserir ${escapeHtml(item.token)}. e listar métodos">. métodos</button>
            <button type="button" class="mini-btn btn-insert-safe" data-insert="${escapeHtml(
              item.token
            )}?." title="Inserir com operador Groovy Safe Navigation (?.)">?. safe</button>
          </div>
        </div>`;
      })
      .join('');

    metadataItemsList.querySelectorAll('.meta-item').forEach((itemEl) => {
      itemEl.addEventListener('click', (ev) => {
        if (ev.target && ev.target.classList.contains('mini-btn')) {
          return;
        }
        const token = itemEl.getAttribute('data-token');
        if (token && editor) {
          editor.insertTextAtCursor(token, false);
        }
      });
    });

    metadataItemsList.querySelectorAll('.btn-insert-ref').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const text = btn.getAttribute('data-insert');
        if (text && editor) {
          editor.insertTextAtCursor(text, false);
        }
      });
    });

    metadataItemsList.querySelectorAll('.btn-insert-dot, .btn-insert-safe').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const text = btn.getAttribute('data-insert');
        if (text && editor) {
          editor.insertTextAtCursor(text, false);
          editor.triggerSuggest();
        }
      });
    });
  }

  // Event Listeners da UI
  document.querySelectorAll('.snippet-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-snippet');
      const expansion = (key && snippetsMap[key]) || DEFAULT_SNIPPETS[key];
      if (expansion && editor) {
        editor.insertTextAtCursor(expansion, true);
      }
    });
  });

  document.querySelectorAll('.op-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const insertText = btn.getAttribute('data-insert');
      if (insertText && editor) {
        editor.insertTextAtCursor(insertText, false);
        if (insertText.endsWith('.')) {
          editor.triggerSuggest();
        }
      }
    });
  });

  selCommonFunctions.addEventListener('change', () => {
    const val = selCommonFunctions.value;
    if (val && editor) {
      editor.insertTextAtCursor(val, true);
      selCommonFunctions.value = '';
    }
  });

  btnTriggerSuggest.addEventListener('click', () => {
    if (editor) {
      editor.focus();
      editor.triggerSuggest();
    }
  });

  selExpressionSwitch.addEventListener('change', () => {
    const exprId = selExpressionSwitch.value;
    if (exprId) {
      vscode.postMessage({
        command: 'switchExpression',
        expressionId: exprId
      });
    }
  });

  selLanguage.addEventListener('change', () => {
    currentLanguage = selLanguage.value === 'java' ? 'java' : 'groovy';
    if (editor && window.monaco) {
      window.monaco.editor.setModelLanguage(editor.getModel(), currentLanguage);
    }
    requestValidationAndPreview();
  });

  btnRevealXml.addEventListener('click', () => {
    vscode.postMessage({ command: 'revealInXml' });
  });

  btnSaveExpression.addEventListener('click', () => saveExpression(false));
  btnSaveAndClose.addEventListener('click', () => saveExpression(true));

  btnRegenerateMock.addEventListener('click', () => {
    customMockValues = {};
    vscode.postMessage({
      command: 'regenerateMockData',
      expression: editor ? editor.getValue() : ''
    });
  });

  sidebarSearchInput.addEventListener('input', () => {
    renderSidebarMetadata();
  });

  document.querySelectorAll('.sidebar-tabs .tab-btn').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      document
        .querySelectorAll('.sidebar-tabs .tab-btn')
        .forEach((b) => b.classList.remove('active'));
      tabBtn.classList.add('active');
      activeSidebarTab = tabBtn.getAttribute('data-tab') || 'all';
      renderSidebarMetadata();
    });
  });

  // Recebe mensagens do Extension Host
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || !message.command) {
      return;
    }

    switch (message.command) {
      case 'initEditor': {
        activeFileName.textContent = message.fileName || 'relatorio.jrxml';
        currentLanguage = message.language === 'java' ? 'java' : 'groovy';
        selLanguage.value = currentLanguage;

        if (Array.isArray(message.snippets)) {
          for (const s of message.snippets) {
            snippetsMap[s.prefix] = s.expansion;
          }
        }

        if (message.activeOccurrence) {
          const occ = message.activeOccurrence;
          activeTagBadge.textContent = `<${occ.tagName}>`;
          activeLineBadge.textContent = `L${occ.startLine || 1}`;
          expectedTypeBadge.textContent = occ.expectedType || 'java.lang.Object';
          if (editor) {
            editor.setValue(occ.expression || '');
          }
          populateOccurrencesDropdown(message.allOccurrences || [], occ.id);
        }

        if (message.metadata) {
          currentMetadata = message.metadata;
          renderSidebarMetadata();
        }

        populateCommonFunctionsDropdown(message.builtinFunctions || []);
        renderValidationResult(message.validation);
        renderPreviewResult(message.preview);
        renderMockDataInputs(message.mockEntries || []);
        break;
      }

      case 'validationAndPreviewResult': {
        renderValidationResult(message.validation);
        renderPreviewResult(message.preview);
        if (Array.isArray(message.mockEntries)) {
          renderMockDataInputs(message.mockEntries);
        }
        break;
      }

      case 'completionsResult': {
        const resolver = pendingCompletionResolvers.get(message.requestId);
        if (resolver) {
          pendingCompletionResolvers.delete(message.requestId);
          resolver({ suggestions: message.items || [] });
        }
        break;
      }

      case 'saveSuccess': {
        showBanner(message.message || 'Expressão salva com sucesso no XML!', false);
        break;
      }

      case 'saveError': {
        showBanner(message.message || 'Erro ao salvar expressão.', true);
        break;
      }
    }
  });

  initWorker();
  initMonaco();
  vscode.postMessage({ command: 'ready' });
})();
