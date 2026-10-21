// ---------------- 實測地形：內政部 2025 年 20 m DEM（臺北市分幅）----------------
// 範圍 TWD97 E 299300–302600、N 2767300–2769500；堤防依 DEM 稜線描繪，堤頂依 PDF 設計高程補正
const clamp01 = v => Math.max(0, Math.min(1, v));
const DEM = (() => {
  const raw = atob(DEM_DATA.z), mraw = atob(DEM_DATA.mask);
  const n = DEM_DATA.nx * DEM_DATA.ny, z = new Float32Array(n), mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    let v = raw.charCodeAt(2 * k) | (raw.charCodeAt(2 * k + 1) << 8); if (v > 32767) v -= 65536;
    z[k] = v / 100; mask[k] = mraw.charCodeAt(k);
  }
  return { nx: DEM_DATA.nx, ny: DEM_DATA.ny, x0: DEM_DATA.x0, y0: DEM_DATA.y0, d: DEM_DATA.d, z, mask };
})();
const DEM_GATES = Object.fromEntries(GATES.map(g => [g.id, g.name]));
const idx = (i, j) => j * DEM.nx + i;
// 每座水門的堤內入口格與最低窪處，作為積水擴散起點
DEM.entry = {};
Object.entries(DEM_DATA.gates).forEach(([id, [gi, gj]]) => {
  let best = -1, bz = 99;
  for (let a = -6; a <= 6; a++) for (let b = -6; b <= 6; b++) { // 門後若是陡坡，往外找最近、最低的堤內格
    const i = gi + a, j = gj + b; if (i < 0 || j < 0 || i >= DEM.nx || j >= DEM.ny) continue;
    const k = idx(i, j); if (DEM.mask[k] === 1 && DEM.z[k] < bz) { bz = DEM.z[k]; best = k; }
  }
  DEM.entry[id] = best;
});
DEM.low = idx(DEM_DATA.low[0], DEM_DATA.low[1]);
// 建物覆蓋率（臺北市自動化 3D 近似建物模型）→ 孔隙率：可蓄水、可通水的比例
DEM.psi = (() => { const raw = atob(BLD_DATA.cov), p = new Float32Array(raw.length); for (let k = 0; k < raw.length; k++) p[k] = Math.max(0.15, 1 - 0.85 * raw.charCodeAt(k) / 100); return p; })();
// 建物：[高度(dm), x0, y0, x1, y1, ...]，座標為相對範圍左下角的公尺數
const BUILDINGS = BLD_DATA.b.map(a => {
  const pts = []; for (let i = 1; i < a.length; i += 2) pts.push([a[i], a[i + 1]]);
  let cx = 0, cy = 0, ar = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; ar += x1 * y2 - x2 * y1; cx += x1; cy += y1; }
  cx /= pts.length; cy /= pts.length;
  const ci = Math.min(DEM.nx - 1, Math.max(0, Math.floor(cx / DEM.d))), cj = Math.min(DEM.ny - 1, Math.max(0, Math.floor(cy / DEM.d)));
  const h = a[0] / 10;
  return { pts, h, area: Math.abs(ar) / 2, floors: Math.max(1, Math.round(h / 3.3)), cell: idx(ci, cj) };
});
DEM.seeds = [DEM.low, ...Object.values(DEM.entry)];

