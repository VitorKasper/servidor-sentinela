const portService = require('../services/portService');
const { getPrimaryLocalIp } = require('../config/network');

/**
 * Exibe a página de listagem e monitoramento de portas ocupadas
 */
exports.index = async (req, res) => {
  try {
    const [occupiedPorts, suggestedPort] = await Promise.all([
      portService.getOccupiedPorts(),
      portService.suggestAvailablePort(3001)
    ]);

    const primaryIp = getPrimaryLocalIp();

    res.render('ports/index', {
      title: 'Portas & Conectividade - Servidor Sentinela',
      occupiedPorts,
      suggestedPort,
      primaryIp
    });
  } catch (error) {
    console.error('[PortController] Erro ao listar portas:', error);
    req.flash('error', 'Falha ao escanear portas do sistema.');
    res.redirect('/dashboard');
  }
};

/**
 * API: Retorna status de portas ocupadas e próxima sugestão
 */
exports.apiStatus = async (req, res) => {
  try {
    const [occupiedPorts, suggestedPort] = await Promise.all([
      portService.getOccupiedPorts(),
      portService.suggestAvailablePort(3001)
    ]);

    return res.json({
      success: true,
      totalOccupied: occupiedPorts.length,
      suggestedPort,
      occupiedPorts
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * API: Verifica se uma porta específica está livre ou ocupada
 */
exports.apiCheck = async (req, res) => {
  try {
    const port = req.params.port || req.query.port;
    const result = await portService.checkPortAvailability(port);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * API: Sugere a próxima porta livre
 */
exports.apiSuggest = async (req, res) => {
  try {
    const from = req.query.from || 3001;
    const suggestedPort = await portService.suggestAvailablePort(from);
    return res.json({ success: true, suggestedPort });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
