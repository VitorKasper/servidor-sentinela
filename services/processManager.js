const { spawn, exec } = require('child_process');
const path = require('path');
const treeKill = require('tree-kill');
const gitService = require('./gitService');
const { Project, DeploymentLog } = require('../models');

const fs = require('fs');

// Map em memória para gerenciar os processos e logs dos projetos
// Key: projectId (Number) -> Value: { process: ChildProcess, logs: Array<String>, status: String }
const runningProcesses = new Map();

/**
 * Utilitário para formatar e adicionar log ao buffer e emitir via Socket.IO
 */
function appendLog(projectId, text, io = null) {
  if (!runningProcesses.has(projectId)) {
    runningProcesses.set(projectId, { process: null, logs: [], status: 'STOPPED' });
  }

  const projectEntry = runningProcesses.get(projectId);
  const timestamp = new Date().toLocaleTimeString('pt-BR');
  const formattedMessage = `[${timestamp}] ${text}`;

  // Mantém no máximo 1000 linhas de histórico em memória
  if (projectEntry.logs.length >= 1000) {
    projectEntry.logs.shift();
  }
  projectEntry.logs.push(formattedMessage);

  // Emite para a sala específica do projeto no Socket.IO se disponível
  if (io) {
    io.to(`project:${projectId}`).emit('project_log', {
      projectId,
      message: formattedMessage
    });
  }
}

/**
 * Converte o texto de variáveis de ambiente KEY=VALUE em objeto e injeta venv isolado se existir
 */
function parseEnvVars(envString, customPort = null, projectDir = null) {
  const env = { ...process.env };

  if (envString) {
    const lines = envString.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const index = trimmed.indexOf('=');
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim();
        if (key) {
          env[key] = value;
        }
      }
    }
  }

  if (customPort) {
    env.PORT = String(customPort);
  }

  // Se o diretório do projeto possuir um ambiente virtual Python (venv ou .venv),
  // injeta o diretório de executáveis no início da variável PATH.
  if (projectDir && fs.existsSync(projectDir)) {
    const isWindows = process.platform === 'win32';
    const venvDir = fs.existsSync(path.join(projectDir, 'venv'))
      ? path.join(projectDir, 'venv')
      : (fs.existsSync(path.join(projectDir, '.venv')) ? path.join(projectDir, '.venv') : null);

    if (venvDir) {
      const venvBin = isWindows ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
      if (fs.existsSync(venvBin)) {
        const currentPath = env.PATH || env.Path || '';
        env.PATH = `${venvBin}${path.delimiter}${currentPath}`;
        env.Path = `${venvBin}${path.delimiter}${currentPath}`;
        env.VIRTUAL_ENV = venvDir;
      }
    }
  }

  return env;
}

/**
 * Garante a criação do ambiente virtual Python (venv) isolado
 */
async function ensurePythonVenv(project, projectDir, env, projectId, io) {
  const isPython = project.projectType === 'PYTHON' || fs.existsSync(path.join(projectDir, 'requirements.txt'));
  
  if (isPython) {
    const venvExists = fs.existsSync(path.join(projectDir, 'venv')) || fs.existsSync(path.join(projectDir, '.venv'));
    if (!venvExists) {
      appendLog(projectId, `[Python venv] Criando ambiente virtual isolado ('python -m venv venv')...`, io);
      await runCommand('python -m venv venv', projectDir, env, projectId, io);
      appendLog(projectId, `[Python venv] Ambiente virtual criado com sucesso. Pacotes serão instalados isoladamente.`, io);
    }
  }
}

/**
 * Executa um comando síncrono/assíncrono no diretório do projeto com streaming de logs
 */
function runCommand(command, cwd, env, projectId, io) {
  return new Promise((resolve, reject) => {
    appendLog(projectId, `[Cmd] Executando comando: ${command}`, io);

    const isWindows = process.platform === 'win32';
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      windowsHide: true
    });

    child.stdout.on('data', (data) => {
      const output = data.toString();
      output.split(/\r?\n/).forEach(line => {
        if (line.trim()) appendLog(projectId, line, io);
      });
    });

    child.stderr.on('data', (data) => {
      const output = data.toString();
      output.split(/\r?\n/).forEach(line => {
        if (line.trim()) appendLog(projectId, `[ERR] ${line}`, io);
      });
    });

    child.on('error', (err) => {
      appendLog(projectId, `[Cmd Erro] ${err.message}`, io);
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        appendLog(projectId, `[Cmd Sucesso] Comando finalizado com código 0.`, io);
        resolve(code);
      } else {
        appendLog(projectId, `[Cmd Falha] Comando finalizou com código de erro ${code}.`, io);
        reject(new Error(`Comando falhou com código ${code}`));
      }
    });
  });
}

