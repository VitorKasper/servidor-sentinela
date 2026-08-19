const path = require('path');
const fs = require('fs');
const { SystemSetting } = require('../models');

// Cache em memória para acesso ultrarrápido em todas as rotas/templates
let cachedSettings = {
  company_name: 'SENTINELA',
  company_tag: 'Server PaaS Hub',
  company_logo_url: null
};

/**
 * Carrega as configurações do banco de dados para a memória
 */
async function loadSettings() {
  try {
    const settings = await SystemSetting.findAll();
    for (const item of settings) {
      cachedSettings[item.key] = item.value;
    }
  } catch (err) {
    // Se o banco ainda não estiver pronto, usa os valores padrão
  }
}

// Inicializa o cache imediatamente
loadSettings();

/**
 * Retorna o nome da empresa configurado
 */
function getCompanyName() {
  return cachedSettings.company_name || 'SENTINELA';
}

/**
 * Retorna o subtítulo / tag da empresa
 */
function getCompanyTag() {
  return cachedSettings.company_tag || 'Server PaaS Hub';
}

/**
 * Retorna a URL da imagem da logo (ou null se vazia)
 */
function getCompanyLogoUrl() {
  return cachedSettings.company_logo_url || null;
}

/**
 * Atualiza o nome, tag e/ou imagem da logo da empresa
 */
async function updateCompany(companyName, companyTag, newLogoUrl = null, removeLogo = false, io = null) {
  const newName = (companyName && companyName.trim()) ? companyName.trim() : 'SENTINELA';
  const newTag = (companyTag && companyTag.trim()) ? companyTag.trim() : 'Server PaaS Hub';

  let currentLogoUrl = cachedSettings.company_logo_url || null;

  if (removeLogo) {
    // Exclui arquivo antigo do disco se existir
    if (currentLogoUrl) {
      const oldFilePath = path.resolve(process.cwd(), 'public', currentLogoUrl.replace(/^\//, ''));
      if (fs.existsSync(oldFilePath)) {
        try { fs.unlinkSync(oldFilePath); } catch (e) {}
      }
    }
    currentLogoUrl = null;
  } else if (newLogoUrl) {
    // Se uma nova imagem foi enviada, remove a anterior
    if (currentLogoUrl && currentLogoUrl !== newLogoUrl) {
      const oldFilePath = path.resolve(process.cwd(), 'public', currentLogoUrl.replace(/^\//, ''));
      if (fs.existsSync(oldFilePath)) {
        try { fs.unlinkSync(oldFilePath); } catch (e) {}
      }
    }
    currentLogoUrl = newLogoUrl;
  }

  await SystemSetting.upsert({ key: 'company_name', value: newName });
  await SystemSetting.upsert({ key: 'company_tag', value: newTag });
  await SystemSetting.upsert({ key: 'company_logo_url', value: currentLogoUrl || '' });

  cachedSettings.company_name = newName;
  cachedSettings.company_tag = newTag;
  cachedSettings.company_logo_url = currentLogoUrl;

  // Notifica todos os clientes conectados na LAN via Socket.IO
  if (io) {
    io.emit('company_updated', {
      companyName: newName,
      companyTag: newTag,
      companyLogoUrl: currentLogoUrl
    });
  }

  return {
    companyName: newName,
    companyTag: newTag,
    companyLogoUrl: currentLogoUrl
  };
}

module.exports = {
  loadSettings,
  getCompanyName,
  getCompanyTag,
  getCompanyLogoUrl,
  updateCompany
};
