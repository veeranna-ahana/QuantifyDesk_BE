const mysql = require('mysql2/promise');
require('dotenv').config();

// Quantify DB connection pool (main application DB)
const quantifyPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Master DB connection pool (for employee data)
const masterPool = mysql.createPool({
  host: process.env.MASTER_DB_HOST || process.env.DB_HOST,
  user: process.env.MASTER_DB_USER || process.env.DB_USER,
  password: process.env.MASTER_DB_PASSWORD || process.env.DB_PASSWORD,
  database: process.env.MASTER_DB_NAME || 'master',
  port: process.env.MASTER_DB_PORT ? Number(process.env.MASTER_DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Project Code DB connection pool (for customer names dropdown)
const projectCodePool = mysql.createPool({
  host: process.env.PROJECT_CODE_DB_HOST || process.env.DB_HOST,
  user: process.env.PROJECT_CODE_DB_USER || process.env.DB_USER,
  password: process.env.PROJECT_CODE_DB_PASSWORD || process.env.DB_PASSWORD,
  database: process.env.PROJECT_CODE_DB_NAME || process.env.DB_NAME,
  port: process.env.PROJECT_CODE_DB_PORT ? Number(process.env.PROJECT_CODE_DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * Helper to run parameterized queries on Quantify DB.
 * @param {string} sql - SQL query string with placeholders.
 * @param {Array} [params] - Values for the placeholders.
 * @returns {Promise<any[]>} - Result rows.
 */
const query = async (sql, params = []) => {
  const [rows] = await quantifyPool.execute(sql, params);
  return rows;
};

/**
 * Helper to run parameterized queries on Master DB.
 * @param {string} sql - SQL query string with placeholders.
 * @param {Array} [params] - Values for the placeholders.
 * @returns {Promise<any[]>} - Result rows.
 */
const masterQuery = async (sql, params = []) => {
  const [rows] = await masterPool.execute(sql, params);
  return rows;
};

/**
 * Helper to run parameterized queries on Project Code DB.
 * @param {string} sql - SQL query string with placeholders.
 * @param {Array} [params] - Values for the placeholders.
 * @returns {Promise<any[]>} - Result rows.
 */
const projectCodeQuery = async (sql, params = []) => {
  try {
    const [rows] = await projectCodePool.execute(sql, params);
    return rows;
  } catch (err) {
    // If connection to projectCodePool fails (e.g. wrong password in .env), fallback to quantifyPool
    try {
      const [rows] = await quantifyPool.execute(sql, params);
      return rows;
    } catch (err2) {
      throw err;
    }
  }
};

module.exports = {
  quantifyPool,
  masterPool,
  projectCodePool,
  query,
  masterQuery,
  projectCodeQuery,
};