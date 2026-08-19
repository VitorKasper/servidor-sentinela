const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const treeKill = require('tree-kill');
const iconv = require('iconv-lite');

// Diretório padrão onde o shell administrativo é aberto (raiz de armazenamento dos projetos)
const DEFAULT_CWD = path.resolve(process.cwd(), process.env.PROJECTS_STORAGE_PATH || './storage/projects');

// Map em memória: userId (Number) -> { proc, listeners: Set<res>, lineBuffer: String, pendingMarker: String|null }
const sessions = new Map();

let cachedOemCodepage = null;

/**
 * Detecta a codepage OEM ativa do console do Windows (ex: cp850, cp860) para
 * decodificar corretamente a saída do cmd.exe. O cmd.exe NÃO usa UTF-8 por padrão
 * e forçar 'chcp 65001' corrompe a saída quando o stdout está redirecionado/piped
 * (bug conhecido do console do Windows com buffers), então detectamos a real.
 */
function detectOemCodepage() {
  if (cachedOemCodepage) return cachedOemCodepage;
  if (process.platform !== 'win32') {
    cachedOemCodepage = 'utf8';
    return cachedOemCodepage;
  }

  try {
    const raw = execSync('chcp', { windowsHide: true });
    const text = iconv.decode(raw, 'cp437');
    const match = text.match(/(\d{3,5})/);
    cachedOemCodepage = match && iconv.encodingExists(`cp${match[1]}`) ? `cp${match[1]}` : 'cp850';
  } catch (err) {
    cachedOemCodepage = 'cp850';
  }

  return cachedOemCodepage;
}

function resolveDefaultCwd() {
  return fs.existsSync(DEFAULT_CWD) ? DEFAULT_CWD : process.cwd();
}

/**
 * Envia uma mensagem via Server-Sent Events para todos os clientes conectados na sessão do usuário
 */
function broadcast(userId, event, payload) {
  const session = sessions.get(userId);
  if (!session) return;

  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of session.listeners) {
    res.write(data);
  }
}

/**
 * Processa a saída bruta do shell, separando por linha e emitindo cada uma via SSE.
 * Linhas que correspondem ao marcador de "fim de execução" não são exibidas: em vez
 * disso disparam o evento 'done' para que o cliente saiba que o lote terminou.
 */
function handleChunk(userId, chunk, streamName) {
  const session = sessions.get(userId);
  if (!session) return;

  session.lineBuffer += iconv.decode(chunk, detectOemCodepage());
  const lines = session.lineBuffer.split(/\r?\n/);
  session.lineBuffer = lines.pop();

  lines.forEach((line) => {
    if (line.trim() === '') return;

    if (session.pendingMarker && line.includes(session.pendingMarker)) {
      // A linha do prompt ecoando o comando ("C:\path>echo <marker>") também contém o
      // marcador, então só consideramos concluído quando a SAÍDA pura do echo chega
      // (a linha é exatamente igual ao marcador, sem prefixo de prompt/comando).
      if (line.trim() === session.pendingMarker) {
        session.pendingMarker = null;
        broadcast(userId, 'done', {});
      }
      return;
    }

    broadcast(userId, 'output', { line, stream: streamName });
  });
}

/**
 * Cria (se necessário) o shell administrativo persistente do usuário
 */
function getOrCreateSession(userId) {
  let session = sessions.get(userId);
  if (session && session.proc && !session.proc.killed) {
    return session;
  }

  const cwd = resolveDefaultCwd();
  const proc = spawn('cmd.exe', [], {
    cwd,
    env: process.env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  session = { proc, listeners: new Set(), lineBuffer: '', pendingMarker: null };
  sessions.set(userId, session);

  proc.stdout.on('data', (data) => handleChunk(userId, data, 'stdout'));
  proc.stderr.on('data', (data) => handleChunk(userId, data, 'stderr'));

  proc.on('close', (code) => {
    if (session.lineBuffer.trim()) {
      broadcast(userId, 'output', { line: session.lineBuffer, stream: 'stdout' });
    }
    broadcast(userId, 'closed', { code });
    sessions.delete(userId);
  });

  proc.on('error', (err) => {
    broadcast(userId, 'output', { line: `[Sentinela] Erro ao iniciar o shell: ${err.message}`, stream: 'stderr' });
  });

  return session;
}

/**
 * Registra um cliente SSE para receber a saída do shell do usuário
 */
function addListener(userId, res) {
  const session = getOrCreateSession(userId);
  session.listeners.add(res);
  return session;
}

function removeListener(userId, res) {
  const session = sessions.get(userId);
  if (session) session.listeners.delete(res);
}

/**
 * Escreve um bloco de comandos (uma ou mais linhas) na entrada padrão do shell,
 * seguido de um marcador único para sinalizar ao cliente que o lote terminou.
 */
function execCommands(userId, commandsText) {
  const session = getOrCreateSession(userId);

  const commandLines = commandsText.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (commandLines.length === 0) return;

  commandLines.forEach((line) => broadcast(userId, 'echo', { line }));

  const marker = `__SENTINELA_DONE_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
  session.pendingMarker = marker;

  const payload = commandLines.join('\r\n') + `\r\necho ${marker}\r\n`;
  session.proc.stdin.write(iconv.encode(payload, detectOemCodepage()));
}

/**
 * Encerra o shell administrativo do usuário e limpa a sessão em memória
 */
function killSession(userId) {
  const session = sessions.get(userId);
  if (!session || !session.proc || !session.proc.pid) return;

  treeKill(session.proc.pid, 'SIGTERM', () => {
    // A limpeza do Map ocorre no handler 'close' do processo
  });
}

module.exports = {
  addListener,
  removeListener,
  execCommands,
  killSession,
  resolveDefaultCwd
};
