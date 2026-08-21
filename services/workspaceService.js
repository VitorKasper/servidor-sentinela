const { Workspace, Project } = require('../models');
const gitService = require('./gitService');
const processManager = require('./processManager');

// Mutex em memória para evitar instalações/builds concorrentes na mesma pasta de Workspace
const workspaceInstallLocks = new Map();

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
 * Executa a instalação e build do Workspace de forma thread-safe (uma única vez por pasta)
 */
async function runWorkspaceInstallAndBuild(workspace, io = null) {
  const workspaceId = workspace.id;

  // Se já houver uma instalação rodando para este workspace, aguarda terminar
  if (workspaceInstallLocks.has(workspaceId)) {
    console.log(`[WorkspaceLock] Aguardando conclusão da instalação anterior do Workspace #${workspaceId}...`);
    await workspaceInstallLocks.get(workspaceId);
    return;
  }

  const installPromise = (async () => {
    try {
      workspace.isWorkspace = true;
      const gitResult = await gitService.cloneOrPull(workspace, (msg) => {
        if (workspace.projects && workspace.projects.length > 0) {
          processManager.appendLog(workspace.projects[0].id, msg, io);
        }
      });
      const workspaceDir = gitResult.path;

      // Executa comando de instalação do workspace uma única vez
      if (workspace.installCommand && workspace.installCommand.trim()) {
        console.log(`[Workspace] Executando comando de instalação único ('${workspace.installCommand}')...`);
        const env = processManager.parseEnvVars(workspace.envVars, null, workspaceDir, workspace.ignoreSsl);
        await processManager.ensurePythonVenv(workspace, workspaceDir, env, `ws-${workspace.id}`, io);
        const finalEnv = processManager.parseEnvVars(workspace.envVars, null, workspaceDir, workspace.ignoreSsl);
        const installCmd = processManager.formatCommandWithSslBypass(workspace.installCommand.trim(), workspace.ignoreSsl);

        const logTargetId = (workspace.projects && workspace.projects.length > 0) ? workspace.projects[0].id : `ws-${workspace.id}`;
        await processManager.runCommand(installCmd, workspaceDir, finalEnv, logTargetId, io);
      }

      // Executa comando de build do workspace se configurado
      if (workspace.buildCommand && workspace.buildCommand.trim()) {
        console.log(`[Workspace] Executando comando de build único ('${workspace.buildCommand}')...`);
        const env = processManager.parseEnvVars(workspace.envVars, null, workspaceDir, workspace.ignoreSsl);
        const logTargetId = (workspace.projects && workspace.projects.length > 0) ? workspace.projects[0].id : `ws-${workspace.id}`;
        await processManager.runCommand(workspace.buildCommand.trim(), workspaceDir, env, logTargetId, io);
      }

      if (gitResult && gitResult.commitHash) {
        workspace.currentCommitHash = gitResult.commitHash;
        workspace.lastCommitHash = gitResult.commitHash;
        workspace.lastDeployedAt = new Date();
        await workspace.save();
      }
    } finally {
      workspaceInstallLocks.delete(workspaceId);
    }
  })();

  workspaceInstallLocks.set(workspaceId, installPromise);
  await installPromise;
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
    status: 'STOPPED'
  });

  return project;
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
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error('Workspace não encontrado');

  console.log(`[Workspace Deploy] Iniciando deploy assíncrono do Workspace '${workspace.name}'...`);

  // 1. Atualiza status dos projetos do workspace para BUILDING no banco e emite Socket.IO
  if (workspace.projects && workspace.projects.length > 0) {
    for (const proj of workspace.projects) {
      proj.status = 'BUILDING';
      await proj.save();
      if (io) {
        io.emit('project_status', { projectId: proj.id, status: 'BUILDING', pid: null });
      }
    }
  }

  try {
    // 2. Para todos os processos anteriores em execução
    await stopAllProjectsInWorkspace(workspaceId, io);

    // 3. Executa git pull, npm/pip install e build uma única vez para a pasta do Workspace
    await runWorkspaceInstallAndBuild(workspace, io);

    // 4. Inicia todos os projetos do workspace em seguida
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
  } catch (error) {
    console.error(`[Workspace Deploy Erro] Workspace #${workspaceId}:`, error.message);
    if (workspace.projects && workspace.projects.length > 0) {
      for (const proj of workspace.projects) {
        proj.status = 'ERROR';
        await proj.save();
        if (io) {
          io.emit('project_status', { projectId: proj.id, status: 'ERROR', pid: null });
        }
      }
    }
    throw error;
  }
}

module.exports = {
  slugify,
  getAllWorkspaces,
  getWorkspaceById,
  createWorkspace,
  addProjectToWorkspace,
  startAllProjectsInWorkspace,
  stopAllProjectsInWorkspace,
  deployWorkspace,
  runWorkspaceInstallAndBuild
};
