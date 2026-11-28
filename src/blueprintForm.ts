// ==========================================
// 📝 Blueprint 作成フォームの変換
// ==========================================
// モーダルの4項目（名前・テンプレート・クールダウン・カウンターキー）
// と Blueprint の相互変換を担う。編集時は、フォームで扱える単純な
// 形の Blueprint だけを復元し、それ以外は理由を返して断る。

import {
  BlueprintValidationError,
  MAX_COOLDOWN_SECONDS,
  validateBlueprint,
  type Action,
  type Blueprint,
} from "./blueprint.js";
import { renderTemplate } from "./render.js";

export const MAX_TEMPLATE_LENGTH = 2000;
export const MAX_COUNTER_KEY_LENGTH = 32;
// 📏 クールダウン上限は Blueprint 検証と共通の定数を正とする
export { MAX_COOLDOWN_SECONDS } from "./blueprint.js";

export interface BlueprintFormInput {
  name: string;
  template: string;
  cooldown: string;
  counterKey: string;
}

export type FormResult<T> =
  { ok: true; value: T } | { ok: false; message: string };

function ok<T>(value: T): FormResult<T> {
  return { ok: true, value };
}

function err<T>(message: string): FormResult<T> {
  return { ok: false, message };
}

// ==========================================
// 🔤 名前・クールダウン・カウンターキーの解釈
// ==========================================

// 💡 Discord のスラッシュコマンド名: 1〜32文字、
// 文字・数字・ハイフン・アンダースコア（日本語可）。
// 入力は先に小文字化するので、大文字はエラーにしない。
const NAME_PATTERN = /^[-\p{L}\p{N}_]+$/u;

// 🔤 コマンド名を検証し、小文字へ正規化する
export function validateCommandName(raw: string): FormResult<string> {
  const name = raw.trim().toLowerCase();
  if (name === "") return err("名前が空です");
  if ([...name].length > 32) {
    return err(`名前が長すぎます: ${[...name].length} 文字 (上限 32 文字)`);
  }
  if (!NAME_PATTERN.test(name)) {
    return err(
      "名前に使用できない文字が含まれています: 使用できるのは文字・数字・ハイフン・アンダースコアです",
    );
  }
  return ok(name);
}

// ⏳ クールダウンの入力を秒へ解釈する（空欄は 0）
export function parseCooldownSeconds(raw: string): FormResult<number> {
  const failure = `クールダウンは 0 から ${MAX_COOLDOWN_SECONDS} の整数 (秒) で入力してください`;
  const trimmed = raw.trim();
  if (trimmed === "") return ok(0);
  if (!/^\d+$/.test(trimmed)) return err(failure);
  const value = Number(trimmed);
  if (value > MAX_COOLDOWN_SECONDS) return err(failure);
  return ok(value);
}

const COUNTER_KEY_PATTERN = /^[-\p{L}\p{N}_]+$/u;

// 🔢 カウンターキーを検証する（空欄は null = カウンターなし）
export function parseCounterKey(raw: string): FormResult<string | null> {
  const key = raw.trim();
  if (key === "") return ok(null);
  if ([...key].length > MAX_COUNTER_KEY_LENGTH) {
    return err(
      `カウンターキーが長すぎます: ${[...key].length} 文字 (上限 ${MAX_COUNTER_KEY_LENGTH} 文字)`,
    );
  }
  if (!COUNTER_KEY_PATTERN.test(key)) {
    return err(
      "カウンターキーに使用できない文字が含まれています: 使用できるのは文字・数字・ハイフン・アンダースコアです",
    );
  }
  return ok(key);
}

// ==========================================
// 📝 フォーム → Blueprint
// ==========================================

