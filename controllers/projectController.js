const fs = require('fs');
const path = require('path');
const { Project, DeploymentLog } = require('../models');
const gitService = require('../services/gitService');
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

/**
 * Lista todos os projetos
 */
exports.index = async (req, res) => {
  try {
    const projects = await Project.findAll({
      order: [['createdAt', 'DESC']]
    });

    res.render('projects/index', {
      title: 'Projetos - Servidor Sentinela',
      projects
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
    autoDeploy
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

    const project = await Project.create({
      name: name.trim(),
      slug: uniqueSlug,
      repoUrl: repoUrl.trim(),
      branch: (branch && branch.trim()) ? branch.trim() : 'main',
      gitToken: (gitToken && gitToken.trim()) ? gitToken.trim() : null,
      installCommand: (installCommand && installCommand.trim()) ? installCommand.trim() : 'npm install',
      buildCommand: (buildCommand && buildCommand.trim()) ? buildCommand.trim() : null,
      startCommand: (startCommand && startCommand.trim()) ? startCommand.trim() : 'npm start',
      envVars: envVars ? envVars.trim() : null,
      port: port ? parseInt(port, 10) : null,
      autoRestart: autoRestart === 'on' || autoRestart === 'true' || autoRestart === true,
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
    autoRestart
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
    project.installCommand = installCommand.trim() || 'npm install';
    project.buildCommand = buildCommand ? buildCommand.trim() : null;
    project.startCommand = startCommand.trim() || 'npm start';
    project.envVars = envVars ? envVars.trim() : null;
    project.port = port ? parseInt(port, 10) : null;
    project.autoRestart = autoRestart === 'on' || autoRestart === 'true' || autoRestart === true;

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
