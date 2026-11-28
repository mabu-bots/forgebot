// ==========================================
// ⏳ クールダウンの追跡
// ==========================================
// check（判定のみ）と record（消費）を分離しているのが要点。
// 判定しただけでは消費せず、実行が成功した時点で呼び出し側が
// record する。これにより「条件を満たさず実行されなかった」
// ケースでクールダウンが無駄に消費されることがない。

export interface CooldownCheck {
  allowed: boolean;
  remainingMs: number;
}

// 🧱 キーごとの最終実行時刻をメモリに保持するトラッカー
export class CooldownTracker {
  private readonly lastUsedAt = new Map<string, number>();
  private readonly clock: () => number;

  constructor(now: () => number = Date.now) {
    this.clock = now;
  }

  // ⏳ 実行可能かどうかを調べる（消費しない）
  check(key: string, cooldownSeconds: number): CooldownCheck {
    if (cooldownSeconds <= 0) return { allowed: true, remainingMs: 0 };
    const last = this.lastUsedAt.get(key);
    if (last === undefined) return { allowed: true, remainingMs: 0 };
    const remainingMs = last + cooldownSeconds * 1000 - this.clock();
    if (remainingMs <= 0) return { allowed: true, remainingMs: 0 };
    return { allowed: false, remainingMs };
  }

  // ⏳ 実行したことを記録する
  record(key: string): void {
    this.lastUsedAt.set(key, this.clock());
  }

  // 🧹 1キー分だけ記録を消す
  clear(key: string): void {
    this.lastUsedAt.delete(key);
  }

  // 🧹 全キーの記録を消す
  clearAll(): void {
    this.lastUsedAt.clear();
  }
}

// 🔑 クールダウンのキーをギルド・Blueprint・ユーザーから組み立てる
export function cooldownKey(
  guildId: string,
  blueprintName: string,
  userId: string,
): string {
  return `${guildId}:${blueprintName}:${userId}`;
}
