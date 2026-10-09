// 検索に出したくないページに noindex が入っているか(ab-154、2026-10-09)。
// a1/robots.txt はドメインの一番上に無いので効かない。ページごとの <meta name="robots"> で外す。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const NOINDEX_PAGES = [
  "src/ba/index.html", "src/bb/index.html", "src/x2/index.html",
  "src/m8/index.html", // ab-159: 保存するだけの自分用ページ
];

for (const page of NOINDEX_PAGES) {
  test(`${page} は検索に出さない(noindex)`, () => {
    const html = readFileSync(new URL(`../../${page}`, import.meta.url), "utf8");
    const head = html.split(/<\/head>/i)[0];
    assert.match(head, /<meta\s+name="robots"\s+content="[^"]*noindex/i);
  });
}