/**
 * Inicia a execução contínua de um projeto
 */
async function startProject(projectId, io = null) {
  const project = await Project.findByPk(projectId);
  if (!project) throw new Error('Projeto não encontrado');

  const projectDir = gitService.getProjectPath(project.slug);
  const entry = runningProcesses.get(projectId) || { process: null, logs: [], status: 'STOPPED' };

  if (entry.process && !entry.process.killed) {
    appendLog(projectId, `[Sentinela] O projeto já está em execução (PID: ${entry.process.pid}).`, io);
    return { success: true, message: 'Já está em execução', pid: entry.process.pid };
  }

  appendLog(projectId, `[Sentinela] Iniciando aplicação com comando: '${project.startCommand}'...`, io);

  const env = parseEnvVars(project.envVars, project.port, projectDir);

  // Spawna o processo principal
  const child = spawn(project.startCommand, {
    cwd: projectDir,
    env,
    shell: true,
    windowsHide: true
  });

  entry.process = child;
  entry.status = 'RUNNING';
  runningProcesses.set(projectId, entry);

  // Atualiza banco
  project.status = 'RUNNING';
  project.pid = child.pid;
  await project.save();

  if (io) {
    io.emit('project_status', { projectId: project.id, status: 'RUNNING', pid: child.pid });
  }

  child.stdout.on('data', (data) => {
    const output = data.toString();
    output.split(/\r?\n/).forEach(line => {
      if (line.trim()) appendLog(projectId, line, io);
    });
  });

  child.stderr.on('data', (data) => {
    const output = data.toString();
    output.split(/\r?\n/).forEach(line => {
      if (line.trim()) appendLog(projectId, `[STDERR] ${line}`, io);
    });
  });

  child.on('error', async (err) => {
    appendLog(projectId, `[Processo Erro] Falha no processo: ${err.message}`, io);
    entry.status = 'ERROR';
    project.status = 'ERROR';
    project.pid = null;
    await project.save();
    if (io) io.emit('project_status', { projectId: project.id, status: 'ERROR', pid: null });
  });

  child.on('close', async (code) => {
    appendLog(projectId, `[Processo Encerrado] Processo saiu com código ${code}.`, io);
    entry.process = null;
    entry.status = code === 0 ? 'STOPPED' : 'ERROR';
    
    project.status = code === 0 ? 'STOPPED' : 'ERROR';
    project.pid = null;
    await project.save();

    if (io) {
      io.emit('project_status', { projectId: project.id, status: project.status, pid: null });
    }

    // Auto-Restart se habilitado e saída com erro
    if (code !== 0 && project.autoRestart) {
      appendLog(projectId, `[AutoRestart] Reiniciando projeto automaticamente em 3 segundos...`, io);
      setTimeout(() => {
        startProject(projectId, io).catch(e => console.error('Erro no AutoRestart:', e));
      }, 3000);
    }
  });

  return { success: true, pid: child.pid };
}

/**
 * Para a execução do projeto matando a árvore de processos
 */
async function stopProject(projectId, io = null) {
  const project = await Project.findByPk(projectId);
  if (!project) throw new Error('Projeto não encontrado');

  const entry = runningProcesses.get(projectId);
  if (!entry || !entry.process) {
    project.status = 'STOPPED';
    project.pid = null;
    await project.save();
    if (io) io.emit('project_status', { projectId: project.id, status: 'STOPPED', pid: null });
    return { success: true, message: 'Processo não estava em execução' };
  }

  const pid = entry.process.pid;
  appendLog(projectId, `[Sentinela] Solicitando parada do processo (PID: ${pid})...`, io);

  return new Promise((resolve) => {
    treeKill(pid, 'SIGTERM', async (err) => {
      if (err) {
        appendLog(projectId, `[Sentinela] Forçando encerramento via SIGKILL (PID: ${pid})...`, io);
        treeKill(pid, 'SIGKILL', async () => {
          entry.process = null;
          entry.status = 'STOPPED';
          project.status = 'STOPPED';
          project.pid = null;
          await project.save();
          if (io) io.emit('project_status', { projectId: project.id, status: 'STOPPED', pid: null });
          resolve({ success: true });
        });
      } else {
        entry.process = null;
        entry.status = 'STOPPED';
        project.status = 'STOPPED';
        project.pid = null;
        await project.save();
        if (io) io.emit('project_status', { projectId: project.id, status: 'STOPPED', pid: null });
        appendLog(projectId, `[Sentinela] Processo parado com sucesso.`, io);
        resolve({ success: true });
      }
    });
  });
}

/**
 * Reinicia o projeto (Stop + Start)
 */
