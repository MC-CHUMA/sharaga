// Запуск сайта вместе с локальной базой MySQL.
// Нужен только для работы на своём компьютере: на хостинге база уже работает,
// там достаточно «npm start».
//
// Что делает:
// 1. если базы в папке ~/mysql-local ещё нет — создаёт её (mysqld --initialize-insecure);
// 2. если MySQL не запущен — запускает его на порту 3307;
// 3. создаёт базу dm_local, если её нет;
// 4. запускает server.js.
//
// Остановить базу: node local-start.js --stop
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const fs = require('node:fs');

const PORT = Number(process.env.LOCAL_DB_PORT || 3307);
const DB_NAME = process.env.LOCAL_DB_NAME || 'dm_local';
const HOME_DIR = path.join(os.homedir(), 'mysql-local');
const DATA_DIR = path.join(HOME_DIR, 'data');

function findBaseDir() {
  if (process.env.MYSQL_HOME) return process.env.MYSQL_HOME;
  if (!fs.existsSync(HOME_DIR)) return null;
  const dirs = fs
    .readdirSync(HOME_DIR)
    .filter((name) => fs.existsSync(path.join(HOME_DIR, name, 'bin', 'mysqld.exe')))
    .sort();
  return dirs.length ? path.join(HOME_DIR, dirs[dirs.length - 1]) : null;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1500);
    socket.on('connect', () => { socket.end(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function waitForPort(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await portOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { encoding: 'utf8', ...options });
  return result;
}

function stopDatabase(baseDir) {
  if (!baseDir) return;
  const admin = path.join(baseDir, 'bin', 'mysqladmin.exe');
  const result = run(admin, ['-u', 'root', '-h', '127.0.0.1', '-P', String(PORT), 'shutdown']);
  console.log(result.status === 0 ? 'Локальная база остановлена.' : 'Не удалось остановить базу.');
}

async function main() {
  const baseDir = findBaseDir();
  if (!baseDir) {
    console.error('Не найдена папка MySQL в ' + HOME_DIR + '.');
    console.error('Скачай Windows ZIP с https://dev.mysql.com/downloads/mysql/ и распакуй в ' + HOME_DIR + '.');
    process.exit(1);
  }

  if (process.argv.includes('--stop')) {
    stopDatabase(baseDir);
    return;
  }

  const mysqld = path.join(baseDir, 'bin', 'mysqld.exe');
  const mysql = path.join(baseDir, 'bin', 'mysql.exe');

  if (!fs.existsSync(path.join(DATA_DIR, 'mysql'))) {
    console.log('Первый запуск: создаю локальную базу в ' + DATA_DIR + ' …');
    const init = run(mysqld, ['--initialize-insecure', '--basedir', baseDir, '--datadir', DATA_DIR]);
    if (init.status !== 0) {
      console.error('Не удалось создать базу.');
      console.error((init.stderr || init.stdout || '').trim());
      process.exit(1);
    }
  }

  if (!(await portOpen(PORT))) {
    console.log('Запускаю MySQL на порту ' + PORT + ' …');
    const child = spawn(
      mysqld,
      [
        '--basedir', baseDir,
        '--datadir', DATA_DIR,
        '--port', String(PORT),
        '--mysqlx=OFF',
        '--skip-log-bin',
        '--console'
      ],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref();

    if (!(await waitForPort(PORT, 90000))) {
      console.error('MySQL не запустился за 90 секунд. Проверь папку ' + DATA_DIR + '.');
      process.exit(1);
    }
  }

  const createDb = run(mysql, [
    '-u', 'root',
    '-h', '127.0.0.1',
    '-P', String(PORT),
    '-e',
    'CREATE DATABASE IF NOT EXISTS `' + DB_NAME + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'
  ]);
  if (createDb.status !== 0) {
    console.error('Не удалось создать базу ' + DB_NAME + ':');
    console.error((createDb.stderr || createDb.stdout || '').trim());
    process.exit(1);
  }

  console.log('База готова. Запускаю сайт: http://localhost:' + (process.env.PORT || 3000));
  require('./server.js');
}

main();
