import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { Prisma, PrizeType, ShopNotificationAction, ShopNotificationStatus, WinStatus } from "@prisma/client";
import jwt from "jsonwebtoken";
import sanitizeHtml from "sanitize-html";
import { fileTypeFromBuffer } from "file-type";
import { getDefaultPrizesWithoutId, pickWeightedPrize, type Prize } from "./prizes.js";
import { prisma } from "./db.js";
import { validateTelegramInitData } from "./telegram.js";

const SPIN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const WIN_EXPIRATION_MS = 3 * 24 * 60 * 60 * 1000;
const EXPIRATION_JOB_INTERVAL_MS = Number(process.env.EXPIRATION_JOB_INTERVAL_MS ?? 60_000);
const SPIN_READY_REMINDER_INTERVAL_MS = Number(process.env.SPIN_READY_REMINDER_INTERVAL_MS ?? 300_000);
const DEMO_TELEGRAM_ID = 700000001;
const adminToken = process.env.ADMIN_TOKEN ?? "";
const operatorToken = process.env.OPERATOR_TOKEN ?? "";
const shopChatId = process.env.SHOP_CHAT_ID ?? "";
const botToken = process.env.BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN ?? "";
const requiredChannels = (process.env.REQUIRED_CHANNELS ?? "")
  .split(",")
  .map((channel) => channel.trim())
  .filter(Boolean);
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "uploads");
const uploadBaseUrl = process.env.UPLOAD_BASE_URL ?? "";
const jwtSecret = process.env.JWT_SECRET ?? "";
const accessTokenTtl = process.env.ACCESS_TOKEN_TTL ?? "7d";
const shopOperatorUsername = process.env.SHOP_OPERATOR_USERNAME ?? "@snus_irk_operator";
const spinReadyReminderText =
  process.env.SPIN_READY_REMINDER_TEXT?.trim() || "🎯 Доступна новая попытка! Возвращайтесь крутить колесо.";
const CONTENT_KEYS = {
  promoTerms: "content.promo_terms",
  prizeTerms: "content.prize_terms"
} as const;
const DEFAULT_PROMO_TERMS = [
  "<h3>Правила</h3>",
  "<ul>",
  "<li>Подпишитесь на каналы магазина</li>",
  "<li>Нажмите \"Крутить\"</li>",
  "<li>Приз действует 3 дня</li>",
  "<li>Покажите сообщение оператору</li>",
  "<li>1 попытка в неделю</li>",
  "</ul>"
].join("");
const DEFAULT_PRIZE_TERMS = [
  "<h3>Как получить</h3>",
  "<ul>",
  "<li>Отправьте приз оператору до заказа</li>",
  "<li>Срок действия: 3 дня</li>",
  "<li>Только для владельца аккаунта</li>",
  "</ul>"
].join("");

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (corsOrigins.length === 0) {
      const allowLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      return callback(null, allowLocalhost);
    }
    callback(null, corsOrigins.includes(origin));
  }
});
await app.register(sensible);
await app.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  }
});
await fs.mkdir(uploadDir, { recursive: true });
await app.register(fastifyStatic, {
  root: uploadDir,
  prefix: "/uploads/"
});

const authSchema = z.object({
  telegramId: z.number().int().positive().optional(),
  username: z.string().optional().default(""),
  initData: z.string().optional().default(""),
  firstName: z.string().optional(),
  lastName: z.string().optional()
});

const spinSchema = z.object({
  telegramId: z.number().int().positive()
});

const adminPrizeCreateSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["discount", "delivery", "gift", "deposit", "none"]),
  value: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  weight: z.number().positive(),
  isActive: z.boolean().optional().default(true),
  stock: z.number().int().nonnegative().nullable().optional()
});

const adminPrizeUpdateSchema = adminPrizeCreateSchema.partial();
const operatorWinActionSchema = z.object({
  reason: z.string().max(500).optional()
});
const adminContentUpdateSchema = z.object({
  promoTerms: z.string().min(1),
  prizeTerms: z.string().min(1)
});
const uploadPathSchema = z.object({
  prizeId: z.string().uuid()
});

