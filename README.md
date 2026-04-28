# Колесо фортуны - Telegram Mini App

Стартовый каркас проекта:
- `apps/miniapp` - React Mini App
- `apps/api` - Fastify API для спинов и призов
- `apps/bot` - Telegraf бот с проверкой подписки
- `prisma/schema.prisma` - целевая схема базы данных

## Быстрый запуск

1. Скопируйте `.env.example` в `.env` и заполните значения.
2. Установите зависимости:

```bash
npm install
```

3. Сгенерируйте Prisma Client:

```bash
npm run prisma:generate
```

4. Поднимите PostgreSQL (опционально через Docker):

```bash
docker compose up -d
```

5. Примените миграции (когда БД доступна):

```bash
npm run prisma:migrate
```

6. Запуск по отдельности:

```bash
npm run dev:api
npm run dev:bot
npm run dev:miniapp
```

## Что уже реализовано

- API:
  - `POST /auth/telegram` (поддерживает проверку Telegram `initData` через `TELEGRAM_BOT_TOKEN`)
  - `GET /app/state` (требует `Authorization: Bearer <accessToken>`)
  - `POST /spin` (лимит 1 раз в неделю, PostgreSQL/Prisma)
  - `POST /wins/:winId/send-to-shop` (реальная отправка в чат магазина через Bot API)
  - `GET /admin/prizes` (требует заголовок `x-admin-token`)
  - `POST /admin/prizes` (требует заголовок `x-admin-token`)
  - `PATCH /admin/prizes/:prizeId` (требует заголовок `x-admin-token`)
  - `DELETE /admin/prizes/:prizeId` (требует заголовок `x-admin-token`)
  - `POST /admin/prizes/:prizeId/image-upload` (multipart, поле `file`)
  - `POST /operator/wins/:winId/claim` (требует заголовок `x-operator-token`)
  - `POST /operator/wins/:winId/reject` (требует заголовок `x-operator-token`)
  - `GET /operator/wins/:winId/logs` (требует заголовок `x-operator-token`)
- Bot:
  - `/start` + проверка подписки на каналы из `REQUIRED_CHANNELS`
  - `/check` для повторной проверки подписки
  - кнопка `web_app` для открытия Mini App
  - `/claim_win <win_id> [комментарий]` для оператора
  - `/reject_win <win_id> [причина]` для оператора
- Mini App:
  - авторизация через Telegram WebApp (`initData`) с получением `accessToken`
  - запуск спина через API
  - отправка приза оператору через API
  - экран "Мои призы"

Дополнительно:
- `POST /spin` теперь повторно проверяет подписку на обязательные каналы на backend.
- API запускает фоновую задачу экспирации активных выигрышей (`EXPIRATION_JOB_INTERVAL_MS`).
- Загруженные изображения призов отдаются через `/uploads/*`.
- Тексты условий в HTML формате санитизируются на backend перед сохранением.
- CORS ограничивается через `CORS_ORIGINS` (если не задано, разрешен только localhost).

## Следующий шаг

Сделать UI-админку для призов и добавить отдельный cron-воркер для фоновой экспирации.

## Deployment guide

Подробная инструкция по Timeweb и Telegram: `DEPLOY_TIMEWEB.md`.

Готовые шаблоны для сервера:
- `ecosystem.config.cjs` (PM2 процессы)
- `deploy/nginx/ruletka.conf` (Nginx)
- `deploy/DEPLOY_QUICKSTART.md` (быстрый запуск)
