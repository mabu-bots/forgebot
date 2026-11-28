// ==========================================
// 🔀 インタラクションの振り分け
// ==========================================
// モーダル送信・選択メニュー・確認ボタン・補完・スラッシュコマンドを
// 種類ごとに捌く。管理系の操作はすべて ManageGuild を再チェックし、
// ドラフトの操作は作成者本人だけに限定する。

import {
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  buildReactionBlueprint,
  buildScheduleBlueprint,
  getAutomationChannelId,
  remapAutomationChannel,
  type ScheduleFormInput,
} from "./automationForm.js";
import type { Blueprint } from "./blueprint.js";
import {
  buildBlueprintFromForm,
  validateCommandName,
} from "./blueprintForm.js";
import { createBlueprint, replaceBlueprint } from "./blueprintService.js";
import { handleRun } from "./clientExecution.js";
import {
  buildAutoModal,
  buildChannelSelectRow,
  type AutomationTriggerType,
} from "./clientForms.js";
import {
  MODAL_AUTO_EDIT_PREFIX,
  MODAL_AUTO_PREFIX,
  MODAL_CREATE_ID,
  MODAL_EDIT_PREFIX,
  MODAL_IMPORT_ID,
  SELECT_AUTO_CHANNEL_PREFIX,
  SELECT_AUTO_TYPE_ID,
  SELECT_IMPORT_CHANNEL_PREFIX,
  pluginsOf,
  requireManageGuild,
  type ClientDeps,
} from "./clientShared.js";
import { isDraftOwner, parseDraftCustomId } from "./draft.js";
import {
  handleAutoCreateStart,
  handleCreate,
  handleDataDeleteCommand,
  handleDataExport,
  handleDeleteCommand,
  handleEdit,
  handleImportCommand,
  handleList,
  handleMemoryApprove,
  handleMemoryAutoSetEnabled,
  handleMemoryDelete,
  handleMemoryList,
  handleMemoryPropose,
  handleMemoryReject,
  handlePluginList,
  handlePluginSetEnabled,
  handleShare,
  handleStatus,
  handleTemplateList,
  handleTemplateUse,
  presentBlueprintDraft,
} from "./forgeCommands.js";
import { listGalleryTemplates } from "./gallery.js";
import { decodeShareCode, ShareCodeError } from "./shareCode.js";

// ==========================================
// 🪟 モーダル送信
// ==========================================

// 🛠️ 自動化モーダルの入力値から Blueprint を組み立てる
function blueprintFromAutoModal(
  interaction: ModalSubmitInteraction,
  triggerType: AutomationTriggerType,
  channelId: string,
  timezone?: string,
): ReturnType<typeof buildReactionBlueprint> {
  if (triggerType === "reaction") {
    return buildReactionBlueprint({
      name: interaction.fields.getTextInputValue("name"),
      emoji: interaction.fields.getTextInputValue("emoji"),
      threshold: interaction.fields.getTextInputValue("threshold"),
      channelId,
      template: interaction.fields.getTextInputValue("template"),
    });
  }
  const input: ScheduleFormInput = {
    name: interaction.fields.getTextInputValue("name"),
    dailyTime: interaction.fields.getTextInputValue("dailyTime"),
    intervalMinutes: interaction.fields.getTextInputValue("interval"),
    channelId,
    template: interaction.fields.getTextInputValue("template"),
  };
  if (timezone !== undefined) input.timezone = timezone;
  return buildScheduleBlueprint(input);
}

