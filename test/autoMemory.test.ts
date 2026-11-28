import assert from "node:assert/strict";
import { test } from "node:test";
import { autoMemoryKey, buildAutoMemoryProposal } from "../src/autoMemory.js";
import { MAX_MEMORY_CONTENT_LENGTH } from "../src/memory.js";
import { Store } from "../src/store.js";

function messageInput(
  overrides: Partial<Parameters<typeof buildAutoMemoryProposal>[0]> = {},
) {
  return {
    messageId: "1234567890123456789",
    authorId: "u1",
    authorBot: false,
    content: "これは名言です",
    ...overrides,
  };
}

test("自動提案のキーはメッセージ ID から決定的に作られる", () => {
  assert.equal(
    autoMemoryKey("1234567890123456789"),
    "reaction-1234567890123456789",
  );
  // キーの上限 (32 文字) を超える ID では候補化しない
  assert.equal(autoMemoryKey("1".repeat(24)), null);
});

test("通常のメッセージからは名言候補が構築され、本文の空白は除かれる", () => {
  const proposal = buildAutoMemoryProposal(
    messageInput({ content: "  前後の空白は除かれる  " }),
  );
  assert.deepEqual(proposal, {
    key: "reaction-1234567890123456789",
    kind: "quote",
    content: "前後の空白は除かれる",
    createdBy: "u1",
  });
});

test("Bot のメッセージは候補化されない", () => {
  assert.equal(
    buildAutoMemoryProposal(messageInput({ authorBot: true })),
    null,
  );
});

test("本文が空（空白のみ含む）のメッセージは候補化されない", () => {
  assert.equal(buildAutoMemoryProposal(messageInput({ content: "" })), null);
  assert.equal(
    buildAutoMemoryProposal(messageInput({ content: "   \n  " })),
    null,
  );
});

test("上限を超える本文は候補化されず、上限ちょうどは候補化される", () => {
  const over = "あ".repeat(MAX_MEMORY_CONTENT_LENGTH + 1);
  assert.equal(buildAutoMemoryProposal(messageInput({ content: over })), null);
  const just = "あ".repeat(MAX_MEMORY_CONTENT_LENGTH);
  assert.notEqual(
    buildAutoMemoryProposal(messageInput({ content: just })),
    null,
  );
});

test("proposeMemoryIfAbsent は同じキーで二重に候補を作らない", () => {
  const store = new Store(":memory:");
  const input = {
    key: "reaction-1234567890123456789",
    kind: "quote",
    content: "一度だけ作られる",
    createdBy: "u1",
  };
  const first = store.proposeMemoryIfAbsent("g1", input);
  assert.notEqual(first, null);
  assert.equal(first?.status, "pending");
  const second = store.proposeMemoryIfAbsent("g1", {
    ...input,
    content: "別の内容で上書きされない",
  });
  assert.equal(second, null);
  assert.equal(store.countMemories("g1"), 1);
  assert.equal(store.getMemory("g1", input.key)?.content, "一度だけ作られる");
  store.close();
});

test("proposeMemoryIfAbsent は承認・却下済みを pending に戻さない", () => {
  const store = new Store(":memory:");
  const input = {
    key: "reaction-1234567890123456789",
    kind: "quote",
    content: "判定済みの本文",
    createdBy: "u1",
  };
  store.proposeMemoryIfAbsent("g1", input);
  assert.equal(store.approveMemory("g1", input.key, "admin"), true);
  assert.equal(store.proposeMemoryIfAbsent("g1", input), null);
  assert.equal(store.getMemory("g1", input.key)?.status, "approved");

  const rejected = { ...input, key: "reaction-9876543210987654321" };
  store.proposeMemoryIfAbsent("g1", rejected);
  assert.equal(store.rejectMemory("g1", rejected.key), true);
  assert.equal(store.proposeMemoryIfAbsent("g1", rejected), null);
  assert.equal(store.getMemory("g1", rejected.key)?.status, "rejected");
  store.close();
});

test("自動提案はギルドごとに分離される", () => {
  const store = new Store(":memory:");
  const input = {
    key: "reaction-1234567890123456789",
    kind: "quote",
    content: "ギルドごとの候補",
    createdBy: "u1",
  };
  assert.notEqual(store.proposeMemoryIfAbsent("g1", input), null);
  assert.notEqual(store.proposeMemoryIfAbsent("g2", input), null);
  assert.equal(store.countMemories("g1"), 1);
  assert.equal(store.countMemories("g2"), 1);
  store.close();
});

test("自動提案のフラグは既定で有効で、ギルド単位で切り替えられる", () => {
  const store = new Store(":memory:");
  assert.equal(store.isAutoMemoryEnabled("g1"), true);
  store.setAutoMemoryEnabled("g1", false);
  assert.equal(store.isAutoMemoryEnabled("g1"), false);
  assert.equal(store.isAutoMemoryEnabled("g2"), true);
  store.setAutoMemoryEnabled("g1", true);
  assert.equal(store.isAutoMemoryEnabled("g1"), true);
  store.close();
});

test("自動提案の設定は export に含まれ、delete で既定に戻る", () => {
  const store = new Store(":memory:");
  store.setAutoMemoryEnabled("g1", false);
  assert.equal(store.exportGuildData("g1").autoMemoryEnabled, false);
  assert.equal(store.exportGuildData("g2").autoMemoryEnabled, true);
  store.deleteGuildData("g1");
  assert.equal(store.isAutoMemoryEnabled("g1"), true);
  store.close();
});
