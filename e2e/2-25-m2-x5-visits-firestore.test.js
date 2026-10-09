// ab-53(2026-10-03): 訪問(m2・a2/x5)は Firestore の visits/{id} を直接読み書きし、初訪問の加点も pointEvents/{id} へ
// 同じ batch で書く。Azure の /api/visits・/api/points には一切行かないことを確かめる(Firebase SDK はスタブ、ネットワークに出ない)。
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
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".geojson": "application/json",
};
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

// 既に大阪府・大阪市・北区に行ったことがある。
const VISITS = {
  v1: { place: "大阪市 北区", date: "2026-09-20", time: "10:00", memo: "", lat: 34.70, lng: 135.50,
        pref: "大阪府", city: "大阪市", town: "北区", autoPointGranularity: "town", createdAt: "2026-09-20T01:00:00.000Z", by: "takashi" },
};

// digest: digests/visits に置いておくまとめ(ab-97)。signedIn: 開いた時点で Firebase にログイン済みか。
async function addVisitVia(rel, address, { digest = null, signedIn = false, visits = VISITS } = {}) {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    // 「今日」は日本時間で作るので、ブラウザも日本時間にする(CI は UTC で、UTC 15〜24時は日付がずれて落ちていた、ab-153)
    const context = await browser.newContext({ timezoneId: "Asia/Tokyo", geolocation: { latitude: 34.69, longitude: 135.52 }, permissions: ["geolocation"] });
    const page = await context.newPage();
    const azureCalls = [];
    page.on("request", (req) => {
      const u = req.url();
      if (u.startsWith(`${API_BASE}/visits`) || u.startsWith(`${API_BASE}/points`)) azureCalls.push(u);
    });
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route(`${API_BASE}/**`, (route) => {
      if (route.request().url().endsWith("/session")) {
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sessionToken: "session:testid.testsig" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("https://nominatim.openstreetmap.org/**", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ address }) }));
    await routeFirebaseStub(page, {}, { visits, ...(digest ? { digests: { visits: digest } } : {}) });
    if (signedIn) await page.addInitScript(() => { window.__fsSignedIn = true; });

    await page.goto(`http://localhost:${server.address().port}/src/${rel}`);
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    const n0 = Object.keys(visits).length;
    await page.waitForFunction((n) => document.getElementById("statTotal").textContent === String(n), n0);

    await page.click("#btnGps");
    await page.waitForFunction(() => document.getElementById("placeInput").value !== "");
    await page.click("#btnAddVisit");
    // m2 は「✓」を3秒で消すので、後から読むと重いときに空になる(ab-106)。待つのと同時に拾う
    const status = await (await page.waitForFunction(() => {
      const t = document.getElementById("visitInputStatus").textContent || "";
      return t.startsWith("✓") && t;
    })).jsonValue();
    const writes = await page.evaluate(() => window.__fsOtherWrites || []);
    // 保存後の描き直しが終わるまで待ってから数える(件数が1増えるのを見る)
    await page.waitForFunction((n) => document.getElementById("statTotal").textContent === String(n + 1), n0);
    const visitReads = await page.evaluate(() => (window.__fsReads || []).filter((n) => n === "visits").length);
    const digestWrites = writes.filter((w) => w.col === "digests");
    return { writes, status, azureCalls, visitReads, digestWrites };
  } finally {
    await browser.close();
    server.close();
  }
}

test("m2: 新しい町への訪問は visits と pointEvents(町=2点)を Firestore に書き、Azure には行かない", async () => {
  const { writes, status, azureCalls, visitReads } = await addVisitVia("m2/", { state: "大阪府", city: "大阪市", suburb: "中央区" });
  const visit = writes.find((w) => w.col === "visits");
  const point = writes.find((w) => w.col === "pointEvents");
  assert.equal(visit.place, "大阪市 中央区");
  assert.equal(visit.pref, "大阪府");
  assert.equal(visit.town, "中央区");
  assert.equal(visit.autoPointGranularity, "town");
  assert.equal(visit.by, "takashi");
  assert.equal(typeof visit.lat, "number");
  assert.match(visit.id, /^[0-9a-f-]{36}$/);
  assert.equal(point.points, 2);
  assert.equal(point.note, "中央区(town)");
  assert.equal(point.catalogId, "visit_new");
  assert.equal(point.visitId, visit.id);
  assert.match(status, /初町で自動加点/);
  assert.deepEqual(azureCalls, []);
  // visits の全件読みは開いたときの1回だけ。保存の判定・保存後の描き直しでは読み直さない(ab-97)
  assert.equal(visitReads, 1);
});

