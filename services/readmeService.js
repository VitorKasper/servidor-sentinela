const fs = require('fs');
const path = require('path');
const gitService = require('./gitService');

// Inicialização segura do Marked com suporte a fallback
let markedLib = null;
try {
  const markedPkg = require('marked');
  markedLib = markedPkg.marked || markedPkg;
  if (markedLib && typeof markedLib.setOptions === 'function') {
    markedLib.setOptions({
      gfm: true,
      breaks: true
    });
  }
} catch (e) {
  // Se o pacote marked ainda estiver sendo baixado ou não existir, usa o renderizador nativo
  console.log('[ReadmeService] Usando renderizador Markdown nativo otimizado.');
}

/**
 * Converte texto Markdown para HTML formatado e interpretado
 */
function parseMarkdownToHtml(mdText) {
  if (!mdText || typeof mdText !== 'string') return '';

  if (markedLib && typeof markedLib.parse === 'function') {
    try {
      return markedLib.parse(mdText);
    } catch (err) {
      console.warn('[ReadmeService] Aviso ao processar com marked, usando fallback:', err.message);
    }
  }

  // Fallback nativo: Conversão limpa de Markdown para HTML interpretado
  let content = mdText;

  // Escapa tags perigosas
  content = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Blocos de código pré-formatados com ```
  const codeBlocks = [];
  content = content.replace(/```([a-zA-Z0-9_\-\.]*)\r?\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre><code class="language-${lang || 'text'}">${code}</code></pre>`);
    return placeholder;
  });

  // Código inline `code`
  content = content.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Headings #, ##, ###, ####
  content = content
    .replace(/^####\s+(.*$)/gim, '<h4>$1</h4>')
    .replace(/^###\s+(.*$)/gim, (m, title) => {
      const id = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return `<h3 id="${id}">${title}</h3>`;
    })
    .replace(/^##\s+(.*$)/gim, (m, title) => {
      const id = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return `<h2 id="${id}">${title}</h2>`;
    })
    .replace(/^#\s+(.*$)/gim, (m, title) => {
      const id = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return `<h1 id="${id}">${title}</h1>`;
    });

  // Blockquotes >
  content = content.replace(/^\>\s+(.*$)/gim, '<blockquote>$1</blockquote>');

  // Negrito e Itálico ***, **, *
  content = content
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/___(.*?)___/g, '<strong><em>$1</em></strong>')
    .replace(/__(.*?)__/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');

  // Imagens e Badges ![alt](url)
  content = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

  // Links [text](url)
  content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Listas de tarefas (checklists [x], [ ])
  content = content
    .replace(/^\s*-\s+\[ \]\s+(.*$)/gim, '<ul><li><input type="checkbox" disabled /> $1</li></ul>')
    .replace(/^\s*-\s+\[x\]\s+(.*$)/gim, '<ul><li><input type="checkbox" checked disabled /> $1</li></ul>')
    .replace(/^\s*[-*+]\s+(.*$)/gim, '<ul><li>$1</li></ul>')
    .replace(/^\s*(\d+)\.\s+(.*$)/gim, '<ol><li>$2</li></ol>');

  // Mescla tags de listas consecutivas
  content = content
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/<\/ol>\s*<ol>/g, '');

  // Linhas horizontais --- ou ***
  content = content.replace(/^(?:---|\*\*\*|___)\s*$/gim, '<hr />');

  // Parágrafos e quebras de linha
  content = content
    .replace(/\r?\n\r?\n/g, '</p><p>')
    .replace(/\r?\n/g, '<br />');

  // Restaura blocos de código
  codeBlocks.forEach((block, idx) => {
    content = content.replace(`__CODE_BLOCK_${idx}__`, block);
  });

  return `<p>${content}</p>`;
}


// Pastas ignoradas na busca recursiva de documentação
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  'env',
  'dist',
  'build',
  '__pycache__',
  '.next',
  '.nuxt',
  '.cache',
  'vendor',
  'storage',
  '.idea',
  '.vscode',
  'tmp',
  'temp',
  '.github'
]);

/**
 * Formata bytes em formato legível (B, KB, MB)
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Determina o tipo descritivo amigável do arquivo para a listagem estilo Windows Explorer
 */
function getFriendlyFileType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'Documento Markdown (.md)';
  if (lower.endsWith('.txt')) return 'Documento de Texto (.txt)';
  if (lower.endsWith('.rst')) return 'Documento reStructuredText (.rst)';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'Documento HTML';
  return 'Arquivo de Documentação';
}

/**
 * Busca recursivamente todos os arquivos README no diretório do projeto
 */
function findReadmesInDir(rootDir, currentDir = rootDir, results = []) {
  if (!fs.existsSync(currentDir)) return results;

  try {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          findReadmesInDir(rootDir, fullPath, results);
        }
      } else if (entry.isFile()) {
        // Verifica se o nome do arquivo inicia com 'readme' (ex: README.md, readme.txt, README-pt.md, etc.)
        if (/^readme(\..+)?$/i.test(entry.name)) {
          const stats = fs.statSync(fullPath);
          const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
          const dirRelative = path.dirname(relativePath).replace(/\\/g, '/');
          const isRoot = dirRelative === '.' || dirRelative === '';

          results.push({
            name: entry.name,
            relativePath,
            directory: isRoot ? 'Raiz do Projeto (/)' : dirRelative + '/',
            fullPath,
            sizeBytes: stats.size,
            sizeFormatted: formatFileSize(stats.size),
            modifiedTimestamp: stats.mtimeMs,
            modifiedAtFormatted: stats.mtime.toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }),
            isRoot,
            fileType: getFriendlyFileType(entry.name)
          });
        }
      }
    }
  } catch (error) {
    console.error(`[ReadmeService] Erro ao escanear diretório ${currentDir}:`, error.message);
  }

  return results;
}

/**
 * Retorna todos os READMEs de um determinado projeto
 */
function findProjectReadmes(projectSlug) {
  const projectDir = gitService.getProjectPath(projectSlug);
  if (!fs.existsSync(projectDir)) {
    return [];
  }

  const readmes = findReadmesInDir(projectDir, projectDir, []);

  // Ordena: Primeiro o README da raiz, depois os demais por pasta e nome alfabético
  readmes.sort((a, b) => {
    if (a.isRoot && !b.isRoot) return -1;
    if (!a.isRoot && b.isRoot) return 1;
    return a.relativePath.localeCompare(b.relativePath);
  });

  return readmes;
}

/**
 * Verifica rapidamente se o projeto possui pelo menos um README
 */
function hasReadmes(projectSlug) {
  const list = findProjectReadmes(projectSlug);
  return list.length > 0;
}

/**
 * Extrai títulos (Headings) do Markdown para sumário/Table of Contents
 */
function extractHeadings(rawMarkdown) {
  const headings = [];
  const lines = rawMarkdown.split(/\r?\n/);
  const headingRegex = /^(#{1,3})\s+(.+)$/;

  for (const line of lines) {
    const match = line.match(headingRegex);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '').trim();
      const id = text.toLowerCase().replace(/[^\w\u00C0-\u017F\s-]/g, '').replace(/\s+/g, '-');
      headings.push({ level, text, id });
    }
  }

  return headings;
}

/**
 * Lê e interpreta um arquivo README específico com segurança contra path traversal
 */
function getReadmeContent(projectSlug, relativeFilePath = null) {
  const projectDir = gitService.getProjectPath(projectSlug);
  if (!fs.existsSync(projectDir)) {
    return {
      success: false,
      error: 'Repositório do projeto ainda não foi clonado ou não existe.'
    };
  }

  const readmes = findProjectReadmes(projectSlug);
  if (readmes.length === 0) {
    return {
      success: false,
      error: 'Nenhum arquivo README encontrado no projeto.',
      readmes: []
    };
  }

  let selectedReadme = null;

  if (relativeFilePath) {
    // Sanitização e prevenção contra Path Traversal
    const safeRelative = path.normalize(relativeFilePath).replace(/^(\.\.[\/\\])+/, '');
    selectedReadme = readmes.find(r => r.relativePath === safeRelative || r.relativePath === relativeFilePath.replace(/\\/g, '/'));
  }

  // Se nenhum específico foi solicitado ou encontrado, seleciona o primeiro (geralmente raiz)
  if (!selectedReadme) {
    selectedReadme = readmes[0];
  }

  try {
    const rawContent = fs.readFileSync(selectedReadme.fullPath, 'utf8');
    
    // Converte Markdown para HTML interpretado usando marked ou fallback nativo
    const htmlContent = parseMarkdownToHtml(rawContent);


    // Estatísticas de leitura
    const wordCount = rawContent.trim().split(/\s+/).filter(Boolean).length;
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
    const lineCount = rawContent.split(/\r?\n/).length;
    const headings = extractHeadings(rawContent);

    return {
      success: true,
      selectedFile: selectedReadme,
      readmes,
      rawContent,
      htmlContent,
      stats: {
        wordCount,
        readingTimeMinutes,
        lineCount,
        fileCount: readmes.length
      },
      headings
    };
  } catch (error) {
    console.error(`[ReadmeService] Erro ao ler README ${selectedReadme.fullPath}:`, error);
    return {
      success: false,
      error: `Erro ao ler arquivo: ${error.message}`,
      readmes
    };
  }
}

module.exports = {
  findProjectReadmes,
  hasReadmes,
  getReadmeContent
};
