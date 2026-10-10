// トップページの「今日の運勢と得点」(ab-42、2026-10-01)。
// 要点は Takashi の制約「開いただけでは何も取りに行かない、押したときだけ動く」。
// 開いた時点で API にも today-panel.js にも触れていないこと、
// 押したら 運勢・今日の得点・今週(先週まであと何点)が出ることを見る。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jstDate, isoWeekKey } from "../src/common/today-panel.js";
import { listenSafe } from "./listen-safe.js";
import { routeFirebaseStub } from "./firebase-stub.js";
import { FAKE_GOOGLE_CREDENTIAL, useTestOwner } from "./test-owner.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".yml": "text/plain" };

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

test("トップ: 開いただけでは取りに行かず、押したら運勢・今日の得点・今週が出る", async () => {
  // index.html は nav.yml から作る生成物(gitignore)なので、ここで作る
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-index.mjs")], { cwd: ROOT });
  const server = await serveStatic();
  const origin = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage()
    await useTestOwner(page);
    const apiCalls = [];
    const localJs = [];
    page.on("request", (r) => {
      if (r.url().startsWith(origin) && r.url().includes("today-panel.js")) localJs.push(r.url());
    });
    await page.route((u) => !u.href.startsWith(origin), (route) => {
      const url = route.request().url();
      if (url.includes("/api/session")) {
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sessionToken: "session:testid.testsig" }) });
      }
      if (url.includes("/api/ba?")) {
        // ab-166 ③: 週の得点はページ側で数える。旧 ba の close は Azure から(ここでは無し)
        apiCalls.push(url);
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
      return route.abort();
    });

    // ab-162: 今日の得点は Firestore(スタブ)から。一覧はログインしてから出る
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    // 週の得点(ab-166 ③)も Firestore から数える: 今週は今日の86点、先週は7日前の200点
    const weekAgo = new Date(Date.now() + 9 * 3600e3 - 7 * 86400e3).toISOString().slice(0, 10);
    await routeFirebaseStub(page, { [today]: { score: 86, note: "" }, [weekAgo]: { score: 200, note: "" } });
    await page.goto(`${origin}/`);
    assert.equal(await page.isVisible("#todayBtn"), false, "ログイン前に中身が見えている");
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForSelector("#todayBtn", { state: "visible" });
    // 決め打ちで待たず、通信が落ち着くまで待ってから「取りに行っていない」を見る(ab-106)
    await page.waitForLoadState("networkidle");
    assert.deepEqual(apiCalls, [], "開いただけで API を叩いている");
    assert.deepEqual(localJs, [], "開いただけで today-panel.js を読み込んでいる");

    await page.click("#todayBtn");
    // 押した直後は today-panel.js の読み込み待ちで枠が空なので、「取得中が無い」だけだと
    // 重いときに空のまま通ってしまう(ab-106)。3項目が出て、取得中が消えるまで待つ
    await page.waitForFunction(() => {
      const t = document.getElementById("todayBody").textContent;
      return t.includes("今日の得点") && t.includes("今週") && !t.includes("取得中");
    });
    const text = await page.textContent("#todayBody");
    assert.match(text, /運勢(大吉|中吉|小吉|吉|末吉|凶)/);
    assert.match(text, /今日の得点86点/);
    assert.match(text, /今週86点\(先週 200点まで あと114点\)/);
    assert.equal(apiCalls.length, 1, "旧 ba の close を1回だけ読む(週の得点はページ側、ab-166 ③)");

    await page.click("#todayClose");
    assert.equal(await page.$eval("#todayDialog", (d) => d.open), false);
  } finally {
    await browser.close();
    server.close();
  }
});
