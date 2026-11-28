// ==========================================
// 🧠 サーバーの記憶（入力検証）
// ==========================================
// 記憶は「候補を登録 → 管理者が承認 → テンプレートから参照」の
// 3段階。ここではキー・種別・内容の入力検証だけを担い、
// 保存と状態遷移は Store が担当する。

export type MemoryStatus = "pending" | "approved" | "rejected";

export interface MemoryRecord {
  guildId: string;
  key: string;
  kind: string;
  content: string;
  status: MemoryStatus;
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// 🏷️ コマンドの選択肢で使う種別（値は英語キー、表示は日本語）
export const MEMORY_KINDS = ["quote", "anniversary", "note"] as const;

export const MAX_MEMORY_KEY_LENGTH = 32;
export const MAX_MEMORY_CONTENT_LENGTH = 500;
export const MAX_MEMORY_KIND_LENGTH = 32;

const MEMORY_KEY_PATTERN = /^[-\p{L}\p{N}_]+$/u;

export type MemoryValidationResult<T> =
  { ok: true; value: T } | { ok: false; message: string };

function ok<T>(value: T): MemoryValidationResult<T> {
  return { ok: true, value };
}

function err<T>(message: string): MemoryValidationResult<T> {
  return { ok: false, message };
}

// 🔑 記憶のキーを検証し、小文字へ正規化する
export function validateMemoryKey(raw: string): MemoryValidationResult<string> {
  const key = raw.trim().toLowerCase();
  if (key === "") return err("キーが空です");
  if ([...key].length > MAX_MEMORY_KEY_LENGTH) {
    return err(
      `キーが長すぎます: ${[...key].length} 文字 (上限 ${MAX_MEMORY_KEY_LENGTH} 文字)`,
    );
  }
  if (!MEMORY_KEY_PATTERN.test(key)) {
    return err(
      "キーに使用できない文字が含まれています: 使用できるのは文字・数字・ハイフン・アンダースコアです",
    );
  }
  return ok(key);
}

// 🏷️ 記憶の種別を検証する
export function validateMemoryKind(
  raw: string,
): MemoryValidationResult<string> {
  const kind = raw.trim();
  if (kind === "") return err("種別が空です");
  if ([...kind].length > MAX_MEMORY_KIND_LENGTH) {
    return err(
      `種別が長すぎます: ${[...kind].length} 文字 (上限 ${MAX_MEMORY_KIND_LENGTH} 文字)`,
    );
  }
  return ok(kind);
}

// 📝 記憶の内容を検証する（前後の空白は取り除く）
export function validateMemoryContent(
  raw: string,
): MemoryValidationResult<string> {
  const content = raw.trim();
  if (content === "") return err("内容が空です");
  if ([...content].length > MAX_MEMORY_CONTENT_LENGTH) {
    return err(
      `内容が長すぎます: ${[...content].length} 文字 (上限 ${MAX_MEMORY_CONTENT_LENGTH} 文字)`,
    );
  }
  return ok(content);
}

export interface MemoryProposalInput {
  key: string;
  kind: string;
  content: string;
}

// ✅ 候補登録の入力3点をまとめて検証する
export function validateMemoryProposal(
  input: MemoryProposalInput,
): MemoryValidationResult<MemoryProposalInput> {
  const key = validateMemoryKey(input.key);
  if (!key.ok) return key;
  const kind = validateMemoryKind(input.kind);
  if (!kind.ok) return kind;
  const content = validateMemoryContent(input.content);
  if (!content.ok) return content;
  return ok({ key: key.value, kind: kind.value, content: content.value });
}
