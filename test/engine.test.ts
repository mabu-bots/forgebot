import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBlueprint, type Blueprint } from "../src/blueprint.js";
import { CooldownTracker } from "../src/cooldown.js";
import {
  evaluateCondition,
  executeBlueprint,
  type EngineDeps,
} from "../src/engine.js";
import { Store } from "../src/store.js";

const CTX = {
  guildId: "g1",
  userId: "u1",
  userName: "taro",
  serverName: "テストサーバー",
};

function makeDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    store: new Store(":memory:"),
    cooldowns: new CooldownTracker(),
    globalDisabled: false,
    rng: () => 0,
    ...overrides,
  };
}

function blueprint(overrides: Record<string, unknown> = {}): Blueprint {
  return validateBlueprint({
    name: "omikuji",
    trigger: { type: "slash", command: "omikuji" },
    conditions: [{ type: "always" }],
    actions: [{ type: "reply", template: "{user}: {choice:大吉,凶}" }],
    ...overrides,
  });
}

test("reply アクションは描画結果を返し、実行数が増える", () => {
  const deps = makeDeps();
  const result = executeBlueprint(blueprint(), deps, CTX);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.outputs, ["taro: 大吉"]);
  assert.equal(deps.store.getCounts("g1").executions, 1);
  deps.store.close();
});

test("全局停止スイッチが有効なら blocked (global_disabled)", () => {
  const deps = makeDeps({ globalDisabled: true });
  const result = executeBlueprint(blueprint(), deps, CTX);
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "global_disabled");
  assert.deepEqual(result.outputs, []);
  deps.store.close();
});

test("ギルド無効化が有効なら blocked (guild_disabled) で実行数は増えない", () => {
  const deps = makeDeps();
  deps.store.setGuildDisabled("g1", true);
  const result = executeBlueprint(blueprint(), deps, CTX);
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "guild_disabled");
  assert.equal(deps.store.getCounts("g1").executions, 0);
  deps.store.close();
});

test("他ギルドの無効化は実行に影響しない", () => {
  const deps = makeDeps();
  deps.store.setGuildDisabled("g2", true);
  const result = executeBlueprint(blueprint(), deps, CTX);
  assert.equal(result.status, "ok");
  deps.store.close();
});

test("variableEquals 条件は変数が一致したときだけ通る", () => {
  const deps = makeDeps();
  const bp = blueprint({
    conditions: [{ type: "variableEquals", key: "mode", value: "on" }],
  });
  assert.equal(executeBlueprint(bp, deps, CTX).status, "skipped");
  deps.store.setVariable("g1", "user", "u1", "mode", "on");
  assert.equal(executeBlueprint(bp, deps, CTX).status, "ok");
  deps.store.close();
});

test("chance 条件は rng の値で成否が決まる", () => {
  const bp = blueprint({ conditions: [{ type: "chance", percent: 50 }] });
  const pass = makeDeps({ rng: () => 0.4 });
  assert.equal(evaluateCondition(bp.conditions[0]!, pass, CTX), true);
  const failDeps = makeDeps({ rng: () => 0.6 });
  assert.equal(evaluateCondition(bp.conditions[0]!, failDeps, CTX), false);
  pass.store.close();
  failDeps.store.close();
});

test("条件を満たさない実行はクールダウンを消費しない", () => {
  let now = 0;
  const deps = makeDeps({ cooldowns: new CooldownTracker(() => now) });
  const never = blueprint({
    conditions: [{ type: "chance", percent: 0 }],
    cooldownSeconds: 60,
  });
  assert.equal(executeBlueprint(never, deps, CTX).status, "skipped");
  const always = blueprint({ cooldownSeconds: 60 });
  assert.equal(executeBlueprint(always, deps, CTX).status, "ok");
  now += 1_000;
  deps.store.close();
});

test("カウンター加算は後続の reply の描画に反映される", () => {
  const deps = makeDeps();
  const bp = blueprint({
    actions: [
      { type: "incrementCounter", key: "visits", amount: 2 },
      { type: "reply", template: "訪問 {count:visits} 回" },
    ],
  });
  const result = executeBlueprint(bp, deps, CTX);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.outputs, ["訪問 2 回"]);
  assert.deepEqual(result.actions[0], {
    type: "incrementCounter",
    key: "visits",
    amount: 2,
    newValue: 2,
  });
  assert.equal(deps.store.getCounter("g1", "visits"), 2);
  deps.store.close();
});

test("setVariable アクションはユーザー変数を保存し {var:} で引ける", () => {
  const deps = makeDeps();
  const bp = blueprint({
    actions: [
      { type: "setVariable", key: "mood", value: "good" },
      { type: "reply", template: "{var:mood}" },
    ],
  });
  const result = executeBlueprint(bp, deps, CTX);
  assert.deepEqual(result.outputs, ["good"]);
  assert.equal(deps.store.getVariable("g1", "user", "u1", "mood"), "good");
  deps.store.close();
});

test("クールダウン中は2回目が blocked になり、経過後は実行できる", () => {
  let now = 0;
  const deps = makeDeps({ cooldowns: new CooldownTracker(() => now) });
  const bp = blueprint({ cooldownSeconds: 60 });
  assert.equal(executeBlueprint(bp, deps, CTX).status, "ok");
  const second = executeBlueprint(bp, deps, CTX);
  assert.equal(second.status, "blocked");
  assert.equal(second.reason, "cooldown");
  assert.equal(second.remainingMs, 60_000);
  now += 61_000;
  assert.equal(executeBlueprint(bp, deps, CTX).status, "ok");
  deps.store.close();
});

test("Presentation の prefix は出力の先頭に付く", () => {
  const deps = makeDeps();
  const bp = blueprint({ presentation: { prefix: "[結果] " } });
  const result = executeBlueprint(bp, deps, CTX);
  assert.deepEqual(result.outputs, ["[結果] taro: 大吉"]);
  deps.store.close();
});
