import "dotenv/config";
import { Markup, Telegraf } from "telegraf";

const token = process.env.BOT_TOKEN;
const miniAppUrl = process.env.MINIAPP_URL ?? "https://example.com/miniapp";
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
const operatorToken = process.env.OPERATOR_TOKEN ?? "";
const requiredChannels = (process.env.REQUIRED_CHANNELS ?? "")
  .split(",")
  .map((channel: string) => channel.trim())
  .filter(Boolean);

if (!token) {
  throw new Error("BOT_TOKEN is required");
}

const bot = new Telegraf(token);

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
    const channelsText =
      requiredChannels.length > 0 ? requiredChannels.map((channel: string) => `- ${channel}`).join("\n") : "- @your_channel";

    await ctx.reply(
      [
        "Перед запуском приложения нужно подписаться на каналы:",
        channelsText,
        "",
        "После подписки нажмите /check"
      ].join("\n")
    );
    return;
  }

  await ctx.reply("Доступ открыт. Можно запускать мини-приложение.", openMiniAppKeyboard());
});

bot.command("check", async (ctx) => {
  const subscribed = await isSubscribedToAllRequiredChannels(ctx.from.id);
  if (!subscribed) {
    await ctx.reply("Подписка пока не подтверждена. Проверьте каналы и попробуйте снова.");
    return;
  }
  await ctx.reply("Подписка подтверждена.", openMiniAppKeyboard());
});

bot.command("claim_win", async (ctx) => {
  const [command, winId, ...reasonParts] = ctx.message.text.trim().split(" ");
  if (command !== "/claim_win" || !winId) {
    await ctx.reply("Формат: /claim_win <win_id> [комментарий]");
    return;
  }
  try {
    const reason = reasonParts.join(" ").trim() || undefined;
    const result = await operatorWinAction("claim", winId, reason);
    await ctx.reply(`Приз подтвержден. Статус: ${result.status}`);
  } catch (error) {
    await ctx.reply(`Ошибка подтверждения: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("reject_win", async (ctx) => {
  const [command, winId, ...reasonParts] = ctx.message.text.trim().split(" ");
  if (command !== "/reject_win" || !winId) {
    await ctx.reply("Формат: /reject_win <win_id> [причина]");
    return;
  }
  try {
    const reason = reasonParts.join(" ").trim() || undefined;
    const result = await operatorWinAction("reject", winId, reason);
    await ctx.reply(`Приз отклонен. Статус: ${result.status}`);
  } catch (error) {
    await ctx.reply(`Ошибка отклонения: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
