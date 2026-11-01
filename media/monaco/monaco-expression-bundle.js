(function () {
  if (window.monaco && window.monaco.__jasperMonacoLoaded) {
    return;
  }

  const completionProviders = {
    groovy: [],
    java: [],
    '*': []
  };

  const MarkerSeverity = {
    Hint: 1,
    Info: 2,
    Warning: 4,
    Error: 8
  };

  function escapeHtml(str) {
    if (!str) {
      return '';
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const KEYWORDS = new Set([
    'new',
    'null',
    'true',
    'false',
    'if',
    'else',
    'return',
    'def',
    'in',
    'as',
    'instanceof',
    'it',
    'this',
    'try',
    'catch',
    'finally',
    'throw'
  ]);

  const TYPES_AND_CLASSES = new Set([
    'String',
    'Integer',
    'Long',
    'Double',
    'Float',
    'Boolean',
    'BigDecimal',
    'Number',
    'Date',
    'Timestamp',
    'LocalDate',
    'LocalDateTime',
    'SimpleDateFormat',
    'DecimalFormat',
    'NumberFormat',
    'RoundingMode',
    'DateUtils',
    'JRExtendedUtils',
    'Math',
    'Locale',
    'Objects',
    'Arrays',
    'Collections',
    'List',
    'Map',
    'Set',
    'Object'
  ]);

  const BUILTIN_FUNCS = new Set([
    'IF',
    'CONCATENATE',
    'NVL',
    'ISNULL',
    'UPPER',
    'LOWER',
    'TRIM',
    'LEN',
    'LEFT',
    'RIGHT',
    'MID',
    'DATEFORMAT',
    'NOW',
    'TODAY',
    'YEAR',
    'MONTH',
    'DAY',
    'ABS',
    'ROUND',
    'CEIL',
    'FLOOR',
    'MIN',
    'MAX'
  ]);

  /**
   * Tokeniza e aplica syntax highlighting (Groovy/Java + referências Jasper $F{}, $P{}, $V{})
   * combinando com ranges de diagnósticos inline (squiggly).
   */
  function highlightCodeWithMarkers(code, markers) {
    if (!code) {
      return '\n';
    }

    // Cria mapa de severidade por índice de caractere para aplicar squigglies exatos
    const markerAt = new Array(code.length).fill(null);
    if (Array.isArray(markers)) {
      for (const m of markers) {
        const start = Math.max(0, Math.min(code.length, Number(m.startOffset) || 0));
        const end = Math.max(start + 1, Math.min(code.length, Number(m.endOffset) || start + 1));
        for (let k = start; k < end; k++) {
          if (!markerAt[k] || m.severity === 'error' || m.severity === MarkerSeverity.Error) {
            markerAt[k] = m;
          }
        }
      }
    }

    const tokens = tokenizeGroovyJava(code);
    let html = '';

    for (const tok of tokens) {
      const cls = tok.className ? ` class="${tok.className}"` : '';
      const sliceMarkers = getMarkerSegmentsForRange(code, tok.start, tok.end, markerAt);

      if (sliceMarkers.length === 1 && !sliceMarkers[0].marker) {
        html += cls
          ? `<span${cls}>${escapeHtml(tok.text)}</span>`
          : escapeHtml(tok.text);
      } else {
        let innerHtml = '';
        for (const seg of sliceMarkers) {
          const escapedSeg = escapeHtml(seg.text);
          if (seg.marker) {
            const sevClass =
              seg.marker.severity === 'error' || seg.marker.severity === MarkerSeverity.Error
                ? 'monaco-squiggly-error'
                : seg.marker.severity === 'warning' || seg.marker.severity === MarkerSeverity.Warning
                ? 'monaco-squiggly-warning'
                : 'monaco-squiggly-info';
            const msgAttr = escapeHtml(seg.marker.message || '');
            innerHtml += `<span class="${sevClass}" data-diag-msg="${msgAttr}">${escapedSeg}</span>`;
          } else {
            innerHtml += escapedSeg;
          }
        }
        html += cls ? `<span${cls}>${innerHtml}</span>` : innerHtml;
      }
    }

    if (code.endsWith('\n')) {
      html += ' ';
    }
    return html;
  }

  function getMarkerSegmentsForRange(code, start, end, markerAt) {
    const segments = [];
    let idx = start;
    while (idx < end) {
      const currentMarker = markerAt[idx];
      let nextIdx = idx + 1;
      while (nextIdx < end && markerAt[nextIdx] === currentMarker) {
        nextIdx++;
      }
      segments.push({
        text: code.slice(idx, nextIdx),
        marker: currentMarker
      });
      idx = nextIdx;
    }
    return segments;
  }

  function tokenizeGroovyJava(code) {
    const tokens = [];
    let i = 0;
    const len = code.length;

    while (i < len) {
      const ch = code[i];
      const next = code[i + 1];

      // Comentário de linha //
      if (ch === '/' && next === '/') {
        const start = i;
        while (i < len && code[i] !== '\n') {
          i++;
        }
        tokens.push({ start, end: i, text: code.slice(start, i), className: 'mtk-comment' });
        continue;
      }

      // Comentário de bloco /* ... */
      if (ch === '/' && next === '*') {
        const start = i;
        i += 2;
        while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
          i++;
        }
        if (i < len) {
          i += 2;
        }
        tokens.push({ start, end: i, text: code.slice(start, i), className: 'mtk-comment' });
        continue;
      }

      // Referência JasperReports: $F{...}, $P{...}, $V{...}, $R{...}
      if (ch === '$' && /^[FPVRX]!?\{/.test(code.slice(i + 1))) {
        const start = i;
        const kind = code[i + 1];
        const closeIdx = code.indexOf('}', i);
        if (closeIdx > i) {
          i = closeIdx + 1;
        } else {
          while (i < len && !/\s/.test(code[i])) {
            i++;
          }
        }
        const kindClass =
          kind === 'F'
            ? 'mtk-jasper-field'
            : kind === 'P'
            ? 'mtk-jasper-param'
            : kind === 'V'
            ? 'mtk-jasper-var'
            : 'mtk-jasper-ref';
        tokens.push({
          start,
          end: i,
          text: code.slice(start, i),
          className: `mtk-jasper ${kindClass}`
        });
        continue;
      }

      // Strings ("..." ou '...')
      if (ch === '"' || ch === "'") {
        const quote = ch;
        const start = i;
        i++;
        while (i < len) {
          if (code[i] === '\\') {
            i += 2;
            continue;
          }
          if (code[i] === quote) {
            i++;
            break;
          }
          i++;
        }
        tokens.push({ start, end: i, text: code.slice(start, i), className: 'mtk-string' });
        continue;
      }

      // Números
      if (/[0-9]/.test(ch)) {
        const start = i;
        while (i < len && /[0-9._LlFfDdBbGg]/.test(code[i])) {
          i++;
        }
        tokens.push({ start, end: i, text: code.slice(start, i), className: 'mtk-number' });
        continue;
      }

      // Operadores Groovy especiais (?. ?: *. ** <=> ==~ =~)
      const three = code.slice(i, i + 3);
      const two = code.slice(i, i + 2);
      if (three === '<=>' || three === '==~') {
        tokens.push({ start: i, end: i + 3, text: three, className: 'mtk-groovy-op' });
        i += 3;
        continue;
      }
      if (two === '?.' || two === '?:' || two === '*.' || two === '**' || two === '=~') {
        tokens.push({ start: i, end: i + 2, text: two, className: 'mtk-groovy-op' });
        i += 2;
        continue;
      }

      // Identificadores, Keywords, Classes e Chamadas de Método
      if (/[a-zA-Z_$]/.test(ch)) {
        const start = i;
        while (i < len && /[a-zA-Z0-9_$]/.test(code[i])) {
          i++;
        }
        const word = code.slice(start, i);
        const afterTrim = code.slice(i).match(/^\s*\(/);

        let className = 'mtk-ident';
        if (KEYWORDS.has(word)) {
          className = 'mtk-keyword';
        } else if (TYPES_AND_CLASSES.has(word)) {
          className = 'mtk-type';
        } else if (BUILTIN_FUNCS.has(word)) {
          className = 'mtk-builtin-fn';
        } else if (afterTrim) {
          className = 'mtk-method';
        }
        tokens.push({ start, end: i, text: word, className });
        continue;
      }

      // Operadores e pontuação
      if ('+-*/%=!&|<>?:'.includes(ch)) {
        tokens.push({ start: i, end: i + 1, text: ch, className: 'mtk-operator' });
        i++;
        continue;
      }

      if ('()[]{}'.includes(ch)) {
        tokens.push({ start: i, end: i + 1, text: ch, className: 'mtk-bracket' });
        i++;
        continue;
      }

      tokens.push({ start: i, end: i + 1, text: ch, className: '' });
      i++;
    }

    return tokens;
  }

  function offsetToLineColumn(text, offset) {
    const safe = Math.max(0, Math.min(text.length, offset));
    const before = text.slice(0, safe);
    const lines = before.split('\n');
    return {
      lineNumber: lines.length,
      column: lines[lines.length - 1].length + 1
    };
  }

  function lineColumnToOffset(text, lineNumber, column) {
    const lines = text.split('\n');
    const targetLineIdx = Math.max(0, Math.min(lines.length - 1, (lineNumber || 1) - 1));
    let offset = 0;
    for (let i = 0; i < targetLineIdx; i++) {
      offset += lines[i].length + 1;
    }
    offset += Math.max(0, Math.min(lines[targetLineIdx].length, (column || 1) - 1));
    return offset;
  }

  function createMonacoEditor(container, options) {
    const opts = Object.assign(
      {
        value: '',
        language: 'groovy',
        theme: 'vs-dark',
        automaticLayout: true
      },
      options || {}
    );

    let currentLanguage = opts.language || 'groovy';
    let currentMarkers = [];
    const changeListeners = [];
    const cursorListeners = [];
    const customCommands = [];

    container.innerHTML = '';
    container.classList.add('monaco-expression-root');

    const gutterEl = document.createElement('div');
    gutterEl.className = 'monaco-gutter';

    const editorAreaEl = document.createElement('div');
    editorAreaEl.className = 'monaco-editor-area';

    const backdropEl = document.createElement('pre');
    backdropEl.className = 'monaco-highlight-backdrop';
    backdropEl.setAttribute('aria-hidden', 'true');

    const codeEl = document.createElement('code');
    codeEl.className = 'monaco-highlight-code';
    backdropEl.appendChild(codeEl);

    const textareaEl = document.createElement('textarea');
    textareaEl.className = 'monaco-input-textarea';
    textareaEl.spellcheck = false;
    textareaEl.autocapitalize = 'off';
    textareaEl.autocomplete = 'off';
    textareaEl.setAttribute('aria-label', 'Editor de Expressão JasperReports');
    textareaEl.value = opts.value || '';

    // Suggest Widget (Autocomplete Popup)
    const suggestWidgetEl = document.createElement('div');
    suggestWidgetEl.className = 'monaco-suggest-widget hidden';
    const suggestListEl = document.createElement('div');
    suggestListEl.className = 'monaco-suggest-list';
    const suggestDocEl = document.createElement('div');
    suggestDocEl.className = 'monaco-suggest-doc';
    suggestWidgetEl.appendChild(suggestListEl);
    suggestWidgetEl.appendChild(suggestDocEl);

    // Hover Tooltip Widget
    const hoverWidgetEl = document.createElement('div');
    hoverWidgetEl.className = 'monaco-hover-widget hidden';

    editorAreaEl.appendChild(backdropEl);
    editorAreaEl.appendChild(textareaEl);
    editorAreaEl.appendChild(suggestWidgetEl);
    editorAreaEl.appendChild(hoverWidgetEl);

    container.appendChild(gutterEl);
    container.appendChild(editorAreaEl);

    let suggestItems = [];
    let selectedSuggestIndex = 0;
    let isSuggestOpen = false;

    const model = {
      getValue: () => textareaEl.value,
      setValue: (val) => {
        textareaEl.value = String(val ?? '');
        renderEditor();
        notifyContentChanged();
      },
      getLanguageId: () => currentLanguage,
      _setLanguageId: (lang) => {
        currentLanguage = lang;
        renderEditor();
      },
      _setMarkers: (markers) => {
        currentMarkers = Array.isArray(markers) ? markers : [];
        renderEditor();
      }
    };

    function renderGutter() {
      const lines = textareaEl.value.split('\n');
      const pos = offsetToLineColumn(textareaEl.value, textareaEl.selectionStart);
      const lineErrorMap = new Map();

      for (const m of currentMarkers) {
        const line = Number(m.startLineNumber || m.startLine || 1);
        const prev = lineErrorMap.get(line);
        if (!prev || m.severity === 'error' || m.severity === MarkerSeverity.Error) {
          lineErrorMap.set(line, m);
        }
      }

      const html = [];
      for (let i = 1; i <= lines.length; i++) {
        const isActive = i === pos.lineNumber ? ' active-line' : '';
        const marker = lineErrorMap.get(i);
        let badge = '';
        if (marker) {
          const isErr = marker.severity === 'error' || marker.severity === MarkerSeverity.Error;
          badge = `<span class="gutter-diag-dot ${isErr ? 'dot-error' : 'dot-warn'}" title="${escapeHtml(
            marker.message || ''
          )}"></span>`;
        }
        html.push(`<div class="monaco-line-num${isActive}" data-line="${i}">${badge}<span>${i}</span></div>`);
      }
      gutterEl.innerHTML = html.join('');
    }

    function renderEditor() {
      codeEl.innerHTML = highlightCodeWithMarkers(textareaEl.value, currentMarkers);
      renderGutter();
    }

    function notifyContentChanged() {
      const val = textareaEl.value;
      for (const fn of changeListeners) {
        try {
          fn({ value: val });
        } catch {
          // ignore
        }
      }
    }

    function notifyCursorChanged() {
      const position = offsetToLineColumn(textareaEl.value, textareaEl.selectionStart);
      renderGutter();
      for (const fn of cursorListeners) {
        try {
          fn({ position, offset: textareaEl.selectionStart });
        } catch {
          // ignore
        }
      }
    }

    function closeSuggest() {
      isSuggestOpen = false;
      suggestItems = [];
      suggestWidgetEl.classList.add('hidden');
    }

    function renderSuggestItems() {
      if (!suggestItems || suggestItems.length === 0) {
        closeSuggest();
        return;
      }

      isSuggestOpen = true;
      suggestWidgetEl.classList.remove('hidden');

      // Posiciona o widget próximo ao cursor
      const pos = offsetToLineColumn(textareaEl.value, textareaEl.selectionStart);
      const topPx = Math.min(
        editorAreaEl.clientHeight - 40,
        Math.max(24, pos.lineNumber * 21 + 8 - textareaEl.scrollTop)
      );
      const leftPx = Math.min(
        Math.max(12, (pos.column - 1) * 7.6 - textareaEl.scrollLeft),
        Math.max(20, editorAreaEl.clientWidth - 360)
      );
      suggestWidgetEl.style.top = `${topPx}px`;
      suggestWidgetEl.style.left = `${leftPx}px`;

      suggestListEl.innerHTML = suggestItems
        .map((item, idx) => {
          const activeCls = idx === selectedSuggestIndex ? ' active' : '';
          const badgeKind = escapeHtml((item.kind || 'item').slice(0, 3).toUpperCase());
          return `<div class="monaco-suggest-row${activeCls}" data-idx="${idx}">
            <span class="suggest-kind kind-${escapeHtml(item.kind || 'method')}">${badgeKind}</span>
            <span class="suggest-label">${escapeHtml(item.label)}</span>
            <span class="suggest-detail">${escapeHtml(item.detail || '')}</span>
          </div>`;
        })
        .join('');

      const activeItem = suggestItems[selectedSuggestIndex];
      if (activeItem) {
        suggestDocEl.innerHTML = `<div class="doc-title">${escapeHtml(
          activeItem.detail || activeItem.label
        )}</div><div class="doc-body">${escapeHtml(activeItem.documentation || '')}</div>`;
      } else {
        suggestDocEl.innerHTML = '';
      }

      const activeRow = suggestListEl.querySelector('.monaco-suggest-row.active');
      if (activeRow && typeof activeRow.scrollIntoView === 'function') {
        activeRow.scrollIntoView({ block: 'nearest' });
      }

      suggestListEl.querySelectorAll('.monaco-suggest-row').forEach((row) => {
        row.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          const idx = Number(row.getAttribute('data-idx')) || 0;
          selectedSuggestIndex = idx;
          acceptSelectedSuggestion();
        });
      });
    }

    function acceptSelectedSuggestion() {
      if (!isSuggestOpen || !suggestItems[selectedSuggestIndex]) {
        return;
      }
      const chosen = suggestItems[selectedSuggestIndex];
      const currentText = textareaEl.value;
      const start =
        typeof chosen.replaceStartOffset === 'number'
          ? chosen.replaceStartOffset
          : textareaEl.selectionStart;
      const end =
        typeof chosen.replaceEndOffset === 'number'
          ? chosen.replaceEndOffset
          : textareaEl.selectionEnd;
      const insertText = chosen.insertText || chosen.label;

      const updated = currentText.slice(0, start) + insertText + currentText.slice(end);
      textareaEl.value = updated;

      // Se a expansão tiver um placeholder de snippet como $F{CAMPO}, $F{DATA}, $F{VALOR}, $F{COND}, seleciona o identificador interno para edição rápida
      const placeholderMatch = /\$F\{(CAMPO|DATA|VALOR|COND)\}/.exec(insertText);
      if (placeholderMatch) {
        const innerWord = placeholderMatch[1];
        const innerOffset = start + placeholderMatch.index + 3;
        textareaEl.focus();
        textareaEl.setSelectionRange(innerOffset, innerOffset + innerWord.length);
      } else if (insertText.endsWith('()')) {
        const cursorPos = start + insertText.length;
        textareaEl.focus();
        textareaEl.setSelectionRange(cursorPos, cursorPos);
      } else {
        const cursorPos = start + insertText.length;
        textareaEl.focus();
        textareaEl.setSelectionRange(cursorPos, cursorPos);
      }

      closeSuggest();
      renderEditor();
      notifyContentChanged();
      notifyCursorChanged();
    }

    async function triggerSuggest() {
      const providers = [
        ...(completionProviders[currentLanguage] || []),
        ...(completionProviders['*'] || [])
      ];
      if (providers.length === 0) {
        return;
      }

      const position = offsetToLineColumn(textareaEl.value, textareaEl.selectionStart);
      const offset = textareaEl.selectionStart;
      const allItems = [];

      for (const p of providers) {
        if (typeof p.provideCompletionItems === 'function') {
          const res = await Promise.resolve(
            p.provideCompletionItems(model, position, offset, currentLanguage)
          );
          if (res && Array.isArray(res.suggestions)) {
            allItems.push(...res.suggestions);
          } else if (Array.isArray(res)) {
            allItems.push(...res);
          }
        }
      }

      suggestItems = allItems.slice(0, 60);
      selectedSuggestIndex = 0;
      renderSuggestItems();
    }

    textareaEl.addEventListener('scroll', () => {
      backdropEl.scrollTop = textareaEl.scrollTop;
      backdropEl.scrollLeft = textareaEl.scrollLeft;
      gutterEl.scrollTop = textareaEl.scrollTop;
    });

    textareaEl.addEventListener('input', (ev) => {
      renderEditor();
      notifyContentChanged();
      notifyCursorChanged();

      const ch = ev.data || '';
      const before = textareaEl.value.slice(0, textareaEl.selectionStart);

      if (
        ch === '$' ||
        ch === '{' ||
        ch === '.' ||
        ch === ':' ||
        /\$(F|P|V)\{[^}]*$/.test(before) ||
        /(?:\?\.|\*\.|\.)[a-zA-Z0-9_$]*$/.test(before) ||
        /\b(?:if|fmt|money|nullsafe|cond)$/.test(before)
      ) {
        void triggerSuggest();
      } else if (isSuggestOpen) {
        if (/[a-zA-Z0-9_$]/.test(ch)) {
          void triggerSuggest();
        } else {
          closeSuggest();
        }
      }
    });

    textareaEl.addEventListener('click', () => {
      closeSuggest();
      notifyCursorChanged();
    });

    textareaEl.addEventListener('keyup', (ev) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) {
        notifyCursorChanged();
      }
    });

    textareaEl.addEventListener('keydown', (ev) => {
      // Ctrl+Space -> Trigger Autocomplete
      if ((ev.ctrlKey || ev.metaKey) && ev.code === 'Space') {
        ev.preventDefault();
        void triggerSuggest();
        return;
      }

      if (isSuggestOpen) {
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          selectedSuggestIndex = (selectedSuggestIndex + 1) % suggestItems.length;
          renderSuggestItems();
          return;
        }
        if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          selectedSuggestIndex =
            (selectedSuggestIndex - 1 + suggestItems.length) % suggestItems.length;
          renderSuggestItems();
          return;
        }
        if (ev.key === 'Enter' || ev.key === 'Tab') {
          ev.preventDefault();
          acceptSelectedSuggestion();
          return;
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          closeSuggest();
          return;
        }
      }

      // Custom commands (ex: Ctrl+S, Ctrl+Enter)
      for (const cmd of customCommands) {
        if (cmd.matches(ev)) {
          ev.preventDefault();
          cmd.handler();
          return;
        }
      }

      // Tab -> insere 2 espaços
      if (ev.key === 'Tab' && !ev.shiftKey) {
        ev.preventDefault();
        const s = textareaEl.selectionStart;
        const e = textareaEl.selectionEnd;
        textareaEl.value = textareaEl.value.slice(0, s) + '  ' + textareaEl.value.slice(e);
        textareaEl.setSelectionRange(s + 2, s + 2);
        renderEditor();
        notifyContentChanged();
        notifyCursorChanged();
      }
    });

    // Hover sobre diagnósticos squiggly
    editorAreaEl.addEventListener('mousemove', (ev) => {
      const rect = textareaEl.getBoundingClientRect();
      const relX = ev.clientX - rect.left + textareaEl.scrollLeft - 12;
      const relY = ev.clientY - rect.top + textareaEl.scrollTop - 10;
      const approxLine = Math.max(1, Math.floor(relY / 21) + 1);
      const approxCol = Math.max(1, Math.floor(relX / 7.8) + 1);
      const hoverOffset = lineColumnToOffset(textareaEl.value, approxLine, approxCol);

      const hoveredMarker = currentMarkers.find(
        (m) => hoverOffset >= m.startOffset && hoverOffset <= m.endOffset
      );

      if (hoveredMarker && hoveredMarker.message) {
        hoverWidgetEl.classList.remove('hidden');
        hoverWidgetEl.style.top = `${Math.max(4, ev.clientY - rect.top - 38)}px`;
        hoverWidgetEl.style.left = `${Math.max(12, Math.min(editorAreaEl.clientWidth - 280, ev.clientX - rect.left))}px`;
        hoverWidgetEl.textContent = hoveredMarker.message;
      } else {
        hoverWidgetEl.classList.add('hidden');
      }
    });

    editorAreaEl.addEventListener('mouseleave', () => {
      hoverWidgetEl.classList.add('hidden');
    });

    renderEditor();

    return {
      getValue: () => textareaEl.value,
      setValue: (val) => model.setValue(val),
      getModel: () => model,
      getPosition: () => offsetToLineColumn(textareaEl.value, textareaEl.selectionStart),
      getOffset: () => textareaEl.selectionStart,
      setPosition: (pos) => {
        const targetOffset = lineColumnToOffset(
          textareaEl.value,
          pos.lineNumber || 1,
          pos.column || 1
        );
        textareaEl.focus();
        textareaEl.setSelectionRange(targetOffset, targetOffset);
        notifyCursorChanged();
      },
      insertTextAtCursor: (text, selectPlaceholder = true) => {
        const s = textareaEl.selectionStart;
        const e = textareaEl.selectionEnd;
        const current = textareaEl.value;
        textareaEl.value = current.slice(0, s) + text + current.slice(e);

        const placeholderMatch = selectPlaceholder
          ? /\$F\{(CAMPO|DATA|VALOR|COND)\}/.exec(text)
          : null;
        if (placeholderMatch) {
          const word = placeholderMatch[1];
          const pStart = s + placeholderMatch.index + 3;
          textareaEl.focus();
          textareaEl.setSelectionRange(pStart, pStart + word.length);
        } else {
          const nextCursor = s + text.length;
          textareaEl.focus();
          textareaEl.setSelectionRange(nextCursor, nextCursor);
        }

        renderEditor();
        notifyContentChanged();
        notifyCursorChanged();
      },
      triggerSuggest: () => void triggerSuggest(),
      focus: () => textareaEl.focus(),
      layout: () => renderEditor(),
      onDidChangeModelContent: (listener) => {
        changeListeners.push(listener);
        return {
          dispose: () => {
            const idx = changeListeners.indexOf(listener);
            if (idx >= 0) {
              changeListeners.splice(idx, 1);
            }
          }
        };
      },
      onDidChangeCursorPosition: (listener) => {
        cursorListeners.push(listener);
        return {
          dispose: () => {
            const idx = cursorListeners.indexOf(listener);
            if (idx >= 0) {
              cursorListeners.splice(idx, 1);
            }
          }
        };
      },
      addCommand: (matcherFn, handler) => {
        if (typeof matcherFn === 'function') {
          customCommands.push({ matches: matcherFn, handler });
        }
      }
    };
  }

  window.monaco = {
    __jasperMonacoLoaded: true,
    MarkerSeverity,
    editor: {
      create: createMonacoEditor,
      setModelMarkers: (model, _owner, markers) => {
        if (model && typeof model._setMarkers === 'function') {
          model._setMarkers(markers);
        }
      },
      setModelLanguage: (model, languageId) => {
        if (model && typeof model._setLanguageId === 'function') {
          model._setLanguageId(languageId);
        }
      }
    },
    languages: {
      registerCompletionItemProvider: (languageId, provider) => {
        const key = languageId || '*';
        if (!completionProviders[key]) {
          completionProviders[key] = [];
        }
        completionProviders[key].push(provider);
        return {
          dispose: () => {
            const idx = completionProviders[key].indexOf(provider);
            if (idx >= 0) {
              completionProviders[key].splice(idx, 1);
            }
          }
        };
      }
    }
  };
})();
