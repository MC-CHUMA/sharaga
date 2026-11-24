// DM — серверная часть: Express + MySQL.
// Запуск:  npm install  ->  npm start   (по умолчанию http://localhost:3000)
require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');

const PORT = Number(process.env.PORT || 3000);
const COOKIE_NAME = 'dm_sid';
const SESSION_DAYS = 7;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

const DEMO_USERS = [
  { name: 'Админ', email: 'admin@deadlock.ru', password: 'admin123', role: 'admin', balance: 5000 },
  { name: 'Игрок', email: 'user@deadlock.ru', password: 'user123', role: 'user', balance: 2500 }
];

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Ошибки и обёртки ----------

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// ---------- Cookie и сессии ----------

function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function setSessionCookie(res, token) {
  const attributes = [
    COOKIE_NAME + '=' + token,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + SESSION_DAYS * 24 * 60 * 60
  ];
  if (COOKIE_SECURE) attributes.push('Secure');
  res.append('Set-Cookie', attributes.join('; '));
}

function clearSessionCookie(res) {
  const attributes = [COOKIE_NAME + '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (COOKIE_SECURE) attributes.push('Secure');
  res.append('Set-Cookie', attributes.join('; '));
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
    [token, userId, SESSION_DAYS]
  );
  return token;
}

// В каждый запрос подставляем пользователя, если есть живая сессия.
app.use(
  wrap(async (req, res, next) => {
    req.user = null;
    req.token = null;
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) {
      const rows = await db.query(
        `SELECT u.id, u.name, u.email, u.role, u.balance
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token = ? AND s.expires_at > NOW()`,
        [token]
      );
      if (rows[0]) {
        req.user = rows[0];
        req.token = token;
      }
    }
    next();
  })
);

function requireAuth(req) {
  if (!req.user) throw new ApiError(401, 'Сначала войди в профиль.');
  return req.user;
}

function requireAdmin(req) {
  const user = requireAuth(req);
  if (user.role !== 'admin') throw new ApiError(403, 'Только для администратора.');
  return user;
}

function publicUser(user) {
  if (!user) return null;
  return { name: user.name, email: user.email, role: user.role, balance: user.balance };
}

// ---------- Вспомогательные запросы ----------

async function cartInfo(userId) {
  if (!userId) return { items: [], total: 0, count: 0 };
  const rows = await db.query(
    `SELECT i.id, i.name, i.price, i.image, c.qty
       FROM cart c
       JOIN items i ON i.id = c.item_id
      WHERE c.user_id = ?
      ORDER BY i.name`,
    [userId]
  );
  const items = rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: Number(row.price),
    image: row.image,
    qty: Number(row.qty),
    sum: Number(row.price) * Number(row.qty)
  }));
  return {
    items,
    total: items.reduce((sum, item) => sum + item.sum, 0),
    count: items.reduce((sum, item) => sum + item.qty, 0)
  };
}

async function favoritesCount(userId) {
  if (!userId) return 0;
  const rows = await db.query('SELECT COUNT(*) AS total FROM favorites WHERE user_id = ?', [userId]);
  return Number(rows[0].total);
}

// tailSql содержит WHERE/ORDER BY, чтобы один помощник обслуживал и профиль, и админку.
async function loadRequests(tailSql, params = []) {
  const rows = await db.query(
    `SELECT r.id, r.type, r.total, r.status, r.created_at,
            u.name AS user_name, u.email AS user_email
       FROM requests r
       JOIN users u ON u.id = r.user_id
       ${tailSql}`,
    params
  );
  if (!rows.length) return [];

  const ids = rows.map((row) => row.id);
  const items = await db.query(
    'SELECT request_id, name, price, qty FROM request_items WHERE request_id IN (?)',
    [ids]
  );
  const byRequest = new Map(ids.map((id) => [id, []]));
  for (const item of items) {
    byRequest.get(item.request_id).push({
      name: item.name,
      price: Number(item.price),
      qty: Number(item.qty)
    });
  }

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    total: Number(row.total),
    status: row.status,
    createdAt: row.created_at,
    userName: row.user_name,
    email: row.user_email,
    items: byRequest.get(row.id)
  }));
}

function parseIntField(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function validateEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
    throw new ApiError(400, 'Введи корректный email.');
  }
  return email;
}

