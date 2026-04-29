# Развертывание на Beget + Telegram (подробно)
 

## 1. Что нужно заранее

- Аккаунт Beget.
- Лучше всего: **Beget VPS/VDS** (для полного контроля Node.js, PM2, Nginx).
- Домен и SSL.
- Telegram-бот и права админа в ваших каналах/чате операторов.

> Важно: на обычном shared-хостинге Beget Node/PM2 могут быть ограничены. Для этого проекта рекомендуется VPS.

## 2. Архитектура проекта

- `apps/api` — Fastify API
- `apps/bot` — Telegraf bot
- `apps/miniapp` — React Mini App (статика)
- `prisma/schema.prisma` — схема БД

## 3. Telegram настройка

## 3.1 Создание бота

В [@BotFather](https://t.me/BotFather):

1. `/newbot`
2. Получите `BOT_TOKEN`
3. Запишите в `.env`:
   - `BOT_TOKEN=...`
   - `TELEGRAM_BOT_TOKEN=...` (можно тем же)

## 3.2 Подключение Mini App URL

В BotFather у бота настройте Web App URL:
- `https://wheel.yourdomain.ru`

В `.env`:
- `MINIAPP_URL=https://wheel.yourdomain.ru`

## 3.3 Каналы подписки

1. Добавьте бота админом в обязательные каналы.
2. В `.env`:
- `REQUIRED_CHANNELS=@channel_one,@channel_two`

## 3.4 Чат магазина

1. Добавьте бота в чат операторов/магазина.
2. Получите `SHOP_CHAT_ID` через:
- `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates`
3. В `.env`:
- `SHOP_CHAT_ID=-100...`

## 4. ENV для production

Пример:

```env
API_PORT=3001
API_HOST=0.0.0.0

BOT_TOKEN=123456:AA...
TELEGRAM_BOT_TOKEN=123456:AA...
API_BASE_URL=https://api.yourdomain.ru
VITE_API_BASE_URL=https://api.yourdomain.ru
MINIAPP_URL=https://wheel.yourdomain.ru
REQUIRED_CHANNELS=@channel_one,@channel_two
SHOP_CHAT_ID=-1001234567890

ADMIN_TOKEN=very_long_admin_token
OPERATOR_TOKEN=very_long_operator_token
JWT_SECRET=very_long_jwt_secret
ACCESS_TOKEN_TTL=7d
CORS_ORIGINS=https://wheel.yourdomain.ru

UPLOAD_DIR=uploads
UPLOAD_BASE_URL=https://api.yourdomain.ru
EXPIRATION_JOB_INTERVAL_MS=60000

DATABASE_URL=postgresql://user:password@127.0.0.1:5432/ruletka?schema=public
```

Как заполнять `JWT_SECRET`, `ACCESS_TOKEN_TTL`, `CORS_ORIGINS`:
- `JWT_SECRET`:
  - Это приватный ключ подписи JWT, нужен длинный случайный секрет (минимум 32 байта).
  - Linux/macOS: `openssl rand -hex 32`
  - Node.js: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - PowerShell: `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')`
- `ACCESS_TOKEN_TTL`:
  - Рекомендуемое значение: `7d`.
  - Если нужна более строгая безопасность: `1d` или `12h`.
  - Поддерживаемые форматы: `15m`, `2h`, `7d`.
- `CORS_ORIGINS`:
  - Укажите frontend-домен(ы), которым разрешен доступ к API.
  - Один домен: `https://wheel.yourdomain.ru`
  - Несколько доменов: `https://wheel.yourdomain.ru,https://admin.yourdomain.ru`
  - Для локального теста можно временно добавить `http://localhost:5173`.
- `VITE_API_BASE_URL`:
  - Обязательная переменная для сборки mini app.
  - Должна указывать на публичный API (`https://api.yourdomain.ru`).
  - Если не указать, frontend не соберется и не будет fallback на `localhost`.

## 5. Развертывание на Beget VPS

## 5.1 Подготовить VPS

Подключитесь по SSH и установите:

```bash
sudo apt update
sudo apt install -y git curl nginx postgresql postgresql-contrib
```

Установка Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

PM2:

```bash
sudo npm i -g pm2
```

## 5.2 База PostgreSQL

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE ruletka;
CREATE USER ruletka_user WITH ENCRYPTED PASSWORD 'RJGbK3oKT!wv';
GRANT ALL PRIVILEGES ON DATABASE ruletka TO ruletka_user;
\q
```

## 5.3 Код проекта

```bash
cd /var/www
sudo mkdir ruletka && sudo chown $USER:$USER ruletka
cd ruletka
git clone <your_repo_url> .
npm install
```

## 5.4 ENV

```bash
cp .env.example .env
nano .env
```

Заполните значения.

## 5.5 Prisma + build

```bash
npm run prisma:generate
npx prisma db push --schema prisma/schema.prisma
npm run build
```

> Для production со стабильными миграциями лучше перейти на `prisma migrate deploy`, когда будет полноценный migration-flow.

## 5.6 Запуск процессов

Если используете готовый файл:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
pm2 status
```

## 5.7 Nginx

Скопируйте шаблон:

```bash
sudo cp deploy/nginx/ruletka.conf /etc/nginx/sites-available/ruletka
sudo ln -s /etc/nginx/sites-available/ruletka /etc/nginx/sites-enabled/ruletka
sudo nginx -t
sudo systemctl reload nginx
```

Перед этим поменяйте в конфиге:
- `wheel.example.com`
- `api.example.com`
- путь к проекту 
## 5.8 SSL

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d wheel.smarketirk38.ru -d api.smarketirk38.ru
```

## 6. Быстрый smoke-test

1. `https://api.yourdomain.ru/health` -> `{ ok: true }`
2. `/start` у бота
3. `/check` после подписки
4. Открыть mini app
5. Крутить -> результат
6. Отправить оператору -> сообщение в чат магазина

## 7. Админка призов в браузере

После запуска mini app:

- `https://wheel.yourdomain.ru/?admin=1`

Дальше:
1. Введите `ADMIN_TOKEN`
2. Загрузите призы
3. Управляйте призами/картинками/условиями

## 8. Если используете не VPS, а shared-хостинг Beget

- Проверьте, разрешен ли постоянный Node.js процесс.
- Если нельзя держать отдельный `bot` и `api` процессы, этот проект лучше переносить на VPS.
- Shared-вариант подходит только при наличии официальной поддержки long-running Node сервисов.

## 9. Безопасность

- Не коммитьте `.env`.
- Ограничьте доступ к API-портам (наружу только 80/443).
- Регулярно меняйте `ADMIN_TOKEN`, `OPERATOR_TOKEN`.
- Включите резервное копирование PostgreSQL.

Пример настройки UFW (VPS Ubuntu):

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

Дополнительно проверьте, что API не открыт наружу:

```bash
ss -ltnp | grep 3001
```

Ожидаемо: процесс API слушает только `127.0.0.1:3001`, а внешний доступ идет через Nginx на 80/443.

## 10. База: кто уже крутил рулетку и удаление спинов/призов по Telegram ID

Подключение к БД (имя `ruletka` должно совпадать с тем, что в `DATABASE_URL`):

```bash
sudo -u postgres psql -d ruletka
```

**1) Все пользователи, у которых был хотя бы один спин** (сводка: `@username`, число спинов, последний спин):

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

