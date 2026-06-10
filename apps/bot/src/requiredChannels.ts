import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const rootEnvPath = path.join(monorepoRoot, ".env");

let cachedChannels: { mtimeMs: number; channels: string[] } | null = null;

export function getRequiredChannels(): string[] {
  try {
    const stat = fs.statSync(rootEnvPath);
    if (!cachedChannels || cachedChannels.mtimeMs !== stat.mtimeMs) {
      const parsed = dotenv.parse(fs.readFileSync(rootEnvPath));
      const raw = (parsed.REQUIRED_CHANNELS ?? process.env.REQUIRED_CHANNELS ?? "").replace(/^\uFEFF/, "");
      cachedChannels = {
        mtimeMs: stat.mtimeMs,
        channels: raw
          .split(",")
          .map((channel) => channel.trim())
          .filter(Boolean)
      };
    }
    return cachedChannels.channels;
  } catch {
    return (process.env.REQUIRED_CHANNELS ?? "")
      .split(",")
      .map((channel) => channel.trim())
      .filter(Boolean);
  }
}

const ALLOWED_MEMBER_STATUSES = new Set(["member", "administrator", "creator", "restricted"]);

export async function checkTelegramChannelSubscriptions(
  botToken: string,
  telegramUserId: number,
  channels: string[] = getRequiredChannels()
): Promise<boolean> {
  if (channels.length === 0) {
    return true;
  }

  const userId = Number(telegramUserId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return false;
  }

  for (const channel of channels) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: channel,
        user_id: userId
      })
    });

    const data = (await response.json()) as {
      ok?: boolean;
      description?: string;
      result?: { status?: string };
    };

    if (!response.ok || !data.ok) {
      console.warn("[ruletka-bot] subscription check failed", { channel, description: data.description, userId });
      return false;
    }

    const status = data.result?.status;
    if (!status || !ALLOWED_MEMBER_STATUSES.has(status)) {
      console.warn("[ruletka-bot] subscription not active", { channel, userId, status });
      return false;
    }
  }

  return true;
}
