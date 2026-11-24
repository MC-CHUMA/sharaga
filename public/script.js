// DM — интерфейс магазина. Все данные теперь берутся с сервера (/api), а не из localStorage.
const API = '/api';

let appState = { user: null, requests: [], cartCount: 0, favoritesCount: 0 };
let clicks = 0;
let timer;
let productsRequest = 0;

// ---------- Общение с сервером ----------

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) throw new Error((data && data.error) || 'Ошибка запроса к серверу.');
  return data;
}

async function loadState() {
  appState = await api('/state');
  updateHeader();
  return appState;
}

// ---------- Мелочи для интерфейса ----------

function money(value) {
  return Number(value).toLocaleString('ru-RU') + ' Душ';
}

function safe(text) {
  let box = document.createElement('div');
  box.textContent = text == null ? '' : text;
  return box.innerHTML;
}

function message(text) {
  let box = document.querySelector('#notice');
  box.textContent = text;
  box.classList.remove('hide');
  clearTimeout(timer);
  timer = setTimeout(function () { box.classList.add('hide'); }, 3000);
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(function (item) { item.classList.add('hide'); });
  document.querySelector('#page-' + name).classList.remove('hide');
  document.querySelectorAll('.nav-btn').forEach(function (item) {
    item.classList.toggle('active', item.dataset.page === name);
  });
  if (name === 'shop') renderProducts();
  if (name === 'favorites') renderFavorites();
  if (name === 'cart') renderCart();
  if (name === 'profile') renderProfile();
  if (name === 'admin') renderAdmin();
  window.scrollTo(0, 0);
}

function updateHeader() {
  document.querySelector('#cart-count').textContent = appState.cartCount || 0;
  document.querySelector('#fav-count').textContent = appState.favoritesCount || 0;
  document.querySelector('.admin-link').classList.toggle(
    'hide',
    !appState.user || appState.user.role !== 'admin'
  );
}

// ---------- Каталог ----------

async function renderProducts() {
  const label = document.querySelector('#catalog-status');
  const category = document.querySelector('#category').value;
  const search = document.querySelector('#search').value.trim();
  const requestId = ++productsRequest;

  label.textContent = 'Загружаю предметы игры…';

  try {
    const data = await api(
      '/products?category=' + encodeURIComponent(category) + '&search=' + encodeURIComponent(search)
    );
    if (requestId !== productsRequest) return; // пока грузился ответ, поиск уже изменился

    document.querySelector('#items').innerHTML = data.items.length
      ? data.items.map(card).join('')
      : '<p class="muted">Ничего не нашлось.</p>';
    label.textContent = 'Найдено предметов: ' + data.items.length;
  } catch (error) {
    if (requestId !== productsRequest) return;
    document.querySelector('#items').innerHTML = '';
    label.textContent = 'Не получилось загрузить предметы. Проверь, запущен ли сервер.';
  }
}

function card(item) {
  let image = item.image
    ? '<img src="' + safe(item.image) + '" alt="' + safe(item.name) + '" onerror="this.remove()">'
    : '';
  return '<article class="card" onclick="itemClick(event)">' +
    '<div class="photo"><span class="letter">' + safe(item.name[0]) + '</span>' + image +
    '<button class="heart ' + (item.liked ? 'liked' : '') + '" onclick="event.stopPropagation(); favorite(' + item.id + ')">' + (item.liked ? '♥' : '♡') + '</button></div>' +
    '<div class="info"><h2>' + safe(item.name) + '</h2><p class="desc">' + safe(item.description) + '</p>' +
    '<div class="card-bottom"><b class="price">' + money(item.price) + '</b>' +
    '<button class="btn" onclick="event.stopPropagation(); add(' + item.id + ')">В корзину</button></div></div></article>';
}

function itemClick(event) {
  let cardBox = event.currentTarget;
  let name = cardBox && cardBox.querySelector('h2');
  if (name && name.textContent.toLowerCase() === 'dispel magic') {
    clicks++;
    if (clicks === 15) document.body.classList.add('egg');
  }
}

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    document.body.classList.remove('egg');
    clicks = 0;
  }
});

document.querySelector('#category').onchange = renderProducts;
document.querySelector('#search').oninput = renderProducts;

// ---------- Корзина и избранное ----------

