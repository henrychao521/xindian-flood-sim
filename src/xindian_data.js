// ---- 新店溪（萬華・中正・大安）模型資料（數值取自 PDF；標 * 者為本模擬器補充假設）----
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

function riverStage(node, Qk, tide) {
  const q = Math.pow(Math.max(Qk, 0), 0.85);
  return node.a + node.k * q + node.tf * tide + node.bend * (Qk / 5.5) + node.jm * (Qk / 5.5);
}

const REGION = {
  id: "xindian",
  keyGate: 2,            // 主要觀察的水門（KPI、排水重力閘門判斷用）
  outlet: "W",           // 河道下游出口所在的範圍邊界（用於推算主流流向）
  cam: [-150, 175, 200],
  labels: [[55, 160, "萬華區", 14], [170, 150, "中正區", 16], [235, 120, "大安區（公館）", 20], [105, 105, "青年公園", 8], [120, 70, "新店溪", 6]],
  mapLabels: [[30, 185, "華江高灘地（堤外）"], [110, 25, "永和（新北，不在模擬範圍）"]]
};
