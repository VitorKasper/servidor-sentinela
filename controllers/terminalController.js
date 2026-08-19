const terminalService = require('../services/terminalService');

/**
 * Renderiza a página do Terminal Administrativo do Servidor
 */
function showTerminal(req, res) {
  res.render('admin/terminal', {
    title: 'Terminal do Servidor',
    defaultCwd: terminalService.resolveDefaultCwd()
  });
}

/**
 * Abre a conexão de streaming (Server-Sent Events) com a saída do shell do administrador
 */
function streamOutput(req, res) {
  const userId = req.session.user.id;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');

  terminalService.addListener(userId, res);

  req.on('close', () => {
    terminalService.removeListener(userId, res);
  });
}

/**
 * Executa o bloco de comandos enviado pelo administrador no shell persistente
 */
function execCommand(req, res) {
  const userId = req.session.user.id;
  const { commands } = req.body;

  if (!commands || !commands.trim()) {
    return res.status(400).json({ success: false, error: 'Nenhum comando informado.' });
  }

  terminalService.execCommands(userId, commands);
  return res.json({ success: true });
}

/**
 * Encerra o shell persistente do administrador (ex: em caso de comando travado)
 */
function killSession(req, res) {
  const userId = req.session.user.id;
  terminalService.killSession(userId);
  return res.json({ success: true });
}

module.exports = {
  showTerminal,
  streamOutput,
  execCommand,
  killSession
};
