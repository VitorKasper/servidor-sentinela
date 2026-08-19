const { Project, DeploymentLog } = require('../models');
const processManager = require('../services/processManager');
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

    res.render('projects/terminal', {
      title: `Terminal: ${project.name} - Servidor Sentinela`,
      project,
      initialLogs: logs,
      primaryIp
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