// 🔗 読み込みモーダルの処理: 復号 → 改名（任意）→
// 自動化ならチャンネル選択、slash ならそのままプレビューへ
async function handleImportModalSubmit(
  interaction: ModalSubmitInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  let blueprint: Blueprint;
  try {
    blueprint = decodeShareCode(interaction.fields.getTextInputValue("code"));
  } catch (error) {
    if (error instanceof ShareCodeError) {
      await interaction.reply({
        content: error.message,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    throw error;
  }
  const newName = interaction.fields.getTextInputValue("newName").trim();
  if (newName !== "") {
    const validated = validateCommandName(newName);
    if (!validated.ok) {
      await interaction.reply({
        content: validated.message,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    blueprint = {
      ...blueprint,
      name: validated.value,
      trigger:
        blueprint.trigger.type === "slash"
          ? { type: "slash", command: validated.value }
          : blueprint.trigger,
    };
  }
  if (getAutomationChannelId(blueprint) !== null) {
    const session = deps.drafts.put(guildId, interaction.user.id, {
      kind: "importChannel",
      blueprint,
    });
    await interaction.reply({
      content: `送信先チャンネルを選択してください: ${blueprint.name}`,
      components: [
        buildChannelSelectRow(`${SELECT_IMPORT_CHANNEL_PREFIX}${session.id}`),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await presentBlueprintDraft(interaction, deps, blueprint, null);
}

// 🤖 自動化モーダル（作成・編集）の処理
async function handleAutoModalSubmit(
  interaction: ModalSubmitInteraction,
  deps: ClientDeps,
  isEdit: boolean,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  let triggerType: AutomationTriggerType;
  let channelId: string;
  let originalName: string | null = null;
  let timezone: string | undefined;
  if (!isEdit) {
    // 📝 作成時は customId に種別と送信先が埋め込まれている
    const rest = interaction.customId.slice(MODAL_AUTO_PREFIX.length);
    const separator = rest.indexOf(":");
    triggerType = rest.slice(0, separator) as AutomationTriggerType;
    channelId = rest.slice(separator + 1);
  } else {
    // 📝 編集時は保存済み Blueprint から種別・送信先・タイムゾーンを引き継ぐ
    originalName = interaction.customId.slice(MODAL_AUTO_EDIT_PREFIX.length);
    const existing = deps.store.getBlueprint(guildId, originalName);
    if (
      existing === null ||
      (existing.trigger.type !== "reaction" &&
        existing.trigger.type !== "schedule")
    ) {
      await interaction.reply({
        content: `見つかりませんでした: ${originalName}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    triggerType = existing.trigger.type;
    channelId = existing.trigger.channelId;
    if (existing.trigger.type === "schedule") {
      timezone = existing.trigger.timezone;
    }
  }
  const built = blueprintFromAutoModal(
    interaction,
    triggerType,
    channelId,
    timezone,
  );
  if (!built.ok) {
    await interaction.reply({
      content: built.message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await presentBlueprintDraft(interaction, deps, built.value, originalName);
}

// 🪟 モーダル送信の振り分け
export async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  deps: ClientDeps,
): Promise<void> {
  const customId = interaction.customId;
  const isCreate = customId === MODAL_CREATE_ID;
  const isEdit = customId.startsWith(MODAL_EDIT_PREFIX);
  const isAutoEdit = customId.startsWith(MODAL_AUTO_EDIT_PREFIX);
  const isAuto = customId.startsWith(MODAL_AUTO_PREFIX) && !isAutoEdit;
  const isImport = customId === MODAL_IMPORT_ID;
  if (!isCreate && !isEdit && !isAuto && !isAutoEdit && !isImport) return;
  if (!(await requireManageGuild(interaction))) return;

  if (isImport) {
    await handleImportModalSubmit(interaction, deps);
    return;
  }
  if (isAuto || isAutoEdit) {
    await handleAutoModalSubmit(interaction, deps, isAutoEdit);
    return;
  }
  const originalName = isEdit ? customId.slice(MODAL_EDIT_PREFIX.length) : null;
  const built = buildBlueprintFromForm({
    name: interaction.fields.getTextInputValue("name"),
    template: interaction.fields.getTextInputValue("template"),
    cooldown: interaction.fields.getTextInputValue("cooldown"),
    counterKey: interaction.fields.getTextInputValue("counter"),
  });
  if (!built.ok) {
    await interaction.reply({
      content: built.message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await presentBlueprintDraft(interaction, deps, built.value, originalName);
}

// ==========================================
// 🔽 選択メニュー
// ==========================================

// 🔽 自動化の Trigger 種別が選ばれたら、チャンネル選択へ差し替える
export async function handleStringSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (interaction.customId !== SELECT_AUTO_TYPE_ID) return;
  if (!(await requireManageGuild(interaction))) return;
  const value = interaction.values[0];
  if (value !== "reaction" && value !== "schedule") return;
  await interaction.update({
    content: "送信先チャンネルを選択してください",
    components: [
      buildChannelSelectRow(`${SELECT_AUTO_CHANNEL_PREFIX}${value}`),
    ],
  });
}

// 📢 チャンネル選択の処理（自動化作成の続き / 読み込み時の付け替え）
export async function handleChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  deps: ClientDeps,
): Promise<void> {
  const customId = interaction.customId;
  if (customId.startsWith(SELECT_AUTO_CHANNEL_PREFIX)) {
    if (!(await requireManageGuild(interaction))) return;
    const triggerType = customId.slice(
      SELECT_AUTO_CHANNEL_PREFIX.length,
    ) as AutomationTriggerType;
    const channelId = interaction.values[0];
    if (channelId === undefined) return;
    await interaction.showModal(
      buildAutoModal(
        `${MODAL_AUTO_PREFIX}${triggerType}:${channelId}`,
        triggerType,
      ),
    );
    return;
  }
  if (customId.startsWith(SELECT_IMPORT_CHANNEL_PREFIX)) {
    const draftId = customId.slice(SELECT_IMPORT_CHANNEL_PREFIX.length);
    const session = deps.drafts.get(draftId);
    if (session === null) {
      await interaction.reply({
        content: "見つかりませんでした。確認の有効期限が切れています",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const guildId = interaction.guildId ?? "";
    if (!isDraftOwner(session, guildId, interaction.user.id)) {
      await interaction.reply({
        content: "実行できませんでした。作成者本人のみ操作できます",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!(await requireManageGuild(interaction))) return;
    const taken = deps.drafts.take(draftId);
    if (taken === null || taken.data.kind !== "importChannel") {
      await interaction.reply({
        content: "見つかりませんでした。確認の有効期限が切れています",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const channelId = interaction.values[0];
    if (channelId === undefined) return;
    const remapped = remapAutomationChannel(taken.data.blueprint, channelId);
    await presentBlueprintDraft(interaction, deps, remapped, null);
  }
}

// ==========================================
// 🔘 確認ボタン
// ==========================================

// 🔘 ドラフトの確定・キャンセルを処理する
export async function handleDraftButton(
  interaction: ButtonInteraction,
  deps: ClientDeps,
): Promise<void> {
  const parsed = parseDraftCustomId(interaction.customId);
  if (parsed === null) return;
  const session = deps.drafts.get(parsed.id);
  if (session === null) {
    await interaction.reply({
      content: "見つかりませんでした。確認の有効期限が切れています",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guildId = interaction.guildId ?? "";
  if (!isDraftOwner(session, guildId, interaction.user.id)) {
    await interaction.reply({
      content: "実行できませんでした。作成者本人のみ操作できます",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await requireManageGuild(interaction))) return;
  const taken = deps.drafts.take(parsed.id);
  if (taken === null) {
    await interaction.reply({
      content: "見つかりませんでした。確認の有効期限が切れています",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (parsed.action === "cancel") {
    await interaction.update({ content: "キャンセルしました", components: [] });
    return;
  }
  const data = taken.data;
  switch (data.kind) {
    case "create": {
      const result = createBlueprint(deps.store, guildId, data.blueprint);
      await interaction.update({
        content: result.ok
          ? `作成しました: /${data.blueprint.name}`
          : result.message,
        components: [],
      });
      return;
    }
    case "edit": {
      const result = replaceBlueprint(
        deps.store,
        guildId,
        data.originalName,
        data.blueprint,
      );
      await interaction.update({
        content: result.ok
          ? `更新しました: /${data.blueprint.name}`
          : result.message,
        components: [],
      });
      return;
    }
    case "delete": {
      const deleted = deps.store.deleteBlueprint(guildId, data.name);
      await interaction.update({
        content: deleted
          ? `削除しました: /${data.name}`
          : `見つかりませんでした: /${data.name}`,
        components: [],
      });
      return;
    }
    case "importChannel": {
      // ⚠️ チャンネル未選択のままボタンで確定されることは通常ない
      await interaction.update({
        content: "実行できませんでした。送信先チャンネルが選択されていません",
        components: [],
      });
      return;
    }
    case "dataDelete": {
      deps.store.deleteGuildData(guildId);
      await interaction.update({
        content: "削除しました: サーバーのデータ全件",
        components: [],
      });
      return;
    }
    default: {
      // ⚠️ 未知の種別はデータを変更せずエラーで終える。
      // 将来種別を増やしたとき、誤って全削除などへ落ちないための受け皿。
      await interaction.update({
        content: "実行できませんでした。不明な確認種別です",
        components: [],
      });
      return;
    }
  }
}

// ==========================================
// 🔤 オートコンプリート
// ==========================================

// 🔤 候補: グループに応じて記憶キー / プラグイン名 /
// テンプレート ID / Blueprint 名から部分一致で返す（最大25件）
export async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  deps: ClientDeps,
): Promise<void> {
  if (interaction.commandName !== "forge" || interaction.guildId === null) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused().toLowerCase();
  let group: string | null = null;
  let sub: string | null = null;
  try {
    group = interaction.options.getSubcommandGroup(false);
    sub = interaction.options.getSubcommand(false);
  } catch {
    group = null;
    sub = null;
  }
  let candidates: string[];
  if (group === "memory") {
    candidates = deps.store.listMemories(interaction.guildId).map((m) => m.key);
  } else if (group === "plugin") {
    candidates = pluginsOf(deps)
      .list()
      .map((p) => p.manifest.name);
  } else if (group === "template" && sub === "use") {
    candidates = listGalleryTemplates().map((t) => t.id);
  } else {
    candidates = deps.store
      .listBlueprints(interaction.guildId)
      .map((blueprint) => blueprint.name);
  }
  const choices = candidates
    .filter((name) => name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((name) => ({ name, value: name }));
  await interaction.respond(choices);
}

// ==========================================
// 💬 スラッシュコマンドの振り分け
// ==========================================

// 💬 /forge と /c の振り分け本体。実行ログは呼び出し側（client.ts）が出す
export async function handleChatInputCommand(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  if (interaction.guildId === null) {
    await interaction.reply({
      content: "実行できませんでした。サーバー内で実行してください",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.commandName === "c") {
    await handleRun(interaction, deps);
    return;
  }
  if (interaction.commandName !== "forge") return;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === "data") {
    if (!(await requireManageGuild(interaction))) return;
    if (sub === "export") await handleDataExport(interaction, deps);
    if (sub === "delete") await handleDataDeleteCommand(interaction, deps);
    return;
  }
  if (group === "memory") {
    if (!(await requireManageGuild(interaction))) return;
    if (sub === "propose") await handleMemoryPropose(interaction, deps);
    if (sub === "list") await handleMemoryList(interaction, deps);
    if (sub === "approve") await handleMemoryApprove(interaction, deps);
    if (sub === "reject") await handleMemoryReject(interaction, deps);
    if (sub === "delete") await handleMemoryDelete(interaction, deps);
    if (sub === "auto-enable") {
      await handleMemoryAutoSetEnabled(interaction, deps, true);
    }
    if (sub === "auto-disable") {
      await handleMemoryAutoSetEnabled(interaction, deps, false);
    }
    return;
  }
  if (group === "plugin") {
    if (!(await requireManageGuild(interaction))) return;
    if (sub === "list") await handlePluginList(interaction, deps);
    if (sub === "enable") await handlePluginSetEnabled(interaction, deps, true);
    if (sub === "disable") {
      await handlePluginSetEnabled(interaction, deps, false);
    }
    return;
  }
  if (group === "template") {
    if (!(await requireManageGuild(interaction))) return;
    if (sub === "list") await handleTemplateList(interaction);
    if (sub === "use") await handleTemplateUse(interaction, deps);
    return;
  }
  if (sub === "status") {
    // 📊 status はハンドラ側でも再チェックする
    await handleStatus(interaction, deps);
    return;
  }
  if (!(await requireManageGuild(interaction))) return;
  if (group === "auto") {
    if (sub === "create") await handleAutoCreateStart(interaction);
    return;
  }
  if (sub === "create") await handleCreate(interaction);
  if (sub === "list") await handleList(interaction, deps);
  if (sub === "delete") await handleDeleteCommand(interaction, deps);
  if (sub === "edit") await handleEdit(interaction, deps);
  if (sub === "share") await handleShare(interaction, deps);
  if (sub === "import") await handleImportCommand(interaction);
}
