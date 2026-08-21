const fs = require('fs');
const path = require('path');
const { Workspace, Project } = require('../models');
const workspaceService = require('../services/workspaceService');
const gitService = require('../services/gitService');
const readmeService = require('../services/readmeService');

/**
 * Lista todos os Workspaces
 */
exports.index = async (req, res) => {
  try {
    const workspaces = await workspaceService.getAllWorkspaces();

    res.render('workspaces/index', {
      title: 'Workspaces - Servidor Sentinela',
      workspaces
    });
  } catch (error) {
    console.error('[WorkspaceController] Erro ao listar workspaces:', error);
    req.flash('error', 'Erro ao carregar lista de workspaces.');
    res.redirect('/dashboard');
  }
};

/**
 * Exibe a visão interna do Workspace com seus projetos (utilizando os mesmos cards de projeto de hoje)
 */
exports.show = async (req, res) => {
  try {
    const workspace = await workspaceService.getWorkspaceById(req.params.id);
    if (!workspace) {
      req.flash('error', 'Workspace não encontrado.');
      return res.redirect('/workspaces');
    }

    const enrichedProjects = (workspace.projects || []).map(proj => {
      const projObj = proj.toJSON ? proj.toJSON() : { ...proj };
      const readmes = readmeService.findProjectReadmes(projObj.slug);
      projObj.readmeCount = readmes.length;
      projObj.hasReadme = readmes.length > 0;
      return projObj;
    });

    res.render('workspaces/show', {
      title: `Workspace: ${workspace.name} - Servidor Sentinela`,
      workspace,
      projects: enrichedProjects
    });
  } catch (error) {
    console.error('[WorkspaceController] Erro ao carregar detalhes do workspace:', error);
    req.flash('error', 'Erro ao abrir workspace.');
    res.redirect('/workspaces');
  }
};

/**
 * Exibe o formulário para criação de novo Workspace
 */
exports.showCreate = (req, res) => {
  res.render('workspaces/create', {
    title: 'Novo Workspace - Servidor Sentinela'
  });
};

/**
 * Processa a criação de um novo Workspace e seus projetos iniciais
 */
exports.postCreate = async (req, res) => {
  const {
    name,
    repoUrl,
    branch,
    gitToken,
    installCommand,
    buildCommand,
    envVars,
    autoRestart,
    autoSync,
    syncIntervalMinutes,
    ignoreSsl,
    projectNames,
    projectPorts,
    projectStartCommands,
    projectTypes
  } = req.body;

  try {
    if (!name || !repoUrl) {
      req.flash('error', 'Nome do Workspace e URL do Repositório GitHub são obrigatórios.');
      return res.redirect('/workspaces/create');
    }

    // Processa os projetos dinâmicos do formulário
    const initialProjects = [];
    if (projectNames) {
      const names = Array.isArray(projectNames) ? projectNames : [projectNames];
      const ports = Array.isArray(projectPorts) ? projectPorts : [projectPorts];
      const startCmds = Array.isArray(projectStartCommands) ? projectStartCommands : [projectStartCommands];
      const types = Array.isArray(projectTypes) ? projectTypes : [projectTypes];

      for (let i = 0; i < names.length; i++) {
        if (names[i] && names[i].trim()) {
          initialProjects.push({
            name: names[i].trim(),
            port: ports[i] ? ports[i].trim() : null,
            startCommand: startCmds[i] ? startCmds[i].trim() : 'npm start',
            projectType: types[i] ? types[i].trim() : 'NODEJS'
          });
        }
      }
    }

    const io = req.app.get('io');
    const workspace = await workspaceService.createWorkspace(req.body, initialProjects, io);

    req.flash('success', `Workspace '${workspace.name}' criado com sucesso! O repositório está sendo clonado e instalado em segundo plano.`);
    return res.redirect(`/workspaces/${workspace.id}`);
  } catch (error) {
    console.error('[WorkspaceController] Erro ao criar workspace:', error);
    req.flash('error', `Falha ao criar workspace: ${error.message}`);
    return res.redirect('/workspaces/create');
  }
};

