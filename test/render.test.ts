import assert from "node:assert/strict";
import { test } from "node:test";
import { RenderError, renderTemplate } from "../src/render.js";

function makeCtx(
  overrides: Partial<Parameters<typeof renderTemplate>[1]> = {},
) {
  return {
    user: "taro",
    server: "テストサーバー",
    getCounter: (key: string) => (key === "visits" ? 42 : 0),
    getVariable: (key: string) => (key === "mood" ? "good" : null),
    rng: () => 0,
    ...overrides,
  };
}

test("{user} と {server} を置き換える", () => {
  assert.equal(
    renderTemplate("{user} in {server}", makeCtx()),
    "taro in テストサーバー",
  );
});

test("{count:キー} はカウンター値に、未知のキーは 0 になる", () => {
  assert.equal(
    renderTemplate("訪問: {count:visits}回", makeCtx()),
    "訪問: 42回",
  );
  assert.equal(renderTemplate("{count:unknown}", makeCtx()), "0");
});

test("{random:1-100} は rng=0 で下限を返す", () => {
  assert.equal(
    renderTemplate("{random:1-100}", makeCtx({ rng: () => 0 })),
    "1",
  );
});

test("{random} は上限を超えず、最小=最大でもその値を返す", () => {
  assert.equal(
    renderTemplate("{random:1-100}", makeCtx({ rng: () => 0.999999 })),
    "100",
  );
  assert.equal(
    renderTemplate("{random:5-5}", makeCtx({ rng: () => 0.5 })),
    "5",
  );
});

test("{random} の範囲が逆転・非数なら RenderError", () => {
  assert.throws(() => renderTemplate("{random:10-1}", makeCtx()), RenderError);
  assert.throws(() => renderTemplate("{random:a-b}", makeCtx()), RenderError);
});

test("{choice} は rng に応じて先頭・末尾を選ぶ", () => {
  assert.equal(
    renderTemplate("{choice:大吉,中吉,小吉}", makeCtx({ rng: () => 0 })),
    "大吉",
  );
  assert.equal(
    renderTemplate("{choice:大吉,中吉,小吉}", makeCtx({ rng: () => 0.999 })),
    "小吉",
  );
});

test("{var:キー} は変数値に、無ければ空文字列になる", () => {
  assert.equal(renderTemplate("気分: {var:mood}", makeCtx()), "気分: good");
  assert.equal(renderTemplate("[{var:missing}]", makeCtx()), "[]");
});

test("未知のプレースホルダは元の表記のまま残る", () => {
  assert.equal(renderTemplate("{unknown}", makeCtx()), "{unknown}");
});
