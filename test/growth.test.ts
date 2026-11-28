import assert from "node:assert/strict";
import { test } from "node:test";
import { computeGrowthStage } from "../src/growth.js";
import { Store } from "../src/store.js";

test("段階は実行総数と稼働日数の両方の条件で上がる", () => {
  assert.equal(computeGrowthStage(0, 0).level, 1);
  assert.equal(computeGrowthStage(9, 30).level, 1);
  assert.equal(computeGrowthStage(10, 0).level, 1);
  assert.equal(computeGrowthStage(10, 1).level, 2);
  assert.equal(computeGrowthStage(50, 7).level, 3);
  assert.equal(computeGrowthStage(200, 30).level, 4);
  assert.equal(computeGrowthStage(500, 60).level, 5);
  assert.equal(computeGrowthStage(1000, 365).level, 5);
});

test("段階の算出は負数を 0 として扱い、ラベルを返す", () => {
  assert.deepEqual(computeGrowthStage(-5, -1), computeGrowthStage(0, 0));
  assert.equal(computeGrowthStage(50, 7).label, "活発");
});

test("実行を記録すると成長記録が増える", () => {
  const store = new Store(":memory:");
  store.recordExecution("g1");
  store.recordExecution("g1");
  const growth = store.getGrowthRecord("g1");
  assert.equal(growth?.totalExecutions, 2);
  assert.equal(growth?.activeDays, 1);
  assert.equal(store.getGrowthRecord("g2"), null);
  store.close();
});

test("同じ日の実行では稼働日数は増えず、日が変わると増える", () => {
  const store = new Store(":memory:");
  const day1 = new Date("2026-11-01T10:00:00.000Z");
  store.recordGrowthExecution("g1", day1);
  store.recordGrowthExecution("g1", new Date("2026-11-01T20:00:00.000Z"));
  assert.equal(store.getGrowthRecord("g1")?.activeDays, 1);
  store.recordGrowthExecution("g1", new Date("2026-11-02T00:30:00.000Z"));
  const growth = store.getGrowthRecord("g1");
  assert.equal(growth?.activeDays, 2);
  assert.equal(growth?.totalExecutions, 3);
  store.close();
});

test("成長記録はギルドごとに分離され export/delete に含まれる", () => {
  const store = new Store(":memory:");
  store.recordExecution("g1");
  store.recordExecution("g2");
  store.recordExecution("g2");
  assert.equal(store.exportGuildData("g1").growth?.totalExecutions, 1);
  assert.equal(store.exportGuildData("g2").growth?.totalExecutions, 2);
  store.deleteGuildData("g1");
  assert.equal(store.getGrowthRecord("g1"), null);
  assert.equal(store.getGrowthRecord("g2")?.totalExecutions, 2);
  store.close();
});
