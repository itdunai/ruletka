import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fallbackLinksPath = path.join(monorepoRoot, "deploy", "required-channel-links.txt");

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

function readChannelLinksRaw(): string {
  const fromEnv = process.env.REQUIRED_CHANNELS_LINKS?.replace(/^\uFEFF/, "").trim();
  if (fromEnv) return fromEnv;
  const filePath = process.env.REQUIRED_CHANNELS_LINKS_FILE?.trim();
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
  }
  if (fs.existsSync(fallbackLinksPath)) {
    return fs.readFileSync(fallbackLinksPath, "utf8").replace(/^\uFEFF/, "").trim();
  }
  return "";
}

export function getRequiredChannelLinkItems(): Array<{ title: string; url: string }> {
  const fromEnv = parseRequiredChannelLinks(readChannelLinksRaw());
  if (fromEnv.length > 0) return fromEnv;
  return parseRequiredChannelLinks(
    fs.existsSync(fallbackLinksPath) ? fs.readFileSync(fallbackLinksPath, "utf8").replace(/^\uFEFF/, "").trim() : ""
  );
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function formatSubscriptionReminderHtml(channelIds: string[]): string {
  const links = getRequiredChannelLinkItems();
  const channelsBlock =
    links.length > 0
      ? links.map((item) => `• <a href="${escapeAttr(item.url)}">${escapeHtml(item.title)}</a>`).join("\n")
      : channelIds.length > 0
        ? channelIds.map((id) => `• <code>${escapeHtml(id)}</code>`).join("\n")
        : "• каналы магазина (уточните у поддержки)";

  return [
    "⚠️ <b>Чтобы крутить колесо, нужна подписка на каналы:</b>",
    "",
    channelsBlock,
    "",
    "<b>Что сделать:</b>",
    "1. Подпишитесь на все каналы из списка выше",
    "2. Вернитесь в этот чат и нажмите /check",
    "3. Снова откройте «Колесо фортуны» и нажмите «Крутить»"
  ].join("\n");
}
