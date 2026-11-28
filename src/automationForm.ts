// ==========================================
// 🤖 自動化フォームの変換
// ==========================================
// リアクション / スケジュール自動化のモーダル入力と Blueprint の
// 相互変換。自動化は「Trigger 本体にも送信情報を持ち、アクションは
// sendToChannel が1つだけ」という形に揃えている。

import {
  BlueprintValidationError,
  MAX_REACTION_THRESHOLD,
  MAX_SCHEDULE_INTERVAL_MINUTES,
  validateBlueprint,
  type Blueprint,
} from "./blueprint.js";
import {
  MAX_TEMPLATE_LENGTH,
  validateCommandName,
  type FormResult,
} from "./blueprintForm.js";
import { isValidTimezone, parseDailyTime } from "./schedule.js";

export const MAX_EMOJI_LENGTH = 64;
export const DEFAULT_TIMEZONE = "Asia/Tokyo";

export interface ReactionFormInput {
  name: string;
  emoji: string;
  threshold: string;
  channelId: string;
  template: string;
}

export interface ScheduleFormInput {
  name: string;
  dailyTime: string;
  intervalMinutes: string;
  channelId: string;
  template: string;
  timezone?: string;
}

export type AutomationForm =
  | { kind: "reaction"; input: ReactionFormInput }
  | { kind: "schedule"; input: ScheduleFormInput };

function ok<T>(value: T): FormResult<T> {
  return { ok: true, value };
}

function err<T>(message: string): FormResult<T> {
  return { ok: false, message };
}

// 📝 テンプレートの空・長さを検証する
function checkTemplate(raw: string): FormResult<string> {
  if (raw.trim() === "") return err("テンプレートが空です");
  if (raw.length > MAX_TEMPLATE_LENGTH) {
    return err(
      `テンプレートが長すぎます: ${raw.length} 文字 (上限 ${MAX_TEMPLATE_LENGTH} 文字)`,
    );
  }
  return ok(raw);
}

// 📢 送信先チャンネルが選択済みかを検証する
function checkChannelId(raw: string): FormResult<string> {
  if (raw.trim() === "") return err("送信先チャンネルが選択されていません");
  return ok(raw.trim());
}