function toDbPrizeType(type: Prize["type"]): PrizeType {
  switch (type) {
    case "discount":
      return PrizeType.discount;
    case "delivery":
      return PrizeType.delivery;
    case "gift":
      return PrizeType.gift;
    case "deposit":
      return PrizeType.deposit;
    case "none":
      return PrizeType.none;
    default:
      return PrizeType.none;
  }
}

function toApiPrizeType(type: PrizeType): Prize["type"] {
  switch (type) {
    case PrizeType.discount:
      return "discount";
    case PrizeType.delivery:
      return "delivery";
    case PrizeType.gift:
      return "gift";
    case PrizeType.deposit:
      return "deposit";
    case PrizeType.none:
      return "none";
    default:
      return "none";
  }
}

async function ensureDefaultPrizes() {
  const count = await prisma.prize.count();
  if (count > 0) return;

  const defaults = getDefaultPrizesWithoutId();
  await prisma.prize.createMany({
    data: defaults.map((prize) => ({
      title: prize.title,
      type: toDbPrizeType(prize.type),
      value: prize.value,
      imageUrl: prize.imageUrl,
      weight: new Prisma.Decimal(prize.weight),
      isActive: prize.isActive
    }))
  });
}

async function ensureDefaultContentSettings() {
  await prisma.appSetting.upsert({
    where: { key: CONTENT_KEYS.promoTerms },
    update: {},
    create: { key: CONTENT_KEYS.promoTerms, value: DEFAULT_PROMO_TERMS }
  });
  await prisma.appSetting.upsert({
    where: { key: CONTENT_KEYS.prizeTerms },
    update: {},
    create: { key: CONTENT_KEYS.prizeTerms, value: DEFAULT_PRIZE_TERMS }
  });
}

async function getContentSettings() {
  await ensureDefaultContentSettings();
  const records = await prisma.appSetting.findMany({
    where: {
      key: { in: [CONTENT_KEYS.promoTerms, CONTENT_KEYS.prizeTerms] }
    }
  });
  const promoTerms = records.find((record) => record.key === CONTENT_KEYS.promoTerms)?.value ?? DEFAULT_PROMO_TERMS;
  const prizeTerms = records.find((record) => record.key === CONTENT_KEYS.prizeTerms)?.value ?? DEFAULT_PRIZE_TERMS;
  return { promoTerms, prizeTerms };
}

function sanitizeAllowedHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ["h3", "ul", "li", "p", "br", "strong", "em", "b", "i"],
    allowedAttributes: {},
    disallowedTagsMode: "discard"
  });
}

async function ensureUser(telegramId: number, username?: string) {
  const telegramIdBigInt = BigInt(telegramId);
  return prisma.user.upsert({
    where: { telegramId: telegramIdBigInt },
    create: {
      telegramId: telegramIdBigInt,
      username: username || null
    },
    update: {
      username: username || null
    }
  });
}

function getNextSpinAt(lastSpinAt: Date | null): Date | null {
  if (!lastSpinAt) return null;
  return new Date(lastSpinAt.getTime() + SPIN_COOLDOWN_MS);
}

function canSpin(lastSpinAt: Date | null): boolean {
  if (!lastSpinAt) return true;
  return Date.now() - lastSpinAt.getTime() >= SPIN_COOLDOWN_MS;
}

function isDemoUser(telegramId: number): boolean {
  return telegramId === DEMO_TELEGRAM_ID;
}

function requireAdmin(request: { headers: Record<string, unknown> }) {
  if (!adminToken) {
    throw app.httpErrors.internalServerError("ADMIN_TOKEN не настроен");
  }
  const candidate = request.headers["x-admin-token"];
  if (candidate !== adminToken) {
    throw app.httpErrors.unauthorized("Неверный admin-токен");
  }
}

function requireOperator(request: { headers: Record<string, unknown> }) {
  if (!operatorToken) {
    throw app.httpErrors.internalServerError("OPERATOR_TOKEN не настроен");
  }
  const candidate = request.headers["x-operator-token"];
  if (candidate !== operatorToken) {
    throw app.httpErrors.unauthorized("Неверный operator-токен");
  }
}

