// ==========================================
// 🔌 プラグイン基盤（レジストリと読み込み）
// ==========================================
// プラグインは新しい Condition / Action ブロックの提供者。
// plugins/ 配下の各ディレクトリが1プラグインで、manifest.json が
// 必須、index.mjs があればハンドラを取り込む。
// プラグインの例外はブロック単位で隔離する: 条件の例外は false、
// アクションの例外は null として扱い、本体は落とさない。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  provides: { conditions: string[]; actions: string[] };
  permissions: string[];
}

export interface PluginContext {
  guildId: string;
  userId: string;
  userName: string;
  serverName: string;
  params: Record<string, unknown>;
  rng: () => number;
  getCounter: (key: string) => number;
  getVariable: (key: string) => string | null;
  getMemory: (key: string) => string | null;
  renderText: (template: string) => string;
}

export type PluginConditionHandler = (ctx: PluginContext) => boolean;
export type PluginActionHandler = (ctx: PluginContext) => string | null;

export interface Plugin {
  manifest: PluginManifest;
  conditions: Record<string, PluginConditionHandler>;
  actions: Record<string, PluginActionHandler>;
}

// ❌ manifest の形式が不正な場合のエラー
export class PluginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 🔍 manifest の文字列配列項目を取り出す（未指定は空配列）
function readStringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new PluginValidationError(
      `manifest "${field}" must be a string array`,
    );
  }
  return value as string[];
}

// 🔍 manifest を検証して正規化する
export function validateManifest(raw: unknown): PluginManifest {
  if (!isRecord(raw)) {
    throw new PluginValidationError("manifest must be an object");
  }
  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    throw new PluginValidationError("manifest requires a non-empty name");
  }
  if (!/^[a-z0-9_-]+$/.test(raw.name)) {
    throw new PluginValidationError(
      "manifest name must be lowercase letters, digits, hyphen or underscore",
    );
  }
  const provides = isRecord(raw.provides) ? raw.provides : {};
  return {
    name: raw.name,
    version: typeof raw.version === "string" ? raw.version : "0.0.0",
    description: typeof raw.description === "string" ? raw.description : "",
    provides: {
      conditions: readStringList(provides.conditions, "provides.conditions"),
      actions: readStringList(provides.actions, "provides.actions"),
    },
    permissions: readStringList(raw.permissions, "permissions"),
  };
}

// ==========================================
// 🗂️ レジストリ
// ==========================================

export class PluginRegistry {
  private readonly byName = new Map<string, Plugin>();

  // 🔌 プラグインを登録する（manifest は登録時に検証する）
  register(plugin: Plugin): void {
    const manifest = validateManifest(plugin.manifest);
    this.byName.set(manifest.name, { ...plugin, manifest });
  }

  // 🔍 名前でプラグインを取得する
  get(name: string): Plugin | null {
    return this.byName.get(name) ?? null;
  }

  // 📋 登録済みプラグインを名前順で返す
  list(): Plugin[] {
    return [...this.byName.values()].sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name),
    );
  }

  // 🔍 条件ブロックを持っているか
  hasCondition(pluginName: string, block: string): boolean {
    const plugin = this.byName.get(pluginName);
    return plugin !== undefined && block in plugin.conditions;
  }

  // 🔍 アクションブロックを持っているか
  hasAction(pluginName: string, block: string): boolean {
    const plugin = this.byName.get(pluginName);
    return plugin !== undefined && block in plugin.actions;
  }

  // 🔍 条件ブロックを実行する（未登録・例外は false）
  evaluateCondition(
    pluginName: string,
    block: string,
    ctx: PluginContext,
  ): boolean {
    try {
      const handler = this.byName.get(pluginName)?.conditions[block];
      if (handler === undefined) return false;
      return handler(ctx) === true;
    } catch {
      return false;
    }
  }

  // ▶️ アクションブロックを実行する（未登録・例外・非文字列は null）
  executeAction(
    pluginName: string,
    block: string,
    ctx: PluginContext,
  ): string | null {
    try {
      const handler = this.byName.get(pluginName)?.actions[block];
      if (handler === undefined) return null;
      const result = handler(ctx);
      return typeof result === "string" ? result : null;
    } catch {
      return null;
    }
  }
}

