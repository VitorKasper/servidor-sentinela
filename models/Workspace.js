const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Workspace = sequelize.define('Workspace', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
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
  envVars: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Variáveis de ambiente globais compartilhadas por todos os projetos do workspace'
  },
  autoSync: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  syncIntervalMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 2
  },
  autoRestart: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  ignoreSsl: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
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
  pipelineDefinition: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Pipeline em YAML cadastrado pela UI. Usado quando o repositorio nao traz sentinela.yml'
  },
  pipelineSource: {
    type: DataTypes.ENUM('REPO', 'UI'),
    defaultValue: 'UI',
    comment: 'Origem observada do pipeline na ultima execucao (gravado pelo executor, nao e configuracao)'
  }
}, {
  tableName: 'workspaces'
});

module.exports = Workspace;
