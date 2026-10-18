// weather.js — トップに今日の天気を1行(ah-39、2026-10-19 礼文。すまの推しで気象庁)。
// 鍵の要らない気象庁の予報 JSON(大阪府)をブラウザから直接読む。サーバー・鍵・コレクションは使わない。
// 天気と降水確率は大阪府の区域、気温は大阪の地点(東大阪に一番近い気象庁の地点)。
// ログインしたときだけ呼ぶ(公開ページで住んでいる地域が分からないように)。取れなければ1行だけ出し、ほかは止めない。
export const JMA_URL = "https://www.jma.go.jp/bosai/forecast/data/forecast/270000.json";

const day = (t) => String(t).slice(0, 10);
const hour = (t) => String(t).slice(11, 13);

// 日本時間の今日(YYYY-MM-DD)。気象庁の時刻は +09:00 付きなので先頭10字と比べる
export const jstToday = (now = Date.now()) => new Date(now + 9 * 3600000).toISOString().slice(0, 10);

// 気象庁の forecast JSON から今日の分を抜く。天気が無ければ投げる(=取れなかった扱い)
export function parseJma(data, today) {
  const ts = (data && data[0] && data[0].timeSeries) || [];
  const out = { area: "", weather: "", pops: [], max: null, min: null };

  const w = ts[0];
  const wi = w ? w.timeDefines.findIndex((t) => day(t) === today) : -1;
  if (wi < 0) throw new Error("今日の天気がない");
  out.area = w.areas[0].area.name;
  out.weather = String(w.areas[0].weathers[wi] || "").replace(/　+/g, " ").trim();
  if (!out.weather) throw new Error("今日の天気がない");

  const p = ts[1];
  if (p) {
    p.timeDefines.forEach((t, i) => {
      const v = p.areas[0].pops[i];
      if (day(t) === today && v !== "" && v != null) out.pops.push({ hour: hour(t), pop: Number(v) });
    });
  }

  // 気温: 今日の 00時 の欄が最低、09時 の欄が最高。朝・昼の発表では最低の欄に最高と同じ値が入るので、そのときは最低を出さない
  const tp = ts[2];
  if (tp) {
    tp.timeDefines.forEach((t, i) => {
      const v = tp.areas[0].temps[i];
      if (day(t) !== today || v === "" || v == null) return;
      if (hour(t) === "09") out.max = Number(v);
      else if (hour(t) === "00") out.min = Number(v);
    });
    if (out.min != null && out.max != null && out.min === out.max) out.min = null;
  }
  // 最低が無ければ週間予報の今日の欄も見る(多くは空)
  const wk = data[1] && data[1].timeSeries && data[1].timeSeries[1];
  if (out.min == null && wk) {
    const i = wk.timeDefines.findIndex((t) => day(t) === today);
    const v = i >= 0 ? wk.areas[0].tempsMin[i] : "";
    if (v !== "" && v != null) out.min = Number(v);
  }
  return out;
}

export function formatWeather(f) {
  const temp = (v) => (v == null ? "—" : `${v}℃`);
  const pops = f.pops.length ? "  降水確率 " + f.pops.map((p) => `${p.hour}時 ${p.pop}%`).join(" ") : "";
  return `今日の天気(東大阪・気象庁の${f.area}の予報): ${f.weather}  最高 ${temp(f.max)} 最低 ${temp(f.min)}${pops}`;
}

export async function showWeather(el, fetchFn = (u) => fetch(u), now = Date.now()) {
  let text;
  try {
    const res = await fetchFn(JMA_URL);
    if (!res.ok) throw new Error(String(res.status));
    text = formatWeather(parseJma(await res.json(), jstToday(now)));
  } catch (e) {
    text = "天気を取れませんでした";
  }
  el.textContent = text;
  el.hidden = false;
}
