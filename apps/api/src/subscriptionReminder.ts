import { formatSubscriptionReminderHtml } from "./channelLinks.js";
import { getRequiredChannels } from "./requiredChannels.js";

const SUBSCRIPTION_REMINDER_COOLDOWN_MS = Number(process.env.SUBSCRIPTION_REMINDER_COOLDOWN_MS ?? 5 * 60 * 1000);
const reminderSentAtByUserId = new Map<string, number>();

export async function sendSubscriptionReminderToUser(input: {
  userId: string;
  userTelegramId: bigint;
  botToken: string;
}): Promise<{ sent: boolean; skipped?: string }> {
  const now = Date.now();
  const lastSentAt = reminderSentAtByUserId.get(input.userId) ?? 0;
  if (now - lastSentAt < SUBSCRIPTION_REMINDER_COOLDOWN_MS) {
    return { sent: false, skipped: "cooldown" };
  }

  const message = formatSubscriptionReminderHtml(getRequiredChannels());
  const chatId = input.userTelegramId.toString();

  const telegramResponse = await fetch(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true }
    })
  });

  const telegramData = (await telegramResponse.json()) as {
    ok?: boolean;
    description?: string;
  };

  if (!telegramResponse.ok || !telegramData.ok) {
    return { sent: false, skipped: telegramData.description ?? "send_failed" };
  }

  reminderSentAtByUserId.set(input.userId, now);
  return { sent: true };
}
