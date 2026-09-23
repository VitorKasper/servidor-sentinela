const { Workspace, Project } = require('../models');
const gitService = require('./gitService');
const processManager = require('./processManager');
const pipelineRunner = require('./pipelineRunner');
const pipelineService = require('./pipelineService');

/**
 * Utilitário para gerar slug amigável
 */
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

/**
 * Retorna todos os workspaces com seus projetos agrupados
 */
async function getAllWorkspaces() {
  return await Workspace.findAll({
    include: [{
      model: Project,
      as: 'projects'
    }],
    order: [['createdAt', 'DESC']]
  });
}

/**
 * Retorna um workspace por ID com seus projetos
 */
async function getWorkspaceById(id) {
  return await Workspace.findByPk(id, {
    include: [{
      model: Project,
      as: 'projects'
    }],
    order: [[{ model: Project, as: 'projects' }, 'createdAt', 'ASC']]
  });
}

/**
 * Cria um novo Workspace e dispara a clonagem/instalação em segundo plano (Assíncrono sem travar a requisição)
 */
async function createWorkspace(data, initialProjects = [], io = null) {
  const { name, repoUrl, branch, gitToken, installCommand, buildCommand, envVars, autoSync, syncIntervalMinutes, autoRestart, ignoreSsl } = data;

  let baseSlug = slugify(name);
  let uniqueSlug = baseSlug;
  let counter = 1;

  while (await Workspace.findOne({ where: { slug: uniqueSlug } })) {
    uniqueSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  const workspace = await Workspace.create({
    name: name.trim(),
    slug: uniqueSlug,
    repoUrl: repoUrl.trim(),
    branch: (branch && branch.trim()) ? branch.trim() : 'main',
    gitToken: (gitToken && gitToken.trim()) ? gitToken.trim() : null,
    installCommand: (installCommand && installCommand.trim()) ? installCommand.trim() : 'npm install',
    buildCommand: (buildCommand && buildCommand.trim()) ? buildCommand.trim() : null,
    envVars: envVars ? envVars.trim() : null,
    autoSync: autoSync === 'on' || autoSync === 'true' || autoSync === true,
    syncIntervalMinutes: syncIntervalMinutes ? parseInt(syncIntervalMinutes, 10) : 2,
    autoRestart: autoRestart === 'on' || autoRestart === 'true' || autoRestart === true,
    ignoreSsl: ignoreSsl === 'on' || ignoreSsl === 'true' || ignoreSsl === true
  });

  // Se houver projetos iniciais configurados para este Workspace
  const createdProjects = [];
  if (Array.isArray(initialProjects) && initialProjects.length > 0) {
    for (const projData of initialProjects) {
      if (projData.name && projData.startCommand) {
        let projBaseSlug = slugify(`${workspace.name}-${projData.name}`);
        let projSlug = projBaseSlug;
        let c = 1;
        while (await Project.findOne({ where: { slug: projSlug } })) {
          projSlug = `${projBaseSlug}-${c}`;
          c++;
        }

        const project = await Project.create({
          workspaceId: workspace.id,
          name: projData.name.trim(),
          slug: projSlug,
          projectType: projData.projectType || 'NODEJS',
          repoUrl: workspace.repoUrl,
          branch: workspace.branch,
          gitToken: workspace.gitToken,
          installCommand: workspace.installCommand,
          buildCommand: workspace.buildCommand,
          startCommand: projData.startCommand.trim(),
          envVars: projData.envVars ? projData.envVars.trim() : workspace.envVars,
          port: projData.port ? parseInt(projData.port, 10) : null,
          autoRestart: workspace.autoRestart,
          autoSync: workspace.autoSync,
          ignoreSsl: workspace.ignoreSsl,
          status: 'BUILDING' // Define status inicial como BUILDING para exibir o spinner no frontend
        });
        createdProjects.push(project);
      }
    }
  }

  // Dispara o deploy/instalação do Workspace em SEGUNDO PLANO (Assíncrono)
  deployWorkspace(workspace.id, io).catch((err) => {
    console.error(`[Workspace Create Async Error] Workspace #${workspace.id}:`, err.message);
  });

  return workspace;
}

/**
 * Adiciona um novo projeto a um Workspace existente
 */
async function addProjectToWorkspace(workspaceId, projData) {
  const workspace = await Workspace.findByPk(workspaceId);
  if (!workspace) throw new Error('Workspace não encontrado');

  // O pipeline é a autoridade sobre quais terminais existem. Um projeto criado por
  // fora dele seria marcado como órfão no próximo deploy, então o terminal é
  // registrado na definição antes de o Project ser criado.
  const efetiva = await pipelineRunner.getEffectiveDefinition(workspaceId);
  if (efetiva.source === 'REPO') {
    throw new Error(`Este workspace é governado pelo '${efetiva.fileName}' versionado no repositório. Adicione o novo terminal nesse arquivo e rode o deploy.`);
  }

  const pipelineKey = await registerTerminalInUiPipeline(workspace, efetiva, projData);

  let projBaseSlug = slugify(`${workspace.name}-${projData.name}`);
  let projSlug = projBaseSlug;
  let c = 1;
  while (await Project.findOne({ where: { slug: projSlug } })) {
    projSlug = `${projBaseSlug}-${c}`;
    c++;
  }

  const project = await Project.create({
    workspaceId: workspace.id,
    pipelineKey,
    pipelineSteps: JSON.stringify([]),
    name: projData.name.trim(),
    slug: projSlug,
    projectType: projData.projectType || 'NODEJS',
    repoUrl: workspace.repoUrl,
    branch: workspace.branch,
    gitToken: workspace.gitToken,
    startCommand: projData.startCommand.trim(),
    envVars: projData.envVars ? projData.envVars.trim() : workspace.envVars,
    port: projData.port ? parseInt(projData.port, 10) : null,
    autoRestart: workspace.autoRestart,
    autoSync: workspace.autoSync,
    ignoreSsl: workspace.ignoreSsl,
    status: 'STOPPED'
  });

  return project;
}

/**
 * Acrescenta um terminal à definição de pipeline mantida pela interface e devolve sua chave.
 * Se o workspace ainda não tem pipeline, sintetiza um a partir do estado atual antes.
 */
async function registerTerminalInUiPipeline(workspace, efetiva, projData) {
  let def = efetiva.def;

  if (!def) {
    if (efetiva.error) {
      throw new Error(`O pipeline atual deste workspace é inválido e precisa ser corrigido antes de adicionar terminais: ${efetiva.error}`);
    }
    const existentes = await Project.findAll({ where: { workspaceId: workspace.id } });
    def = existentes.length > 0
      ? pipelineService.synthesizeFromLegacy(workspace, existentes.map(p => p.toJSON()))
      : { version: pipelineService.SUPPORTED_VERSION, setup: [], terminals: [] };
  }

  const baseKey = slugify(projData.name) || 'terminal';
  let key = baseKey;
  let contador = 1;
  while (def.terminals.some(t => t.key === key)) {
    key = `${baseKey}-${contador}`;
    contador++;
  }

  def.terminals.push({
    key,
    name: projData.name.trim(),
    port: projData.port ? parseInt(projData.port, 10) : null,
    type: (projData.projectType || 'NODEJS').split(',')[0].trim().toUpperCase(),
    cwd: null,
    steps: [],
    start: projData.startCommand.trim(),
    env: (projData.envVars && projData.envVars.trim()) ? projData.envVars.trim() : null
  });

  await pipelineRunner.saveUiDefinition(workspace.id, def);
  return key;
}

/**
 * Inicia todos os projetos de um Workspace
 */
async function startAllProjectsInWorkspace(workspaceId, io = null) {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error('Workspace não encontrado');

  const results = [];
  for (const proj of workspace.projects) {
    try {
      const res = await processManager.startProject(proj.id, io);
      results.push({ projectId: proj.id, name: proj.name, ...res });
    } catch (err) {
      results.push({ projectId: proj.id, name: proj.name, success: false, error: err.message });
    }
  }
  return results;
}

/**
 * Para todos os projetos de um Workspace
 */
async function stopAllProjectsInWorkspace(workspaceId, io = null) {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error('Workspace não encontrado');

  const results = [];
  for (const proj of workspace.projects) {
    try {
      const res = await processManager.stopProject(proj.id, io);
      results.push({ projectId: proj.id, name: proj.name, ...res });
    } catch (err) {
      results.push({ projectId: proj.id, name: proj.name, success: false, error: err.message });
    }
  }
  return results;
}

/**
 * Re-Deploy em lote de todo o Workspace (executa de forma assíncrona com emissão de status em tempo real via Socket.IO)
 */
async function deployWorkspace(workspaceId, io = null) {
  console.log(`[Workspace Deploy] Delegando execução do Workspace #${workspaceId} para o pipeline...`);
  return await pipelineRunner.runPipeline(workspaceId, io);
}

module.exports = {
  slugify,
  getAllWorkspaces,
  getWorkspaceById,
  createWorkspace,
  addProjectToWorkspace,
  startAllProjectsInWorkspace,
  stopAllProjectsInWorkspace,
  deployWorkspace
};
