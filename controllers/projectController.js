const fs = require('fs');
const path = require('path');
const { Project, DeploymentLog } = require('../models');
const gitService = require('../services/gitService');
const readmeService = require('../services/readmeService');
const processManager = require('../services/processManager');

/**
 * Utilitário para gerar slug amigável a partir do nome
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

const VALID_PROJECT_TYPES = ['NODEJS', 'PYTHON', 'GENERIC'];

/**
 * Normaliza a(s) stack(s) selecionada(s) (checkbox múltiplo) em uma string "NODEJS,PYTHON"
 */
function normalizeProjectTypes(input) {
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  const valid = arr.map(t => String(t).toUpperCase()).filter(t => VALID_PROJECT_TYPES.includes(t));
  const unique = [...new Set(valid)];
  return unique.length ? unique.join(',') : 'NODEJS';
}

/**
 * Sugere comandos padrão de instalação/inicialização com base nas stacks selecionadas
 */
function getDefaultCommands(projectTypeStr) {
  const types = (projectTypeStr || '').split(',').map(t => t.trim().toUpperCase());
  const isNode = types.includes('NODEJS');
  const isPython = types.includes('PYTHON');

  const installParts = [];
  if (isNode) installParts.push('npm install');
  if (isPython) installParts.push('pip install -r requirements.txt');

  const install = installParts.length ? installParts.join(' && ') : 'npm install';
  const start = (isPython && !isNode) ? 'python app.py' : 'npm start';

  return { install, start };
}

const workspaceService = require('../services/workspaceService');
const { Workspace } = require('../models');

/**
 * Lista todos os projetos
 */
exports.index = async (req, res) => {
  try {
    const [projects, workspaces] = await Promise.all([
      Project.findAll({
        include: [{ model: Workspace, as: 'workspace' }],
        order: [['createdAt', 'DESC']]
      }),
      workspaceService.getAllWorkspaces()
    ]);

    const enrichedProjects = projects.map(proj => {
      const projObj = proj.toJSON ? proj.toJSON() : { ...proj };
      const readmes = readmeService.findProjectReadmes(projObj.slug);
      projObj.readmeCount = readmes.length;
      projObj.hasReadme = readmes.length > 0;
      return projObj;
    });

    res.render('projects/index', {
      title: 'Projetos & Aplicações - Servidor Sentinela',
      projects: enrichedProjects,
      workspaces
    });
  } catch (error) {
    console.error('[Projects] Erro ao listar projetos:', error);
    req.flash('error', 'Erro ao carregar lista de projetos.');
    res.redirect('/dashboard');
  }
};


/**
 * Exibe o formulário de cadastro de novo projeto (Admin)
 */
exports.showCreate = (req, res) => {
  res.render('projects/create', {
    title: 'Novo Projeto GitHub - Servidor Sentinela'
  });
};

/**
 * Cria o projeto e inicia o deploy inicial
 */
