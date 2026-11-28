// ==========================================
// 🌱 親密度（成長段階）の算出
// ==========================================
// 段階は実行総数と稼働日数の両方から決まる純粋関数で算出する。
// 段階は表示だけに使い、基本機能のロックには使わない。

export interface GrowthInfo {
  level: number;
  label: string;
  executions: number;
  activeDays: number;
}

export interface GrowthRecord {
  guildId: string;
  totalExecutions: number;
  activeDays: number;
  lastActiveDate: string | null;
  firstActiveAt: string | null;
}

// 🏷️ 段階ごとの呼び名
const LEVEL_LABELS: Record<number, string> = {
  1: "始動",
  2: "定着",
  3: "活発",
  4: "成熟",
  5: "熟練",
};

// 📊 実行総数と稼働日数から段階を決める（負数は 0 として扱う）
export function computeGrowthStage(
  executions: number,
  activeDays: number,
): GrowthInfo {
  const exec = Math.max(0, Math.floor(executions));
  const days = Math.max(0, Math.floor(activeDays));
  let level = 1;
  if (exec >= 10 && days >= 1) level = 2;
  if (exec >= 50 && days >= 7) level = 3;
  if (exec >= 200 && days >= 30) level = 4;
  if (exec >= 500 && days >= 60) level = 5;
  return {
    level,
    label: LEVEL_LABELS[level] ?? "始動",
    executions: exec,
    activeDays: days,
  };
}

// 🌱 保存済みの成長記録から段階を算出する（記録なしは実行数のみで近似）
export function growthFromRecord(
  record: GrowthRecord | null,
  fallbackExecutions = 0,
): GrowthInfo {
  if (record === null) return computeGrowthStage(fallbackExecutions, 0);
  return computeGrowthStage(record.totalExecutions, record.activeDays);
}
