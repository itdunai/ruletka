# Развёртывание «Колесо фортуны»

Единая инструкция: локальная разработка, первичная установка на сервер (VPS), обновление, проверка и обслуживание.

Подходит для любого Linux VPS (Timeweb, Beget VPS, Selectel и т.д.). На shared-хостинге без постоянных Node.js-процессов проект **не запустится** — нужен VPS или аналог с SSH, PM2 и Nginx.

---

## Содержание

1. [Архитектура проекта](#1-архитектура-проекта)
2. [Кто за что отвечает](#2-кто-за-что-отвечает)
3. [Локальная разработка](#3-локальная-разработка)
4. [Подготовка Telegram](#4-подготовка-telegram)
5. [Переменные окружения (.env)](#5-переменные-окружения-env)
6. [Первичная установка на сервер](#6-первичная-установка-на-сервер)
7. [Nginx и SSL](#7-nginx-и-ssl)
8. [Проверка после деплоя](#8-проверка-после-деплоя)
9. [Обновление на работающем сервере](#9-обновление-на-работающем-сервере)
10. [Админка и операторы](#10-админка-и-операторы)
11. [Безопасность](#11-безопасность)
12. [Работа с базой данных](#12-работа-с-базой-данных)
13. [Типичные проблемы](#13-типичные-проблемы)

---

## 1. Архитектура проекта

Монорепозиторий (npm workspaces). В production работают **три части**:

```
Пользователь в Telegram
        │
        ▼
   @ruletka/bot          ── проверка подписки, /start, кнопка Mini App
        │
        ▼
   @ruletka/miniapp      ── React-приложение (статика через Nginx)
        │  HTTPS
        ▼
   @ruletka/api          ── Fastify API (прокси Nginx → localhost:3001)
        │
        ▼
   PostgreSQL            ── пользователи, спины, призы, выигрыши
```

**Домены (пример):**

| Домен | Что отдаёт |
|-------|------------|
| `https://wheel.example.com` | Собранный miniapp (`apps/miniapp/dist`) |
| `https://api.example.com` | API на порту 3001 (только через Nginx) |

**Файлы в репозитории для деплоя:**

| Файл | Назначение |
|------|------------|
| `ecosystem.config.cjs` | Конфиг PM2: процессы `ruletka-api` и `ruletka-bot` |
| `deploy/nginx/ruletka.conf` | Шаблон Nginx |
| `deploy/required-channel-links.txt` | Запасной список ссылок на каналы (если не задан `REQUIRED_CHANNELS_LINKS`) |
| `.env` | Все секреты и настройки (в корне репозитория, **не коммитить**) |

---

## 2. Кто за что отвечает

### `@ruletka/api` (`apps/api`)

**Backend.** Запускается как долгоживущий Node.js-процесс через PM2.

| Задача | Примеры |
|--------|---------|
| Авторизация пользователей | `POST /auth/telegram` — проверка `initData` от Telegram |
| Состояние приложения | `GET /app/state` — призы, кулдаун, история |
| Спин колеса | `POST /spin` — лимит 1 раз в неделю, проверка подписки |
| Выигрыши | отправка в чат магазина, статусы призов |
| Админка | `/admin/*` — призы, рассылка, статистика |
| Операторы | `/operator/*` — подтверждение/отклонение выигрышей |
| Фоновые задачи | экспирация призов, напоминания о новом спине |
| Загрузки | картинки призов в `/uploads/*` |

**Сборка:** TypeScript → `apps/api/dist/`.  
**Запуск:** `node dist/index.js` (скрипт `npm run start --workspace @ruletka/api`).

**Когда пересобирать:** любые изменения в `apps/api/src/**`, схеме Prisma, логике API.

---

### `@ruletka/bot` (`apps/bot`)

**Telegram-бот** на Telegraf. Тоже долгоживущий процесс PM2.

| Задача | Примеры |
|--------|---------|
| Приветствие | `/start` — текст + список каналов для подписки |
| Проверка подписки | `/check` — `getChatMember` по каналам из `REQUIRED_CHANNELS` |
| Mini App | кнопка `web_app` с URL из `MINIAPP_URL` |
| Оператор | `/claim_win`, `/reject_win` — вызов API с `OPERATOR_TOKEN` |

**Сборка:** TypeScript → `apps/bot/dist/`.  
**Запуск:** `node dist/index.js`.

**Когда пересобирать:** любые изменения в `apps/bot/src/**`, а также при смене `REQUIRED_CHANNELS` в `.env` — бот читает каналы при старте из скомпилированного кода + `.env`.  
**Важно:** после `git pull` или правки `.env` с каналами всегда делайте `npm run build --workspace @ruletka/bot` и `pm2 restart ruletka-bot --update-env`. Иначе будет работать старый `dist/`.

---

### `@ruletka/miniapp` (`apps/miniapp`)

**Frontend** — React + Vite. В production **не запускается как процесс**: только сборка в статику.

| Задача | Примеры |
|--------|---------|
| UI колеса | анимация, спин, отображение призов |
| Авторизация | передача `initData` в API |
| Мои призы | история, отправка оператору |
| Админка | `?admin=1` — управление призами и рассылка |

**Сборка:** `apps/miniapp/dist/` (HTML, JS, CSS).  
**Отдача:** Nginx из каталога `dist`.

**Когда пересобирать:** любые изменения в `apps/miniapp/src/**`, а также при смене `VITE_*` в `.env` — эти переменные **вшиваются при сборке**.

---

### Сводка команд по workspace

| Команда | Что делает |
|---------|------------|
| `npm run dev --workspace @ruletka/api` | API в режиме разработки (hot reload) |
| `npm run dev --workspace @ruletka/bot` | Бот в режиме разработки |
| `npm run dev --workspace @ruletka/miniapp` | Vite dev-server (обычно `:5173`) |
| `npm run build --workspace @ruletka/api` | Сборка API → `apps/api/dist/` |
| `npm run build --workspace @ruletka/bot` | Сборка бота → `apps/bot/dist/` |
| `npm run build --workspace @ruletka/miniapp` | Сборка статики → `apps/miniapp/dist/` |
| `npm run build` | Сборка **всех** workspace, где есть скрипт `build` |
| `npm run start --workspace @ruletka/api` | Запуск собранного API (production) |
| `npm run start --workspace @ruletka/bot` | Запуск собранного бота (production) |

Корневые алиасы (то же самое, короче):

```bash
npm run dev:api
npm run dev:bot
npm run dev:miniapp
```

---

## 3. Локальная разработка

### 3.1. Подготовка

```bash
# Клонировать репозиторий и перейти в каталог
cd /path/to/ruletka

# Скопировать шаблон переменных окружения
cp .env.example .env
# Отредактировать .env: BOT_TOKEN, DATABASE_URL, VITE_API_BASE_URL и т.д.

# Установить зависимости всех workspace
npm install

# Сгенерировать Prisma Client (нужен для API)
npm run prisma:generate
```

### 3.2. База данных

**Вариант A — Docker:**

```bash
# Поднять PostgreSQL из docker-compose.yml
docker compose up -d
```

**Вариант B — локальный PostgreSQL** — укажите `DATABASE_URL` в `.env`.

Применить схему:

```bash
# Разработка: создаёт миграции
npm run prisma:migrate

# Или быстро синхронизировать схему без миграций (осторожно на production)
npx prisma db push --schema prisma/schema.prisma
```

### 3.3. Запуск в dev-режиме

В **трёх отдельных терминалах**:

```bash
npm run dev:api      # API на http://localhost:3001
npm run dev:bot      # Бот опрашивает Telegram
npm run dev:miniapp  # Frontend на http://localhost:5173
```

Для miniapp в `.env` должны быть:

```env
VITE_API_BASE_URL=http://localhost:3001
CORS_ORIGINS=http://localhost:5173
```

---

## 4. Подготовка Telegram

Выполните **до** деплоя на сервер.

### 4.1. Создать бота

1. Откройте [@BotFather](https://t.me/BotFather).
2. `/newbot` → получите токен вида `123456:AA...`.
3. Запишите в `.env`:
   - `BOT_TOKEN=...`
   - `TELEGRAM_BOT_TOKEN=...` (можно тот же токен — нужен API для проверки `initData`).

### 4.2. URL Mini App

В BotFather: `/mybots` → ваш бот → Web App / Menu button → URL вида `https://wheel.example.com`.

В `.env`:

```env
MINIAPP_URL=https://wheel.example.com
```

### 4.3. Обязательные каналы

1. Добавьте бота **администратором** в каждый канал (нужно право видеть участников).
2. В `.env` укажите id или `@username` каналов:

```env
REQUIRED_CHANNELS=-1002565787871,@public_channel
```

3. Для красивого списка ссылок в `/start` и `/check`:

```env
REQUIRED_CHANNELS_LINKS=Название канала|||https://t.me/...@@@Второй канал|||https://t.me/...
```

**Формат:** записи через `@@@`, внутри записи `Название|||URL`.

**Важно про `.env`:** символ `#` начинает комментарий. Разделитель `###` без кавычек обрежет строку. Используйте `|||`, либо положите список в `deploy/required-channel-links.txt` (по одной строке на канал).

| Переменная | Для чего |
|------------|----------|
| `REQUIRED_CHANNELS` | Проверка подписки (`getChatMember`) в боте и API |
| `REQUIRED_CHANNELS_LINKS` | Только отображение кликабельных ссылок пользователю |

### 4.4. Чат магазина / операторов

1. Создайте группу, добавьте бота.
2. Узнайте `chat_id` (например через `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates` после сообщения в группу).
3. В `.env`:

```env
SHOP_CHAT_ID=-1001234567890
```

Сюда API отправляет уведомления о выигрышах.

---

## 5. Переменные окружения (.env)

Файл `.env` лежит в **корне репозитория**. Его читают API, бот, PM2 (`ecosystem.config.cjs`) и сборка miniapp (`VITE_*`).

Шаблон: `.env.example`.

### 5.1. Полный пример для production

```env
API_PORT=3001
API_HOST=0.0.0.0

BOT_TOKEN=123456:AA...
TELEGRAM_BOT_TOKEN=123456:AA...
API_BASE_URL=https://api.example.com
VITE_API_BASE_URL=https://api.example.com
MINIAPP_URL=https://wheel.example.com

REQUIRED_CHANNELS=-1001234567890,@channel_two
REQUIRED_CHANNELS_LINKS=Канал 1|||https://t.me/+xxx@@@Канал 2|||https://t.me/+yyy
SHOP_CHAT_ID=-1001234567890

ADMIN_TOKEN=...
OPERATOR_TOKEN=...
JWT_SECRET=...
ACCESS_TOKEN_TTL=7d
CORS_ORIGINS=https://wheel.example.com

UPLOAD_DIR=uploads
UPLOAD_BASE_URL=https://api.example.com
EXPIRATION_JOB_INTERVAL_MS=60000
SPIN_READY_REMINDER_INTERVAL_MS=300000
SPIN_READY_REMINDER_TEXT=🎯 Доступна новая попытка! Возвращайтесь крутить колесо.
APP_TIME_ZONE=Asia/Irkutsk
VITE_APP_TIME_ZONE=Asia/Irkutsk

DATABASE_URL=postgresql://ruletka_user:password@127.0.0.1:5432/ruletka?schema=public
```

### 5.2. Справочник переменных

| Переменная | Кто использует | Назначение |
|------------|----------------|------------|
| `API_PORT`, `API_HOST` | API | Порт и интерфейс (обычно `3001`, `0.0.0.0`) |
| `BOT_TOKEN` | Бот, API | Telegram Bot API |
| `TELEGRAM_BOT_TOKEN` | API | Проверка подписи `initData` |
| `API_BASE_URL` | Бот | URL API для команд оператора |
| `VITE_API_BASE_URL` | Miniapp (при сборке) | URL API внутри frontend |
| `MINIAPP_URL` | Бот | Ссылка на Web App в кнопке |
| `REQUIRED_CHANNELS` | Бот, API | Id каналов для проверки подписки |
| `REQUIRED_CHANNELS_LINKS` | Бот | Ссылки в сообщениях |
| `SHOP_CHAT_ID` | API | Чат для уведомлений о призах |
| `ADMIN_TOKEN` | API, админка | Защита `/admin/*` |
| `OPERATOR_TOKEN` | API, бот | Защита `/operator/*` |
| `JWT_SECRET` | API | Подпись access-токенов пользователей |
| `ACCESS_TOKEN_TTL` | API | Срок жизни токена (`7d`, `12h`, `15m`) |
| `CORS_ORIGINS` | API | Разрешённые origin через запятую |
| `DATABASE_URL` | API | PostgreSQL |
| `UPLOAD_DIR`, `UPLOAD_BASE_URL` | API | Загрузка картинок призов |
| `APP_TIME_ZONE` | API | Таймзона в сообщениях |
| `VITE_APP_TIME_ZONE` | Miniapp (при сборке) | Таймзона в UI |
| `EXPIRATION_JOB_INTERVAL_MS` | API | Интервал проверки просроченных призов |
| `SPIN_READY_REMINDER_*` | API | Напоминания о новом спине |

### 5.3. Генерация секретов

```bash
# Linux / macOS
openssl rand -hex 32

# Node.js (любая ОС)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# PowerShell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

Отдельно сгенерируйте: `JWT_SECRET`, `ADMIN_TOKEN`, `OPERATOR_TOKEN`.

---

## 6. Первичная установка на сервер

Путь к проекту в примерах: `/var/www/ruletka`. Замените на свой.

### 6.1. Требования

- Ubuntu 22.04 / 24.04 (или аналог)
- Node.js **20+**, npm, git
- PostgreSQL
- Nginx
- PM2
- Два поддомена в DNS → IP сервера: `wheel.*`, `api.*`

### 6.2. Системные пакеты

```bash
# Обновить список пакетов
sudo apt update

# Git, Nginx, PostgreSQL
sudo apt install -y git curl nginx postgresql postgresql-contrib
```

### 6.3. Node.js 20

```bash
# Репозиторий NodeSource для Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Установка Node.js и npm
sudo apt install -y nodejs

# Проверка версий
node -v
npm -v
```

### 6.4. PM2

```bash
# Глобальный менеджер процессов для API и бота
sudo npm i -g pm2
```

### 6.5. PostgreSQL

```bash
# Войти в psql от пользователя postgres
sudo -u postgres psql
```

```sql
-- Создать базу и пользователя (пароль замените на свой)
CREATE DATABASE ruletka;
CREATE USER ruletka_user WITH ENCRYPTED PASSWORD 'strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE ruletka TO ruletka_user;
\q
```

Строка для `.env`:

```env
DATABASE_URL=postgresql://ruletka_user:strong_password_here@127.0.0.1:5432/ruletka?schema=public
```

### 6.6. Код проекта

```bash
# Каталог для приложения
cd /var/www
sudo mkdir ruletka && sudo chown $USER:$USER ruletka
cd ruletka

# Клонировать репозиторий (подставьте свой URL)
git clone <your_repo_url> .

# Установить зависимости monorepo
npm install
```

### 6.7. Файл .env

```bash
# Создать .env из шаблона
cp .env.example .env

# Отредактировать (nano, vim и т.д.)
nano .env
```

Заполните все значения из [раздела 5](#5-переменные-окружения-env).  
**Обязательно для сборки miniapp:** `VITE_API_BASE_URL`, `VITE_APP_TIME_ZONE`.

### 6.8. Prisma и схема БД

```bash
# Сгенерировать Prisma Client (нужен API при сборке и запуске)
npm run prisma:generate

# Применить схему к пустой БД
# Вариант для первого деплоя с миграциями:
npm run prisma:migrate

# Или синхронизация схемы без файлов миграций (часто на VPS):
npx prisma db push --schema prisma/schema.prisma
```

### 6.9. Сборка всех частей

```bash
# Собрать API (TypeScript → apps/api/dist/)
npm run build --workspace @ruletka/api

# Собрать бота (TypeScript → apps/bot/dist/)
npm run build --workspace @ruletka/bot

# Собрать miniapp (React → apps/miniapp/dist/)
# VITE_* берутся из корневого .env в момент сборки
npm run build --workspace @ruletka/miniapp
```

Или одной командой:

```bash
npm run build
```

Проверка:

```bash
test -f apps/api/dist/index.js && echo "API OK"
test -f apps/bot/dist/index.js && echo "BOT OK"
test -f apps/miniapp/dist/index.html && echo "MINIAPP OK"
```

### 6.10. Запуск через PM2

```bash
# Старт API и бота по ecosystem.config.cjs
# (читает .env из корня и передаёт переменные процессам)
pm2 start ecosystem.config.cjs

# Сохранить список процессов для автозапуска после перезагрузки
pm2 save

# Настроить автозапуск PM2 при загрузке системы (выполнить команду, которую выведет pm2)
pm2 startup

# Статус: оба процесса должны быть online
pm2 status
```

Процессы в PM2:

| Имя | Workspace | Скрипт |
|-----|-----------|--------|
| `ruletka-api` | `@ruletka/api` | `npm run start --workspace @ruletka/api` |
| `ruletka-bot` | `@ruletka/bot` | `npm run start --workspace @ruletka/bot` |

Miniapp в PM2 **не** запускается — только статика для Nginx.

### 6.11. Логи

```bash
# Логи API в реальном времени
pm2 logs ruletka-api

# Логи бота
pm2 logs ruletka-bot

# Последние 50 строк API
pm2 logs ruletka-api --lines 50
```

---

## 7. Nginx и SSL

### 7.1. Установка конфига

```bash
# Скопировать шаблон из репозитория
sudo cp deploy/nginx/ruletka.conf /etc/nginx/sites-available/ruletka
```

Отредактируйте `/etc/nginx/sites-available/ruletka`:

- `wheel.example.com` → ваш домен miniapp
- `api.example.com` → ваш домен API
- `/var/www/ruletka` → путь к проекту

```bash
# Включить сайт
sudo ln -s /etc/nginx/sites-available/ruletka /etc/nginx/sites-enabled/ruletka

# Проверить синтаксис
sudo nginx -t

# Применить конфиг
sudo systemctl reload nginx
```

**Что делает конфиг:**

- `wheel.*` — отдаёт файлы из `apps/miniapp/dist`, SPA через `try_files`
- `api.*` — проксирует на `http://127.0.0.1:3001`

### 7.2. SSL (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx

# Выпустить сертификаты (подставьте свои домены)
sudo certbot --nginx -d wheel.example.com -d api.example.com
```

После SSL убедитесь, что в `.env` везде **https**:

- `MINIAPP_URL=https://wheel.example.com`
- `API_BASE_URL=https://api.example.com`
- `VITE_API_BASE_URL=https://api.example.com`
- `CORS_ORIGINS=https://wheel.example.com`
- `UPLOAD_BASE_URL=https://api.example.com`

Если меняли `VITE_*` — **пересоберите miniapp** и перезапустите PM2.

---

## 8. Проверка после деплоя

### 8.1. API

```bash
curl -sS https://api.example.com/health
# Ожидаемо: {"ok":true} или аналог
```

### 8.2. Telegram

1. `/start` у бота — приветствие и список каналов.
2. Подписаться на каналы → `/check` — кнопка «Открыть Колесо фортуны».
3. Открыть mini app → крутить колесо → приз в «Мои призы».
4. Отправка оператору → сообщение в `SHOP_CHAT_ID`.

### 8.3. CORS

Разрешённый origin:

```bash
curl -i -X OPTIONS "https://api.example.com/health" \
  -H "Origin: https://wheel.example.com" \
  -H "Access-Control-Request-Method: GET"
```

Ожидаемо: заголовок `access-control-allow-origin: https://wheel.example.com`.

Чужой origin — заголовка быть не должно.

### 8.4. Защита эндпоинтов

```bash
# Без токена — 401
curl -i "https://api.example.com/app/state"

# Неверный admin-токен — 401
curl -i "https://api.example.com/admin/prizes" -H "x-admin-token: wrong"
```

---

## 9. Обновление на работающем сервере

Типовой сценарий после `git push`: зайти по SSH и выполнить шаги по порядку.

**Путь к проекту:** `/var/www/ruletka` (замените при необходимости).

### 9.1. Бэкап БД (рекомендуется)

```bash
# Дамп в файл с датой в имени
pg_dump "$DATABASE_URL" -Fc -f ~/ruletka-backup-$(date +%Y%m%d).dump
```

Если `DATABASE_URL` не в shell — возьмите строку из `.env` или:

```bash
cd /var/www/ruletka
source <(grep -v '^#' .env | sed 's/^/export /')
pg_dump "$DATABASE_URL" -Fc -f ~/ruletka-backup-$(date +%Y%m%d).dump
```

### 9.2. Забрать код

```bash
cd /var/www/ruletka

# Убедиться, что нет незакоммиченных правок на сервере
git status

# Подтянуть изменения (ветка main или ваша)
git pull origin main
```

### 9.3. Зависимости

```bash
# Только если менялся package-lock.json
npm install
```

### 9.4. База данных

```bash
# Обновить Prisma Client после изменений schema.prisma
npm run prisma:generate

# Применить изменения схемы (новые поля, enum и т.д.)
npx prisma db push --schema prisma/schema.prisma
```

На production **не** используйте `prisma migrate reset` и `--force-reset`.

### 9.5. Сборка

Собирайте **только то, что менялось**, или всё для надёжности:

```bash
# API — если менялся apps/api или prisma
npm run build --workspace @ruletka/api

# Бот — если менялся apps/bot ИЛИ REQUIRED_CHANNELS в .env
npm run build --workspace @ruletka/bot

# Miniapp — если менялся frontend ИЛИ любая VITE_* в .env
npm run build --workspace @ruletka/miniapp
```

**Минимум при любом обновлении** (безопасный вариант):

```bash
npm run build --workspace @ruletka/api
npm run build --workspace @ruletka/bot
npm run build --workspace @ruletka/miniapp
```

### 9.6. Перезапуск PM2

```bash
# --update-env подхватывает изменения .env
pm2 restart ruletka-api --update-env
pm2 restart ruletka-bot --update-env
pm2 save
pm2 status
```

### 9.7. Nginx

```bash
# Обычно без правок; проверка и reload
sudo nginx -t && sudo systemctl reload nginx
```

### 9.8. Шпаргалка — все команды подряд

```bash
cd /var/www/ruletka
git pull origin main
npm install
npm run prisma:generate
npx prisma db push --schema prisma/schema.prisma
npm run build --workspace @ruletka/api
npm run build --workspace @ruletka/bot
npm run build --workspace @ruletka/miniapp
pm2 restart ruletka-api --update-env
pm2 restart ruletka-bot --update-env
pm2 save
sudo nginx -t && sudo systemctl reload nginx
curl -sS https://api.example.com/health
```

### 9.9. Что пересобирать при типе изменений

| Изменилось | Действия |
|------------|----------|
| Только `apps/miniapp` | `build @ruletka/miniapp`, nginx reload (опционально) |
| Только `apps/api` | `prisma:generate` (если schema), `build @ruletka/api`, `restart ruletka-api` |
| Только `apps/bot` | `build @ruletka/bot`, `restart ruletka-bot` |
| `.env`: `REQUIRED_CHANNELS` | `build @ruletka/bot`, `build @ruletka/api`, restart оба |
| `.env`: `VITE_*` | `build @ruletka/miniapp` |
| `prisma/schema.prisma` | `prisma:generate`, `db push`, `build @ruletka/api`, `restart ruletka-api` |

---

## 10. Админка и операторы

### 10.1. Админка призов (браузер)

URL: `https://wheel.example.com/?admin=1`

1. Ввести `ADMIN_TOKEN` из `.env`.
2. Управление призами, картинками, условиями, рассылкой.

### 10.2. API для админа (curl)

```bash
# Список призов
curl -H "x-admin-token: <ADMIN_TOKEN>" https://api.example.com/admin/prizes

# Создать приз
curl -X POST https://api.example.com/admin/prizes \
  -H "Content-Type: application/json" \
  -H "x-admin-token: <ADMIN_TOKEN>" \
  -d '{"title":"Скидка 20%","type":"discount","value":"20","weight":5,"isActive":true}'
```

### 10.3. Оператор в Telegram

Команды бота (нужен `OPERATOR_TOKEN` на сервере):

- `/claim_win <win_id> [комментарий]` — подтвердить выигрыш
- `/reject_win <win_id> [причина]` — отклонить

---

## 11. Безопасность

- **Не коммитьте** `.env`.
- Снаружи открыты только **80** и **443**. Порт **3001** — только localhost + Nginx.
- Длинные случайные `ADMIN_TOKEN`, `OPERATOR_TOKEN`, `JWT_SECRET`.
- Регулярные бэкапы PostgreSQL.

### Firewall (UFW, Ubuntu)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 3001/tcp
sudo ufw enable
sudo ufw status numbered
```

Проверка, что API не слушает публичный интерфейс:

```bash
ss -ltnp | grep 3001
# Ожидаемо: 127.0.0.1:3001
```

---

## 12. Работа с базой данных

Подключение (имя БД — как в `DATABASE_URL`):

```bash
sudo -u postgres psql -d ruletka
```

### 12.1. Кто уже крутил рулетку

```sql
SELECT u.id AS user_uuid,
       u."telegramId",
       u.username,
       COUNT(s.id) AS spins_count,
       MAX(s."spinAt") AS last_spin_at
FROM "User" u
INNER JOIN "Spin" s ON s."userId" = u.id
GROUP BY u.id, u."telegramId", u.username
ORDER BY last_spin_at DESC;
```

### 12.2. Детально: спины и призы

```sql
SELECT u."telegramId",
       u.username,
       s."spinAt",
       p.title AS prize_title,
       s.id AS spin_id
FROM "User" u
JOIN "Spin" s ON s."userId" = u.id
JOIN "Prize" p ON p.id = s."prizeId"
ORDER BY s."spinAt" DESC;
```

### 12.3. Удалить результаты пользователя по Telegram ID

Замените `123456789` на реальный `telegramId`. Сначала бэкап.

```sql
-- Проверка
SELECT id, "telegramId", username FROM "User" WHERE "telegramId" = 123456789;

BEGIN;

DELETE FROM "ShopNotification"
WHERE "winId" IN (
  SELECT w.id FROM "Win" w
  WHERE w."userId" = (SELECT id FROM "User" WHERE "telegramId" = 123456789)
);

DELETE FROM "Win"
WHERE "userId" = (SELECT id FROM "User" WHERE "telegramId" = 123456789);

DELETE FROM "Spin"
WHERE "userId" = (SELECT id FROM "User" WHERE "telegramId" = 123456789);

COMMIT;
```

Строка `User` остаётся — пользователь сможет крутить снова.

### 12.4. Полный сброс пользователей и результатов

Только с бэкапом, например перед новым сезоном:

```sql
BEGIN;
DELETE FROM "ShopNotification";
DELETE FROM "Win";
DELETE FROM "Spin";
DELETE FROM "User";
COMMIT;
```

---

## 13. Типичные проблемы

| Симптом | Причина | Решение |
|---------|---------|---------|
| `/check` не видит подписку, хотя пользователь подписан | Старый `apps/bot/dist/` или неверный `REQUIRED_CHANNELS` | `npm run build --workspace @ruletka/bot`, `pm2 restart ruletka-bot --update-env`, проверить `.env` |
| Белый экран miniapp | Неверный `VITE_API_BASE_URL` при сборке | Исправить `.env`, `npm run build --workspace @ruletka/miniapp` |
| Старый UI в Telegram | Кэш WebView | Полностью закрыть mini app и открыть снова |
| API 401 на `/app/state` | Нет или протух токен | Нормально для curl без Bearer; в app — переоткрыть |
| CORS ошибка в браузере | `CORS_ORIGINS` не содержит домен miniapp | Добавить origin, `pm2 restart ruletka-api --update-env` |
| `prisma db push` падает | Конфликт схемы | Смотреть вывод, бэкап; не использовать `--force-reset` |
| PM2 offline после деплоя | Ошибка в коде или `.env` | `pm2 logs ruletka-api`, `pm2 logs ruletka-bot` |

### Полезные команды PM2

```bash
pm2 status
pm2 restart ruletka-api
pm2 restart ruletka-bot
pm2 restart ruletka-api ruletka-bot --update-env
pm2 logs ruletka-api --lines 100
pm2 logs ruletka-bot --lines 100
```

---

## Краткая памятка

**Первый деплой:** система → PostgreSQL → `git clone` → `.env` → `prisma:generate` → `db push` → `build` (api, bot, miniapp) → `pm2 start` → Nginx → SSL → проверка.

**Каждое обновление:** `git pull` → `npm install` (если нужно) → `prisma:generate` + `db push` (если schema) → **build всех трёх workspace** → `pm2 restart` с `--update-env`.

**Помните:** бот и API — отдельные сборки; miniapp — статика; без `npm run build --workspace @ruletka/bot` изменения бота и каналов не применятся.
