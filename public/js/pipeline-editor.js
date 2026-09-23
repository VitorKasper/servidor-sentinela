/**
 * Editor visual do pipeline de um Workspace.
 *
 * Monta a mesma estrutura que o sentinela.yml descreve: um bloco de setup
 * compartilhado e uma lista de terminais, cada um com suas etapas próprias.
 * O YAML exibido é gerado pelo servidor ao salvar, para que a UI e o arquivo
 * versionado nunca divirjam de formato.
 */
(function () {
  const estado = window.PIPELINE_STATE;
  if (!estado) return;

  const definicao = estado.definition;
  definicao.setup = definicao.setup || [];
  definicao.terminals = definicao.terminals || [];

  const elSetup = document.getElementById('setupSteps');
  const elSetupVazio = document.getElementById('setupVazio');
  const elTerminais = document.getElementById('terminalsList');
  const elTerminaisVazio = document.getElementById('terminaisVazio');
  const elYaml = document.getElementById('yamlBox');
  const elMsg = document.getElementById('pipelineMsg');

  const somenteLeitura = estado.readOnly === true;

  function campo(label, valor, placeholder, aoMudar, largura) {
    const wrap = document.createElement('div');
    wrap.className = 'form-group';
    wrap.style.margin = '0';
    if (largura) wrap.style.flex = largura;

    const lab = document.createElement('label');
    lab.className = 'form-label';
    lab.style.fontSize = '0.78rem';
    lab.textContent = label;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    input.value = valor === null || valor === undefined ? '' : String(valor);
    input.placeholder = placeholder || '';
    input.disabled = somenteLeitura;
    input.addEventListener('input', () => aoMudar(input.value));

    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }

  function botaoRemover(aoClicar) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm';
    btn.textContent = 'Remover';
    btn.disabled = somenteLeitura;
    btn.addEventListener('click', aoClicar);
    return btn;
  }

  function linhaEtapa(step, aoRemover) {
    const linha = document.createElement('div');
    linha.style.cssText = 'display: flex; gap: 10px; align-items: flex-end; margin-bottom: 10px;';

    linha.appendChild(campo('Nome', step.name, 'install', v => { step.name = v; }, '0 0 160px'));
    linha.appendChild(campo('Comando', step.run, 'npm install', v => { step.run = v; }, '1 1 auto'));
    linha.appendChild(campo('Subpasta (opcional)', step.cwd, 'backend', v => { step.cwd = v || null; }, '0 0 150px'));

    const acao = document.createElement('div');
    acao.appendChild(botaoRemover(aoRemover));
    linha.appendChild(acao);

    return linha;
  }

  function renderSetup() {
    elSetup.innerHTML = '';
    definicao.setup.forEach((step, i) => {
      elSetup.appendChild(linhaEtapa(step, () => {
        definicao.setup.splice(i, 1);
        renderSetup();
      }));
    });
    elSetupVazio.style.display = definicao.setup.length === 0 ? 'block' : 'none';
  }

  function renderTerminais() {
    elTerminais.innerHTML = '';

    definicao.terminals.forEach((terminal, indice) => {
      const bloco = document.createElement('div');
      bloco.style.cssText = 'border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 16px; margin-bottom: 16px;';

      const topo = document.createElement('div');
      topo.style.cssText = 'display: flex; gap: 10px; align-items: flex-end; margin-bottom: 12px;';
      topo.appendChild(campo('Chave *', terminal.key, 'api', v => { terminal.key = v; }, '0 0 140px'));
      topo.appendChild(campo('Nome', terminal.name, 'API', v => { terminal.name = v; }, '1 1 auto'));
      topo.appendChild(campo('Porta', terminal.port, '3000', v => { terminal.port = v ? parseInt(v, 10) : null; }, '0 0 90px'));
      topo.appendChild(campo('Stack', terminal.type, 'NODEJS', v => { terminal.type = v; }, '0 0 110px'));

      const acao = document.createElement('div');
      acao.appendChild(botaoRemover(() => {
        definicao.terminals.splice(indice, 1);
        renderTerminais();
      }));
      topo.appendChild(acao);
      bloco.appendChild(topo);

      const linhaStart = document.createElement('div');
      linhaStart.style.cssText = 'display: flex; gap: 10px; margin-bottom: 14px;';
      linhaStart.appendChild(campo('Comando de execução *', terminal.start, 'npm run start:api', v => { terminal.start = v; }, '1 1 auto'));
      bloco.appendChild(linhaStart);

      const cabecalhoEtapas = document.createElement('div');
      cabecalhoEtapas.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
      const titulo = document.createElement('div');
      titulo.style.cssText = 'font-size: 0.82rem; color: var(--text-muted);';
      titulo.textContent = 'Etapas próprias — re-executadas quando este terminal é resetado sozinho';
      cabecalhoEtapas.appendChild(titulo);

      const btnAddStep = document.createElement('button');
      btnAddStep.type = 'button';
      btnAddStep.className = 'btn btn-secondary btn-sm';
      btnAddStep.textContent = '+ Etapa';
      btnAddStep.disabled = somenteLeitura;
      btnAddStep.addEventListener('click', () => {
        terminal.steps = terminal.steps || [];
        terminal.steps.push({ name: '', run: '', cwd: null });
        renderTerminais();
      });
      cabecalhoEtapas.appendChild(btnAddStep);
      bloco.appendChild(cabecalhoEtapas);

      terminal.steps = terminal.steps || [];
      terminal.steps.forEach((step, i) => {
        bloco.appendChild(linhaEtapa(step, () => {
          terminal.steps.splice(i, 1);
          renderTerminais();
        }));
      });

      elTerminais.appendChild(bloco);
    });

    elTerminaisVazio.style.display = definicao.terminals.length === 0 ? 'block' : 'none';
  }

  function mostrarMensagem(texto, erro) {
    elMsg.innerHTML = '';
    if (!texto) return;
    const box = document.createElement('div');
    box.className = 'card';
    box.style.borderLeft = `3px solid ${erro ? 'var(--accent-red, #e5484d)' : 'var(--accent-cyan)'}`;
    const body = document.createElement('div');
    body.className = 'card-body';
    body.textContent = texto;
    box.appendChild(body);
    elMsg.appendChild(box);
  }

  const btnAddSetup = document.querySelector('[data-add-setup]');
  if (btnAddSetup) {
    btnAddSetup.disabled = somenteLeitura;
    btnAddSetup.addEventListener('click', () => {
      definicao.setup.push({ name: '', run: '', cwd: null });
      renderSetup();
    });
  }

  const btnAddTerminal = document.querySelector('[data-add-terminal]');
  if (btnAddTerminal) {
    btnAddTerminal.disabled = somenteLeitura;
    btnAddTerminal.addEventListener('click', () => {
      definicao.terminals.push({ key: '', name: '', port: null, type: 'NODEJS', cwd: null, steps: [], start: '', env: null });
      renderTerminais();
    });
  }

  // Modo avançado: edita o YAML direto, que passa a ser a fonte enviada ao servidor.
  let modoYaml = false;
  const btnToggleYaml = document.querySelector('[data-toggle-yaml]');
  if (btnToggleYaml) {
    btnToggleYaml.disabled = somenteLeitura;
    btnToggleYaml.addEventListener('click', () => {
      modoYaml = !modoYaml;
      elYaml.readOnly = !modoYaml;
      btnToggleYaml.textContent = modoYaml ? 'Voltar ao editor visual' : 'Editar como YAML';
      document.getElementById('pipelineEditor').querySelectorAll('.card').forEach((card, i) => {
        if (i < 2) card.style.opacity = modoYaml ? '0.45' : '1';
      });
      mostrarMensagem(
        modoYaml ? 'Modo YAML ativo: o conteúdo do campo abaixo é o que será salvo.' : '',
        false
      );
    });
  }

  const btnSalvar = document.getElementById('btnSalvarPipeline');
  if (btnSalvar) {
    btnSalvar.addEventListener('click', async () => {
      btnSalvar.disabled = true;
      mostrarMensagem('Salvando...', false);

      const corpo = modoYaml
        ? { yaml: elYaml.value }
        : { setup: definicao.setup, terminals: definicao.terminals };

      try {
        const resposta = await fetch(`/workspaces/${estado.workspaceId}/pipeline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo)
        });
        const dados = await resposta.json();

        if (dados.success) {
          elYaml.value = dados.yaml;
          mostrarMensagem(dados.message, false);
        } else {
          mostrarMensagem(dados.error, true);
        }
      } catch (err) {
        mostrarMensagem(`Falha ao salvar: ${err.message}`, true);
      } finally {
        btnSalvar.disabled = false;
      }
    });
  }

  renderSetup();
  renderTerminais();
})();
