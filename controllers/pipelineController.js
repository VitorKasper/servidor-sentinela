const workspaceService = require('../services/workspaceService');
const pipelineRunner = require('../services/pipelineRunner');
const pipelineService = require('../services/pipelineService');

/**
 * Normaliza o payload do editor visual em uma definição no formato do pipelineService.
 * A validação de verdade acontece no parse do YAML serializado — aqui só damos forma.
 */
function definitionFromForm(body) {
  const setup = (Array.isArray(body.setup) ? body.setup : [])
    .filter(s => s && String(s.run || '').trim())
    .map(s => ({
      name: String(s.name || '').trim() || String(s.run).trim(),
      run: String(s.run).trim(),
      cwd: (s.cwd && String(s.cwd).trim()) ? String(s.cwd).trim() : null
    }));

  const terminals = (Array.isArray(body.terminals) ? body.terminals : [])
    .filter(t => t && (String(t.key || '').trim() || String(t.start || '').trim()))
    .map(t => ({
      key: String(t.key || '').trim(),
      name: String(t.name || '').trim() || String(t.key || '').trim(),
      port: (t.port === undefined || t.port === null || String(t.port).trim() === '')
        ? null
        : parseInt(String(t.port).trim(), 10),
      type: String(t.type || 'NODEJS').trim().toUpperCase(),
      cwd: (t.cwd && String(t.cwd).trim()) ? String(t.cwd).trim() : null,
      steps: (Array.isArray(t.steps) ? t.steps : [])
        .filter(s => s && String(s.run || '').trim())
        .map(s => ({
          name: String(s.name || '').trim() || String(s.run).trim(),
          run: String(s.run).trim(),
          cwd: (s.cwd && String(s.cwd).trim()) ? String(s.cwd).trim() : null
        })),
      start: String(t.start || '').trim(),
      env: (t.env && String(t.env).trim()) ? String(t.env).trim() : null
    }));

  return { version: pipelineService.SUPPORTED_VERSION, setup, terminals };
}

/**
 * Exibe o editor de pipeline do Workspace
 */
exports.show = async (req, res) => {
  try {
    const workspace = await workspaceService.getWorkspaceById(req.params.id);
    if (!workspace) {
      req.flash('error', 'Workspace não encontrado.');
      return res.redirect('/workspaces');
    }

    const efetiva = await pipelineRunner.getEffectiveDefinition(workspace.id);

    res.render('workspaces/pipeline', {
      title: `Pipeline: ${workspace.name} - Servidor Sentinela`,
      workspace,
      pipeline: efetiva
    });
  } catch (error) {
    console.error('[PipelineController] Erro ao abrir o editor de pipeline:', error);
    req.flash('error', `Erro ao abrir o pipeline: ${error.message}`);
    res.redirect(`/workspaces/${req.params.id}`);
  }
};

/**
 * Salva a definição montada no editor visual (JSON) ou colada como YAML
 */
exports.save = async (req, res) => {
  try {
    const efetiva = await pipelineRunner.getEffectiveDefinition(req.params.id);
    if (efetiva.readOnly) {
      return res.status(409).json({
        success: false,
        error: `Este workspace é governado pelo '${efetiva.fileName}' versionado no repositório. Edite o pipeline lá.`
      });
    }

    // O editor envia a estrutura montada na UI; o modo avançado envia o YAML cru.
    const def = (typeof req.body.yaml === 'string' && req.body.yaml.trim())
      ? pipelineService.parseDefinition(req.body.yaml)
      : definitionFromForm(req.body);

    const yaml = await pipelineRunner.saveUiDefinition(req.params.id, def);

    return res.json({
      success: true,
      yaml,
      message: 'Pipeline salvo. Rode um deploy do workspace para aplicá-lo.'
    });
  } catch (error) {
    console.error('[PipelineController] Erro ao salvar pipeline:', error.message);
    return res.status(400).json({ success: false, error: error.message });
  }
};

// Exportado para teste: a conversão do payload do editor é a fronteira entre UI e pipeline.
exports.definitionFromForm = definitionFromForm;
