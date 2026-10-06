// build-m6-domes.mjs — m6 地図あそびの「ドーム」(ab-48、Takashi「ドーム(中じゃなくて外)」)の表を作る。
// プロ野球の本拠地の6つのドーム球場。いまの呼び名は名前を売った名前なので、ここに書く(Wikidata の名前は古い呼び名のことがある)。
// 座標は Wikidata(CC0)の P625。出力: src/m6/domes.json([名前, 緯度, 経度, 県, Wikidata の Q番号] の6行)。
// 作り直すときは `node scripts/build-m6-domes.mjs`。6つそろわなければ書かずに止まる。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOMES = [
  ["大和ハウス プレミストドーム", "北海道", "Q494860"],
  ["ベルーナドーム", "埼玉県", "Q1194822"],
  ["東京ドーム", "東京都", "Q733748"],
  ["バンテリンドーム ナゴヤ", "愛知県", "Q929524"],
  ["京セラドーム大阪", "大阪府", "Q128836"],
  ["みずほPayPayドーム福岡", "福岡県", "Q1365961"],
];
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/m6/domes.json");
const UA = { "User-Agent": "a1-m6-map/0.1 (https://moriyatakashi.github.io/a1/)", Accept: "application/sparql-results+json" };
const QUERY = `SELECT ?d ?c WHERE { VALUES ?d { ${DOMES.map((d) => "wd:" + d[2]).join(" ")} } ?d wdt:P625 ?c . }`;

const res = await fetch("https://query.wikidata.org/sparql?query=" + encodeURIComponent(QUERY), { headers: UA });
if (!res.ok) throw new Error(`Wikidata: HTTP ${res.status}`);
const at = new Map();
for (const b of (await res.json()).results.bindings) {
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.c.value);
  if (m) at.set(b.d.value.split("/").pop(), [Number(Number(m[2]).toFixed(5)), Number(Number(m[1]).toFixed(5))]);
}
const rows = DOMES.filter(([, , q]) => at.has(q)).map(([name, pref, q]) => [name, ...at.get(q), pref, q]);
if (rows.length !== DOMES.length) throw new Error(`座標がそろわない(${rows.length}/${DOMES.length})`);
fs.writeFileSync(OUT, "[\n" + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n");
console.log(`${rows.length}件`, OUT);
