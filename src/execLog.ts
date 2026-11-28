// ==========================================
// 📋 コマンド実行ログ（1行形式）
// ==========================================
// スラッシュコマンドの実行を標準出力へ1行で記録する:
//   [exec] <ISO時刻> cmd=<名前> route=slash guild=<ID> channel=<ID> user=<ID> result=<ok|error>
// 失敗時は末尾に error="<要点>" を付ける。
// 記録するのはコマンド名・ID・成否だけ。ユーザーの入力テキストは
// 記録しない。Blueprint の自動実行はコマンドではないため対象外。

// ➖ ID が空なら "-" にする
function idOrDash(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "-" : value;
}

// ⚠️ エラーの要点を1行に整える: 空白を潰し、引用符を置き換え、
// 120文字で切り詰める。空なら "unknown error"。
export function summarizeExecError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.trim() === "") return "unknown error";
  const cleaned = message.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  const chars = Array.from(cleaned);
  return chars.length > 120 ? chars.slice(0, 120).join("") : cleaned;
}

export interface ExecLogFields {
  command: string;
  guildId: string | null;
  channelId: string | null;
  userId: string;
  // 📝 値がある場合だけ失敗として記録する（null / undefined は成功）
  error?: unknown;
}

// 📋 実行ログを1行の文字列に整形する
export function formatExecLog(now: Date, fields: ExecLogFields): string {
  const base =
    `[exec] ${now.toISOString()} cmd=${idOrDash(fields.command)} route=slash` +
    ` guild=${idOrDash(fields.guildId)} channel=${idOrDash(fields.channelId)}` +
    ` user=${idOrDash(fields.userId)}`;
  if (fields.error === null || fields.error === undefined) {
    return `${base} result=ok`;
  }
  return `${base} result=error error="${summarizeExecError(fields.error)}"`;
}

// 📋 標準出力へ実行ログを出す
export function logExec(fields: ExecLogFields): void {
  console.log(formatExecLog(new Date(), fields));
}
