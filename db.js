// Подключение к MySQL и мелкие помощники для работы с базой.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'isp-44_polehin_bs',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
});

// Короткая обёртка, чтобы не писать pool.query(...) в каждом маршруте.
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Читает sql/schema.sql и создаёт недостающие таблицы.
// Так при первом запуске не нужно руками импортировать дамп.
function schemaStatements() {
  const file = path.join(__dirname, 'sql', 'schema.sql');
  const text = fs.readFileSync(file, 'utf8');
  const withoutComments = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    // база уже выбрана в .env, поэтому CREATE DATABASE / USE пропускаем
    .filter((statement) => !/^(CREATE\s+DATABASE|USE)\b/i.test(statement));
}

async function ensureSchema() {
  for (const statement of schemaStatements()) {
    try {
      await pool.query(statement);
    } catch (error) {
      if (error.code === 'ER_TABLE_EXISTS_ERROR') continue;
      throw error;
    }
  }
}

module.exports = { pool, query, ensureSchema };