// 每格的「溢流高程」：從水門入口或最低窪處出發、沿堤內相連低地到達該格所需的最低水位（priority-flood）
DEM.spill = (() => {
  const n = DEM.nx * DEM.ny, sp = new Float32Array(n).fill(Infinity), heap = [];
  const up = i => { while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const down = i => { for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } };
  const push = (v, k) => { heap.push([v, k]); up(heap.length - 1); };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; down(0); } return top; };
  DEM.seeds.forEach(k => { if (k >= 0 && DEM.z[k] < sp[k]) { sp[k] = DEM.z[k]; push(sp[k], k); } });
  while (heap.length) {
    const [v, k] = pop(); if (v > sp[k]) continue;
    const i = k % DEM.nx, j = (k / DEM.nx) | 0;
    const nb = [i > 0 ? k - 1 : -1, i < DEM.nx - 1 ? k + 1 : -1, j > 0 ? k - DEM.nx : -1, j < DEM.ny - 1 ? k + DEM.nx : -1];
    for (const kk of nb) if (kk >= 0 && DEM.mask[kk] === 1) { const nv = Math.max(v, DEM.z[kk]); if (nv < sp[kk]) { sp[kk] = nv; push(nv, kk); } }
  }
  return sp;
})();
function inlandWet(level) {
  const n = DEM.nx * DEM.ny, wet = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (DEM.spill[k] < level) wet[k] = 1;
  return wet;
}
// 萬華堤內水位—體積曲線（由 DEM 連通淹水計算）
(() => {
  const A = DEM.d * DEM.d, zs = [], vs = [], as = [];
  const cells = []; for (let k = 0; k < DEM.spill.length; k++) if (isFinite(DEM.spill[k])) cells.push(k);
  cells.sort((a, b) => DEM.spill[a] - DEM.spill[b]);
  const zb = DEM.spill[cells[0]];
  let c = 0, cnt = 0, sumZ = 0;
  for (let L = zb; L <= 12; L += 0.02) {
    while (c < cells.length && DEM.spill[cells[c]] < L) { const k = cells[c], p = DEM.psi[k]; cnt += p; sumZ += DEM.z[k] * p; c++; }
    zs.push(L); vs.push((cnt * L - sumZ) * A); as.push(cnt * A);
  }
  let inlandArea = 0; DEM.mask.forEach(m => { if (m === 1) inlandArea += A; });
  DEM.inlandArea = inlandArea;
  BASINS.wanhua = {
    zb, tab: { zs, vs }, rainArea: inlandArea, pumps: 5,
    areaAt: z => { if (z <= zb) return 0; const i = Math.min(as.length - 1, Math.round((z - zb) / 0.02)); return as[i]; }
  };
})();

// 堤外水位：河段節點有格點座標時取最近節點的水位，否則整段用主要水門處的水位
const NEAR_NODE = (() => {
  if (!NODES.every(n => n.cell)) return null;
  const a = new Int8Array(DEM.nx * DEM.ny);
  for (let k = 0; k < a.length; k++) {
    const i = k % DEM.nx, j = (k / DEM.nx) | 0; let b = 0, bd = 1e18;
    NODES.forEach((n, m) => { const d = (n.cell[0] - i) ** 2 + (n.cell[1] - j) ** 2; if (d < bd) { bd = d; b = m; } }); a[k] = b;
  }
  return a;
})();
function outsideStage(Z, k) { return NEAR_NODE ? Z[NEAR_NODE[k]] : Z[GATES[REGION.keyGate].node]; }
function waterLevels(fr) {
  const n = DEM.nx * DEM.ny, lvl = new Float32Array(n).fill(NaN), dep = inlandDepth(fr);
  for (let k = 0; k < n; k++) {
    if (DEM.mask[k] === 0) { const zr = outsideStage(fr.Z, k); if (DEM.z[k] < zr) lvl[k] = zr; }
    else if (DEM.mask[k] === 1 && dep[k] > 0.02) lvl[k] = DEM.z[k] + dep[k];
  }
  return lvl;
}
function floodStats(fr) {
  const out = { total: 0, c1: 0, c2: 0, c3: 0, maxD: 0 }, dep = inlandDepth(fr), A = DEM.d * DEM.d / 1e4;
  for (let k = 0; k < dep.length; k++) {
    const d = dep[k]; if (d < 0.1) continue;
    out.total += A; if (d < 0.5) out.c1 += A; else if (d < 1) out.c2 += A; else out.c3 += A;
    if (d > out.maxD) out.maxD = d;
  }
  return out;
}

