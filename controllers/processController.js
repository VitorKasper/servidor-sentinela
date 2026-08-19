const { Project, DeploymentLog } = require('../models');
const processManager = require('../services/processManager');
const gitService = require('../services/gitService');
const readmeService = require('../services/readmeService');
const { getPrimaryLocalIp } = require('../config/network');

/**
 * Exibe a página de terminal e monitoramento em tempo real do projeto
 */
exports.showTerminal = async (req, res) => {
  try {
    const project = await Project.findByPk(req.params.id, {
      include: [{ model: DeploymentLog, as: 'logs', limit: 10, order: [['createdAt', 'DESC']] }]
    });

    if (!project) {
      req.flash('error', 'Projeto não encontrado.');
      return res.redirect('/projects');
    }

    const logs = processManager.getLogs(project.id);
    const primaryIp = getPrimaryLocalIp();
    const commits = await gitService.getCommitHistory(project.slug, 15);
    const readmes = readmeService.findProjectReadmes(project.slug);

    res.render('projects/terminal', {
      title: `Terminal: ${project.name} - Servidor Sentinela`,
      project,
      initialLogs: logs,
      primaryIp,
      commits,
      hasReadme: readmes.length > 0,
      readmeCount: readmes.length
    });
  } catch (error) {
    console.error('[Terminal] Erro ao carregar terminal:', error);
    req.flash('error', 'Erro ao carregar terminal do projeto.');
    res.redirect('/projects');
  }
};


/**
 * Inicia a execução do projeto
 */
exports.start = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const io = req.app.get('io');
    const result = await processManager.startProject(projectId, io);
    return res.json({ success: true, message: 'Projeto iniciado com sucesso.', data: result });
  } catch (error) {
    console.error('[Process] Erro ao iniciar projeto:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Encerra a execução do projeto
 */
exports.stop = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const io = req.app.get('io');
    const result = await processManager.stopProject(projectId, io);
    return res.json({ success: true, message: 'Projeto parado com sucesso.', data: result });
  } catch (error) {
    console.error('[Process] Erro ao parar projeto:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Reinicia a execução do projeto
 */
exports.restart = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const io = req.app.get('io');
    const result = await processManager.restartProject(projectId, io);
    return res.json({ success: true, message: 'Projeto reiniciado com sucesso.', data: result });
  } catch (error) {
    console.error('[Process] Erro ao reiniciar projeto:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Dispara o re-deploy (git pull + install + build + start)
 */
exports.redeploy = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const io = req.app.get('io');
    
    // Executa o deploy assincronamente transmitindo logs para o Socket.IO
    processManager.deployProject(projectId, io).catch((err) => {
      console.error(`[ReDeploy Assíncrono Falhou] Projeto #${projectId}:`, err.message);
    });

    return res.json({ success: true, message: 'Processo de re-deploy iniciado com sucesso. Acompanhe pelo terminal.' });
  } catch (error) {
    console.error('[Process] Erro ao disparar re-deploy:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Retorna a lista de commits do repositório Git
 */
exports.getCommits = async (req, res) => {
  try {
    const project = await Project.findByPk(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Projeto não encontrado' });

    const commits = await gitService.getCommitHistory(project.slug, 15);
    return res.json({ success: true, commits, currentCommit: project.currentCommitHash });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Executa o rollback para um commit anterior
 */
exports.rollback = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const commitHash = req.params.commitHash || req.body.commitHash;
    if (!commitHash) return res.status(400).json({ success: false, error: 'Hash de commit obrigatório' });

    const io = req.app.get('io');
    processManager.rollbackProject(projectId, commitHash, io).catch((err) => {
      console.error(`[Rollback Assíncrono Falhou] Projeto #${projectId}:`, err.message);
    });

    return res.json({ success: true, message: `Rollback para a versão ${commitHash.slice(0, 7)} iniciado.` });
  } catch (error) {
    console.error('[Process] Erro ao acionar rollback:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Restaura o projeto para a versão mais recente da branch
 */
exports.restoreBranch = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const io = req.app.get('io');
    
    processManager.restoreProjectBranch(projectId, io).catch((err) => {
      console.error(`[Restauração Assíncrona Falhou] Projeto #${projectId}:`, err.message);
    });

    return res.json({ success: true, message: 'Restauração para a versão mais recente da branch iniciada.' });
  } catch (error) {
    console.error('[Process] Erro ao restaurar branch:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Retorna os logs do buffer em formato JSON
 */
exports.getLogs = (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const logs = processManager.getLogs(projectId);
  return res.json({ logs });
};

/**
 * Limpa o histórico de logs do terminal
 */
exports.clearLogs = (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const io = req.app.get('io');
  processManager.clearLogs(projectId, io);
  return res.json({ success: true, message: 'Logs limpos com sucesso.' });
};
