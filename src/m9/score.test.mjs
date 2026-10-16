// m9 打倒あすけん の点の計算(ab-177)。表の形(foods.json)も一緒に確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mealSummary, daySummary, missingText, MEAL_BONUS, stepsText } from "./score.js";

const foods = JSON.parse(fs.readFileSync(new URL("./foods.json", import.meta.url), "utf8")).foods;
const by = (name) => foods.find((f) => f.name === name);

test("表: 名前が重ならず、点は0〜5・手間は1〜3", () => {
  assert.ok(foods.length >= 30);
  assert.equal(new Set(foods.map((f) => f.name)).size, foods.length);
  for (const f of foods) {
    assert.ok(Number.isInteger(f.point) && f.point >= 0 && f.point <= 5, f.name);
    assert.ok([1, 2, 3].includes(f.tema), f.name);
    assert.ok(f.yen >= 0 && Array.isArray(f.kinds), f.name);
  }
});

test("1食: 主食・たんぱく・野菜がそろうとボーナス、足りなければ足りないものを出す", () => {
  const full = mealSummary([by("ご飯(1膳)"), by("納豆"), by("みそ汁")]);
  assert.equal(full.bonus, MEAL_BONUS);
  assert.equal(full.total, 2 + 4 + 3 + MEAL_BONUS);
  assert.equal(full.yen, 110);
  assert.deepEqual(full.missing, []);
  assert.deepEqual(full.warns, ["塩あり"]);

  const half = mealSummary([by("カップ麺")]);
  assert.equal(half.bonus, 0);
  assert.deepEqual(half.missing, ["たんぱく", "野菜"]);
  assert.equal(missingText(half.missing), "たんぱく・野菜が足りない");
  assert.equal(mealSummary([]).bonus, 0);
});

test("1日: 空の食事は数えず、合計と1日で足りないものを出す", () => {
  const day = daySummary([[by("ご飯(1膳)"), by("納豆"), by("みそ汁")], [], [by("バナナ")]]);
  assert.equal(day.meals, 2);
  assert.equal(day.total, 2 + 4 + 3 + MEAL_BONUS + 3);
  assert.equal(day.bonusMeals, 1);
  assert.deepEqual(day.missing, ["乳"]);
});

test("今日の歩数の一言: 今日があれば今日、無ければ昨日を添える、どちらも無ければ届く時刻だけ", () => {
  assert.equal(stepsText(4321, 190), "今日の歩数 4,321歩");
  assert.equal(stepsText(0, 190), "今日の歩数 0歩");
  assert.equal(stepsText(null, 1234), "今日の歩数はまだ(毎晩 23:50 に届く) / 昨日 1,234歩");
  assert.equal(stepsText(null, null), "今日の歩数はまだ(毎晩 23:50 に届く)");
});