// 🛠️ 原データから Blueprint を検証付きで組み立てる
function buildFromRaw(raw: Record<string, unknown>): FormResult<Blueprint> {
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
// 🔢 数値入力の解釈
// ==========================================

// 🔢 閾値の入力を整数へ解釈する
export function parseThreshold(raw: string): FormResult<number> {
  const failure = `閾値は 1 から ${MAX_REACTION_THRESHOLD} の整数で入力してください`;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return err(failure);
  const value = Number(trimmed);
  if (value < 1 || value > MAX_REACTION_THRESHOLD) return err(failure);
  return ok(value);
}

// ⏱️ 間隔の入力を分へ解釈する（空欄は null = 間隔を使わない）
export function parseIntervalMinutes(raw: string): FormResult<number | null> {
  const failure = `間隔は 1 から ${MAX_SCHEDULE_INTERVAL_MINUTES} の整数 (分) で入力してください`;
  const trimmed = raw.trim();
  if (trimmed === "") return ok(null);
  if (!/^\d+$/.test(trimmed)) return err(failure);
  const value = Number(trimmed);
  if (value < 1 || value > MAX_SCHEDULE_INTERVAL_MINUTES) return err(failure);
  return ok(value);
}

// ==========================================
// 👍 リアクション自動化の構築
// ==========================================

export function buildReactionBlueprint(
  input: ReactionFormInput,
): FormResult<Blueprint> {
  const name = validateCommandName(input.name);
  if (!name.ok) return name;
  const template = checkTemplate(input.template);
  if (!template.ok) return template;
  const channelId = checkChannelId(input.channelId);
  if (!channelId.ok) return channelId;
  const threshold = parseThreshold(input.threshold);
  if (!threshold.ok) return threshold;
  const emoji = input.emoji.trim();
  if ([...emoji].length > MAX_EMOJI_LENGTH) {
    return err(
      `絵文字が長すぎます: ${[...emoji].length} 文字 (上限 ${MAX_EMOJI_LENGTH} 文字)`,
    );
  }
  const trigger: Record<string, unknown> = {
    type: "reaction",
    threshold: threshold.value,
    channelId: channelId.value,
    template: template.value,
  };
  if (emoji !== "") trigger.emoji = emoji;
  return buildFromRaw({
    name: name.value,
    trigger,
    conditions: [{ type: "always" }],
    actions: [
      {
        type: "sendToChannel",
        channelId: channelId.value,
        template: template.value,
      },
    ],
  });
}

// ==========================================
// ⏰ スケジュール自動化の構築
// ==========================================

export function buildScheduleBlueprint(
  input: ScheduleFormInput,
): FormResult<Blueprint> {
  const name = validateCommandName(input.name);
  if (!name.ok) return name;
  const template = checkTemplate(input.template);
  if (!template.ok) return template;
  const channelId = checkChannelId(input.channelId);
  if (!channelId.ok) return channelId;
  const dailyTime = input.dailyTime.trim();
  const interval = parseIntervalMinutes(input.intervalMinutes);
  if (!interval.ok) return interval;
  if (dailyTime !== "" && interval.value !== null) {
    return err("時刻と間隔はどちらか一方だけを入力してください");
  }
  if (dailyTime === "" && interval.value === null) {
    return err("時刻 (HH:MM) または間隔 (分) のどちらかを入力してください");
  }
  if (dailyTime !== "" && parseDailyTime(dailyTime) === null) {
    return err("時刻は HH:MM の形式で入力してください");
  }
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  if (!isValidTimezone(timezone)) {
    return err(`タイムゾーンが不正です: ${timezone}`);
  }
  const trigger: Record<string, unknown> = {
    type: "schedule",
    timezone,
    channelId: channelId.value,
    template: template.value,
  };
  if (dailyTime !== "") trigger.dailyTime = dailyTime;
  if (interval.value !== null) trigger.intervalMinutes = interval.value;
  return buildFromRaw({
    name: name.value,
    trigger,
    conditions: [{ type: "always" }],
    actions: [
      {
        type: "sendToChannel",
        channelId: channelId.value,
        template: template.value,
      },
    ],
  });
}

// ==========================================
// 📢 送信先チャンネルの取得と付け替え
// ==========================================

// 📢 自動化 Blueprint の送信先チャンネルを返す（自動化でなければ null）
export function getAutomationChannelId(blueprint: Blueprint): string | null {
  if (
    blueprint.trigger.type === "reaction" ||
    blueprint.trigger.type === "schedule"
  ) {
    return blueprint.trigger.channelId;
  }
  return null;
}

// 📢 共有コード読み込み用: 送信先を読み込み先ギルドのチャンネルへ差し替える。
// Trigger と sendToChannel アクションの両方を差し替え、検証し直して返す。
export function remapAutomationChannel(
  blueprint: Blueprint,
  channelId: string,
): Blueprint {
  const copy = JSON.parse(JSON.stringify(blueprint)) as Blueprint;
  if (copy.trigger.type === "reaction" || copy.trigger.type === "schedule") {
    copy.trigger.channelId = channelId;
  }
  for (const action of copy.actions) {
    if (action.type === "sendToChannel") action.channelId = channelId;
  }
  return validateBlueprint(copy);
}

// ==========================================
// 📝 Blueprint → フォーム（編集用）
// ==========================================

// 📝 フォームで扱える形の自動化だけを復元する:
// Trigger 本体と単一の sendToChannel アクションが一致していること。
export function extractAutomationForm(
  blueprint: Blueprint,
): FormResult<AutomationForm> {
  const trigger = blueprint.trigger;
  if (trigger.type !== "reaction" && trigger.type !== "schedule") {
    return err(
      "編集できませんでした。Trigger が自動化ではない Blueprint はこのフォームで編集できません",
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
  const actions = blueprint.actions;
  if (
    actions.length !== 1 ||
    actions[0]!.type !== "sendToChannel" ||
    actions[0]!.channelId !== trigger.channelId ||
    actions[0]!.template !== trigger.template
  ) {
    return err(
      "編集できませんでした。アクションの構成が異なる Blueprint はこのフォームで編集できません",
    );
  }
  if (trigger.type === "reaction") {
    return ok({
      kind: "reaction",
      input: {
        name: blueprint.name,
        emoji: trigger.emoji ?? "",
        threshold: String(trigger.threshold),
        channelId: trigger.channelId,
        template: trigger.template,
      },
    });
  }
  return ok({
    kind: "schedule",
    input: {
      name: blueprint.name,
      dailyTime: trigger.dailyTime ?? "",
      intervalMinutes:
        trigger.intervalMinutes === undefined
          ? ""
          : String(trigger.intervalMinutes),
      channelId: trigger.channelId,
      template: trigger.template,
      timezone: trigger.timezone,
    },
  });
}
