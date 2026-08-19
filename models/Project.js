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
  lastDeployedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'projects'
});

module.exports = Project;
