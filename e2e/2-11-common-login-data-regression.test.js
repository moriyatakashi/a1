// ba-9の残タスク(2): API_BASEをcommon/config.jsへ集約したリファクタ後、
// m1/m4(旧bc・k2)がクリーンな状態(ba は 2026-10-12 に礼文のローカル Web へ移した、ab-165)(localStorageなし)でログイン→config.js解決→
// データ取得まで通しで壊れていないかの回帰確認。
// config.jsの自己importが効いていない場合、AA_API_BASEがundefinedになり
// フェッチ先が".../undefined/..."になる(2026-07-16の表示不具合と同型)ため、
// そのパターンのリクエストが発生していないことも合わせて検証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFirebaseStub, baArchiveOf } from "./firebase-stub.js";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenSafe } from "./listen-safe.js";
import { FAKE_GOOGLE_CREDENTIAL, useTestOwner } from "./test-owner.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/json" };
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

// btoa()はASCII専用のため、日本語などマルチバイト文字を含む名前は使わない

const BA_FIXTURE = [
  { id: "T1", threadId: "T1", by: "claude-pc", ref: null, type: "new", seq: 1, createdAt: "2026-07-14T00:00:01+00:00", title: "回帰確認用スレッド", tags: ["案件"], body: "本文" },
];

const PAGES = {
  m1: {
    routes: {},
    firebase: { "2026-07-18": { score: 80, note: "test" } }, // ab-24: スコアは Firestore(スタブ)
    async assertLoaded(page) {
      await page.waitForSelector("#scoreChartSection", { state: "visible" });
      assert.equal(await page.textContent("#statLatest"), "80");
    },
  },
  m4: {
    // ab-166(2026-10-11): 旧 ba は Firestore の写し(baArchive)から読む
    routes: {},
    firebase: {},
    firebaseOthers: baArchiveOf(BA_FIXTURE),
    // 2026-09-30: m4 は ab(Firestore abThreads)も読む(ネットワークに出さない)。
    // 2026-10-23(b1 ah-78): m4 は ba を読まなくなったので、ab を1件返す(ac にも同じものが返るが数には効かない)
    routeRegex: [[/firestore\.googleapis\.com\//, () => ({ status: 200, body: { documents: [{ name: "x/abThreads/A1", fields: {
      by: { stringValue: "claude-pc" }, createdAt: { stringValue: "2026-10-01T00:00:00+00:00" }, seq: { integerValue: "1" },
      title: { stringValue: "regression" }, noteMeta: { arrayValue: {} } } }] } })]],
    async assertLoaded(page) {
      await page.waitForFunction(() => document.querySelectorAll("#radarSvg polygon").length > 0);
    },
  },
};

for (const [pageName, spec] of Object.entries(PAGES)) {
  test(`${pageName}: クリーンな状態からログイン→config.js解決→データ表示まで壊れていない(ba-9)`, async () => {
    const server = await serveStatic();
    const port = server.address().port;
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext(); // localStorage等は常にクリーンな新規コンテキスト
      const page = await context.newPage()
      await useTestOwner(page);

      const brokenRequests = [];
      const consoleErrors = [];
      // console"error"にはscores/{today}未登録時の意図した404通知(ブラウザの
      // リソース読込ログ)も混じるため、実際のJS例外(pageerror)だけを見る。
      page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
      page.on("request", (req) => {
        if (req.url().includes("/undefined")) brokenRequests.push(req.url());
      });

      await page.route("https://accounts.google.com/gsi/client", (route) =>
        route.fulfill({ contentType: "text/javascript", body: "" })
      );
      if (spec.firebase) await routeFirebaseStub(page, spec.firebase, spec.firebaseOthers || {});
      for (const [url, handler] of Object.entries(spec.routes)) {
        await page.route(url, (route) => {
          const { status, body } = handler();
          route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        });
      }
      for (const [regex, handler] of spec.routeRegex || []) {
        await page.route(regex, (route) => {
          const { status, body } = handler();
          route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        });
      }

      await page.goto(`http://localhost:${port}/src/${pageName}/`);
      await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
      await page.waitForSelector("#content", { state: "visible" });

      await spec.assertLoaded(page);

      assert.deepEqual(brokenRequests, [], "AA_API_BASEが未解決のリクエスト(.../undefined/...)が発生している");
      assert.deepEqual(consoleErrors, [], "ページ読み込み中にconsoleエラーが発生している");
    } finally {
      await browser.close();
      server.close();
    }
  });
}
