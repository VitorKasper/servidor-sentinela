const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Project = sequelize.define('Project', {
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
  projectType: {
    type: DataTypes.ENUM('NODEJS', 'PYTHON', 'GENERIC'),
    defaultValue: 'NODEJS',
    comment: 'Stack do projeto (Node.js, Python com venv isolado, Genérico)'
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
    type: DataTypes.ENUM('STOPPED', 'STARTING', 'RUNNING', 'BUILDING', 'ERROR'),
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
  }
}, {
  tableName: 'projects'
});

module.exports = Project;
