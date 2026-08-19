const { Project } = require('../models');
const readmeService = require('../services/readmeService');

/**
 * Exibe a página do Leitor de READMEs com visual Windows Explorer
 */
exports.showReadmeView = async (req, res) => {
  try {
    const project = await Project.findByPk(req.params.id);
    if (!project) {
      req.flash('error', 'Projeto não encontrado.');
      return res.redirect('/projects');
    }

    const fileQuery = req.query.file || null;
    const readmeData = readmeService.getReadmeContent(project.slug, fileQuery);

    res.render('projects/readme', {
      title: `README: ${project.name} - Servidor Sentinela`,
      project,
      readmes: readmeData.readmes || [],
      selectedFile: readmeData.selectedFile || null,
      htmlContent: readmeData.htmlContent || '',
      rawContent: readmeData.rawContent || '',
      stats: readmeData.stats || { wordCount: 0, readingTimeMinutes: 1, lineCount: 0, fileCount: 0 },
      headings: readmeData.headings || [],
      readmeError: readmeData.success ? null : (readmeData.error || 'Nenhum README disponível.')
    });
  } catch (error) {
    console.error('[ReadmeController] Erro ao carregar tela de README:', error);
    req.flash('error', 'Erro ao carregar leitor de README do projeto.');
    res.redirect('/projects');
  }
};

/**
 * Retorna o conteúdo de um README específico via API JSON (carregamento dinâmico instantâneo)
 */
exports.getReadmeContentApi = async (req, res) => {
  try {
    const project = await Project.findByPk(req.params.id);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Projeto não encontrado' });
    }

    const fileQuery = req.query.file || null;
    const result = readmeService.getReadmeContent(project.slug, fileQuery);

    if (!result.success) {
      return res.status(404).json({ success: false, error: result.error, readmes: result.readmes || [] });
    }

    return res.json({
      success: true,
      data: {
        selectedFile: result.selectedFile,
        htmlContent: result.htmlContent,
        rawContent: result.rawContent,
        stats: result.stats,
        headings: result.headings,
        readmes: result.readmes
      }
    });
  } catch (error) {
    console.error('[ReadmeController API] Erro ao obter conteúdo do README:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
