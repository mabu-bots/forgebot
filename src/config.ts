// ==========================================
// ⚙️ 環境変数から設定を読み込む
// ==========================================
// 必須の DISCORD_TOKEN / DISCORD_CLIENT_ID が欠けていれば
// ConfigError を投げて起動を止める。任意項目は既定値に倒す。

// ❌ 設定が不正・不足している場合のエラー
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ForgeConfig {
  token: string;
  clientId: string;
  guildId: string | null;
  disabled: boolean;
  dbPath: string;
}

// 🔍 真偽値として解釈する（1 / true / yes のみ真、それ以外は偽）
function parseBooleanFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const text = value.trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

// ⚙️ 環境変数を ForgeConfig へ変換する（必須不足は ConfigError）
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ForgeConfig {
  const token = env.DISCORD_TOKEN?.trim() ?? "";
  const clientId = env.DISCORD_CLIENT_ID?.trim() ?? "";
  const missing: string[] = [];
  if (token === "") missing.push("DISCORD_TOKEN");
  if (clientId === "") missing.push("DISCORD_CLIENT_ID");
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(", ")}`,
    );
  }
  const guildId = env.DISCORD_GUILD_ID?.trim() ?? "";
  const dbPath = env.FORGE_DB_PATH?.trim() ?? "";
  return {
    token,
    clientId,
    guildId: guildId === "" ? null : guildId,
    disabled: parseBooleanFlag(env.FORGE_DISABLED),
    dbPath: dbPath === "" ? "data/forge.sqlite" : dbPath,
  };
}
