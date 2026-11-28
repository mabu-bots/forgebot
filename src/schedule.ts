// ==========================================
// ⏰ スケジュール Trigger の時刻計算
// ==========================================
// 間隔（分）ベースと、タイムゾーン付き日次時刻（HH:MM）ベースの
// 2形式を扱う。日次は Intl の壁時計変換で UTC の瞬間へ直す。
// 夏時間の境界でもずれないよう、変換は差分が 0 になるまで反復する。

import type { ScheduleTrigger } from "./blueprint.js";

// 🌍 IANA タイムゾーン名として有効か
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// ⏰ "HH:MM" を解釈する（形式が合わなければ null）
export function parseDailyTime(
  value: string,
): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (match === null) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

// ==========================================
// 🌍 壁時計と UTC の相互変換
// ==========================================

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// 🌍 ある瞬間を指定タイムゾーンの壁時計として読み取る
function wallClockOf(timezone: string, instant: Date): WallClockParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.get("year")),
    month: Number(byType.get("month")),
    day: Number(byType.get("day")),
    hour: Number(byType.get("hour")),
    minute: Number(byType.get("minute")),
    second: Number(byType.get("second")),
  };
}

// 🌍 壁時計の日時に対応する UTC の瞬間を求める（反復補正、最大3回）
function utcInstantOfWallClock(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = wallClockOf(timezone, new Date(utc));
    const roundTripped = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const diff = target - roundTripped;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

// 📅 壁時計の日付を指定日数だけずらす
function shiftDate(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// ⏰ 指定した壁時計日付における日次実行時刻
function dailyOccurrenceOn(
  trigger: ScheduleTrigger,
  year: number,
  month: number,
  day: number,
): Date {
  const time = parseDailyTime(trigger.dailyTime ?? "");
  if (time === null) {
    throw new Error("schedule trigger requires dailyTime");
  }
  return utcInstantOfWallClock(
    trigger.timezone,
    year,
    month,
    day,
    time.hour,
    time.minute,
  );
}

// ==========================================
// ⏰ 直近・次回の日次実行時刻
// ==========================================

// ⏰ now 以前で最も新しい日次実行時刻
export function lastDailyOccurrence(trigger: ScheduleTrigger, now: Date): Date {
  const parts = wallClockOf(trigger.timezone, now);
  const today = dailyOccurrenceOn(trigger, parts.year, parts.month, parts.day);
  if (today.getTime() <= now.getTime()) return today;
  const prev = shiftDate(parts.year, parts.month, parts.day, -1);
  return dailyOccurrenceOn(trigger, prev.year, prev.month, prev.day);
}

// ⏰ after より後で最も近い日次実行時刻
export function nextDailyOccurrence(
  trigger: ScheduleTrigger,
  after: Date,
): Date {
  const parts = wallClockOf(trigger.timezone, after);
  const today = dailyOccurrenceOn(trigger, parts.year, parts.month, parts.day);
  if (today.getTime() > after.getTime()) return today;
  const next = shiftDate(parts.year, parts.month, parts.day, 1);
  return dailyOccurrenceOn(trigger, next.year, next.month, next.day);
}

// ==========================================
// 🔍 実行すべきかどうかの判定
// ==========================================

// ⏰ 判定ルール:
// - 間隔形式: 最終実行から intervalMinutes 経過していれば対象（未実行は常に対象）
// - 日次形式: 最終実行が直近の実行時刻より前なら対象（未実行は常に対象）
export function isScheduleDue(
  trigger: ScheduleTrigger,
  lastRunAt: Date | null,
  now: Date,
): boolean {
  if (trigger.intervalMinutes !== undefined) {
    if (lastRunAt === null) return true;
    return (
      lastRunAt.getTime() + trigger.intervalMinutes * 60_000 <= now.getTime()
    );
  }
  if (lastRunAt === null) return true;
  const occurrence = lastDailyOccurrence(trigger, now);
  return lastRunAt.getTime() < occurrence.getTime();
}
