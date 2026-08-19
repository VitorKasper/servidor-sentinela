document.addEventListener('DOMContentLoaded', () => {
  const projectIdHolder = document.getElementById('projectIdHolder');
  if (!projectIdHolder) return;

  const projectId = projectIdHolder.value;
  let currentRawContent = '';
  let activeRelativePath = document.getElementById('initialSelectedFile') ? document.getElementById('initialSelectedFile').value : '';

  // Histórico de navegação interno
  const historyStack = [];
  let historyIndex = -1;

  if (activeRelativePath) {
    historyStack.push(activeRelativePath);
    historyIndex = 0;
  }

  // Elementos do DOM
  const tableRows = document.querySelectorAll('.win-file-row');
  const searchInput = document.getElementById('readmeSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const noMatchMsg = document.getElementById('noMatchMessage');
  const activeCrumbFile = document.getElementById('activeCrumbFile');
  const fileCountBadge = document.getElementById('fileCountBadge');

  const readerCurrentFileName = document.getElementById('readerCurrentFileName');
  const readerCurrentPath = document.getElementById('readerCurrentPath');
  const statReadingTime = document.getElementById('statReadingTime');
  const statWordCount = document.getElementById('statWordCount');
  const statLineCount = document.getElementById('statLineCount');
  const statFileSize = document.getElementById('statFileSize');

  const btnViewRendered = document.getElementById('btnViewRendered');
  const btnViewRaw = document.getElementById('btnViewRaw');
  const btnCopyReadme = document.getElementById('btnCopyReadme');
  const copyReadmeText = document.getElementById('copyReadmeText');

  const markdownRenderedView = document.getElementById('markdownRenderedView');
  const markdownRawView = document.getElementById('markdownRawView');
  const rawContentPre = document.getElementById('rawContentPre');
  const readerLoadingOverlay = document.getElementById('readerLoadingOverlay');

  const readerTocBar = document.getElementById('readerTocBar');
  const tocPillsContainer = document.getElementById('tocPillsContainer');

  const winNavBack = document.getElementById('winNavBack');
  const winNavForward = document.getElementById('winNavForward');
  const winNavRefresh = document.getElementById('winNavRefresh');

  // Inicializa conteúdo raw inicial se presente
  if (rawContentPre && rawContentPre.querySelector('code')) {
    currentRawContent = rawContentPre.querySelector('code').textContent;
  }

  /**
   * Atualiza o estado dos botões de voltar/avançar da barra do Windows Explorer
   */
  function updateNavButtons() {
    if (winNavBack) winNavBack.disabled = historyIndex <= 0;
    if (winNavForward) winNavForward.disabled = historyIndex >= historyStack.length - 1;
  }

  /**
   * Carrega um README específico do servidor via API JSON
   */
  async function loadReadmeFile(relativePath, pushHistory = true) {
    if (!relativePath) return;

    if (readerLoadingOverlay) readerLoadingOverlay.style.display = 'flex';

    try {
      const response = await fetch(`/projects/${projectId}/readme/content?file=${encodeURIComponent(relativePath)}`);
      const data = await response.json();

      if (!data.success) {
        alert(data.error || 'Erro ao carregar o arquivo README.');
        if (readerLoadingOverlay) readerLoadingOverlay.style.display = 'none';
        return;
      }

      const info = data.data;
      activeRelativePath = info.selectedFile.relativePath;
      currentRawContent = info.rawContent;

      // Atualiza linha ativa na tabela do Windows Explorer
      tableRows.forEach(row => {
        if (row.dataset.relativePath === activeRelativePath) {
          row.classList.add('active-row');
          row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          row.classList.remove('active-row');
        }
      });

      // Atualiza barra de navegação / Breadcrumb
      if (activeCrumbFile) {
        activeCrumbFile.textContent = activeRelativePath;
      }

      // Atualiza cabeçalho do leitor
      if (readerCurrentFileName) readerCurrentFileName.textContent = info.selectedFile.name;
      if (readerCurrentPath) readerCurrentPath.textContent = info.selectedFile.relativePath;
      if (statReadingTime) statReadingTime.textContent = `⏱️ ~${info.stats.readingTimeMinutes || 1} min de leitura`;
      if (statWordCount) statWordCount.textContent = `📝 ${info.stats.wordCount || 0} palavras`;
      if (statLineCount) statLineCount.textContent = `📏 ${info.stats.lineCount || 0} linhas`;
      if (statFileSize) statFileSize.textContent = `💾 ${info.selectedFile.sizeFormatted}`;

      // Atualiza containers de visualização
      if (markdownRenderedView) markdownRenderedView.innerHTML = info.htmlContent;
      if (rawContentPre && rawContentPre.querySelector('code')) {
        rawContentPre.querySelector('code').textContent = info.rawContent;
      }

      // Atualiza Sumário (Table of Contents)
      if (info.headings && info.headings.length > 0) {
        if (readerTocBar) readerTocBar.style.display = 'flex';
        if (tocPillsContainer) {
          tocPillsContainer.innerHTML = '';
          info.headings.slice(0, 8).forEach(h => {
            const a = document.createElement('a');
            a.href = `#${h.id}`;
            a.className = `toc-pill ${h.level === 1 ? 'h1-pill' : (h.level === 2 ? 'h2-pill' : 'h3-pill')}`;
            a.textContent = h.text;
            a.title = h.text;
            tocPillsContainer.appendChild(a);
          });
          if (info.headings.length > 8) {
            const more = document.createElement('span');
            more.className = 'toc-more-pill';
            more.textContent = `+${info.headings.length - 8} seções`;
            tocPillsContainer.appendChild(more);
          }
        }
      } else {
        if (readerTocBar) readerTocBar.style.display = 'none';
      }

      // Atualiza URL no navegador sem recarregar a página
      const newUrl = `${window.location.pathname}?file=${encodeURIComponent(activeRelativePath)}`;
      window.history.replaceState({ file: activeRelativePath }, '', newUrl);

      // Gerencia pilha de navegação
      if (pushHistory) {
        if (historyIndex < historyStack.length - 1) {
          historyStack.splice(historyIndex + 1);
        }
        historyStack.push(activeRelativePath);
        historyIndex = historyStack.length - 1;
        updateNavButtons();
      }

    } catch (err) {
      console.error('[ReadmeView] Erro ao carregar arquivo:', err);
      alert('Falha na comunicação ao tentar carregar o arquivo README.');
    } finally {
      if (readerLoadingOverlay) readerLoadingOverlay.style.display = 'none';
    }
  }

  // Evento de clique em cada linha da tabela do Windows Explorer
  tableRows.forEach(row => {
    row.addEventListener('click', () => {
      const relPath = row.dataset.relativePath;
      if (relPath && relPath !== activeRelativePath) {
        loadReadmeFile(relPath, true);
      }
    });
  });

  // Filtro de Busca Instantâneo na tabela do Windows Explorer
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      let visibleCount = 0;

      if (clearSearchBtn) {
        clearSearchBtn.style.display = query ? 'block' : 'none';
      }

      tableRows.forEach(row => {
        const name = (row.dataset.name || '').toLowerCase();
        const dir = (row.dataset.directory || '').toLowerCase();
        const rel = (row.dataset.relativePath || '').toLowerCase();

        if (name.includes(query) || dir.includes(query) || rel.includes(query)) {
          row.style.display = '';
          visibleCount++;
        } else {
          row.style.display = 'none';
        }
      });

      if (noMatchMsg) {
        noMatchMsg.style.display = visibleCount === 0 ? 'block' : 'none';
      }

      if (fileCountBadge) {
        fileCountBadge.textContent = query
          ? `${visibleCount} de ${tableRows.length} itens`
          : `${tableRows.length} ${tableRows.length === 1 ? 'item' : 'itens'}`;
      }
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
        searchInput.focus();
      }
    });
  }

  // Alternador de Visualização: Interpretado vs Código Fonte
  if (btnViewRendered && btnViewRaw) {
    btnViewRendered.addEventListener('click', () => {
      btnViewRendered.classList.add('active');
      btnViewRaw.classList.remove('active');
      if (markdownRenderedView) markdownRenderedView.style.display = 'block';
      if (markdownRawView) markdownRawView.style.display = 'none';
    });

    btnViewRaw.addEventListener('click', () => {
      btnViewRaw.classList.add('active');
      btnViewRendered.classList.remove('active');
      if (markdownRenderedView) markdownRenderedView.style.display = 'none';
      if (markdownRawView) markdownRawView.style.display = 'block';
    });
  }

  // Botão Copiar Conteúdo
  if (btnCopyReadme) {
    btnCopyReadme.addEventListener('click', async () => {
      if (!currentRawContent) return;

      try {
        await navigator.clipboard.writeText(currentRawContent);
        if (copyReadmeText) copyReadmeText.textContent = 'Copiado! ✓';
        btnCopyReadme.classList.add('btn-success');
        btnCopyReadme.classList.remove('btn-secondary');

        setTimeout(() => {
          if (copyReadmeText) copyReadmeText.textContent = 'Copiar';
          btnCopyReadme.classList.remove('btn-success');
          btnCopyReadme.classList.add('btn-secondary');
        }, 2200);
      } catch (err) {
        console.error('Falha ao copiar:', err);
      }
    });
  }

  // Botões de Navegação do Windows Explorer
  if (winNavBack) {
    winNavBack.addEventListener('click', () => {
      if (historyIndex > 0) {
        historyIndex--;
        loadReadmeFile(historyStack[historyIndex], false);
        updateNavButtons();
      }
    });
  }

  if (winNavForward) {
    winNavForward.addEventListener('click', () => {
      if (historyIndex < historyStack.length - 1) {
        historyIndex++;
        loadReadmeFile(historyStack[historyIndex], false);
        updateNavButtons();
      }
    });
  }

  if (winNavRefresh) {
    winNavRefresh.addEventListener('click', () => {
      loadReadmeFile(activeRelativePath, false);
    });
  }

  updateNavButtons();
});
