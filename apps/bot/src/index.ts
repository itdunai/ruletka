import "dotenv/config";
import type { Context } from "telegraf";
import { Markup, Telegraf } from "telegraf";

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

function parseRequiredChannelLinks(raw: string | undefined): Array<{ title: string; url: string }> {
  if (!raw?.trim()) return [];
  return raw
    .split("@@@")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const idx = segment.indexOf("###");
      if (idx === -1) return null;
      const title = segment.slice(0, idx).trim();
      const url = segment.slice(idx + 3).trim();
      if (!title || !url) return null;
      return { title, url };
    })
    .filter((item): item is { title: string; url: string } => Boolean(item));
}

const requiredChannelLinkItems = parseRequiredChannelLinks(process.env.REQUIRED_CHANNELS_LINKS);

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