test("a2/x5: 新しい県なら県=10点だけ(市・町も新しくても二重加点しない)", async () => {
  const { writes, status, azureCalls, visitReads } = await addVisitVia("a2/x5/", { state: "京都府", city: "京都市", suburb: "山科区" });
  const points = writes.filter((w) => w.col === "pointEvents");
  assert.equal(points.length, 1);
  assert.equal(points[0].points, 10);
  assert.equal(points[0].note, "京都府(pref)");
  assert.match(status, /初県で自動加点/);
  assert.deepEqual(azureCalls, []);
  assert.equal(visitReads, 1);
});

test("m2: 行ったことのある県・市・町なら加点は書かない", async () => {
  const { writes, status } = await addVisitVia("m2/", { state: "大阪府", city: "大阪市", suburb: "北区" });
  assert.equal(writes.filter((w) => w.col === "visits").length, 1);
  assert.equal(writes.filter((w) => w.col === "pointEvents").length, 0);
  assert.equal(status, "✓ 追加しました");
});

// ab-153: 今日すでに2か所(約11km離れた2点)回っていて、3か所目を足すと合計10km以上 → 1点(visit_round)が付く。訪問には印を書かない(Rules)
test("m2: 今日3か所目で合計10km以上回っていたら1点(何度も行く場所でも、ab-153)", async () => {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const visits = {
    ...VISITS,
    t1: { ...VISITS.v1, date: today, time: "00:00", lat: 34.80, createdAt: `${today}T00:00:00.000Z` },
    t2: { ...VISITS.v1, date: today, time: "00:01", lat: 34.70, createdAt: `${today}T00:01:00.000Z` },
  };
  const { writes, status } = await addVisitVia("m2/", { state: "大阪府", city: "大阪市", suburb: "北区" }, { visits });
  const visit = writes.find((w) => w.col === "visits");
  const points = writes.filter((w) => w.col === "pointEvents");
  assert.equal(points.length, 1, "行ったことのある町なので初訪問の点は無く、回った分の1点だけ");
  assert.equal(points[0].points, 1);
  assert.equal(points[0].catalogId, "visit_round");
  assert.match(points[0].note, new RegExp(`^${today} 3か所・約1\\dkm・約\\d+km²$`)); // 面積も付く(2026-10-09)
  assert.equal(points[0].visitId, visit.id);
  assert.equal("roundPoint" in visit, false, "visits に書ける欄は Rules で決まっているので足さない");
  assert.match(status, /今日あちこち回ったので1点/);
});

// ab-97: まとめ文書(digests/visits)が visits の件数と合っていれば、visits は全件読まない
test("m2: まとめ文書が合っていれば visits を全件読まず、保存でまとめに1件足す", async () => {
  const digest = { items: [{ id: "v1", ...VISITS.v1 }], count: 1, at: "2026-10-07T00:00:00.000Z" };
  const { writes, status, visitReads, digestWrites } = await addVisitVia("m2/",
    { state: "大阪府", city: "大阪市", suburb: "中央区" }, { digest });
  assert.equal(visitReads, 0);
  assert.match(status, /初町で自動加点/); // 初訪問の判定もまとめの中身で正しくできている
  const visit = writes.find((w) => w.col === "visits");
  assert.equal(digestWrites.length, 1);
  assert.deepEqual(digestWrites[0].items.values, [{ id: visit.id, ...Object.fromEntries(Object.entries(visit).filter(([k]) => k !== "col" && k !== "id")) }]);
  assert.equal(digestWrites[0].count.n, 1);
});

test("m2: まとめ文書の件数がずれていたら全件読みに戻り、ログイン中なら作り直す", async () => {
  const digest = { items: [], count: 0, at: "2026-10-01T00:00:00.000Z" }; // visits は1件あるのに0件のまとめ
  const { visitReads, digestWrites, status } = await addVisitVia("m2/",
    { state: "大阪府", city: "大阪市", suburb: "北区" }, { digest, signedIn: true });
  assert.equal(visitReads, 1);
  assert.equal(status, "✓ 追加しました"); // ずれたまとめ(0件)ではなく全件で判定したので、北区は初訪問にならない
  const rebuilt = digestWrites.find((w) => Array.isArray(w.items));
  assert.ok(rebuilt, "まとめを作り直していない");
  assert.equal(rebuilt.count, 1);
  assert.deepEqual(rebuilt.items.map((v) => v.id), ["v1"]);
});