function requireUser(request: { headers: Record<string, unknown> }) {
  if (!jwtSecret) {
    throw app.httpErrors.internalServerError("JWT_SECRET не настроен");
  }
  const authHeader = request.headers.authorization;
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    throw app.httpErrors.unauthorized("Отсутствует Bearer-токен");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  try {
    const payload = jwt.verify(token, jwtSecret) as { userId: string; telegramId: number };
    if (!payload.userId || !payload.telegramId) {
      throw new Error("Некорректное содержимое токена");
    }
    return payload;
  } catch {
    throw app.httpErrors.unauthorized("Токен недействителен или просрочен");
  }
}

async function assertActivePrizePool(tx: Prisma.TransactionClient) {
  const count = await tx.prize.count({
    where: {
      isActive: true,
      weight: { gt: 0 },
      OR: [{ stock: null }, { stock: { gt: 0 } }]
    }
  });
  if (count === 0) {
    throw app.httpErrors.badRequest("Нужен хотя бы один активный приз с положительным весом");
  }
}

async function createNotificationLog(input: {
  winId: string;
  action: ShopNotificationAction;
  status: ShopNotificationStatus;
  sentToChatId?: string;
  messageId?: string;
  errorText?: string;
}) {
  await prisma.shopNotification.create({
    data: {
      winId: input.winId,
      action: input.action,
      status: input.status,
      sentToChatId: input.sentToChatId ?? null,
      messageId: input.messageId ?? null,
      errorText: input.errorText ?? null
    }
  });
}

function formatWinReminderMessage(input: {
  prizeTitle: string;
  username: string | null;
  telegramId: bigint;
  createdAt: Date;
  expiresAt: Date;
}) {
  const userNameLine = input.username ? `@${input.username}` : "не указан";
  return [
    `🎁 Ваш приз: ${input.prizeTitle}`,
    "",
    `👨‍💼️ Для получения приза перешлите это сообщение: ${shopOperatorUsername}, до оформления заказа!`,
    `⚙️ Ваш username: ${userNameLine}`,
    `🆔 Ваш id: ${input.telegramId.toString()}`,
    "🎊 Забрать приз можно в течение 3 дней",
    `🗓 Сегодня: ${input.createdAt.toLocaleString("ru-RU")}, забрать приз можно до: ${input.expiresAt.toLocaleString("ru-RU")}`
  ].join("\n");
}

async function sendWinReminderToUser(input: {
  winId: string;
  userTelegramId: bigint;
  username: string | null;
  prizeTitle: string;
  createdAt: Date;
  expiresAt: Date;
}) {
  if (!botToken) {
    throw app.httpErrors.internalServerError("BOT_TOKEN не настроен");
  }
  const isDemoNotificationTarget = input.userTelegramId.toString() === String(DEMO_TELEGRAM_ID);
  const targetChatId = isDemoNotificationTarget && shopChatId ? shopChatId : input.userTelegramId.toString();
  const message = formatWinReminderMessage({
    prizeTitle: input.prizeTitle,
    username: input.username,
    telegramId: input.userTelegramId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt
  });
  const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: targetChatId,
      text: message
    })
  });
  const telegramData = (await telegramResponse.json()) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  };
  if (!telegramResponse.ok || !telegramData.ok) {
    await createNotificationLog({
      winId: input.winId,
      action: ShopNotificationAction.send_to_shop,
      status: ShopNotificationStatus.failed,
      sentToChatId: targetChatId,
      errorText: telegramData.description ?? "неизвестная ошибка"
    });
    throw app.httpErrors.badGateway(`Не удалось отправить сообщение в чат пользователя: ${telegramData.description ?? "неизвестная ошибка"}`);
  }
  await createNotificationLog({
    winId: input.winId,
    action: ShopNotificationAction.send_to_shop,
    status: ShopNotificationStatus.sent,
    sentToChatId: targetChatId,
    messageId: telegramData.result?.message_id ? String(telegramData.result.message_id) : undefined
  });
  return { messageId: telegramData.result?.message_id ?? null };
}

async function sendSpinReadyReminderToUser(input: { userTelegramId: bigint }) {
  if (!botToken) {
    throw app.httpErrors.internalServerError("BOT_TOKEN не настроен");
  }
  const chatId = input.userTelegramId.toString();
  const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: spinReadyReminderText
    })
  });
  const telegramData = (await telegramResponse.json()) as {
    ok?: boolean;
    description?: string;
  };
  if (!telegramResponse.ok || !telegramData.ok) {
    throw app.httpErrors.badGateway(
      `Не удалось отправить уведомление о новой попытке: ${telegramData.description ?? "неизвестная ошибка"}`
    );
  }
}

