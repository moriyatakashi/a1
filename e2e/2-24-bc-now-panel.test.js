// bc の「今の状態」(2026-10-03、ab-45)。累計のチャートの上に、開いている件数・返事待ち・最後の動きが古い ab を出す。
// ab は済み(done)を除く。返事待ちは needsReply かつ済んでいないものを宛先ごとに数える。
// ba は status が closed のもの、Takashi が最後に無効(void=true)にしたものを除く。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenSafe } from "./listen-safe.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serveStatic() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      fs.readFile(path.join(ROOT, p), (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
        res.end(data);
      });
    });
    listenSafe(server).then(resolve);
  });
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

// ba: B1 開いている / B2 閉じた / B3 無効にした
const BA = [
  { id: "B1", threadId: "B1", by: "claude-pc", type: "new", seq: 1, createdAt: daysAgo(50), title: "B1" },
  { id: "B2", threadId: "B2", by: "claude-pc", type: "new", seq: 2, createdAt: daysAgo(50), title: "B2" },
  { id: "B2-s", threadId: "B2", by: "takashi", type: "status", status: "closed", createdAt: daysAgo(40) },
  { id: "B3", threadId: "B3", by: "claude-pc", type: "new", seq: 3, createdAt: daysAgo(50), title: "B3" },
  { id: "B3-v", threadId: "B3", by: "takashi", type: "void", value: true, createdAt: daysAgo(40) },
];

const FS = "https://firestore.googleapis.com/v1/projects/ab01-9f35a/databases/(default)/documents/abThreads";
function abDoc(id, { seq, title, createdAt, done = false, needsReply = false, to = ["all"] }) {
  return {
    name: `x/abThreads/${id}`,
    fields: {
      by: { stringValue: "claude-pc" }, createdAt: { stringValue: createdAt }, seq: { integerValue: String(seq) },
      title: { stringValue: title }, done: { booleanValue: done }, needsReply: { booleanValue: needsReply },
      to: { arrayValue: { values: to.map((v) => ({ stringValue: v })) } },
    },
  };
}
const note = (createdAt, body = "") => ({ name: "x/n", fields: { by: { stringValue: "claude-pc" }, createdAt: { stringValue: createdAt }, body: { stringValue: body } } });
// A1: 60日前に立てたが 2日前に note → 最後の動きは2日前。A2: 30日前に立て、今日タイトルを直しただけ → 30日前のまま。A3: 済み(数えない)。A4: 10日前、すまと礼文に返事待ち
const AB_ROUTES = {
  [FS]: { documents: [
    abDoc("A1", { seq: 1, title: "動いている古い件", createdAt: daysAgo(60), needsReply: true, to: ["suma"] }),
    abDoc("A2", { seq: 2, title: "寝ている件", createdAt: daysAgo(30) }),
    abDoc("A3", { seq: 3, title: "済んだ件", createdAt: daysAgo(90), done: true, needsReply: true, to: ["suma"] }),
    abDoc("A4", { seq: 4, title: "返事がほしい件", createdAt: daysAgo(10), needsReply: true, to: ["suma", "rebun"] }),
  ] },
  [`${FS}/A1/notes`]: { documents: [note(daysAgo(2))] },
  [`${FS}/A2/notes`]: { documents: [note(daysAgo(0), "タイトルを変えた(旧: 寝ている件の古い名前)")] },
};

test("bc: 今の状態(開いている件数・返事待ち・最後の動きが古い ab)が出る(ab-45)", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route("https://ab-board-api.azurewebsites.net/api/ba", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(BA) }));
    await page.route(/firestore\.googleapis\.com\//, (route) => {
      const url = route.request().url().split("?")[0];
      route.fulfill({ contentType: "application/json", body: JSON.stringify(AB_ROUTES[url] || {}) });
    });

    await page.goto(`http://localhost:${server.address().port}/src/bc/`);
    await page.evaluate(() => {
      document.getElementById("content").style.display = "block";
      window.__credential = "test";
      window.dispatchEvent(new Event("bc-login-success"));
    });
    await page.waitForSelector("#nowPanel .now-stale li");

    const text = (await page.textContent("#nowPanel")).replace(/\s+/g, "");
    assert.match(text, /ab開いている3件/, "A1・A2・A4(A3は済み)");
    assert.match(text, /ba開いている1件/, "B1だけ(B2は閉じた、B3は無効)");
    assert.deepEqual(await page.locator("#nowPanel .now-chip").allTextContents(), ["すま 2", "礼文 1"], "A3(済み)は数えない");
    const stale = (await page.locator("#nowPanel .now-stale li").allTextContents()).map((s) => s.replace(/\s+/g, ""));
    assert.deepEqual(stale, ["ab-2寝ている件30日前", "ab-4返事がほしい件10日前", "ab-1動いている古い件2日前"],
      "最後の動きが古い順(A1 は note があるので2日前)");
  } finally {
    await browser.close();
    server.close();
  }
});
