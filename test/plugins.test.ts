import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateBlueprint } from "../src/blueprint.js";
import { CooldownTracker } from "../src/cooldown.js";
import { executeBlueprint, type EngineDeps } from "../src/engine.js";
import {
  createDefaultRegistry,
  loadPluginsFromDir,
  PluginRegistry,
  validateManifest,
  type Plugin,
  type PluginContext,
} from "../src/plugins.js";
import { Store } from "../src/store.js";

const CTX = {
  guildId: "g1",
  userId: "u1",
  userName: "taro",
  serverName: "テストサーバー",
};

function deps(store: Store, registry: PluginRegistry): EngineDeps {
  return {
    store,
    cooldowns: new CooldownTracker(),
    globalDisabled: false,
    rng: () => 0,
    plugins: registry,
  };
}

test("manifest の検証は名前を必須とし、形式を制限する", () => {
  assert.equal(validateManifest({ name: "dice" }).name, "dice");
  assert.throws(() => validateManifest({}));
  assert.throws(() => validateManifest({ name: "Bad Name" }));
});

test("dice プラグインの条件とアクションがエンジン経由で動く", () => {
  const store = new Store(":memory:");
  const registry = createDefaultRegistry();
  store.setPluginEnabled("g1", "dice", true);
  const bp = validateBlueprint({
    name: "roll",
    trigger: { type: "slash", command: "roll" },
    conditions: [
      {
        type: "plugin",
        plugin: "dice",
        block: "diceAtLeast",
        params: { sides: 6, threshold: 1 },
      },
    ],
    actions: [
      {
        type: "plugin",
        plugin: "dice",
        block: "rollDice",
        params: { sides: 6, template: "{user} rolled {roll}" },
      },
    ],
  });
  const result = executeBlueprint(bp, deps(store, registry), CTX);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.outputs, ["taro rolled 1"]);
  store.close();
});

test("プラグインが無効なギルドではブロックは動かない", () => {
  const store = new Store(":memory:");
  const registry = createDefaultRegistry();
  const bp = validateBlueprint({
    name: "roll",
    trigger: { type: "slash", command: "roll" },
    conditions: [{ type: "always" }],
    actions: [
      {
        type: "plugin",
        plugin: "dice",
        block: "rollDice",
        params: { sides: 6 },
      },
    ],
  });
  const result = executeBlueprint(bp, deps(store, registry), CTX);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.outputs, []);
  // 他ギルドでの有効化は影響しない
  store.setPluginEnabled("g2", "dice", true);
  assert.equal(store.isPluginEnabled("g1", "dice"), false);
  assert.deepEqual(
    executeBlueprint(bp, deps(store, registry), CTX).outputs,
    [],
  );
  store.close();
});

test("プラグインの例外はブロック単位で隔離される", () => {
  const store = new Store(":memory:");
  const registry = new PluginRegistry();
  const broken: Plugin = {
    manifest: {
      name: "broken",
      version: "1.0.0",
      description: "",
      provides: { conditions: ["boom"], actions: ["boom"] },
      permissions: [],
    },
    conditions: {
      boom: () => {
        throw new Error("boom");
      },
    },
    actions: {
      boom: () => {
        throw new Error("boom");
      },
    },
  };
  registry.register(broken);
  store.setPluginEnabled("g1", "broken", true);
  const bp = validateBlueprint({
    name: "safe",
    trigger: { type: "slash", command: "safe" },
    conditions: [{ type: "always" }],
    actions: [
      { type: "plugin", plugin: "broken", block: "boom", params: {} },
      { type: "reply", template: "生存" },
    ],
  });
  const result = executeBlueprint(bp, deps(store, registry), CTX);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.outputs, ["生存"]);
  const condBp = validateBlueprint({
    name: "safe2",
    trigger: { type: "slash", command: "safe2" },
    conditions: [
      { type: "plugin", plugin: "broken", block: "boom", params: {} },
    ],
    actions: [{ type: "reply", template: "x" }],
  });
  assert.equal(
    executeBlueprint(condBp, deps(store, registry), CTX).status,
    "skipped",
  );
  store.close();
});

test("未登録プラグインのブロックは安全に無視される", () => {
  const store = new Store(":memory:");
  const registry = createDefaultRegistry();
  store.setPluginEnabled("g1", "ghost", true);
  const bp = validateBlueprint({
    name: "ghost",
    trigger: { type: "slash", command: "ghost" },
    conditions: [{ type: "always" }],
    actions: [
      { type: "plugin", plugin: "ghost", block: "x", params: {} },
      { type: "reply", template: "ok" },
    ],
  });
  assert.deepEqual(executeBlueprint(bp, deps(store, registry), CTX).outputs, [
    "ok",
  ]);
  store.close();
});

test("プラグイン有効化は export/delete に含まれる", () => {
  const store = new Store(":memory:");
  store.setPluginEnabled("g1", "dice", true);
  store.setPluginEnabled("g2", "dice", false);
  assert.deepEqual(store.exportGuildData("g1").pluginInstalls, [
    { pluginName: "dice", enabled: true },
  ]);
  store.deleteGuildData("g1");
  assert.equal(store.isPluginEnabled("g1", "dice"), false);
  assert.equal(store.listPluginInstalls("g2").length, 1);
  store.close();
});

test("ディレクトリから読み込み、不正なプラグインは隔離される", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-plugins-"));
  mkdirSync(join(root, "good"));
  writeFileSync(
    join(root, "good", "manifest.json"),
    JSON.stringify({
      name: "good",
      version: "1.0.0",
      description: "good plugin",
      provides: { conditions: [], actions: ["ping"] },
      permissions: [],
    }),
  );
  writeFileSync(
    join(root, "good", "index.mjs"),
    "export default { conditions: {}, actions: { ping: () => 'pong' } };",
  );
  mkdirSync(join(root, "bad"));
  writeFileSync(join(root, "bad", "manifest.json"), "{invalid json");
  mkdirSync(join(root, "nomanifest"));
  const { registry, result } = await loadPluginsFromDir(root);
  assert.deepEqual(result.loaded, ["good"]);
  assert.equal(result.errors.length, 2);
  assert.equal(registry.get("good")?.manifest.name, "good");
  const ctx: PluginContext = {
    guildId: "g1",
    userId: "u1",
    userName: "taro",
    serverName: "s",
    params: {},
    rng: () => 0,
    getCounter: () => 0,
    getVariable: () => null,
    getMemory: () => null,
    renderText: (t: string) => t,
  };
  assert.equal(registry.executeAction("good", "ping", ctx), "pong");
});

test("同梱の dice ディレクトリを読み込める", async () => {
  const { registry, result } = await loadPluginsFromDir(
    new URL("../plugins", import.meta.url).pathname,
  );
  assert.ok(result.loaded.includes("dice"));
  assert.ok(registry.hasCondition("dice", "diceAtLeast"));
  assert.ok(registry.hasAction("dice", "rollDice"));
});
