const fs = require('fs');
const path = require('path');
const { Workspace, Project, DeploymentLog } = require('../models');
const gitService = require('./gitService');
const pipelineService = require('./pipelineService');
const processManager = require('./processManager');

/**
 * Locks em memória por workspace.
 *
 * A pasta do workspace é compartilhada por todos os terminais, então git pull e
 * as etapas de 'setup' nunca podem rodar em paralelo — nem entre si, nem com um
 * reset de terminal. Enquanto o lock existe, o reset individual é recusado com
 * mensagem explícita em vez de corromper node_modules concorrentemente.
 */
const workspaceLocks = new Map();

function isWorkspaceLocked(workspaceId) {
  return workspaceLocks.has(Number(workspaceId));
}

async function withWorkspaceLock(workspaceId, tarefa) {
  const id = Number(workspaceId);
  if (workspaceLocks.has(id)) {
    // Já existe um deploy em andamento: aguarda o anterior em vez de duplicar o trabalho.
    await workspaceLocks.get(id).catch(() => {});
    return { skipped: true };
  }

  const execucao = (async () => tarefa())();
  workspaceLocks.set(id, execucao);
  try {
    return await execucao;
  } finally {
    workspaceLocks.delete(id);
  }
}

/**
 * Gera um slug único para um Project criado a partir de um terminal do pipeline
 */
async function buildUniqueSlug(workspaceName, terminalKey) {
  const base = `${workspaceName}-${terminalKey}`
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');

  let slug = base;
  let contador = 1;
  while (await Project.findOne({ where: { slug } })) {
    slug = `${base}-${contador}`;
    contador++;
  }
  return slug;
}

/**
 * Descobre qual definição de pipeline vale para este workspace.
 *
 * Precedência: o sentinela.yml versionado no repositório é a autoridade. Sem ele,
 * vale a definição cadastrada pela UI. Sem nenhuma das duas, sintetiza uma a partir
 * da configuração legada do workspace e persiste, para que workspaces antigos passem
 * a ter um pipeline editável sem intervenção manual.
 */
async function loadDefinition(workspace, workspaceDir, log) {
  const arquivoRepo = pipelineService.findRepoPipelineFile(workspaceDir);

  if (arquivoRepo) {
    log(`[Pipeline] Usando a definição versionada no repositório: ${path.basename(arquivoRepo)}`);
    const conteudo = fs.readFileSync(arquivoRepo, 'utf-8');
    return { def: pipelineService.parseDefinition(conteudo), source: 'REPO' };
  }

  if (workspace.pipelineDefinition && workspace.pipelineDefinition.trim()) {
    log('[Pipeline] Nenhum sentinela.yml no repositório. Usando a definição cadastrada na interface.');
    return { def: pipelineService.parseDefinition(workspace.pipelineDefinition), source: 'UI' };
  }

  log('[Pipeline] Nenhuma definição encontrada. Gerando um pipeline a partir da configuração atual do workspace...');
  const projetos = workspace.projects || await Project.findAll({ where: { workspaceId: workspace.id } });
  const def = pipelineService.synthesizeFromLegacy(workspace, projetos.map(p => (p.toJSON ? p.toJSON() : p)));

  workspace.pipelineDefinition = pipelineService.serializeDefinition(def);
  await workspace.save();
  log('[Pipeline] Pipeline gerado e salvo. A partir de agora ele pode ser editado na interface do workspace.');

  return { def, source: 'UI' };
}

/**
 * Aplica no banco o plano de reconciliação entre os terminais do pipeline e os Projects.
 * O Project continua sendo o terminal (id, logs, porta, status); o pipeline passa a ser
 * a autoridade sobre nome, porta, comando de start e etapas próprias.
 */
