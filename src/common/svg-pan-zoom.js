// SVG の地図を 2 本指で拡大・ドラッグで移動できるようにする(2026-10-06、m6 のやり方を共通にしたもの)。
// - 1 本指(マウスはドラッグ)で移動、2 本指でピンチ、Ctrl+ホイール(トラックパッドのピンチ)で拡大縮小
// - ＋ − 全体 のボタンを地図の右上に出す(container は position: relative にしておく)
// - ドラッグ・ピンチのあとの click は、県を選んだことにしない
// 地図の線が拡大で太らないよう、ページ側で `vector-effect: non-scaling-stroke` を付けておくとよい。
// 地図の上の 1 本指は移動になる(touch-action: none)ので、ページのスクロールは地図の外で。
//
// 使い方: const pz = panZoom(svg, { container, width: 760, height: 760 });
//         pz.setView(x, y, w)  // 左上(x, y)・幅 w の範囲を見せる(高さは縦横比から)
//         pz.reset()           // 全体に戻す
export function panZoom(svg, { container = svg.parentElement, width, height, minW = 12, onChange = () => {} } = {}) {
  const ratio = height / width;
  svg.style.touchAction = "none";
  svg.style.userSelect = "none";

  const btns = document.createElement("div");
  btns.style.cssText = "position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:4px;z-index:5";
  const mk = (label, aria) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.setAttribute("aria-label", aria);
    b.style.cssText = "min-width:34px;height:30px;font-size:0.85rem;border:1px solid var(--line);border-radius:6px;"
      + "background:var(--input-bg);color:var(--ink);cursor:pointer;opacity:.92";
    btns.appendChild(b);
    return b;
  };
  const bIn = mk("＋", "拡大"), bOut = mk("−", "縮小"), bAll = mk("全体", "全体を見る");
  bAll.hidden = true;
  container.appendChild(btns);

  const viewBox = () => svg.getAttribute("viewBox").split(/[ ,]+/).map(Number);
  function setView(x, y, w) {
    w = Math.max(minW, Math.min(width, w));
    const h = w * ratio;
    x = Math.max(-w / 2, Math.min(width - w / 2, x));
    y = Math.max(-h / 2, Math.min(height - h / 2, y));
    svg.setAttribute("viewBox", `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
    bAll.hidden = w >= width - 0.5;
    onChange(w / width);
  }
  const reset = () => setView(0, 0, width);

  // 画面の座標 → 地図(viewBox)の座標。
  function toMap(cx, cy, vb = viewBox()) {
    const r = svg.getBoundingClientRect();
    return [vb[0] + ((cx - r.left) / r.width) * vb[2], vb[1] + ((cy - r.top) / r.height) * vb[3]];
  }
  // (cx, cy) の下の地点を動かさずに k 倍の幅にする(k < 1 で拡大)。
  function zoomAt(cx, cy, k, vb = viewBox()) {
    const [px, py] = toMap(cx, cy, vb);
    const w = Math.max(minW, Math.min(width, vb[2] * k)), f = w / vb[2];
    setView(px - (px - vb[0]) * f, py - (py - vb[1]) * f, w);
  }
  function zoomCenter(k) {
    const r = svg.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, k);
  }

  svg.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return; // ふつうのホイールはページのスクロールのまま
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * 0.01));
  }, { passive: false });

  const ptrs = new Map();
  let gesture = null, dragged = false;
  function startGesture() {
    const ps = [...ptrs.values()];
    gesture = ps.length ? { ps: ps.map((p) => ({ ...p })), vb: viewBox() } : null;
  }
  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!ptrs.size) dragged = false;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId) || !gesture) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = [...ptrs.values()], [a0, b0] = gesture.ps, vb = gesture.vb;
    const r = svg.getBoundingClientRect(), s = vb[2] / r.width;
    if (now.length === 1 && a0) {
      const dx = now[0].x - a0.x, dy = now[0].y - a0.y;
      if (!dragged && Math.hypot(dx, dy) < 5) return; // 小さな揺れはタップのうち
      dragged = true;
      setView(vb[0] - dx * s, vb[1] - dy * s, vb[2]);
    } else if (now.length >= 2 && b0) {
      dragged = true;
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y);
      if (d0 < 1 || d1 < 1) return;
      // 始めの 2 本指の真ん中にあった地点が、いまの真ん中に来るように。
      const [px, py] = toMap((a0.x + b0.x) / 2, (a0.y + b0.y) / 2, vb);
      const w = Math.max(minW, Math.min(width, vb[2] * d0 / d1));
      const mx = ((now[0].x + now[1].x) / 2 - r.left) / r.width, my = ((now[0].y + now[1].y) / 2 - r.top) / r.height;
      setView(px - mx * w, py - my * w * ratio, w);
    }
  });
  const endPtr = (e) => { if (ptrs.delete(e.pointerId)) startGesture(); };
  ["pointerup", "pointercancel", "pointerleave"].forEach((t) => svg.addEventListener(t, endPtr));
  svg.addEventListener("click", (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);

  bIn.addEventListener("click", () => zoomCenter(0.6));
  bOut.addEventListener("click", () => zoomCenter(1 / 0.6));
  bAll.addEventListener("click", reset);

  return { setView, reset, zoomAt };
}
