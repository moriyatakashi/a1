// trips.js — 日々記録の1日3回の記録(b1 ah-51)。画面に触らない計算だけ置く(trips.test.mjs で確かめる)。
// scores/{日付}.trips = { home: {at, ...}, station: {...}, office: {at, kind: "出社"|"帰社前", ...} }(欄を足すだけ)

// 記録のつけどき。3つ目は押すときに「出社 / 帰社前」を選ぶ(ah-51 仮決め Q1)
export const SLOTS = [
  { id: "home", label: "家出る前" },
  { id: "station", label: "行きの駅" },
  { id: "office", label: "出社 / 帰社前", kinds: ["出社", "帰社前"] },
];
