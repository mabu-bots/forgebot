// ==========================================
// 🤝 クライアント層の共通基盤
// ==========================================
// 依存関係の型（ClientDeps）、UI 部品で使う customId の定数、
// 表示上限などの定数、そして ManageGuild の再チェックを置く。

import {
  MessageFlags,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { CooldownTracker } from "./cooldown.js";
import type { DraftStore } from "./draft.js";
import { hasManageGuild, MANAGE_GUILD_MISSING_MESSAGE } from "./permissions.js";
import { createDefaultRegistry, type PluginRegistry } from "./plugins.js";
import type { Store } from "./store.js";

// 🧩 ハンドラ一式へ渡す依存関係
export interface ClientDeps {
  store: Store;
  cooldowns: CooldownTracker;
  drafts: DraftStore;
  globalDisabled: boolean;
  plugins?: PluginRegistry;
}

const fallbackRegistry: PluginRegistry = createDefaultRegistry();

// 🔌 依存関係からプラグインレジストリを取り出す（未指定なら既定の dice 入り）
export function pluginsOf(deps: ClientDeps): PluginRegistry {
  return deps.plugins ?? fallbackRegistry;
}

// ==========================================
// 🏷️ customId と各種上限
// ==========================================

export const MODAL_CREATE_ID = "forge:modal:create";
export const MODAL_EDIT_PREFIX = "forge:modal:edit:";
export const MODAL_AUTO_PREFIX = "forge:modal:auto:";
export const MODAL_AUTO_EDIT_PREFIX = "forge:modal:autoedit:";
export const MODAL_IMPORT_ID = "forge:modal:import";
export const SELECT_AUTO_TYPE_ID = "forge:auto:type";
export const SELECT_AUTO_CHANNEL_PREFIX = "forge:auto:channel:";
export const SELECT_IMPORT_CHANNEL_PREFIX = "forge:import:channel:";
export const LIST_DISPLAY_LIMIT = 50; // 一覧表示は最大50件
export const SHARE_CODE_INLINE_LIMIT = 1800; // これを超える共有コードはファイル添付
export const SCHEDULER_INTERVAL_MS = 30_000; // スケジューラの確認間隔（30秒）
export const MAX_MESSAGE_LENGTH = 2000; // Discord のメッセージ上限

// ==========================================
// 🛡️ 権限の再チェック
// ==========================================

export type GuildInteraction =
  | ChatInputCommandInteraction
  | ModalSubmitInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ChannelSelectMenuInteraction;

// 🛡️ ManageGuild を再チェックする。不足していれば案内文を返して false
export async function requireManageGuild(
  interaction: GuildInteraction,
): Promise<boolean> {
  if (hasManageGuild(interaction.memberPermissions)) return true;
  await interaction.reply({
    content: MANAGE_GUILD_MISSING_MESSAGE,
    flags: MessageFlags.Ephemeral,
  });
  return false;
}
