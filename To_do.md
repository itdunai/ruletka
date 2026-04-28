# To Do: Telegram Mini App "Колесо фортуны"

## 1) Рекомендуемый стек (MVP + масштабирование)

- **Frontend Mini App**: React + Vite + TypeScript
- **Bot**: Node.js + Telegraf
- **Backend API**: Node.js + Fastify (или NestJS, если нужен строгий enterprise-скелет)
- **DB**: PostgreSQL
- **ORM**: Prisma
- **Хранилище изображений призов**: S3-совместимое (Cloudflare R2 / MinIO / AWS S3)
- **Кэш (опционально)**: Redis (для rate limit и кеша проверок подписки)
- **Deploy**: Docker Compose (bot + api + db + redis), затем можно вынести на VPS/Cloud

Почему этот вариант:
- быстро стартует (MVP за короткий срок);
- легко добавлять призы, шансы, новые механики;
- безопасная серверная логика спина (не в браузере).

---

## 2) Архитектура

### Поток пользователя

1. Пользователь нажимает `/start` у бота.
2. Бот проверяет подписку на обязательные каналы через `getChatMember`.
3. Если подписан:
   - бот отправляет кнопку `Открыть "Колесо фортуны"` (`web_app`).
4. Mini App открывается внутри Telegram.
5. Frontend передает `initData` на backend.
6. Backend валидирует подпись Telegram и авторизует пользователя.
7. Пользователь жмет "Крутить".
8. Backend проверяет лимит: не чаще 1 раза в 7 дней.
9. Backend выбирает приз по вероятностям, записывает выигрыш, ставит `expires_at = now + 3 дня`.
10. Пользователь нажимает "Отправить магазину":
    - backend отправляет сообщение от бота в чат магазина/оператора,
    - либо создает deep-link для ручной отправки в ЛС магазину.

### Ключевой принцип

**Все критичное делается на сервере**:
- проверка лимита,
- случайный выбор приза,
- срок жизни приза,
- статус использования.

---

## 3) Схема БД (минимально необходимая)

## `users`
- `id` (uuid, pk)
- `telegram_id` (bigint, unique)
- `username` (text, nullable)
- `first_name` (text, nullable)
- `last_name` (text, nullable)
- `created_at`
- `updated_at`

## `channels`
- `id` (uuid, pk)
- `telegram_chat_id` (bigint/string, unique)
- `title` (text)
- `required` (bool, default true)
- `active` (bool, default true)

## `prizes`
- `id` (uuid, pk)
- `title` (text) — например "Скидка 10%"
- `type` (enum: `discount`, `delivery`, `gift`, `deposit`, `none`)
- `value` (text/decimal nullable) — например `10`, `500`, `free`
- `image_url` (text, nullable)
- `weight` (numeric) — вероятность
- `is_active` (bool, default true)
- `stock` (int, nullable) — если нужно ограниченное количество
- `created_at`
- `updated_at`

## `spins`
- `id` (uuid, pk)
- `user_id` (fk -> users)
- `spin_at` (timestamp)
- `prize_id` (fk -> prizes)
- `request_ip` (text, nullable)
- `user_agent` (text, nullable)

## `wins`
- `id` (uuid, pk)
- `user_id` (fk -> users)
- `spin_id` (fk -> spins, unique)
- `prize_id` (fk -> prizes)
- `status` (enum: `active`, `claimed`, `expired`, `cancelled`)
- `promo_code` (text, nullable, unique) — если нужно кодировать приз
- `expires_at` (timestamp)
- `claimed_at` (timestamp, nullable)
- `created_at`

## `shop_notifications` (опционально, для аудита отправок оператору)
- `id` (uuid, pk)
- `win_id` (fk -> wins)
- `sent_to_chat_id` (bigint/string)
- `message_id` (bigint/string, nullable)
- `status` (enum: `sent`, `failed`)
- `error_text` (text, nullable)
- `created_at`

---

## 4) API контракты (черновик)

## Auth / Session
- `POST /auth/telegram`
  - body: `{ initData: string }`
  - action: валидация подписи Telegram + upsert пользователя
  - response: `{ accessToken, user }`

## App info
- `GET /app/state`
  - response:
    - `canSpin: boolean`
    - `nextSpinAt: isoDate | null`
    - `activeWin: { ... } | null`
    - `prizesPreview: Prize[]` (для UI-ленты)

## Spin
- `POST /spin`
  - checks:
    - подписка активна
    - лимит 1 раз в 7 дней
  - action:
    - weighted random
    - create `spins`, `wins`
  - response:
    - `{ winId, prize, expiresAt, canSendToShop: true/false }`

## Win actions
- `POST /wins/:id/send-to-shop`
  - checks: win принадлежит юзеру, status=`active`, не истек
  - action: сообщение от бота в чат магазина
  - response: `{ ok: true, ticketId/messageId }`

- `POST /wins/:id/claim` (если оператор подтверждает вручную)
  - action: переводит `status=claimed`