async function expireActiveWins() {
  const now = new Date();
  const result = await prisma.win.updateMany({
    where: {
      status: WinStatus.active,
      expiresAt: { lte: now }
    },
    data: { status: WinStatus.expired }
  });
  if (result.count > 0) {
    app.log.info({ expiredCount: result.count }, "Expired stale wins");
  }
}

async function notifyUsersSpinReady() {
  if (!botToken) {
    return;
  }
  const users = await prisma.user.findMany({
    where: {
      spins: { some: {} }
    },
    select: {
      id: true,
      telegramId: true,
      cooldownReminderSpinAt: true,
      spins: {
        select: { spinAt: true },
        orderBy: { spinAt: "desc" },
        take: 1
      }
    }
  });

  for (const user of users) {
    if (user.telegramId === BigInt(DEMO_TELEGRAM_ID)) {
      continue;
    }
    const lastSpinAt = user.spins[0]?.spinAt;
    if (!lastSpinAt) {
      continue;
    }
    const isCooldownComplete = Date.now() - lastSpinAt.getTime() >= SPIN_COOLDOWN_MS;
    if (!isCooldownComplete) {
      continue;
    }
    if (user.cooldownReminderSpinAt && user.cooldownReminderSpinAt.getTime() >= lastSpinAt.getTime()) {
      continue;
    }

    try {
      await sendSpinReadyReminderToUser({ userTelegramId: user.telegramId });
      const updated = await prisma.user.updateMany({
        where: {
          id: user.id,
          OR: [{ cooldownReminderSpinAt: null }, { cooldownReminderSpinAt: { lt: lastSpinAt } }]
        },
        data: {
          cooldownReminderSpinAt: lastSpinAt,
          cooldownReminderSentAt: new Date()
        }
      });
      if (updated.count > 0) {
        app.log.info({ userId: user.id }, "Spin-ready reminder sent");
      }
    } catch (error) {
      app.log.warn({ err: error, userId: user.id }, "Failed to send spin-ready reminder");
    }
  }
}

async function isUserSubscribedToRequiredChannels(telegramId: number): Promise<boolean> {
  if (requiredChannels.length === 0) {
    return true;
  }
  if (!botToken) {
    throw app.httpErrors.internalServerError("Для проверки подписок нужен BOT_TOKEN");
  }

  for (const channel of requiredChannels) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: channel,
        user_id: telegramId
      })
    });

    const data = (await response.json()) as {
      ok?: boolean;
      description?: string;
      result?: { status?: string };
    };

    if (!response.ok || !data.ok) {
      app.log.warn({ channel, description: data.description }, "Failed to check channel membership");
      return false;
    }

    const status = data.result?.status;
    const allowed = new Set(["member", "administrator", "creator"]);
    if (!status || !allowed.has(status)) {
      return false;
    }
  }
  return true;
}

function mapPrizeToApi(prize: {
  id: string;
  title: string;
  type: PrizeType;
  value: string | null;
  weight: Prisma.Decimal;
  imageUrl: string | null;
  isActive: boolean;
  stock: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: prize.id,
    title: prize.title,
    type: toApiPrizeType(prize.type),
    value: prize.value,
    weight: Number(prize.weight),
    imageUrl: prize.imageUrl,
    isActive: prize.isActive,
    stock: prize.stock,
    createdAt: prize.createdAt,
    updatedAt: prize.updatedAt
  };
}

app.get("/health", async () => ({ ok: true }));

app.get("/content/texts", async () => {
  const content = await getContentSettings();
  return content;
});

app.get("/admin/prizes", async (request) => {
  requireAdmin(request);
  await ensureDefaultPrizes();
  const prizes = await prisma.prize.findMany({ orderBy: { createdAt: "asc" } });
  return { items: prizes.map(mapPrizeToApi) };
});

