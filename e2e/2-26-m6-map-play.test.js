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
import { listenSafe } from "./listen-safe.js";

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
    listenSafe(server).then(resolve);
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
    // 県名を押すと県の詳細。上の地図と同じく dispatchEvent で押す(市区町村を描く処理が重いと、
    // page.click は押したあとの待ちで固まることがある、ab-106)
    // 10/07(ab-48): 市区町村の詳細には役所の行(リンク)も出るので、県名のボタンだけを押す
    assert.match(await page.textContent("#info"), /大阪市中央区役所: まだ/);
    await page.locator("#info button[data-p]").dispatchEvent("click");
    assert.match(await page.textContent("#info"), /大阪府 — 2回・2日.*市区町村 2\/\d+/);
    // 10/07(ab-48): 駅・役所・ドーム。北区の訪問(34.70, 135.50)は東梅田駅がいちばん近い(0.5km以内)。役所はどれも0.5kmより遠い。
    // ドームは京セラドーム大阪がいちばん近い(西区の訪問から約1.2km)
    await page.waitForFunction(() => document.getElementById("officeFog").textContent !== "");
    assert.equal(await page.textContent("#statStations"), "1");
    assert.match(await page.textContent("#stationRecent"), /^最近はじめて行った駅: 東梅田\(09-20\)$/);
    assert.equal(await page.locator("#stations circle").count(), 1);
    assert.equal(await page.locator(".station-stamp").count(), 103, "新幹線の駅");
    assert.match(await page.textContent("#officeSummary"), /^行った 0 \/ 1,916/);
    assert.match(await page.textContent("#officeFog"), /^霧が晴れた市区町村 3 のうち、役所まで行ったのは 0$/);
    assert.match(await page.textContent("#domeSummary"), /^行った 0 \/ 6/);
    assert.equal(await page.locator("#domes circle").count(), 6);
    await page.locator('.dome-stamp:has-text("京セラドーム大阪")').dispatchEvent("click");
    assert.match(await page.textContent("#info"), /^京セラドーム大阪\(大阪府、ドーム\) — まだ。いちばん近づいたのは約1\.2km\(大阪市 西区\)/);
    // 同日(ab-48): お店。イオンモールは地図に全部(どれも0.5kmより遠い)、コメダは行った店がないので0
    const shopsJson = JSON.parse(fs.readFileSync(path.join(ROOT, "src/m6/shops.json"), "utf8"));
    assert.match(await page.textContent("#aeonSummary"), new RegExp(`^イオンモール 行った 0 / ${shopsJson.aeon.length}`));
    assert.match(await page.textContent("#aeonClose"), /^あと少し: \S+\(約1\.\dkmまで近づいた\)/);
    assert.equal(await page.locator("#shops circle.aeon").count(), shopsJson.aeon.length);
    assert.equal(await page.locator(".aeon-stamp").count(), shopsJson.aeon.length);
    assert.match(await page.textContent("#komedaSummary"), /^コメダ 行った 0店/);
    assert.equal(await page.locator("#shops circle.komeda").count(), 0);
    await page.locator("#aeonClose button").first().dispatchEvent("click");
    assert.match(await page.textContent("#info"), /^イオンモール\S+\(大阪府\) — まだ。いちばん近づいたのは約1\.\dkm\(大阪市 西区\)/);
    await page.locator("#stations circle").dispatchEvent("click");
    assert.match(await page.textContent("#info"), /^東梅田駅\(大阪府、地下鉄・私鉄など\) — 行った.*谷町線/);
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
    await page.waitForFunction(() => document.getElementById("info").textContent.startsWith("54 大坂城"));
    // 押すと地図が画面のまん中へなめらかにスクロールする(scrollIntoView block:center)。スクロールの途中で
    // ドラッグすると、下の「ドラッグで動く」の確かめがずれる。決め打ちで待たず、行き先に着くまで待つ(ab-106)。
    // 行き先は「地図のまん中が画面のまん中」。ページの端で届かないときは、その端が行き先
    await page.waitForFunction(() => {
      const r = document.getElementById("map").getBoundingClientRect();
      const off = (r.top + r.height / 2) - innerHeight / 2; // +なら地図はまん中より下
      const maxY = document.scrollingElement.scrollHeight - innerHeight;
      return Math.abs(off) <= 2 || (off < 0 && scrollY <= 0) || (off > 0 && scrollY >= maxY - 1);
    });
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
    // 決め打ちで待たず、最後まで動き切るのを待つ(ab-106)。歩くは見出しに「おしまい」が付く。
    // 霧は 450ms ごとに1つずつ開くので、開いた数が 600ms 変わらなくなったら終わり
    await page.waitForFunction(() => {
      const n = document.querySelectorAll("#fogHoles path").length;
      const still = n > 0 && window.__lastHoles === n;
      window.__lastHoles = n;
      return still && document.getElementById("walkCaption").textContent.includes("おしまい");
    }, null, { polling: 600 });

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

