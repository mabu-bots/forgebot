import assert from "node:assert/strict";
import { test } from "node:test";
import { formatExecLog, summarizeExecError } from "../src/execLog.js";

const NOW = new Date("2026-11-23T00:00:00.000Z");

test("成功時は result=ok の1行になる", () => {
  const line = formatExecLog(NOW, {
    command: "forge",
    guildId: "g1",
    channelId: "c1",
    userId: "u1",
  });
  assert.equal(
    line,
    "[exec] 2026-11-23T00:00:00.000Z cmd=forge route=slash guild=g1 channel=c1 user=u1 result=ok",
  );
});

test("失敗時は result=error と要約が末尾に付く", () => {
  const line = formatExecLog(NOW, {
    command: "c",
    guildId: "g1",
    channelId: "c1",
    userId: "u1",
    error: new Error("store is locked"),
  });
  assert.equal(
    line,
    '[exec] 2026-11-23T00:00:00.000Z cmd=c route=slash guild=g1 channel=c1 user=u1 result=error error="store is locked"',
  );
});

test("ギルド・チャンネルが null なら - で記録される", () => {
  const line = formatExecLog(NOW, {
    command: "forge",
    guildId: null,
    channelId: null,
    userId: "u1",
  });
  assert.ok(line.includes("guild=- channel=-"));
});

test("要約は改行と引用符を潰して1行に収める", () => {
  const summary = summarizeExecError(new Error('line1\nline2 "quoted"'));
  assert.equal(summary, "line1 line2 'quoted'");
});

test("要約は120文字で切り詰められる", () => {
  const summary = summarizeExecError(new Error("x".repeat(300)));
  assert.equal(Array.from(summary).length, 120);
});

test("Error 以外も文字列化され、空なら unknown error になる", () => {
  assert.equal(summarizeExecError("plain failure"), "plain failure");
  assert.equal(summarizeExecError(new Error("")), "unknown error");
  assert.equal(summarizeExecError(null), "unknown error");
});
