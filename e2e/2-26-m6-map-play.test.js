// ab-44(2026-10-03): m6 地図あそび。訪問(visits)と点数(scores)を Firestore から読み(SDK はスタブ)、
// 制覇数・県ごとの集計・スタンプ・県あてクイズが出ること、このページからは何も書かないことを確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFirebaseStub } from "./firebase-stub.js";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".geojson": "application/json",
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

const v = (place, date, pref, lat, lng) => ({ place, date, time: "10:00", pref, lat, lng, by: "takashi" });
const VISITS = {
  a: v("大阪市 北区", "2026-09-20", "大阪府", 34.70, 135.50),
  b: v("大阪市 西区", "2026-09-21", "大阪府", 34.68, 135.48),
  c: v("大津市", "2026-09-22", "滋賀県", 35.00, 135.86),
};
const SCORES = { "2026-09-20": { score: 80 }, "2026-09-21": { score: 90 }, "2026-09-22": { score: 70 } };

test("m6: 訪問と点数を読んで、制覇数・県の集計・スタンプ・クイズが出る", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // これまでの地図クイズの加点が1点(初訪問の加点は数えない)
    await routeFirebaseStub(page, SCORES, { visits: VISITS, pointEvents: {
      p1: { axis: "地図クイズ", points: 1, catalogId: "map_quiz", period: "week", by: "takashi" },
      p2: { axis: "初訪問", points: 10, catalogId: "visit_new", period: "week", by: "takashi" },
    } });
    await page.goto(`http://localhost:${server.address().port}/src/m6/`);
    await page.waitForFunction(() => document.getElementById("statPrefs").textContent === "2");
    assert.equal(await page.textContent("#statVisits"), "3");
    assert.equal(await page.textContent("#statDays"), "3");

    // 10/04(ab-107): 霧は既定で市区町村。行った県の市区町村を読み、訪問の緯度経度から 北区・西区・大津市 の3つが晴れる
    await page.waitForFunction(() => document.getElementById("statCities").textContent === "3");
    assert.equal(await page.inputValue("#fogUnit"), "city");
    assert.equal(await page.locator("#fogHoles path").count(), 3);
    assert.ok(await page.locator('#cities [data-p="京都府"]').count() === 0, "行っていない県の市区町村は読まない");
    await page.locator('#cities [data-c="27127"]').dispatchEvent("click");
    assert.match(await page.textContent("#info"), /^大阪市北区\(大阪府、市区町村 2\/\d+\) — 1回、初訪問 2026-09-20/);
    await page.locator('#cities [data-c="27128"]').dispatchEvent("click"); // 中央区は行っていない
    assert.match(await page.textContent("#info"), /大阪市中央区.*まだ行っていない/);
    await page.click("#info button"); // 県名を押すと県の詳細
    assert.match(await page.textContent("#info"), /大阪府 — 2回・2日.*市区町村 2\/\d+/);
    await page.click("#btnReveal");
    await page.waitForFunction(() => document.querySelectorAll("#fogHoles path").length === 3);
    // 同日(ab-108): 日本100名城。3つの訪問はどの城からも1km以上離れているので0。大坂城がいちばん近い(梅田あたりから約2.6km)
    assert.equal(await page.textContent("#statCastles"), "0");
    assert.equal(await page.locator("#castles circle").count(), 100);
    assert.equal(await page.locator(".castle-stamp").count(), 100);
    assert.match(await page.textContent("#castleSummary"), /^行った 0 \/ 100/);
    assert.match(await page.textContent("#castleClose"), /^あと少し: 大坂城\(約\d\.\dkmまで近づいた\)/);
    assert.match(await page.textContent("#castleNext"), /^次の名城: \S+\(最後の訪問地 大津市 から約/);
    await page.click('.castle-stamp[data-k="54"]');
    await page.waitForTimeout(800); // 地図へのなめらかなスクロールが終わるのを待つ
    assert.match(await page.textContent("#info"), /^54 大坂城\(大阪府、日本100名城\) — まだ。いちばん近づいたのは約\d\.\dkm\(大阪市 /);
    assert.equal(await page.locator("#castles circle.sel").getAttribute("data-k"), "54");
    await page.uncheck("#castlesOn");
    assert.equal(await page.locator("#castles circle").count(), 0);
    await page.check("#castlesOn");

    // 拡大・移動: ＋で幅が縮み「全体」が出る、ドラッグで動いても選んだことにはならない、「全体」で戻る
    const w0 = await page.evaluate(() => Number(document.getElementById("map").getAttribute("viewBox").split(" ")[2]));
    await page.click("#btnZoomIn");
    const vb1 = await page.evaluate(() => document.getElementById("map").getAttribute("viewBox").split(" ").map(Number));
    assert.ok(Math.abs(vb1[2] - w0 * 0.6) < 0.5, `${w0} → ${vb1[2]}`);
    assert.ok(await page.isVisible("#btnFit"));
    const infoBefore = await page.textContent("#info");
    const box = await page.locator("#map").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    const vb2 = await page.evaluate(() => document.getElementById("map").getAttribute("viewBox").split(" ").map(Number));
    assert.ok(vb2[0] < vb1[0] && vb2[1] < vb1[1], "右下へドラッグすると左上が見える");
    assert.equal(await page.textContent("#info"), infoBefore, "ドラッグは選んだことにしない");
    await page.locator('#cities [data-c="27127"]').dispatchEvent("click"); // 描き直しても寄せ直さない
    assert.deepEqual(await page.evaluate(() => document.getElementById("map").getAttribute("viewBox").split(" ").map(Number)), vb2);
    await page.click("#btnFit");
    assert.equal(await page.evaluate(() => Number(document.getElementById("map").getAttribute("viewBox").split(" ")[2])), w0);
    assert.ok(!(await page.isVisible("#btnFit")));
    // 県で に切り替えると、霧の穴は県の形になり、市区町村の線は隠れる(選んだものはこの端末に覚える)
    await page.selectOption("#fogUnit", "pref");
    assert.ok(await page.locator("#fogHoles path").count() >= 2);
    assert.equal(await page.locator("#cities").evaluate((g) => g.style.display), "none");
    assert.equal(await page.evaluate(() => localStorage.getItem("m6.fogUnit")), "pref");

    // 大阪府: 2回・2日、その日の点数の平均 85
    await page.click('#prefs [data-p="大阪府"]');
    const info = await page.textContent("#info");
    assert.match(info, /大阪府 — 2回・2日、初訪問 2026-09-20、その日の点数 平均 85\.0/);

    // スタンプは47枠、押されているのは2つ
    assert.equal(await page.locator(".stamp").count(), 47);
    assert.equal(await page.locator('.stamp circle[stroke="#c94545"]').count(), 4); // 判1つに円2つ

    // クイズ(形あて): 4択のどれかを押すと正解が緑になり、回答数が1になる
    await page.selectOption("#quizKind", "shape");
    assert.equal(await page.locator("#choices button").count(), 4);
    await page.locator("#choices button").first().click();
    assert.equal(await page.locator("#choices button.ok").count(), 1);
    assert.match(await page.textContent("#quizScore"), /^この回 [01] \/ 1/);

    // 10/03 2回目: 地方ごとの制覇・次の一県・次に晴らせる県・県の詳細
    assert.match(await page.textContent("#regions"), /近畿2\/7/);
    assert.match(await page.textContent("#nextPref"), /^次の一県: \S+\(最後の訪問地 大津市 から約\d+km/);
    assert.ok(await page.locator('#front [data-p="京都府"]').count() > 0, "京都府は次に晴らせる");
    assert.equal(await page.locator('#front [data-p="大阪府"]').count(), 0);
    await page.click('#prefs [data-p="大阪府"]');
    assert.match(await page.textContent("#info"), /近畿地方 \/ 県庁所在地 大阪市 \/ 面積 約1,900km²/);
    assert.match(await page.textContent("#info"), /となり: .*京都府/);
    await page.click("#nextPref button");
    assert.match(await page.textContent("#info"), /まだ行っていない/);
    assert.match(await page.textContent("#stamps"), /近畿 2\/7/);

    // クイズの種類: どれでも正解が1つ緑になり、答えのあとに一言が出る。1回は5問(形あての1問目と合わせて5問)
    for (const [kind, n] of [["neighbor", 4], ["area", 2], ["capital", 4], ["review", null]]) {
      await page.selectOption("#quizKind", kind);
      if (n) assert.equal(await page.locator("#choices button").count(), n, kind);
      await page.locator("#choices button").first().click();
      assert.equal(await page.locator("#choices button.ok").count(), 1, kind);
      assert.ok((await page.textContent("#quizAfter")).length > 3, kind);
    }
    assert.match(await page.textContent("#quizScore"), /^この回 \d \/ 5/);
    assert.match(await page.textContent("#quizAfter"), /5問中 \d問 正解/);
    assert.equal(await page.textContent("#btnNext"), "もう1回(5問)");
    assert.match(await page.textContent("#quizBank"), /^たまった正解 \d \/ 50\(あと\d+で1点\)・これまでの地図クイズの加点 1点$/);
    assert.equal(await page.locator("#quizSummary li").count(), 5, "回の終わりに5問の振り返り");
    assert.match(await page.textContent("#quizSummary"), /形あて: /);
    await page.click("#btnNext");
    assert.equal(await page.textContent("#quizRound"), "1 / 5問目");
    assert.equal(await page.locator("#quizSummary li").count(), 0);
    // キーボード: 1 で答え、Enter で次へ
    await page.locator("#quizPrompt").click();
    await page.keyboard.press("1");
    assert.equal(await page.locator("#choices button.ok").count(), 1);
    await page.keyboard.press("Enter");
    assert.equal(await page.textContent("#quizRound"), "2 / 5問目");

    // 歩く・霧を晴らすでエラーが出ない
    await page.click("#btnWalk");
    await page.click("#btnReveal");
    await page.waitForTimeout(300);

    assert.deepEqual(errors, []);
    const writes = await page.evaluate(() => [...(window.__fsWrites || []), ...(window.__fsOtherWrites || [])]);
    assert.deepEqual(writes, [], "正解が50たまるまでは何も書かない");

    // 正解が50たまっている状態で1回(5問)終えると、pointEvents に1点を1件書き、ためた分から50引く
    await page.evaluate(() => localStorage.setItem("m6.quizBank", "50"));
    await page.selectOption("#quizKind", "shape");
    // 回の途中から始まるので、回が終わる(ボタンが「もう1回」になる)まで答える
    for (let i = 0; i < 5; i++) {
      if (i) await page.click("#btnNext");
      await page.locator("#choices button").first().click();
      if ((await page.textContent("#btnNext")).startsWith("もう1回")) break;
    }
    await page.waitForFunction(() => (window.__fsOtherWrites || []).length === 1);
    const [pe] = await page.evaluate(() => window.__fsOtherWrites);
    assert.equal(pe.col, "pointEvents");
    assert.equal(pe.axis, "地図クイズ");
    assert.equal(pe.points, 1);
    assert.equal(pe.period, "week");
    assert.equal(pe.by, "takashi");
    await page.waitForFunction(() => /1点 加点した/.test(document.getElementById("quizAfter").textContent));
    assert.match(await page.textContent("#quizBank"), /これまでの地図クイズの加点 2点$/);
    assert.ok(Number(await page.evaluate(() => localStorage.getItem("m6.quizBank"))) <= 5);
  } finally {
    await browser.close();
    server.close();
  }
});