exports.postCreate = async (req, res) => {
  const {
    name,
    repoUrl,
    branch,
    gitToken,
    installCommand,
    buildCommand,
    startCommand,
    envVars,
    port,
    autoRestart,
    autoDeploy,
    autoSync,
    syncIntervalMinutes,
    projectType,
    ignoreSsl
  } = req.body;

  try {
    if (!name || !repoUrl) {
      req.flash('error', 'Nome do projeto e URL do repositório GitHub são obrigatórios.');
      return res.redirect('/projects/create');
    }

    let baseSlug = slugify(name);
    let uniqueSlug = baseSlug;
    let counter = 1;

    while (await Project.findOne({ where: { slug: uniqueSlug } })) {
      uniqueSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    const type = normalizeProjectTypes(projectType);
    const defaults = getDefaultCommands(type);

    const project = await Project.create({
      name: name.trim(),
      slug: uniqueSlug,
      projectType: type,
      repoUrl: repoUrl.trim(),
      branch: (branch && branch.trim()) ? branch.trim() : 'main',
      gitToken: (gitToken && gitToken.trim()) ? gitToken.trim() : null,
      installCommand: (installCommand && installCommand.trim()) ? installCommand.trim() : defaults.install,
      buildCommand: (buildCommand && buildCommand.trim()) ? buildCommand.trim() : null,
      startCommand: (startCommand && startCommand.trim()) ? startCommand.trim() : defaults.start,
      envVars: envVars ? envVars.trim() : null,
      port: port ? parseInt(port, 10) : null,
      autoRestart: autoRestart === 'on' || autoRestart === 'true' || autoRestart === true,
      autoSync: autoSync === 'on' || autoSync === 'true' || autoSync === true,
      syncIntervalMinutes: syncIntervalMinutes ? parseInt(syncIntervalMinutes, 10) : 2,
      ignoreSsl: ignoreSsl === 'on' || ignoreSsl === 'true' || ignoreSsl === true,
      status: 'STOPPED'
    });

    const io = req.app.get('io');

    // Se o deploy automático estiver habilitado (padrão)
    if (autoDeploy !== 'false') {
      req.flash('success', `Projeto '${project.name}' cadastrado! O processo de deploy inicial foi iniciado.`);
      // Executa deploy em background
      processManager.deployProject(project.id, io).catch((err) => {
        console.error(`[Deploy Inicial Falhou] Projeto #${project.id}:`, err.message);
      });
      return res.redirect(`/projects/${project.id}/terminal`);
    } else {
      req.flash('success', `Projeto '${project.name}' cadastrado com sucesso.`);
      return res.redirect('/projects');
    }
  } catch (error) {
    console.error('[Projects] Erro ao cadastrar projeto:', error);
    req.flash('error', `Falha ao cadastrar projeto: ${error.message}`);
    return res.redirect('/projects/create');
  }
};

/**
 * Exibe tela de edição do projeto (Admin)
 */
exports.showEdit = async (req, res) => {
  try {
    const project = await Project.findByPk(req.params.id);
    if (!project) {
      req.flash('error', 'Projeto não encontrado.');
      return res.redirect('/projects');
    }

    res.render('projects/edit', {
      title: `Editar ${project.name} - Servidor Sentinela`,
      project
    });
  } catch (error) {
    console.error('[Projects] Erro ao abrir edição:', error);
    req.flash('error', 'Erro ao carregar detalhes do projeto.');
    res.redirect('/projects');
  }
};

/**
 * Atualiza as configurações do projeto
 */
exports.postEdit = async (req, res) => {
  const {
    name,
    repoUrl,
    branch,
    gitToken,
    installCommand,
    buildCommand,
    startCommand,
    envVars,
    port,
    autoRestart,
    autoSync,
    syncIntervalMinutes,
    projectType,
    ignoreSsl
  } = req.body;

  try {
    const project = await Project.findByPk(req.params.id);
    if (!project) {
      req.flash('error', 'Projeto não encontrado.');
      return res.redirect('/projects');
    }

    project.name = name.trim();
    project.repoUrl = repoUrl.trim();
    project.branch = branch.trim() || 'main';
    if (gitToken !== undefined) project.gitToken = gitToken.trim() || null;
    if (projectType) {
      project.projectType = normalizeProjectTypes(projectType);
    }
    const defaults = getDefaultCommands(project.projectType);
    project.installCommand = installCommand ? installCommand.trim() : defaults.install;
    project.buildCommand = buildCommand ? buildCommand.trim() : null;
    project.startCommand = startCommand ? startCommand.trim() : defaults.start;
    project.envVars = envVars ? envVars.trim() : null;
    project.port = port ? parseInt(port, 10) : null;
    project.autoRestart = autoRestart === 'on' || autoRestart === 'true' || autoRestart === true;
    project.autoSync = autoSync === 'on' || autoSync === 'true' || autoSync === true;
    if (syncIntervalMinutes) project.syncIntervalMinutes = parseInt(syncIntervalMinutes, 10);
    project.ignoreSsl = ignoreSsl === 'on' || ignoreSsl === 'true' || ignoreSsl === true;

    await project.save();
    req.flash('success', `Configurações de '${project.name}' atualizadas com sucesso.`);
    return res.redirect(`/projects/${project.id}/terminal`);
  } catch (error) {
    console.error('[Projects] Erro ao editar projeto:', error);
    req.flash('error', `Erro ao salvar configurações: ${error.message}`);
    return res.redirect(`/projects/${req.params.id}/edit`);
  }
};

/**
 * Exclui um projeto e seus arquivos em storage
 */
exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findByPk(req.params.id);
    if (!project) {
      req.flash('error', 'Projeto não encontrado.');
      return res.redirect('/projects');
    }

    const io = req.app.get('io');
    
    // Para processo se estiver rodando
    await processManager.stopProject(project.id, io);

    // Remove diretório de arquivos se existir
    const projectDir = gitService.getProjectPath(project.slug);
    if (fs.existsSync(projectDir)) {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`[Projects] Aviso ao remover pasta ${projectDir}:`, e.message);
      }
    }

    await project.destroy();
    req.flash('success', `Projeto '${project.name}' removido com sucesso.`);
    return res.redirect('/projects');
  } catch (error) {
    console.error('[Projects] Erro ao excluir projeto:', error);
    req.flash('error', `Falha ao excluir projeto: ${error.message}`);
    return res.redirect('/projects');
  }
};
