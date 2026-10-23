// ---------------- 降雨情境集合（scripts/flow_torch.py 在 Colab GPU 批次計算的結果）----------------
// SWEEP_DATA：{ intensities, durations, drain[], scenarios[{drain,hours,rain,area_4h,deep_4h,maxD_4h,area_peak,deep_peak,t_peak_h,area_8h}],
//              maps:{prob_pct, prob_n, hmax_cm:{強度:…}}, official:{100:ha,130:ha} }；沒有結果時為 null
const SWEEP = { grids: {} };
function sweepAvailable() { return typeof SWEEP_DATA !== "undefined" && !!SWEEP_DATA && Array.isArray(SWEEP_DATA.scenarios); }
function sweepGrid(key) {
  if (!sweepAvailable() || !SWEEP_DATA.maps) return null;
  if (!SWEEP.grids[key]) {
    const s = key === "prob" ? SWEEP_DATA.maps.prob_pct : SWEEP_DATA.maps.hmax_cm[key.split(":")[1]]; if (!s) return null;
    const b = atob(s), u = new Uint8Array(b.length); for (let k = 0; k < b.length; k++) u[k] = b.charCodeAt(k); SWEEP.grids[key] = u;
  }
  return SWEEP.grids[key];
}
// 淹水門檻：1 h 定強度下，這一格最大水深首次 ≥ 0.15 m 的最小降雨強度（嵌入的強度由小到大；0 = 都不淹）
const THRESH_COLORS = ["#7f0000", "#d7301f", "#fc8d59", "#fdbb84", "#fee8c8"];
function sweepThreshIs() { return Object.keys(SWEEP_DATA.maps.hmax_cm).map(Number).sort((a, b) => a - b); }
function threshGrid() {
  if (!sweepAvailable() || !SWEEP_DATA.maps) return null;
  if (!SWEEP.grids.thresh) {
    const Is = sweepThreshIs(), gs = Is.map(I => sweepGrid("hmax:" + I)), u = new Uint8Array(DEM.nx * DEM.ny);
    for (let k = 0; k < u.length; k++) for (let c = 0; c < gs.length; c++) if (gs[c][k] >= 15) { u[k] = c + 1; break; }
    SWEEP.grids.thresh = u;
  }
  return SWEEP.grids.thresh;
}
// 洩洪／水門失效情境集合（RIVER_DATA）：maps.hmax_cm 依水門組合（none／g0…／all）＋ hmax_cm_none_max（最大洪水＋暴潮、水門全關）
function riverAvailable() { return typeof RIVER_DATA !== "undefined" && !!RIVER_DATA && Array.isArray(RIVER_DATA.scenarios); }
function riverGrid(name) {
  if (!riverAvailable() || !RIVER_DATA.maps) return null;
  const key = "gate:" + name;
  if (!SWEEP.grids[key]) { const s = name === "overtop" ? RIVER_DATA.maps.hmax_cm_none_max : RIVER_DATA.maps.hmax_cm[name]; if (!s) return null; const b = atob(s), u = new Uint8Array(b.length); for (let k = 0; k < b.length; k++) u[k] = b.charCodeAt(k); SWEEP.grids[key] = u; }
  return SWEEP.grids[key];
}
function riverGateLabel(name) { return name === "none" ? "水門全關（只有越堤）" : name === "all" ? "所有水門未關" : name === "overtop" ? "最大洪水＋暴潮、水門全關" : (RIVER_DATA.gateNames[+name.slice(1)] || name) + "未關"; }
function qText(Q) { return RIVER_DATA.qUnit === "%" ? `計畫洪峰 ${Q}%` : `${Q.toLocaleString("zh-TW")} m³/s`; }
function sweepLayerKey() { const s = $("sweepLayer"); if (!s || s.value === "none") return null; return s.value === "prob" ? "prob" : s.value === "thresh" ? "thresh" : s.value === "gate" ? "gate:" + $("sweepGate").value : "hmax:" + $("sweepCase").value; }
function drawSweepOverlay(g, W, H) {
  const key = sweepLayerKey(); if (!key) return;
  const grid = key === "thresh" ? threshGrid() : key.startsWith("gate:") ? riverGrid(key.slice(5)) : sweepGrid(key); if (!grid) return;
  const oc = document.createElement("canvas"); oc.width = DEM.nx; oc.height = DEM.ny;
  const octx = oc.getContext("2d"), img = octx.createImageData(DEM.nx, DEM.ny), prob = key === "prob", th = key === "thresh", tc = THRESH_COLORS.map(hexToRgb);
  for (let j = 0; j < DEM.ny; j++) for (let i = 0; i < DEM.nx; i++) {
    const k = idx(i, j), v = grid[k]; if (DEM.mask[k] !== 1 || (th ? v === 0 : prob ? v < 25 : v < 15)) continue;
    const p = ((DEM.ny - 1 - j) * DEM.nx + i) * 4;
    if (th) { const c = tc[Math.min(v, tc.length) - 1]; img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 200; } // 門檻越低（小雨就淹）越深紅
    else if (prob) { img.data[p] = 230; img.data[p + 1] = 90; img.data[p + 2] = 30; img.data[p + 3] = 40 + v * 1.6; }  // 橙紅：機率越高越濃（< 25% 不畫）
    else { img.data[p] = 90; img.data[p + 1] = 40; img.data[p + 2] = 200; img.data[p + 3] = Math.min(230, 70 + v); } // 紫：越深越濃
  }
  octx.putImageData(img, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(oc, 0, 0, W, H);
}
function sweepLabel(k) {
  if (!sweepAvailable() || !SWEEP_DATA.maps || DEM.mask[k] !== 1) return "";
  const pr = sweepGrid("prob"), hm = sweepGrid("hmax:" + ($("sweepCase") ? $("sweepCase").value : "100"));
  let s = "";
  const tg = threshGrid(); if (tg) { const Is = sweepThreshIs(); s += `・1 h 定強度淹水門檻：${tg[k] ? `<b class="num">${Is[tg[k] - 1]}</b> mm/h 就積水 ≥ 0.15 m` : `${Is[Is.length - 1]} mm/h 以內不積水`}`; }
  if (pr) s += `・情境集合淹水機率 <b class="num">${pr[k]}%</b>（${SWEEP_DATA.maps.prob_n} 個情境中最大水深 ≥ 0.15 m 的比例）`;
  const gsel = $("sweepGate"), rg = gsel && gsel.value ? riverGrid(gsel.value) : null;
  if (rg) s += `・${riverGateLabel(gsel.value)}（${gsel.value === "overtop" ? qText(RIVER_DATA.Qpeaks[RIVER_DATA.Qpeaks.length - 1]) + "、潮位 2.0 m" : qText(RIVER_DATA.maps.Qpeak) + `、潮位 ${RIVER_DATA.maps.tide} m`}）最大水深 ${rg[k] >= 1 ? `<b class="num">${(rg[k] / 100).toFixed(2)}</b> m` : "—"}`;
  if (hm) s += `・${$("sweepCase").value} mm/h・1 h 最大水深 ${hm[k] >= 1 ? `<b class="num">${(hm[k] / 100).toFixed(2)}</b> m` : "< 0.01 m"}`;
  return s;
}
// 和目前頁面參數最接近的集合情境
function sweepNearest(p) {
  if (!sweepAvailable()) return null;
  const dist = d => Math.abs(d.sewerMM - p.sewerMM) / 30 + Math.abs(d.pumpMM - p.pumpMM) / 15 + Math.abs(d.avail - p.avail) / 70;
  const dr = SWEEP_DATA.drain.slice().sort((a, b) => dist(a) - dist(b))[0];
  const hr = SWEEP_DATA.durations.slice().sort((a, b) => Math.abs(a - p.rainHours) - Math.abs(b - p.rainHours))[0];
  const I = SWEEP_DATA.intensities.slice().sort((a, b) => Math.abs(a - p.rain) - Math.abs(b - p.rain))[0];
  const sc = SWEEP_DATA.scenarios.find(s => s.drain === dr.id && s.hours === hr && s.rain === I);
  return sc ? { ...sc, drainCfg: dr, exact: dr.sewerMM === p.sewerMM && dr.pumpMM === p.pumpMM && dr.avail === p.avail && hr === p.rainHours && I === p.rain } : null;
}
const DRAIN_LABEL = { design: "設計排水（下水道 78.8、抽水 60 mm/hr、可用率 100%）", pump30: "抽水站可用率 30%", sewer50: "下水道收水能力降到 50 mm/hr", pump45: "抽水站舊標準 45 mm/hr" };
const DUR_COLORS = ["#2a9d8f", "#0e6a86", "#e9a23b", "#c0392b"];
function renderSweepPanel() {
  const svg = $("sweepChart"); if (!svg) return;
  if (!sweepAvailable()) return;
  const dsel = $("sweepDrain");
  if (!dsel.options.length) { SWEEP_DATA.drain.forEach(d => { const o = document.createElement("option"); o.value = d.id; o.textContent = DRAIN_LABEL[d.id] || d.id; dsel.appendChild(o); }); }
  const dr = dsel.value || SWEEP_DATA.drain[0].id, metric = $("sweepMetric").value;  // peak | t4h | deep
  const val = s => metric === "t4h" ? s.area_4h : metric === "deep" ? s.deep_peak : s.area_peak;
  const rows = SWEEP_DATA.scenarios.filter(s => s.drain === dr);
  const Is = SWEEP_DATA.intensities, Ds = SWEEP_DATA.durations;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const Wd = 600, Ht = 300, box = { l: 50, r: Wd - 14, t: 18, b: Ht - 44 };
  svg.setAttribute("viewBox", `0 0 ${Wd} ${Ht}`);
  const off = SWEEP_DATA.official || {};
  let ymax = Math.max(1, ...rows.map(val), ...(metric === "deep" ? [] : Object.values(off).map(Number)));
  const step = ymax > 2000 ? 500 : ymax > 800 ? 200 : ymax > 300 ? 100 : ymax > 120 ? 50 : ymax > 40 ? 20 : ymax > 12 ? 5 : 2; ymax = Math.ceil(ymax / step) * step;
  const X = I => box.l + (I - Is[0]) / (Is[Is.length - 1] - Is[0]) * (box.r - box.l), Y = v => box.b - v / ymax * (box.b - box.t);
  for (let v = 0; v <= ymax + 1e-9; v += step) { el("line", { x1: box.l, x2: box.r, y1: Y(v), y2: Y(v), class: "grid-line" }, svg); txt(svg, box.l - 6, Y(v) + 4, String(v), { "text-anchor": "end" }); }
  Is.forEach(I => { el("line", { x1: X(I), x2: X(I), y1: box.b, y2: box.b + 4, class: "axis-line" }, svg); txt(svg, X(I), box.b + 16, String(I), { "text-anchor": "middle" }); });
  el("line", { x1: box.l, x2: box.r, y1: box.b, y2: box.b, class: "axis-line" }, svg);
  txt(svg, (box.l + box.r) / 2, Ht - 6, "降雨強度 mm/h（定強度，T+3 h 為中心）", { "text-anchor": "middle" });
  txt(svg, box.l - 6, box.t - 4, metric === "deep" ? "≥ 0.5 m 尖峰公頃" : "公頃", { "text-anchor": "end" });
  Ds.forEach((hr, di) => {
    const pts = Is.map(I => { const s = rows.find(r => r.hours === hr && r.rain === I); return s ? [X(I), Y(val(s))] : null; }).filter(Boolean);
    el("path", { d: pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" "), fill: "none", stroke: DUR_COLORS[di % 4], "stroke-width": hr === 1 ? 2.6 : 1.8 }, svg);
    pts.forEach(p => el("circle", { cx: p[0], cy: p[1], r: 2.6, fill: DUR_COLORS[di % 4] }, svg));
    const last = pts[pts.length - 1]; txt(svg, last[0] - 4, last[1] - 6, `${hr} h`, { "text-anchor": "end", fill: DUR_COLORS[di % 4], "font-weight": 700 });
  });
  if (metric !== "deep") Object.entries(off).forEach(([I, ha]) => { const x = X(+I), y = Y(+ha), right = x > (box.l + box.r) / 2; el("rect", { x: x - 5, y: y - 5, width: 10, height: 10, fill: "rgb(190,40,150)", transform: `rotate(45 ${x} ${y})` }, svg); txt(svg, right ? x - 9 : x + 9, y + 4, `官方圖 ${I} mm/h：${Math.round(ha)} ha`, { fill: "rgb(190,40,150)", "text-anchor": right ? "end" : "start" }); });
  // 目前頁面的雨量
  if (P.rain >= Is[0] && P.rain <= Is[Is.length - 1]) { const x = X(P.rain); el("line", { x1: x, x2: x, y1: box.t, y2: box.b, stroke: "var(--ink)", "stroke-dasharray": "3 4" }, svg); txt(svg, x + 4, box.t + 10, `目前 ${P.rain} mm/h`, { class: "t-ink" }); }
  const near = sweepNearest(P), nowEl = $("sweepNow");
  if (near) nowEl.innerHTML = `目前頁面參數（${P.rain} mm/h・${P.rainHours} h・下水道 ${fmt(P.sewerMM, 1)}、抽水 ${P.pumpMM} mm/hr、可用率 ${P.avail}%）${near.exact ? "就是" : "最接近"}集合中的「${near.rain} mm/h・${near.hours} h・${DRAIN_LABEL[near.drain].split("（")[0]}」：尖峰淹水 <b class="num">${near.area_peak.toFixed(0)}</b> 公頃（T+${near.t_peak_h.toFixed(1)} h）・4 小時 <b class="num">${near.area_4h.toFixed(0)}</b> 公頃・水深 ≥ 0.5 m 尖峰 <b class="num">${near.deep_peak.toFixed(0)}</b> 公頃・最深 <b class="num">${near.maxD_4h.toFixed(2)}</b> m。`;
  else nowEl.textContent = "";
  const meta = $("sweepMeta"); if (meta) meta.textContent = `${SWEEP_DATA.scenarios.length} 個情境・${SWEEP_DATA.device === "cuda" ? "Colab GPU" : SWEEP_DATA.device}・${SWEEP_DATA.steps.toLocaleString("zh-TW")} 步・${SWEEP_DATA.seconds} 秒`;
}
const GATE_COLORS = ["#0e6a86", "#c0392b", "#e9a23b", "#2a9d8f", "#7b4fa0", "#8a6d3b", "#d64d8a", "#3b82f6", "#5c8d3a", "#444"];
function riverNearest(p) {
  if (!riverAvailable()) return null;
  const Q = RIVER_DATA.Qpeaks.slice().sort((a, b) => Math.abs(a - p.Qpeak) - Math.abs(b - p.Qpeak))[0];
  const td = RIVER_DATA.tides.slice().sort((a, b) => Math.abs(a - p.tide) - Math.abs(b - p.tide))[0];
  const open = GATES.map((g, i) => p.gateOpen[g.id] ? i : -1).filter(i => i >= 0);
  const name = open.length === 0 ? "none" : open.length === GATES.length ? "all" : open.length === 1 ? "g" + open[0] : null;
  if (!name) return { partial: true, open };
  const sc = RIVER_DATA.scenarios.find(s => s.Qpeak === Q && s.tide === td && s.gates === name);
  return sc ? { ...sc, exact: Q === p.Qpeak && td === p.tide && p.rain === RIVER_DATA.rain } : null;
}
function renderRiverPanel() {
  const svg = $("riverChart"); if (!svg) return;
  const box0 = $("riverBox"); if (!riverAvailable()) { if (box0) box0.hidden = true; return; }
  box0.hidden = false;
  const tsel = $("riverTide");
  if (!tsel.options.length) RIVER_DATA.tides.forEach(td => { const o = document.createElement("option"); o.value = td; o.textContent = `潮位 ${td.toFixed(1)} m`; if (td === 1.6) o.selected = true; tsel.appendChild(o); });
  const td = +tsel.value, metric = $("riverMetric").value, val = s => metric === "t4h" ? s.area_4h : metric === "deep" ? s.deep_peak : s.area_peak;
  const rows = RIVER_DATA.scenarios.filter(s => s.tide === td), Qs = RIVER_DATA.Qpeaks, names = ["none", ...RIVER_DATA.gateNames.map((_, i) => "g" + i), "all"];
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const Wd = 600, Ht = 320, box = { l: 50, r: Wd - 14, t: 18, b: Ht - 44 };
  svg.setAttribute("viewBox", `0 0 ${Wd} ${Ht}`);
  let ymax = Math.max(1, ...rows.map(val));
  const step = ymax > 2000 ? 500 : ymax > 800 ? 200 : ymax > 300 ? 100 : ymax > 120 ? 50 : ymax > 40 ? 20 : ymax > 12 ? 5 : 2; ymax = Math.ceil(ymax / step) * step;
  const X = Q => box.l + (Q - Qs[0]) / (Qs[Qs.length - 1] - Qs[0]) * (box.r - box.l), Y = v => box.b - v / ymax * (box.b - box.t);
  for (let v = 0; v <= ymax + 1e-9; v += step) { el("line", { x1: box.l, x2: box.r, y1: Y(v), y2: Y(v), class: "grid-line" }, svg); txt(svg, box.l - 6, Y(v) + 4, String(v), { "text-anchor": "end" }); }
  Qs.forEach(Q => { el("line", { x1: X(Q), x2: X(Q), y1: box.b, y2: box.b + 4, class: "axis-line" }, svg); txt(svg, X(Q), box.b + 16, RIVER_DATA.qUnit === "%" ? Q + "%" : Q.toLocaleString("zh-TW"), { "text-anchor": "middle" }); });
  el("line", { x1: box.l, x2: box.r, y1: box.b, y2: box.b, class: "axis-line" }, svg);
  txt(svg, (box.l + box.r) / 2, Ht - 6, RIVER_DATA.qUnit === "%" ? "洪水規模（計畫洪峰流量 %）" : "上游洪峰流量 m³/s", { "text-anchor": "middle" });
  txt(svg, box.l - 6, box.t - 4, metric === "deep" ? "≥ 0.5 m 尖峰公頃" : "公頃", { "text-anchor": "end" });
  const legend = [];
  names.forEach((nm, ni) => {
    const pts = Qs.map(Q => { const s = rows.find(r => r.Qpeak === Q && r.gates === nm); return s ? [X(Q), Y(val(s))] : null; }).filter(Boolean); if (!pts.length) return;
    const col = nm === "none" ? "#666" : nm === "all" ? "#111" : GATE_COLORS[(ni - 1) % GATE_COLORS.length], key = nm === "g" + RIVER_DATA.keyGate;
    el("path", { d: pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" "), fill: "none", stroke: col, "stroke-width": key || nm === "all" ? 2.6 : 1.6, "stroke-dasharray": nm === "none" ? "4 3" : "" }, svg);
    pts.forEach(p => el("circle", { cx: p[0], cy: p[1], r: 2.4, fill: col }, svg));
    legend.push(`<span><i style="background:${col};height:3px"></i>${riverGateLabel(nm).replace("（只有越堤）", "")}</span>`);
  });
  if (P.Qpeak >= Qs[0] && P.Qpeak <= Qs[Qs.length - 1]) { const x = X(P.Qpeak); el("line", { x1: x, x2: x, y1: box.t, y2: box.b, stroke: "var(--ink)", "stroke-dasharray": "3 4" }, svg); txt(svg, x + 4, box.t + 10, `目前 ${qText(P.Qpeak)}`, { class: "t-ink" }); }
  $("riverLegend").innerHTML = legend.join("");
  const near = riverNearest(P), nowEl = $("riverNow");
  if (near && near.partial) nowEl.textContent = `目前開了 ${near.open.length} 座水門；集合只含「全關」「單一水門未關」「全部未關」三類組合。`;
  else if (near) nowEl.innerHTML = `目前頁面（${qText(P.Qpeak)}・潮位 ${fmt(P.tide, 1)} m・${riverGateLabel(near.gates)}）${near.exact ? "就是" : "最接近"}集合中的「${qText(near.Qpeak)}・潮位 ${near.tide.toFixed(1)} m」：尖峰淹水 <b class="num">${near.area_peak.toFixed(0)}</b> 公頃（T+${near.t_peak_h.toFixed(1)} h）・4 小時 <b class="num">${near.area_4h.toFixed(0)}</b> 公頃・≥ 0.5 m 尖峰 <b class="num">${near.deep_peak.toFixed(0)}</b> 公頃・8 小時灌入 <b class="num">${(near.inflow_m3.reduce((a, b) => a + b, 0) / 1e4).toFixed(0)}</b> 萬 m³。`;
  else nowEl.textContent = "";
  const meta = $("riverMeta"); if (meta) meta.textContent = `${RIVER_DATA.scenarios.length} 個情境・背景雨 ${RIVER_DATA.rain} mm/h×2 h・${RIVER_DATA.device === "cuda" ? "Colab GPU" : RIVER_DATA.device}・${RIVER_DATA.seconds} 秒`;
}
function bindSweep() {
  if (riverAvailable()) {
    const gs = $("sweepGate"); if (gs && !gs.options.length) { Object.keys(RIVER_DATA.maps.hmax_cm).forEach(nm => { const o = document.createElement("option"); o.value = nm; o.textContent = riverGateLabel(nm); if (nm === "g" + RIVER_DATA.keyGate) o.selected = true; gs.appendChild(o); }); const o = document.createElement("option"); o.value = "overtop"; o.textContent = riverGateLabel("overtop"); gs.appendChild(o); }
    const opt = $("sweepLayerGateOpt"); if (opt) opt.textContent = `水門失效包絡（${qText(RIVER_DATA.maps.Qpeak)}＋潮位 ${RIVER_DATA.maps.tide} m，選水門）`;
    ["sweepGate"].forEach(id => { const e = $(id); if (e) e.addEventListener("change", () => { if (frames.length) renderContour(frames[tIdx]); }); });
    ["riverTide", "riverMetric"].forEach(id => { const e = $(id); if (e) e.addEventListener("change", renderRiverPanel); });
  } else { const o = $("sweepLayerGateOpt"); if (o) o.remove(); const g = $("sweepGate"); if (g) g.remove(); }
  if (!sweepAvailable() && !riverAvailable()) { ["sweepPanel", "sweepCtl"].forEach(id => { const e = $(id); if (e) e.hidden = true; }); return; }
  if (!sweepAvailable()) { ["sweepBox"].forEach(id => { const e = $(id); if (e) e.hidden = true; }); ["thresh", "prob", "hmax"].forEach(v => { const o = document.querySelector(`#sweepLayer option[value="${v}"]`); if (o) o.remove(); }); const c = $("sweepCase"); if (c) c.remove(); return; }
  const lg = $("sweepThreshLegend"); if (lg) { const Is = sweepThreshIs(); lg.innerHTML = "淹水門檻：" + Is.map((I, c) => `<i style="background:${THRESH_COLORS[Math.min(c, THRESH_COLORS.length - 1)]};height:8px"></i>${I}`).join(" ") + " mm/h（1 h 定強度，最小的會淹強度）"; }
  const lab = document.querySelector('label[for="sweepLayer"]'); if (lab) lab.textContent = `疊上 GPU 情境集合（${SWEEP_DATA.scenarios.length} 個降雨情境，Colab 批次計算）`;
  const cs = $("sweepCase"); if (cs && !cs.options.length) Object.keys(SWEEP_DATA.maps.hmax_cm).forEach(I => { const o = document.createElement("option"); o.value = I; o.textContent = I + " mm/h"; if (I === "100") o.selected = true; cs.appendChild(o); });
  ["sweepLayer", "sweepCase"].forEach(id => { const e = $(id); if (e) e.addEventListener("change", () => { if (frames.length) renderContour(frames[tIdx]); }); });
  ["sweepDrain", "sweepMetric"].forEach(id => { const e = $(id); if (e) e.addEventListener("change", renderSweepPanel); });
}

