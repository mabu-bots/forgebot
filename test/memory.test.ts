import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBlueprint } from "../src/blueprint.js";
import { CooldownTracker } from "../src/cooldown.js";
import { executeBlueprint } from "../src/engine.js";
import { validateMemoryProposal } from "../src/memory.js";
import { renderTemplate } from "../src/render.js";
import { Store } from "../src/store.js";

function propose(store: Store, guildId: string, key = "meigen") {
  return store.proposeMemory(guildId, {
    key,
    kind: "quote",
    content: "名言の内容",
    createdBy: "u1",
  });
}

test("候補は pending で登録され、承認するまで参照できない", () => {
  const store = new Store(":memory:");
  const record = propose(store, "g1");
  assert.equal(record.status, "pending");
  assert.equal(record.createdBy, "u1");
  assert.equal(store.getApprovedMemory("g1", "meigen"), null);
  assert.equal(store.approveMemory("g1", "meigen", "admin1"), true);
  assert.equal(store.getApprovedMemory("g1", "meigen"), "名言の内容");
  assert.equal(store.getMemory("g1", "meigen")?.approvedBy, "admin1");
  store.close();
});

test("却下した候補は参照できない", () => {
  const store = new Store(":memory:");
  propose(store, "g1");
  assert.equal(store.rejectMemory("g1", "meigen"), true);
  assert.equal(store.getMemory("g1", "meigen")?.status, "rejected");
  assert.equal(store.getApprovedMemory("g1", "meigen"), null);
  store.close();
});

test("記憶はギルドごとに分離される", () => {
  const store = new Store(":memory:");
  propose(store, "g1");
  store.approveMemory("g1", "meigen", "a");
  assert.equal(store.getMemory("g2", "meigen"), null);
  assert.equal(store.getApprovedMemory("g2", "meigen"), null);
  assert.equal(store.listMemories("g2").length, 0);
  assert.equal(store.approveMemory("g2", "meigen", "a"), false);
  assert.equal(store.deleteMemory("g2", "meigen"), false);
  assert.equal(store.getApprovedMemory("g1", "meigen"), "名言の内容");
  store.close();
});

test("削除した記憶は参照できない", () => {
  const store = new Store(":memory:");
  propose(store, "g1");
  store.approveMemory("g1", "meigen", "a");
  assert.equal(store.deleteMemory("g1", "meigen"), true);
  assert.equal(store.getMemory("g1", "meigen"), null);
  store.close();
});

test("状態で絞り込んで一覧と件数が取れる", () => {
  const store = new Store(":memory:");
  propose(store, "g1", "a");
  propose(store, "g1", "b");
  store.approveMemory("g1", "a", "admin");
  assert.equal(store.listMemories("g1").length, 2);
  assert.equal(store.listMemories("g1", "approved").length, 1);
  assert.equal(store.listMemories("g1", "pending").length, 1);
  assert.equal(store.countMemories("g1", "approved"), 1);
  store.close();
});

test("同じキーを再登録すると pending に戻る", () => {
  const store = new Store(":memory:");
  propose(store, "g1");
  store.approveMemory("g1", "meigen", "a");
  propose(store, "g1");
  assert.equal(store.getMemory("g1", "meigen")?.status, "pending");
  assert.equal(store.getApprovedMemory("g1", "meigen"), null);
  store.close();
});

test("記憶入力の検証はキー・内容の不正を弾く", () => {
  assert.equal(
    validateMemoryProposal({ key: "ok_key", kind: "quote", content: "x" }).ok,
    true,
  );
  assert.equal(
    validateMemoryProposal({ key: "bad key", kind: "quote", content: "x" }).ok,
    false,
  );
  assert.equal(
    validateMemoryProposal({ key: "ok", kind: "quote", content: " " }).ok,
    false,
  );
  assert.equal(
    validateMemoryProposal({ key: "", kind: "quote", content: "x" }).ok,
    false,
  );
});

test("{memory:キー} は承認済みの記憶だけを描画する", () => {
  const store = new Store(":memory:");
  propose(store, "g1");
  const ctx = {
    user: "taro",
    server: "s",
    getCounter: () => 0,
    getMemory: (key: string) => store.getApprovedMemory("g1", key),
  };
  assert.equal(renderTemplate("[{memory:meigen}]", ctx), "[]");
  store.approveMemory("g1", "meigen", "a");
  assert.equal(renderTemplate("[{memory:meigen}]", ctx), "[名言の内容]");
  store.close();
});

test("Blueprint 実行でも {memory:キー} が使える", () => {
  const store = new Store(":memory:");
  propose(store, "g1");
  store.approveMemory("g1", "meigen", "a");
  const bp = validateBlueprint({
    name: "recall",
    trigger: { type: "slash", command: "recall" },
    conditions: [{ type: "always" }],
    actions: [{ type: "reply", template: "記憶: {memory:meigen}" }],
  });
  const result = executeBlueprint(
    bp,
    { store, cooldowns: new CooldownTracker(), globalDisabled: false },
    { guildId: "g1", userId: "u1", userName: "taro", serverName: "s" },
  );
  assert.deepEqual(result.outputs, ["記憶: 名言の内容"]);
  store.close();
});

test("記憶は export に含まれ、delete で消える", () => {
  const store = new Store(":memory:");
  propose(store, "g1");
  propose(store, "g2", "other");
  const exported = store.exportGuildData("g1");
  assert.equal(exported.memories.length, 1);
  assert.equal(exported.memories[0]?.key, "meigen");
  store.deleteGuildData("g1");
  assert.equal(store.listMemories("g1").length, 0);
  assert.equal(store.listMemories("g2").length, 1);
  store.close();
});