// 同日(ab-84 の1): 願望マップ。wishes を読んで、かなった(訪問が1km以内)かを出す。
// 地図をタップして置く・名城から入れる・外す が wishes に書かれる(書くのは Takashi 本人、Rules)。
test("m6: 願望マップ(行きたい場所を置く・名城から入れる・外す)", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await routeFirebaseStub(page, SCORES, { visits: VISITS, wishes: {
      w1: { label: "梅田", lat: 34.701, lng: 135.501, pref: "大阪府", createdAt: "2026-10-01T00:00:00Z", by: "takashi" },
      w2: { label: "函館山", lat: 41.7594, lng: 140.7044, pref: "北海道", createdAt: "2026-10-02T00:00:00Z", by: "takashi" },
    } });
    await page.goto(`http://localhost:${server.address().port}/src/m6/`);
    await page.waitForFunction(() => /^行きたい 2・かなった 1/.test(document.getElementById("wishSummary").textContent));
    assert.equal(await page.locator("#wishes circle").count(), 2);
    assert.equal(await page.locator("#wishes circle.done").count(), 1);
    assert.match(await page.textContent("#wishNext"), /^いちばん近い行きたい場所: 函館山\(最後の訪問地 大津市 から約/);
    assert.deepEqual(await page.locator("#wishList button").allTextContents(), ["北海道函館山", "大阪府・かなった梅田"]);
    await page.uncheck("#wishesOn");
    assert.equal(await page.locator("#wishes circle").count(), 0);
    await page.check("#wishesOn");

    // 「＋行きたい」を押して地図をタップ → 名前を付けて置く
    await page.click("#btnWish");
    assert.equal(await page.textContent("#btnWish"), "置くのをやめる");
    await page.locator("#map").scrollIntoViewIfNeeded();
    const b = await page.locator('#prefs [data-p="奈良県"]').boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    assert.match(await page.textContent("#info"), /^ここに行きたい\(\S+、3\d\.\d{3}, 13\d\.\d{3}\)/);
    assert.equal(await page.locator("#wishes circle.pending").count(), 1);
    await page.fill("#wishLabel", "吉野山");
    await page.click("#wishSave");
    await page.waitForFunction(() => /^行きたい 3/.test(document.getElementById("wishSummary").textContent));
    const [w] = await page.evaluate(() => window.__fsOtherWrites);
    assert.equal(w.col, "wishes");
    assert.equal(w.label, "吉野山");
    assert.equal(w.pref, "奈良県");
    assert.ok(w.lat > 33.8 && w.lat < 35 && w.lng > 135.5 && w.lng < 136.3, `${w.lat}, ${w.lng}`);
    assert.equal(w.by, "takashi");
    assert.deepEqual(Object.keys(w).sort(), ["by", "col", "createdAt", "id", "label", "lat", "lng", "pref"]);
    assert.equal(await page.textContent("#btnWish"), "＋行きたい");
    assert.match(await page.textContent("#info"), /^吉野山\(奈良県、行きたい場所、\d{4}-\d{2}-\d{2}に置いた\) — まだ。/);

    // 名城から入れる(入れたあとは「入っている」になる)
    await page.click('.castle-stamp[data-k="54"]');
    await page.click('#info [data-wish-castle="54"]');
    await page.waitForFunction(() => /^行きたい 4/.test(document.getElementById("wishSummary").textContent));
    const ws = await page.evaluate(() => window.__fsOtherWrites);
    assert.equal(ws[1].label, "大坂城");
    await page.click('.castle-stamp[data-k="54"]');
    assert.match(await page.textContent("#info"), /行きたい場所に入っている/);

    // 外す
    await page.click('#wishList [data-w="w2"]');
    await page.click('#info [data-wish-del="w2"]');
    await page.waitForFunction(() => /^行きたい 3/.test(document.getElementById("wishSummary").textContent));
    assert.deepEqual(await page.evaluate(() => window.__fsDeletes), [{ col: "wishes", id: "w2" }]);
    assert.equal(await page.textContent("#info"), "「函館山」を外した。");

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});