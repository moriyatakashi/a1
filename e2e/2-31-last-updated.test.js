// ab-166 ⑤(2026-10-10 すま): 「最終更新」は Pages に公開するときに作る last-updated.json から読む(Azure を通さない)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectLastUpdated } from "../scripts/build-last-updated.mjs";

test("build-last-updated: nav.yml と src のページのフォルダの日時を git から取る", () => {
  const data = collectLastUpdated();
  for (const key of ["nav.yml", "src/m1", "src/m3", "src/common"]) {
    assert.match(data[key] || "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/, key);
  }
  assert.ok(!Object.keys(data).some((k) => k.includes("node_modules")));
});
