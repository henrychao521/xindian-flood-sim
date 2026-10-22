// ---- 共用計算核心：河道水位、水門堰流、堤內窪地、排水系統（各區域資料見 *_data.js）----
let SIM_HOURS = 8; const DT = 30, FRAME_EVERY = 10; // 每 5 分鐘存一格；模擬時長可由情境設定（P.simHours，歷史情境 16 小時）
const SEWER_DESIGN = 78.8; // mm/hr，台北市雨水下水道設計標準（5 年重現期暴雨）
const GRAVITY_EL = 2.5;    // 外水位低於此值時，下水道可經重力閘門自然排出（假設的出口高程）
const SEWER_STORE_MM = 20; // 管網可暫存的水量，以集水區平均水深表示（假設值）

function hydroShape(t) { // 0→1：2 h 上升、2–4 h 洪峰、之後退水
  if (t < 2) return 0.4 + 0.6 * (t / 2);
  if (t < 4) return 1;
  return Math.max(0.5, 1 - 0.5 * (t - 4) / 4);
}

// 河道流量顯示：新店溪用 m³/s；其他河段以「計畫洪峰流量的 %」表示，主流流速換算用 REGION.qDesign
function qAbs(fr) { return REGION.qDesign ? fr.Q / 100 * REGION.qDesign : fr.Q; }
function qLabel(q) { return REGION.qDesign ? `${Math.round(q)}% 計畫流量` : `${Math.round(q).toLocaleString("zh-TW")} m³/s`; }

// 設計雨型：以 T+3 h 為中心、長度＝「降雨延時」的定強度降雨，前後各 15 分鐘平滑起迄，總雨量＝峰值強度 × 延時
// （「時雨量 100 mm、延時 1 小時」就是整整一小時 100 mm/h；舊版高斯形的峰值只維持一瞬間，另加全程 15% 底雨，
//   和水利處的短延時模擬圖對照後都改掉）
function rainShape(t, hours = 2) {
  const half = hours / 2, ramp = 0.25, d = Math.abs(t - 3);
  if (d <= half - ramp) return 1;
  if (d >= half + ramp) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * (d - (half - ramp)) / (2 * ramp)));
}


// 堤內窪地：A(z) = Amax·((z−zb)/(sill−zb))^1.5，超過底檻後緩慢擴張
function basinArea(g, z) {
  if (z <= g.zb) return 0;
  const x = (z - g.zb) / (g.sill - g.zb);
  return x <= 1 ? g.amax * Math.pow(x, 1.5) : g.amax * (1 + 0.5 * (z - g.sill));
}
function buildStageTable(g) {
  const zs = [], vs = []; let v = 0, dz = 0.005;
  for (let z = g.zb; z <= g.sill + 8; z += dz) { zs.push(z); vs.push(v); v += basinArea(g, z + dz / 2) * dz; }
  return { zs, vs };
}
function levelFromVolume(tab, v) {
  if (v <= 0) return tab.zs[0];
  let lo = 0, hi = tab.vs.length - 1;
  if (v >= tab.vs[hi]) return tab.zs[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; tab.vs[m] < v ? lo = m : hi = m; }
  const f = (v - tab.vs[lo]) / (tab.vs[hi] - tab.vs[lo]);
  return tab.zs[lo] + f * (tab.zs[hi] - tab.zs[lo]);
}

// 寬頂堰（含 Villemonte 潛沒修正）；正值＝河水灌入，負值＝堤內水回流河道
function weirFlow(C, B, zUp, zDown, crest) {
  const sign = zUp >= zDown ? 1 : -1;
  const hi = Math.max(zUp, zDown), lo = Math.min(zUp, zDown);
  const h1 = hi - crest; if (h1 <= 0) return 0;
  const h2 = Math.max(0, lo - crest);
  const free = C * B * Math.pow(h1, 1.5);
  return sign * free * Math.pow(Math.max(0, 1 - Math.pow(h2 / h1, 1.5)), 0.385);
}

// 堤內窪地：萬華（華江、華中、馬場町三門共用）由實測 DEM 建立；古亭、景福用解析式
const BASINS = {};
function analyticBasin(g) {
  const tab = buildStageTable(g);
  return { zb: g.zb, tab, areaAt: z => basinArea(g, z), rainArea: g.amax * 1.3, pumps: 1 };
}
function getBasins() {
  return BASINS;
}