// ---------------- 搶險封堵時間與兩座水門同時失效（scripts/flow_torch.py closure）----------------
function closureAvailable() { return typeof CLOSURE_DATA !== "undefined" && !!CLOSURE_DATA && Array.isArray(CLOSURE_DATA.scenarios); }
function renderClosurePanel() {
  const box0 = $("closureBox"); if (!box0) return;
  if (!closureAvailable()) { box0.hidden = true; return; }
  box0.hidden = false;
  const D = CLOSURE_DATA, Qs = [...new Set(D.scenarios.filter(s => s.kind === "close").map(s => s.Qpeak))].sort((a, b) => a - b);
  const svg = $("closureChart"); while (svg.firstChild) svg.removeChild(svg.firstChild);
  const xs = D.closes, Wd = 600, Ht = 300, box = { l: 50, r: Wd - 92, t: 18, b: Ht - 44 };
  svg.setAttribute("viewBox", `0 0 ${Wd} ${Ht}`);
  const xpos = c => { const i = xs.indexOf(c); return box.l + i / (xs.length - 1) * (box.r - box.l); };
  const series = [];
  ["key", "all"].forEach(gs => Qs.forEach((Q, qi) => series.push({ gs, Q, dash: qi > 0, pts: xs.map(c => D.scenarios.find(s => s.kind === "close" && s.gates === gs && s.Qpeak === Q && s.closeAt === c)).filter(Boolean) })));
  let ymax = Math.max(1, ...series.flatMap(s => s.pts.map(p => p.area_peak)));
  const step = ymax > 2000 ? 500 : ymax > 800 ? 200 : ymax > 300 ? 100 : ymax > 120 ? 50 : 20; ymax = Math.ceil(ymax / step) * step;
  const Y = v => box.b - v / ymax * (box.b - box.t);
  for (let v = 0; v <= ymax + 1e-9; v += step) { el("line", { x1: box.l, x2: box.r, y1: Y(v), y2: Y(v), class: "grid-line" }, svg); txt(svg, box.l - 6, Y(v) + 4, String(v), { "text-anchor": "end" }); }
  xs.forEach(c => txt(svg, xpos(c), box.b + 16, c >= 99 ? "沒封堵" : `${c} h`, { "text-anchor": "middle" }));
  el("line", { x1: box.l, x2: box.r, y1: box.b, y2: box.b, class: "axis-line" }, svg);
  txt(svg, (box.l + box.r) / 2, Ht - 6, "水門失效後多久封堵完成（從模擬開始起算）", { "text-anchor": "middle" });
  txt(svg, box.l - 6, box.t - 4, "公頃", { "text-anchor": "end" });
  const col = { key: "var(--s1, #2a78d6)", all: "var(--s2, #eb6834)" };
  series.forEach(s => {
    if (!s.pts.length) return;
    el("path", { d: s.pts.map((p, i) => (i ? "L" : "M") + xpos(p.closeAt).toFixed(1) + " " + Y(p.area_peak).toFixed(1)).join(" "), fill: "none", stroke: col[s.gs], "stroke-width": 2.2, "stroke-dasharray": s.dash ? "6 4" : "" }, svg);
    s.pts.forEach(p => el("circle", { cx: xpos(p.closeAt), cy: Y(p.area_peak), r: 3, fill: col[s.gs] }, svg));
    const last = s.pts[s.pts.length - 1], qs = RIVER_DATA && RIVER_DATA.qUnit === "%" ? `${s.Q}%` : `${(s.Q / 1000).toFixed(1)} 千 m³/s`;
    txt(svg, box.r + 6, Y(last.area_peak) + 4, `${s.gs === "key" ? "關鍵" : "全部"} ${qs}`, { "font-size": 11 });
  });
  $("closureLegend").innerHTML = `<span><i style="background:${col.key};height:3px"></i>${D.gateNames[D.keyGate]}未關</span><span><i style="background:${col.all};height:3px"></i>所有水門未關</span><span>實線 ${qText(Qs[0])}・虛線 ${qText(Qs[1] || Qs[0])}</span>`;
  // 結論句：關鍵門、洪峰 100% 時，1 小時內封堵與沒封堵的差別
  const k = c => (D.scenarios.find(s => s.kind === "close" && s.gates === "key" && s.Qpeak === Qs[0] && s.closeAt === c) || {}).area_peak;
  const never = k(99), one = k(1), two = k(2);
  $("closureNow").innerHTML = never > 0.5 ? `${D.gateNames[D.keyGate]}未關、${qText(Qs[0])}：1 小時內封堵完成尖峰淹水 <b class="num">${fmt(one, 0)}</b> 公頃、2 小時 <b class="num">${fmt(two, 0)}</b> 公頃，沒封堵 <b class="num">${fmt(never, 0)}</b> 公頃——1 小時內封堵可少淹 <b class="num">${Math.round((1 - one / never) * 100)}%</b>。` : `${D.gateNames[D.keyGate]}未關在 ${qText(Qs[0])} 時幾乎不進水（底檻高於河水位），封堵時間的影響很小。`;
  // 兩座水門同時失效：最嚴重的五組，與單獨失效比較
  const single = gi => { if (!riverAvailable()) return null; const s = RIVER_DATA.scenarios.find(x => x.Qpeak === Qs[0] && x.tide === 1.6 && x.gates === "g" + gi); return s ? s.area_peak : null; };
  const pairs = D.scenarios.filter(s => s.kind === "pair").sort((a, b) => b.area_peak - a.area_peak).slice(0, 5);
  $("pairBody").innerHTML = pairs.length ? pairs.map(p => {
    const [a, b] = p.gates, sa = single(a), sb = single(b);
    const note = sa === null || sb === null ? "—" : p.area_peak > sa + sb + 5 ? "比兩門各自失效的和還多" : p.area_peak < Math.max(sa, sb) + 5 ? "幾乎只等於較嚴重的那一座（同一片低地）" : "介於兩者之間（部分重疊）";
    return `<tr><td><b>${D.gateNames[a]}＋${D.gateNames[b]}</b></td><td class="r num">${fmt(p.area_peak, 0)}</td><td class="r num">${sa === null ? "—" : `${fmt(sa, 0)}／${fmt(sb, 0)}`}</td><td>${note}</td></tr>`;
  }).join("") : `<tr><td colspan="4" class="hint">這個河段只有一座水門。</td></tr>`;
  $("closureMeta").textContent = `${D.scenarios.length} 個情境・背景雨 ${D.rain} mm/h×2 h・潮位 ${D.tide} m・${D.device === "cuda" ? "Colab GPU" : D.device === "mps" ? "Studio GPU" : D.device}・${D.seconds} 秒`;
}
