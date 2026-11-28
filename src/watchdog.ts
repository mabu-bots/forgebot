// ==========================================
// 🐶 READY ウォッチドッグ（Gateway 安全構造）
// ==========================================
// ログイン後に READY が来ない「サイレント停滞」を検知し、プロセスを
// 終了させて pm2 に再起動させるための保険。接続が生きていて
// ハートビート ACK も返る状態では discord.js の自動再接続が
// 働かない場合がある。
// discord.js は Client を destroy すると同じインスタンスでは
// 再ログインできないため、回復はプロセス再起動に委ねる。

import type { Client } from "discord.js";

// ⏱️ READY でない状態がこの時間続いたら停滞とみなす
export const NOT_READY_LIMIT_MS = 120_000; // 2分
// ⏱️ 確認間隔
export const WATCHDOG_INTERVAL_MS = 30_000; // 30秒

// ==========================================
// 🐶 停滞判定（純粋な状態追跡）
// ==========================================

export class ReadyWatchdog {
  private notReadySince: number | null;

  constructor(now: number) {
    this.notReadySince = now;
  }

  // 👀 READY 状態を観測する。READY でなくなった瞬間から数え直す
  observe(isReady: boolean, now: number): void {
    if (isReady) {
      this.notReadySince = null;
    } else if (this.notReadySince === null) {
      this.notReadySince = now;
    }
  }

  // 🔄 発動したときに起点をリセットする
  onFire(now: number): void {
    this.notReadySince = now;
  }

  // ⏰ 停滞が上限を超えたかどうか
  isExpired(now: number, limitMs: number): boolean {
    return this.notReadySince !== null && now - this.notReadySince >= limitMs;
  }
}

// ==========================================
// 🔌 Client への取り付け
// ==========================================

// 🐶 定期的に READY 状態を見て、停滞していたらログを残して終了する。
// 戻り値はタイマーを止める関数（終了処理・テスト用）。
export function attachReadyWatchdog(
  client: Client,
  options: {
    limitMs?: number;
    intervalMs?: number;
    log?: (message: string) => void;
    exit?: (code: number) => void;
  } = {},
): () => void {
  const limitMs = options.limitMs ?? NOT_READY_LIMIT_MS;
  const intervalMs = options.intervalMs ?? WATCHDOG_INTERVAL_MS;
  const log = options.log ?? ((message: string) => console.error(message));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const watchdog = new ReadyWatchdog(Date.now());
  const timer = setInterval(() => {
    const now = Date.now();
    watchdog.observe(client.isReady(), now);
    if (!watchdog.isExpired(now, limitMs)) return;
    log(
      `[watchdog] READY が ${Math.round(limitMs / 1000)} 秒以上来ないためプロセスを終了します (pm2 が再起動します)`,
    );
    watchdog.onFire(now);
    exit(1);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