// 🛠️ フォーム入力から Blueprint を組み立てる。
// アクションは「カウンター加算（任意）→ 返信」の順で固定する。
export function buildBlueprintFromForm(
  input: BlueprintFormInput,
): FormResult<Blueprint> {
  const name = validateCommandName(input.name);
  if (!name.ok) return name;
  if (input.template.trim() === "") return err("テンプレートが空です");
  if (input.template.length > MAX_TEMPLATE_LENGTH) {
    return err(
      `テンプレートが長すぎます: ${input.template.length} 文字 (上限 ${MAX_TEMPLATE_LENGTH} 文字)`,
    );
  }
  const cooldown = parseCooldownSeconds(input.cooldown);
  if (!cooldown.ok) return cooldown;
  const counterKey = parseCounterKey(input.counterKey);
  if (!counterKey.ok) return counterKey;
  const actions: Action[] = [];
  if (counterKey.value !== null) {
    actions.push({
      type: "incrementCounter",
      key: counterKey.value,
      amount: 1,
    });
  }
  actions.push({ type: "reply", template: input.template });
  const raw: Record<string, unknown> = {
    name: name.value,
    trigger: { type: "slash", command: name.value },
    conditions: [{ type: "always" }],
    actions,
  };
  if (cooldown.value > 0) raw.cooldownSeconds = cooldown.value;
  try {
    return ok(validateBlueprint(raw));
  } catch (error) {
    if (error instanceof BlueprintValidationError) {
      return err(`Blueprint を構築できませんでした: ${error.message}`);
    }
    throw error;
  }
}

// ==========================================
// 📝 Blueprint → フォーム（編集用）
// ==========================================

// 📝 フォームで扱える形だけを復元する:
// - Trigger が slash
// - 条件は無し、または always が1つだけ
// - アクションは「返信のみ」か「カウンター加算 → 返信」
export function extractSimpleForm(
  blueprint: Blueprint,
): FormResult<BlueprintFormInput> {
  if (blueprint.trigger.type !== "slash") {
    return err(
      "編集できませんでした。Trigger が slash ではない Blueprint はこのフォームで編集できません",
    );
  }
  const conditions = blueprint.conditions;
  if (
    conditions.length > 1 ||
    (conditions.length === 1 && conditions[0]!.type !== "always")
  ) {
    return err(
      "編集できませんでした。条件が設定されている Blueprint はこのフォームで編集できません",
    );
  }
  let counterKey = "";
  let replyTemplate: string | null = null;
  const actions = blueprint.actions;
  if (actions.length === 1 && actions[0]!.type === "reply") {
    replyTemplate = actions[0]!.template;
  } else if (
    actions.length === 2 &&
    actions[0]!.type === "incrementCounter" &&
    actions[1]!.type === "reply"
  ) {
    counterKey = actions[0]!.key;
    replyTemplate = actions[1]!.template;
  } else {
    return err(
      "編集できませんでした。アクションの構成が異なる Blueprint はこのフォームで編集できません",
    );
  }
  return ok({
    name: blueprint.name,
    template: replyTemplate,
    cooldown:
      blueprint.cooldownSeconds !== undefined && blueprint.cooldownSeconds > 0
        ? String(blueprint.cooldownSeconds)
        : "",
    counterKey,
  });
}

// ==========================================
// 👀 保存前プレビューの描画
// ==========================================

export interface PreviewContext {
  user: string;
  server: string;
  messageUrl?: string;
  reactionCount?: number;
  getCounter: (key: string) => number;
  getMemory?: (key: string) => string | null;
}

// 👀 保存前に見せる描画例。カウンターは加算後の値で見せるが、
// 実データは変更しない（加算分は内部のオフセットで表現する）。
export function renderBlueprintPreview(
  blueprint: Blueprint,
  ctx: PreviewContext,
): string[] {
  const pendingIncrements = new Map<string, number>();
  const outputs: string[] = [];
  for (const action of blueprint.actions) {
    if (action.type === "incrementCounter") {
      const amount = action.amount ?? 1;
      pendingIncrements.set(
        action.key,
        (pendingIncrements.get(action.key) ?? 0) + amount,
      );
      continue;
    }
    if (action.type === "reply" || action.type === "sendToChannel") {
      const text = renderTemplate(action.template, {
        user: ctx.user,
        server: ctx.server,
        messageUrl: ctx.messageUrl,
        reactionCount: ctx.reactionCount,
        getCounter: (key) =>
          ctx.getCounter(key) + (pendingIncrements.get(key) ?? 0),
        getVariable: () => null,
        getMemory: ctx.getMemory ?? (() => null),
      });
      outputs.push((blueprint.presentation?.prefix ?? "") + text);
    }
  }
  return outputs;
}
