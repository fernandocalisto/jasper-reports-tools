(function () {
  const vscode = acquireVsCodeApi();

  const reportTitleEl = document.getElementById('reportTitle');
  const connectionBadgeEl = document.getElementById('connectionBadge');
  const connDotEl = document.getElementById('connDot');
  const connectionLabelEl = document.getElementById('connectionLabel');
  const searchInputEl = document.getElementById('searchInput');
  const btnRefreshStaticEl = document.getElementById('btnRefreshStatic');
  const btnInspectDbEl = document.getElementById('btnInspectDb');
  const statusBannerEl = document.getElementById('statusBanner');
  const statusBannerTextEl = document.getElementById('statusBannerText');
  const btnOpenLogEl = document.getElementById('btnOpenLog');
  const toastBannerEl = document.getElementById('toastBanner');
  const fieldCountLabelEl = document.getElementById('fieldCountLabel');
  const validationSummaryBadgeEl = document.getElementById('validationSummaryBadge');
  const inspectionBadgeEl = document.getElementById('inspectionBadge');
  const fieldsTableBodyEl = document.getElementById('fieldsTableBody');
  const queryCodeEl = document.getElementById('queryCode');

  let allFields = [];
  let validationEnabled = true;
  let toastTimeout = null;

  function updateConnectionUi(connectionName) {
    if (connectionName) {
      connDotEl.classList.add('active');
      connectionLabelEl.textContent = connectionName;
    } else {
      connDotEl.classList.remove('active');
      connectionLabelEl.textContent = 'Nenhuma Conexão';
    }
  }

  function showStatus(message, type, showLogBtn) {
    if (!message) {
      statusBannerEl.className = 'status-banner hidden';
      return;
    }
    statusBannerTextEl.textContent = message;
    statusBannerEl.className = 'status-banner status-' + (type || 'info');
    if (showLogBtn) {
      btnOpenLogEl.classList.remove('hidden');
    } else {
      btnOpenLogEl.classList.add('hidden');
    }
  }

  function showToast(text) {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
    }
    toastBannerEl.textContent = 'Copiado para a área de transferência: ' + text;
    toastBannerEl.classList.remove('hidden');
    toastTimeout = setTimeout(function () {
      toastBannerEl.classList.add('hidden');
    }, 2500);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderValidationBadge(field) {
    if (!validationEnabled) {
      return '<span class="validation-badge validation-disabled" title="Validação desativada nas configurações">—</span>';
    }
    const status = field.validationStatus || 'OK';
    const severity = field.validationSeverity || (status === 'OK' ? 'ok' : status === 'Obrigatório' ? 'warning' : 'error');
    const message = field.validationMessage || status;

    let cssClass = 'validation-ok';
    if (severity === 'error' || status === 'Tipo incompatível') {
      cssClass = 'validation-error';
    } else if (severity === 'warning' || status === 'Obrigatório') {
      cssClass = 'validation-warning';
    }

    return (
      '<span class="validation-badge ' +
      cssClass +
      '" title="' +
      escapeHtml(message) +
      '">' +
      escapeHtml(status) +
      '</span>'
    );
  }

  function updateValidationSummary() {
    if (!validationSummaryBadgeEl) {
      return;
    }
    if (!validationEnabled || allFields.length === 0) {
      validationSummaryBadgeEl.classList.add('hidden');
      return;
    }

    let errors = 0;
    let warnings = 0;
    allFields.forEach(function (f) {
      const status = f.validationStatus || 'OK';
      const severity = f.validationSeverity || (status === 'OK' ? 'ok' : status === 'Obrigatório' ? 'warning' : 'error');
      if (severity === 'error' || status === 'Tipo incompatível') {
        errors += 1;
      } else if (severity === 'warning' || status === 'Obrigatório') {
        warnings += 1;
      }
    });

    validationSummaryBadgeEl.classList.remove('hidden', 'tag-error', 'tag-warning', 'tag-ok');
    if (errors > 0 || warnings > 0) {
      const parts = [];
      if (errors > 0) {
        parts.push(errors + (errors === 1 ? ' incompatível' : ' incompatíveis'));
      }
      if (warnings > 0) {
        parts.push(warnings + (warnings === 1 ? ' obrigatório' : ' obrigatórios'));
      }
      validationSummaryBadgeEl.textContent = '⚠ ' + parts.join(', ');
      validationSummaryBadgeEl.classList.add(errors > 0 ? 'tag-error' : 'tag-warning');
    } else {
      validationSummaryBadgeEl.textContent = '✓ Validação: OK';
      validationSummaryBadgeEl.classList.add('tag-ok');
    }
  }

  function renderTable() {
    const query = (searchInputEl.value || '').trim().toLowerCase();
    const filtered = allFields.filter(function (f) {
      if (!query) {
        return true;
      }
      return (
        f.name.toLowerCase().includes(query) ||
        (f.javaClass && f.javaClass.toLowerCase().includes(query)) ||
        (f.jdbcType && f.jdbcType.toLowerCase().includes(query)) ||
        (f.description && f.description.toLowerCase().includes(query)) ||
        (f.validationStatus && f.validationStatus.toLowerCase().includes(query))
      );
    });

    fieldCountLabelEl.textContent =
      filtered.length === allFields.length
        ? allFields.length + ' campo(s)'
        : filtered.length + ' de ' + allFields.length + ' campo(s)';

    updateValidationSummary();

    if (filtered.length === 0) {
      fieldsTableBodyEl.innerHTML =
        '<tr><td colspan="6" class="empty-state">Nenhum campo encontrado.</td></tr>';
      return;
    }

    fieldsTableBodyEl.innerHTML = filtered
      .map(function (f) {
        const sourceBadge =
          f.source === 'jdbc'
            ? '<span class="badge-source" title="Coluna retornada pelo banco, ainda não declarada no .jrxml">Novo no SQL</span>'
            : '';
        const descHtml = f.description
          ? '<span class="field-desc">' + escapeHtml(f.description) + '</span>'
          : '';

        return (
          '<tr class="field-row" data-field="' +
          escapeHtml(f.name) +
          '" title="Clique para copiar $F{' +
          escapeHtml(f.name) +
          '}">' +
          '<td class="field-name-cell">' +
          escapeHtml(f.name) +
          sourceBadge +
          descHtml +
          '</td>' +
          '<td class="mono-cell">' +
          escapeHtml(f.javaClass) +
          '</td>' +
          '<td class="mono-cell">' +
          escapeHtml(f.jdbcType || '-') +
          '</td>' +
          '<td class="mono-cell">' +
          escapeHtml(f.nullable || '-') +
          '</td>' +
          '<td class="validation-cell">' +
          renderValidationBadge(f) +
          '</td>' +
          '<td class="col-actions">' +
          '<button type="button" class="btn-small btn-copy-expr" data-field="' +
          escapeHtml(f.name) +
          '" title="Copiar $F{' +
          escapeHtml(f.name) +
          '}">$F{}</button> ' +
          '<button type="button" class="btn-small btn-copy-xml" data-field="' +
          escapeHtml(f.name) +
          '" data-class="' +
          escapeHtml(f.javaClass) +
          '" title="Copiar tag XML <field>">&lt;field&gt;</button>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  fieldsTableBodyEl.addEventListener('click', function (event) {
    const target = event.target;
    if (target && target.classList) {
      if (target.classList.contains('btn-copy-xml')) {
        event.stopPropagation();
        vscode.postMessage({
          command: 'copyFieldXml',
          fieldName: target.getAttribute('data-field'),
          javaClass: target.getAttribute('data-class')
        });
        return;
      }
      if (target.classList.contains('btn-copy-expr')) {
        event.stopPropagation();
        vscode.postMessage({
          command: 'copyExpression',
          fieldName: target.getAttribute('data-field')
        });
        return;
      }
    }

    const row = target && target.closest ? target.closest('tr.field-row') : null;
    if (row) {
      vscode.postMessage({
        command: 'copyExpression',
        fieldName: row.getAttribute('data-field')
      });
    }
  });

  searchInputEl.addEventListener('input', function () {
    renderTable();
  });

  btnRefreshStaticEl.addEventListener('click', function () {
    showStatus('', 'info', false);
    vscode.postMessage({ command: 'refreshStatic' });
  });

  btnInspectDbEl.addEventListener('click', function () {
    showStatus('', 'info', false);
    vscode.postMessage({ command: 'inspectDatabase' });
  });

  connectionBadgeEl.addEventListener('click', function () {
    vscode.postMessage({ command: 'selectConnection' });
  });

  btnOpenLogEl.addEventListener('click', function () {
    vscode.postMessage({ command: 'openLog' });
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || !message.command) {
      return;
    }

    switch (message.command) {
      case 'renderFields': {
        const data = message.data || {};
        reportTitleEl.textContent = 'Fields: ' + (data.reportName || '');
        updateConnectionUi(data.connectionName);
        allFields = Array.isArray(data.fields) ? data.fields : [];
        validationEnabled = data.validationEnabled !== false;

        if (data.inspectedWithDb) {
          inspectionBadgeEl.textContent =
            'Origem: XML + Metadados JDBC (' + (data.executionTimeMs || 0) + 'ms)';
        } else {
          inspectionBadgeEl.textContent = 'Origem: XML Estático';
        }

        queryCodeEl.textContent =
          data.queryString && data.queryString.trim().length > 0
            ? data.queryString
            : 'Nenhuma query SQL (<queryString>) definida neste relatório.';

        showStatus('', 'info', false);
        renderTable();
        break;
      }

      case 'updateConnectionStatus': {
        updateConnectionUi(message.connectionName);
        break;
      }

      case 'setLoading': {
        btnInspectDbEl.disabled = Boolean(message.loading);
        btnRefreshStaticEl.disabled = Boolean(message.loading);
        if (message.loading && message.message) {
          showStatus(message.message, 'info', false);
        }
        break;
      }

      case 'showError': {
        showStatus(message.message || 'Erro ao analisar campos.', 'error', true);
        break;
      }

      case 'copiedToast': {
        showToast(message.text || '');
        break;
      }
    }
  });

  vscode.postMessage({ command: 'ready' });
})();
