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
MINIAPP_URL=https://wheel.yourdomain.ru
REQUIRED_CHANNELS=@channel_one,@channel_two
SHOP_CHAT_ID=-1001234567890

ADMIN_TOKEN=very_long_admin_token
OPERATOR_TOKEN=very_long_operator_token

UPLOAD_DIR=uploads
UPLOAD_BASE_URL=https://api.yourdomain.ru
EXPIRATION_JOB_INTERVAL_MS=60000

DATABASE_URL=postgresql://user:password@127.0.0.1:5432/ruletka?schema=public
```

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
CREATE USER ruletka_user WITH ENCRYPTED PASSWORD 'strong_password_here';
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
sudo certbot --nginx -d wheel.yourdomain.ru -d api.yourdomain.ru
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

## 10. Полезные команды

```bash
pm2 logs ruletka-api
pm2 logs ruletka-bot
pm2 restart ruletka-api
pm2 restart ruletka-bot
```

```bash
curl https://api.yourdomain.ru/health
```
