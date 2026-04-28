# Развертывание на Timeweb + Telegram (подробно)

Этот гайд покрывает полный путь: от подготовки Telegram-бота и каналов до запуска `api`, `bot`, `miniapp` на Timeweb.

Готовые файлы в проекте:
- PM2: `ecosystem.config.cjs`
- Nginx: `deploy/nginx/ruletka.conf`
- Быстрый чеклист: `deploy/DEPLOY_QUICKSTART.md`

## 1. Что нужно подготовить заранее

- Аккаунт Timeweb (Cloud/VPS или Apps, где есть доступ к Node.js процессам).
- Домен (например `wheel.yourdomain.ru`) и SSL (Let's Encrypt).
- Аккаунт Telegram.
- Права администратора в ваших Telegram-каналах.
- Возможность добавить бота администратором в канал магазина/операторов.

## 2. Что в проекте запускается

Проект состоит из 3 сервисов:

- `apps/api` - backend (Fastify + Prisma + PostgreSQL)
- `apps/bot` - Telegram-бот (Telegraf)
- `apps/miniapp` - frontend Mini App (React + Vite)

Для production обычно:
- `api` и `bot` запускаются как Node.js процессы (pm2/systemd/docker),
- `miniapp` собирается в статику и отдается через Nginx.

## 3. Telegram: что создать и настроить

## 3.1 Создать бота

1. Откройте [@BotFather](https://t.me/BotFather).
2. Команда `/newbot`.
3. Укажите имя и username (username должен заканчиваться на `bot`).
4. Получите токен вида `123456:AA...`.
5. Это значение записать в `.env`:
   - `BOT_TOKEN=...`
   - `TELEGRAM_BOT_TOKEN=...` (можно тот же токен).

## 3.2 Подключить Mini App к боту

В [@BotFather](https://t.me/BotFather):

1. `/mybots` -> выберите бота.
2. Найдите Web App / Menu button settings.
3. Укажите URL Mini App, например: `https://wheel.yourdomain.ru`.

Это же значение указать в `.env`:
- `MINIAPP_URL=https://wheel.yourdomain.ru`

## 3.3 Обязательные каналы для подписки

1. Добавьте бота администратором в каждый обязательный канал.
2. В `.env` задайте:
   - `REQUIRED_CHANNELS=@channel_one,@channel_two`

Важно: бот должен иметь право видеть участников канала (иначе `getChatMember` может не пройти).

## 3.4 Чат магазина/оператора (куда отправлять выигрыш)

1. Создайте группу/супергруппу для операторов или используйте существующую.
2. Добавьте туда бота.
3. Получите `chat_id` этой группы.

Как получить `SHOP_CHAT_ID`:
- Самый простой путь: написать сообщение в эту группу и открыть:
  - `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates`
- В JSON найдите `chat.id` нужной группы (обычно отрицательный, например `-1001234567890`).

Записать в `.env`:
- `SHOP_CHAT_ID=-1001234567890`

## 4. Что означает каждый ENV и где его взять

Ниже production-пример:

```env
API_PORT=3001
API_HOST=0.0.0.0

BOT_TOKEN=123456:AA....
TELEGRAM_BOT_TOKEN=123456:AA....
API_BASE_URL=https://api.yourdomain.ru
MINIAPP_URL=https://wheel.yourdomain.ru
REQUIRED_CHANNELS=@channel_one,@channel_two
SHOP_CHAT_ID=-1001234567890

ADMIN_TOKEN=very_long_random_admin_token
OPERATOR_TOKEN=very_long_random_operator_token

DATABASE_URL=postgresql://user:password@127.0.0.1:5432/ruletka?schema=public
```

Пояснения:
- `API_PORT`, `API_HOST`: где слушает backend.
- `BOT_TOKEN`: токен бота, используется ботом и API для отправки сообщений.
- `TELEGRAM_BOT_TOKEN`: токен для проверки `initData` (может быть тем же).
- `API_BASE_URL`: адрес API для команд оператора в `apps/bot`.
- `MINIAPP_URL`: публичный URL frontend.
- `REQUIRED_CHANNELS`: каналы для проверки подписки.
- `SHOP_CHAT_ID`: куда API отправляет сообщение о выигрыше.
- `ADMIN_TOKEN`: для защищенных `/admin/*` эндпоинтов.
- `OPERATOR_TOKEN`: для `/operator/*` эндпоинтов и команд `/claim_win`, `/reject_win`.
- `DATABASE_URL`: строка подключения к PostgreSQL.

## 5. Как сгенерировать безопасные токены

На Linux:

```bash
openssl rand -hex 32
```

Сгенерируйте отдельно:
- `ADMIN_TOKEN`
- `OPERATOR_TOKEN`

## 6. Вариант deployment на Timeweb VPS (рекомендуется)

Ниже самый универсальный путь.

## 6.1 Поднять сервер

1. Создайте VPS (Ubuntu 22.04/24.04).
2. Настройте DNS:
   - `api.yourdomain.ru` -> IP VPS
   - `wheel.yourdomain.ru` -> IP VPS

## 6.2 Установить системные пакеты

```bash
sudo apt update
sudo apt install -y git curl nginx postgresql postgresql-contrib
```

Установить Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Установить pm2:

```bash
sudo npm i -g pm2
```

## 6.3 Подготовить PostgreSQL

```bash
sudo -u postgres psql
```

Внутри `psql`:

```sql
CREATE DATABASE ruletka;
CREATE USER ruletka_user WITH ENCRYPTED PASSWORD 'strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE ruletka TO ruletka_user;
\q
```

## 6.4 Развернуть код

```bash
cd /var/www
sudo mkdir ruletka && sudo chown $USER:$USER ruletka
cd ruletka
git clone <your_repo_url> .
npm install
```

## 6.5 Создать production `.env`

```bash
cp .env.example .env
nano .env
```

Заполнить все значения из раздела ENV выше.

## 6.6 Prisma и сборка

```bash
npm run prisma:generate
npm run prisma:migrate
npm run build
```

## 6.7 Запустить API и BOT через pm2

```bash
pm2 start "npm run start --workspace @ruletka/api" --name ruletka-api
pm2 start "npm run start --workspace @ruletka/bot" --name ruletka-bot
pm2 save
pm2 startup
```

Проверка:

```bash
pm2 status
pm2 logs ruletka-api
pm2 logs ruletka-bot
```

## 6.8 Раздача Mini App через Nginx

Собранная статика находится в `apps/miniapp/dist`.

Готовый шаблон уже есть в проекте: `deploy/nginx/ruletka.conf`.

Пример конфига Nginx:

```nginx
server {
    listen 80;
    server_name wheel.yourdomain.ru;
    root /var/www/ruletka/apps/miniapp/dist;
    index index.html;

    location / {
        try_files $uri /index.html;
    }
}

server {
    listen 80;
    server_name api.yourdomain.ru;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Активировать:

```bash
sudo ln -s /etc/nginx/sites-available/ruletka /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 6.9 SSL (обязательно)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d wheel.yourdomain.ru -d api.yourdomain.ru
```

После этого:
- `MINIAPP_URL` должен быть `https://wheel.yourdomain.ru`
- `API_BASE_URL` должен быть `https://api.yourdomain.ru`

## 7. Минимальный чеклист Telegram после деплоя

1. В [@BotFather](https://t.me/BotFather) URL Mini App обновлен на `https://...`.
2. Бот добавлен админом во все обязательные каналы.
3. Бот добавлен в операторский чат.
4. `SHOP_CHAT_ID` корректный (проверили через `getUpdates`).
5. Бот запущен и отвечает на `/start`.

## 8. Как проверить работу end-to-end

1. Открыть бота -> `/start`.
2. Если пользователь не подписан, бот просит подписаться.
3. После подписки `/check` -> кнопка открытия Mini App.
4. В Mini App нажать "Крутить" -> получить приз.
5. Нажать "Отправить оператору" -> сообщение появляется в операторском чате.
6. В чате оператора выполнить:
   - `/claim_win <win_id>` или
   - `/reject_win <win_id> причина`

## 9. Полезные API команды для админа

Список призов:

```bash
curl -H "x-admin-token: <ADMIN_TOKEN>" https://api.yourdomain.ru/admin/prizes
```

Создать приз:

```bash
curl -X POST https://api.yourdomain.ru/admin/prizes \
  -H "Content-Type: application/json" \
  -H "x-admin-token: <ADMIN_TOKEN>" \
  -d '{"title":"Скидка 20%","type":"discount","value":"20","weight":5,"isActive":true}'
```

## 10. Безопасность (обязательно)

- Никогда не коммитьте `.env`.
- Ограничьте firewall:
  - наружу открыть 80/443,
  - 3001 не открывать наружу (только localhost + Nginx).
- Используйте длинные случайные `ADMIN_TOKEN` и `OPERATOR_TOKEN`.
- Регулярно обновляйте зависимости и ОС.
- Делайте бэкапы PostgreSQL.

## 11. Если deployment на Timeweb Apps (без root)

Если используете managed-приложения Timeweb:
- отдельно поднимаете сервисы `api` и `bot` как Node приложения,
- `miniapp` как static hosting,
- PostgreSQL берете managed DB от Timeweb,
- переменные окружения задаете в панели Timeweb для каждого сервиса,
- `DATABASE_URL` берете из панели базы.

Принцип тот же, меняется только способ запуска процессов.
