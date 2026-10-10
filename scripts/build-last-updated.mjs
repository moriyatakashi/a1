// build-last-updated.mjs — 各ページの「最終更新」を git の履歴から1つの JSON に書き出す(ab-166 ⑤、2026-10-10 Takashi 決定)。
// これまでは Azure の /api/last-updated が GitHub を読んで返していた。Azure をやめるので、Pages に公開するときに
// ここで last-updated.json を作り、ページ(src/common/last-updated.js)はそれを読む。回数の上限は無い。
// 出すもの: { "src/m1": "2026-10-10T19:00:00+09:00", ..., "nav.yml": "..." }(src の下のフォルダごとと nav.yml)
// 使い方: node scripts/build-last-updated.mjs [出力先(既定 last-updated.json)]
// 履歴が浅い(shallow)と古い日付が取れないので、Pages の deploy は fetch-depth: 0 で checkout している。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function lastCommit(rel) {
  try {
    return execFileSync("git", ["log", "-1", "--format=%cI", "--", rel], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export function collectLastUpdated() {
  const targets = ["nav.yml"];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const child = `${rel}/${e.name}`;
      targets.push(child);
      walk(child);
    }
  };
  walk("src");
  const out = {};
  for (const t of targets) {
    const d = lastCommit(t);
    if (d) out[t] = d;
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dest = path.resolve(ROOT, process.argv[2] || "last-updated.json");
  const data = collectLastUpdated();
  fs.writeFileSync(dest, JSON.stringify(data, null, 0) + "\n");
  console.log(`last-updated.json: ${Object.keys(data).length} 件 → ${path.relative(ROOT, dest)}`);
}
