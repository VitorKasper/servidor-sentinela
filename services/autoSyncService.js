const { Project, Workspace } = require('../models');
const gitService = require('./gitService');
const processManager = require('./processManager');
const workspaceService = require('./workspaceService');

let syncIntervalTimer = null;
let isChecking = false;

/**
 * Executa uma rodada de verificação de commits remotos para projetos e workspaces com Auto-Sync ativo
 */
async function checkProjectsForUpdates(io = null) {
  if (isChecking) return;
  isChecking = true;

  try {
    const now = Date.now();

    // 1. Verificação de Workspaces com Auto-Sync ativo
    const activeAutoSyncWorkspaces = await Workspace.findAll({
      where: { autoSync: true },
      include: [{ model: Project, as: 'projects' }]
    });

    for (const workspace of activeAutoSyncWorkspaces) {
      const intervalMs = (workspace.syncIntervalMinutes || 2) * 60 * 1000;
      const lastCheck = workspace.lastSyncCheckAt ? new Date(workspace.lastSyncCheckAt).getTime() : 0;

      if (now - lastCheck >= intervalMs) {
        const remoteSha = await gitService.getRemoteLatestCommit(
          workspace.repoUrl,
          workspace.branch,
          workspace.gitToken
        );

        if (remoteSha) {
          const currentLocalSha = workspace.currentCommitHash || workspace.lastCommitHash;

          if (!currentLocalSha || currentLocalSha.trim() !== remoteSha.trim()) {
            console.log(`[AutoSync Workspace] Novo commit detectado no GitHub para '${workspace.name}' (${remoteSha.slice(0, 7)}). Disparando Re-Deploy dos projetos...`);

            if (workspace.projects && workspace.projects.length > 0) {
              workspace.projects.forEach(p => {
                processManager.appendLog(
                  p.id,
                  `[AutoSync Workspace] 🚀 Novo commit detectado no GitHub (${remoteSha.slice(0, 7)}). Atualizando o Workspace...`,
                  io
                );
              });
            }

            workspaceService.deployWorkspace(workspace.id, io).catch((err) => {
              console.error(`[AutoSync Erro] Falha no deploy automático do Workspace #${workspace.id}:`, err.message);
            });

            workspace.currentCommitHash = remoteSha;
            workspace.lastCommitHash = remoteSha;
          }
        }

        workspace.lastSyncCheckAt = new Date();
        await workspace.save();
      }
    }

    // 2. Verificação de Projetos Individuais (sem Workspace) com Auto-Sync ativo
    const activeAutoSyncProjects = await Project.findAll({
      where: { autoSync: true, workspaceId: null }
    });

    for (const project of activeAutoSyncProjects) {
      const intervalMs = (project.syncIntervalMinutes || 2) * 60 * 1000;
      const lastCheck = project.lastSyncCheckAt ? new Date(project.lastSyncCheckAt).getTime() : 0;

      if (now - lastCheck >= intervalMs) {
        if (project.status === 'BUILDING') continue;

        const remoteSha = await gitService.getRemoteLatestCommit(
          project.repoUrl,
          project.branch,
          project.gitToken
        );

        if (remoteSha) {
          const currentLocalSha = project.currentCommitHash || project.lastCommitHash;

          if (!currentLocalSha || currentLocalSha.trim() !== remoteSha.trim()) {
            console.log(`[AutoSync] Novo commit detectado para '${project.name}' (${remoteSha.slice(0, 7)}). Disparando deploy automático...`);
            processManager.appendLog(
              project.id,
              `[AutoSync] 🚀 Novo commit detectado no GitHub (${remoteSha.slice(0, 7)}). Iniciando Re-Deploy automático...`,
              io
            );

            processManager.deployProject(project.id, io).catch((err) => {
              console.error(`[AutoSync Erro] Falha no deploy automático do Projeto #${project.id}:`, err.message);
            });
          }
        }

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
  
  setTimeout(() => {
    checkProjectsForUpdates(io);
  }, 10000);

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