// 歷史情境：逐時雨量（mm/h，第 k 小時＝[k, k+1)）、河川歷線（單峰：qBase→1→退水，峰值在 tp）
function seriesRain(p, t) { const k = Math.min(p.rainSeries.length - 1, Math.max(0, Math.floor(t))); return p.rainSeries[k]; }
function seriesQ(p, t) { const b = p.qBase ?? 0.35, w = t < p.tp ? 3.5 : 5; return b + (1 - b) * Math.exp(-Math.pow((t - p.tp) / w, 2)); }
function simulate(p) {
  SIM_HOURS = p.simHours || 8;
  // p: { Qpeak, tide, tideSync, rain, sewerMM, pumpMM, avail, C, openPct, closeAt, gateOpen:{id:bool} }
  const B = getBasins(), ids = Object.keys(B);
  const vol = {}, sew = {}; ids.forEach(id => { vol[id] = 0; sew[id] = 0; });
  const frames = [];
  const tp = p.tideT !== undefined ? p.tideT : p.tideSync ? 3 : 3 + 6.21;
  const steps = SIM_HOURS * 3600 / DT;
  for (let s = 0; s <= steps; s++) {
    const t = s * DT / 3600;
    const Qk = p.Qpeak / 1000 * (p.tp !== undefined ? seriesQ(p, t) : hydroShape(t));
    const tide = p.tide * Math.cos(2 * Math.PI * (t - tp) / 12.42);
    const rainNow = p.rainSeries ? seriesRain(p, t) : p.rain * rainShape(t, p.rainHours);
    const Z = NODES.map(n => riverStage(n, Qk, tide));
    const zin = {}, net = {};
    ids.forEach(id => { const b = B[id]; zin[id] = vol[id] > 0 ? levelFromVolume(b.tab, vol[id]) : b.zb; net[id] = 0; });
    // 排水系統（集總式）：地面水經雨水下水道收水（上限 sewerMM），存入管網，再由抽水站（pumpMM × 可用率）
    // 或重力閘門（外水位低於 GRAVITY_EL 時）排出；管網滿了就收不進水，水留在地面
    const bRain = {}, bPump = {}, drainInfo = {};
    ids.forEach(id => {
      const b = B[id], A = b.rainArea, mmS = 1 / 1000 / 3600;
      const rainQ = rainNow * mmS * A, intakeCap = p.sewerMM * mmS * A;
      const gravity = Z[GATES[REGION.keyGate].node] < GRAVITY_EL;
      const drainCap = p.pumpMM * mmS * A * p.avail / 100 + (gravity ? intakeCap : 0);
      const store = SEWER_STORE_MM / 1000 * A;
      // 地面積水只能從被水淹到的那部分面積的進水口收進下水道
      const wetA = Math.min(A, b.areaAt(zin[id])), demand = Math.min(intakeCap, rainQ + Math.min(vol[id] / DT, p.sewerMM * mmS * wetA));
      const intake = Math.max(0, Math.min(demand, drainCap + (store - sew[id]) / DT));
      const out = Math.min(drainCap, sew[id] / DT + intake);
      sew[id] = Math.min(store, Math.max(0, sew[id] + (intake - out) * DT));
      bRain[id] = Math.max(0, rainQ - intake); bPump[id] = Math.max(0, intake - rainQ);
      drainInfo[id] = { fill: sew[id] / store, gravity, out };
      net[id] += rainQ - intake;
    });
    const gs = GATES.map(g => {
      const b = B[g.basin], zr = Z[g.node], zi = zin[g.basin];
      const isOpen = p.gateOpen[g.id] && (p.closeAt >= SIM_HOURS || t < p.closeAt);
      const qGate = isOpen ? weirFlow(p.C, g.width * p.openPct / 100, zr, zi, g.sill) : 0;
      const lev = NODES[g.node].levee;
      const qOver = zr > lev ? weirFlow(1.7, 150, zr, zi, lev) : 0;
      net[g.basin] += qGate + qOver;
      return { zr, zin: zi, qGate, qOver, qRain: bRain[g.basin], qPump: bPump[g.basin], isOpen, depth: Math.max(0, zi - b.zb), area: b.areaAt(zi), vol: vol[g.basin] };
    });
    if (s % FRAME_EVERY === 0) frames.push({ t, Q: Qk * 1000, tide, rain: rainNow, Z, gates: gs, drain: drainInfo.wanhua });
    ids.forEach(id => { vol[id] = Math.max(0, vol[id] + net[id] * DT); });
  }
  return frames;
}

function villageStats(zin) {
  const spreadLo = 0, spreadHi = 0.5; // 里內地面高程分布 [base, base+0.5]
  return VILLAGES.map(v => {
    const lo = v.base + spreadLo, hi = v.base + spreadHi;
    const frac = d => Math.min(1, Math.max(0, (zin - d - lo) / (hi - lo)));
    const wet = zin > lo ? (zin - (lo + Math.min(hi, zin)) / 2) : 0;
    const flooded = Math.round(v.total * v.w * 0.25 * frac(0.1));
    const affected = Math.round(v.total * v.w * (0.25 * frac(0.1) + 0.75 * frac(0.5)));
    const maxD = Math.max(0, zin - lo);
    const level = maxD >= 1.0 ? "danger" : maxD >= 0.3 ? "warn" : maxD > 0.05 ? "watch" : "ok";
    return { ...v, avgDepth: wet, maxDepth: maxD, flooded, affected, level };
  });
}

