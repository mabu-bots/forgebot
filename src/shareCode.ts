// ==========================================
// 🔗 共有コードの符号化と復号
// ==========================================
// 形式: FORGE1-<SHA-256 先頭8桁>-<gzip 圧縮した JSON の base64url>
// JSON は { version: 1, blueprint: <Blueprint> }。
// チェックサムで改ざんを検出し、展開後のサイズに上限を設けて
// zip bomb 的な入力から守る。復号後は必ず validateBlueprint を通す。

import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  BlueprintValidationError,
  validateBlueprint,
  type Blueprint,
} from "./blueprint.js";

export const SHARE_CODE_PREFIX = "FORGE1-";
export const SHARE_CODE_VERSION = 1;

const CHECKSUM_LENGTH = 8;
const MAX_PAYLOAD_JSON_BYTES = 1024 * 1024; // 展開後 1 MiB まで

// ❌ 共有コードとして読み込めない場合のエラー
export class ShareCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareCodeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 🔑 ペイロードのチェックサム（SHA-256 の先頭8桁）
function checksumOf(payload: Buffer): string {
  return createHash("sha256")
    .update(payload)
    .digest("hex")
    .slice(0, CHECKSUM_LENGTH);
}

// ==========================================
// 📤 符号化
// ==========================================

export function encodeShareCode(blueprint: Blueprint): string {
  const json = JSON.stringify({ version: SHARE_CODE_VERSION, blueprint });
  const payload = gzipSync(Buffer.from(json, "utf-8"));
  const body = payload.toString("base64url");
  return `${SHARE_CODE_PREFIX}${checksumOf(payload)}-${body}`;
}

// ==========================================
// 📥 復号と検証
// ==========================================

export function decodeShareCode(code: string): Blueprint {
  // 📭 貼り付け時に混ざる空白・改行は先に取り除く
  const compact = code.replace(/\s+/g, "");
  if (!compact.startsWith(SHARE_CODE_PREFIX)) {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードは FORGE1- で始まる必要があります",
    );
  }
  const rest = compact.slice(SHARE_CODE_PREFIX.length);
  const separator = rest.indexOf("-");
  if (separator < 0) {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードの形式が不正です",
    );
  }
  const checksum = rest.slice(0, separator);
  const payload = Buffer.from(rest.slice(separator + 1), "base64url");
  if (payload.length === 0 || checksumOf(payload) !== checksum) {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードのチェックサムが一致しません",
    );
  }
  let json: string;
  try {
    json = gunzipSync(payload, {
      maxOutputLength: MAX_PAYLOAD_JSON_BYTES,
    }).toString("utf-8");
  } catch {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードを展開できませんでした",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードの内容が不正です",
    );
  }
  if (!isRecord(parsed) || typeof parsed.version !== "number") {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードの内容が不正です",
    );
  }
  if (parsed.version !== SHARE_CODE_VERSION) {
    throw new ShareCodeError(
      `読み込みできませんでした。共有コードのバージョンに対応していません: ${parsed.version}`,
    );
  }
  try {
    return validateBlueprint(parsed.blueprint);
  } catch (error) {
    if (error instanceof BlueprintValidationError) {
      throw new ShareCodeError(
        `読み込みできませんでした。Blueprint が不正です: ${error.message}`,
      );
    }
    throw error;
  }
}
