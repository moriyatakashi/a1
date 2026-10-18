// トップの今日の天気(ah-39)。気象庁の JSON から今日の分を抜く・取れないときの1行を確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJma, formatWeather, showWeather, jstToday } from "./weather.js";

const T = (d, h) => `2026-10-${d}T${h}:00:00+09:00`;
const jma = (temps) => [
  {
    timeSeries: [
      { timeDefines: [T(19, "05"), T(20, "00")], areas: [{ area: { name: "大阪府", code: "270000" }, weathers: ["くもり　時々　晴れ", "晴れ"] }] },
      { timeDefines: [T(19, "06"), T(19, "12"), T(19, "18"), T(20, "00")], areas: [{ area: { name: "大阪府" }, pops: ["10", "20", "0", "10"] }] },
      { timeDefines: temps.map((x) => x[0]), areas: [{ area: { name: "大阪" }, temps: temps.map((x) => x[1]) }] },
    ],
  },
  { timeSeries: [{}, { timeDefines: [T(19, "00"), T(20, "00")], areas: [{ tempsMin: ["", "15"], tempsMax: ["", "25"] }] }] },
];

test("今日の天気・降水確率・最高最低を抜く", () => {
  const f = parseJma(jma([[T(19, "00"), "16"], [T(19, "09"), "24"], [T(20, "00"), "15"], [T(20, "09"), "25"]]), "2026-10-19");
  assert.deepEqual(f, {
    area: "大阪府", weather: "くもり 時々 晴れ", max: 24, min: 16,
    pops: [{ hour: "06", pop: 10 }, { hour: "12", pop: 20 }, { hour: "18", pop: 0 }],
  });
  assert.equal(formatWeather(f), "今日の天気(東大阪・気象庁の大阪府の予報): くもり 時々 晴れ  最高 24℃ 最低 16℃  降水確率 06時 10% 12時 20% 18時 0%");
});

test("朝の発表で最低の欄が最高と同じなら最低は出さない", () => {
  const f = parseJma(jma([[T(19, "00"), "24"], [T(19, "09"), "24"]]), "2026-10-19");
  assert.equal(f.max, 24);
  assert.equal(f.min, null);
  assert.match(formatWeather(f), /最高 24℃ 最低 —/);
});

test("今日の分が無ければ投げる", () => {
  assert.throws(() => parseJma(jma([]), "2026-10-21"));
  assert.throws(() => parseJma({}, "2026-10-19"));
});

test("日本時間の今日", () => {
  assert.equal(jstToday(Date.parse("2026-10-18T15:30:00Z")), "2026-10-19");
  assert.equal(jstToday(Date.parse("2026-10-18T14:30:00Z")), "2026-10-18");
});

test("取れないときは1行だけ出す", async () => {
  const el = { textContent: "", hidden: true };
  await showWeather(el, async () => { throw new Error("net"); });
  assert.equal(el.textContent, "天気を取れませんでした");
  assert.equal(el.hidden, false);
  await showWeather(el, async () => ({ ok: false, status: 500 }));
  assert.equal(el.textContent, "天気を取れませんでした");
});

test("取れたら天気の1行", async () => {
  const el = { textContent: "", hidden: true };
  const data = jma([[T(19, "09"), "24"]]);
  await showWeather(el, async () => ({ ok: true, json: async () => data }), Date.parse("2026-10-19T08:00:00+09:00"));
  assert.match(el.textContent, /^今日の天気\(東大阪・気象庁の大阪府の予報\): くもり 時々 晴れ  最高 24℃/);
});
