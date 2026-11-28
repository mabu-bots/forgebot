// ==========================================
// ▶️ Blueprint 実行エンジン
// ==========================================
// 実行の流れ: 全局停止 → ギルド無効化 → クールダウン → 条件 →
// アクション。条件を満たさない場合はクールダウンを消費しない。
// 実行結果は「意図したアクション（IntendedAction）」として返し、
// 実際の Discord 送信は呼び出し側（client 層）が担う。

import type { Action, Blueprint, Condition } from "./blueprint.js";
import { CooldownTracker, cooldownKey } from "./cooldown.js";
import type { PluginContext, PluginRegistry } from "./plugins.js";
import { renderTemplate } from "./render.js";
import type { Store } from "./store.js";

// 📤 エンジンが返す「実行意図」。reply / sendToChannel は描画済み文字列を持つ
export type IntendedAction =
  | { type: "reply"; text: string }
  | { type: "sendToChannel"; channelId: string; text: string }
  | { type: "incrementCounter"; key: string; amount: number; newValue: number }
  | { type: "setVariable"; key: string; value: string };

export type EngineStatus = "ok" | "blocked" | "skipped";

export interface EngineResult {
  status: EngineStatus;
  reason?: string;
  remainingMs?: number;
  outputs: string[];
  actions: IntendedAction[];
}

export interface EngineContext {
  guildId: string;
  userId: string;
  userName: string;
  serverName: string;
  messageUrl?: string;
  reactionCount?: number;
}

export interface EngineDeps {
  store: Store;
  cooldowns: CooldownTracker;
  globalDisabled: boolean;
  rng?: () => number;
  plugins?: PluginRegistry;
}

// ==========================================
// 🔌 プラグインへ渡す文脈の構築
// ==========================================

// 🔤 変数の参照はユーザー単位を優先し、無ければギルド単位に倒す
function lookupVariable(deps: EngineDeps, ctx: EngineContext) {
  return (key: string): string | null =>
    deps.store.getVariable(ctx.guildId, "user", ctx.userId, key) ??
    deps.store.getVariable(ctx.guildId, "guild", "", key);
}

// 🔌 プラグインハンドラへ渡す文脈を作る
function pluginContext(
  deps: EngineDeps,
  ctx: EngineContext,
  params: Record<string, unknown>,
): PluginContext {
  return {
    guildId: ctx.guildId,
    userId: ctx.userId,
    userName: ctx.userName,
    serverName: ctx.serverName,
    params,
    rng: deps.rng ?? Math.random,
    getCounter: (key) => deps.store.getCounter(ctx.guildId, key),
    getVariable: lookupVariable(deps, ctx),
    getMemory: (key) => deps.store.getApprovedMemory(ctx.guildId, key),
    renderText: (template) => renderForContext(template, deps, ctx),
  };
}

// 🖨️ この実行文脈でテンプレートを描画する
function renderForContext(
  template: string,
  deps: EngineDeps,
  ctx: EngineContext,
): string {
  return renderTemplate(template, {
    user: ctx.userName,
    server: ctx.serverName,
    messageUrl: ctx.messageUrl,
    reactionCount: ctx.reactionCount,
    getCounter: (key) => deps.store.getCounter(ctx.guildId, key),
    getVariable: lookupVariable(deps, ctx),
    getMemory: (key) => deps.store.getApprovedMemory(ctx.guildId, key),
    rng: deps.rng,
  });
}

// ==========================================
// 🔍 条件の評価
// ==========================================

export function evaluateCondition(
  condition: Condition,
  deps: EngineDeps,
  ctx: EngineContext,
): boolean {
  switch (condition.type) {
    case "always":
      return true;
    case "chance": {
      const rng = deps.rng ?? Math.random;
      return rng() * 100 < condition.percent;
    }
    case "plugin": {
      if (deps.plugins === undefined) return false;
      if (!deps.store.isPluginEnabled(ctx.guildId, condition.plugin)) {
        return false;
      }
      return deps.plugins.evaluateCondition(
        condition.plugin,
        condition.block,
        pluginContext(deps, ctx, condition.params),
      );
    }
    case "variableEquals": {
      const userValue = deps.store.getVariable(
        ctx.guildId,
        "user",
        ctx.userId,
        condition.key,
      );
      const guildValue = deps.store.getVariable(
        ctx.guildId,
        "guild",
        "",
        condition.key,
      );
      return (userValue ?? guildValue) === condition.value;
    }
  }
}