async function reconcile(workspace, def, io, log) {
  const existentes = await Project.findAll({ where: { workspaceId: workspace.id } });
  const plano = pipelineService.planReconciliation(
    def,
    existentes.map(p => ({ id: p.id, pipelineKey: p.pipelineKey, slug: p.slug }))
  );
  const porId = new Map(existentes.map(p => [p.id, p]));

  for (const { projectId, terminal } of plano.update) {
    const proj = porId.get(projectId);
    proj.pipelineKey = terminal.key;
    proj.name = terminal.name;
    proj.port = terminal.port;
    proj.projectType = terminal.type;
    proj.startCommand = terminal.start;
    proj.pipelineSteps = JSON.stringify(terminal.steps);
    if (terminal.env) proj.envVars = terminal.env;
    if (proj.status === 'ORPHANED') proj.status = 'STOPPED';
    await proj.save();
  }

  for (const terminal of plano.create) {
    const slug = await buildUniqueSlug(workspace.name, terminal.key);
    const criado = await Project.create({
      workspaceId: workspace.id,
      pipelineKey: terminal.key,
      pipelineSteps: JSON.stringify(terminal.steps),
      name: terminal.name,
      slug,
      projectType: terminal.type,
      repoUrl: workspace.repoUrl,
      branch: workspace.branch,
      gitToken: workspace.gitToken,
      startCommand: terminal.start,
      envVars: terminal.env || workspace.envVars,
      port: terminal.port,
      autoRestart: workspace.autoRestart,
      autoSync: workspace.autoSync,
      ignoreSsl: workspace.ignoreSsl,
      status: 'BUILDING'
    });
    log(`[Pipeline] Novo terminal '${terminal.key}' criado a partir da definição.`);
    porId.set(criado.id, criado);
  }

  for (const orfao of plano.orphan) {
    const proj = porId.get(orfao.id);
    if (!proj) continue;
    log(`[Pipeline] O terminal '${proj.pipelineKey || proj.slug}' não existe mais na definição. Processo parado e marcado como órfão (nada foi excluído).`);
    await processManager.stopProject(proj.id, io).catch(() => {});
    proj.status = 'ORPHANED';
    proj.pid = null;
    await proj.save();
    if (io) io.emit('project_status', { projectId: proj.id, status: 'ORPHANED', pid: null });
  }

  // Devolve os projetos ativos na ordem em que os terminais aparecem na definição
  const ativos = await Project.findAll({ where: { workspaceId: workspace.id } });
  const porKey = new Map(ativos.map(p => [p.pipelineKey, p]));
  return def.terminals.map(t => porKey.get(t.key)).filter(Boolean);
}

/**
 * Executa a lista de etapas de um terminal (ou do setup) no diretório do workspace
 */
async function runSteps(steps, workspaceDir, env, logTarget, ignoreSsl, io, rotulo) {
  for (const step of steps) {
    const cwd = step.cwd ? path.join(workspaceDir, step.cwd) : workspaceDir;
    if (!fs.existsSync(cwd)) {
      throw new Error(`${rotulo}: diretório '${step.cwd}' não existe no repositório.`);
    }
    const comando = processManager.formatCommandWithSslBypass(step.run, ignoreSsl);
    processManager.appendLog(logTarget, `${rotulo} → ${step.name}`, io);
    await processManager.runCommand(comando, cwd, env, logTarget, io);
  }
}

/**
 * Deploy completo do workspace pelo pipeline:
 * git pull → reconciliação → setup (uma única vez) → etapas e start de cada terminal.
 */
