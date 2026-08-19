const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DeploymentLog = sequelize.define('DeploymentLog', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  projectId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  action: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('SUCCESS', 'FAILED', 'INFO'),
    defaultValue: 'INFO'
  },
  details: {
    type: DataTypes.TEXT('long'),
    allowNull: true
  }
}, {
  tableName: 'deployment_logs'
});

module.exports = DeploymentLog;
