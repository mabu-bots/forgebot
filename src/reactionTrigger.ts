// ==========================================
// 👍 リアクション Trigger の照合
// ==========================================
// 絵文字が指定されていればその絵文字の数、無ければ合計で判定する。
// 発火済みのメッセージは二度と一致しない。

import type { ReactionTrigger } from "./blueprint.js";

export interface ReactionMatchInput {
  // 🔢 絵文字キー（文字列表現・名前・ID）ごとのリアクション数
  emojiCounts: Readonly<Record<string, number>>;
  totalCount: number;
  alreadyFired: boolean;
}

// 🔢 判定に使うリアクション数を返す
export function reactionCountFor(
  trigger: ReactionTrigger,
  input: ReactionMatchInput,
): number {
  if (trigger.emoji === undefined) return input.totalCount;
  return input.emojiCounts[trigger.emoji] ?? 0;
}

// 👍 発火条件を満たすかどうか
export function matchesReactionTrigger(
  trigger: ReactionTrigger,
  input: ReactionMatchInput,
): boolean {
  if (input.alreadyFired) return false;
  return reactionCountFor(trigger, input) >= trigger.threshold;
}