## Admin
- `GET /admin/prizes`
- `POST /admin/prizes`
- `PATCH /admin/prizes/:id`
- `POST /admin/prizes/:id/image-upload`
- `POST /admin/prizes/reorder-or-reweight`

---

## 5) Логика вероятностей

Рекомендация:
- хранить `weight` как числа (например 25, 15, 8...);
- активные призы: `is_active=true`, `stock != 0` (если есть лимит);
- при спине:
  1. отобрать доступные призы,
  2. посчитать сумму весов,
  3. взять `r in [0, sum)`,
  4. пройти список и выбрать по накопленной сумме.

Валидации:
- сумма весов > 0;
- нет отрицательных весов;
- предупреждение администратору, если общий вес "ломаный" после правок.

---

## 6) Проверка подписки

Где проверять:
- при `/start` перед показом кнопки web_app,
- повторно на backend перед `POST /spin` (защита от обхода).

Технически:
- для каждого обязательного канала вызвать `getChatMember`.
- допускать статусы: `member`, `administrator`, `creator`.
- если не подписан: бот показывает список каналов + кнопку "Проверить подписку снова".

---

## 7) Отправка приза магазину: варианты

## Вариант A (предпочтительно)
Сообщение **от бота** в чат оператора/магазина:
- надежно фиксируется;
- можно добавить кнопки "Подтвердить выдачу" / "Отклонить";
- сохраняется аудит.

## Вариант B
Кнопка для пользователя "Открыть чат с магазином" + готовый текст/код приза:
- проще,
- но слабее контроль и аудит.

Рекомендация: делать A как основной, B как резерв.

---

## 8) Что взять из текущего демо

Из `fortune_slot_fixed2.html` можно взять:
- визуал и анимацию колеса;
- экраны: Main / Result / Terms / My Prizes;
- UX-поток.

Что обязательно перенести на сервер:
- `pickPrize()`,
- таймер попытки 1 раз в неделю,
- сроки сгорания 3 дня,
- хранение выигрышей.

---

## 9) План работ по этапам

## Этап 1. Основа проекта
- [x] Инициализация монорепо/папок: `apps/miniapp`, `apps/bot`, `apps/api`
- [x] Docker Compose: PostgreSQL (+ Redis опционально)
- [ ] Prisma schema + миграции (schema + prisma generate готовы, миграции еще не применены)
- [x] Общие env и секреты

## Этап 2. Bot + доступ к Mini App
- [x] `/start` и приветственный сценарий
- [x] Проверка подписки на обязательные каналы
- [x] Кнопка `web_app` после успешной проверки
- [x] Команда "Проверить подписку снова"

## Этап 3. Backend
- [x] Валидация Telegram `initData`
- [x] `POST /auth/telegram`
- [x] `GET /app/state`
- [x] `POST /spin` (лимиты + weighted random)
- [x] `POST /wins/:id/send-to-shop`
- [x] Cron-задача на перевод wins в `expired` (interval worker в API)

## Этап 4. Mini App UI
- [x] Встроить Telegram WebApp SDK (initData + initDataUnsafe)
- [x] Экран колеса (MVP кнопка + вызов `POST /spin`)
- [x] Экран результата (MVP)
- [x] Экран "Мои призы" (active/expired/claimed)
- [x] Блокировка кнопки, если нельзя крутить (серверная через 429, клиент показывает ошибку)

## Этап 5. Админка призов
- [x] CRUD призов (API endpoints + `x-admin-token`)
- [x] Загрузка изображений (multipart endpoint + `/uploads`)
- [x] Редактирование веса/вероятности (через PATCH API)
- [x] Валидации (весы, активность, остатки) — не даем удалить/деактивировать все активные призы

## Этап 6. Операторский поток
- [x] Шаблон сообщения о выигрыше в чат магазина
- [x] Подтверждение выдачи приза оператором (API + команды бота)
- [x] Лог действий по призу (таблица `shop_notifications` + endpoint логов)

## Этап 7. Качество и запуск
- [ ] Логи и мониторинг ошибок
- [ ] Базовые e2e тесты (спин/лимит/экспирация)
- [ ] Релизный чеклист

---

## 10) Критичные бизнес-правила (фиксируем сразу)

- [ ] Крутить можно только 1 раз в 7 суток (по UTC или фиксированной TZ, например Europe/Moscow).
- [ ] Приз активен ровно 3 суток с момента выдачи.
- [ ] Просроченный приз автоматически получает статус `expired`.
- [ ] Один выигрыш не может быть одновременно `claimed` и `expired`.
- [x] Проверка подписки обязательна перед каждым спином.

---

## 11) MVP-сроки (реалистично)

- **MVP (без полной админки)**: 4-7 дней
- **MVP + простая админка призов**: 7-12 дней
- **Production-пакет (мониторинг, расширенные проверки, UX полировка)**: 2-3 недели

---

## 12) Что можно сделать следующим шагом

- [ ] Подготовить точную структуру каталогов под ваш проект.
- [ ] Сразу развернуть каркас `bot + api + miniapp + prisma`.
- [ ] Перенести текущий HTML-дизайн в React-компоненты Mini App.
