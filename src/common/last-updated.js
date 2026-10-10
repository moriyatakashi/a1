// common/last-updated.js — 「更新: ...」表示を、そのページのフォルダの最新コミット日時に書き換える共通ロジック
// (ba-67/ba-68、手で日付を書き換え忘れないため)。
//
// 2026-10-10(ab-166 ⑤、Takashi 決定): 日時は Azure の /api/last-updated でなく、Pages に公開するときに
// scripts/build-last-updated.mjs が git の履歴から作る last-updated.json(サイトの一番上)から読む。
// GitHub の API を直接叩かないので回数の上限も鍵も要らない。
//
// 取れなかった場合(ローカルで開いた・オフラインなど)は、HTML 側に書いてある静的な表記をそのまま残す。

import { fmtTs } from "./utils.js";

const JSON_URL = new URL("../../last-updated.json", import.meta.url);
let cache = null;
function load() {
  if (!cache) {
    cache = fetch(JSON_URL, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }
  return cache;
}

// filePath: リポジトリルートからの相対パス(例: "src/m1"、ルートページは "nav.yml")。
// elementId: 書き換える要素の id(既定 "lastUpdated")。label: 表示ラベル(既定 "更新")。
export async function applyLastUpdated(filePath, elementId = "lastUpdated", label = "更新") {
  const el = document.getElementById(elementId);
  if (!el) return;
  try {
    const data = await load();
    const date = data && data[filePath];
    if (!date) return;
    el.textContent = `${label}: ${fmtTs(date)}`;
  } catch (e) {
    // 静的表記のまま
  }
}