const ELEV_STOPS = [[-1, [74, 107, 125]], [2, [125, 150, 118]], [3, [150, 186, 128]], [4, [200, 214, 150]], [5, [230, 214, 150]], [6, [217, 178, 124]], [8, [190, 140, 98]], [11.2, [168, 164, 160]]];
function elevRGB(z) {
  if (z <= ELEV_STOPS[0][0]) return ELEV_STOPS[0][1];
  for (let s = 1; s < ELEV_STOPS.length; s++) {
    const [z1, c1] = ELEV_STOPS[s], [z0, c0] = ELEV_STOPS[s - 1];
    if (z <= z1) { const f = (z - z0) / (z1 - z0); return c0.map((c, i) => c + (c1[i] - c) * f); }
  }
  return ELEV_STOPS[ELEV_STOPS.length - 1][1];
}
function cssColor(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function hexToRgb(h) { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map(c => c + c).join(""); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }

// ---- 等高線圖 ----
const CT = { scale: 3 };
let contourBase = null, contourWater = null, contourHover = null;
function buildContourBase() {
  const W = DEM.nx * CT.scale, H = DEM.ny * CT.scale;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), img = g.createImageData(DEM.nx, DEM.ny);
  for (let j = 0; j < DEM.ny; j++) for (let i = 0; i < DEM.nx; i++) {
    const z = DEM.z[idx(i, j)];
    const zx = DEM.z[idx(Math.min(DEM.nx - 1, i + 1), j)] - DEM.z[idx(Math.max(0, i - 1), j)];
    const zy = DEM.z[idx(i, Math.min(DEM.ny - 1, j + 1))] - DEM.z[idx(i, Math.max(0, j - 1))];
    const shade = clamp01(0.85 + (-zx + zy) * 0.12);
    const rgb = elevRGB(z), p = ((DEM.ny - 1 - j) * DEM.nx + i) * 4;
    img.data[p] = rgb[0] * shade; img.data[p + 1] = rgb[1] * shade; img.data[p + 2] = rgb[2] * shade; img.data[p + 3] = 255;
  }
  const tmp = document.createElement("canvas"); tmp.width = DEM.nx; tmp.height = DEM.ny; tmp.getContext("2d").putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false; g.drawImage(tmp, 0, 0, W, H);
  // 等高線（marching squares，0.5 m 間距；整數公尺加粗）
  const P = (i, j) => [(i + 0.5) * CT.scale, (DEM.ny - 1 - j + 0.5) * CT.scale];
  for (let L = 2.5; L <= 8.0001; L += 0.5) {
    const major = Math.abs(L - Math.round(L)) < 1e-6;
    g.beginPath(); g.strokeStyle = major ? "rgba(40,30,20,.7)" : "rgba(40,30,20,.3)"; g.lineWidth = major ? 1.1 : 0.6;
    for (let j = 0; j < DEM.ny - 1; j++) for (let i = 0; i < DEM.nx - 1; i++) {
      if (DEM.mask[idx(i, j)] === 2) continue;
      const a = DEM.z[idx(i, j)], b = DEM.z[idx(i + 1, j)], cc = DEM.z[idx(i + 1, j + 1)], d = DEM.z[idx(i, j + 1)];
      const pts = [];
      const edge = (z0, z1, p0, p1) => { if ((z0 < L) !== (z1 < L)) { const f = (L - z0) / (z1 - z0); pts.push([p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f]); } };
      const A = P(i, j), B = P(i + 1, j), C = P(i + 1, j + 1), D = P(i, j + 1);
      edge(a, b, A, B); edge(b, cc, B, C); edge(cc, d, C, D); edge(d, a, D, A);
      for (let s = 0; s + 1 < pts.length; s += 2) { g.moveTo(pts[s][0], pts[s][1]); g.lineTo(pts[s + 1][0], pts[s + 1][1]); }
    }
    g.stroke();
  }
  // 防洪牆
  g.fillStyle = "rgba(60,60,60,.9)";
  for (let j = 0; j < DEM.ny; j++) for (let i = 0; i < DEM.nx; i++) if (DEM.mask[idx(i, j)] === 2) g.fillRect(i * CT.scale, (DEM.ny - 1 - j) * CT.scale, CT.scale, CT.scale);
  contourBase = c;
}
const cellToCanvas = (i, j) => [(i + 0.5) * CT.scale, (DEM.ny - 1 - j + 0.5) * CT.scale];
function tag(g, x, y, s, align = "center") {
  g.font = "600 12px " + cssColor("--font-body"); g.textAlign = align;
  const tw = g.measureText(s).width + 10, bx = align === "left" ? x - 5 : align === "right" ? x - tw + 5 : x - tw / 2;
  g.fillStyle = "rgba(255,255,255,.88)"; g.fillRect(bx, y - 13, tw, 19); g.fillStyle = "#1a1a1a"; g.fillText(s, x, y + 1);
}
function renderContour(fr) {
  const cv = $("contour"); if (!cv) return;
  if (cv.width !== DEM.nx * CT.scale) { // 依範圍大小調整畫布
    cv.width = DEM.nx * CT.scale; cv.height = DEM.ny * CT.scale;
    const fl = $("flowLayer"); if (fl) { fl.width = cv.width; fl.height = cv.height; }
  }
  if (!contourBase) buildContourBase();
  const g = cv.getContext("2d"), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H); g.drawImage(contourBase, 0, 0);
  const lvl = waterLevels(fr);
  contourWater = lvl;
  const fl = hexToRgb(cssColor("--flood-map") || "#1b5fae");
  const wc = document.createElement("canvas"); wc.width = DEM.nx; wc.height = DEM.ny;
  const wctx = wc.getContext("2d"), wimg = wctx.createImageData(DEM.nx, DEM.ny);
  for (let j = 0; j < DEM.ny; j++) for (let i = 0; i < DEM.nx; i++) {
    const k = idx(i, j); if (isNaN(lvl[k])) continue;
    const dpt = lvl[k] - DEM.z[k], p = ((DEM.ny - 1 - j) * DEM.nx + i) * 4;
    // 堤內積水用深藍，堤外河道與高灘地用淺青色，兩者分得出來
    if (DEM.mask[k] === 1) { wimg.data[p] = fl[0]; wimg.data[p + 1] = fl[1]; wimg.data[p + 2] = fl[2]; wimg.data[p + 3] = 255 * Math.min(0.85, 0.35 + dpt / 3); }
    else { wimg.data[p] = 120; wimg.data[p + 1] = 200; wimg.data[p + 2] = 235; wimg.data[p + 3] = 150; }
  }
  wctx.putImageData(wimg, 0, 0);
  g.imageSmoothingEnabled = false; g.drawImage(wc, 0, 0, W, H);
  REGION.labels.forEach(([i, j, s]) => { const [px, py] = cellToCanvas(i, j); tag(g, px, py, s); });
  drawBuildingsOnMap(g, fr);
  drawOSMOnMap(g, waterLevels(fr));
  drawInundOverlay(g, W, H);  // 疊在道路與建物之上，官方積水格多半在街道上
  if (typeof drawSweepOverlay === "function") drawSweepOverlay(g, W, H);
  const ic = $("inundCmp"); if (ic) { ic.innerHTML = inundCompare(); ic.hidden = !ic.innerHTML; }
  (REGION.mapLabels || []).forEach(([i, j, s]) => { const [px, py] = cellToCanvas(i, j); tag(g, px, py, s); });
  const [lx, ly] = cellToCanvas(DEM_DATA.low[0], DEM_DATA.low[1]);
  g.strokeStyle = "#1a1a1a"; g.lineWidth = 2; g.beginPath(); g.arc(lx, ly, 7, 0, Math.PI * 2); g.stroke();
  tag(g, lx + 12, ly + 4, `堤內最低窪處 EL. ${fmt(BASINS.wanhua.zb)} m`, "left");
  Object.entries(DEM_DATA.gates).forEach(([id, [gi, gj]]) => {
    const [x, y] = cellToCanvas(gi, gj), failed = !!P.gateOpen[id];
    g.fillStyle = failed ? "#c0392b" : "#2c8556"; g.fillRect(x - 7, y - 7, 14, 14);
    g.strokeStyle = "#fff"; g.lineWidth = 2; g.strokeRect(x - 7, y - 7, 14, 14);
    tag(g, x + 12, y + 18, `${DEM_GATES[id]}（${failed ? "未關閉" : "已關閉"}）`, "left");
  });
  g.textAlign = "center"; g.fillStyle = "rgba(255,255,255,.88)"; g.fillRect(W - 36, 8, 26, 34); g.fillStyle = "#1a1a1a"; g.fillText("N", W - 23, 23); g.fillText("↑", W - 23, 37);
  updateContourInfo(); updateFlowStatus(); startParticles();
}
// 臺北市水利處「降雨積水模擬圖」（112 年版）疊圖：洋紅色格，顏色越深積水越深
let inundGrid = null, inundCase = null;
function inundCells(caseKey) {
  if (typeof INUND_DATA === "undefined" || !INUND_DATA.cases[caseKey]) return null;
  if (inundCase !== caseKey) { const b = atob(INUND_DATA.cases[caseKey]); inundGrid = new Uint8Array(b.length); for (let k = 0; k < b.length; k++) inundGrid[k] = b.charCodeAt(k); inundCase = caseKey; }
  return inundGrid;
}
function inundOn() { const c = $("showInund"); return !!(c && c.checked); }
function inundCaseKey() { const s = $("inundCase"); return s ? s.value : "100"; }
function drawInundOverlay(g, W, H) {
  if (!inundOn()) return;
  const grid = inundCells(inundCaseKey()); if (!grid) return;
  const oc = document.createElement("canvas"); oc.width = DEM.nx; oc.height = DEM.ny;
  const octx = oc.getContext("2d"), img = octx.createImageData(DEM.nx, DEM.ny);
  for (let j = 0; j < DEM.ny; j++) for (let i = 0; i < DEM.nx; i++) {
    const k = idx(i, j), c = grid[k]; if (!c) continue;
    const p = ((DEM.ny - 1 - j) * DEM.nx + i) * 4;
    img.data[p] = 190; img.data[p + 1] = 40; img.data[p + 2] = 150; img.data[p + 3] = Math.min(230, 90 + (c - 2) * 45);
  }
  octx.putImageData(img, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(oc, 0, 0, W, H);
}
// 目前情境、目前時刻的堤內積水（≥ 0.15 m）與官方模擬圖的比較
function inundCompare() {
  if (!inundOn()) return "";
  const grid = inundCells(inundCaseKey()); if (!grid) return "";
  if (!FLOW.result) return "二維水流計算完成後，這裡會顯示本情境與官方模擬圖的面積、命中率比較。";
  const L = FLOW.result.h.length - 1, h = FLOW.result.h[Math.min(tIdx, L)], A = DEM.d * DEM.d / 1e4;
  let off = 0, mod = 0, both = 0;
  for (let k = 0; k < h.length; k++) {
    if (DEM.mask[k] !== 1) continue;
    const o = grid[k] >= 2, m = h[k] >= 0.15;
    if (o) off++; if (m) mod++; if (o && m) both++;
  }
  const hit = off ? Math.round(both / off * 100) : 0, iou = (off + mod - both) ? (both / (off + mod - both)).toFixed(2) : "—";
  return `${hhmm(frames[tIdx].t)}：本情境堤內積水 ≥ 0.15 m <b class="num">${(mod * A).toFixed(0)}</b> 公頃；官方 ${inundCaseKey()} mm/h 圖 <b class="num">${(off * A).toFixed(0)}</b> 公頃；官方積水格中本模型也積水的比例 <b class="num">${hit}%</b>，IoU <b class="num">${iou}</b>。面積量級可比，位置重疊通常不到兩成（20 m 網格與集總式下水道抓不到街道尺度低點，山區也沒有排水溪流）。`;
}
function inundLabel(k) {
  if (!inundOn()) return "";
  const grid = inundCells(inundCaseKey()); if (!grid) return "";
  return `・水利處模擬圖（${inundCaseKey()} mm/h）：${grid[k] ? INUND_DATA.classes[grid[k]] : "無積水或 < 0.15 m"}`;
}
function updateContourInfo() {
  const box = $("contourInfo"); if (!box) return;
  if (!contourHover) { box.innerHTML = "把滑鼠移到地圖上查看實測高程與水深。等高線間距 0.5 m，粗線為整數公尺，深灰線為防洪牆。"; return; }
  const k = idx(contourHover.i, contourHover.j), z = DEM.z[k], l = contourWater && contourWater[k];
  const x = DEM.x0 + (contourHover.i + 0.5) * DEM.d, y = DEM.y0 + (contourHover.j + 0.5) * DEM.d;
  const kind = DEM.mask[k] === 2 ? "防洪牆" : DEM.mask[k] === 1 ? "堤內" : DEM.mask[k] === 3 ? "對岸（不在模擬範圍）" : "堤外";
  box.innerHTML = `TWD97 <span class="num">${Math.round(x)}, ${Math.round(y)}</span>・${kind}・地面 EL. <b class="num">${fmt(z)}</b> m・` + (l && !isNaN(l) ? `水深 <b class="num">${fmt(l - z)}</b> m` : "無積水") + inundLabel(k) + (typeof sweepLabel === "function" ? sweepLabel(k) : "");
  const pb = nearestPub(x - DEM.x0, y - DEM.y0); if (pb) box.innerHTML += `・<b>${pb.n}</b>（${pb.label}）`;
}
function bindContourHover() {
  const cv = $("contour");
  cv.addEventListener("mousemove", e => {
    const r = cv.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left) / r.width * DEM.nx), jr = Math.floor((e.clientY - r.top) / r.height * DEM.ny);
    if (i < 0 || i >= DEM.nx || jr < 0 || jr >= DEM.ny) return;
    contourHover = { i, j: DEM.ny - 1 - jr }; updateContourInfo();
  });
  cv.addEventListener("mouseleave", () => { contourHover = null; updateContourInfo(); });
}

