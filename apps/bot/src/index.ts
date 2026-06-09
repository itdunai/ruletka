import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "telegraf";
import { Markup, Telegraf } from "telegraf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(__dirname, "../../..");
const rootEnvPath = path.join(monorepoRoot, ".env");
void dotenv.config({ path: rootEnvPath });
void dotenv.config();

function readChannelLinksRaw(): string {
  const fromEnv = process.env.REQUIRED_CHANNELS_LINKS?.replace(/^\uFEFF/, "").trim();
  if (fromEnv) return fromEnv;
  const filePath = process.env.REQUIRED_CHANNELS_LINKS_FILE?.trim();
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
  }
  const defaultPath = path.join(monorepoRoot, "deploy", "required-channel-links.txt");
  if (fs.existsSync(defaultPath)) {
    return fs.readFileSync(defaultPath, "utf8").replace(/^\uFEFF/, "").trim();
  }
  return "";
}

const token = process.env.BOT_TOKEN;
const miniAppUrl = process.env.MINIAPP_URL ?? "https://example.com/miniapp";
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
const operatorToken = process.env.OPERATOR_TOKEN ?? "";
const requiredChannels = (process.env.REQUIRED_CHANNELS ?? "")
  .split(",")
  .map((channel: string) => channel.trim())
  .filter(Boolean);

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function splitChannelTitleAndUrl(segment: string): { title: string; url: string } | null {
  const pipeIdx = segment.indexOf("|||");
  if (pipeIdx !== -1) {
    const title = segment.slice(0, pipeIdx).trim();
    const url = segment.slice(pipeIdx + 3).trim();
    if (title && url) return { title, url };
  }
  const hashIdx = segment.indexOf("###");
  if (hashIdx !== -1) {
    const title = segment.slice(0, hashIdx).trim();
    const url = segment.slice(hashIdx + 3).trim();
    if (title && url) return { title, url };
  }
  return null;
}

function parseRequiredChannelLinks(raw: string | undefined): Array<{ title: string; url: string }> {
  if (!raw?.trim()) return [];
  const segments = raw.includes("@@@") ? raw.split("@@@") : raw.split(/\r?\n/);
  return segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => splitChannelTitleAndUrl(segment))
    .filter((item): item is { title: string; url: string } => Boolean(item));
}

const channelLinksRaw = readChannelLinksRaw();
let requiredChannelLinkItems = parseRequiredChannelLinks(channelLinksRaw);
const fallbackLinksPath = path.join(monorepoRoot, "deploy", "required-channel-links.txt");
if (requiredChannelLinkItems.length === 0 && fs.existsSync(fallbackLinksPath)) {
  const fallbackRaw = fs.readFileSync(fallbackLinksPath, "utf8").replace(/^\uFEFF/, "").trim();
  requiredChannelLinkItems = parseRequiredChannelLinks(fallbackRaw);
  if (requiredChannelLinkItems.length > 0) {
    console.info("[ruletka-bot] channel links loaded from", fallbackLinksPath);
  }
}

console.info(
  "[ruletka-bot] REQUIRED_CHANNELS_LINKS:",
  requiredChannelLinkItems.length > 0
    ? `${requiredChannelLinkItems.length} entries (titles with links)`
    : `empty or unparsed — env length ${process.env.REQUIRED_CHANNELS_LINKS?.length ?? 0}; blob length ${channelLinksRaw.length}; use ||| between title and URL; or deploy/required-channel-links.txt`
);

function formatRequiredChannelsListHtml(): string {
  if (requiredChannelLinkItems.length > 0) {
    return requiredChannelLinkItems
      .map((item) => `• <a href="${escapeAttr(item.url)}">${escapeHtml(item.title)}</a>`)
      .join("\n");
  }
  if (requiredChannels.length > 0) {
    return requiredChannels.map((id) => `• <code>${escapeHtml(id)}</code>`).join("\n");
  }
  return "• @your_channel";
}

if (!token) {
  throw new Error("BOT_TOKEN is required");
}

const bot = new Telegraf(token);

async function safeReply(ctx: Context, text: string, extra?: Parameters<Context["reply"]>[1]) {
  try {
    await ctx.reply(text, extra);
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    console.warn("[ruletka-bot] reply failed", { chatId: ctx.chat?.id, description });
  }
}

async function isSubscribedToAllRequiredChannels(telegramUserId: number): Promise<boolean> {
  if (requiredChannels.length === 0) {
    return true;
  }

  for (const channelId of requiredChannels) {
    try {
      const member = await bot.telegram.getChatMember(channelId, telegramUserId);
      const allowedStatuses = new Set(["member", "administrator", "creator"]);
      if (!allowedStatuses.has(member.status)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function openMiniAppKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.webApp("Открыть Колесо фортуны", miniAppUrl)
  ]);
}

async function operatorWinAction(action: "claim" | "reject", winId: string, reason?: string) {
  if (!operatorToken) {
    throw new Error("OPERATOR_TOKEN is required for operator commands");
  }
  const response = await fetch(`${apiBaseUrl}/operator/wins/${winId}/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-operator-token": operatorToken
    },
    body: JSON.stringify({ reason })
  });
  const data = (await response.json()) as { ok?: boolean; status?: string; message?: string };
  if (!response.ok || !data.ok) {
    throw new Error(data.message ?? "Operator action failed");
  }
  return data;
}

bot.start(async (ctx) => {
  const subscribed = await isSubscribedToAllRequiredChannels(ctx.from.id);

  if (!subscribed) {
    await safeReply(
      ctx,
      [
        "Перед запуском приложения нужно подписаться на каналы:",
        "",
        formatRequiredChannelsListHtml(),
        "",
        "После подписки нажмите /check"
      ].join("\n"),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    );
    return;
  }

  await safeReply(ctx, "Доступ открыт. Можно запускать мини-приложение.", openMiniAppKeyboard());
});

bot.command("check", async (ctx) => {
  const subscribed = await isSubscribedToAllRequiredChannels(ctx.from.id);
  if (!subscribed) {
    await safeReply(
      ctx,
      [
        "Подписка пока не подтверждена. Проверьте каналы и попробуйте снова.",
        "",
        formatRequiredChannelsListHtml()
      ].join("\n"),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    );
    return;
  }
  await safeReply(ctx, "Подписка подтверждена.", openMiniAppKeyboard());
});

bot.command("claim_win", async (ctx) => {
  const [command, winId, ...reasonParts] = ctx.message.text.trim().split(" ");
  if (command !== "/claim_win" || !winId) {
    await safeReply(ctx, "Формат: /claim_win <win_id> [комментарий]");
    return;
  }
  try {
    const reason = reasonParts.join(" ").trim() || undefined;
    const result = await operatorWinAction("claim", winId, reason);
    await safeReply(ctx, `Приз подтвержден. Статус: ${result.status}`);
  } catch (error) {
    await safeReply(ctx, `Ошибка подтверждения: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("reject_win", async (ctx) => {
  const [command, winId, ...reasonParts] = ctx.message.text.trim().split(" ");
  if (command !== "/reject_win" || !winId) {
    await safeReply(ctx, "Формат: /reject_win <win_id> [причина]");
    return;
  }
  try {
    const reason = reasonParts.join(" ").trim() || undefined;
    const result = await operatorWinAction("reject", winId, reason);
    await safeReply(ctx, `Приз отклонен. Статус: ${result.status}`);
  } catch (error) {
    await safeReply(ctx, `Ошибка отклонения: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.catch((error, ctx) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[ruletka-bot] handler error", ctx.updateType, message);
});

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
