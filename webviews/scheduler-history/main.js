(function () {
  var vscode = acquireVsCodeApi();

  var historyTitle = document.getElementById('historyTitle');
  var historySubtitle = document.getElementById('historySubtitle');
  var errorBanner = document.getElementById('errorBanner');
  var executionsTableBody = document.getElementById('executionsTableBody');
  var paginationInfo = document.getElementById('paginationInfo');

  var refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
  var runJobNowBtn = document.getElementById('runJobNowBtn');
  var prevPageBtn = document.getElementById('prevPageBtn');
  var nextPageBtn = document.getElementById('nextPageBtn');

  var detailsModalBackdrop = document.getElementById('detailsModalBackdrop');
  var detailsModalTitle = document.getElementById('detailsModalTitle');
  var detailsModalContent = document.getElementById('detailsModalContent');
  var closeDetailsModalBtn = document.getElementById('closeDetailsModalBtn');
  var closeDetailsFooterBtn = document.getElementById('closeDetailsFooterBtn');

  var currentOffset = 0;
  var currentLimit = 50;

  function formatStatusLabel(status) {
    switch (status) {
      case 'SUCCESS':
        return '✓ Sucesso';
      case 'FAILED':
        return '✗ Erro';
      case 'RUNNING':
        return '⏳ Running';
      case 'CANCELLED':
        return '⏸ Cancelado';
      default:
        return status;
    }
  }

  function openDetailsModal(title, htmlBuilder) {
    detailsModalTitle.textContent = title;
    detailsModalContent.innerHTML = '';
    htmlBuilder(detailsModalContent);
    detailsModalBackdrop.classList.remove('hidden');
  }

  function closeDetailsModal() {
    detailsModalBackdrop.classList.add('hidden');
  }

  closeDetailsModalBtn.addEventListener('click', closeDetailsModal);
  closeDetailsFooterBtn.addEventListener('click', closeDetailsModal);

  refreshHistoryBtn.addEventListener('click', function () {
    vscode.postMessage({ command: 'refresh' });
  });

  runJobNowBtn.addEventListener('click', function () {
    vscode.postMessage({ command: 'runJobNow' });
  });

  prevPageBtn.addEventListener('click', function () {
    if (currentOffset >= currentLimit) {
      vscode.postMessage({
        command: 'changePage',
        offset: currentOffset - currentLimit
      });
    }
  });

  nextPageBtn.addEventListener('click', function () {
    vscode.postMessage({
      command: 'changePage',
      offset: currentOffset + currentLimit
    });
  });

  function renderExecutions(data) {
    errorBanner.classList.add('hidden');
    currentOffset = data.offset || 0;
    currentLimit = data.limit || 50;

    if (data.job) {
      historyTitle.textContent = 'Histórico de Execuções: ' + data.job.name;
      historySubtitle.textContent =
        'Report Unit: ' +
        data.job.reportUnitUri +
        ' • Formato: ' +
        data.job.outputFormat +
        ' • Timezone: ' +
        (data.timezone || 'America/Sao_Paulo');
    }

    var executions = data.executions || [];
    executionsTableBody.innerHTML = '';

    prevPageBtn.disabled = currentOffset <= 0;
    nextPageBtn.disabled = executions.length < currentLimit;
    paginationInfo.textContent =
      'Exibindo ' +
      executions.length +
      ' execução(ões) (offset ' +
      currentOffset +
      ', limite ' +
      currentLimit +
      ')';

    if (executions.length === 0) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'center-col';
      td.style.padding = '24px';
      td.style.color = 'var(--vscode-descriptionForeground)';
      td.textContent =
        'Nenhuma execução registrada para este agendamento. Clique em "▶ Executar Agora" para disparar uma execução.';
      tr.appendChild(td);
      executionsTableBody.appendChild(tr);
      return;
    }

    executions.forEach(function (exec) {
      var tr = document.createElement('tr');
      if (data.highlightExecutionId && exec.id === data.highlightExecutionId) {
        tr.className = 'highlighted-row';
      }

      // 1. Status
      var tdStatus = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = 'status-badge ' + exec.status;
      badge.textContent = formatStatusLabel(exec.status);
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      // 2. Início
      var tdStart = document.createElement('td');
      tdStart.textContent = exec.startTimeFormatted || exec.startTime || '—';
      tr.appendChild(tdStart);

      // 3. Fim (Duração)
      var tdEnd = document.createElement('td');
      var endSpan = document.createElement('span');
      endSpan.textContent = exec.endTimeFormatted || '—';
      tdEnd.appendChild(endSpan);
      if (exec.durationFormatted) {
        var durSpan = document.createElement('span');
        durSpan.className = 'duration-tag';
        durSpan.textContent = '(' + exec.durationFormatted + ')';
        tdEnd.appendChild(durSpan);
      }
      tr.appendChild(tdEnd);

      // 4. Output
      var tdOutput = document.createElement('td');
      if (exec.status === 'SUCCESS') {
        var dlBtn = document.createElement('button');
        dlBtn.type = 'button';
        dlBtn.className = 'btn btn-secondary btn-sm';
        dlBtn.textContent = '⬇ Baixar Output';
        dlBtn.addEventListener('click', function () {
          vscode.postMessage({
            command: 'downloadOutput',
            executionId: exec.id
          });
        });
        tdOutput.appendChild(dlBtn);
      } else {
        tdOutput.textContent = '—';
      }
      tr.appendChild(tdOutput);

      // 5. Erro
      var tdError = document.createElement('td');
      if (exec.errorMessage) {
        var errSpan = document.createElement('span');
        errSpan.className = 'error-tooltip-trigger';
        errSpan.title = exec.errorMessage;
        errSpan.textContent = exec.errorMessage;
        errSpan.addEventListener('click', function () {
          openDetailsModal('Erro na Execução #' + exec.id, function (container) {
            var pre = document.createElement('pre');
            pre.className = 'stack-trace-box';
            pre.textContent = exec.errorMessage;
            container.appendChild(pre);
          });
        });
        tdError.appendChild(errSpan);
      } else {
        tdError.textContent = '—';
      }
      tr.appendChild(tdError);

      // 6. Parâmetros
      var tdParams = document.createElement('td');
      tdParams.className = 'center-col';
      var paramKeys = Object.keys(exec.parameters || {});
      var paramBtn = document.createElement('button');
      paramBtn.type = 'button';
      paramBtn.className = 'btn btn-secondary btn-sm';
      paramBtn.textContent = '{ } (' + paramKeys.length + ')';
      paramBtn.title = 'Ver parâmetros utilizados nesta execução';
      paramBtn.addEventListener('click', function () {
        openDetailsModal('Parâmetros — Execução #' + exec.id, function (container) {
          if (paramKeys.length === 0) {
            var p = document.createElement('p');
            p.textContent = 'Nenhum parâmetro específico enviado nesta execução.';
            container.appendChild(p);
            return;
          }
          var tbl = document.createElement('table');
          tbl.className = 'executions-table';
          var tbody = document.createElement('tbody');
          paramKeys.forEach(function (k) {
            var row = document.createElement('tr');
            var c1 = document.createElement('td');
            c1.style.fontWeight = '600';
            c1.textContent = k;
            var c2 = document.createElement('td');
            c2.textContent = String(exec.parameters[k]);
            row.appendChild(c1);
            row.appendChild(c2);
            tbody.appendChild(row);
          });
          tbl.appendChild(tbody);
          container.appendChild(tbl);
        });
      });
      tdParams.appendChild(paramBtn);
      tr.appendChild(tdParams);

      // 7. Ações
      var tdActions = document.createElement('td');
      tdActions.className = 'center-col';
      if (exec.status === 'RUNNING') {
        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-danger btn-sm';
        cancelBtn.textContent = '⏸ Cancelar';
        cancelBtn.addEventListener('click', function () {
          vscode.postMessage({
            command: 'cancelExecution',
            executionId: exec.id
          });
        });
        tdActions.appendChild(cancelBtn);
      } else {
        var infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'btn btn-secondary btn-sm';
        infoBtn.textContent = 'Detalhes';
        infoBtn.addEventListener('click', function () {
          openDetailsModal('Detalhes da Execução #' + exec.id, function (container) {
            var pre = document.createElement('pre');
            pre.className = 'stack-trace-box';
            pre.textContent = JSON.stringify(exec, null, 2);
            container.appendChild(pre);
          });
        });
        tdActions.appendChild(infoBtn);
      }
      tr.appendChild(tdActions);

      executionsTableBody.appendChild(tr);
    });
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || !msg.command) {
      return;
    }

    if (msg.command === 'executionsLoaded') {
      renderExecutions(msg);
    } else if (msg.command === 'executionsError') {
      errorBanner.textContent = msg.message || 'Erro ao carregar histórico de execuções.';
      errorBanner.classList.remove('hidden');
    }
  });

  vscode.postMessage({ command: 'ready' });
})();