async function add(id) {
  if (!appState.user) return message('Сначала войди в профиль.');
  try {
    const cart = await api('/cart', { method: 'POST', body: JSON.stringify({ itemId: id }) });
    appState.cartCount = cart.count;
    updateHeader();
    message('Добавлено в корзину.');
  } catch (error) {
    message(error.message);
  }
}

async function favorite(id) {
  if (!appState.user) return message('Сначала войди в профиль.');
  try {
    const data = await api('/favorites/' + id, { method: 'POST' });
    appState.favoritesCount = Math.max(0, (appState.favoritesCount || 0) + (data.favorite ? 1 : -1));
    updateHeader();
    renderProducts();
    if (!document.querySelector('#page-favorites').classList.contains('hide')) renderFavorites();
  } catch (error) {
    message(error.message);
  }
}

async function renderFavorites() {
  const box = document.querySelector('#favorites');
  if (!appState.user) {
    box.innerHTML = '<p class="muted">Сначала войди в профиль.</p>';
    return;
  }
  try {
    const data = await api('/favorites');
    box.innerHTML = data.items.length
      ? data.items.map(card).join('')
      : '<p class="muted">Пока нет избранных предметов.</p>';
  } catch (error) {
    box.innerHTML = '<p class="muted">Не удалось загрузить избранное.</p>';
  }
}

async function renderCart(ready) {
  const box = document.querySelector('#cart');
  if (!appState.user) {
    box.innerHTML = '<div class="box muted">Сначала войди в профиль.</div>';
    return;
  }
  try {
    const data = ready || (await api('/cart'));
    appState.cartCount = data.count;
    updateHeader();

    if (!data.items.length) {
      box.innerHTML = '<div class="box muted">Корзина пустая.</div>';
      return;
    }

    const rows = data.items.map(function (item) {
      return '<div class="row"><b>' + safe(item.name) + ' × ' + item.qty + '</b>' +
        '<button class="btn" onclick="change(' + item.id + ',-1)">−</button>' +
        '<button class="btn" onclick="change(' + item.id + ',1)">+</button><b>' + money(item.sum) + '</b></div>';
    }).join('');

    box.innerHTML = rows + '<div class="row"><b>Итого: ' + money(data.total) + '</b>' +
      '<button class="btn" onclick="order()">Оформить заказ</button></div>';
  } catch (error) {
    box.innerHTML = '<div class="box muted">Не удалось загрузить корзину.</div>';
  }
}

async function change(id, delta) {
  try {
    const cart = await api('/cart/' + id, { method: 'PUT', body: JSON.stringify({ delta: delta }) });
    renderCart(cart);
  } catch (error) {
    message(error.message);
  }
}

async function order() {
  if (!appState.user) return message('Сначала войди в профиль.');
  try {
    await api('/orders', { method: 'POST' });
    await loadState();
    renderCart();
    message('Заказ отправлен администратору.');
  } catch (error) {
    message(error.message);
  }
}

// ---------- Профиль ----------

async function renderProfile() {
  const box = document.querySelector('#profile');

  if (!appState.user) {
    box.innerHTML = '<h2>Войти или создать профиль</h2><form class="form" onsubmit="login(event)">' +
      '<label>Email<input name="email" type="email" required></label>' +
      '<label>Пароль<input name="password" type="password" required></label>' +
      '<button class="btn">Войти</button></form>' +
      '<p>Нет аккаунта? <button class="link" onclick="registerForm()">Зарегистрироваться</button></p>' +
      '<p class="muted">Игрок: user@deadlock.ru / user123<br>Админ: admin@deadlock.ru / admin123</p>';
    return;
  }

  try {
    await loadState();
  } catch (error) {
    message('Не удалось обновить профиль.');
  }

  if (!appState.user) return renderProfile(); // сессия могла закончиться

  const me = appState.user;
  const rows = appState.requests.map(function (item) {
    const name = item.type === 'order' ? 'Заказ' : 'Пополнение';
    const list = (item.items || []).map(function (product) {
      return safe(product.name) + ' × ' + product.qty;
    }).join(', ');
    return '<div class="row">' + name + ' · ' + money(item.total) + ' — ' + status(item.status) +
      (list ? '<br><span class="muted">' + list + '</span>' : '') + '</div>';
  }).join('') || '<p class="muted">Заявок пока нет.</p>';

  box.innerHTML = '<h2>' + safe(me.name) + '</h2><p>' + safe(me.email) + '</p>' +
    '<p>Баланс: <b class="price">' + money(me.balance) + '</b></p>' +
    '<button class="btn" onclick="topup()">Запросить пополнение</button>' +
    '<h2>Мои заявки</h2>' + rows + '<button class="link" onclick="logout()">Выйти</button>';
}

