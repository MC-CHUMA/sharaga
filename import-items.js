// Заполняет таблицу items предметами из Deadlock API.
// Запуск вручную:  npm run import-items
// Сервер сам вызывает этот скрипт при первом старте, если таблица пустая.
require('dotenv').config();

const db = require('./db');

const GROUP_NAMES = { spirit: 'Спирит', weapon: 'Ган', vitality: 'Живучесть' };
const API_URL = 'https://api.deadlock-api.com/v1/assets/items?language=';

// Из HTML-описания убираем иконки, скрипты и теги — остаётся обычный текст.
function cleanText(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function pickDescription(item, category) {
  let text = item.description;
  if (text && typeof text === 'object') text = text.desc || text.active || text.passive;
  text = cleanText(text);
  if (text) return text;

  const labels = [];
  const properties = item.properties || {};
  for (const key of Object.keys(properties)) {
    if (properties[key] && properties[key].label) labels.push(properties[key].label);
  }
  if (labels.length) return 'Улучшает характеристики: ' + labels.join(', ') + '.';
  return 'Предмет категории «' + category + '». Описание не указано.';
}

async function fetchJson(language) {
  const response = await fetch(API_URL + language);
  if (!response.ok) throw new Error('Deadlock API ответил ' + response.status);
  return response.json();
}

async function importItems({ log = console.log } = {}) {
  log('Загружаю предметы из Deadlock API…');
  const [english, russian] = await Promise.all([fetchJson('english'), fetchJson('russian')]);
  const russianById = new Map(russian.map((item) => [item.id, item]));

  const rows = [];
  for (const item of english) {
    const category = GROUP_NAMES[item.item_slot_type];
    const price = Number(item.cost || item.price || 0);
    if (!item.shopable || !category || !item.name || !price || price === 9999) continue;

    const ruItem = russianById.get(item.id) || {};
    const image = item.shop_image_small_webp || item.shop_image_webp || item.image_webp || item.image || '';

    rows.push([
      item.id,
      item.name.slice(0, 150),
      category,
      price,
      image.slice(0, 500),
      pickDescription(ruItem, category)
    ]);
  }

  const CHUNK = 200;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    for (const row of chunk) {
      // Значения передаём дважды: так работает и в MySQL 5.7, и в 8.x, и в 9.x
      // (функция VALUES() в новых версиях устарела).
      await db.query(
        `INSERT INTO items (id, name, category, price, image, description)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = ?, category = ?, price = ?, image = ?, description = ?`,
        [...row, ...row.slice(1)]
      );
    }
  }

  log('Предметов в базе после импорта: ' + rows.length);
  return rows.length;
}

if (require.main === module) {
  importItems()
    .then(() => db.pool.end())
    .catch(async (error) => {
      console.error('Импорт не удался: ' + error.message);
      await db.pool.end();
      process.exit(1);
    });
}

module.exports = { importItems };
