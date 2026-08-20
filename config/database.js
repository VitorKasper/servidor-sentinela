require('dotenv').config();
const { Sequelize } = require('sequelize');
const mysql = require('mysql2/promise');

const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
const dbUser = process.env.DB_USER || 'root';
const dbPass = process.env.DB_PASS || '';
const dbName = process.env.DB_NAME || 'servidor';

/**
 * Garante que o banco de dados MySQL exista antes de conectar com o Sequelize.
 */
async function ensureDatabaseExists() {
  try {
    const connection = await mysql.createConnection({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPass
    });
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await connection.end();
    console.log(`[Database] Banco de dados '${dbName}' verificado/criado com sucesso.`);
  } catch (error) {
    console.error(`[Database] Erro ao verificar criação do banco '${dbName}':`, error.message);
    throw error;
  }
}

const sequelize = new Sequelize(dbName, dbUser, dbPass, {
  host: dbHost,
  port: dbPort,
  dialect: 'mysql',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  define: {
    timestamps: true,
    underscored: false
  }
});

module.exports = {
  sequelize,
  ensureDatabaseExists
};
