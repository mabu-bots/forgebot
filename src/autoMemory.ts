// ==========================================
// 💬 リアクション発火メッセージの記憶自動提案
// ==========================================
// リアクション自動化が発火したメッセージの本文を、そのまま
// 名言候補として提案するための入力を組み立てる。
// キーはメッセージ ID から決定的に作るため、同じメッセージからは
// 常に同じキーになり、Store 側の「既存キーは上書きしない」と
// 合わせて候補はメッセージごとに1件だけになる。

import {
  validateMemoryKey,
  validateMemoryProposal,
  type MemoryProposalInput,
} from "./memory.js";

export interface AutoMemoryMessageInput {
  messageId: string;
  authorId: string;
  authorBot: boolean;
  content: string;
}

export interface AutoMemoryProposal extends MemoryProposalInput {
  createdBy: string;
}

// 🏷️ 自動提案の種別は名言（quote）固定。本文がそのまま引用候補になるため
export const AUTO_MEMORY_KIND = "quote";
// 🔑 キーの接頭辞。メッセージ ID と合わせて決定的なキーになる
export const AUTO_MEMORY_KEY_PREFIX = "reaction-";

// 🔑 メッセージ ID から記憶のキーを作る（キーとして不正なら null）
export function autoMemoryKey(messageId: string): string | null {
  const validated = validateMemoryKey(AUTO_MEMORY_KEY_PREFIX + messageId);
  return validated.ok ? validated.value : null;
}

// 💬 メッセージから候補の入力を組み立てる。候補化しない場合は null:
// - Bot のメッセージ（自動化の出力が候補になる循環を防ぐ）
// - 本文が空のメッセージ（埋め込み・添付のみ）
// - 記憶の上限（500文字）を超える本文
// 本文の検証は手動の候補登録と同じ validateMemoryProposal を使う。
export function buildAutoMemoryProposal(
  input: AutoMemoryMessageInput,
): AutoMemoryProposal | null {
  if (input.authorBot) return null;
  const key = autoMemoryKey(input.messageId);
  if (key === null) return null;
  const validated = validateMemoryProposal({
    key,
    kind: AUTO_MEMORY_KIND,
    content: input.content,
  });
  if (!validated.ok) return null;
  return { ...validated.value, createdBy: input.authorId };
}
