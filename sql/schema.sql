-- ============================================================
--  DM — схема базы данных (MySQL / MariaDB)
--  База: isp-44_polehin_bs
--  Как применить: MySQL Workbench -> открыть этот файл -> Execute
--  (кнопка с молнией), либо: mysql -h ХОСТ -u ПОЛЬЗОВАТЕЛЬ -p < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS `isp-44_polehin_bs`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `isp-44_polehin_bs`;

-- ------------------------------------------------------------
--  Пользователи
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,          -- bcrypt-хеш, сам пароль не хранится
  role          ENUM('user','admin') NOT NULL DEFAULT 'user',
  balance       INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  Сессии (вход по cookie: в базе лежит только случайный токен)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token      CHAR(64) NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token),
  KEY sessions_user_idx (user_id),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  Предметы магазина (заполняются из Deadlock API скриптом import-items.js)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  id          BIGINT UNSIGNED NOT NULL,         -- id предмета в Deadlock API (большие числа)
  name        VARCHAR(150) NOT NULL,
  category    VARCHAR(50) NOT NULL,             -- Спирит / Ган / Живучесть
  price       INT NOT NULL,
  image       VARCHAR(500) NOT NULL DEFAULT '',
  description TEXT NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY items_category_idx (category),
  KEY items_name_idx (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  Избранное (связь многие-ко-многим: пользователь <-> предмет)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
  user_id  INT UNSIGNED NOT NULL,
  item_id  BIGINT UNSIGNED NOT NULL,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id),
  KEY favorites_item_idx (item_id),
  CONSTRAINT favorites_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT favorites_item_fk FOREIGN KEY (item_id)
    REFERENCES items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  Корзина: строка на пару (пользователь, предмет)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cart (
  user_id INT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  qty     INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, item_id),
  KEY cart_item_idx (item_id),
  CONSTRAINT cart_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT cart_item_fk FOREIGN KEY (item_id)
    REFERENCES items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  Заявки: заказ (order) или пополнение баланса (topup)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS requests (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  type       ENUM('order','topup') NOT NULL,
  total      INT NOT NULL,
  status     ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY requests_user_idx (user_id),
  KEY requests_status_idx (status),
  CONSTRAINT requests_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Состав заявки-заказа: название и цена сохраняются на момент заказа,
-- чтобы история не менялась, если предмет подорожает.
CREATE TABLE IF NOT EXISTS request_items (
  request_id INT UNSIGNED NOT NULL,
  item_id    BIGINT UNSIGNED NOT NULL,
  name       VARCHAR(150) NOT NULL,
  price      INT NOT NULL,
  qty        INT UNSIGNED NOT NULL,
  PRIMARY KEY (request_id, item_id),
  CONSTRAINT request_items_request_fk FOREIGN KEY (request_id)
    REFERENCES requests (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
