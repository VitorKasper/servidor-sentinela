/**
 * Terminal administrativo do host: streaming via Server-Sent Events + execução de comandos em lote
 */
document.addEventListener('DOMContentLoaded', () => {
  const terminalScreen = document.getElementById('terminalScreen');
  const terminalForm = document.getElementById('terminalForm');
  const terminalInput = document.getElementById('terminalInput');
  const btnRunCommand = document.getElementById('btnRunCommand');
  const btnClearTerminal = document.getElementById('btnClearTerminal');
  const btnKillShell = document.getElementById('btnKillShell');
  const statusBadge = document.getElementById('terminalStatusBadge');

  if (!terminalScreen || !terminalForm) return;

  let autoScroll = true;
  let running = false;

  function setStatus(text, color) {
    if (!statusBadge) return;
    statusBadge.textContent = text;
    statusBadge.style.color = color;
    statusBadge.style.borderColor = color;
  }

  function appendLine(text, cssClass) {
    const div = document.createElement('div');
    div.className = `terminal-line ${cssClass}`;
    div.textContent = text;
    terminalScreen.appendChild(div);
    if (autoScroll) terminalScreen.scrollTop = terminalScreen.scrollHeight;
  }

  function setRunning(isRunning) {
    running = isRunning;
    btnRunCommand.disabled = isRunning;
    btnRunCommand.textContent = isRunning ? 'Executando...' : '▶ Executar';
  }

  // Conexão de streaming (SSE)
  const evtSource = new EventSource('/terminal/stream');

  evtSource.addEventListener('connected', () => {
    setStatus('conectado', '#4ade80');
  });

  evtSource.addEventListener('echo', (event) => {
    const data = JSON.parse(event.data);
    appendLine(`> ${data.line}`, 'info');
  });

  evtSource.addEventListener('output', (event) => {
    const data = JSON.parse(event.data);
    appendLine(data.line, data.stream === 'stderr' ? 'error' : '');
  });

  evtSource.addEventListener('done', () => {
    setRunning(false);
  });

  evtSource.addEventListener('closed', () => {
    setStatus('shell encerrado', '#f87171');
    appendLine('[Sentinela] Shell encerrado.', 'system');
    setRunning(false);
  });

  evtSource.onerror = () => {
    setStatus('desconectado', '#f87171');
  };

  // Envio de comandos
  terminalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const commands = terminalInput.value;
    if (!commands.trim() || running) return;

    setRunning(true);

    try {
      const res = await fetch('/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands })
      });
      const data = await res.json();
      if (!data.success) {
        appendLine(`[Sentinela] Erro: ${data.error || 'Falha ao executar comando.'}`, 'error');
        setRunning(false);
        return;
      }
      terminalInput.value = '';
    } catch (err) {
      appendLine(`[Sentinela] Falha de comunicação com o servidor: ${err.message}`, 'error');
      setRunning(false);
    }
  });

  // Ctrl+Enter (ou Cmd+Enter) executa o formulário a partir da textarea
  terminalInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      terminalForm.requestSubmit();
    }
  });

  if (btnClearTerminal) {
    btnClearTerminal.addEventListener('click', () => {
      terminalScreen.innerHTML = '';
    });
  }

  if (btnKillShell) {
    btnKillShell.addEventListener('click', async () => {
      if (!confirm('Isso encerra o shell atual (perdendo o diretório atual navegado) e abre um novo. Continuar?')) return;
      try {
        await fetch('/terminal/kill', { method: 'POST' });
        appendLine('[Sentinela] Solicitação de reinício do shell enviada.', 'system');
        setRunning(false);
      } catch (err) {
        appendLine(`[Sentinela] Erro ao reiniciar shell: ${err.message}`, 'error');
      }
    });
  }

  terminalScreen.addEventListener('scroll', () => {
    const atBottom = terminalScreen.scrollHeight - terminalScreen.scrollTop - terminalScreen.clientHeight < 30;
    autoScroll = atBottom;
  });
});