// ---- 3D 立體 ----
const T3 = { ok: false, ex: 12 };
const CAM0 = REGION.cam;
function init3D() {
  const host = $("view3d");
  if (!window.THREE || !THREE.OrbitControls) { host.innerHTML = '<p class="hint" style="padding:16px">3D 函式庫沒有載入，請重新整理頁面。</p>'; return; }
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 3000);
    camera.position.set(...CAM0);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 4, 0); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.48; controls.minDistance = 40; controls.maxDistance = 700;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-60, 120, 40); scene.add(sun);
    const W = DEM.nx, H = DEM.ny;
    const tGeo = new THREE.PlaneGeometry(W, H, W - 1, H - 1); tGeo.rotateX(-Math.PI / 2);
    const tCol = new Float32Array(W * H * 3);
    for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
      const v = row * W + col, k = idx(col, H - 1 - row), c = DEM.mask[k] === 2 ? [110, 110, 110] : elevRGB(DEM.z[k]);
      tCol[v * 3] = c[0] / 255; tCol[v * 3 + 1] = c[1] / 255; tCol[v * 3 + 2] = c[2] / 255;
    }
    tGeo.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
    const terrain = new THREE.Mesh(tGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    scene.add(terrain);
    const wGeo = new THREE.PlaneGeometry(W, H, W - 1, H - 1); wGeo.rotateX(-Math.PI / 2);
    wGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(W * H * 3), 3));
    const water = new THREE.Mesh(wGeo, new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true, opacity: 0.82, shininess: 80, depthWrite: false }));
    scene.add(water);
    const gates = {};
    Object.keys(DEM_DATA.gates).forEach(id => { const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 2.4), new THREE.MeshLambertMaterial({ color: 0xc0392b })); scene.add(m); gates[id] = m; });
    const labels = [];
    const label = (text, i, j, zEl) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 64; const g = c.getContext("2d");
      g.font = "600 30px " + cssColor("--font-body"); const tw = g.measureText(text).width + 24;
      g.fillStyle = "rgba(255,255,255,.9)"; g.fillRect((320 - tw) / 2, 8, tw, 48); g.fillStyle = "#1a1a1a"; g.textAlign = "center"; g.fillText(text, 160, 43);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      s.scale.set(22, 4.4, 1); s.userData = { i, j, zEl }; scene.add(s); labels.push(s);
    };
    Object.entries(DEM_DATA.gates).forEach(([id, [gi, gj]]) => label(DEM_GATES[id], gi, gj, 15));
    REGION.labels.forEach(([i, j, s, z]) => label(s, i, j, z || 10)); label("堤內最低窪處", DEM_DATA.low[0], DEM_DATA.low[1], 8);
    Object.assign(T3, { ok: true, renderer, scene, camera, controls, terrain, water, gates, labels, host });
    buildBuildings3D(scene);
    T3.addLabel = label; buildOSM3D(scene);
    applyHeights();
    const resize = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); renderer.domElement.style.width = w + "px"; renderer.domElement.style.height = h + "px"; camera.aspect = w / h; camera.updateProjectionMatrix(); };
    new ResizeObserver(resize).observe(host); resize();
    init3DParticles(scene);
    const loop = ts => { controls.update(); animate3D(ts); renderer.render(scene, camera); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  } catch (err) {
    host.innerHTML = '<p class="hint" style="padding:16px">這個瀏覽器無法啟用 WebGL，所以看不到 3D 畫面；左邊的等高線圖仍然可以用。</p>';
  }
}
const toLocal = (i, j) => [i - DEM.nx / 2 + 0.5, -(j - DEM.ny / 2 + 0.5)];
// 3D 顯示用高程：15 m 以上的山丘壓縮成 1/10，避免垂直誇張後變成尖塔
function dispZ(z) { return z > 15 ? 15 + (z - 15) * 0.1 : z; }
function applyHeights() {
  if (!T3.ok) return;
  const pos = T3.terrain.geometry.attributes.position, W = DEM.nx, H = DEM.ny, s = T3.ex / DEM.d;
  for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) pos.setY(row * W + col, dispZ(DEM.z[idx(col, H - 1 - row)]) * s);
  pos.needsUpdate = true; T3.terrain.geometry.computeVertexNormals();
  T3.labels.forEach(l => { const [lx, lz] = toLocal(l.userData.i, l.userData.j); l.position.set(lx, l.userData.zEl * s, lz); });
  Object.entries(DEM_DATA.gates).forEach(([id, [gi, gj]]) => { const [x, z] = toLocal(gi, gj); T3.gates[id].position.set(x, 11.8 * s, z); });
  if (T3.bld) positionBuildings3D();
  positionOSM3D();
  T3.dirty = true;
}
function update3D(fr) { T3.dirty = true; if (T3.ok) Object.keys(T3.gates).forEach(id => T3.gates[id].material.color.set(P.gateOpen[id] ? 0xc0392b : 0x2c8556)); }
// 依連續時間 tf（以 5 分鐘為 1 格）內插水面
function waterAt(tf) {
  const n = DEM.nx * DEM.ny, i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(tf))), i1 = Math.min(frames.length - 1, i0 + 1), w = Math.min(1, tf - i0);
  const Zi = frames[i0].Z.map((z, n) => z * (1 - w) + frames[i1].Z[n] * w), zr = Zi[GATES[REGION.keyGate].node];
  const lvl = new Float32Array(n).fill(NaN);
  let hA = null, hB = null;
  if (FLOW.result) { const L = FLOW.result.h.length - 1; hA = FLOW.result.h[Math.min(i0, L)]; hB = FLOW.result.h[Math.min(i1, L)]; }
  const dep = hA ? null : inlandDepth(frames[i0]);
  for (let k = 0; k < n; k++) {
    if (DEM.mask[k] === 0) { const zo = outsideStage(Zi, k); if (DEM.z[k] < zo) lvl[k] = zo; }
    else if (DEM.mask[k] === 1) { const d = hA ? hA[k] * (1 - w) + hB[k] * w : dep[k]; if (d > 0.02) lvl[k] = DEM.z[k] + d; }
  }
  return { lvl, zr, w, i0, i1 };
}
function draw3DWater(tf) {
  const { lvl } = waterAt(tf); T3.lvl = lvl;
  const pos = T3.water.geometry.attributes.position, col = T3.water.geometry.attributes.color, W = DEM.nx, H = DEM.ny, s = T3.ex / DEM.d;
  const fl = hexToRgb(cssColor("--flood-map") || "#1b5fae"), rv = [43, 123, 181];
  for (let row = 0; row < H; row++) for (let c = 0; c < W; c++) {
    const v = row * W + c, k = idx(c, H - 1 - row), z = DEM.z[k], l = lvl[k];
    const wet = !isNaN(l);
    pos.setY(v, wet ? (dispZ(z) + l - z) * s : (dispZ(z) - 0.4) * s);
    const base = DEM.mask[k] === 1 ? fl : rv, dpt = wet ? l - z : 0, f = 1 - Math.min(0.55, dpt / 4);
    col.setXYZ(v, base[0] / 255 * f, base[1] / 255 * f, base[2] / 255 * f);
  }
  pos.needsUpdate = true; col.needsUpdate = true;
  colorBuildings3D(lvl); colorOSM3D(lvl);
}

