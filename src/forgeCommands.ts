// ==========================================
// 🛠️ /forge サブコマンドのハンドラ群
// ==========================================
// 各ハンドラは ephemeral で返信する。保存を伴う操作は原則として
// 「プレビュー（または内容表示）→ 確認ボタン」の形にし、
// ボタンを押すまでストアへ書き込まない。

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  extractAutomationForm,
  getAutomationChannelId,
} from "./automationForm.js";
import type { Blueprint } from "./blueprint.js";
import {
  extractSimpleForm,
  renderBlueprintPreview,
  validateCommandName,
} from "./blueprintForm.js";
import {
  checkBlueprintCreation,
  checkBlueprintReplacement,
} from "./blueprintService.js";
import {
  buildAutoModal,
  buildBlueprintModal,
  buildChannelSelectRow,
  buildDraftButtons,
  buildImportModal,
  describeTrigger,
  displayBlueprintName,
} from "./clientForms.js";
import {
  LIST_DISPLAY_LIMIT,
  MODAL_AUTO_EDIT_PREFIX,
  MODAL_CREATE_ID,
  MODAL_EDIT_PREFIX,
  SELECT_AUTO_TYPE_ID,
  SELECT_IMPORT_CHANNEL_PREFIX,
  SHARE_CODE_INLINE_LIMIT,
  pluginsOf,
  requireManageGuild,
  type ClientDeps,
} from "./clientShared.js";
import { getGalleryTemplate, listGalleryTemplates } from "./gallery.js";
import { computeGrowthStage } from "./growth.js";
import { validateMemoryProposal } from "./memory.js";
import { RenderError } from "./render.js";
import { encodeShareCode } from "./shareCode.js";

// ==========================================
// 📊 status
// ==========================================