app.post("/admin/prizes", async (request) => {
  requireAdmin(request);
  const parsed = adminPrizeCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    throw app.httpErrors.badRequest("Некорректные данные приза");
  }

  const created = await prisma.$transaction(async (tx) => {
    const createdPrize = await tx.prize.create({
      data: {
        title: parsed.data.title,
        type: toDbPrizeType(parsed.data.type),
        value: parsed.data.value ?? null,
        imageUrl: parsed.data.imageUrl ?? null,
        weight: new Prisma.Decimal(parsed.data.weight),
        isActive: parsed.data.isActive,
        stock: parsed.data.stock ?? null
      }
    });
    await assertActivePrizePool(tx);
    return createdPrize;
  });

  return { item: mapPrizeToApi(created) };
});

app.post("/admin/prizes/:prizeId/image-upload", async (request) => {
  requireAdmin(request);
  const params = uploadPathSchema.parse(request.params);
  const file = await request.file();
  if (!file) {
    throw app.httpErrors.badRequest("Нужно передать файл");
  }
  if (!file.mimetype.startsWith("image/")) {
    throw app.httpErrors.badRequest("Разрешены только файлы изображений");
  }

  const fileBuffer = await file.toBuffer();
  const detected = await fileTypeFromBuffer(fileBuffer);
  if (!detected || !detected.mime.startsWith("image/")) {
    throw app.httpErrors.badRequest("Некорректное содержимое файла изображения");
  }
  const ext = detected.ext || (file.filename.includes(".") ? file.filename.split(".").pop() : "bin");
  const safeExt = (ext || "bin").replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "bin";
  const storedFileName = `${params.prizeId}-${Date.now()}.${safeExt}`;
  const storedPath = path.join(uploadDir, storedFileName);
  await fs.writeFile(storedPath, fileBuffer);

  const publicPath = `/uploads/${storedFileName}`;
  const imageUrl = uploadBaseUrl ? `${uploadBaseUrl.replace(/\/$/, "")}${publicPath}` : publicPath;

  const prize = await prisma.prize.update({
    where: { id: params.prizeId },
    data: { imageUrl }
  });
  return { item: mapPrizeToApi(prize) };
});

app.delete("/admin/prizes/:prizeId/image", async (request) => {
  requireAdmin(request);
  const params = uploadPathSchema.parse(request.params);
  const current = await prisma.prize.findUnique({ where: { id: params.prizeId } });
  if (!current) {
    throw app.httpErrors.notFound("Приз не найден");
  }

  if (current.imageUrl?.startsWith("/uploads/")) {
    const fileName = current.imageUrl.replace("/uploads/", "");
    const filePath = path.join(uploadDir, fileName);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore filesystem cleanup errors to not block image detach.
    }
  }

  const prize = await prisma.prize.update({
    where: { id: params.prizeId },
    data: { imageUrl: null }
  });
  return { item: mapPrizeToApi(prize) };
});

app.patch("/admin/prizes/:prizeId", async (request) => {
  requireAdmin(request);
  const params = z.object({ prizeId: z.string().min(1) }).parse(request.params);
  const parsed = adminPrizeUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    throw app.httpErrors.badRequest("Некорректные данные приза");
  }

  const data: {
    title?: string;
    type?: PrizeType;
    value?: string | null;
    imageUrl?: string | null;
    weight?: Prisma.Decimal;
    isActive?: boolean;
    stock?: number | null;
  } = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.type !== undefined) data.type = toDbPrizeType(parsed.data.type);
  if (parsed.data.value !== undefined) data.value = parsed.data.value;
  if (parsed.data.imageUrl !== undefined) data.imageUrl = parsed.data.imageUrl;
  if (parsed.data.weight !== undefined) data.weight = new Prisma.Decimal(parsed.data.weight);
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  if (parsed.data.stock !== undefined) data.stock = parsed.data.stock;

  const updated = await prisma.$transaction(async (tx) => {
    const updatedPrize = await tx.prize.update({
      where: { id: params.prizeId },
      data
    });
    await assertActivePrizePool(tx);
    return updatedPrize;
  });
  return { item: mapPrizeToApi(updated) };
});

app.delete("/admin/prizes/:prizeId", async (request) => {
  requireAdmin(request);
  const params = z.object({ prizeId: z.string().min(1) }).parse(request.params);
  await prisma.$transaction(async (tx) => {
    await tx.prize.delete({ where: { id: params.prizeId } });
    await assertActivePrizePool(tx);
  });
  return { ok: true };
});

