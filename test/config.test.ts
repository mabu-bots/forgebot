import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, loadConfig } from "../src/config.js";

const BASE_ENV = { DISCORD_TOKEN: "token", DISCORD_CLIENT_ID: "123" };

test("必須変数が両方欠けていれば、両方の名前を挙げて ConfigError になる", () => {
  assert.throws(
    () => loadConfig({}),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.message.includes("DISCORD_TOKEN") &&
      error.message.includes("DISCORD_CLIENT_ID"),
  );
});

test("必須変数が揃えば設定を返し、任意項目は既定値になる", () => {
  const config = loadConfig({ ...BASE_ENV });
  assert.equal(config.token, "token");
  assert.equal(config.clientId, "123");
  assert.equal(config.disabled, false);
  assert.equal(config.dbPath, "data/forge.sqlite");
  assert.equal(config.guildId, null);
});

test("FORGE_DISABLED は 1 / true / yes を真として解釈する", () => {
  assert.equal(
    loadConfig({ ...BASE_ENV, FORGE_DISABLED: "true" }).disabled,
    true,
  );
  assert.equal(loadConfig({ ...BASE_ENV, FORGE_DISABLED: "1" }).disabled, true);
  assert.equal(
    loadConfig({ ...BASE_ENV, FORGE_DISABLED: "0" }).disabled,
    false,
  );
});
