import crypto from "node:crypto";

const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

type ParsedInitData = {
  hash: string;
  authDate: number;
  user?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
};

function parseInitData(initData: string): ParsedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDateRaw = params.get("auth_date");

  if (!hash || !authDateRaw) {
    throw new Error("initData must include hash and auth_date");
  }

  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) {
    throw new Error("auth_date is invalid");
  }

  const userRaw = params.get("user");
  const user = userRaw ? (JSON.parse(userRaw) as ParsedInitData["user"]) : undefined;

  return { hash, authDate, user };
}

function buildDataCheckString(initData: string): string {
  const params = new URLSearchParams(initData);
  params.delete("hash");
  return [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function validateTelegramInitData(initData: string, botToken: string): ParsedInitData {
  const parsed = parseInitData(initData);
  const ageSeconds = Math.floor(Date.now() / 1000) - parsed.authDate;
  if (ageSeconds > MAX_INIT_DATA_AGE_SECONDS) {
    throw new Error("initData is expired");
  }

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const checkString = buildDataCheckString(initData);
  const calculatedHash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");

  if (calculatedHash !== parsed.hash) {
    throw new Error("initData hash mismatch");
  }

  return parsed;
}
