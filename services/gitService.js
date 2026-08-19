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
      // Continua se não conseguir redefinir url
    }

    await git.fetch();
    await git.checkout(branch);
    const pullResult = await git.pull('origin', branch);
    const currentSha = await git.revparse(['HEAD']);
    logCallback(`[Git] Atualização concluída. Versão ativa: ${currentSha.slice(0, 7)}`);
    return { action: 'pull', path: projectDir, commitHash: currentSha.trim() };
  } else {
    logCallback(`[Git] Clonando repositório '${project.repoUrl}' na branch '${branch}'...`);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    const git = simpleGit();
    await git.clone(repoUrlWithAuth, projectDir, ['--branch', branch]);
    const localGit = simpleGit(projectDir);
    const currentSha = await localGit.revparse(['HEAD']);
    logCallback(`[Git] Clonagem concluída com sucesso em ${projectDir}. Versão inicial: ${currentSha.slice(0, 7)}`);
    return { action: 'clone', path: projectDir, commitHash: currentSha.trim() };
  }
}

/**
 * Consulta o SHA do commit mais recente na branch remota do GitHub sem precisar baixar o código
 */
async function getRemoteLatestCommit(repoUrl, branch = 'main', gitToken = null) {
  try {
    const repoUrlWithAuth = formatRepoUrl(repoUrl, gitToken);
    const git = simpleGit();
    const result = await git.listRemote([repoUrlWithAuth, `refs/heads/${branch}`]);
    
    if (result && result.trim()) {
      const parts = result.trim().split(/\s+/);
      if (parts.length >= 1) {
        return parts[0].trim();
      }
    }
    return null;
  } catch (error) {
    console.error(`[Git Remote Check Erro] ${repoUrl} (${branch}):`, error.message);
    return null;
  }
}

/**
 * Retorna o SHA do commit ativo localmente no projeto
 */
async function getLocalLatestCommit(slug) {
  const projectDir = getProjectPath(slug);
  if (!fs.existsSync(path.join(projectDir, '.git'))) return null;

  try {
    const git = simpleGit(projectDir);
    const sha = await git.revparse(['HEAD']);
    return sha ? sha.trim() : null;
  } catch (error) {
    return null;
  }
}

/**
 * Retorna o histórico de commits do repositório local
 */
async function getCommitHistory(slug, limit = 15) {
  const projectDir = getProjectPath(slug);
  if (!fs.existsSync(path.join(projectDir, '.git'))) return [];

  try {
    const git = simpleGit(projectDir);
    const currentSha = await git.revparse(['HEAD']);
    const logResult = await git.log({ maxCount: limit });

    return logResult.all.map(commit => ({
      hash: commit.hash,
      shortHash: commit.hash.slice(0, 7),
      author: commit.author_name,
      email: commit.author_email,
      date: commit.date,
      message: commit.message,
      isCurrent: commit.hash.trim() === currentSha.trim()
    }));
  } catch (error) {
    console.error(`[Git Log Erro] Slug ${slug}:`, error.message);
    return [];
  }
}

/**
 * Realiza o rollback / checkout para um commit específico sob demanda
 */
async function checkoutCommit(project, commitHash, logCallback = console.log) {
  const projectDir = getProjectPath(project.slug);
  if (!fs.existsSync(path.join(projectDir, '.git'))) {
    throw new Error('Repositório não encontrado localmente');
  }

  logCallback(`[Rollback Git] Executando checkout para a versão '${commitHash.slice(0, 7)}'...`);
  const git = simpleGit(projectDir);
  await git.checkout(commitHash);
  logCallback(`[Rollback Git] Versão '${commitHash.slice(0, 7)}' ativada com sucesso no diretório de execução.`);
  return commitHash;
}

/**
 * Restaura o repositório para a ponta mais recente da branch principal
 */
async function restoreBranch(project, logCallback = console.log) {
  const projectDir = getProjectPath(project.slug);
  const branch = project.branch || 'main';

  logCallback(`[Git] Retornando para a branch '${branch}' mais recente...`);
  const git = simpleGit(projectDir);
  await git.checkout(branch);
  await git.pull('origin', branch);
  const currentSha = await git.revparse(['HEAD']);
  logCallback(`[Git] Restaurado para a versão mais recente da branch '${branch}' (${currentSha.slice(0, 7)}).`);
  return currentSha.trim();
}

module.exports = {
  getProjectPath,
  cloneOrPull,
  getRemoteLatestCommit,
  getLocalLatestCommit,
  getCommitHistory,
  checkoutCommit,
  restoreBranch,
  STORAGE_ROOT
};
