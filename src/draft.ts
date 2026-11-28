// ==========================================
// 📝 確認待ちドラフト（保存前セッション）
// ==========================================
// Blueprint の保存・削除など、確認ボタンを挟む操作の下書きを
// メモリ上に保持する。永続化はしない（プロセス再起動で消える）。
// 有効期限は10分。take は取得と削除を同時に行い、二重確定を防ぐ。

import { randomUUID } from "node:crypto";
import type { Blueprint } from "./blueprint.js";

export const DRAFT_TTL_MS = 10 * 60 * 1000; // 10分

export type DraftData =
  | { kind: "create"; blueprint: Blueprint }
  | { kind: "edit"; blueprint: Blueprint; originalName: string }
  | { kind: "delete"; name: string }
  | { kind: "dataDelete" }
  | { kind: "importChannel"; blueprint: Blueprint };

export interface DraftSession {
  id: string;
  guildId: string;
  userId: string;
  data: DraftData;
  createdAt: number;
  expiresAt: number;
}

// 🧱 ドラフトの保管庫（期限切れは取得時に落とす）
export class DraftStore {
  private readonly sessions = new Map<string, DraftSession>();
  private readonly clock: () => number;
  private readonly ttlMs: number;
  private readonly nextId: () => string;

  constructor(
    now: () => number = Date.now,
    ttlMs: number = DRAFT_TTL_MS,
    createId: () => string = randomUUID,
  ) {
    this.clock = now;
    this.ttlMs = ttlMs;
    this.nextId = createId;
  }

  // 📝 ドラフトを登録する（登録前に期限切れを掃除する）
  put(guildId: string, userId: string, data: DraftData): DraftSession {
    this.prune();
    const createdAt = this.clock();
    const session: DraftSession = {
      id: this.nextId(),
      guildId,
      userId,
      data,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  // 🔍 ドラフトを取得する（期限切れは削除して null）
  get(id: string): DraftSession | null {
    const session = this.sessions.get(id);
    if (session === undefined) return null;
    if (session.expiresAt <= this.clock()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  // 🔁 取得と同時に削除する。確認は1回限りになる
  take(id: string): DraftSession | null {
    const session = this.get(id);
    if (session === null) return null;
    this.sessions.delete(id);
    return session;
  }

  // 🧹 期限切れのドラフトをすべて削除し、削除件数を返す
  prune(): number {
    const now = this.clock();
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  // 🔢 保持中の件数
  get size(): number {
    return this.sessions.size;
  }
}

// 👤 セッションの所有者（ギルドとユーザーの両方が一致）かどうか
export function isDraftOwner(
  session: DraftSession,
  guildId: string,
  userId: string,
): boolean {
  return session.guildId === guildId && session.userId === userId;
}

// ==========================================
// 🔘 確認ボタンの customId
// ==========================================

export type DraftButtonAction = "confirm" | "cancel";

const DRAFT_CUSTOM_ID_PREFIX = "forge:draft:";

// 🔘 customId を組み立てる（forge:draft:<action>:<id>）
export function buildDraftCustomId(
  action: DraftButtonAction,
  id: string,
): string {
  return `${DRAFT_CUSTOM_ID_PREFIX}${action}:${id}`;
}

// 🔍 customId を解釈する（形式が合わなければ null）
export function parseDraftCustomId(
  customId: string,
): { action: DraftButtonAction; id: string } | null {
  if (!customId.startsWith(DRAFT_CUSTOM_ID_PREFIX)) return null;
  const rest = customId.slice(DRAFT_CUSTOM_ID_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator < 0) return null;
  const action = rest.slice(0, separator);
  const id = rest.slice(separator + 1);
  if (action !== "confirm" && action !== "cancel") return null;
  if (id === "") return null;
  return { action, id };
}
