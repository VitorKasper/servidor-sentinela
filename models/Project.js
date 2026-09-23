const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Project = sequelize.define('Project', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  workspaceId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'workspaces',
      key: 'id'
    },
    comment: 'ID do Workspace ao qual este projeto pertence (se houver)'
  },
  name: {
    type: DataTypes.STRING(120),
    allowNull: false
  },
  slug: {
    type: DataTypes.STRING(120),
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  projectType: {
    type: DataTypes.STRING(50),
    defaultValue: 'NODEJS',
    comment: 'Stack(s) do projeto separadas por vírgula, ex: "NODEJS,PYTHON". Valores possíveis: NODEJS, PYTHON, GENERIC'
  },
  repoUrl: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  branch: {
    type: DataTypes.STRING(80),
    defaultValue: 'main'
  },
  gitToken: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  installCommand: {
    type: DataTypes.STRING(255),
    defaultValue: 'npm install'
  },
  buildCommand: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  startCommand: {
    type: DataTypes.STRING(255),
    defaultValue: 'npm start'
  },
  envVars: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Formato KEY=VALUE por linha'
  },
  port: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('STOPPED', 'STARTING', 'RUNNING', 'BUILDING', 'ERROR', 'ORPHANED'),
    defaultValue: 'STOPPED'
  },
  pid: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  autoRestart: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  ignoreSsl: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Ignora verificação de certificados SSL (pip, npm, git e requisições HTTPS)'
  },
  autoSync: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Habilita monitoramento e deploy automático de novos commits do GitHub'
  },
  syncIntervalMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 2,
    comment: 'Intervalo de verificação em minutos'
  },
  lastCommitHash: {
    type: DataTypes.STRING(80),
    allowNull: true
  },
  currentCommitHash: {
    type: DataTypes.STRING(80),
    allowNull: true
  },
  lastSyncCheckAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastDeployedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  pipelineKey: {
    type: DataTypes.STRING(80),
    allowNull: true,
    comment: 'Chave estavel do terminal no pipeline do Workspace. Nulo para projetos avulsos'
  },
  pipelineSteps: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON das etapas proprias deste terminal, reexecutadas no reset individual'
  }
}, {
  tableName: 'projects'
});

module.exports = Project;