app.get("/admin/content/texts", async (request) => {
  requireAdmin(request);
  return getContentSettings();
});

app.patch("/admin/content/texts", async (request) => {
  requireAdmin(request);
  const parsed = adminContentUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    throw app.httpErrors.badRequest("Некорректные данные контента");
  }

  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: CONTENT_KEYS.promoTerms },
      update: { value: sanitizeAllowedHtml(parsed.data.promoTerms) },
      create: { key: CONTENT_KEYS.promoTerms, value: sanitizeAllowedHtml(parsed.data.promoTerms) }
    }),
    prisma.appSetting.upsert({
      where: { key: CONTENT_KEYS.prizeTerms },
      update: { value: sanitizeAllowedHtml(parsed.data.prizeTerms) },
      create: { key: CONTENT_KEYS.prizeTerms, value: sanitizeAllowedHtml(parsed.data.prizeTerms) }
    })
  ]);

  return { ok: true };
});

app.post("/auth/telegram", async (request) => {
  const parsed = authSchema.safeParse(request.body);
  if (!parsed.success) {
    throw app.httpErrors.badRequest("Некорректные данные авторизации");
  }

  // TODO: validate Telegram initData signature on production.
  const authBotToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
  const hasInitData = parsed.data.initData.trim().length > 0;

  let telegramId = parsed.data.telegramId ?? 0;
  let username = parsed.data.username;
  let firstName = parsed.data.firstName;
  let lastName = parsed.data.lastName;

  if (hasInitData) {
    if (!authBotToken) {
      throw app.httpErrors.internalServerError("TELEGRAM_BOT_TOKEN не настроен");
    }
    const validated = validateTelegramInitData(parsed.data.initData, authBotToken);
    if (!validated.user?.id) {
      throw app.httpErrors.badRequest("В initData отсутствует user id");
    }
    telegramId = validated.user.id;
    username = validated.user.username ?? username;
    firstName = validated.user.first_name ?? firstName;
    lastName = validated.user.last_name ?? lastName;
  } else if (!telegramId) {
    throw app.httpErrors.badRequest("Когда initData отсутствует, нужен telegramId");
  }

  await ensureDefaultPrizes();
  const user = await prisma.user.upsert({
    where: { telegramId: BigInt(telegramId) },
    create: {
      telegramId: BigInt(telegramId),
      username: username || null,
      firstName: firstName || null,
      lastName: lastName || null
    },
    update: {
      username: username || null,
      firstName: firstName || null,
      lastName: lastName || null
    }
  });
  const lastSpin = await prisma.spin.findFirst({
    where: { userId: user.id },
    orderBy: { spinAt: "desc" }
  });
  if (!jwtSecret) {
    throw app.httpErrors.internalServerError("JWT_SECRET не настроен");
  }
  const accessToken = jwt.sign(
    {
      userId: user.id,
      telegramId
    },
    jwtSecret,
    { expiresIn: accessTokenTtl as jwt.SignOptions["expiresIn"] }
  );

  return {
    accessToken,
    user: {
      telegramId,
      username,
      firstName,
      lastName
    },
    canSpin: isDemoUser(telegramId) ? true : canSpin(lastSpin?.spinAt ?? null),
    nextSpinAt: isDemoUser(telegramId) ? null : getNextSpinAt(lastSpin?.spinAt ?? null)
  };
});

app.get("/app/state", async (request) => {
  const auth = requireUser(request);
  await ensureDefaultPrizes();
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) {
    throw app.httpErrors.notFound("Пользователь не найден");
  }
  const now = new Date();

  await prisma.win.updateMany({
    where: {
      userId: user.id,
      status: WinStatus.active,
      expiresAt: { lte: now }
    },
    data: { status: WinStatus.expired }
  });

  const [lastSpin, wins, prizes] = await Promise.all([
    prisma.spin.findFirst({
      where: { userId: user.id },
      orderBy: { spinAt: "desc" }
    }),
    prisma.win.findMany({
      where: { userId: user.id },
      include: { prize: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.prize.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" }
    })
  ]);

  return {
    canSpin: isDemoUser(auth.telegramId) ? true : canSpin(lastSpin?.spinAt ?? null),
    nextSpinAt: isDemoUser(auth.telegramId) ? null : getNextSpinAt(lastSpin?.spinAt ?? null),
    wins: wins.map((win) => ({
      id: win.id,
      prizeId: win.prizeId,
      prizeTitle: win.prize.title,
      status: win.status,
      expiresAt: win.expiresAt,
      createdAt: win.createdAt
    })),
    prizesPreview: prizes.map((prize) => ({
      id: prize.id,
      title: prize.title,
      type: toApiPrizeType(prize.type),
      value: prize.value,
      weight: Number(prize.weight),
      imageUrl: prize.imageUrl,
      isActive: prize.isActive
    }))
  };
});