// ---- 建物 ----
const BLD_CLASS = [
  { min: 1.0, label: "≥ 1 m", rgb: [214, 69, 65] },
  { min: 0.5, label: "0.5–1 m", rgb: [242, 153, 74] },
  { min: 0.1, label: "0.1–0.5 m", rgb: [242, 201, 76] }
];
const BLD_DRY = [222, 216, 206];
function bldClass(d) { for (let c = 0; c < BLD_CLASS.length; c++) if (d >= BLD_CLASS[c].min) return c; return -1; }
function buildingStats(fr) {
  const dep = inlandDepth(fr), cnt = [0, 0, 0], floor = [0, 0, 0];
  BUILDINGS.forEach(b => { if (DEM.mask[b.cell] !== 1) return; const c = bldClass(dep[b.cell]); if (c >= 0) { cnt[c]++; floor[c] += b.area * b.floors; } });
  return { cnt, floor, total: cnt[0] + cnt[1] + cnt[2], all: BUILDINGS.length };
}
function drawBuildingsOnMap(g, fr) {
  const dep = inlandDepth(fr), sc = CT.scale / DEM.d, H = DEM.ny * CT.scale;
  g.lineWidth = 0.5; g.strokeStyle = "rgba(40,40,40,.55)";
  BUILDINGS.forEach(b => {
    const c = DEM.mask[b.cell] === 1 ? bldClass(dep[b.cell]) : -1, rgb = c >= 0 ? BLD_CLASS[c].rgb : BLD_DRY;
    g.beginPath(); b.pts.forEach(([x, y], i) => { const X = x * sc, Y = H - y * sc; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.closePath();
    g.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${c >= 0 ? 0.95 : 0.55})`; g.fill(); g.stroke();
  });
}
const BLD_SCALE = 0.25; // 3D 中建物高度：每公尺 0.25 單位（約為實際比例的 5 倍）
function buildBuildings3D(scene) {
  let nv = 0; const tris = BUILDINGS.map(b => {
    const contour = b.pts.map(([x, y]) => new THREE.Vector2(x, y));
    let t = []; try { t = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { t = []; }
    b.roofTris = t; b.v0 = nv; nv += b.pts.length * 6 + t.length * 3; b.v1 = nv; return t;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(mesh); T3.bld = mesh; T3.bldClass = new Int8Array(BUILDINGS.length).fill(-2);
  positionBuildings3D();
}
function positionBuildings3D() {
  const pos = T3.bld.geometry.attributes.position.array, s = T3.ex / DEM.d;
  const L = (x, y) => [x / DEM.d - DEM.nx / 2, -(y / DEM.d - DEM.ny / 2)];
  BUILDINGS.forEach(b => {
    const base = dispZ(DEM.z[b.cell]) * s - 0.05, top = dispZ(DEM.z[b.cell]) * s + b.h * BLD_SCALE;
    let o = b.v0 * 3; const n = b.pts.length;
    const put = (x, y, h) => { const [lx, lz] = L(x, y); pos[o++] = lx; pos[o++] = h; pos[o++] = lz; };
    for (let i = 0; i < n; i++) {
      const [x1, y1] = b.pts[i], [x2, y2] = b.pts[(i + 1) % n];
      put(x1, y1, base); put(x2, y2, base); put(x2, y2, top);
      put(x1, y1, base); put(x2, y2, top); put(x1, y1, top);
    }
    b.roofTris.forEach(t => t.forEach(i => put(b.pts[i][0], b.pts[i][1], top)));
  });
  T3.bld.geometry.attributes.position.needsUpdate = true; T3.bld.geometry.computeVertexNormals();
  T3.bldClass.fill(-2);
}
function colorBuildings3D(lvl) {
  if (!T3.bld) return;
  const col = T3.bld.geometry.attributes.color.array; let changed = false;
  BUILDINGS.forEach((b, n) => {
    const l = lvl[b.cell], c = DEM.mask[b.cell] === 1 && !isNaN(l) ? bldClass(l - DEM.z[b.cell]) : -1;
    if (T3.bldClass[n] === c) return; T3.bldClass[n] = c; changed = true;
    const rgb = c >= 0 ? BLD_CLASS[c].rgb : BLD_DRY;
    for (let v = b.v0; v < b.v1; v++) { col[v * 3] = rgb[0] / 255; col[v * 3 + 1] = rgb[1] / 255; col[v * 3 + 2] = rgb[2] / 255; }
  });
  if (changed) T3.bld.geometry.attributes.color.needsUpdate = true;
}