**2) Детально: каждый спин и выпавший приз** (для ревизии):

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

**3) Удалить все «результаты» пользователя по числовому Telegram ID**  
Удаляются связанные записи: уведомления магазина → выигрыши → спины. Порядок важен из-за внешних ключей. Перед правкой сделайте бэкап БД; подставьте вместо `123456789` реальный `telegramId`.

Сначала проверка, что пользователь найден:

```sql
SELECT id, "telegramId", username FROM "User" WHERE "telegramId" = 123456789;
```

Транзакция удаления (при необходимости вместо `COMMIT` выполните `ROLLBACK`):

```sql
BEGIN;

DELETE FROM "ShopNotification"
WHERE "winId" IN (
  SELECT w.id FROM "Win" w
  WHERE w."userId" = (SELECT id FROM "User" WHERE "telegramId" = 727055707)
);

DELETE FROM "Win"
WHERE "userId" = (SELECT id FROM "User" WHERE "telegramId" = 727055707);

DELETE FROM "Spin"
WHERE "userId" = (SELECT id FROM "User" WHERE "telegramId" = 727055707);

COMMIT;
```

После удаления спинов строка `User` остаётся — пользователь сможет снова открыть приложение и при желании крутить заново. Полное удаление учётки (редко нужно):

```sql
DELETE FROM "User" WHERE "telegramId" = 123456789;
```

Выполняйте только если перед этим уже удалены все `ShopNotification`, `Win` и `Spin` этого пользователя (как в блоке выше).

## 11. Полезные команды

```bash
pm2 logs ruletka-api
pm2 logs ruletka-bot
pm2 restart ruletka-api
pm2 restart ruletka-bot
```

```bash
curl https://api.yourdomain.ru/health
```

## 12. Проверка безопасности после деплоя

1) Проверка разрешенного CORS origin:

```bash
curl -i -X OPTIONS "https://api.yourdomain.ru/health" \
  -H "Origin: https://wheel.yourdomain.ru" \
  -H "Access-Control-Request-Method: GET"
```

Ожидаемо: в ответе есть `access-control-allow-origin: https://wheel.yourdomain.ru`.

2) Проверка блокировки чужого origin:

```bash
curl -i -X OPTIONS "https://api.yourdomain.ru/health" \
  -H "Origin: https://evil.example.com" \
  -H "Access-Control-Request-Method: GET"
```

Ожидаемо: `access-control-allow-origin` отсутствует.

3) Проверка user endpoint без токена:

```bash
curl -i "https://api.yourdomain.ru/app/state"
```

Ожидаемо: `401 Unauthorized`.

4) Проверка admin endpoint с невалидным токеном:

```bash
curl -i "https://api.yourdomain.ru/admin/prizes" \
  -H "x-admin-token: wrong_token"
```

Ожидаемо: `401 Unauthorized`.
