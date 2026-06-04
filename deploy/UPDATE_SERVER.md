# Обновление на сервере (пошагово)

Инструкция для применения текущих изменений на production: UI мини-приложения, idle-анимация, статус приза «Получен», Prisma enum `received`.

Путь к проекту ниже — **`/var/www/ruletka`**. Замените на свой, если другой.

---

## 0. Перед началом

- Есть SSH-доступ к серверу.
- На сервере уже настроены: Node.js, PM2, Nginx, PostgreSQL, файл `.env` в корне репозитория.
- В `.env` заданы как минимум:
  - `DATABASE_URL`
  - `VITE_API_BASE_URL` (URL API для сборки miniapp, например `https://apibot.yourdomain.ru`)
  - `VITE_APP_TIME_ZONE` (например `Asia/Irkutsk`)
  - остальные переменные из `.env.example`

Сделайте бэкап БД (по желанию):

```bash
pg_dump "$DATABASE_URL" -Fc -f ~/ruletka-backup-$(date +%Y%m%d).dump
```

---

## 1. Подключиться к серверу

```bash
ssh user@your-server
cd /var/www/ruletka
```

---

## 2. Забрать код

```bash
git status
git pull origin main
```

Если ветка не `main`, подставьте свою (`master`, `production` и т.д.).

При конфликтах — разрешите их до следующих шагов.

---

## 3. Зависимости (если менялся `package-lock.json`)

```bash
npm install
```

---

## 4. База данных — новый статус `received`

В схеме добавлен статус выигрыша `received` (кнопка «Заказ получен»).

```bash
npm run prisma:generate
npx prisma db push --schema prisma/schema.prisma
```

Ожидаемо: Prisma применит изменения enum без потери данных.  
Если `db push` ругается — пришлите вывод в лог; не используйте `--force-reset` на production.

---

## 5. Сборка API

```bash
npm run build --workspace @ruletka/api
```

Проверка, что появился `apps/api/dist/index.js`:

```bash
test -f apps/api/dist/index.js && echo OK
```

---

## 6. Сборка Mini App

Переменные `VITE_*` читаются из корневого `.env` при сборке.

```bash
npm run build --workspace @ruletka/miniapp
```

Проверка статики:

```bash
test -f apps/miniapp/dist/index.html && echo OK
```

Nginx должен отдавать каталог `apps/miniapp/dist` (см. `deploy/nginx/ruletka.conf`).

---

## 7. Перезапуск процессов PM2

```bash
pm2 restart ruletka-api --update-env
pm2 restart ruletka-bot --update-env
pm2 save
pm2 status
```

Оба процесса должны быть в статусе **online**.

---

## 8. Nginx (обычно без правок)

Если конфиг не меняли — достаточно проверить и перезагрузить:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 9. Проверка после деплоя

### API

```bash
curl -sS https://apibot.yourdomain.ru/health
```

Подставьте свой домен API.

### Логи

```bash
pm2 logs ruletka-api --lines 50
pm2 logs ruletka-bot --lines 30
```

Ошибок Prisma / `received` быть не должно.

### Mini App в Telegram

1. Откройте бота → колесо (лучше закрыть и открыть мини-приложение заново, чтобы сбросить кэш).
2. Главная: один приз по центру, idle-анимация (пауза → лёгкий сдвиг → следующий приз).
3. **Мои призы** → **Заказ получен** → приз **остаётся в списке**, статус **«Получен»** (не пропадает).
4. Страницы **Условия** — шапка как у «Мои призы», скроллбар зелёный.

---

## 10. Краткая шпаргалка (все команды подряд)

```bash
cd /var/www/ruletka
git pull origin main
npm install
npm run prisma:generate
npx prisma db push --schema prisma/schema.prisma
npm run build --workspace @ruletka/api
npm run build --workspace @ruletka/miniapp
pm2 restart ruletka-api --update-env
pm2 restart ruletka-bot --update-env
pm2 save
sudo nginx -t && sudo systemctl reload nginx
curl -sS https://apibot.yourdomain.ru/health
```

---

## Что изменилось в этом релизе

| Компонент | Изменения |
|-----------|-----------|
| **Prisma** | enum `WinStatus.received` |
| **API** | «Заказ получен» → статус `received`, приз в `/app/state` |
| **Miniapp** | UI, шрифты, idle-анимация, центрирование слота, скроллбар, страницы условий |

Бот перезапускается на всякий случай; логика бота в этом релизе могла не меняться.

---

## Если что-то пошло не так

| Симптом | Действие |
|---------|----------|
| API падает после `db push` | `pm2 logs ruletka-api`, проверить `DATABASE_URL` и вывод `prisma db push` |
| Белый экран miniapp | пересобрать с правильным `VITE_API_BASE_URL` в `.env` |
| Старый UI в Telegram | полностью закрыть mini app, открыть снова; при CDN — hard refresh |
| «Заказ получен» снова скрывает приз | на сервере старый API — повторить шаги 5 и 7 |

Полная первичная установка: `deploy/DEPLOY_QUICKSTART.md`, `DEPLOY_TIMEWEB.md`, `DEPLOY_BEGET.md`.