function registerForm() {
  document.querySelector('#profile').innerHTML = '<h2>Создать профиль</h2>' +
    '<form class="form" onsubmit="register(event)">' +
    '<label>Имя<input name="name" required></label>' +
    '<label>Email<input name="email" type="email" required></label>' +
    '<label>Пароль<input name="password" type="password" minlength="4" required></label>' +
    '<button class="btn">Создать</button></form>' +
    '<button class="link" onclick="renderProfile()">Назад ко входу</button>';
}

async function login(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  try {
    await api('/login', {
      method: 'POST',
      body: JSON.stringify({ email: data.get('email'), password: data.get('password') })
    });
    await loadState();
    renderProfile();
    message('Ты вошёл в профиль.');
  } catch (error) {
    message(error.message);
  }
}

async function register(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  try {
    await api('/register', {
      method: 'POST',
      body: JSON.stringify({
        name: data.get('name'),
        email: data.get('email'),
        password: data.get('password')
      })
    });
    await loadState();
    renderProfile();
    message('Профиль создан.');
  } catch (error) {
    message(error.message);
  }
}

async function logout() {
  try {
    await api('/logout', { method: 'POST' });
    await loadState();
    renderProfile();
    message('Ты вышел из профиля.');
  } catch (error) {
    message(error.message);
  }
}

async function topup() {
  const amount = Number(prompt('Сколько душ запросить?'));
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
    return message('Введи число от 1 до 100000.');
  }

  try {
    await api('/topup', { method: 'POST', body: JSON.stringify({ amount: amount }) });
    await loadState();
    renderProfile();
    message('Заявка на пополнение отправлена.');
  } catch (error) {
    message(error.message);
  }
}

function status(value) {
  if (value === 'pending') return 'Ожидает подтверждения';
  if (value === 'approved') return 'Одобрено';
  return 'Отклонено';
}

// ---------- Админка ----------

async function renderAdmin() {
  const box = document.querySelector('#admin');

  if (!appState.user || appState.user.role !== 'admin') {
    box.innerHTML = '<div class="box">Только для администратора.</div>';
    return;
  }

  try {
    const data = await api('/admin/requests');
    if (!data.requests.length) {
      box.innerHTML = '<div class="box muted">Заявок пока нет.</div>';
      return;
    }

    box.innerHTML = data.requests.map(function (request) {
      const itemNames = (request.items || []).map(function (item) {
        return safe(item.name) + ' × ' + item.qty;
      }).join(' ');

      const buttons = request.status === 'pending'
        ? '<button class="btn" onclick="approve(' + request.id + ')">Одобрить</button>' +
          '<button class="btn second" onclick="reject(' + request.id + ')">Отклонить</button>'
        : '';

      return '<div class="admin-box"><h2>' + (request.type === 'order' ? 'Заказ' : 'Пополнение') +
        ' · ' + money(request.total) + '</h2>' +
        '<p>' + safe(request.userName) + ' (' + safe(request.email) + ')</p>' +
        '<p>' + itemNames + '</p>' +
        '<p class="status">' + status(request.status) + '</p>' + buttons + '</div>';
    }).join('');
  } catch (error) {
    box.innerHTML = '<div class="box muted">Не удалось загрузить заявки.</div>';
  }
}

async function approve(id) {
  try {
    await api('/admin/requests/' + id + '/approve', { method: 'POST' });
    await loadState();
    renderAdmin();
    message('Заявка одобрена.');
  } catch (error) {
    message(error.message);
  }
}

async function reject(id) {
  try {
    await api('/admin/requests/' + id + '/reject', { method: 'POST' });
    renderAdmin();
    message('Заявка отклонена.');
  } catch (error) {
    message(error.message);
  }
}

// ---------- Запуск ----------

async function init() {
  try {
    await loadState();
  } catch (error) {
    message('Сервер недоступен. Запусти его командой npm start.');
  }
  renderProducts();
}

init();
