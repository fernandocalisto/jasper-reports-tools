(function () {
  function toLocalDatetimeInputValue(isoString) {
    var d = isoString ? new Date(isoString) : new Date();
    if (isNaN(d.getTime())) {
      d = new Date();
    }
    var pad = function (n) {
      return n < 10 ? '0' + n : String(n);
    };
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      'T' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes())
    );
  }

  function createTriggerEditorController(vscodeApi) {
    var backdrop = document.getElementById('triggerModalBackdrop');
    var modalTitle = document.getElementById('triggerModalTitle');
    var closeBtn = document.getElementById('closeTriggerModalBtn');
    var cancelBtn = document.getElementById('cancelTriggerModalBtn');
    var confirmBtn = document.getElementById('confirmTriggerModalBtn');

    var typeCards = document.querySelectorAll('.trigger-type-card');
    var cronSection = document.getElementById('cronSection');
    var simpleSection = document.getElementById('simpleSection');
    var calendarSection = document.getElementById('calendarSection');

    var calendarNameInput = document.getElementById('triggerCalendarName');
    var cronExprInput = document.getElementById('triggerCronExpr');
    var cronPresetSelect = document.getElementById('cronPresetSelect');
    var cronValidationBox = document.getElementById('cronValidationBox');

    var simpleIntervalValue = document.getElementById('simpleIntervalValue');
    var simpleIntervalUnit = document.getElementById('simpleIntervalUnit');
    var simpleRepeatCount = document.getElementById('simpleRepeatCount');

    var timezoneSelect = document.getElementById('triggerTimezone');
    var stateSelect = document.getElementById('triggerStateSelect');
    var startTimeInput = document.getElementById('triggerStartTime');
    var endTimeInput = document.getElementById('triggerEndTime');

    var currentType = 'CRON';
    var editingTrigger = null;
    var onSaveCallback = null;
    var lastCronValid = true;

    function setTriggerType(type) {
      currentType = type;
      for (var i = 0; i < typeCards.length; i++) {
        var card = typeCards[i];
        if (card.getAttribute('data-type') === type) {
          card.classList.add('active');
        } else {
          card.classList.remove('active');
        }
      }

      if (type === 'SIMPLE') {
        simpleSection.classList.remove('hidden');
        cronSection.classList.add('hidden');
        calendarSection.classList.add('hidden');
        confirmBtn.disabled = false;
      } else if (type === 'CALENDAR') {
        simpleSection.classList.add('hidden');
        cronSection.classList.remove('hidden');
        calendarSection.classList.remove('hidden');
        requestCronValidation();
      } else {
        simpleSection.classList.add('hidden');
        cronSection.classList.remove('hidden');
        calendarSection.classList.add('hidden');
        requestCronValidation();
      }
    }

    function requestCronValidation() {
      if (!cronExprInput) {
        return;
      }
      var expr = cronExprInput.value.trim();
      var tz = timezoneSelect ? timezoneSelect.value : 'America/Sao_Paulo';
      if (vscodeApi) {
        vscodeApi.postMessage({
          command: 'validateCron',
          cronExpression: expr,
          timezone: tz
        });
      }
    }

    function renderCronValidationResult(res) {
      if (!cronValidationBox) {
        return;
      }
      cronValidationBox.innerHTML = '';

      if (res.valid) {
        lastCronValid = true;
        if (currentType === 'CRON' || currentType === 'CALENDAR') {
          confirmBtn.disabled = false;
        }
        cronValidationBox.className = 'cron-validation-box valid';

        var titleEl = document.createElement('div');
        titleEl.className = 'cron-next-runs-title';
        titleEl.textContent =
          '✓ Expressão Quartz Cron válida — Próximas 5 execuções (' +
          (timezoneSelect ? timezoneSelect.value : 'America/Sao_Paulo') +
          '):';
        cronValidationBox.appendChild(titleEl);

        var ul = document.createElement('ol');
        ul.className = 'cron-next-runs-list';
        var runs = res.nextRuns || [];
        for (var i = 0; i < runs.length; i++) {
          var li = document.createElement('li');
          li.textContent = runs[i];
          ul.appendChild(li);
        }
        cronValidationBox.appendChild(ul);
      } else {
        lastCronValid = false;
        if (currentType === 'CRON' || currentType === 'CALENDAR') {
          confirmBtn.disabled = true;
        }
        cronValidationBox.className = 'cron-validation-box invalid';

        var errEl = document.createElement('div');
        errEl.className = 'cron-error-text';
        errEl.textContent = '✗ ' + (res.error || 'Expressão Quartz Cron inválida.');
        cronValidationBox.appendChild(errEl);

        if (res.suggestion) {
          var sugRow = document.createElement('div');
          sugRow.className = 'cron-suggestion-row';
          var sugSpan = document.createElement('span');
          sugSpan.textContent = 'Sugestão: ' + res.suggestion;
          sugRow.appendChild(sugSpan);

          var applyBtn = document.createElement('button');
          applyBtn.type = 'button';
          applyBtn.className = 'btn btn-secondary btn-sm';
          applyBtn.textContent = 'Aplicar Sugestão';
          applyBtn.addEventListener('click', function () {
            cronExprInput.value = res.suggestion.replace(/^.*Ex:\s*/i, '').trim();
            requestCronValidation();
          });
          sugRow.appendChild(applyBtn);
          cronValidationBox.appendChild(sugRow);
        }
      }
    }

    function open(trigger, defaultTimezone, onSave) {
      editingTrigger = trigger || null;
      onSaveCallback = onSave;

      if (modalTitle) {
        modalTitle.textContent = trigger ? 'Editar Trigger' : 'Adicionar Trigger';
      }

      var tz = (trigger && trigger.timezone) || defaultTimezone || 'America/Sao_Paulo';
      if (timezoneSelect) {
        timezoneSelect.value = tz;
      }
      if (stateSelect) {
        stateSelect.value = (trigger && trigger.state) || 'NORMAL';
      }

      if (startTimeInput) {
        startTimeInput.value = toLocalDatetimeInputValue(trigger && trigger.startTime);
      }
      if (endTimeInput) {
        endTimeInput.value =
          trigger && trigger.endTime ? toLocalDatetimeInputValue(trigger.endTime) : '';
      }

      if (trigger) {
        if (cronExprInput) {
          cronExprInput.value = trigger.cronExpression || '0 0 6 ? * MON-FRI *';
        }
        if (calendarNameInput) {
          calendarNameInput.value = trigger.calendarName || '';
        }
        if (trigger.repeatInterval) {
          if (trigger.repeatInterval % 3600000 === 0) {
            simpleIntervalValue.value = String(trigger.repeatInterval / 3600000);
            simpleIntervalUnit.value = '3600000';
          } else if (trigger.repeatInterval % 60000 === 0) {
            simpleIntervalValue.value = String(trigger.repeatInterval / 60000);
            simpleIntervalUnit.value = '60000';
          } else if (trigger.repeatInterval % 1000 === 0) {
            simpleIntervalValue.value = String(trigger.repeatInterval / 1000);
            simpleIntervalUnit.value = '1000';
          } else {
            simpleIntervalValue.value = String(trigger.repeatInterval);
            simpleIntervalUnit.value = '1';
          }
        }
        if (simpleRepeatCount) {
          simpleRepeatCount.value =
            trigger.repeatCount !== undefined ? String(trigger.repeatCount) : '-1';
        }
        setTriggerType(trigger.type || 'CRON');
      } else {
        if (cronExprInput) {
          cronExprInput.value = '0 0 6 ? * MON-FRI *';
        }
        if (calendarNameInput) {
          calendarNameInput.value = '';
        }
        if (simpleIntervalValue) {
          simpleIntervalValue.value = '1';
        }
        if (simpleIntervalUnit) {
          simpleIntervalUnit.value = '3600000';
        }
        if (simpleRepeatCount) {
          simpleRepeatCount.value = '24';
        }
        setTriggerType('CRON');
      }

      if (backdrop) {
        backdrop.classList.remove('hidden');
      }
    }

    function close() {
      if (backdrop) {
        backdrop.classList.add('hidden');
      }
    }

    for (var i = 0; i < typeCards.length; i++) {
      (function (card) {
        card.addEventListener('click', function () {
          setTriggerType(card.getAttribute('data-type') || 'CRON');
        });
      })(typeCards[i]);
    }

    if (cronExprInput) {
      cronExprInput.addEventListener('input', function () {
        requestCronValidation();
      });
    }

    if (cronPresetSelect) {
      cronPresetSelect.addEventListener('change', function () {
        if (cronPresetSelect.value && cronExprInput) {
          cronExprInput.value = cronPresetSelect.value;
          requestCronValidation();
        }
      });
    }

    if (timezoneSelect) {
      timezoneSelect.addEventListener('change', function () {
        if (currentType === 'CRON' || currentType === 'CALENDAR') {
          requestCronValidation();
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', close);
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', close);
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        if ((currentType === 'CRON' || currentType === 'CALENDAR') && !lastCronValid) {
          return;
        }
        if (
          currentType === 'CALENDAR' &&
          (!calendarNameInput.value || !calendarNameInput.value.trim())
        ) {
          calendarNameInput.focus();
          return;
        }

        var intervalVal = Math.max(1, Number(simpleIntervalValue.value || 1));
        var unitMult = Number(simpleIntervalUnit.value || 3600000);
        var repeatCnt = Number(simpleRepeatCount.value);
        if (isNaN(repeatCnt)) {
          repeatCnt = -1;
        }

        var startIso = startTimeInput.value
          ? new Date(startTimeInput.value).toISOString()
          : new Date().toISOString();
        var endIso = endTimeInput.value
          ? new Date(endTimeInput.value).toISOString()
          : undefined;

        var builtTrigger = {
          id:
            editingTrigger && editingTrigger.id
              ? editingTrigger.id
              : 'new-trig-' + Date.now(),
          isNew: editingTrigger ? Boolean(editingTrigger.isNew) : true,
          type: currentType,
          cronExpression:
            currentType === 'CRON' || currentType === 'CALENDAR'
              ? cronExprInput.value.trim()
              : undefined,
          calendarName:
            currentType === 'CALENDAR' ? calendarNameInput.value.trim() : undefined,
          repeatInterval: currentType === 'SIMPLE' ? intervalVal * unitMult : undefined,
          repeatCount: currentType === 'SIMPLE' ? repeatCnt : undefined,
          startTime: startIso,
          endTime: endIso,
          timezone: timezoneSelect.value || 'America/Sao_Paulo',
          state: stateSelect.value || 'NORMAL'
        };

        if (typeof onSaveCallback === 'function') {
          onSaveCallback(builtTrigger);
        }
        close();
      });
    }

    return {
      open: open,
      close: close,
      renderCronValidationResult: renderCronValidationResult
    };
  }

  window.JasperTriggerEditor = {
    createController: createTriggerEditorController
  };
})();
