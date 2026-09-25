// nav.yml に載っている全ページの「開くだけ」スモークテスト(2026-09-26、ba-325 の「未カバーのアプリ」への対応)。
// 見るのは2点だけ: ローカルファイルが404にならない / スクリプトエラーが出ない。
// 画面の中身・操作は各アプリ専用のe2eの担当(この網は粗い網)。
// 外部(ab-board-api・GSI・CDN等)には出ない: APIは空配列、それ以外はabortで返す。
// 2-18-a2-paths.test.js のa2専用テストの一般化。a2の戻るリンク等の細かい検証はそちらに残す。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".json": "application/json", ".geojson": "application/json",
};

// 外部が空/abortで返る前提では、そもそもスクリプトエラーになるページを許容する場合はここに理由付きで書く。
// (増やすときは「なぜ許容か」をコメントに残す。)
const ALLOW_PAGE_ERRORS = {
  // bfはLeaflet(cdnjs)をCDNから読む。外部遮断のこのテストではLが未定義になるのが正常。
  "src/bd/bf/": "L is not defined",
};

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
    server.listen(0, () => resolve(server));
  });
}

const nav = yaml.load(fs.readFileSync(path.join(ROOT, "nav.yml"), "utf8"));
const HREFS = nav.categories.flatMap((c) => c.items.map((i) => i.href)).filter((h) => h && h.startsWith("src/"));

test("nav.ymlの全リンク先が実在する", () => {
  assert.ok(HREFS.length >= 30, `nav.ymlのsrc/リンクが少なすぎる: ${HREFS.length}`);
  for (const h of HREFS) {
    assert.ok(fs.existsSync(path.join(ROOT, h, "index.html")), `${h} に index.html が無い`);
  }
});

test("nav.ymlの全ページがローカルの404・スクリプトエラーなしで開く", async () => {
  const server = await serveStatic();
  const origin = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const problems = [];
  try {
    for (const rel of HREFS) {
      const page = await browser.newPage();
      const pageErrors = [];
      const localFailures = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      page.on("response", (r) => {
        if (r.url().startsWith(origin) && r.status() >= 400) localFailures.push(`${r.status()} ${r.url().slice(origin.length)}`);
      });
      await page.route((u) => !u.href.startsWith(origin), (route) => {
        if (route.request().url().includes("ab-board-api.azurewebsites.net")) {
          return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        return route.abort();
      });
      await page.goto(`${origin}/${rel}`);
      await page.waitForTimeout(400);
      const allowed = ALLOW_PAGE_ERRORS[rel];
      const errs = allowed ? pageErrors.filter((m) => !m.includes(allowed)) : pageErrors;
      if (localFailures.length) problems.push(`${rel}: ローカル404: ${localFailures.join(", ")}`);
      if (errs.length) problems.push(`${rel}: スクリプトエラー: ${errs.join(" | ")}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(problems, [], "開けないページがあります:\n" + problems.join("\n"));
});
