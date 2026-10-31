(function () {
  const vscode = acquireVsCodeApi();

  const CATEGORY_LABELS = {
    structure: 'Estrutura',
    attributes: 'Atributos',
    query: 'Query SQL',
    parameters: 'Parâmetros',
    fields: 'Campos',
    variables: 'Variáveis',
    styles: 'Estilos',
    expressions: 'Expressões',
    subreports: 'Subrelatórios'
  };

  const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);

  // DOM References
  const diffTitle = document.getElementById('diffTitle');
  const metaFileA = document.getElementById('metaFileA');
  const metaFileB = document.getElementById('metaFileB');
  const metaDiffTime = document.getElementById('metaDiffTime');

  const statAdded = document.getElementById('statAdded');
  const statRemoved = document.getElementById('statRemoved');
  const statModified = document.getElementById('statModified');
  const statSemanticCount = document.getElementById('statSemanticCount');

  const btnPrevChange = document.getElementById('btnPrevChange');
  const btnNextChange = document.getElementById('btnNextChange');
  const changeCounter = document.getElementById('changeCounter');

  const chkOnlyChanges = document.getElementById('chkOnlyChanges');
  const chkIgnoreWhitespace = document.getElementById('chkIgnoreWhitespace');
  const chkIgnoreUUID = document.getElementById('chkIgnoreUUID');
  const chkSemanticDiff = document.getElementById('chkSemanticDiff');
  const chkSyncScroll = document.getElementById('chkSyncScroll');

  const btnToggleSummary = document.getElementById('btnToggleSummary');
  const btnExpandCollapseAll = document.getElementById('btnExpandCollapseAll');
  const btnSwapSides = document.getElementById('btnSwapSides');
  const btnExportHtml = document.getElementById('btnExportHtml');
  const btnCancelDiff = document.getElementById('btnCancelDiff');

  const filtersBar = document.getElementById('filtersBar');
  const btnSelectAllCats = document.getElementById('btnSelectAllCats');
  const btnClearAllCats = document.getElementById('btnClearAllCats');

  const statusBanner = document.getElementById('statusBanner');
  const statusBannerText = document.getElementById('statusBannerText');
  const btnBannerCancel = document.getElementById('btnBannerCancel');
  const btnOpenLog = document.getElementById('btnOpenLog');

  const semanticDrawer = document.getElementById('semanticDrawer');
  const semanticSearchInput = document.getElementById('semanticSearchInput');
  const semanticList = document.getElementById('semanticList');

  const badgeOriginA = document.getElementById('badgeOriginA');
  const badgeOriginB = document.getElementById('badgeOriginB');
  const headerNameA = document.getElementById('headerNameA');
  const headerNameB = document.getElementById('headerNameB');
  const headerInfoA = document.getElementById('headerInfoA');
  const headerInfoB = document.getElementById('headerInfoB');

  const paneLeft = document.getElementById('paneLeft');
  const paneRight = document.getElementById('paneRight');
  const linesLeft = document.getElementById('linesLeft');
  const linesRight = document.getElementById('linesRight');

  // State
  let currentDiffResult = null;
  let activeCategories = new Set(ALL_CATEGORIES);
  let expandedHunkIndices = new Set();
  let changeHunkRowIndices = [];
  let currentChangePointer = -1;
  let isSyncingLeft = false;
  let isSyncingRight = false;

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

  /**
   * Realiza syntax highlight leve de linhas XML / SQL / Expressões Jasper ($P, $F, $V)
   * preservando highlights inline de caracteres modificados quando presentes.
   */
  function formatCodeLine(rawText, inlineRanges, highlightType) {
    if (rawText === undefined || rawText === null) {
      return '';
    }
    const text = String(rawText);
    if (!text) {
      return ' ';
    }

    if (inlineRanges && inlineRanges.length > 0) {
      const range = inlineRanges[0];
      const s = Math.max(0, Math.min(text.length, range.start));
      const e = Math.max(s, Math.min(text.length, range.end));
      if (e > s) {
        const before = highlightSyntax(escapeHtml(text.slice(0, s)));
        const mid = escapeHtml(text.slice(s, e));
        const after = highlightSyntax(escapeHtml(text.slice(e)));
        const markClass =
          highlightType === 'added'
            ? 'inline-highlight-added'
            : highlightType === 'removed'
            ? 'inline-highlight-removed'
            : 'inline-highlight-modified';
        return `${before}<mark class="${markClass}">${mid}</mark>${after}`;
      }
    }

    return highlightSyntax(escapeHtml(text));
  }

  function highlightSyntax(escaped) {
    // Destaca referências Jasper $P{...}, $F{...}, $V{...}, $R{...}
    let out = escaped.replace(
      /(\$[PFVRX]!?\{[^}]*\})/g,
      '<span class="syn-jasper">$1</span>'
    );

    // Destaca CDATA
    out = out.replace(
      /(&lt;!\[CDATA\[|\]\]&gt;)/g,
      '<span class="syn-cdata">$1</span>'
    );

    // Destaca tags XML e atributos
    out = out.replace(
      /(&lt;\/?[a-zA-Z0-9_:-]+)(\s+[^&]*?)?(\/?&gt;)/g,
      function (_, tagPart, attrsPart, closePart) {
        const formattedAttrs = attrsPart
          ? attrsPart.replace(
              /([a-zA-Z0-9_:-]+)(=)(&quot;[^&]*?&quot;)/g,
              '<span class="syn-attr">$1</span>$2<span class="syn-val">$3</span>'
            )
          : '';
        return `<span class="syn-tag">${tagPart}</span>${formattedAttrs}<span class="syn-tag">${closePart}</span>`;
      }
    );

    return out;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 1024) {
      return `${bytes || 0} B`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function isPairVisibleByCategory(pair) {
    if (pair.type === 'unchanged') {
      return true;
    }
    const cat = pair.category || 'structure';
    return activeCategories.has(cat);
  }

  function renderAll() {
    if (!currentDiffResult) {
      return;
    }

    const meta = currentDiffResult.metadata;
    diffTitle.textContent = `${meta.fileA.name} ↔ ${meta.fileB.name}`;
    metaFileA.textContent = meta.fileA.path;
    metaFileB.textContent = meta.fileB.path;
    metaDiffTime.textContent = `${meta.diffTimeMs}ms`;

    headerNameA.textContent = meta.fileA.name;
    headerNameB.textContent = meta.fileB.name;
    headerInfoA.textContent = `${meta.fileA.lineCount || 0} linhas • ${formatBytes(meta.fileA.size)} • #${meta.fileA.hash}`;
    headerInfoB.textContent = `${meta.fileB.lineCount || 0} linhas • ${formatBytes(meta.fileB.size)} • #${meta.fileB.hash}`;

    // Atualiza contadores por categoria nos checkboxes
    const catTotals = {};
    ALL_CATEGORIES.forEach((c) => {
      catTotals[c] = 0;
    });
    for (const ch of currentDiffResult.changes || []) {
      if (catTotals[ch.category] !== undefined) {
        catTotals[ch.category]++;
      }
    }
    ALL_CATEGORIES.forEach((c) => {
      const badgeEl = document.getElementById(`count-${c}`);
      if (badgeEl) {
        badgeEl.textContent = String(catTotals[c] || 0);
      }
    });

    renderSemanticSummary();
    renderSideBySideLines();
  }

  function renderSemanticSummary() {
    if (!currentDiffResult) {
      return;
    }

    const searchQuery = (semanticSearchInput.value || '').trim().toLowerCase();
    const filteredChanges = (currentDiffResult.changes || []).filter((ch) => {
      if (!activeCategories.has(ch.category)) {
        return false;
      }
      if (!searchQuery) {
        return true;
      }
      const haystack = `${ch.path || ''} ${ch.description || ''} ${ch.oldValue || ''} ${ch.newValue || ''} ${ch.elementName || ''}`.toLowerCase();
      return haystack.includes(searchQuery);
    });

    statSemanticCount.textContent = `${filteredChanges.length} mudança(s)`;

    if (filteredChanges.length === 0) {
      semanticList.innerHTML =
        '<div class="empty-state">Nenhuma mudança semântica corresponde aos filtros ativos.</div>';
      return;
    }

    const htmlItems = filteredChanges.map((ch) => {
      const typeLabel =
        ch.type === 'added'
          ? '+ Adicionado'
          : ch.type === 'removed'
          ? '- Removido'
          : '~ Modificado';
      const catLabel = CATEGORY_LABELS[ch.category] || ch.category;
      const lineRef =
        ch.lineA && ch.lineB
          ? `L${ch.lineA} → L${ch.lineB}`
          : ch.lineA
          ? `L${ch.lineA}`
          : ch.lineB
          ? `L${ch.lineB}`
          : '';

      return `<div class="semantic-item type-${escapeHtml(ch.type)}" data-line-a="${ch.lineA || ''}" data-line-b="${ch.lineB || ''}">
        <div class="semantic-item-top">
          <span class="semantic-badge">${escapeHtml(typeLabel)} • ${escapeHtml(catLabel)}</span>
          <span class="semantic-line-ref">${escapeHtml(lineRef)}</span>
        </div>
        <div class="semantic-desc">${escapeHtml(ch.description || ch.elementName || '')}</div>
        <div class="semantic-xpath">${escapeHtml(ch.path || '')}</div>
      </div>`;
    });

    semanticList.innerHTML = htmlItems.join('');

    semanticList.querySelectorAll('.semantic-item').forEach((itemEl) => {
      itemEl.addEventListener('click', () => {
        semanticList.querySelectorAll('.semantic-item.active').forEach((el) => el.classList.remove('active'));
        itemEl.classList.add('active');
        const lineA = Number(itemEl.getAttribute('data-line-a')) || 0;
        const lineB = Number(itemEl.getAttribute('data-line-b')) || 0;
        scrollToLineNumber(lineA, lineB);
      });
    });
  }

  function renderSideBySideLines() {
    if (!currentDiffResult) {
      return;
    }

    const rawPairs = currentDiffResult.lineDiff || [];
    const onlyChanges = Boolean(chkOnlyChanges.checked);
    const contextLines = 3;

    // Determina o tipo efetivo de cada par após aplicar filtro de categorias
    const effectivePairs = rawPairs.map((pair, idx) => {
      if (pair.type !== 'unchanged' && !isPairVisibleByCategory(pair)) {
        // Quando a categoria está desmarcada no filtro, trata a linha como oculta/inalterada
        return {
          ...pair,
          effectiveType: 'filtered-out',
          originalIndex: idx
        };
      }
      return {
        ...pair,
        effectiveType: pair.type,
        originalIndex: idx
      };
    });

    // Atualiza estatísticas (+added -removed ~modified) baseadas nas categorias ativas
    let addedCount = 0;
    let removedCount = 0;
    let modifiedCount = 0;

    for (const p of effectivePairs) {
      if (p.effectiveType === 'added') {
        addedCount++;
      } else if (p.effectiveType === 'removed') {
        removedCount++;
      } else if (p.effectiveType === 'modified') {
        modifiedCount++;
      }
    }

    statAdded.textContent = `+${addedCount}`;
    statRemoved.textContent = `-${removedCount}`;
    statModified.textContent = `~${modifiedCount}`;

    // Marca quais linhas devem ficar visíveis quando "Apenas Mudanças" está ativo
    const isNearChange = new Array(effectivePairs.length).fill(!onlyChanges);
    if (onlyChanges) {
      for (let i = 0; i < effectivePairs.length; i++) {
        const t = effectivePairs[i].effectiveType;
        if (t === 'added' || t === 'removed' || t === 'modified') {
          const from = Math.max(0, i - contextLines);
          const to = Math.min(effectivePairs.length - 1, i + contextLines);
          for (let k = from; k <= to; k++) {
            isNearChange[k] = true;
          }
        }
      }
    }

    const leftRows = [];
    const rightRows = [];
    changeHunkRowIndices = [];

    let inChangeHunk = false;
    let renderedRowIdx = 0;
    let i = 0;

    while (i < effectivePairs.length) {
      const pair = effectivePairs[i];

      // Se a linha pertence a uma categoria desmarcada, oculta a mudança
      if (pair.effectiveType === 'filtered-out') {
        inChangeHunk = false;
        i++;
        continue;
      }

      if (!isNearChange[i] && !expandedHunkIndices.has(i)) {
        let endCollapse = i;
        while (
          endCollapse < effectivePairs.length &&
          !isNearChange[endCollapse] &&
          effectivePairs[endCollapse].effectiveType === 'unchanged'
        ) {
          endCollapse++;
        }
        const hiddenCount = endCollapse - i;
        if (hiddenCount > 1) {
          const startIdx = i;
          const collapseHtml = `<div class="diff-collapsed-row" data-hunk-start="${startIdx}" data-hunk-end="${endCollapse}">
            <div class="diff-collapsed-cell" colspan="3">&#8942; Expandir ${hiddenCount} linhas inalteradas &#8942;</div>
          </div>`;
          leftRows.push(collapseHtml);
          rightRows.push(collapseHtml);
          renderedRowIdx++;
          inChangeHunk = false;
          i = endCollapse;
          continue;
        }
      }

      const isChanged =
        pair.effectiveType === 'added' ||
        pair.effectiveType === 'removed' ||
        pair.effectiveType === 'modified';

      if (isChanged && !inChangeHunk) {
        changeHunkRowIndices.push(renderedRowIdx);
        inChangeHunk = true;
      } else if (!isChanged) {
        inChangeHunk = false;
      }

      const rowAttr = `data-row-index="${renderedRowIdx}" data-line-a="${pair.lineNumberA || ''}" data-line-b="${pair.lineNumberB || ''}"`;

      if (pair.effectiveType === 'unchanged') {
        const htmlA = formatCodeLine(pair.textA, null, 'unchanged');
        const htmlB = formatCodeLine(pair.textB, null, 'unchanged');
        leftRows.push(
          `<div class="diff-line line-unchanged" ${rowAttr}>
            <span class="line-gutter" data-side="left" data-line="${pair.lineNumberA || ''}">${pair.lineNumberA || ''}</span>
            <span class="line-marker"> </span>
            <span class="line-content">${htmlA}</span>
          </div>`
        );
        rightRows.push(
          `<div class="diff-line line-unchanged" ${rowAttr}>
            <span class="line-gutter" data-side="right" data-line="${pair.lineNumberB || ''}">${pair.lineNumberB || ''}</span>
            <span class="line-marker"> </span>
            <span class="line-content">${htmlB}</span>
          </div>`
        );
      } else if (pair.effectiveType === 'removed') {
        const htmlA = formatCodeLine(pair.textA, null, 'removed');
        leftRows.push(
          `<div class="diff-line line-removed" ${rowAttr}>
            <span class="line-gutter" data-side="left" data-line="${pair.lineNumberA || ''}">${pair.lineNumberA || ''}</span>
            <span class="line-marker">-</span>
            <span class="line-content">${htmlA}</span>
          </div>`
        );
        rightRows.push(
          `<div class="diff-line line-placeholder" ${rowAttr}>
            <span class="line-gutter"></span>
            <span class="line-marker"> </span>
            <span class="line-content"> </span>
          </div>`
        );
      } else if (pair.effectiveType === 'added') {
        const htmlB = formatCodeLine(pair.textB, null, 'added');
        leftRows.push(
          `<div class="diff-line line-placeholder" ${rowAttr}>
            <span class="line-gutter"></span>
            <span class="line-marker"> </span>
            <span class="line-content"> </span>
          </div>`
        );
        rightRows.push(
          `<div class="diff-line line-added" ${rowAttr}>
            <span class="line-gutter" data-side="right" data-line="${pair.lineNumberB || ''}">${pair.lineNumberB || ''}</span>
            <span class="line-marker">+</span>
            <span class="line-content">${htmlB}</span>
          </div>`
        );
      } else if (pair.effectiveType === 'modified') {
        const htmlA = formatCodeLine(pair.textA, pair.inlineHighlightsA, 'modified');
        const htmlB = formatCodeLine(pair.textB, pair.inlineHighlightsB, 'modified');
        leftRows.push(
          `<div class="diff-line line-modified" ${rowAttr}>
            <span class="line-gutter" data-side="left" data-line="${pair.lineNumberA || ''}">${pair.lineNumberA || ''}</span>
            <span class="line-marker">~</span>
            <span class="line-content">${htmlA}</span>
          </div>`
        );
        rightRows.push(
          `<div class="diff-line line-modified" ${rowAttr}>
            <span class="line-gutter" data-side="right" data-line="${pair.lineNumberB || ''}">${pair.lineNumberB || ''}</span>
            <span class="line-marker">~</span>
            <span class="line-content">${htmlB}</span>
          </div>`
        );
      }

      renderedRowIdx++;
      i++;
    }

    linesLeft.innerHTML = leftRows.join('');
    linesRight.innerHTML = rightRows.join('');

    // Bind eventos de expandir hunks colapsados
    document.querySelectorAll('.diff-collapsed-row').forEach((rowEl) => {
      rowEl.addEventListener('click', () => {
        const s = Number(rowEl.getAttribute('data-hunk-start'));
        const e = Number(rowEl.getAttribute('data-hunk-end'));
        for (let k = s; k < e; k++) {
          expandedHunkIndices.add(k);
        }
        renderSideBySideLines();
      });
    });

    // Bind eventos de clique no número da linha para abrir o arquivo no VS Code
    document.querySelectorAll('.line-gutter[data-line]').forEach((gutterEl) => {
      gutterEl.addEventListener('click', () => {
        const line = Number(gutterEl.getAttribute('data-line'));
        const side = gutterEl.getAttribute('data-side');
        if (line > 0 && side) {
          vscode.postMessage({
            command: 'openFileAtLine',
            side,
            line
          });
        }
      });
    });

    if (changeHunkRowIndices.length > 0) {
      currentChangePointer = 0;
      highlightChangeAtPointer(false);
    } else {
      currentChangePointer = -1;
      updateNavigationIndicator();
    }
  }

  function updateNavigationIndicator() {
    const total = changeHunkRowIndices.length;
    if (total === 0 || currentChangePointer < 0) {
      changeCounter.textContent = '0 / 0';
      btnPrevChange.disabled = true;
      btnNextChange.disabled = true;
    } else {
      changeCounter.textContent = `${currentChangePointer + 1} / ${total}`;
      btnPrevChange.disabled = false;
      btnNextChange.disabled = false;
    }
  }

  function highlightChangeAtPointer(scrollIntoView = true) {
    updateNavigationIndicator();
    document
      .querySelectorAll('.diff-line.active-change-row')
      .forEach((el) => el.classList.remove('active-change-row'));

    if (currentChangePointer < 0 || currentChangePointer >= changeHunkRowIndices.length) {
      return;
    }

    const targetRowIdx = changeHunkRowIndices[currentChangePointer];
    const rowLeft = linesLeft.querySelector(`.diff-line[data-row-index="${targetRowIdx}"]`);
    const rowRight = linesRight.querySelector(`.diff-line[data-row-index="${targetRowIdx}"]`);

    if (rowLeft) {
      rowLeft.classList.add('active-change-row');
    }
    if (rowRight) {
      rowRight.classList.add('active-change-row');
    }

    if (scrollIntoView && rowLeft) {
      const top = Math.max(0, rowLeft.offsetTop - paneLeft.clientHeight / 3);
      paneLeft.scrollTop = top;
      if (chkSyncScroll.checked) {
        paneRight.scrollTop = top;
      }
    }
  }

  function navigateChange(delta) {
    const total = changeHunkRowIndices.length;
    if (total === 0) {
      return;
    }
    currentChangePointer = (currentChangePointer + delta + total) % total;
    highlightChangeAtPointer(true);
  }

  function scrollToLineNumber(lineA, lineB) {
    let targetEl = null;
    if (lineA > 0) {
      targetEl = linesLeft.querySelector(`.diff-line[data-line-a="${lineA}"]`);
    }
    if (!targetEl && lineB > 0) {
      targetEl = linesRight.querySelector(`.diff-line[data-line-b="${lineB}"]`);
    }
    if (targetEl) {
      const rowIndex = Number(targetEl.getAttribute('data-row-index'));
      document
        .querySelectorAll('.diff-line.active-change-row')
        .forEach((el) => el.classList.remove('active-change-row'));

      const leftMatch = linesLeft.querySelector(`.diff-line[data-row-index="${rowIndex}"]`);
      const rightMatch = linesRight.querySelector(`.diff-line[data-row-index="${rowIndex}"]`);
      if (leftMatch) {
        leftMatch.classList.add('active-change-row');
      }
      if (rightMatch) {
        rightMatch.classList.add('active-change-row');
      }

      const top = Math.max(0, targetEl.offsetTop - paneLeft.clientHeight / 3);
      paneLeft.scrollTop = top;
      paneRight.scrollTop = top;
    }
  }

  function postUpdatedOptions() {
    vscode.postMessage({
      command: 'updateOptions',
      options: {
        ignoreWhitespace: Boolean(chkIgnoreWhitespace.checked),
        ignoreUUID: Boolean(chkIgnoreUUID.checked),
        ignoreAttributeOrder: true,
        semanticQueryDiff: Boolean(chkSemanticDiff.checked),
        semanticExpressionDiff: Boolean(chkSemanticDiff.checked),
        filters: Array.from(activeCategories)
      }
    });
  }

  // Synchronized Scroll between Left and Right panes
  paneLeft.addEventListener('scroll', () => {
    if (!chkSyncScroll.checked || isSyncingLeft) {
      return;
    }
    isSyncingRight = true;
    paneRight.scrollTop = paneLeft.scrollTop;
    paneRight.scrollLeft = paneLeft.scrollLeft;
    requestAnimationFrame(() => {
      isSyncingRight = false;
    });
  });

  paneRight.addEventListener('scroll', () => {
    if (!chkSyncScroll.checked || isSyncingRight) {
      return;
    }
    isSyncingLeft = true;
    paneLeft.scrollTop = paneRight.scrollTop;
    paneLeft.scrollLeft = paneRight.scrollLeft;
    requestAnimationFrame(() => {
      isSyncingLeft = false;
    });
  });

  // Navigation Buttons & F7 / Shift+F7 Shortcuts
  btnNextChange.addEventListener('click', () => navigateChange(1));
  btnPrevChange.addEventListener('click', () => navigateChange(-1));

  window.addEventListener('keydown', (event) => {
    if (event.key === 'F7') {
      event.preventDefault();
      if (event.shiftKey) {
        navigateChange(-1);
      } else {
        navigateChange(1);
      }
    }
  });

  // Toolbar Option Listeners
  chkOnlyChanges.addEventListener('change', () => {
    expandedHunkIndices.clear();
    btnExpandCollapseAll.textContent = chkOnlyChanges.checked
      ? 'Expandir Inalterados'
      : 'Recolher Inalterados';
    renderSideBySideLines();
  });

  chkIgnoreWhitespace.addEventListener('change', postUpdatedOptions);
  chkIgnoreUUID.addEventListener('change', postUpdatedOptions);
  chkSemanticDiff.addEventListener('change', postUpdatedOptions);

  btnToggleSummary.addEventListener('click', () => {
    semanticDrawer.classList.toggle('hidden');
  });

  btnExpandCollapseAll.addEventListener('click', () => {
    chkOnlyChanges.checked = !chkOnlyChanges.checked;
    expandedHunkIndices.clear();
    btnExpandCollapseAll.textContent = chkOnlyChanges.checked
      ? 'Expandir Inalterados'
      : 'Recolher Inalterados';
    renderSideBySideLines();
  });

  btnSwapSides.addEventListener('click', () => {
    vscode.postMessage({ command: 'swapSides' });
  });

  btnExportHtml.addEventListener('click', () => {
    vscode.postMessage({
      command: 'exportDiff',
      format: 'html',
      filters: Array.from(activeCategories)
    });
  });

  const cancelHandler = () => {
    vscode.postMessage({ command: 'cancelDiff' });
  };
  btnCancelDiff.addEventListener('click', cancelHandler);
  btnBannerCancel.addEventListener('click', cancelHandler);

  btnOpenLog.addEventListener('click', () => {
    vscode.postMessage({ command: 'openLog' });
  });

  semanticSearchInput.addEventListener('input', () => {
    renderSemanticSummary();
  });

  // Category Checkboxes
  filtersBar.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
    chk.addEventListener('change', () => {
      const cat = chk.value;
      if (chk.checked) {
        activeCategories.add(cat);
      } else {
        activeCategories.delete(cat);
      }
      renderSemanticSummary();
      renderSideBySideLines();
    });
  });

  btnSelectAllCats.addEventListener('click', () => {
    activeCategories = new Set(ALL_CATEGORIES);
    filtersBar.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
      chk.checked = true;
    });
    renderSemanticSummary();
    renderSideBySideLines();
  });

  btnClearAllCats.addEventListener('click', () => {
    activeCategories.clear();
    filtersBar.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
      chk.checked = false;
    });
    renderSemanticSummary();
    renderSideBySideLines();
  });

  function showStatus(text, type, showCancel, showLog) {
    if (!text) {
      statusBanner.classList.add('hidden');
      return;
    }
    statusBanner.classList.remove('hidden', 'status-info', 'status-error');
    statusBanner.classList.add(type === 'error' ? 'status-error' : 'status-info');
    statusBannerText.textContent = text;
    btnBannerCancel.classList.toggle('hidden', !showCancel);
    btnOpenLog.classList.toggle('hidden', !showLog);
  }

  // Messages from Extension Host
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || !message.command) {
      return;
    }

    switch (message.command) {
      case 'setLoading': {
        const isLoading = Boolean(message.loading);
        btnCancelDiff.classList.toggle('hidden', !isLoading);
        if (isLoading) {
          showStatus(message.message || 'Processando comparação...', 'info', true, false);
        } else if (!statusBanner.classList.contains('status-error')) {
          showStatus('', 'info', false, false);
        }
        break;
      }

      case 'diffCancelled': {
        btnCancelDiff.classList.add('hidden');
        showStatus('Comparação cancelada pelo usuário.', 'info', false, false);
        break;
      }

      case 'showError': {
        btnCancelDiff.classList.add('hidden');
        showStatus(message.message || 'Falha ao comparar relatórios.', 'error', false, true);
        break;
      }

      case 'renderDiff': {
        showStatus('', 'info', false, false);
        currentDiffResult = message.result;
        badgeOriginA.textContent =
          message.leftOrigin === 'server' ? 'JASPERSERVER (A)' : 'LOCAL (A)';
        badgeOriginB.textContent =
          message.rightOrigin === 'server' ? 'JASPERSERVER (B)' : 'LOCAL (B)';

        if (message.options) {
          chkIgnoreWhitespace.checked = Boolean(message.options.ignoreWhitespace);
          chkIgnoreUUID.checked = Boolean(message.options.ignoreUUID);
          chkSemanticDiff.checked =
            message.options.semanticQueryDiff !== undefined
              ? Boolean(message.options.semanticQueryDiff)
              : true;
        }

        renderAll();
        break;
      }
    }
  });

  // Notify extension that WebView is ready
  vscode.postMessage({ command: 'ready' });
})();
