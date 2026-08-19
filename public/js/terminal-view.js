/**
 * Gerenciador de visualização de terminal, status de deploy e rollback em tempo real
 */
document.addEventListener('DOMContentLoaded', () => {
  const terminalScreen = document.getElementById('terminalScreen');
  const projectIdEl = document.getElementById('projectIdHolder');
  if (!terminalScreen || !projectIdEl) return;

  const projectId = parseInt(projectIdEl.value, 10);
  let autoScroll = true;

  const deployingBanner = document.getElementById('deployingBanner');
  const actionButtons = document.querySelectorAll('.process-action-btn');

  // Entra na sala do projeto no Socket.IO
  socket.emit('join_project', projectId);

  // Função para formatar e colorir linha de log
  function createLogLineElement(text) {
    const div = document.createElement('div');
    div.className = 'terminal-line';

    if (text.includes('[ERR]') || text.includes('[STDERR]') || text.includes('Falha') || text.includes('Erro')) {
      div.classList.add('error');
    } else if (text.includes('[Cmd Sucesso]') || text.includes('sucesso') || text.includes('Online') || text.includes('[Rollback Sucesso]') || text.includes('[Restauração Sucesso]')) {
      div.classList.add('success');
    } else if (text.includes('[Sentinela]') || text.includes('[Git]') || text.includes('[Deploy]') || text.includes('[AutoSync]') || text.includes('[Rollback]') || text.includes('[Restauração]')) {
      div.classList.add('system');
    } else {
      div.classList.add('info');
    }

    div.textContent = text;
    return div;
  }

  // Atualização de Status em tempo real no Terminal
  socket.on('project_status', (data) => {
    if (parseInt(data.projectId, 10) === projectId) {
      if (data.status === 'BUILDING') {
        if (deployingBanner) deployingBanner.style.display = 'flex';
        actionButtons.forEach(btn => btn.disabled = true);
      } else {
        if (deployingBanner) deployingBanner.style.display = 'none';
        actionButtons.forEach(btn => btn.disabled = false);
        // Atualiza a lista de commits quando terminar o deploy
        loadCommits();
      }
    }
  });

  // Recebimento de novo log via Socket.IO
  socket.on('project_log', (data) => {
    if (parseInt(data.projectId, 10) === projectId) {
      const lineEl = createLogLineElement(data.message);
      terminalScreen.appendChild(lineEl);

      if (autoScroll) {
        terminalScreen.scrollTop = terminalScreen.scrollHeight;
      }
    }
  });

  // Limpeza de logs
  socket.on('project_logs_cleared', (data) => {
    if (parseInt(data.projectId, 10) === projectId) {
      terminalScreen.innerHTML = '<div class="terminal-line system">[Sentinela] Logs limpos.</div>';
    }
  });

  // Scroll inicial para o final
  terminalScreen.scrollTop = terminalScreen.scrollHeight;

  // Botão Limpar Logs
  const btnClearLogs = document.getElementById('btnClearLogs');
  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', async () => {
      try {
        await fetch(`/projects/${projectId}/clear-logs`, { method: 'POST' });
        terminalScreen.innerHTML = '';
      } catch (err) {
        console.error('Erro ao limpar logs:', err);
      }
    });
  }

  // Botão Copiar Logs
  const btnCopyLogs = document.getElementById('btnCopyLogs');
  if (btnCopyLogs) {
    btnCopyLogs.addEventListener('click', () => {
      const text = terminalScreen.innerText;
      navigator.clipboard.writeText(text).then(() => {
        const originalText = btnCopyLogs.innerText;
        btnCopyLogs.innerText = 'Copiado!';
        setTimeout(() => { btnCopyLogs.innerText = originalText; }, 2000);
      });
    });
  }

  // Ações de Processo: Start, Stop, Restart, Re-Deploy
  async function triggerProcessAction(endpoint, actionName) {
    actionButtons.forEach(btn => btn.disabled = true);

    try {
      const response = await fetch(`/projects/${projectId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (!data.success) {
        alert(`Erro ao executar ${actionName}: ${data.error || 'Erro desconhecido'}`);
      }
    } catch (err) {
      alert(`Falha na comunicação com o servidor ao executar ${actionName}.`);
      console.error(err);
    } finally {
      setTimeout(() => {
        actionButtons.forEach(btn => btn.disabled = false);
      }, 800);
    }
  }

  const btnStart = document.getElementById('btnStartProject');
  const btnStop = document.getElementById('btnStopProject');
  const btnRestart = document.getElementById('btnRestartProject');
  const btnRedeploy = document.getElementById('btnRedeployProject');

  if (btnStart) btnStart.addEventListener('click', () => triggerProcessAction('start', 'Iniciar'));
  if (btnStop) btnStop.addEventListener('click', () => triggerProcessAction('stop', 'Parar'));
  if (btnRestart) btnRestart.addEventListener('click', () => triggerProcessAction('restart', 'Reiniciar'));
  if (btnRedeploy) {
    btnRedeploy.addEventListener('click', () => {
      if (confirm('Deseja realizar o Re-Deploy? Isso fará um git pull, reinstalará as dependências e reiniciará a aplicação.')) {
        triggerProcessAction('redeploy', 'Re-Deploy');
      }
    });
  }

  // Histórico de Commits e Rollback
  function attachRollbackListeners() {
    const rollbackButtons = document.querySelectorAll('.btn-rollback-action');
    rollbackButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const hash = btn.getAttribute('data-commit-hash');
        const shortHash = hash.slice(0, 7);
        if (confirm(`Deseja reverter a aplicação para a versão #${shortHash}?\n\nO Sentinela fará o checkout no Git, reinstalará as dependências e iniciará a aplicação nessa versão.`)) {
          try {
            if (deployingBanner) deployingBanner.style.display = 'flex';
            actionButtons.forEach(b => b.disabled = true);

            const res = await fetch(`/projects/${projectId}/rollback/${hash}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
            const result = await res.json();
            if (!result.success) {
              alert(`Falha ao reverter versão: ${result.error}`);
            }
          } catch (err) {
            console.error('Erro ao acionar rollback:', err);
            alert('Erro de comunicação ao acionar rollback.');
          }
        }
      });
    });
  }

  // Restauração para a branch principal
  const btnRestoreLatestBranch = document.getElementById('btnRestoreLatestBranch');
  if (btnRestoreLatestBranch) {
    btnRestoreLatestBranch.addEventListener('click', async () => {
      if (confirm('Deseja retornar para a versão mais recente da branch principal no GitHub?')) {
        try {
          if (deployingBanner) deployingBanner.style.display = 'flex';
          actionButtons.forEach(b => b.disabled = true);

          const res = await fetch(`/projects/${projectId}/restore-branch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          const result = await res.json();
          if (!result.success) {
            alert(`Falha ao restaurar branch: ${result.error}`);
          }
        } catch (err) {
          console.error('Erro ao restaurar branch:', err);
          alert('Erro de comunicação ao restaurar branch.');
        }
      }
    });
  }

  // Atualiza timeline de commits via AJAX
  async function loadCommits() {
    try {
      const res = await fetch(`/projects/${projectId}/commits`);
      const data = await res.json();
      if (data.success && data.commits && data.commits.length > 0) {
        const container = document.querySelector('.card-body .commit-timeline');
        if (container) {
          container.innerHTML = data.commits.map(commit => `
            <div class="commit-item ${commit.isCurrent ? 'commit-current' : ''}">
              <div class="commit-header">
                <code class="commit-sha">#${commit.shortHash}</code>
                ${commit.isCurrent 
                  ? '<span class="badge-active-version">● Versão Ativa</span>' 
                  : `<button type="button" class="btn-rollback-action" data-commit-hash="${commit.hash}" title="Voltar para esta versão">⏪ Voltar</button>`
                }
              </div>
              <div class="commit-message" title="${commit.message}">${commit.message}</div>
              <div class="commit-meta">
                <span>${commit.author}</span> &bull;
                <span>${new Date(commit.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          `).join('');
          attachRollbackListeners();
        }
      }
    } catch (err) {
      console.error('Erro ao atualizar commits:', err);
    }
  }

  attachRollbackListeners();
});