export async function handleStatus(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) return;
  const guildId = interaction.guildId ?? "";
  const counts = deps.store.getCounts(guildId);
  const record = deps.store.getGrowthRecord(guildId);
  const growth = computeGrowthStage(
    record?.totalExecutions ?? counts.executions,
    record?.activeDays ?? 0,
  );
  const enabledPlugins = deps.store
    .listPluginInstalls(guildId)
    .filter((p) => p.enabled).length;
  await interaction.reply({
    content: [
      `Blueprint: ${counts.blueprints}`,
      `Variable: ${counts.variables}`,
      `Counter: ${counts.counters}`,
      `実行総数: ${counts.executions}`,
      `記憶: ${deps.store.countMemories(guildId, "approved")} 件 (候補 ${deps.store.countMemories(guildId, "pending")} 件)`,
      `親密度: 段階 ${growth.level} (${growth.label}) / 稼働 ${growth.activeDays} 日`,
      `プラグイン: ${enabledPlugins} 件有効`,
    ].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

// ==========================================
// 🧠 memory グループ
// ==========================================

// 🧠 候補を登録する
export async function handleMemoryPropose(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const validated = validateMemoryProposal({
    key: interaction.options.getString("key", true),
    kind: interaction.options.getString("kind", true),
    content: interaction.options.getString("content", true),
  });
  if (!validated.ok) {
    await interaction.reply({
      content: `登録できませんでした。${validated.message}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const record = deps.store.proposeMemory(guildId, {
    ...validated.value,
    createdBy: interaction.user.id,
  });
  await interaction.reply({
    content: `候補を登録しました: ${record.key}`,
    flags: MessageFlags.Ephemeral,
  });
}

// 🧠 一覧を承認状態つきで表示する
export async function handleMemoryList(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const statusRaw = interaction.options.getString("status");
  const status =
    statusRaw === "pending" ||
    statusRaw === "approved" ||
    statusRaw === "rejected"
      ? statusRaw
      : undefined;
  const memories = deps.store.listMemories(guildId, status);
  if (memories.length === 0) {
    await interaction.reply({
      content: "記憶: 0 件",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const lines = memories
    .slice(0, LIST_DISPLAY_LIMIT)
    .map((m, i) => `${i + 1}. ${m.key}: [${m.kind}/${m.status}] ${m.content}`);
  await interaction.reply({
    content: [`記憶一覧: ${memories.length} 件`, ...lines].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

// 🧠 候補を承認する
export async function handleMemoryApprove(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const key = interaction.options.getString("key", true).trim().toLowerCase();
  const done = deps.store.approveMemory(guildId, key, interaction.user.id);
  await interaction.reply({
    content: done ? `承認しました: ${key}` : `見つかりませんでした: ${key}`,
    flags: MessageFlags.Ephemeral,
  });
}

// 🧠 候補を却下する
export async function handleMemoryReject(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const key = interaction.options.getString("key", true).trim().toLowerCase();
  const done = deps.store.rejectMemory(guildId, key);
  await interaction.reply({
    content: done ? `却下しました: ${key}` : `見つかりませんでした: ${key}`,
    flags: MessageFlags.Ephemeral,
  });
}

// 🧠 記憶を削除する
export async function handleMemoryDelete(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const key = interaction.options.getString("key", true).trim().toLowerCase();
  const done = deps.store.deleteMemory(guildId, key);
  await interaction.reply({
    content: done ? `削除しました: ${key}` : `見つかりませんでした: ${key}`,
    flags: MessageFlags.Ephemeral,
  });
}

// 🧠 自動提案の有効・無効を切り替える
export async function handleMemoryAutoSetEnabled(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
  enabled: boolean,
): Promise<void> {
  deps.store.setAutoMemoryEnabled(interaction.guildId ?? "", enabled);
  await interaction.reply({
    content: enabled
      ? "記憶の自動提案を有効化しました"
      : "記憶の自動提案を無効化しました",
    flags: MessageFlags.Ephemeral,
  });
}

// ==========================================
// 🔌 plugin グループ
// ==========================================

// 🔌 読み込み済みプラグインとギルドごとの有効状態を表示する
export async function handlePluginList(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const plugins = pluginsOf(deps).list();
  if (plugins.length === 0) {
    await interaction.reply({
      content: "プラグイン: 0 件",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const lines = plugins.map((plugin, i) => {
    const enabled = deps.store.isPluginEnabled(guildId, plugin.manifest.name);
    const blocks = [
      ...plugin.manifest.provides.conditions.map((c) => `条件:${c}`),
      ...plugin.manifest.provides.actions.map((a) => `アクション:${a}`),
    ].join(", ");
    return `${i + 1}. ${plugin.manifest.name}: ${enabled ? "有効" : "無効"} (${blocks})`;
  });
  await interaction.reply({
    content: [`プラグイン一覧: ${plugins.length} 件`, ...lines].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

// 🔌 プラグインの有効・無効を切り替える
export async function handlePluginSetEnabled(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
  enabled: boolean,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const name = interaction.options.getString("name", true);
  if (pluginsOf(deps).get(name) === null) {
    await interaction.reply({
      content: `見つかりませんでした: ${name}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  deps.store.setPluginEnabled(guildId, name, enabled);
  await interaction.reply({
    content: enabled ? `有効化しました: ${name}` : `無効化しました: ${name}`,
    flags: MessageFlags.Ephemeral,
  });
}

// ==========================================
// 🖼️ template グループ
// ==========================================

// 🖼️ 公式テンプレートの一覧を表示する
export async function handleTemplateList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const templates = listGalleryTemplates();
  const lines = templates.map(
    (t, i) => `${i + 1}. ${t.id}: ${t.name} - ${t.description}`,
  );
  await interaction.reply({
    content: [`テンプレート一覧: ${templates.length} 件`, ...lines].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

// 🖼️ テンプレートを取り込む。自動化テンプレートは送信先チャンネルの
// 選択から始め、それ以外は確認ボタン付きで提示する（即保存はしない）。
export async function handleTemplateUse(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const id = interaction.options.getString("id", true);
  const template = getGalleryTemplate(id);
  if (template === null) {
    await interaction.reply({
      content: `見つかりませんでした: ${id}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const newNameRaw = interaction.options.getString("name");
  let blueprint: Blueprint = template.blueprint;
  if (newNameRaw !== null && newNameRaw.trim() !== "") {
    const validated = validateCommandName(newNameRaw);
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
  const check = checkBlueprintCreation(deps.store, guildId, blueprint);
  if (!check.ok) {
    await interaction.reply({
      content: check.message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const session = deps.drafts.put(guildId, interaction.user.id, {
    kind: "create",
    blueprint,
  });
  await interaction.reply({
    content: `テンプレート: ${template.id} (${blueprint.name})`,
    components: [buildDraftButtons(session.id, "保存", ButtonStyle.Primary)],
    flags: MessageFlags.Ephemeral,
  });
}

// ==========================================
// 📝 create / list / delete / edit
// ==========================================

// 📝 作成モーダルを開く
export async function handleCreate(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.showModal(
    buildBlueprintModal(MODAL_CREATE_ID, "Blueprint 作成"),
  );
}

// 📋 Blueprint の一覧（自動化も Trigger 種別つきで含む）
export async function handleList(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const blueprints = deps.store.listBlueprints(interaction.guildId ?? "");
  if (blueprints.length === 0) {
    await interaction.reply({
      content: "Blueprint: 0 件",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const lines = blueprints
    .slice(0, LIST_DISPLAY_LIMIT)
    .map(
      (blueprint, index) =>
        `${index + 1}. ${displayBlueprintName(blueprint)}: ${describeTrigger(blueprint)}, アクション ${blueprint.actions.length} 件`,
    );
  if (blueprints.length > LIST_DISPLAY_LIMIT) {
    lines.push(`他 ${blueprints.length - LIST_DISPLAY_LIMIT} 件`);
  }
  await interaction.reply({
    content: [`Blueprint 一覧: ${blueprints.length} 件`, ...lines].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

// 🗑️ 削除の確認ボタンを提示する
export async function handleDeleteCommand(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const name = interaction.options.getString("name", true);
  if (deps.store.getBlueprint(guildId, name) === null) {
    await interaction.reply({
      content: `見つかりませんでした: /${name}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const session = deps.drafts.put(guildId, interaction.user.id, {
    kind: "delete",
    name,
  });
  await interaction.reply({
    content: `削除します: /${name}`,
    components: [buildDraftButtons(session.id, "確認", ButtonStyle.Danger)],
    flags: MessageFlags.Ephemeral,
  });
}

// 📝 編集モーダルを開く（自動化は自動化フォーム、送信先は据え置き）
export async function handleEdit(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const name = interaction.options.getString("name", true);
  const blueprint = deps.store.getBlueprint(guildId, name);
  if (blueprint === null) {
    await interaction.reply({
      content: `見つかりませんでした: /${name}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (
    blueprint.trigger.type === "reaction" ||
    blueprint.trigger.type === "schedule"
  ) {
    const form = extractAutomationForm(blueprint);
    if (!form.ok) {
      await interaction.reply({
        content: form.message,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.showModal(
      buildAutoModal(
        `${MODAL_AUTO_EDIT_PREFIX}${name}`,
        blueprint.trigger.type,
        form.value,
      ),
    );
    return;
  }
  const form = extractSimpleForm(blueprint);
  if (!form.ok) {
    await interaction.reply({
      content: form.message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.showModal(
    buildBlueprintModal(
      `${MODAL_EDIT_PREFIX}${name}`,
      "Blueprint 編集",
      form.value,
    ),
  );
}

// ==========================================
// 📦 data グループ
// ==========================================

// 📤 ギルドのデータを JSON ファイルで書き出す
export async function handleDataExport(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const data = deps.store.exportGuildData(guildId);
  const attachment = new AttachmentBuilder(
    Buffer.from(JSON.stringify(data, null, 2), "utf-8"),
    { name: `forge-export-${guildId}.json` },
  );
  await interaction.reply({
    content: "書き出しました: サーバーのデータ",
    files: [attachment],
    flags: MessageFlags.Ephemeral,
  });
}

// 🗑️ データ全削除の確認ボタンを提示する
export async function handleDataDeleteCommand(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const session = deps.drafts.put(
    interaction.guildId ?? "",
    interaction.user.id,
    {
      kind: "dataDelete",
    },
  );
  await interaction.reply({
    content: "削除します: サーバーのデータ全件",
    components: [buildDraftButtons(session.id, "確認", ButtonStyle.Danger)],
    flags: MessageFlags.Ephemeral,
  });
}

// ==========================================
// 🤖 auto グループ
// ==========================================

// 🤖 Trigger 種別の選択メニューを出す
export async function handleAutoCreateStart(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(SELECT_AUTO_TYPE_ID)
    .setPlaceholder("Trigger の種別")
    .addOptions(
      {
        label: "リアクション",
        value: "reaction",
        description: "リアクション数が閾値に達したら送信する",
      },
      {
        label: "スケジュール",
        value: "schedule",
        description: "時刻または間隔で送信する",
      },
    );
  await interaction.reply({
    content: "Trigger の種別を選択してください",
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// ==========================================
// 🔗 share / import
// ==========================================

// 🔗 共有コードを表示する（長い場合は .txt ファイルで添付）
export async function handleShare(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const name = interaction.options.getString("name", true);
  const blueprint = deps.store.getBlueprint(guildId, name);
  if (blueprint === null) {
    await interaction.reply({
      content: `見つかりませんでした: ${name}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const code = encodeShareCode(blueprint);
  if (code.length <= SHARE_CODE_INLINE_LIMIT) {
    await interaction.reply({
      content: [`共有コード: ${blueprint.name}`, "```", code, "```"].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const attachment = new AttachmentBuilder(Buffer.from(code, "utf-8"), {
    name: `forge-share-${blueprint.name}.txt`,
  });
  await interaction.reply({
    content: `共有コード: ${blueprint.name} (ファイル添付)`,
    files: [attachment],
    flags: MessageFlags.Ephemeral,
  });
}

// 🔗 共有コード読み込みモーダルを開く
export async function handleImportCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.showModal(buildImportModal());
}

// ==========================================
// 👀 保存前プレビューの提示
// ==========================================

export type PreviewInteraction =
  ModalSubmitInteraction | ChannelSelectMenuInteraction;

// 👀 チェック → プレビュー描画 → ドラフト登録 → ボタン提示。
// この時点ではストアへ書き込まない。
export async function presentBlueprintDraft(
  interaction: PreviewInteraction,
  deps: ClientDeps,
  blueprint: Blueprint,
  originalName: string | null,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const check =
    originalName !== null
      ? checkBlueprintReplacement(deps.store, guildId, originalName, blueprint)
      : checkBlueprintCreation(deps.store, guildId, blueprint);
  if (!check.ok) {
    await interaction.reply({
      content: check.message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  let preview: string[];
  try {
    preview = renderBlueprintPreview(blueprint, {
      user: interaction.user.username,
      server: interaction.guild?.name ?? "",
      messageUrl: "(メッセージ URL)",
      reactionCount:
        blueprint.trigger.type === "reaction" ? blueprint.trigger.threshold : 0,
      getCounter: (key) => deps.store.getCounter(guildId, key),
      getMemory: (key) => deps.store.getApprovedMemory(guildId, key),
    });
  } catch (error) {
    if (error instanceof RenderError) {
      await interaction.reply({
        content:
          "プレビューを表示できませんでした。テンプレートのプレースホルダが不正です",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    throw error;
  }
  const session = deps.drafts.put(
    guildId,
    interaction.user.id,
    originalName !== null
      ? { kind: "edit", blueprint, originalName }
      : { kind: "create", blueprint },
  );
  await interaction.reply({
    content: [
      `Blueprint: ${displayBlueprintName(blueprint)}`,
      `Trigger: ${describeTrigger(blueprint)}`,
      `アクション: ${blueprint.actions.length} 件`,
      `クールダウン: ${blueprint.cooldownSeconds ?? 0} 秒`,
      "プレビュー:",
      preview.length > 0 ? preview.join("\n") : "(出力なし)",
    ].join("\n"),
    components: [buildDraftButtons(session.id, "保存", ButtonStyle.Primary)],
    flags: MessageFlags.Ephemeral,
  });
}
