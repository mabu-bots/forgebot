import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getGalleryTemplate,
  importGalleryTemplate,
  listGalleryTemplates,
  loadGalleryTemplates,
} from "../src/gallery.js";
import { Store } from "../src/store.js";

test("同梱ギャラリーは検証済みテンプレートを ID 順で返す", () => {
  const templates = loadGalleryTemplates();
  assert.ok(templates.length >= 3);
  for (const template of templates) {
    assert.ok(template.id !== "");
    assert.ok(template.blueprint.name !== "");
  }
  assert.deepEqual(
    listGalleryTemplates(templates).map((t) => t.id),
    [...templates.map((t) => t.id)].sort(),
  );
});

test("ID でテンプレートを引け、無い ID は null", () => {
  assert.equal(getGalleryTemplate("omikuji")?.blueprint.name, "omikuji");
  assert.equal(getGalleryTemplate("missing-id"), null);
});

test("取り込むとそのギルドの Blueprint として保存される", () => {
  const store = new Store(":memory:");
  const result = importGalleryTemplate(store, "g1", "omikuji");
  assert.equal(result.ok, true);
  assert.equal(store.getBlueprint("g1", "omikuji")?.name, "omikuji");
  assert.equal(store.getBlueprint("g2", "omikuji"), null);
  store.close();
});

test("取り込みはギルドごとに分離され、同名は拒否される", () => {
  const store = new Store(":memory:");
  assert.equal(importGalleryTemplate(store, "g1", "omikuji").ok, true);
  const dup = importGalleryTemplate(store, "g1", "omikuji");
  assert.equal(dup.ok, false);
  assert.equal(importGalleryTemplate(store, "g2", "omikuji").ok, true);
  store.close();
});

test("別名で取り込むと slash のコマンド名も別名になる", () => {
  const store = new Store(":memory:");
  assert.equal(
    importGalleryTemplate(store, "g1", "omikuji", "uranai").ok,
    true,
  );
  assert.equal(store.getBlueprint("g1", "uranai")?.trigger.type, "slash");
  store.close();
});

test("存在しないテンプレートの取り込みは失敗する", () => {
  const store = new Store(":memory:");
  const result = importGalleryTemplate(store, "g1", "nope");
  assert.equal(result.ok, false);
  store.close();
});