// ---------- Аккаунт ----------

app.post(
  '/api/register',
  wrap(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 100);
    const email = validateEmail(req.body.email);
    const password = String(req.body.password || '');

    if (name.length < 1) throw new ApiError(400, 'Введи имя.');
    if (password.length < 4) throw new ApiError(400, 'Пароль должен быть не короче 4 символов.');

    const existing = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) throw new ApiError(409, 'Такой email уже есть.');

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.pool.query(
      "INSERT INTO users (name, email, password_hash, role, balance) VALUES (?, ?, ?, 'user', 0)",
      [name, email, hash]
    );
    const token = await createSession(result.insertId);
    setSessionCookie(res, token);

    const user = { name, email, role: 'user', balance: 0 };
    res.status(201).json({ user });
  })
);

app.post(
  '/api/login',
  wrap(async (req, res) => {
    const email = validateEmail(req.body.email);
    const password = String(req.body.password || '');

    const rows = await db.query(
      'SELECT id, name, email, role, balance, password_hash FROM users WHERE email = ?',
      [email]
    );
    const found = rows[0];
    if (!found || !(await bcrypt.compare(password, found.password_hash))) {
      throw new ApiError(401, 'Неправильный email или пароль.');
    }

    const token = await createSession(found.id);
    setSessionCookie(res, token);
    res.json({ user: publicUser(found) });
  })
);

app.post(
  '/api/logout',
  wrap(async (req, res) => {
    if (req.token) await db.query('DELETE FROM sessions WHERE token = ?', [req.token]);
    clearSessionCookie(res);
    res.json({ ok: true });
  })
);

// ---------- Состояние для интерфейса ----------

app.get(
  '/api/state',
  wrap(async (req, res) => {
    const user = req.user;
    const [cart, favorites, requests] = await Promise.all([
      cartInfo(user ? user.id : null),
      favoritesCount(user ? user.id : null),
      user
        ? loadRequests('WHERE r.user_id = ? ORDER BY r.created_at DESC, r.id DESC', [user.id])
        : Promise.resolve([])
    ]);

    res.json({
      user: publicUser(user),
      requests,
      cartCount: cart.count,
      cartTotal: cart.total,
      favoritesCount: favorites
    });
  })
);

// ---------- Каталог ----------

app.get(
  '/api/products',
  wrap(async (req, res) => {
    const category = String(req.query.category || 'all');
    const search = String(req.query.search || '').trim();
    const userId = req.user ? req.user.id : 0;

    let sql =
      `SELECT i.id, i.name, i.category, i.price, i.image, i.description,
              (f.user_id IS NOT NULL) AS liked
         FROM items i
         LEFT JOIN favorites f ON f.item_id = i.id AND f.user_id = ?
        WHERE 1 = 1`;
    const params = [userId];

    if (category !== 'all') {
      sql += ' AND i.category = ?';
      params.push(category);
    }
    if (search) {
      sql += ' AND (i.name LIKE ? OR i.description LIKE ?)';
      params.push('%' + search + '%', '%' + search + '%');
    }
    sql += ' ORDER BY i.category, i.price, i.name LIMIT 500';

    const rows = await db.query(sql, params);
    res.json({
      items: rows.map((row) => ({ ...row, price: Number(row.price), liked: Boolean(row.liked) }))
    });
  })
);

// ---------- Избранное ----------

app.get(
  '/api/favorites',
  wrap(async (req, res) => {
    const user = requireAuth(req);
    const rows = await db.query(
      `SELECT i.id, i.name, i.category, i.price, i.image, i.description
         FROM favorites f
         JOIN items i ON i.id = f.item_id
        WHERE f.user_id = ?
        ORDER BY f.added_at DESC`,
      [user.id]
    );
    res.json({
      items: rows.map((row) => ({ ...row, price: Number(row.price), liked: true }))
    });
  })
);

app.post(
  '/api/favorites/:id',
  wrap(async (req, res) => {
    const user = requireAuth(req);
    const itemId = parseIntField(req.params.id);
    if (itemId === null) throw new ApiError(400, 'Некорректный предмет.');

    const item = await db.query('SELECT id FROM items WHERE id = ?', [itemId]);
    if (!item.length) throw new ApiError(404, 'Предмет не найден.');

    const existing = await db.query(
      'SELECT item_id FROM favorites WHERE user_id = ? AND item_id = ?',
      [user.id, itemId]
    );

    if (existing.length) {
      await db.query('DELETE FROM favorites WHERE user_id = ? AND item_id = ?', [user.id, itemId]);
      return res.json({ favorite: false });
    }

    await db.query('INSERT INTO favorites (user_id, item_id) VALUES (?, ?)', [user.id, itemId]);
    res.json({ favorite: true });
  })
);

