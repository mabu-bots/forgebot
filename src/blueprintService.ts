// ==========================================
// 💾 Blueprint の作成・置換サービス
// ==========================================
// 保存前の可否チェック（同名・上限・存在）と保存を分離している。
// チェックだけを先に行い、確認ボタンで確定するまでは保存しない
// フロー（プレビュー → 保存）の土台になる。

import type { Blueprint } from "./blueprint.js";
import type { Store } from "./store.js";

// 📏 ギルドごとの Blueprint 上限
export const MAX_BLUEPRINTS_PER_GUILD = 100;

export type SaveBlueprintResult =
  | { ok: true }
  | {
      ok: false;
      reason: "duplicate" | "limit" | "not_found";
      message: string;
    };

// 🔍 新規作成できるかどうか（同名チェック → 上限チェックの順）
export function checkBlueprintCreation(
  store: Store,
  guildId: string,
  blueprint: Blueprint,
  limit: number = MAX_BLUEPRINTS_PER_GUILD,
): SaveBlueprintResult {
  if (store.getBlueprint(guildId, blueprint.name) !== null) {
    return {
      ok: false,
      reason: "duplicate",
      message: `作成できませんでした。同名の Blueprint が存在します: /${blueprint.name}`,
    };
  }
  if (store.getCounts(guildId).blueprints >= limit) {
    return {
      ok: false,
      reason: "limit",
      message: `作成できませんでした。Blueprintの上限（${limit}件）に達しています`,
    };
  }
  return { ok: true };
}

// 💾 チェックを通ったものだけを保存する
export function createBlueprint(
  store: Store,
  guildId: string,
  blueprint: Blueprint,
  limit: number = MAX_BLUEPRINTS_PER_GUILD,
): SaveBlueprintResult {
  const check = checkBlueprintCreation(store, guildId, blueprint, limit);
  if (!check.ok) return check;
  store.upsertBlueprint(guildId, blueprint);
  return { ok: true };
}

// 🔍 置換できるかどうか（元の存在 → 改名先の重複の順）
export function checkBlueprintReplacement(
  store: Store,
  guildId: string,
  originalName: string,
  blueprint: Blueprint,
): SaveBlueprintResult {
  if (store.getBlueprint(guildId, originalName) === null) {
    return {
      ok: false,
      reason: "not_found",
      message: `見つかりませんでした: /${originalName}`,
    };
  }
  if (
    blueprint.name !== originalName &&
    store.getBlueprint(guildId, blueprint.name) !== null
  ) {
    return {
      ok: false,
      reason: "duplicate",
      message: `更新できませんでした。同名の Blueprint が存在します: /${blueprint.name}`,
    };
  }
  return { ok: true };
}

// 🔄 チェックを通った置換を保存する（名前変更も1回の置換として扱う）
export function replaceBlueprint(
  store: Store,
  guildId: string,
  originalName: string,
  blueprint: Blueprint,
): SaveBlueprintResult {
  const check = checkBlueprintReplacement(
    store,
    guildId,
    originalName,
    blueprint,
  );
  if (!check.ok) return check;
  store.replaceBlueprint(guildId, originalName, blueprint);
  return { ok: true };
}
