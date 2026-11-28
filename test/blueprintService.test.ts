import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBlueprint, type Blueprint } from "../src/blueprint.js";
import { createBlueprint, replaceBlueprint } from "../src/blueprintService.js";
import { Store } from "../src/store.js";

function blueprint(name: string): Blueprint {
  return validateBlueprint({
    name,
    trigger: { type: "slash", command: name },
    conditions: [{ type: "always" }],
    actions: [{ type: "reply", template: "x" }],
  });
}

test("Blueprint を作成でき、保存される", () => {
  const store = new Store(":memory:");
  const result = createBlueprint(store, "g1", blueprint("omikuji"));
  assert.deepEqual(result, { ok: true });
  assert.ok(store.getBlueprint("g1", "omikuji"));
  store.close();
});

test("同名の作成は duplicate として拒否される", () => {
  const store = new Store(":memory:");
  createBlueprint(store, "g1", blueprint("omikuji"));
  const result = createBlueprint(store, "g1", blueprint("omikuji"));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "duplicate");
    assert.match(result.message, /同名の Blueprint が存在します/);
  }
  store.close();
});

test("重複判定はギルドごとに行われる", () => {
  const store = new Store(":memory:");
  createBlueprint(store, "g1", blueprint("omikuji"));
  const result = createBlueprint(store, "g2", blueprint("omikuji"));
  assert.deepEqual(result, { ok: true });
  store.close();
});

test("上限に達したギルドでは limit として拒否される", () => {
  const store = new Store(":memory:");
  createBlueprint(store, "g1", blueprint("a"), 2);
  createBlueprint(store, "g1", blueprint("b"), 2);
  const result = createBlueprint(store, "g1", blueprint("c"), 2);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "limit");
    assert.equal(
      result.message,
      "作成できませんでした。Blueprintの上限（2件）に達しています",
    );
  }
  store.close();
});

test("置換は既存の定義を差し替える", () => {
  const store = new Store(":memory:");
  createBlueprint(store, "g1", blueprint("omikuji"));
  const updated = validateBlueprint({
    name: "omikuji",
    trigger: { type: "slash", command: "omikuji" },
    conditions: [{ type: "always" }],
    actions: [{ type: "reply", template: "y" }],
  });
  const result = replaceBlueprint(store, "g1", "omikuji", updated);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(store.getBlueprint("g1", "omikuji")?.actions, [
    { type: "reply", template: "y" },
  ]);
  store.close();
});

test("置換で改名すると旧名は消え、件数は変わらない", () => {
  const store = new Store(":memory:");
  createBlueprint(store, "g1", blueprint("omikuji"));
  const result = replaceBlueprint(store, "g1", "omikuji", blueprint("uranai"));
  assert.deepEqual(result, { ok: true });
  assert.equal(store.getBlueprint("g1", "omikuji"), null);
  assert.ok(store.getBlueprint("g1", "uranai"));
  assert.equal(store.getCounts("g1").blueprints, 1);
  store.close();
});

test("存在しない元の置換は not_found になる", () => {
  const store = new Store(":memory:");
  const result = replaceBlueprint(store, "g1", "missing", blueprint("x"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_found");
  store.close();
});

test("改名先に同名があれば duplicate として拒否され、元は残る", () => {
  const store = new Store(":memory:");
  createBlueprint(store, "g1", blueprint("a"));
  createBlueprint(store, "g1", blueprint("b"));
  const result = replaceBlueprint(store, "g1", "a", blueprint("b"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "duplicate");
  assert.ok(store.getBlueprint("g1", "a"));
  store.close();
});