async function restartProject(projectId, io = null) {
  appendLog(projectId, `[Sentinela] Solicitando reinicialização...`, io);
  await stopProject(projectId, io);
  await new Promise(r => setTimeout(r, 1000));
  return startProject(projectId, io);
}

/**
 * Realiza o Deploy completo (Clone/Pull -> Install -> Build -> Start)
 */
async function deployProject(projectId, io = null) {
  const project = await Project.findByPk(projectId);
  if (!project) throw new Error('Projeto não encontrado');

  appendLog(projectId, `=====================================================`, io);
  appendLog(projectId, `[Deploy] Iniciando processo de deploy para '${project.name}'...`, io);

  project.status = 'BUILDING';
  await project.save();
  if (io) io.emit('project_status', { projectId: project.id, status: 'BUILDING', pid: null });

  try {
    // 1. Para processo anterior se estiver rodando
    await stopProject(projectId, io);

    // 2. Clone ou Pull do repositório Git
    const gitResult = await gitService.cloneOrPull(project, (msg) => appendLog(projectId, msg, io));
    const projectDir = gitResult.path;

    // 3. Garante criação de ambiente virtual Python isolado se necessário
    const initialEnv = parseEnvVars(project.envVars, project.port, projectDir);
    await ensurePythonVenv(project, projectDir, initialEnv, projectId, io);

    // Recalcula variáveis de ambiente com o venv injetado no PATH
    const env = parseEnvVars(project.envVars, project.port, projectDir);

    // 4. Executa comando de instalação de dependências se configurado
    if (project.installCommand && project.installCommand.trim()) {
      appendLog(projectId, `[Deploy] Instalando dependências ('${project.installCommand}')...`, io);
      await runCommand(project.installCommand, projectDir, env, projectId, io);
    }

    // 5. Executa comando de build se configurado
    if (project.buildCommand && project.buildCommand.trim()) {
      appendLog(projectId, `[Deploy] Executando build ('${project.buildCommand}')...`, io);
      await runCommand(project.buildCommand, projectDir, env, projectId, io);
    }

    // 6. Inicia o projeto
    project.lastDeployedAt = new Date();
    if (gitResult && gitResult.commitHash) {
      project.currentCommitHash = gitResult.commitHash;
      project.lastCommitHash = gitResult.commitHash;
    }
    await project.save();

    await DeploymentLog.create({
      projectId: project.id,
      action: 'DEPLOY',
      status: 'SUCCESS',
      details: `Deploy concluído com sucesso (${gitResult?.commitHash?.slice(0, 7) || 'N/A'}) em ${new Date().toISOString()}`
    });

    appendLog(projectId, `[Deploy] Build e preparação finalizados. Iniciando aplicação...`, io);
    appendLog(projectId, `=====================================================`, io);

    return await startProject(projectId, io);
  } catch (error) {
    appendLog(projectId, `[Deploy Erro Crítico] ${error.message}`, io);
    appendLog(projectId, `=====================================================`, io);

    project.status = 'ERROR';
    await project.save();

    await DeploymentLog.create({
      projectId: project.id,
      action: 'DEPLOY',
      status: 'FAILED',
      details: error.message
    });

    if (io) io.emit('project_status', { projectId: project.id, status: 'ERROR', pid: null });
    throw error;
  }
}

/**
 * Reverte o projeto para uma versão / commit anterior sob demanda
 */
