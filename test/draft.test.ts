import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDraftCustomId,
  DraftStore,
  isDraftOwner,
  parseDraftCustomId,
  type DraftData,
} from "../src/draft.js";

const DATA: DraftData = { kind: "delete", name: "omikuji" };

function makeStore(start = 0) {
  let now = start;
  let seq = 0;
  const store = new DraftStore(
    () => now,
    600_000,
    () => `draft-${(seq += 1)}`,
  );
  return {
    store,
    advance(ms: number) {
      now += ms;
    },
  };
}

test("ドラフトを保存して同じ内容で取得できる", () => {
  const { store } = makeStore();
  const session = store.put("g1", "u1", DATA);
  assert.equal(session.guildId, "g1");
  assert.equal(session.userId, "u1");
  assert.deepEqual(store.get(session.id), session);
});

test("所有者はギルドとユーザーの両方が一致したときだけ true", () => {
  const { store } = makeStore();
  const session = store.put("g1", "u1", DATA);
  assert.equal(isDraftOwner(session, "g1", "u1"), true);
  assert.equal(isDraftOwner(session, "g1", "u2"), false);
  assert.equal(isDraftOwner(session, "g2", "u1"), false);
});

test("他ユーザーのドラフトは所有者判定で分離される", () => {
  const { store } = makeStore();
  const alice = store.put("g1", "alice", DATA);
  const bob = store.put("g1", "bob", DATA);
  assert.notEqual(alice.id, bob.id);
  const fetched = store.get(alice.id);
  assert.ok(fetched);
  assert.equal(isDraftOwner(fetched, "g1", "bob"), false);
});

test("有効期限を過ぎたドラフトは取得できず、保持件数からも消える", () => {
  const { store, advance } = makeStore();
  const session = store.put("g1", "u1", DATA);
  advance(599_999);
  assert.ok(store.get(session.id));
  advance(2);
  assert.equal(store.get(session.id), null);
  assert.equal(store.size, 0);
});

test("take は1回だけ取り出せる", () => {
  const { store } = makeStore();
  const session = store.put("g1", "u1", DATA);
  assert.deepEqual(store.take(session.id), session);
  assert.equal(store.take(session.id), null);
});

test("prune は期限切れだけを削除して件数を返す", () => {
  const { store, advance } = makeStore();
  store.put("g1", "u1", DATA);
  advance(300_000);
  const fresh = store.put("g1", "u1", DATA);
  advance(300_001);
  assert.equal(store.prune(), 1);
  assert.deepEqual(store.get(fresh.id), fresh);
});

test("customId は構築と解釈が往復でき、不正な形式は null", () => {
  const customId = buildDraftCustomId("confirm", "draft-1");
  assert.equal(customId, "forge:draft:confirm:draft-1");
  assert.deepEqual(parseDraftCustomId(customId), {
    action: "confirm",
    id: "draft-1",
  });
  assert.equal(parseDraftCustomId("forge:other:confirm:draft-1"), null);
  assert.equal(parseDraftCustomId("forge:draft:unknown:draft-1"), null);
  assert.equal(parseDraftCustomId("forge:draft:confirm:"), null);
});
