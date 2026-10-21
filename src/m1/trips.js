// trips.js — 日々記録の1日3回の記録(b1 ah-51)。画面に触らない計算だけ置く(trips.test.mjs で確かめる)。
// scores/{日付}.trips = { home: {at, ...}, station: {...}, office: {at, kind: "出社"|"帰社前", ...} }(欄を足すだけ)

// 記録のつけどき。3つ目は押すときに「出社 / 帰社前」を選ぶ(ah-51 仮決め Q1)
export const SLOTS = [
  { id: "home", label: "家出る前" },
  { id: "station", label: "行きの駅" },
  { id: "office", label: "出社 / 帰社前", kinds: ["出社", "帰社前"] },
];

// 位置は小数3けた(緯度で約110m、経度で約90m)に丸めて残す。家の位置がそのまま残らないように(仮決め Q4)
export const roundPos = (lat, lng) => ({ lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 });

// 押したときの位置。取れなければ null(位置なしで記録だけ残す)
export function currentPos(geo = globalThis.navigator && navigator.geolocation) {
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    geo.getCurrentPosition((p) => resolve(roundPos(p.coords.latitude, p.coords.longitude)), () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}
