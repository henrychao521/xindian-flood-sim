// ---------------- 歷史情境：2001 年納莉颱風（scripts/nari.py 產生 NARI_DATA）----------------
// 實測逐時雨量、觀測峰值水位反推的河川歷線、紀錄中的抽水站失效；跑完後在「納莉颱風紀錄對照」比對水利署表 5 的淹水地點
const NARI = typeof NARI_DATA !== "undefined" && NARI_DATA ? NARI_DATA : null;
function nariPreset(base) {  // 主程式在本檔載入前就呼叫（同一個 script，函式會提升），所以直接讀 NARI_DATA
  const NARI = NARI_DATA;
  return { id: "nari", name: "歷史：納莉颱風（2001/9/16 19:00–9/17 11:00，實測雨量）", p: { ...JSON.parse(JSON.stringify(base)),
    Qpeak: NARI.Qpeak, tide: NARI.tide, tideSync: false, tideT: NARI.tideT, tp: NARI.tp, qBase: NARI.qBase,
    rain: Math.round(NARI.rain_max), rainHours: 1, rainSeries: NARI.rain, simHours: NARI.hours, t0: NARI.t0,
    pumpFail: NARI.pumpFail, closeAt: 99, gateOpen: {}, streams: true } };
}
// 每格 16 小時內的最大水深（二維結果）
function maxDepthField() {
  if (!FLOW.result) return null;
  if (FLOW.result._hmax) return FLOW.result._hmax;
  const n = DEM.nx * DEM.ny, m = new Float32Array(n);
  FLOW.result.h.forEach(h => { for (let k = 0; k < n; k++) if (h[k] > m[k]) m[k] = h[k]; });
  return (FLOW.result._hmax = m);
}
// 紀錄地點：道路名稱以清單中任一路名開頭的路段，取各段所在格的最大水深
function nariRecordStats() {
  const hm = maxDepthField(); if (!hm || !NARI) return null;
  return NARI.records.map(r => {
    const segs = ROAD_SEGS.filter(s => DEM.mask[s.k] === 1 && s.name && r.roads.some(nm => s.name.startsWith(nm)));
    const d = segs.map(s => hm[s.k]).sort((a, b) => a - b), km = segs.reduce((a, s) => a + s.len, 0) / 1000;
    const wetKm = segs.filter(s => hm[s.k] >= 0.3).reduce((a, s) => a + s.len, 0) / 1000;
    const [lo, hi] = r.depth.replace(/[^\d.–-]/g, "").split(/[–-]/).map(Number);
    return { ...r, n: segs.length, km, wetKm, med: d.length ? d[Math.floor(d.length / 2)] : null, p90: d.length ? d[Math.floor(d.length * 0.9)] : null, lo, hi: hi || lo };
  });
}
function nariVerdict(r) { return r.med === null ? "範圍內沒有這些路名" : r.p90 < 0.3 ? "模型幾乎沒淹" : r.med > r.hi + 1 ? "模型偏深" : r.med < r.lo * 0.5 ? "有淹、偏淺" : "量級相符"; }
function renderNari() {
  const sec = $("nariPanel"); if (!sec) return;
  if (!NARI || !P.t0) { sec.hidden = true; return; }
  sec.hidden = false;
  // 雨量柱狀圖（mm/h），虛線＝雨水下水道設計 78.8 mm/hr
  const svg = $("nariRain"); while (svg.firstChild) svg.removeChild(svg.firstChild);
  const W = 600, H = 150, box = { l: 36, r: W - 8, t: 10, b: H - 24 }, mx = Math.max(100, ...NARI.rain), bw = (box.r - box.l) / NARI.rain.length;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const Y = v => box.b - v / mx * (box.b - box.t);
  [0, 50, 100].forEach(v => { el("line", { x1: box.l, x2: box.r, y1: Y(v), y2: Y(v), class: "grid-line" }, svg); txt(svg, box.l - 5, Y(v) + 4, String(v), { "text-anchor": "end" }); });
  NARI.rain.forEach((v, k) => { const x = box.l + k * bw; el("rect", { x: x + 1, y: Y(v), width: bw - 2, height: Math.max(0, box.b - Y(v)), rx: 2, fill: v > SEWER_DESIGN ? "var(--danger)" : "var(--accent)" }, svg); if (k % 2 === 0) txt(svg, x + bw / 2, H - 8, hhmm(k).split(" ")[1], { "text-anchor": "middle" }); });
  el("line", { x1: box.l, x2: box.r, y1: Y(SEWER_DESIGN), y2: Y(SEWER_DESIGN), stroke: "var(--ink)", "stroke-dasharray": "4 3" }, svg);
  txt(svg, box.r - 2, Y(SEWER_DESIGN) - 4, `下水道設計 ${SEWER_DESIGN} mm/hr`, { "text-anchor": "end", class: "t-ink" });
  txt(svg, box.l + 2, box.t + 8, "mm/h", {});
  $("nariMeta").innerHTML = `雨量站：${NARI.stations.join("、")}（16 小時共 <b class="num">${NARI.rain_total}</b> mm，最大時雨量 <b class="num">${NARI.rain_max}</b> mm）・河道：${NARI.Qnote}，換算${REGION.qDesign ? `計畫洪峰 <b class="num">${NARI.Qpeak}%</b>` : ` <b class="num">${NARI.Qpeak.toLocaleString("zh-TW")}</b> m³/s`}` +
    (NARI.pumpFail.length ? `・抽水站失效：${NARI.pumpFail.map(f => `${f.name.replace("抽水站", "")}（${hhmm(f.at)}${f.note.includes("假設") ? "，時間未載、假設" : "，" + f.note}）`).join("、")}` : "");
  const city = typeof NARI_CITY !== "undefined" && NARI_CITY ? NARI_CITY : null;
  const cityCell = i => { const c = city && city.open.records[i]; if (!c) return "<td>—</td>"; const cls = { "量級相符": "ok", "有淹、偏淺": "watch", "模型偏深": "warn", "模型幾乎沒淹": "danger" }[c.verdict] || ""; return `<td class="r num">${c.med === null ? "—" : `${fmt(c.med)}／${fmt(c.p90)} m`}<small><span class="pill ${cls}">${c.verdict}</span></small></td>`; };
  $("nariCityNote").innerHTML = city ? `<b>全市合併計算</b>：把七個河段拼回同一張 20 m 網格、打開河段之間的邊界（GPU 版，${city.seconds} 秒），讓越堤的水能流到相鄰河段。本河段最大淹水 <b class="num">${fmt(city.open.max_env_ha, 0)}</b> 公頃（邊界封閉時 ${fmt(city.closed.max_env_ha, 0)} 公頃）${city.extra_ha > 0.5 ? `，多淹的 <b class="num">${fmt(city.extra_ha, 0)}</b> 公頃是從相鄰河段流進來的水` : city.open.max_env_ha < city.closed.max_env_ha - 5 ? "，有一部分水流到相鄰河段" : ""}。` : "";
  const st = nariRecordStats(), body = $("nariBody");
  if (!st) { body.innerHTML = `<tr><td colspan="6" class="hint">二維水流計算完成後，這裡會比對水利署報告表 5 的淹水地點。</td></tr>`; }
  else body.innerHTML = st.map((r, i) => {
    const verdict = nariVerdict(r), cls = { "量級相符": "ok", "有淹、偏淺": "watch", "模型偏深": "warn", "模型幾乎沒淹": "danger" }[verdict] || "";
    return `<tr><td><b>${r.district}</b><small>${r.where}</small></td><td class="r num">${r.depth}</td><td class="r num">${r.med === null ? "—" : `${fmt(r.med)}／${fmt(r.p90)} m`}</td><td class="r num">${r.n ? `${fmt(r.wetKm, 1)}／${fmt(r.km, 1)} km` : "—"}</td><td><span class="pill ${cls}">${verdict}</span></td>${cityCell(i)}</tr>`;
  }).join("");
  $("nariNotes").innerHTML = "<b>資料來源</b>：" + NARI.sources.join("；") + "。<b>假設</b>：" + NARI.assumptions.join("；") + "。";
}
