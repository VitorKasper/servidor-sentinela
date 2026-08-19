const os = require('os');
const { Project, User, DeploymentLog } = require('../models');
const { getLocalIpAddresses, getPrimaryLocalIp } = require('../config/network');
const processManager = require('../services/processManager');

/**
 * Exibe o dashboard principal com métricas, IPs na LAN e status geral
 */
exports.index = async (req, res) => {
  try {
    const projects = await Project.findAll({
      order: [['updatedAt', 'DESC']]
    });

    const totalProjects = projects.length;
    const runningProjects = projects.filter(p => p.status === 'RUNNING').length;
    const stoppedProjects = projects.filter(p => p.status === 'STOPPED').length;
    const errorProjects = projects.filter(p => p.status === 'ERROR').length;
    const buildingProjects = projects.filter(p => p.status === 'BUILDING').length;

    const totalUsers = req.session.user.role === 'ADMIN' ? await User.count() : 0;
    const recentLogs = await DeploymentLog.findAll({
      limit: 6,
      order: [['createdAt', 'DESC']],
      include: [{ model: Project, as: 'project', attributes: ['name', 'slug'] }]
    });

    // Informações do Sistema do Servidor
    const memoryTotal = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1);
    const memoryFree = (os.freemem() / (1024 * 1024 * 1024)).toFixed(1);
    const memoryUsed = (memoryTotal - memoryFree).toFixed(1);
    const memoryPercent = Math.round((memoryUsed / memoryTotal) * 100);

    const localIps = getLocalIpAddresses();
    const primaryIp = getPrimaryLocalIp();
    const serverPort = process.env.PORT || 3000;

    res.render('dashboard/index', {
      title: 'Dashboard - Servidor Sentinela',
      projects,
      stats: {
        total: totalProjects,
        running: runningProjects,
        stopped: stoppedProjects,
        error: errorProjects,
        building: buildingProjects,
        users: totalUsers
      },
      system: {
        memoryTotal,
        memoryUsed,
        memoryPercent,
        cpus: os.cpus().length,
        platform: os.platform(),
        uptimeHours: (os.uptime() / 3600).toFixed(1)
      },
      network: {
        localIps,
        primaryIp,
        serverPort
      },
      recentLogs
    });
  } catch (error) {
    console.error('[Dashboard] Erro ao carregar dashboard:', error);
    req.flash('error', 'Erro ao carregar estatísticas do dashboard.');
    res.render('dashboard/index', {
      title: 'Dashboard - Servidor Sentinela',
      projects: [],
      stats: { total: 0, running: 0, stopped: 0, error: 0, building: 0, users: 0 },
      system: { memoryTotal: 0, memoryUsed: 0, memoryPercent: 0, cpus: 0, platform: '', uptimeHours: 0 },
      network: { localIps: [], primaryIp: 'localhost', serverPort: 3000 },
      recentLogs: []
    });
  }
};
