// ==========================================
// 🚀 起動エントリポイント
// ==========================================
// 設定読み込み → ストア開設 → クライアント生成 → ウォッチドッグ →
// プラグイン読み込み → ハンドラ登録 → ログイン、の順で起動する。
// 終了シグナルではスケジューラ停止・切断・ストアを閉じて終わる。

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachHandlers, createClient } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { CooldownTracker } from "./cooldown.js";
import { DraftStore } from "./draft.js";
import { createDefaultRegistry, loadPluginsFromDir } from "./plugins.js";
import { Store } from "./store.js";
import { attachReadyWatchdog } from "./watchdog.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  if (config.dbPath !== ":memory:") {
    mkdirSync(dirname(config.dbPath), { recursive: true });
  }
  const store = new Store(config.dbPath);
  const client = createClient();
  // 🐶 READY が来ない停滞を検知してプロセスを落とす（pm2 が再起動する）
  attachReadyWatchdog(client);
  // 🔌 既定プラグイン（dice）に、plugins ディレクトリの分を足す。
  // 配置の候補は dist/src から見た2通りを順に試す。
  const registry = createDefaultRegistry();
  const here = dirname(fileURLToPath(import.meta.url));
  for (const pluginsDir of [
    join(here, "..", "plugins"),
    join(here, "..", "..", "plugins"),
  ]) {
    const { result } = await loadPluginsFromDir(pluginsDir, registry);
    for (const name of result.loaded) {
      console.log(`Plugin loaded: ${name}`);
    }
    for (const error of result.errors) {
      console.warn(`Plugin load failed: ${error.name}: ${error.message}`);
    }
    if (result.loaded.length > 0) break;
  }
  const handlers = attachHandlers(client, {
    store,
    cooldowns: new CooldownTracker(),
    drafts: new DraftStore(),
    globalDisabled: config.disabled,
    plugins: registry,
  });

  // 🧹 終了処理（二重実行防止つき）
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Shutdown: ${signal}`);
    handlers.stop();
    client.destroy();
    store.close();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  await client.login(config.token);
}

await main();
