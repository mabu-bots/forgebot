import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBlueprint } from "../src/blueprint.js";
import { Store } from "../src/store.js";

function reactionBlueprint(name: string) {
  return validateBlueprint({
    name,
    trigger: {
      type: "reaction",
      threshold: 5,
      channelId: "111",
      template: "送信",
    },
    conditions: [{ type: "always" }],
    actions: [{ type: "sendToChannel", channelId: "111", template: "送信" }],
  });
}

function scheduleBlueprint(name: string) {
  return validateBlueprint({
    name,
    trigger: {
      type: "schedule",
      dailyTime: "09:00",
      timezone: "Asia/Tokyo",
      channelId: "222",
      template: "送信",
    },
    conditions: [{ type: "always" }],
    actions: [{ type: "sendToChannel", channelId: "222", template: "送信" }],
  });
}

test("発火済みの記録は一度だけ成功し、対象の組み合わせで分離される", () => {
  const store = new Store(":memory:");
  assert.equal(store.hasAutomationFired("g1", "meigen", "m1"), false);
  assert.equal(store.markAutomationFired("g1", "meigen", "m1"), true);
  assert.equal(store.hasAutomationFired("g1", "meigen", "m1"), true);
  assert.equal(store.markAutomationFired("g1", "meigen", "m1"), false);
  assert.equal(store.hasAutomationFired("g1", "meigen", "m2"), false);
  assert.equal(store.hasAutomationFired("g2", "meigen", "m1"), false);
  assert.equal(store.hasAutomationFired("g1", "other", "m1"), false);
  store.close();
});

test("最終実行時刻は保存と上書きができ、ギルドで分離される", () => {
  const store = new Store(":memory:");
  assert.equal(store.getAutomationLastRun("g1", "asa"), null);
  const first = new Date("2026-01-01T00:00:00Z");
  store.setAutomationLastRun("g1", "asa", first);
  assert.deepEqual(store.getAutomationLastRun("g1", "asa"), first);
  const second = new Date("2026-01-02T00:00:00Z");
  store.setAutomationLastRun("g1", "asa", second);
  assert.deepEqual(store.getAutomationLastRun("g1", "asa"), second);
  assert.equal(store.getAutomationLastRun("g2", "asa"), null);
  store.close();
});

test("Trigger 種別で Blueprint を絞り込める", () => {
  const store = new Store(":memory:");
  store.upsertBlueprint("g1", reactionBlueprint("meigen"));
  store.upsertBlueprint("g1", scheduleBlueprint("asa"));
  store.upsertBlueprint("g2", reactionBlueprint("other"));
  assert.deepEqual(
    store.listBlueprintsByTriggerType("g1", "reaction").map((b) => b.name),
    ["meigen"],
  );
  assert.deepEqual(
    store.listBlueprintsByTriggerType("g1", "schedule").map((b) => b.name),
    ["asa"],
  );
  assert.deepEqual(store.listBlueprintsByTriggerType("g1", "slash"), []);
  store.close();
});

test("全ギルドのスケジュール Blueprint をギルド・名前順に列挙できる", () => {
  const store = new Store(":memory:");
  store.upsertBlueprint("g1", scheduleBlueprint("asa"));
  store.upsertBlueprint("g2", scheduleBlueprint("yoru"));
  store.upsertBlueprint("g1", reactionBlueprint("meigen"));
  const listed = store.listScheduledBlueprints();
  assert.deepEqual(
    listed.map((entry) => `${entry.guildId}:${entry.blueprint.name}`),
    ["g1:asa", "g2:yoru"],
  );
  store.close();
});

test("deleteGuildData は自動化の状態も消す", () => {
  const store = new Store(":memory:");
  store.upsertBlueprint("g1", reactionBlueprint("meigen"));
  store.markAutomationFired("g1", "meigen", "m1");
  store.setAutomationLastRun("g1", "meigen", new Date());
  store.deleteGuildData("g1");
  assert.equal(store.hasAutomationFired("g1", "meigen", "m1"), false);
  assert.equal(store.getAutomationLastRun("g1", "meigen"), null);
  store.close();
});
