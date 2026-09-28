// g1(NESエミュレータ)のGamePad対応(ba-52 Phase1/2)のe2e。ab-12、ba-52分解の手順6。
// 実機コントローラーは使えないので navigator.getGamepads をモックし、
// (1) 接続表示が出る (2) ボタン押下/離しが cpu.joy1 に反映される ことを確かめる。
// cpu は app.js のモジュール内変数で外から見えないため、同じURLの cpu.js を import して
// (モジュールは1つだけ読み込まれるので app.js と同じ CPU クラスになる) step を包み、動いている cpu を捕まえる。
// 割当設定の保存→再読込での復元(手順6の(2))は、すまの手順2〜5(設定UI・保存)が入ってから足す。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".nes": "application/octet-stream" };

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

// Standard Gamepad(17ボタン)のモック。window.__padPressed の添字が押されている扱い。
function mockGamepads() {
  window.__padPressed = new Set();
  const pad = {
    id: "Mock Pad (e2e)",
    index: 0,
    connected: true,
    mapping: "standard",
    axes: [0, 0, 0, 0],
    get buttons() {
      return Array.from({ length: 17 }, (_, i) => {
        const pressed = window.__padPressed.has(i);
        return { pressed, touched: pressed, value: pressed ? 1 : 0 };
      });
    },
  };
  navigator.getGamepads = () => [pad, null, null, null];
}

test("g1: モックしたGamePadの押下・離しが cpu.joy1 に反映される", async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.addInitScript(mockGamepads);

    await page.goto(`http://localhost:${port}/src/g/g1/`);
    const status = await page.textContent("#gamepadStatus");
    assert.ok(status.includes("Mock Pad (e2e)"), `接続表示にモックのidが出ていない: ${status}`);

    await page.evaluate(async () => {
      const { CPU } = await import("./cpu.js");
      const step = CPU.prototype.step;
      CPU.prototype.step = function () { window.__cpu = this; return step.call(this); };
    });
    await page.click('.rom-btn[data-rom="rom/hello_nes4.nes"]');
    await page.waitForFunction(() => window.__cpu, null, { timeout: 5000 });

    const joy1After = async (buttons) => {
      await page.evaluate((b) => { window.__padPressed = new Set(b); }, buttons);
      // pollGamepad は毎フレーム(requestAnimationFrame)呼ばれるので、数フレーム待つ
      await page.waitForTimeout(150);
      return page.evaluate(() => Array.from(window.__cpu.joy1));
    };

    // joy1の並び: 0=A 1=B 2=Select 3=Start 4=Up 5=Down 6=Left 7=Right(app.js GAMEPAD_MAP)
    assert.deepEqual(await joy1After([1]), [1, 0, 0, 0, 0, 0, 0, 0], "button1 → NES A");
    assert.deepEqual(await joy1After([0, 9, 15]), [0, 1, 0, 1, 0, 0, 0, 1], "button0/9/15 → B/Start/Right");
    assert.deepEqual(await joy1After([8, 12, 13, 14]), [0, 0, 1, 0, 1, 1, 1, 0], "button8/12/13/14 → Select/Up/Down/Left");
    assert.deepEqual(await joy1After([]), [0, 0, 0, 0, 0, 0, 0, 0], "全部離すと0に戻る");

    assert.deepEqual(pageErrors, [], `未捕捉の例外が発生した: ${pageErrors.join(", ")}`);
  } finally {
    await browser.close();
    server.close();
  }
});
