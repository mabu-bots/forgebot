import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBlueprint } from "../src/blueprint.js";
import {
  buildReactionBlueprint,
  buildScheduleBlueprint,
  extractAutomationForm,
  getAutomationChannelId,
  remapAutomationChannel,
} from "../src/automationForm.js";

test("リアクションフォームから Blueprint を構築する（名前は小文字化）", () => {
  const result = buildReactionBlueprint({
    name: "Meigen",
    emoji: "⭐",
    threshold: "5",
    channelId: "111",
    template: "{messageUrl} が {reactionCount} 件",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, "meigen");
  assert.deepEqual(result.value.trigger, {
    type: "reaction",
    emoji: "⭐",
    threshold: 5,
    channelId: "111",
    template: "{messageUrl} が {reactionCount} 件",
  });
  assert.deepEqual(result.value.actions, [
    {
      type: "sendToChannel",
      channelId: "111",
      template: "{messageUrl} が {reactionCount} 件",
    },
  ]);
});

test("絵文字が空欄なら Trigger に絵文字を持たない", () => {
  const result = buildReactionBlueprint({
    name: "any",
    emoji: "  ",
    threshold: "3",
    channelId: "111",
    template: "送信",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  if (result.value.trigger.type === "reaction") {
    assert.equal(result.value.trigger.emoji, undefined);
  }
});

test("閾値が不正（0・負数・非数・小数・空）なら拒否する", () => {
  for (const threshold of ["0", "-1", "abc", "1.5", ""]) {
    const result = buildReactionBlueprint({
      name: "x",
      emoji: "",
      threshold,
      channelId: "111",
      template: "送信",
    });
    assert.equal(result.ok, false, `threshold=${threshold}`);
  }
});

test("スケジュールフォームは日次と間隔の両形式を構築できる", () => {
  const daily = buildScheduleBlueprint({
    name: "asa",
    dailyTime: "09:00",
    intervalMinutes: "",
    channelId: "222",
    template: "朝の送信",
  });
  assert.equal(daily.ok, true);
  if (daily.ok && daily.value.trigger.type === "schedule") {
    assert.equal(daily.value.trigger.dailyTime, "09:00");
    assert.equal(daily.value.trigger.intervalMinutes, undefined);
    assert.equal(daily.value.trigger.timezone, "Asia/Tokyo");
  }
  const interval = buildScheduleBlueprint({
    name: "teiki",
    dailyTime: "",
    intervalMinutes: "60",
    channelId: "222",
    template: "定期送信",
  });
  assert.equal(interval.ok, true);
  if (interval.ok && interval.value.trigger.type === "schedule") {
    assert.equal(interval.value.trigger.intervalMinutes, 60);
    assert.equal(interval.value.trigger.dailyTime, undefined);
  }
});

test("スケジュールフォームは時刻と間隔の併用・両方なし・不正な時刻を拒否する", () => {
  const both = buildScheduleBlueprint({
    name: "x",
    dailyTime: "09:00",
    intervalMinutes: "60",
    channelId: "222",
    template: "送信",
  });
  assert.equal(both.ok, false);
  const neither = buildScheduleBlueprint({
    name: "x",
    dailyTime: "",
    intervalMinutes: "",
    channelId: "222",
    template: "送信",
  });
  assert.equal(neither.ok, false);
  const badTime = buildScheduleBlueprint({
    name: "x",
    dailyTime: "25:00",
    intervalMinutes: "",
    channelId: "222",
    template: "送信",
  });
  assert.equal(badTime.ok, false);
});

test("チャンネル付け替えは Trigger とアクションの両方を差し替え、元は変えない", () => {
  const built = buildReactionBlueprint({
    name: "meigen",
    emoji: "",
    threshold: "5",
    channelId: "111",
    template: "送信",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const remapped = remapAutomationChannel(built.value, "999");
  assert.equal(getAutomationChannelId(remapped), "999");
  assert.deepEqual(remapped.actions, [
    { type: "sendToChannel", channelId: "999", template: "送信" },
  ]);
  assert.equal(getAutomationChannelId(built.value), "111");
});

test("slash の Blueprint に送信先チャンネルは無い", () => {
  const blueprint = validateBlueprint({
    name: "omikuji",
    trigger: { type: "slash", command: "omikuji" },
    conditions: [{ type: "always" }],
    actions: [{ type: "reply", template: "ok" }],
  });
  assert.equal(getAutomationChannelId(blueprint), null);
});

test("自動化フォームへの復元はラウンドトリップできる", () => {
  const reaction = buildReactionBlueprint({
    name: "meigen",
    emoji: "⭐",
    threshold: "5",
    channelId: "111",
    template: "送信",
  });
  assert.equal(reaction.ok, true);
  if (!reaction.ok) return;
  const restored = extractAutomationForm(reaction.value);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.value.kind, "reaction");
  if (restored.value.kind === "reaction") {
    assert.equal(restored.value.input.threshold, "5");
    assert.equal(restored.value.input.emoji, "⭐");
    assert.equal(restored.value.input.channelId, "111");
  }
  const schedule = buildScheduleBlueprint({
    name: "asa",
    dailyTime: "09:00",
    intervalMinutes: "",
    channelId: "222",
    template: "朝の送信",
  });
  assert.equal(schedule.ok, true);
  if (!schedule.ok) return;
  const restoredSchedule = extractAutomationForm(schedule.value);
  assert.equal(restoredSchedule.ok, true);
  if (restoredSchedule.ok && restoredSchedule.value.kind === "schedule") {
    assert.equal(restoredSchedule.value.input.dailyTime, "09:00");
    assert.equal(restoredSchedule.value.input.intervalMinutes, "");
  }
});

test("slash の Blueprint は自動化フォームへ復元できない", () => {
  const blueprint = validateBlueprint({
    name: "omikuji",
    trigger: { type: "slash", command: "omikuji" },
    conditions: [{ type: "always" }],
    actions: [{ type: "reply", template: "ok" }],
  });
  assert.equal(extractAutomationForm(blueprint).ok, false);
});
