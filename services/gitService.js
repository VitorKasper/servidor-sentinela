const path = require('path');
const fs = require('fs');
const simpleGit = require('simple-git');

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.PROJECTS_STORAGE_PATH || './storage/projects');

// Garante que o diretório base de storage existe
if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}

/**
 * Retorna o caminho absoluto do diretório do projeto
 */
function getProjectPath(slug) {
  return path.join(STORAGE_ROOT, slug);
}

/**
 * Constrói a URL do repositório incluindo token se informado
 */
function formatRepoUrl(repoUrl, gitToken) {
  let url = repoUrl.trim();
  if (gitToken && gitToken.trim()) {
    const token = gitToken.trim();
    if (url.startsWith('https://')) {
      url = url.replace('https://', `https://${token}@`);
    } else if (url.startsWith('http://')) {
      url = url.replace('http://', `http://${token}@`);
    }
  }
  return url;
}

/**
 * Clona ou atualiza o repositório Git do projeto
 */
async function cloneOrPull(project, logCallback = console.log) {
  const projectDir = getProjectPath(project.slug);
  const repoUrlWithAuth = formatRepoUrl(project.repoUrl, project.gitToken);
  const branch = project.branch || 'main';

  logCallback(`[Git] Verificando diretório do projeto: ${projectDir}`);

  if (fs.existsSync(path.join(projectDir, '.git'))) {
    logCallback(`[Git] Repositório existente detectado. Atualizando via 'git fetch & pull' na branch '${branch}'...`);
    const git = simpleGit(projectDir);
    
    // Configura remote caso a URL tenha mudado
    try {
      await git.remote(['set-url', 'origin', repoUrlWithAuth]);
    } catch {
      // Caso não consiga setar url, continua
    }

    await git.fetch();
    await git.checkout(branch);
    const pullResult = await git.pull('origin', branch);
    logCallback(`[Git] Atualização concluída. Resumo: ${JSON.stringify(pullResult.summary)}`);
    return { action: 'pull', path: projectDir };
  } else {
    logCallback(`[Git] Clonando repositório '${project.repoUrl}' na branch '${branch}'...`);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    const git = simpleGit();
    await git.clone(repoUrlWithAuth, projectDir, ['--branch', branch]);
    logCallback(`[Git] Clonagem concluída com sucesso em ${projectDir}.`);
    return { action: 'clone', path: projectDir };
  }
}

module.exports = {
  getProjectPath,
  cloneOrPull,
  STORAGE_ROOT
};
