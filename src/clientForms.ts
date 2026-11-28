// ==========================================
// 🪟 モーダル・ボタン・選択メニューの構築
// ==========================================
// UI 部品の組み立てだけを担う。表示文言・上限はここに集約する。

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { AutomationForm } from "./automationForm.js";
import type { Blueprint } from "./blueprint.js";
import {
  MAX_COUNTER_KEY_LENGTH,
  MAX_TEMPLATE_LENGTH,
  type BlueprintFormInput,
} from "./blueprintForm.js";
import { MODAL_IMPORT_ID } from "./clientShared.js";
import { buildDraftCustomId } from "./draft.js";

export type AutomationTriggerType = "reaction" | "schedule";

// 🪟 テキスト入力欄を1つ組み立てる（初期値が空でなければ入れる）
function textField(
  customId: string,
  label: string,
  style: TextInputStyle,
  required: boolean,
  initial?: string,
  placeholder?: string,
): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required);
  if (initial !== undefined && initial !== "") input.setValue(initial);
  if (placeholder !== undefined) input.setPlaceholder(placeholder);
  return input;
}

// ==========================================
// 🪟 Blueprint 作成・編集モーダル
// ==========================================

export function buildBlueprintModal(
  customId: string,
  title: string,
  initial?: BlueprintFormInput,
): ModalBuilder {
  const nameInput = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("コマンド名")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(32);
  if (initial !== undefined) nameInput.setValue(initial.name);
  const templateInput = new TextInputBuilder()
    .setCustomId("template")
    .setLabel("返信テンプレート")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(MAX_TEMPLATE_LENGTH)
    .setPlaceholder("{user} さん、訪問 {count:visits} 回目");
  if (initial !== undefined) templateInput.setValue(initial.template);
  const cooldownInput = new TextInputBuilder()
    .setCustomId("cooldown")
    .setLabel("クールダウン (秒、任意)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(5);
  if (initial !== undefined && initial.cooldown !== "") {
    cooldownInput.setValue(initial.cooldown);
  }
  const counterInput = new TextInputBuilder()
    .setCustomId("counter")
    .setLabel("カウンターキー (任意)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(MAX_COUNTER_KEY_LENGTH);
  if (initial !== undefined && initial.counterKey !== "") {
    counterInput.setValue(initial.counterKey);
  }
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(templateInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(cooldownInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(counterInput),
    );
}

// ==========================================
// 🔘 確認ボタン行
// ==========================================

// 🔘 「確定（ラベル可変）/ キャンセル」の2ボタンの行を作る
export function buildDraftButtons(
  sessionId: string,
  confirmLabel: string,
  confirmStyle: ButtonStyle,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildDraftCustomId("confirm", sessionId))
      .setLabel(confirmLabel)
      .setStyle(confirmStyle),
    new ButtonBuilder()
      .setCustomId(buildDraftCustomId("cancel", sessionId))
      .setLabel("キャンセル")
      .setStyle(ButtonStyle.Secondary),
  );
}

// ==========================================
// 🪟 自動化モーダル
// ==========================================

export function buildAutoModal(
  customId: string,
  triggerType: AutomationTriggerType,
  initial?: AutomationForm,
): ModalBuilder {
  const nameInput = textField(
    "name",
    "名前",
    TextInputStyle.Short,
    true,
    initial?.input.name,
  );
  nameInput.setMaxLength(32);
  const templateInput = textField(
    "template",
    "送信テンプレート",
    TextInputStyle.Paragraph,
    true,
    initial?.input.template,
    "{messageUrl} が {reactionCount} 件のリアクションに達しました",
  );
  templateInput.setMaxLength(MAX_TEMPLATE_LENGTH);
  const rows: Array<ActionRowBuilder<TextInputBuilder>> = [
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
  ];
  if (triggerType === "reaction") {
    const current =
      initial !== undefined && initial.kind === "reaction"
        ? initial.input
        : undefined;
    rows.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        textField(
          "emoji",
          "絵文字 (任意、空欄で全絵文字)",
          TextInputStyle.Short,
          false,
          current?.emoji,
        ),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        textField(
          "threshold",
          "閾値 (リアクション数)",
          TextInputStyle.Short,
          true,
          current?.threshold,
        ),
      ),
    );
  } else {
    const current =
      initial !== undefined && initial.kind === "schedule"
        ? initial.input
        : undefined;
    rows.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        textField(
          "dailyTime",
          "時刻 HH:MM (任意)",
          TextInputStyle.Short,
          false,
          current?.dailyTime,
          "09:00",
        ),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        textField(
          "interval",
          "間隔 分 (任意)",
          TextInputStyle.Short,
          false,
          current?.intervalMinutes,
          "60",
        ),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder<TextInputBuilder>().addComponents(templateInput),
  );
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(
      triggerType === "reaction" ? "リアクション自動化" : "スケジュール自動化",
    )
    .addComponents(...rows);
}

// ==========================================
// 🪟 共有コード読み込みモーダル
// ==========================================

export function buildImportModal(): ModalBuilder {
  const codeInput = textField(
    "code",
    "共有コード",
    TextInputStyle.Paragraph,
    true,
  );
  const nameInput = textField(
    "newName",
    "新しい名前 (任意)",
    TextInputStyle.Short,
    false,
  );
  nameInput.setMaxLength(32);
  return new ModalBuilder()
    .setCustomId(MODAL_IMPORT_ID)
    .setTitle("共有コードの読み込み")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(codeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    );
}

// ==========================================
// 📢 チャンネル選択メニューと表示用ヘルパー
// ==========================================

export function buildChannelSelectRow(
  customId: string,
): ActionRowBuilder<ChannelSelectMenuBuilder> {
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("送信先チャンネル")
      .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
      .setMinValues(1)
      .setMaxValues(1),
  );
}

// 🏷️ Trigger 種別の一覧表示用文字列
export function describeTrigger(blueprint: Blueprint): string {
  switch (blueprint.trigger.type) {
    case "slash":
      return "slash";
    case "reaction":
      return "reaction";
    case "schedule":
      return "schedule";
    default:
      return `event (${blueprint.trigger.event})`;
  }
}

// 🏷️ 一覧表示用の名前（slash のときだけ / を付ける）
export function displayBlueprintName(blueprint: Blueprint): string {
  return blueprint.trigger.type === "slash"
    ? `/${blueprint.name}`
    : blueprint.name;
}
