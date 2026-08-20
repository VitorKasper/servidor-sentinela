const { sequelize } = require('../config/database');
const User = require('./User');
const Project = require('./Project');
const DeploymentLog = require('./DeploymentLog');
const SystemSetting = require('./SystemSetting');

// Relacionamentos
Project.hasMany(DeploymentLog, { foreignKey: 'projectId', as: 'logs', onDelete: 'CASCADE' });
DeploymentLog.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });

/**
 * Inicializa tabelas e insere dados padrão caso não existam
 */
async function syncAndSeed() {
  await sequelize.sync({ alter: true });
  console.log('[Database] Tabelas sincronizadas com sucesso.');

  // Configurações padrão da empresa / marca
  const companyNameSetting = await SystemSetting.findOne({ where: { key: 'company_name' } });
  if (!companyNameSetting) {
    await SystemSetting.create({ key: 'company_name', value: 'Seu nome' });
  }

  const companyTagSetting = await SystemSetting.findOne({ where: { key: 'company_tag' } });
  if (!companyTagSetting) {
    await SystemSetting.create({ key: 'company_tag', value: 'Server PaaS Hub' });
  }

  // Verifica se já existem usuários
  const count = await User.count();
  if (count === 0) {
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@servidor.local';
    const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    const adminName = process.env.DEFAULT_ADMIN_NAME || 'Administrador';

    const opEmail = process.env.DEFAULT_OPERATOR_EMAIL || 'operador@servidor.local';
    const opPass = process.env.DEFAULT_OPERATOR_PASSWORD || 'operador123';
    const opName = process.env.DEFAULT_OPERATOR_NAME || 'Operador';

    await User.create({
      name: adminName,
      email: adminEmail,
      password: adminPass,
      role: 'ADMIN'
    });

    await User.create({
      name: opName,
      email: opEmail,
      password: opPass,
      role: 'OPERATOR'
    });

    console.log(`[Database] Usuários padrão criados:`);
    console.log(`  - ADMIN:    ${adminEmail} (senha: ${adminPass})`);
    console.log(`  - OPERADOR: ${opEmail} (senha: ${opPass})`);
  }
}

module.exports = {
  sequelize,
  User,
  Project,
  DeploymentLog,
  SystemSetting,
  syncAndSeed
};
