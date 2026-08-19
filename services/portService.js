const { exec } = require('child_process');
const net = require('net');
const { Project } = require('../models');

/**
 * Tenta abrir um servidor TCP na porta especificada para testar se está realmente livre
 */
function testPortAvailability(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.on('error', () => {
      resolve(false); // Porta ocupada
    });

    server.listen(port, '0.0.0.0', () => {
      server.close(() => {
        resolve(true); // Porta livre
      });
    });
  });
}

/**
 * Mapeamento de portas conhecidas comuns
 */
const KNOWN_SERVICES = {
  21: 'FTP',
  22: 'SSH',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP Web Server',
  443: 'HTTPS Web Server',
  3000: 'Servidor Sentinela (Hub Principal)',
  3306: 'MySQL Database',
  5432: 'PostgreSQL Database',
  6379: 'Redis',
  8080: 'HTTP Proxy / Web App',
  8443: 'HTTPS Alternate',
  27017: 'MongoDB Database'
};

/**
 * Executa o netstat do sistema operacional e retorna todas as portas TCP em estado LISTENING
 */
function getSystemListeningPorts() {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'netstat -ano -p tcp' : 'netstat -tuln';

    exec(command, (error, stdout) => {
      if (error) {
        console.error('[PortService] Erro ao executar netstat:', error.message);
        return resolve([]);
      }

      const occupiedPortsMap = new Map();
      const lines = stdout.split(/\r?\n/);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (isWindows) {
          // Exemplo Windows: TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234
          if (/LISTENING/i.test(trimmed)) {
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 5) {
              const localAddress = parts[1];
              const pid = parseInt(parts[4], 10);
              const portMatch = localAddress.match(/:(\d+)$/);

              if (portMatch) {
                const port = parseInt(portMatch[1], 10);
                if (!occupiedPortsMap.has(port)) {
                  occupiedPortsMap.set(port, {
                    port,
                    pid: isNaN(pid) ? null : pid,
                    protocol: 'TCP',
                    localAddress
                  });
                }
              }
            }
          }
        } else {
          // Linux / Unix netstat
          if (/LISTEN/i.test(trimmed)) {
            const parts = trimmed.split(/\s+/);
            const localAddress = parts[3];
            const portMatch = localAddress.match(/:(\d+)$/);
            if (portMatch) {
              const port = parseInt(portMatch[1], 10);
              if (!occupiedPortsMap.has(port)) {
                occupiedPortsMap.set(port, {
                  port,
                  pid: null,
                  protocol: 'TCP',
                  localAddress
                });
              }
            }
          }
        }
      }

      const result = Array.from(occupiedPortsMap.values()).sort((a, b) => a.port - b.port);
      resolve(result);
    });
  });
}

/**
 * Retorna todas as portas ocupadas cruzando com os projetos cadastrados no Sentinela
 */
async function getOccupiedPorts() {
  const systemPorts = await getSystemListeningPorts();
  let projects = [];

  try {
    projects = await Project.findAll({
      attributes: ['id', 'name', 'slug', 'port', 'status', 'pid']
    });
  } catch (err) {
    // Se o banco não estiver acessível, prossegue apenas com as portas do sistema operacional
  }

  // Mapeia projetos por porta
  const projectByPort = new Map();
  for (const proj of projects) {
    if (proj.port) {
      projectByPort.set(parseInt(proj.port, 10), proj);
    }
  }

  const enrichedPorts = systemPorts.map(item => {
    const project = projectByPort.get(item.port) || null;
    let description = 'Serviço do Sistema';

    if (project) {
      description = `Projeto Sentinela: ${project.name}`;
    } else if (KNOWN_SERVICES[item.port]) {
      description = KNOWN_SERVICES[item.port];
    } else if (item.port === parseInt(process.env.PORT || '3000', 10)) {
      description = 'Servidor Sentinela (Hub)';
    }

    return {
      port: item.port,
      pid: item.pid,
      protocol: item.protocol,
      localAddress: item.localAddress,
      description,
      project: project ? {
        id: project.id,
        name: project.name,
        slug: project.slug,
        status: project.status,
        pid: project.pid
      } : null
    };
  });

  // Também inclui projetos cadastrados com porta definida, mesmo se não estiverem rodando agora
  for (const proj of projects) {
    if (proj.port) {
      const portNum = parseInt(proj.port, 10);
      const existsInSystem = enrichedPorts.some(p => p.port === portNum);
      if (!existsInSystem) {
        enrichedPorts.push({
          port: portNum,
          pid: proj.pid || null,
          protocol: 'TCP (Reservado)',
          localAddress: `0.0.0.0:${portNum}`,
          description: `Projeto Sentinela: ${proj.name} (Parado/Reservado)`,
          project: {
            id: proj.id,
            name: proj.name,
            slug: proj.slug,
            status: proj.status,
            pid: proj.pid
          }
        });
      }
    }
  }

  return enrichedPorts.sort((a, b) => a.port - b.port);
}

/**
 * Encontra a próxima porta livre a partir de um valor inicial (padrão: 3001)
 */
async function suggestAvailablePort(startFrom = 3001, maxAttempts = 100) {
  const occupiedList = await getOccupiedPorts();
  const occupiedSet = new Set(occupiedList.map(item => item.port));

  let current = Math.max(1024, parseInt(startFrom, 10) || 3001);

  for (let i = 0; i < maxAttempts; i++) {
    if (!occupiedSet.has(current)) {
      const isFree = await testPortAvailability(current);
      if (isFree) {
        return current;
      }
    }
    current++;
  }

  return current;
}

/**
 * Verifica a disponibilidade de uma porta específica
 */
async function checkPortAvailability(port) {
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return { available: false, error: 'Número de porta inválido (1-65535)' };
  }

  const occupiedList = await getOccupiedPorts();
  const occupied = occupiedList.find(p => p.port === portNum);

  if (occupied) {
    return {
      available: false,
      port: portNum,
      usedBy: occupied.description,
      pid: occupied.pid,
      project: occupied.project
    };
  }

  const isFree = await testPortAvailability(portNum);
  return {
    available: isFree,
    port: portNum,
    usedBy: isFree ? null : 'Processo não identificado'
  };
}

module.exports = {
  getOccupiedPorts,
  suggestAvailablePort,
  checkPortAvailability,
  testPortAvailability
};
