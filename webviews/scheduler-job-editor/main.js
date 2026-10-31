(function () {
  var vscode = acquireVsCodeApi();
  var triggerEditor = window.JasperTriggerEditor
    ? window.JasperTriggerEditor.createController(vscode)
    : null;

  var editorTitle = document.getElementById('editorTitle');
  var serverSubtitle = document.getElementById('serverSubtitle');
  var statusBanner = document.getElementById('statusBanner');
  var runNowHeaderBtn = document.getElementById('runNowHeaderBtn');

  var jobForm = document.getElementById('jobEditorForm');
  var jobIdInput = document.getElementById('jobIdInput');
  var jobNameInput = document.getElementById('jobNameInput');
  var jobDescInput = document.getElementById('jobDescInput');
  var reportUnitInput = document.getElementById('reportUnitInput');
  var outputFormatSelect = document.getElementById('outputFormatSelect');

  var openTreePickerBtn = document.getElementById('openTreePickerBtn');
  var inspectParamsBtn = document.getElementById('inspectParamsBtn');
  var reloadParamsFromReportBtn = document.getElementById('reloadParamsFromReportBtn');
  var addParamRowBtn = document.getElementById('addParamRowBtn');
  var parametersTableBody = document.getElementById('parametersTableBody');
  var paramCountBadge = document.getElementById('paramCountBadge');

  var addTriggerBtn = document.getElementById('addTriggerBtn');
  var triggersListContainer = document.getElementById('triggersListContainer');
  var triggerCountBadge = document.getElementById('triggerCountBadge');

  var cancelJobBtn = document.getElementById('cancelJobBtn');
  var saveJobBtn = document.getElementById('saveJobBtn');

  var treePickerBackdrop = document.getElementById('treePickerBackdrop');
  var closeTreePickerBtn = document.getElementById('closeTreePickerBtn');
  var cancelTreePickerBtn = document.getElementById('cancelTreePickerBtn');
  var pickerCurrentFolder = document.getElementById('pickerCurrentFolder');
  var pickerUpFolderBtn = document.getElementById('pickerUpFolderBtn');
  var pickerResourceList = document.getElementById('pickerResourceList');

  var tabButtons = document.querySelectorAll('.tab-btn');
  var tabPanels = document.querySelectorAll('.tab-panel');

  var parametersState = [];
  var triggersState = [];
  var defaultTimezone = 'America/Sao_Paulo';
  var currentPickerFolder = '/';

  var JAVA_TYPES = [
    'java.lang.String',
    'java.lang.Integer',
    'java.lang.Long',
    'java.lang.Double',
    'java.math.BigDecimal',
    'java.lang.Boolean',
    'java.util.Date',
    'java.sql.Timestamp'
  ];

  function showStatus(msg, type) {
    if (!statusBanner) {
      return;
    }
    statusBanner.textContent = msg;
    statusBanner.className = 'status-banner status-' + (type || 'info');
  }

  function clearStatus() {
    if (!statusBanner) {
      return;
    }
    statusBanner.textContent = '';
    statusBanner.className = 'status-banner hidden';
  }

  function switchTab(tabId) {
    for (var i = 0; i < tabButtons.length; i++) {
      var btn = tabButtons[i];
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
    for (var j = 0; j < tabPanels.length; j++) {
      var panel = tabPanels[j];
      if (panel.id === tabId) {
        panel.classList.remove('hidden');
        panel.classList.add('active');
      } else {
        panel.classList.add('hidden');
        panel.classList.remove('active');
      }
    }
  }

  for (var i = 0; i < tabButtons.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.getAttribute('data-tab'));
      });
    })(tabButtons[i]);
  }

  function renderParametersTable() {
    parametersTableBody.innerHTML = '';
    paramCountBadge.textContent = String(parametersState.length);

    if (parametersState.length === 0) {
      var emptyTr = document.createElement('tr');
      var emptyTd = document.createElement('td');
      emptyTd.colSpan = 6;
      emptyTd.className = 'center-col';
      emptyTd.style.color = 'var(--vscode-descriptionForeground)';
      emptyTd.textContent =
        'Nenhum parâmetro configurado. Selecione um Report Unit ou clique em "+ Adicionar Parâmetro".';
      emptyTr.appendChild(emptyTd);
      parametersTableBody.appendChild(emptyTr);
      return;
    }

    parametersState.forEach(function (param, idx) {
      var tr = document.createElement('tr');

      // Nome
      var tdName = document.createElement('td');
      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = param.name || '';
      nameInput.placeholder = 'Ex: DATA_INICIO';
      nameInput.addEventListener('input', function () {
        parametersState[idx].name = nameInput.value.trim();
      });
      tdName.appendChild(nameInput);
      tr.appendChild(tdName);

      // Tipo
      var tdType = document.createElement('td');
      var typeSelect = document.createElement('select');
      JAVA_TYPES.forEach(function (jt) {
        var opt = document.createElement('option');
        opt.value = jt;
        opt.textContent = jt;
        if (param.type === jt) {
          opt.selected = true;
        }
        typeSelect.appendChild(opt);
      });
      typeSelect.addEventListener('change', function () {
        parametersState[idx].type = typeSelect.value;
      });
      tdType.appendChild(typeSelect);
      tr.appendChild(tdType);

      // Valor padrão
      var tdVal = document.createElement('td');
      var valInput = document.createElement('input');
      valInput.type = 'text';
      valInput.value = param.defaultValue !== undefined ? param.defaultValue : '';
      valInput.placeholder = 'Valor padrão...';
      valInput.addEventListener('input', function () {
        parametersState[idx].defaultValue = valInput.value;
      });
      tdVal.appendChild(valInput);
      tr.appendChild(tdVal);

      // Obrigatório
      var tdReq = document.createElement('td');
      tdReq.className = 'center-col';
      var reqCheck = document.createElement('input');
      reqCheck.type = 'checkbox';
      reqCheck.checked = Boolean(param.isRequired);
      reqCheck.addEventListener('change', function () {
        parametersState[idx].isRequired = reqCheck.checked;
      });
      tdReq.appendChild(reqCheck);
      tr.appendChild(tdReq);

      // Prompt
      var tdPrompt = document.createElement('td');
      tdPrompt.className = 'center-col';
      var promptCheck = document.createElement('input');
      promptCheck.type = 'checkbox';
      promptCheck.checked = param.isForPrompting !== false;
      promptCheck.addEventListener('change', function () {
        parametersState[idx].isForPrompting = promptCheck.checked;
      });
      tdPrompt.appendChild(promptCheck);
      tr.appendChild(tdPrompt);

      // Remover
      var tdActions = document.createElement('td');
      tdActions.className = 'center-col';
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = 'Remover';
      delBtn.addEventListener('click', function () {
        parametersState.splice(idx, 1);
        renderParametersTable();
      });
      tdActions.appendChild(delBtn);
      tr.appendChild(tdActions);

      parametersTableBody.appendChild(tr);
    });
  }

  function formatTriggerSummary(t) {
    if (t.type === 'CRON') {
      return '⏰ Cron: ' + (t.cronExpression || '');
    }
    if (t.type === 'CALENDAR') {
      return (
        '📅 Calendar: ' +
        (t.calendarName || 'Calendário') +
        ' (' +
        (t.cronExpression || '') +
        ')'
      );
    }
    var ms = Number(t.repeatInterval || 3600000);
    var unitLabel = ms + 'ms';
    if (ms % 3600000 === 0) {
      unitLabel = ms / 3600000 + 'h';
    } else if (ms % 60000 === 0) {
      unitLabel = ms / 60000 + 'm';
    } else if (ms % 1000 === 0) {
      unitLabel = ms / 1000 + 's';
    }
    var cnt = t.repeatCount === undefined || t.repeatCount < 0 ? '∞' : t.repeatCount;
    return '🔁 Simple: ' + unitLabel + ' x ' + cnt;
  }

  function renderTriggersList() {
    triggersListContainer.innerHTML = '';
    triggerCountBadge.textContent = String(triggersState.length);

    if (triggersState.length === 0) {
      var emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.textContent =
        'Nenhum Trigger adicionado. Clique em "+ Adicionar Trigger" para configurar a recorrência (Simple, Cron ou Calendar).';
      triggersListContainer.appendChild(emptyDiv);
      return;
    }

    triggersState.forEach(function (trig, idx) {
      var card = document.createElement('div');
      card.className = 'trigger-card';

      var info = document.createElement('div');
      info.className = 'trigger-card-info';

      var titleRow = document.createElement('div');
      titleRow.className = 'trigger-card-title';
      titleRow.textContent = formatTriggerSummary(trig);

      var pill = document.createElement('span');
      pill.className = 'trigger-state-pill ' + (trig.state || 'NORMAL');
      pill.textContent = trig.state === 'PAUSED' ? 'Pausado' : 'Ativo';
      titleRow.appendChild(pill);

      var meta = document.createElement('div');
      meta.className = 'trigger-card-meta';
      meta.textContent =
        'Timezone: ' +
        (trig.timezone || defaultTimezone) +
        ' • Início: ' +
        (trig.startTime ? new Date(trig.startTime).toLocaleString('pt-BR') : 'Imediato');

      info.appendChild(titleRow);
      info.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'trigger-card-actions';

      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn btn-secondary btn-sm';
      toggleBtn.textContent = trig.state === 'PAUSED' ? '▶ Retomar' : '⏸ Pausar';
      toggleBtn.addEventListener('click', function () {
        triggersState[idx].state = trig.state === 'PAUSED' ? 'NORMAL' : 'PAUSED';
        renderTriggersList();
      });

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-secondary btn-sm';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', function () {
        if (triggerEditor) {
          triggerEditor.open(trig, defaultTimezone, function (updated) {
            triggersState[idx] = updated;
            renderTriggersList();
          });
        }
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = 'Remover';
      delBtn.addEventListener('click', function () {
        triggersState.splice(idx, 1);
        renderTriggersList();
      });

      actions.appendChild(toggleBtn);
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      card.appendChild(info);
      card.appendChild(actions);
      triggersListContainer.appendChild(card);
    });
  }

  function requestInspectParameters(uri) {
    if (!uri || !uri.trim()) {
      return;
    }
    vscode.postMessage({
      command: 'inspectReportParameters',
      reportUnitUri: uri.trim()
    });
  }

  addParamRowBtn.addEventListener('click', function () {
    parametersState.push({
      name: '',
      type: 'java.lang.String',
      defaultValue: '',
      isRequired: false,
      isForPrompting: true
    });
    renderParametersTable();
  });

  inspectParamsBtn.addEventListener('click', function () {
    requestInspectParameters(reportUnitInput.value);
  });

  reloadParamsFromReportBtn.addEventListener('click', function () {
    requestInspectParameters(reportUnitInput.value);
  });

  addTriggerBtn.addEventListener('click', function () {
    if (triggerEditor) {
      triggerEditor.open(null, defaultTimezone, function (newTrig) {
        triggersState.push(newTrig);
        renderTriggersList();
      });
    }
  });

  // Tree Picker de Report Unit
  function loadPickerFolder(folderUri) {
    currentPickerFolder = folderUri || '/';
    pickerCurrentFolder.textContent = currentPickerFolder;
    pickerResourceList.innerHTML =
      '<div class="empty-state">Carregando recursos de "' + currentPickerFolder + '"...</div>';
    vscode.postMessage({
      command: 'browseFolder',
      folderUri: currentPickerFolder
    });
  }

  openTreePickerBtn.addEventListener('click', function () {
    treePickerBackdrop.classList.remove('hidden');
    loadPickerFolder('/');
  });

  closeTreePickerBtn.addEventListener('click', function () {
    treePickerBackdrop.classList.add('hidden');
  });

  cancelTreePickerBtn.addEventListener('click', function () {
    treePickerBackdrop.classList.add('hidden');
  });

  pickerUpFolderBtn.addEventListener('click', function () {
    if (!currentPickerFolder || currentPickerFolder === '/') {
      return;
    }
    var lastSlash = currentPickerFolder.lastIndexOf('/');
    var parent = lastSlash > 0 ? currentPickerFolder.slice(0, lastSlash) : '/';
    loadPickerFolder(parent);
  });

  function renderPickerResources(resources) {
    pickerResourceList.innerHTML = '';
    if (!resources || resources.length === 0) {
      pickerResourceList.innerHTML =
        '<div class="empty-state">Nenhum relatório ou pasta encontrado neste nível.</div>';
      return;
    }

    resources.forEach(function (res) {
      var row = document.createElement('div');
      row.className = 'picker-item';

      var isFolder = res.resourceType === 'folder';
      var left = document.createElement('span');
      left.textContent = (isFolder ? '📂 ' : '📄 ') + res.name;

      var right = document.createElement('span');
      right.style.fontSize = '11px';
      right.style.color = 'var(--vscode-descriptionForeground)';
      right.textContent = res.uri;

      row.appendChild(left);
      row.appendChild(right);

      row.addEventListener('click', function () {
        if (isFolder) {
          loadPickerFolder(res.uri);
        } else {
          reportUnitInput.value = res.uri;
          if (!jobNameInput.value.trim()) {
            jobNameInput.value = res.name.replace(/\.(jrxml|jasper)$/i, '');
          }
          treePickerBackdrop.classList.add('hidden');
          requestInspectParameters(res.uri);
        }
      });

      pickerResourceList.appendChild(row);
    });
  }

  runNowHeaderBtn.addEventListener('click', function () {
    vscode.postMessage({ command: 'runJobNow' });
  });

  cancelJobBtn.addEventListener('click', function () {
    vscode.postMessage({ command: 'cancel' });
  });

  jobForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearStatus();

    var name = jobNameInput.value.trim();
    var reportUnitUri = reportUnitInput.value.trim();

    if (!name) {
      switchTab('tab-general');
      showStatus('Informe o nome do agendamento.', 'error');
      jobNameInput.focus();
      return;
    }

    if (!reportUnitUri) {
      switchTab('tab-general');
      showStatus('Informe ou selecione o Report Unit.', 'error');
      reportUnitInput.focus();
      return;
    }

    saveJobBtn.disabled = true;
    vscode.postMessage({
      command: 'saveJob',
      payload: {
        id: jobIdInput.value || undefined,
        name: name,
        description: jobDescInput.value.trim() || undefined,
        reportUnitUri: reportUnitUri,
        outputFormat: outputFormatSelect.value,
        parameters: parametersState.filter(function (p) {
          return Boolean(p.name && p.name.trim());
        }),
        triggers: triggersState
      }
    });
  });

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || !msg.command) {
      return;
    }

    switch (msg.command) {
      case 'loadJobData': {
        clearStatus();
        saveJobBtn.disabled = false;
        defaultTimezone = msg.defaultTimezone || 'America/Sao_Paulo';

        if (msg.profile) {
          serverSubtitle.textContent =
            'Servidor: ' + msg.profile.name + ' (' + msg.profile.baseUrl + ') • TZ: ' + defaultTimezone;
        }

        var job = msg.job;
        if (job) {
          editorTitle.textContent = 'Editar Agendamento: ' + job.name;
          saveJobBtn.textContent = 'Salvar Alterações';
          runNowHeaderBtn.classList.remove('hidden');

          jobIdInput.value = job.id || '';
          jobNameInput.value = job.name || '';
          jobDescInput.value = job.description || '';
          reportUnitInput.value = job.reportUnitUri || '';
          outputFormatSelect.value = job.outputFormat || 'PDF';
          parametersState = Array.isArray(job.parameters) ? job.parameters.slice() : [];
          triggersState = Array.isArray(job.triggers) ? job.triggers.slice() : [];
        } else {
          editorTitle.textContent = 'Criar Novo Agendamento';
          saveJobBtn.textContent = 'Criar Agendamento';
          runNowHeaderBtn.classList.add('hidden');

          jobIdInput.value = '';
          jobNameInput.value = '';
          jobDescInput.value = '';
          reportUnitInput.value = '';
          outputFormatSelect.value = 'PDF';
          parametersState = [];
          triggersState = [
            {
              id: 'new-trig-default',
              isNew: true,
              type: 'CRON',
              cronExpression: '0 0 6 ? * MON-FRI *',
              startTime: new Date().toISOString(),
              timezone: defaultTimezone,
              state: 'NORMAL'
            }
          ];
        }

        renderParametersTable();
        renderTriggersList();

        if (msg.focusTriggerId && job && Array.isArray(job.triggers)) {
          switchTab('tab-triggers');
          var targetIdx = -1;
          for (var i = 0; i < triggersState.length; i++) {
            if (triggersState[i].id === msg.focusTriggerId) {
              targetIdx = i;
              break;
            }
          }
          if (targetIdx >= 0 && triggerEditor) {
            triggerEditor.open(triggersState[targetIdx], defaultTimezone, function (updated) {
              triggersState[targetIdx] = updated;
              renderTriggersList();
            });
          }
        }
        break;
      }

      case 'parametersLoaded': {
        parametersState = Array.isArray(msg.parameters) ? msg.parameters : [];
        renderParametersTable();
        showStatus(
          parametersState.length +
            ' parâmetro(s) carregado(s) do Report Unit "' +
            msg.reportUnitUri +
            '".',
          'success'
        );
        break;
      }

      case 'folderResourcesLoaded': {
        renderPickerResources(msg.resources || []);
        break;
      }

      case 'folderResourcesError': {
        pickerResourceList.innerHTML =
          '<div class="empty-state">' + (msg.message || 'Erro ao listar pasta.') + '</div>';
        break;
      }

      case 'cronValidationResult': {
        if (triggerEditor) {
          triggerEditor.renderCronValidationResult(msg);
        }
        break;
      }

      case 'saveError': {
        saveJobBtn.disabled = false;
        showStatus(msg.message || 'Erro ao salvar o agendamento.', 'error');
        break;
      }

      case 'statusMessage': {
        showStatus(msg.message, msg.type || 'info');
        break;
      }
    }
  });

  vscode.postMessage({ command: 'ready' });
})();