async function rollbackProject(projectId, commitHash, io = null) {
  const project = await Project.findByPk(projectId);
  if (!project) throw new Error('Projeto não encontrado');

  appendLog(projectId, `=====================================================`, io);
  appendLog(projectId, `[Rollback] Revertendo aplicação para a versão '${commitHash.slice(0, 7)}'...`, io);

  project.status = 'BUILDING';
  await project.save();
  if (io) io.emit('project_status', { projectId: project.id, status: 'BUILDING', pid: null });

  try {
    // 1. Para processo em execução
    await stopProject(projectId, io);

    // 2. Checkout do commit específico via Git
    await gitService.checkoutCommit(project, commitHash, (msg) => appendLog(projectId, msg, io));
    const projectDir = gitService.getProjectPath(project.slug);
    
    // 3. Garante venv
    const initialEnv = parseEnvVars(project.envVars, project.port, projectDir);
    await ensurePythonVenv(project, projectDir, initialEnv, projectId, io);
    const env = parseEnvVars(project.envVars, project.port, projectDir);

    // 4. Reinstala dependências da versão
    if (project.installCommand && project.installCommand.trim()) {
      appendLog(projectId, `[Rollback] Reinstalando dependências da versão...`, io);
      await runCommand(project.installCommand, projectDir, env, projectId, io);
    }

    // 5. Executa build se configurado
    if (project.buildCommand && project.buildCommand.trim()) {
      appendLog(projectId, `[Rollback] Executando build da versão...`, io);
      await runCommand(project.buildCommand, projectDir, env, projectId, io);
    }

    project.currentCommitHash = commitHash;
    project.lastDeployedAt = new Date();
    await project.save();

    await DeploymentLog.create({
      projectId: project.id,
      action: 'ROLLBACK',
      status: 'SUCCESS',
      details: `Revertido para a versão ${commitHash.slice(0, 7)} em ${new Date().toISOString()}`
    });

    appendLog(projectId, `[Rollback Sucesso] Aplicação ativada na versão ${commitHash.slice(0, 7)}.`, io);
    appendLog(projectId, `=====================================================`, io);

    return await startProject(projectId, io);
  } catch (error) {
    appendLog(projectId, `[Rollback Erro] ${error.message}`, io);
    appendLog(projectId, `=====================================================`, io);

    project.status = 'ERROR';
    await project.save();

    await DeploymentLog.create({
      projectId: project.id,
      action: 'ROLLBACK',
      status: 'FAILED',
      details: error.message
    });

    if (io) io.emit('project_status', { projectId: project.id, status: 'ERROR', pid: null });
    throw error;
  }
}

/**
 * Restaura o projeto para a versão mais recente da branch
 */
async function restoreProjectBranch(projectId, io = null) {
  const project = await Project.findByPk(projectId);
  if (!project) throw new Error('Projeto não encontrado');

  appendLog(projectId, `=====================================================`, io);
  appendLog(projectId, `[Restauração] Restaurando projeto para a ponta mais recente da branch '${project.branch}'...`, io);

  project.status = 'BUILDING';
  await project.save();
  if (io) io.emit('project_status', { projectId: project.id, status: 'BUILDING', pid: null });

  try {
    await stopProject(projectId, io);

    const latestSha = await gitService.restoreBranch(project, (msg) => appendLog(projectId, msg, io));
    const projectDir = gitService.getProjectPath(project.slug);
    
    const initialEnv = parseEnvVars(project.envVars, project.port, projectDir);
    await ensurePythonVenv(project, projectDir, initialEnv, projectId, io);
    const env = parseEnvVars(project.envVars, project.port, projectDir);

    if (project.installCommand && project.installCommand.trim()) {
      appendLog(projectId, `[Restauração] Atualizando dependências...`, io);
      await runCommand(project.installCommand, projectDir, env, projectId, io);
    }

    if (project.buildCommand && project.buildCommand.trim()) {
      appendLog(projectId, `[Restauração] Executando build...`, io);
      await runCommand(project.buildCommand, projectDir, env, projectId, io);
    }

    project.currentCommitHash = latestSha;
    project.lastCommitHash = latestSha;
    project.lastDeployedAt = new Date();
    await project.save();

    await DeploymentLog.create({
      projectId: project.id,
      action: 'RESTORE_BRANCH',
      status: 'SUCCESS',
      details: `Restaurado para a branch ${project.branch} (${latestSha.slice(0, 7)})`
    });

    appendLog(projectId, `[Restauração Sucesso] Projeto restaurado para a versão mais recente (${latestSha.slice(0, 7)}).`, io);
    appendLog(projectId, `=====================================================`, io);

    return await startProject(projectId, io);
  } catch (error) {
    appendLog(projectId, `[Restauração Erro] ${error.message}`, io);
    appendLog(projectId, `=====================================================`, io);

    project.status = 'ERROR';
    await project.save();
    if (io) io.emit('project_status', { projectId: project.id, status: 'ERROR', pid: null });
    throw error;
  }
}

/**
 * Retorna os logs em memória de um projeto
 */
function getLogs(projectId) {
  const entry = runningProcesses.get(parseInt(projectId, 10));
  return entry ? entry.logs : [];
}

/**
 * Limpa os logs em memória de um projeto
 */
function clearLogs(projectId, io = null) {
  const entry = runningProcesses.get(parseInt(projectId, 10));
  if (entry) {
    entry.logs = [];
    if (io) {
      io.to(`project:${projectId}`).emit('project_logs_cleared', { projectId });
    }
  }
}

/**
 * Verifica se um projeto está ativo
 */
function isProjectRunning(projectId) {
  const entry = runningProcesses.get(parseInt(projectId, 10));
  return !!(entry && entry.process && !entry.process.killed);
}

module.exports = {
  startProject,
  stopProject,
  restartProject,
  deployProject,
  rollbackProject,
  restoreProjectBranch,
  getLogs,
  clearLogs,
  isProjectRunning,
  appendLog
};