// ---------- Корзина ----------

app.get(
  '/api/cart',
  wrap(async (req, res) => {
    const user = requireAuth(req);
    res.json(await cartInfo(user.id));
  })
);

app.post(
  '/api/cart',
  wrap(async (req, res) => {
    const user = requireAuth(req);
    const itemId = parseIntField(req.body.itemId);
    if (itemId === null) throw new ApiError(400, 'Некорректный предмет.');

    const item = await db.query('SELECT id FROM items WHERE id = ?', [itemId]);
    if (!item.length) throw new ApiError(404, 'Предмет не найден.');

    await db.query(
      `INSERT INTO cart (user_id, item_id, qty) VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE qty = qty + 1`,
      [user.id, itemId]
    );
    res.json(await cartInfo(user.id));
  })
);

app.put(
  '/api/cart/:id',
  wrap(async (req, res) => {
    const user = requireAuth(req);
    const itemId = parseIntField(req.params.id);
    if (itemId === null) throw new ApiError(400, 'Некорректный предмет.');

    const rows = await db.query('SELECT qty FROM cart WHERE user_id = ? AND item_id = ?', [
      user.id,
      itemId
    ]);
    if (!rows.length) return res.json(await cartInfo(user.id));

    // delta = +1 / -1 с фронтенда, либо конкретное количество в qty
    const delta = parseIntField(req.body.delta);
    const absolute = parseIntField(req.body.qty);
    const qty = absolute !== null ? absolute : Number(rows[0].qty) + (delta === null ? 0 : delta);

    if (qty <= 0) {
      await db.query('DELETE FROM cart WHERE user_id = ? AND item_id = ?', [user.id, itemId]);
    } else {
      await db.query('UPDATE cart SET qty = ? WHERE user_id = ? AND item_id = ?', [
        Math.min(qty, 99),
        user.id,
        itemId
      ]);
    }
    res.json(await cartInfo(user.id));
  })
);

app.delete(
  '/api/cart/:id',
  wrap(async (req, res) => {
    const user = requireAuth(req);
    const itemId = parseIntField(req.params.id);
    if (itemId === null) throw new ApiError(400, 'Некорректный предмет.');
    await db.query('DELETE FROM cart WHERE user_id = ? AND item_id = ?', [user.id, itemId]);
    res.json(await cartInfo(user.id));
  })
);

// ---------- Заявки ----------

