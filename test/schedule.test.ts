import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScheduleTrigger } from "../src/blueprint.js";
import {
  isScheduleDue,
  isValidTimezone,
  lastDailyOccurrence,
  nextDailyOccurrence,
  parseDailyTime,
} from "../src/schedule.js";

function intervalTrigger(minutes: number): ScheduleTrigger {
  return {
    type: "schedule",
    intervalMinutes: minutes,
    timezone: "Asia/Tokyo",
    channelId: "c1",
    template: "定期送信",
  };
}

function dailyTrigger(dailyTime: string, timezone: string): ScheduleTrigger {
  return {
    type: "schedule",
    dailyTime,
    timezone,
    channelId: "c1",
    template: "日次送信",
  };
}

test("parseDailyTime は HH:MM だけを受け付ける", () => {
  assert.deepEqual(parseDailyTime("09:00"), { hour: 9, minute: 0 });
  assert.deepEqual(parseDailyTime("23:59"), { hour: 23, minute: 59 });
  assert.equal(parseDailyTime("24:00"), null);
  assert.equal(parseDailyTime("9:00"), null);
  assert.equal(parseDailyTime("09:60"), null);
});

test("isValidTimezone は IANA 名を検証する", () => {
  assert.equal(isValidTimezone("Asia/Tokyo"), true);
  assert.equal(isValidTimezone("UTC"), true);
  assert.equal(isValidTimezone("Nowhere/Somewhere"), false);
});

test("間隔スケジュールは未実行なら即対象になる", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  assert.equal(isScheduleDue(intervalTrigger(60), null, now), true);
});

test("間隔スケジュールは前回から間隔が経過したときだけ対象になる", () => {
  const trigger = intervalTrigger(60);
  const now = new Date("2026-01-01T12:00:00Z");
  assert.equal(
    isScheduleDue(trigger, new Date("2026-01-01T11:30:00Z"), now),
    false,
  );
  assert.equal(
    isScheduleDue(trigger, new Date("2026-01-01T11:00:00Z"), now),
    true,
  );
  assert.equal(
    isScheduleDue(trigger, new Date("2026-01-01T10:59:00Z"), now),
    true,
  );
});

test("日次スケジュール (UTC) は当日の実行時刻を基準に判定する", () => {
  const trigger = dailyTrigger("09:00", "UTC");
  const before = new Date("2026-01-01T08:00:00Z");
  assert.deepEqual(
    lastDailyOccurrence(trigger, before),
    new Date("2025-12-31T09:00:00Z"),
  );
  assert.equal(
    isScheduleDue(trigger, new Date("2025-12-31T09:00:00Z"), before),
    false,
  );
  const after = new Date("2026-01-01T09:30:00Z");
  assert.deepEqual(
    lastDailyOccurrence(trigger, after),
    new Date("2026-01-01T09:00:00Z"),
  );
  assert.equal(
    isScheduleDue(trigger, new Date("2025-12-31T09:00:00Z"), after),
    true,
  );
  assert.equal(
    isScheduleDue(trigger, new Date("2026-01-01T09:00:00Z"), after),
    false,
  );
  assert.equal(isScheduleDue(trigger, null, after), true);
});

test("日次スケジュール (Asia/Tokyo) はタイムゾーン境界で判定する", () => {
  const trigger = dailyTrigger("09:00", "Asia/Tokyo");
  // 2026-01-01T00:30:00Z は東京では 1月1日 09:30
  const now = new Date("2026-01-01T00:30:00Z");
  assert.deepEqual(
    lastDailyOccurrence(trigger, now),
    new Date("2026-01-01T00:00:00Z"),
  );
  assert.equal(
    isScheduleDue(trigger, new Date("2025-12-31T00:00:00Z"), now),
    true,
  );
  assert.equal(
    isScheduleDue(trigger, new Date("2026-01-01T00:00:00Z"), now),
    false,
  );
  assert.deepEqual(
    nextDailyOccurrence(trigger, now),
    new Date("2026-01-02T00:00:00Z"),
  );
});

test("nextDailyOccurrence は当日の時刻前なら当日を返す", () => {
  const trigger = dailyTrigger("09:00", "Asia/Tokyo");
  // 2025-12-31T23:30:00Z は東京では 1月1日 08:30
  const now = new Date("2025-12-31T23:30:00Z");
  assert.deepEqual(
    nextDailyOccurrence(trigger, now),
    new Date("2026-01-01T00:00:00Z"),
  );
});
