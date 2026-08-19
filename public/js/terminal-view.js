/**
 * Gerenciador de visualização de terminal e logs em tempo real
 */
document.addEventListener('DOMContentLoaded', () => {
  const terminalScreen = document.getElementById('terminalScreen');
  const projectIdEl = document.getElementById('projectIdHolder');
  if (!terminalScreen || !projectIdEl) return;

  const projectId = parseInt(projectIdEl.value, 10);
  let autoScroll = true;

  // Entra na sala do projeto no Socket.IO
  socket.emit('join_project', projectId);

  // Função para formatar e colorir linha de log
  function createLogLineElement(text) {
    const div = document.createElement('div');
    div.className = 'terminal-line';

    if (text.includes('[ERR]') || text.includes('[STDERR]') || text.includes('Falha') || text.includes('Erro')) {
      div.classList.add('error');
    } else if (text.includes('[Cmd Sucesso]') || text.includes('sucesso') || text.includes('Online')) {
      div.classList.add('success');
    } else if (text.includes('[Sentinela]') || text.includes('[Git]') || text.includes('[Deploy]')) {
      div.classList.add('system');
    } else {
      div.classList.add('info');
    }

    div.textContent = text;
    return div;
  }

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
    const buttons = document.querySelectorAll('.process-action-btn');
    buttons.forEach(btn => btn.disabled = true);

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
        buttons.forEach(btn => btn.disabled = false);
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
});
