const { Project } = require('../models');
const gitService = require('./gitService');
const processManager = require('./processManager');

let syncIntervalTimer = null;
let isChecking = false;

/**
 * Executa uma rodada de verificação de commits remotos para projetos com Auto-Sync ativo
 */
async function checkProjectsForUpdates(io = null) {
  if (isChecking) return;
  isChecking = true;

  try {
    const activeAutoSyncProjects = await Project.findAll({
      where: { autoSync: true }
    });

    const now = Date.now();

    for (const project of activeAutoSyncProjects) {
      const intervalMs = (project.syncIntervalMinutes || 2) * 60 * 1000;
      const lastCheck = project.lastSyncCheckAt ? new Date(project.lastSyncCheckAt).getTime() : 0;

      // Verifica se o tempo decorrido atingiu o intervalo configurado
      if (now - lastCheck >= intervalMs) {
        // Se o projeto já estiver em deploy manual no momento, aguarda a próxima rodada
        if (project.status === 'BUILDING') continue;

        const remoteSha = await gitService.getRemoteLatestCommit(
          project.repoUrl,
          project.branch,
          project.gitToken
        );

        if (remoteSha) {
          const currentLocalSha = project.currentCommitHash || project.lastCommitHash;

          // Se o commit remoto for diferente do que está rodando localmente
          if (!currentLocalSha || currentLocalSha.trim() !== remoteSha.trim()) {
            console.log(`[AutoSync] Novo commit detectado para '${project.name}' (${remoteSha.slice(0, 7)}). Disparando deploy automático...`);
            processManager.appendLog(
              project.id,
              `[AutoSync] 🚀 Novo commit detectado no GitHub (${remoteSha.slice(0, 7)}). Iniciando Re-Deploy automático...`,
              io
            );

            // Dispara o deploy
            processManager.deployProject(project.id, io).catch((err) => {
              console.error(`[AutoSync Erro] Falha no deploy automático do Projeto #${project.id}:`, err.message);
            });
          }
        }

        // Atualiza a data da última checagem
        project.lastSyncCheckAt = new Date();
        await project.save();
      }
    }
  } catch (error) {
    console.error('[AutoSync Engine Erro]:', error.message);
  } finally {
    isChecking = false;
  }
}

/**
 * Inicializa o motor de verificação periódica do Auto-Sync
 */
function startAutoSyncEngine(io = null, checkIntervalSeconds = 30) {
  if (syncIntervalTimer) clearInterval(syncIntervalTimer);

  console.log(`[AutoSync] Motor de sincronização automática ativado (verificação a cada ${checkIntervalSeconds}s).`);
  
  // Roda uma verificação inicial após 10 segundos
  setTimeout(() => {
    checkProjectsForUpdates(io);
  }, 10000);

  // Intervalo regular
  syncIntervalTimer = setInterval(() => {
    checkProjectsForUpdates(io);
  }, checkIntervalSeconds * 1000);
}

/**
 * Encerra o timer do motor
 */
function stopAutoSyncEngine() {
  if (syncIntervalTimer) {
    clearInterval(syncIntervalTimer);
    syncIntervalTimer = null;
  }
}

module.exports = {
  startAutoSyncEngine,
  stopAutoSyncEngine,
  checkProjectsForUpdates
};