// ==========================================
// 🎲 同梱サンプル: dice プラグイン
// ==========================================

// 🎲 dice: 条件 diceAtLeast（出目が閾値以上）と
// アクション rollDice（出目をテンプレートへ差し込む）を提供する
export function createDicePlugin(): Plugin {
  return {
    manifest: {
      name: "dice",
      version: "1.0.0",
      description: "サイコロの条件とアクションを提供する",
      provides: { conditions: ["diceAtLeast"], actions: ["rollDice"] },
      permissions: [],
    },
    conditions: {
      diceAtLeast: (ctx) => {
        const sides = Number(ctx.params.sides ?? 6);
        const threshold = Number(ctx.params.threshold ?? 4);
        if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
          return false;
        }
        if (!Number.isInteger(threshold)) return false;
        const roll = 1 + Math.floor(ctx.rng() * sides);
        return roll >= threshold;
      },
    },
    actions: {
      rollDice: (ctx) => {
        const sides = Number(ctx.params.sides ?? 6);
        if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
          return null;
        }
        const roll = 1 + Math.floor(ctx.rng() * sides);
        const template =
          typeof ctx.params.template === "string"
            ? ctx.params.template
            : "{user} rolled {roll}";
        return template
          .replaceAll("{roll}", String(roll))
          .replaceAll("{sides}", String(sides));
      },
    },
  };
}

// 🔌 dice 入りの既定レジストリを作る
export function createDefaultRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register(createDicePlugin());
  return registry;
}

// ==========================================
// 📥 ディレクトリからの読み込み
// ==========================================

export interface PluginLoadResult {
  loaded: string[];
  errors: Array<{ name: string; message: string }>;
}

// 📥 plugins ディレクトリ配下の各サブディレクトリを読み込む。
// 1件の失敗は errors に記録するだけで、他には影響しない。
// index.mjs が無い dice は同梱実装で補う（サンプルを単体でも動かすため）。
export async function loadPluginsFromDir(
  dir: string,
  registry: PluginRegistry = new PluginRegistry(),
): Promise<{ registry: PluginRegistry; result: PluginLoadResult }> {
  const result: PluginLoadResult = { loaded: [], errors: [] };
  if (!existsSync(dir)) return { registry, result };
  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    result.errors.push({ name: dir, message: String(error) });
    return { registry, result };
  }
  for (const entry of entries) {
    const pluginDir = join(dir, entry);
    try {
      const manifestPath = join(pluginDir, "manifest.json");
      if (!existsSync(manifestPath)) {
        result.errors.push({
          name: entry,
          message: "manifest.json がありません",
        });
        continue;
      }
      const manifest = validateManifest(
        JSON.parse(readFileSync(manifestPath, "utf-8")),
      );
      let conditions: Record<string, PluginConditionHandler> = {};
      let actions: Record<string, PluginActionHandler> = {};
      const indexPath = join(pluginDir, "index.mjs");
      if (existsSync(indexPath)) {
        const mod = (await import(pathToFileURL(indexPath).href)) as {
          default?: {
            conditions?: Record<string, PluginConditionHandler>;
            actions?: Record<string, PluginActionHandler>;
          };
          conditions?: Record<string, PluginConditionHandler>;
          actions?: Record<string, PluginActionHandler>;
        };
        conditions = mod.default?.conditions ?? mod.conditions ?? {};
        actions = mod.default?.actions ?? mod.actions ?? {};
      } else if (manifest.name === "dice") {
        const dice = createDicePlugin();
        conditions = dice.conditions;
        actions = dice.actions;
      }
      registry.register({ manifest, conditions, actions });
      result.loaded.push(manifest.name);
    } catch (error) {
      result.errors.push({
        name: entry,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { registry, result };
}