app.post(
  '/api/orders',
  wrap(async (req, res) => {
    const user = requireAuth(req);
    const connection = await db.pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT c.item_id, c.qty, i.name, i.price
           FROM cart c
           JOIN items i ON i.id = c.item_id
          WHERE c.user_id = ?
          ORDER BY i.name
            FOR UPDATE`,
        [user.id]
      );
      if (!rows.length) throw new ApiError(400, 'Корзина пустая.');

      const total = rows.reduce((sum, row) => sum + Number(row.price) * Number(row.qty), 0);

      const [request] = await connection.query(
        "INSERT INTO requests (user_id, type, total, status) VALUES (?, 'order', ?, 'pending')",
        [user.id, total]
      );

      await connection.query(
        'INSERT INTO request_items (request_id, item_id, name, price, qty) VALUES ?',
        [rows.map((row) => [request.insertId, row.item_id, row.name, row.price, row.qty])]
      );
      await connection.query('DELETE FROM cart WHERE user_id = ?', [user.id]);

      await connection.commit();
      res.status(201).json({ id: request.insertId, total });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);

app.post(
  '/api/topup',
  wrap(async (req, res) => {
    const user = requireAuth(req);
    const amount = parseIntField(req.body.amount);
    if (amount === null || amount < 1 || amount > 100000) {
      throw new ApiError(400, 'Введи число от 1 до 100000.');
    }

    const [result] = await db.pool.query(
      "INSERT INTO requests (user_id, type, total, status) VALUES (?, 'topup', ?, 'pending')",
      [user.id, amount]
    );
    res.status(201).json({ id: result.insertId, total: amount });
  })
);

// ---------- Админка ----------

app.get(
  '/api/admin/requests',
  wrap(async (req, res) => {
    requireAdmin(req);
    const requests = await loadRequests(
      "ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.id DESC"
    );
    res.json({ requests });
  })
);

app.post(
  '/api/admin/requests/:id/approve',
  wrap(async (req, res) => {
    requireAdmin(req);
    const id = parseIntField(req.params.id);
    if (id === null) throw new ApiError(400, 'Некорректная заявка.');

    const connection = await db.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        'SELECT id, user_id, type, total, status FROM requests WHERE id = ? FOR UPDATE',
        [id]
      );
      const request = rows[0];
      if (!request) throw new ApiError(404, 'Заявка не найдена.');
      if (request.status !== 'pending') throw new ApiError(400, 'Заявка уже обработана.');

      if (request.type === 'order') {
        const [users] = await connection.query(
          'SELECT balance FROM users WHERE id = ? FOR UPDATE',
          [request.user_id]
        );
        if (Number(users[0].balance) < Number(request.total)) {
          throw new ApiError(400, 'Не хватает душ на балансе.');
        }
        await connection.query('UPDATE users SET balance = balance - ? WHERE id = ?', [
          request.total,
          request.user_id
        ]);
      } else {
        await connection.query('UPDATE users SET balance = balance + ? WHERE id = ?', [
          request.total,
          request.user_id
        ]);
      }

      await connection.query("UPDATE requests SET status = 'approved' WHERE id = ?", [id]);
      await connection.commit();
      res.json({ ok: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);

app.post(
  '/api/admin/requests/:id/reject',
  wrap(async (req, res) => {
    requireAdmin(req);
    const id = parseIntField(req.params.id);
    if (id === null) throw new ApiError(400, 'Некорректная заявка.');

    const [result] = await db.pool.query(
      "UPDATE requests SET status = 'rejected' WHERE id = ? AND status = 'pending'",
      [id]
    );
    if (!result.affectedRows) throw new ApiError(400, 'Заявка не найдена или уже обработана.');
    res.json({ ok: true });
  })
);

// ---------- Служебное ----------

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Такого адреса API нет.' });
});

app.use((error, req, res, next) => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON в запросе.' });
  }
  console.error('Ошибка сервера:', error);
  res.status(500).json({ error: 'Ошибка сервера. Попробуй позже.' });
});

// ---------- Старт ----------

async function seedDemoUsers() {
  if (process.env.SEED_DEMO_USERS === 'false') return;
  const rows = await db.query('SELECT COUNT(*) AS total FROM users');
  if (Number(rows[0].total) > 0) return;

  for (const account of DEMO_USERS) {
    const hash = await bcrypt.hash(account.password, 10);
    await db.query(
      'INSERT IGNORE INTO users (name, email, password_hash, role, balance) VALUES (?, ?, ?, ?, ?)',
      [account.name, account.email, hash, account.role, account.balance]
    );
  }
  console.log('Созданы демо-аккаунты: admin@deadlock.ru / admin123, user@deadlock.ru / user123');
}

async function importItemsIfEmpty() {
  const rows = await db.query('SELECT COUNT(*) AS total FROM items');
  if (Number(rows[0].total) > 0) return;

  console.log('Таблица items пустая — загружаю предметы из Deadlock API…');
  try {
    const count = await require('./import-items').importItems();
    console.log('Готово, предметов загружено: ' + count);
  } catch (error) {
    console.error('Не удалось загрузить предметы: ' + error.message);
    console.error('Можно запустить вручную: npm run import-items');
  }
}

async function start() {
  await db.ensureSchema();
  await db.query('DELETE FROM sessions WHERE expires_at < NOW()');
  await seedDemoUsers();

  app.listen(PORT, () => {
    console.log('Сайт запущен: http://localhost:' + PORT);
  });

  // каталог грузим в фоне, чтобы сайт открывался сразу
  importItemsIfEmpty().catch((error) => console.error(error.message));
}

start().catch((error) => {
  console.error('Сервер не запустился: ' + error.message);
  console.error('Проверь параметры подключения в файле .env');
  process.exit(1);
});
