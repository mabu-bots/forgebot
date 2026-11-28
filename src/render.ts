// ==========================================
// 🖨️ テンプレート文字列の描画
// ==========================================
// {user} {server} {count:キー} {var:キー} {memory:キー}
// {random:最小-最大} {choice:A,B,...} {messageUrl} {reactionCount}
// を置換する。未知のプレースホルダはエラーにせず原文のまま残し、
// 形式が不正な既知プレースホルダだけ RenderError にする。

export interface RenderContext {
  user: string;
  server: string;
  messageUrl?: string;
  reactionCount?: number;
  getCounter: (key: string) => number;
  getVariable?: (key: string) => string | null;
  getMemory?: (key: string) => string | null;
  rng?: () => number;
}

// ❌ プレースホルダの形式が不正な場合のエラー
export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/g;

// 🔍 キー付きプレースホルダ（count: / var: / memory:）のキーを取り出す
function keyAfterPrefix(raw: string, prefix: string): string {
  const key = raw.slice(prefix.length);
  if (key === "") {
    throw new RenderError(`{${prefix}} requires a key`);
  }
  return key;
}

// 🔍 {random:最小-最大} を描画する
function renderRandom(raw: string, rng: () => number): string {
  const body = raw.slice("random:".length);
  const parts = body.split("-");
  if (parts.length !== 2) {
    throw new RenderError(
      `{random:} requires a range like {random:1-100}: {${raw}}`,
    );
  }
  const min = Number(parts[0]);
  const max = Number(parts[1]);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    throw new RenderError(
      `{random:} requires integer bounds with min <= max: {${raw}}`,
    );
  }
  return String(min + Math.floor(rng() * (max - min + 1)));
}

// 🔍 {choice:A,B,...} を描画する
function renderChoice(raw: string, rng: () => number): string {
  const options = raw
    .slice("choice:".length)
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option !== "");
  if (options.length === 0) {
    throw new RenderError("{choice:} requires at least one option");
  }
  // 📏 rng() が 1 を返しても範囲外にならないよう上限で丸める
  const index = Math.min(
    options.length - 1,
    Math.floor(rng() * options.length),
  );
  return options[index] ?? options[0]!;
}

// 🔍 プレースホルダ1件を解決する
function resolvePlaceholder(raw: string, ctx: RenderContext): string {
  const rng = ctx.rng ?? Math.random;
  switch (raw) {
    case "user":
      return ctx.user;
    case "server":
      return ctx.server;
    case "messageUrl":
      return ctx.messageUrl ?? "";
    case "reactionCount":
      return ctx.reactionCount === undefined ? "" : String(ctx.reactionCount);
  }
  if (raw.startsWith("count:")) {
    return String(ctx.getCounter(keyAfterPrefix(raw, "count:")));
  }
  if (raw.startsWith("var:")) {
    return ctx.getVariable?.(keyAfterPrefix(raw, "var:")) ?? "";
  }
  if (raw.startsWith("memory:")) {
    return ctx.getMemory?.(keyAfterPrefix(raw, "memory:")) ?? "";
  }
  if (raw.startsWith("random:")) return renderRandom(raw, rng);
  if (raw.startsWith("choice:")) return renderChoice(raw, rng);
  // ⚠️ 未知のプレースホルダはそのまま残す（ユーザーの文章を壊さない）
  return `{${raw}}`;
}

// 🖨️ テンプレート全体を描画する
export function renderTemplate(template: string, ctx: RenderContext): string {
  return template.replace(PLACEHOLDER_PATTERN, (_whole, raw: string) =>
    resolvePlaceholder(raw, ctx),
  );
}