/**
 * Adiciona um novo projeto ao Workspace
 */
exports.postAddProject = async (req, res) => {
  const { workspaceId } = req.params;
  const { name, port, startCommand, projectType, envVars } = req.body;

  try {
    if (!name || !startCommand) {
      req.flash('error', 'Nome do projeto e comando de inicialização são obrigatórios.');
      return res.redirect(`/workspaces/${workspaceId}`);
    }

    const project = await workspaceService.addProjectToWorkspace(workspaceId, {
      name,
      port,
      startCommand,
      projectType,
      envVars
    });

    req.flash('success', `Projeto '${project.name}' adicionado ao Workspace!`);
    return res.redirect(`/workspaces/${workspaceId}`);
  } catch (error) {
    console.error('[WorkspaceController] Erro ao adicionar projeto:', error);
    req.flash('error', `Falha ao adicionar projeto: ${error.message}`);
    return res.redirect(`/workspaces/${workspaceId}`);
  }
};

/**
 * Inicia todos os projetos do Workspace
 */
exports.startAll = async (req, res) => {
  try {
    const io = req.app.get('io');
    await workspaceService.startAllProjectsInWorkspace(req.params.id, io);
    req.flash('success', 'Todos os projetos do Workspace foram iniciados!');
    return res.redirect(`/workspaces/${req.params.id}`);
  } catch (error) {
    req.flash('error', `Erro ao iniciar projetos: ${error.message}`);
    return res.redirect(`/workspaces/${req.params.id}`);
  }
};

/**
 * Para todos os projetos do Workspace
 */
exports.stopAll = async (req, res) => {
  try {
    const io = req.app.get('io');
    await workspaceService.stopAllProjectsInWorkspace(req.params.id, io);
    req.flash('success', 'Todos os projetos do Workspace foram parados.');
    return res.redirect(`/workspaces/${req.params.id}`);
  } catch (error) {
    req.flash('error', `Erro ao parar projetos: ${error.message}`);
    return res.redirect(`/workspaces/${req.params.id}`);
  }
};

/**
 * Re-deploy de todo o Workspace
 */
exports.deployAll = async (req, res) => {
  try {
    const io = req.app.get('io');
    workspaceService.deployWorkspace(req.params.id, io).catch(err => console.error('Erro no Re-deploy do Workspace:', err));
    req.flash('success', 'Deploy do Workspace e atualização do repositório em andamento...');
    return res.redirect(`/workspaces/${req.params.id}`);
  } catch (error) {
    req.flash('error', `Erro ao disparar deploy: ${error.message}`);
    return res.redirect(`/workspaces/${req.params.id}`);
  }
};

/**
 * Exclui um Workspace e seus arquivos clonados
 */
exports.deleteWorkspace = async (req, res) => {
  try {
    const workspace = await workspaceService.getWorkspaceById(req.params.id);
    if (!workspace) {
      req.flash('error', 'Workspace não encontrado.');
      return res.redirect('/workspaces');
    }

    const io = req.app.get('io');
    await workspaceService.stopAllProjectsInWorkspace(workspace.id, io);

    const workspaceDir = gitService.getWorkspacePath(workspace.slug);
    if (fs.existsSync(workspaceDir)) {
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`[WorkspaceController] Aviso ao remover pasta ${workspaceDir}:`, e.message);
      }
    }

    await Workspace.destroy({ where: { id: workspace.id } });

    req.flash('success', `Workspace '${workspace.name}' e seus projetos foram excluídos.`);
    return res.redirect('/workspaces');
  } catch (error) {
    console.error('[WorkspaceController] Erro ao excluir workspace:', error);
    req.flash('error', `Erro ao excluir workspace: ${error.message}`);
    return res.redirect('/workspaces');
  }
};
