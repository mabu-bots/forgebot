import assert from "node:assert/strict";
import { test } from "node:test";
import { CooldownTracker } from "../src/cooldown.js";

test("未記録のキーは許可され、記録直後は残り時間つきでブロックされる", () => {
  let now = 1_000_000;
  const tracker = new CooldownTracker(() => now);
  assert.equal(tracker.check("k", 60).allowed, true);
  tracker.record("k");
  const blocked = tracker.check("k", 60);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remainingMs, 60_000);
  now += 30_000;
  assert.equal(tracker.check("k", 60).remainingMs, 30_000);
});

test("クールダウン時間が過ぎれば再び許可される", () => {
  let now = 0;
  const tracker = new CooldownTracker(() => now);
  tracker.record("k");
  now += 61_000;
  assert.equal(tracker.check("k", 60).allowed, true);
});

test("キーが違えば互いに干渉しない", () => {
  const tracker = new CooldownTracker(() => 0);
  tracker.record("a");
  assert.equal(tracker.check("a", 60).allowed, false);
  assert.equal(tracker.check("b", 60).allowed, true);
});

test("クールダウン 0 秒は記録直後でも許可される", () => {
  const tracker = new CooldownTracker(() => 0);
  tracker.record("k");
  assert.equal(tracker.check("k", 0).allowed, true);
});

test("clear で記録を消すと許可される", () => {
  const tracker = new CooldownTracker(() => 0);
  tracker.record("k");
  tracker.clear("k");
  assert.equal(tracker.check("k", 60).allowed, true);
});