async function runPipeline(workspaceId, io = null) {
  return withWorkspaceLock(workspaceId, async () => {
    const workspace = await Workspace.findByPk(workspaceId, {
      include: [{ model: Project, as: 'projects' }]
    });
    if (!workspace) throw new Error('Workspace não encontrado');

    // Alvo de log inicial: todos os terminais conhecidos até agora.
    let logTarget = (workspace.projects || []).map(p => p.id);
    const log = (msg) => processManager.appendLog(logTarget, msg, io);

    for (const proj of workspace.projects || []) {
      proj.status = 'BUILDING';
      await proj.save();
      if (io) io.emit('project_status', { projectId: proj.id, status: 'BUILDING', pid: null });
    }

    log('=====================================================');
    log(`[Pipeline] Iniciando execução do workspace '${workspace.name}'...`);

    try {
      // 1. Para tudo que estiver rodando antes de mexer na pasta compartilhada
      for (const proj of workspace.projects || []) {
        await processManager.stopProject(proj.id, io).catch(() => {});
      }

      // 2. Um único git pull para todo o workspace
      workspace.isWorkspace = true;
      const gitResult = await gitService.cloneOrPull(workspace, log);
      const workspaceDir = gitResult.path;

      // 3. Carrega e valida a definição (definição inválida aborta tudo aqui)
      const { def, source } = await loadDefinition(workspace, workspaceDir, log);
      workspace.pipelineSource = source;
      await workspace.save();

      // 4. Reconcilia os terminais da definição com os Projects
      const terminais = await reconcile(workspace, def, io, log);
      logTarget = terminais.map(p => p.id);

      // 5. Setup — roda UMA vez para todo o workspace
      const envBase = processManager.parseEnvVars(workspace.envVars, null, workspaceDir, workspace.ignoreSsl);
      await processManager.ensurePythonVenv(
        { projectType: def.terminals.map(t => t.type).join(',') },
        workspaceDir,
        envBase,
        logTarget,
        io
      );
      const envSetup = processManager.parseEnvVars(workspace.envVars, null, workspaceDir, workspace.ignoreSsl);

      if (def.setup.length > 0) {
        log(`[Pipeline] Executando ${def.setup.length} etapa(s) de setup compartilhadas (uma única vez para todos os terminais)...`);
        await runSteps(def.setup, workspaceDir, envSetup, logTarget, workspace.ignoreSsl, io, '[setup]');
      } else {
        log('[Pipeline] Nenhuma etapa de setup declarada.');
      }

      // 6. Etapas próprias e start de cada terminal
      const resultados = [];
      for (const terminal of def.terminals) {
        const proj = terminais.find(p => p.pipelineKey === terminal.key);
        if (!proj) continue;
        try {
          await runTerminalSteps(proj, terminal.steps, workspace, workspaceDir, io);
          const res = await processManager.startProject(proj.id, io);
          resultados.push({ projectId: proj.id, name: proj.name, ...res });
        } catch (err) {
          processManager.appendLog(proj.id, `[Pipeline Erro] Terminal '${terminal.key}' falhou: ${err.message}`, io);
          proj.status = 'ERROR';
          await proj.save();
          if (io) io.emit('project_status', { projectId: proj.id, status: 'ERROR', pid: null });
          resultados.push({ projectId: proj.id, name: proj.name, success: false, error: err.message });
        }
      }

      if (gitResult && gitResult.commitHash) {
        workspace.currentCommitHash = gitResult.commitHash;
        workspace.lastCommitHash = gitResult.commitHash;
        workspace.lastDeployedAt = new Date();
        await workspace.save();
      }

      log('[Pipeline] Execução do workspace concluída.');
      log('=====================================================');
      return resultados;
    } catch (error) {
      log(`[Pipeline Erro Crítico] ${error.message}`);
      log('=====================================================');

      const projetos = await Project.findAll({ where: { workspaceId: workspace.id } });
      for (const proj of projetos) {
        if (proj.status === 'ORPHANED') continue;
        proj.status = 'ERROR';
        proj.pid = null;
        await proj.save();
        if (io) io.emit('project_status', { projectId: proj.id, status: 'ERROR', pid: null });
      }
      throw error;
    }
  });
}

/**
 * Executa as etapas próprias de um terminal (o que o reset individual re-roda)
 */
async function runTerminalSteps(project, steps, workspace, workspaceDir, io) {
  if (!steps || steps.length === 0) return;
  const env = processManager.parseEnvVars(project.envVars, project.port, workspaceDir, project.ignoreSsl);
  await runSteps(steps, workspaceDir, env, project.id, project.ignoreSsl, io, `[${project.pipelineKey || project.slug}]`);
}

/**
 * Reset de um único terminal.
 *
 * Re-executa apenas as etapas daquele terminal e o reinicia, reaproveitando o
 * git pull e o setup compartilhado que já foram feitos. Os outros terminais não
 * são tocados.
 */
