// ---- 模型資料（數值取自 PDF；標 * 者為本模擬器補充假設）----
const NODES = [
  { id: "huajiang",  name: "華江橋",   km: 0.0,  bed: -3.0, plain: 3.2,  levee: 10.2, a: 0.6,  k: 0.85, tf: 1.00, bend: 0,   jm: 0 },
  { id: "huazhong",  name: "華中橋",   km: 2.6,  bed: -2.0, plain: 3.5,  levee: 10.5, a: 0.9,  k: 0.90, tf: 0.85, bend: 0,   jm: 0 },
  { id: "machangding", name: "馬場町", km: 4.6,  bed: -1.5, plain: 4.8,  levee: 11.2, a: 1.49, k: 0.953, tf: 0.65, bend: 0.8, jm: 0 },
  { id: "guting",    name: "古亭",     km: 6.0,  bed: -0.5, plain: 6.0,  levee: 12.5, a: 2.2,  k: 1.00, tf: 0.50, bend: 0,   jm: 0 },
  { id: "baozang",   name: "寶藏巖",   km: 8.0,  bed: 1.5,  plain: 7.2,  levee: 13.5, a: 3.0,  k: 1.05, tf: 0.30, bend: 0,   jm: 0.3 },
  { id: "xiulang",   name: "秀朗橋",   km: 10.5, bed: 3.0,  plain: 9.0,  levee: 15.0, a: 4.8,  k: 1.10, tf: 0.15, bend: 0,   jm: 0 },
  { id: "bitan",     name: "碧潭",     km: 15.0, bed: 8.0,  plain: 14.0, levee: 19.5, a: 9.0,  k: 1.25, tf: 0.00, bend: 0,   jm: 0 }
];

// 疏散門：底檻高程與寬度來自 PDF；堤內窪地底部高程中 古亭、景福 為假設值
const GATES = [
  { id: "huajiang",    basin: "wanhua", name: "華江門",   node: 0, sill: 4.2, width: 10, zb: 2.8,  amax: 1.6e6, area: "北萬華・龍山寺／華江里", assumedZb: false },
  { id: "huazhong",    basin: "wanhua", name: "華中門",   node: 1, sill: 4.6, width: 10, zb: 3.0,  amax: 1.0e6, area: "雙園・第一果菜市場",     assumedZb: false },
  { id: "machangding", basin: "wanhua", name: "馬場町門", node: 2, sill: 5.2, width: 10, zb: 3.38, amax: 1.8e6, area: "南萬華・青年公園／加蚋仔", assumedZb: false },
  { id: "guting",      basin: "wanhua", name: "古亭門",   node: 3, sill: 6.2, width: 8,  zb: 4.6,  amax: 0.9e6, area: "古亭・同安街舊河道",     assumedZb: true },
  { id: "jingfu",      basin: "wanhua", name: "景福門",   node: 4, sill: 7.2, width: 8,  zb: 5.8,  amax: 0.6e6, area: "公館・汀州路三段",       assumedZb: true }
];

// 南萬華各里：戶數、基準高程、權重皆照抄 PDF 中 Gemini 範例程式的設定值（非官方統計）
const VILLAGES = [
  { name: "騰雲里", where: "青年公園區",      total: 2150, base: 3.82, w: 0.85 },
  { name: "凌霄里", where: "國興路走廊",      total: 2840, base: 4.05, w: 0.72 },
  { name: "榮德里", where: "萬大路 423 巷",   total: 3120, base: 3.55, w: 0.95 },
  { name: "忠貞里", where: "寶興街南段",      total: 2680, base: 3.42, w: 0.98 },
  { name: "日祥里", where: "東園街碗底",      total: 3450, base: 3.38, w: 1.00 }
];

const SIM_HOURS = 8, DT = 30, FRAME_EVERY = 10; // 每 5 分鐘存一格
const SEWER_DESIGN = 78.8; // mm/hr，台北市雨水下水道設計標準（5 年重現期暴雨）
const GRAVITY_EL = 2.5;    // 外水位低於此值時，下水道可經重力閘門自然排出（假設的出口高程）
const SEWER_STORE_MM = 20; // 管網可暫存的水量，以集水區平均水深表示（假設值）

function hydroShape(t) { // 0→1：2 h 上升、2–4 h 洪峰、之後退水
  if (t < 2) return 0.4 + 0.6 * (t / 2);
  if (t < 4) return 1;
  return Math.max(0.5, 1 - 0.5 * (t - 4) / 4);
}

function rainShape(t) { // 降雨集中在 T+2–4 h（高斯形峰值），其餘時間為峰值的 15%
  return 0.15 + 0.85 * Math.exp(-(((t - 3) / 1.0) ** 2));
}

function riverStage(node, Qk, tide) {
  const q = Math.pow(Math.max(Qk, 0), 0.85);
  return node.a + node.k * q + node.tf * tide + node.bend * (Qk / 5.5) + node.jm * (Qk / 5.5);
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

function simulate(p) {
  // p: { Qpeak, tide, tideSync, rain, sewerMM, pumpMM, avail, C, openPct, closeAt, gateOpen:{id:bool} }
  const B = getBasins(), ids = Object.keys(B);
  const vol = {}, sew = {}; ids.forEach(id => { vol[id] = 0; sew[id] = 0; });
  const frames = [];
  const tp = p.tideSync ? 3 : 3 + 6.21;
  const steps = SIM_HOURS * 3600 / DT;
  for (let s = 0; s <= steps; s++) {
    const t = s * DT / 3600;
    const Qk = p.Qpeak / 1000 * hydroShape(t);
    const tide = p.tide * Math.cos(2 * Math.PI * (t - tp) / 12.42);
    const rainNow = p.rain * rainShape(t);
    const Z = NODES.map(n => riverStage(n, Qk, tide));
    const zin = {}, net = {};
    ids.forEach(id => { const b = B[id]; zin[id] = vol[id] > 0 ? levelFromVolume(b.tab, vol[id]) : b.zb; net[id] = 0; });
    // 排水系統（集總式）：地面水經雨水下水道收水（上限 sewerMM），存入管網，再由抽水站（pumpMM × 可用率）
    // 或重力閘門（外水位低於 GRAVITY_EL 時）排出；管網滿了就收不進水，水留在地面
    const bRain = {}, bPump = {}, drainInfo = {};
    ids.forEach(id => {
      const b = B[id], A = b.rainArea, mmS = 1 / 1000 / 3600;
      const rainQ = rainNow * mmS * A, intakeCap = p.sewerMM * mmS * A;
      const gravity = Z[2] < GRAVITY_EL;
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

