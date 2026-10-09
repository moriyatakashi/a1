// ab-159(2026-10-10 すま): m8「ここに来た」。押すだけで、押した時刻と現在地で visits に1件保存し、
// 初めての県・市・町かどうかだけを出す。判定・加点は m2 と同じ visit-store.js(Firestore はスタブ、ネットワークに出ない)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFirebaseStub } from "./firebase-stub.js";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenSafe } from "./listen-safe.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const API_BASE = "https://ab-board-api.azurewebsites.net/api";
const FAKE_GOOGLE_CREDENTIAL = "header." + Buffer.from(JSON.stringify({ name: "Test User" })).toString("base64") + ".sig";

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

const VISITS = {
  v1: { place: "大阪市 北区", date: "2026-09-20", time: "10:00", memo: "", lat: 34.70, lng: 135.50,
        pref: "大阪府", city: "大阪市", town: "北区", autoPointGranularity: "town", createdAt: "2026-09-20T01:00:00.000Z", by: "takashi" },
};

// address: nominatim が返す住所(null なら住所が取れない)。waitBeforePress: 開いてから押すまでの時間(ms)
async function pressHere(address, { waitBeforePress = 0 } = {}) {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ timezoneId: "Asia/Tokyo", geolocation: { latitude: 34.69, longitude: 135.52 }, permissions: ["geolocation"] });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route(`${API_BASE}/**`, (route) => {
      if (route.request().url().endsWith("/session")) {
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sessionToken: "session:testid.testsig" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("https://nominatim.openstreetmap.org/**", (route) => address
      ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ address }) })
      : route.fulfill({ status: 503, body: "" }));
    await routeFirebaseStub(page, {}, { visits: VISITS });
    // 時計を止めて進められるようにする(押した時刻で記録されるかを見る)
    await page.clock.install({ time: new Date("2026-10-10T07:00:00+09:00") });

    await page.goto(`http://localhost:${server.address().port}/src/m8/`);
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForSelector("#btnHere", { state: "visible" });
    if (waitBeforePress) await page.clock.fastForward(waitBeforePress);
    await page.clock.resume();
    await page.click("#btnHere");
    await page.waitForFunction(() => /保存しました|エラー/.test(document.getElementById("hereStep").textContent + document.getElementById("hereResult").textContent));
    const result = (await page.textContent("#hereResult")).trim();
    await page.waitForTimeout(200);
    const writes = await page.evaluate(() => window.__fsOtherWrites || []);
    return { result, writes, errors };
  } finally {
    await browser.close();
    server.close();
  }
}

test("m8: 新しい市なら「初めての市」と出し、visits と加点(市=5点)を書く", async () => {
  const { result, writes, errors } = await pressHere({ state: "大阪府", city: "東大阪市", suburb: "布施" });
  const visit = writes.find((w) => w.col === "visits");
  const points = writes.filter((w) => w.col === "pointEvents");
  assert.match(result, /初めての市!/);
  assert.match(result, /東大阪市/);
  assert.equal(visit.city, "東大阪市");
  assert.equal(visit.place, "東大阪市 布施");
  assert.equal(visit.autoPointGranularity, "city");
  assert.equal(points.length, 1);
  assert.equal(points[0].points, 5);
  assert.deepEqual(errors, []);
});

test("m8: 行ったことのある町なら「来たことある」で、加点は書かない", async () => {
  const { result, writes } = await pressHere({ state: "大阪府", city: "大阪市", suburb: "北区" });
  assert.match(result, /来たことある/);
  assert.equal(writes.filter((w) => w.col === "visits").length, 1);
  assert.equal(writes.filter((w) => w.col === "pointEvents").length, 0);
});

test("m8: 時刻は開いた時刻ではなく押した時刻", async () => {
  const { writes } = await pressHere({ state: "大阪府", city: "大阪市", suburb: "北区" }, { waitBeforePress: 25 * 60 * 1000 });
  const visit = writes.find((w) => w.col === "visits");
  assert.equal(visit.date, "2026-10-10");
  assert.equal(visit.time, "07:25");
});

test("m8: 住所が取れなくても座標で保存し、判定できなかったと出す", async () => {
  const { result, writes } = await pressHere(null);
  const visit = writes.find((w) => w.col === "visits");
  assert.match(result, /判定できませんでした/);
  assert.match(visit.place, /^34\.69\d*, 135\.52\d*$/);
  assert.equal(writes.filter((w) => w.col === "pointEvents").length, 0);
});