async function resetTerminal(projectId, io = null) {
  const project = await Project.findByPk(projectId, {
    include: [{ model: Workspace, as: 'workspace' }]
  });
  if (!project) throw new Error('Projeto não encontrado');
  if (!project.workspaceId || !project.workspace) {
    throw new Error('Este projeto não pertence a um workspace — use o deploy individual.');
  }
  if (project.status === 'ORPHANED') {
    throw new Error('Este terminal não existe mais na definição do pipeline. Atualize o pipeline ou remova o terminal.');
  }

  const workspace = project.workspace;

  if (isWorkspaceLocked(workspace.id)) {
    throw new Error('Há um deploy do workspace em andamento. Aguarde o término antes de resetar um terminal isolado.');
  }

  const workspaceDir = gitService.getProjectPath(project);
  const log = (msg) => processManager.appendLog(project.id, msg, io);

  log('=====================================================');
  log(`[Reset] Resetando apenas o terminal '${project.pipelineKey || project.slug}'. O código e o setup compartilhado do workspace não são refeitos.`);

  project.status = 'BUILDING';
  await project.save();
  if (io) io.emit('project_status', { projectId: project.id, status: 'BUILDING', pid: null });

  try {
    await processManager.stopProject(project.id, io);

    let steps = [];
    if (project.pipelineSteps) {
      try {
        steps = JSON.parse(project.pipelineSteps) || [];
      } catch {
        throw new Error('As etapas deste terminal estão corrompidas. Rode um deploy do workspace para recarregar o pipeline.');
      }
    }

    if (steps.length === 0) {
      log('[Reset] Este terminal não declara etapas próprias — apenas o processo será reiniciado.');
    } else {
      log(`[Reset] Re-executando ${steps.length} etapa(s) próprias deste terminal...`);
      await runTerminalSteps(project, steps, workspace, workspaceDir, io);
    }

    await DeploymentLog.create({
      projectId: project.id,
      action: 'DEPLOY',
      status: 'SUCCESS',
      details: `Reset do terminal '${project.pipelineKey || project.slug}' concluído em ${new Date().toISOString()}`
    });

    log('[Reset] Etapas concluídas. Reiniciando o processo...');
    log('=====================================================');
    return await processManager.startProject(project.id, io);
  } catch (error) {
    log(`[Reset Erro] ${error.message}`);
    log('=====================================================');

    project.status = 'ERROR';
    project.pid = null;
    await project.save();

    await DeploymentLog.create({
      projectId: project.id,
      action: 'DEPLOY',
      status: 'FAILED',
      details: error.message
    });

    if (io) io.emit('project_status', { projectId: project.id, status: 'ERROR', pid: null });
    throw error;
  }
}

/**
 * Devolve a definição efetiva do workspace para exibição/edição na interface,
 * sem executar nada. Informa se a autoridade é o repositório ou a interface.
 */
async function getEffectiveDefinition(workspaceId) {
  const workspace = await Workspace.findByPk(workspaceId, {
    include: [{ model: Project, as: 'projects' }]
  });
  if (!workspace) throw new Error('Workspace não encontrado');

  const workspaceDir = gitService.getWorkspacePath(workspace.slug);
  const arquivoRepo = fs.existsSync(workspaceDir) ? pipelineService.findRepoPipelineFile(workspaceDir) : null;

  if (arquivoRepo) {
    const yamlText = fs.readFileSync(arquivoRepo, 'utf-8');
    let def = null;
    let erro = null;
    try {
      def = pipelineService.parseDefinition(yamlText);
    } catch (e) {
      erro = e.message;
    }
    return { source: 'REPO', readOnly: true, fileName: path.basename(arquivoRepo), yaml: yamlText, def, error: erro };
  }

  const yamlText = workspace.pipelineDefinition || '';
  if (!yamlText.trim()) {
    return { source: 'UI', readOnly: false, fileName: null, yaml: '', def: null, error: null };
  }

  let def = null;
  let erro = null;
  try {
    def = pipelineService.parseDefinition(yamlText);
  } catch (e) {
    erro = e.message;
  }
  return { source: 'UI', readOnly: false, fileName: null, yaml: yamlText, def, error: erro };
}

/**
 * Grava a definição vinda da interface. Valida antes de persistir — um pipeline
 * inválido nunca chega ao banco.
 */
async function saveUiDefinition(workspaceId, def) {
  const workspace = await Workspace.findByPk(workspaceId);
  if (!workspace) throw new Error('Workspace não encontrado');

  const yamlText = pipelineService.serializeDefinition(def);
  pipelineService.parseDefinition(yamlText); // valida o resultado serializado

  workspace.pipelineDefinition = yamlText;
  await workspace.save();
  return yamlText;
}

module.exports = {
  runPipeline,
  resetTerminal,
  getEffectiveDefinition,
  saveUiDefinition,
  isWorkspaceLocked,
  loadDefinition,
  reconcile
};