// ==========================================
// ▶️ アクションの実行
// ==========================================

function runAction(
  action: Action,
  blueprint: Blueprint,
  deps: EngineDeps,
  ctx: EngineContext,
  outputs: string[],
  intended: IntendedAction[],
): void {
  const prefix = blueprint.presentation?.prefix ?? "";
  switch (action.type) {
    case "reply": {
      const text = prefix + renderForContext(action.template, deps, ctx);
      outputs.push(text);
      intended.push({ type: "reply", text });
      return;
    }
    case "sendToChannel": {
      const text = prefix + renderForContext(action.template, deps, ctx);
      intended.push({
        type: "sendToChannel",
        channelId: action.channelId,
        text,
      });
      return;
    }
    case "incrementCounter": {
      const amount = action.amount ?? 1;
      const newValue = deps.store.incrementCounter(
        ctx.guildId,
        action.key,
        amount,
      );
      intended.push({
        type: "incrementCounter",
        key: action.key,
        amount,
        newValue,
      });
      return;
    }
    case "setVariable": {
      deps.store.setVariable(
        ctx.guildId,
        "user",
        ctx.userId,
        action.key,
        action.value,
      );
      intended.push({
        type: "setVariable",
        key: action.key,
        value: action.value,
      });
      return;
    }
    case "plugin": {
      if (deps.plugins === undefined) return;
      if (!deps.store.isPluginEnabled(ctx.guildId, action.plugin)) return;
      // 🔤 文字列パラメータはテンプレートとして描画してから渡す
      const renderedParams: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(action.params)) {
        renderedParams[key] =
          typeof value === "string"
            ? renderForContext(value, deps, ctx)
            : value;
      }
      const output = deps.plugins.executeAction(
        action.plugin,
        action.block,
        pluginContext(deps, ctx, renderedParams),
      );
      if (output !== null) {
        const text = prefix + output;
        outputs.push(text);
        intended.push({ type: "reply", text });
      }
      return;
    }
  }
}

// ==========================================
// ▶️ Blueprint の実行
// ==========================================

export function executeBlueprint(
  blueprint: Blueprint,
  deps: EngineDeps,
  ctx: EngineContext,
): EngineResult {
  if (deps.globalDisabled) {
    return {
      status: "blocked",
      reason: "global_disabled",
      outputs: [],
      actions: [],
    };
  }
  if (deps.store.isGuildDisabled(ctx.guildId)) {
    return {
      status: "blocked",
      reason: "guild_disabled",
      outputs: [],
      actions: [],
    };
  }
  const cooldownSeconds = blueprint.cooldownSeconds ?? 0;
  const key = cooldownKey(ctx.guildId, blueprint.name, ctx.userId);
  const check = deps.cooldowns.check(key, cooldownSeconds);
  if (!check.allowed) {
    return {
      status: "blocked",
      reason: "cooldown",
      remainingMs: check.remainingMs,
      outputs: [],
      actions: [],
    };
  }
  for (const condition of blueprint.conditions) {
    if (!evaluateCondition(condition, deps, ctx)) {
      return {
        status: "skipped",
        reason: "condition",
        outputs: [],
        actions: [],
      };
    }
  }
  const outputs: string[] = [];
  const intended: IntendedAction[] = [];
  for (const action of blueprint.actions) {
    runAction(action, blueprint, deps, ctx, outputs, intended);
  }
  if (cooldownSeconds > 0) deps.cooldowns.record(key);
  deps.store.recordExecution(ctx.guildId);
  return { status: "ok", outputs, actions: intended };
}
