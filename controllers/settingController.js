const settingService = require('../services/settingService');

/**
 * Atualiza o nome da empresa, subtítulo e/ou arquivo de imagem da logo
 */
exports.updateCompany = async (req, res) => {
  const { companyName, companyTag, removeLogo } = req.body;

  try {
    let newLogoUrl = null;

    if (req.file) {
      newLogoUrl = `/uploads/branding/${req.file.filename}`;
    }

    const shouldRemoveLogo = removeLogo === 'true' || removeLogo === true || removeLogo === '1';

    const io = req.app.get('io');
    const result = await settingService.updateCompany(
      companyName,
      companyTag,
      newLogoUrl,
      shouldRemoveLogo,
      io
    );

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({
        success: true,
        message: 'Logo e identidade da empresa atualizadas com sucesso!',
        data: result
      });
    }

    req.flash('success', 'Logo e identidade da empresa atualizadas com sucesso!');
    return res.redirect('back');
  } catch (error) {
    console.error('[SettingController] Erro ao atualizar empresa e logo:', error);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(500).json({ success: false, error: error.message });
    }
    req.flash('error', `Erro ao salvar configurações da empresa: ${error.message}`);
    return res.redirect('back');
  }
};