app.post("/spin", async (request) => {
  const auth = requireUser(request);
  await ensureDefaultPrizes();
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) {
    throw app.httpErrors.notFound("Пользователь не найден");
  }
  if (!isDemoUser(auth.telegramId)) {
    const isSubscribed = await isUserSubscribedToRequiredChannels(auth.telegramId);
    if (!isSubscribed) {
      throw app.httpErrors.forbidden("Нет подписки на обязательные каналы");
    }
  }
  const now = new Date();

  await expireActiveWins();

  const lastSpin = await prisma.spin.findFirst({
    where: { userId: user.id },
    orderBy: { spinAt: "desc" }
  });

  if (!isDemoUser(auth.telegramId) && !canSpin(lastSpin?.spinAt ?? null)) {
    throw app.httpErrors.tooManyRequests("Крутить можно только один раз в неделю");
  }

  const dbPrizes = await prisma.prize.findMany({
    where: {
      isActive: true,
      OR: [{ stock: null }, { stock: { gt: 0 } }]
    },
    orderBy: { createdAt: "asc" }
  });

  const prizesForPick: Prize[] = dbPrizes.map((prize) => ({
    id: prize.id,
    title: prize.title,
    type: toApiPrizeType(prize.type),
    value: prize.value,
    weight: Number(prize.weight),
    imageUrl: prize.imageUrl,
    isActive: prize.isActive
  }));

  const prize = pickWeightedPrize(prizesForPick);
  const expiresAt = new Date(now.getTime() + WIN_EXPIRATION_MS);

  const spin = await prisma.spin.create({
    data: {
      userId: user.id,
      prizeId: prize.id,
      spinAt: now,
      requestIp: request.ip,
      userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null
    }
  });

  await prisma.user.update({
    where: { id: user.id },
    data: {
      cooldownReminderSpinAt: null,
      cooldownReminderSentAt: null
    }
  });

  const win = await prisma.win.create({
    data: {
      userId: user.id,
      spinId: spin.id,
      prizeId: prize.id,
      status: WinStatus.active,
      expiresAt
    }
  });

  const dbPrize = dbPrizes.find((item) => item.id === prize.id);
  if (dbPrize?.stock && dbPrize.stock > 0) {
    await prisma.prize.update({
      where: { id: dbPrize.id },
      data: { stock: dbPrize.stock - 1 }
    });
  }

  let reminderSent = false;
  try {
    await sendWinReminderToUser({
      winId: win.id,
      userTelegramId: user.telegramId,
      username: user.username,
      prizeTitle: prize.title,
      createdAt: now,
      expiresAt
    });
    reminderSent = true;
  } catch (error) {
    app.log.error({ err: error, winId: win.id }, "Failed to send win reminder to user");
  }

  return {
    winId: win.id,
    prize,
    createdAt: now,
    expiresAt,
    nextSpinAt: getNextSpinAt(now),
    reminderSent
  };
});

