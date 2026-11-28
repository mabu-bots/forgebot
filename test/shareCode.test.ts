import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { validateBlueprint, type Blueprint } from "../src/blueprint.js";
import {
  decodeShareCode,
  encodeShareCode,
  ShareCodeError,
} from "../src/shareCode.js";

function slashBlueprint(): Blueprint {
  return validateBlueprint({
    name: "omikuji",
    trigger: { type: "slash", command: "omikuji" },
    conditions: [{ type: "always" }],
    actions: [{ type: "reply", template: "結果: {choice:大吉,凶}" }],
  });
}

function reactionBlueprint(): Blueprint {
  return validateBlueprint({
    name: "meigen",
    trigger: {
      type: "reaction",
      emoji: "⭐",
      threshold: 5,
      channelId: "1234567890",
      template: "{messageUrl} が {reactionCount} 件に達しました",
    },
    conditions: [{ type: "always" }],
    actions: [
      {
        type: "sendToChannel",
        channelId: "1234567890",
        template: "{messageUrl} が {reactionCount} 件に達しました",
      },
    ],
  });
}

// 🔧 テスト用に任意のペイロードから正しいチェックサムのコードを組み立てる
function craftCode(payloadObject: unknown): string {
  const payload = gzipSync(Buffer.from(JSON.stringify(payloadObject), "utf-8"));
  const checksum = createHash("sha256")
    .update(payload)
    .digest("hex")
    .slice(0, 8);
  return `FORGE1-${checksum}-${payload.toString("base64url")}`;
}

test("共有コードはラウンドトリップできる", () => {
  const blueprint = slashBlueprint();
  assert.deepEqual(decodeShareCode(encodeShareCode(blueprint)), blueprint);
});

test("自動化の共有コードはチャンネル ID とテンプレートを保持する", () => {
  const blueprint = reactionBlueprint();
  const decoded = decodeShareCode(encodeShareCode(blueprint));
  assert.deepEqual(decoded, blueprint);
  assert.equal(decoded.trigger.type, "reaction");
});

test("コード中の空白と改行は無視される", () => {
  const code = encodeShareCode(slashBlueprint());
  const withBreaks = `${code.slice(0, 20)}\n  ${code.slice(20)}`;
  assert.deepEqual(decodeShareCode(withBreaks), slashBlueprint());
});

test("接頭辞が違うコードは拒否される", () => {
  const code = encodeShareCode(slashBlueprint());
  assert.throws(
    () => decodeShareCode(`FORGE2-${code.slice("FORGE1-".length)}`),
    (error: unknown) =>
      error instanceof ShareCodeError && /FORGE1-/.test(error.message),
  );
  assert.throws(() => decodeShareCode("not-a-code"), ShareCodeError);
});

test("改ざんされたコードはチェックサム不一致で拒否される", () => {
  const code = encodeShareCode(slashBlueprint());
  const index = code.length - 5;
  const replacement = code[index] === "A" ? "B" : "A";
  const tampered = code.slice(0, index) + replacement + code.slice(index + 1);
  assert.throws(
    () => decodeShareCode(tampered),
    (error: unknown) =>
      error instanceof ShareCodeError && /チェックサム/.test(error.message),
  );
});

test("チェックサム欄が違うコードは拒否される", () => {
  const code = craftCode({ version: 1, blueprint: slashBlueprint() });
  const tampered = `FORGE1-00000000-${code.slice("FORGE1-00000000-".length)}`;
  assert.throws(() => decodeShareCode(tampered), ShareCodeError);
});

test("未対応のバージョンは拒否される", () => {
  const code = craftCode({ version: 2, blueprint: slashBlueprint() });
  assert.throws(
    () => decodeShareCode(code),
    (error: unknown) =>
      error instanceof ShareCodeError && /バージョン/.test(error.message),
  );
});

test("不正な Blueprint を含むコードは拒否される", () => {
  const code = craftCode({
    version: 1,
    blueprint: { name: "", trigger: { type: "slash", command: "x" } },
  });
  assert.throws(() => decodeShareCode(code), ShareCodeError);
});

test("展開後に 1 MiB を超えるコードは拒否される", () => {
  const code = craftCode({
    version: 1,
    blueprint: slashBlueprint(),
    padding: "x".repeat(2 * 1024 * 1024),
  });
  assert.throws(
    () => decodeShareCode(code),
    (error: unknown) =>
      error instanceof ShareCodeError &&
      /展開できませんでした/.test(error.message),
  );
});
