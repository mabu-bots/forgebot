// ==========================================
// 🛡️ 権限チェック（ManageGuild の再確認）
// ==========================================
// コマンド定義側の既定権限だけに頼らず、ハンドラ側でも
// 必ず再チェックするための小さな基盤。

import { PermissionFlagsBits } from "discord.js";

// 🔍 権限の有無を問い合わせるための最小インターフェース
export interface PermissionSet {
  has(flag: bigint): boolean;
}

// ⚠️ 権限不足のときにユーザーへ返す文言（声のルールに従う）
export const MANAGE_GUILD_MISSING_MESSAGE =
  "実行できませんでした。権限が不足しています: ManageGuild";

// 🔍 ManageGuild 権限を持っているかどうかを返す（権限不明は false）
export function hasManageGuild(
  permissions: PermissionSet | null | undefined,
): boolean {
  if (permissions === null || permissions === undefined) return false;
  return permissions.has(PermissionFlagsBits.ManageGuild);
}