app.post("/wins/:winId/send-to-shop", async (request) => {
  const params = z.object({ winId: z.string().min(1) }).parse(request.params);
  const auth = requireUser(request);
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) {
    throw app.httpErrors.notFound("Пользователь не найден");
  }
  const win = await prisma.win.findFirst({
    where: {
      id: params.winId,
      userId: user.id
    }
  });
  if (!win) {
    throw app.httpErrors.notFound("Выигрыш не найден");
  }
  if (win.status !== WinStatus.active) {
    throw app.httpErrors.badRequest("Выигрыш неактивен");
  }
  if (win.expiresAt.getTime() <= Date.now()) {
    await prisma.win.update({
      where: { id: win.id },
      data: { status: WinStatus.expired }
    });
    throw app.httpErrors.badRequest("Срок действия выигрыша истек");
  }

  const winWithPrize = await prisma.win.findUnique({
    where: { id: win.id },
    include: { prize: true, user: true }
  });
  if (!winWithPrize) {
    throw app.httpErrors.notFound("Выигрыш не найден");
  }
  const sent = await sendWinReminderToUser({
    winId: win.id,
    userTelegramId: winWithPrize.user.telegramId,
    username: winWithPrize.user.username,
    prizeTitle: winWithPrize.prize.title,
    createdAt: winWithPrize.createdAt,
    expiresAt: winWithPrize.expiresAt
  });
  return { ok: true, message: "Сообщение с напоминанием о призе отправлено в чат пользователя", messageId: sent.messageId };
});

app.post("/operator/wins/:winId/claim", async (request) => {
  requireOperator(request);
  const params = z.object({ winId: z.string().min(1) }).parse(request.params);
  const body = operatorWinActionSchema.parse(request.body ?? {});
  const win = await prisma.win.findUnique({
    where: { id: params.winId },
    include: { prize: true, user: true }
  });
  if (!win) {
    throw app.httpErrors.notFound("Выигрыш не найден");
  }
  if (win.status !== WinStatus.active) {
    throw app.httpErrors.badRequest("Подтвердить можно только активный выигрыш");
  }
  if (win.expiresAt.getTime() <= Date.now()) {
    await prisma.win.update({
      where: { id: win.id },
      data: { status: WinStatus.expired }
    });
    throw app.httpErrors.badRequest("Срок действия выигрыша истек");
  }

  const updated = await prisma.win.update({
    where: { id: win.id },
    data: { status: WinStatus.claimed, claimedAt: new Date() }
  });

  await createNotificationLog({
    winId: win.id,
    action: ShopNotificationAction.claim,
    status: ShopNotificationStatus.sent,
    sentToChatId: shopChatId || undefined,
    errorText: body.reason
  });

  return { ok: true, winId: updated.id, status: updated.status };
});

app.post("/operator/wins/:winId/reject", async (request) => {
  requireOperator(request);
  const params = z.object({ winId: z.string().min(1) }).parse(request.params);
  const body = operatorWinActionSchema.parse(request.body ?? {});
  const win = await prisma.win.findUnique({ where: { id: params.winId } });
  if (!win) {
    throw app.httpErrors.notFound("Выигрыш не найден");
  }
  if (win.status !== WinStatus.active) {
    throw app.httpErrors.badRequest("Отклонить можно только активный выигрыш");
  }

  const updated = await prisma.win.update({
    where: { id: win.id },
    data: { status: WinStatus.cancelled }
  });

  await createNotificationLog({
    winId: win.id,
    action: ShopNotificationAction.reject,
    status: ShopNotificationStatus.sent,
    sentToChatId: shopChatId || undefined,
    errorText: body.reason
  });

  return { ok: true, winId: updated.id, status: updated.status };
});

app.get("/operator/wins/:winId/logs", async (request) => {
  requireOperator(request);
  const params = z.object({ winId: z.string().min(1) }).parse(request.params);
  const logs = await prisma.shopNotification.findMany({
    where: { winId: params.winId },
    orderBy: { createdAt: "asc" }
  });
  return { items: logs };
});

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "0.0.0.0";
const expirationTimer = setInterval(() => {
  void expireActiveWins().catch((error) => app.log.error({ err: error }, "Expiration job failed"));
}, EXPIRATION_JOB_INTERVAL_MS);
const spinReadyReminderTimer = setInterval(() => {
  void notifyUsersSpinReady().catch((error) => app.log.error({ err: error }, "Spin-ready reminder job failed"));
}, SPIN_READY_REMINDER_INTERVAL_MS);

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

void expireActiveWins().catch((error) => app.log.error({ err: error }, "Initial expiration sync failed"));
void notifyUsersSpinReady().catch((error) => app.log.error({ err: error }, "Initial spin-ready reminder sync failed"));

const shutdown = async (signal: string) => {
  clearInterval(expirationTimer);
  clearInterval(spinReadyReminderTimer);
  app.log.info({ signal }, "Shutting down API");
  await prisma.$disconnect();
  process.exit(0);
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
