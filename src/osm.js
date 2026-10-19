// ---------------- OpenStreetMap：道路、橋樑、公共設施（使用者匯出的萬華西南部範圍）----------------
// 座標為相對模擬範圍左下角（TWD97 E 299000、N 2766400）的公尺數
const PUB_TYPE = {
  hospital: "醫院", clinic: "診所", police: "派出所", fire_station: "消防分隊", school: "學校", kindergarten: "幼兒園",
  community_centre: "活動中心", library: "圖書館", marketplace: "市場", post_office: "郵局", townhall: "區公所", social_facility: "社福機構", government: "政府機關", theatre: "劇場", arts_centre: "藝文中心"
};
const ROAD_STATUS = [
  { min: 0.5, label: "中斷（≥ 0.5 m）", rgb: [214, 69, 65] },
  { min: 0.3, label: "危險（0.3–0.5 m）", rgb: [242, 153, 74] },
  { min: 0.1, label: "積水（0.1–0.3 m）", rgb: [242, 201, 76] }
];
const OSM_BOUNDS = (() => { // 使用者匯出範圍（經緯度 25.0156–25.0304、121.4906–121.5072）換算後的範圍
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  [...OSM_DATA.roads, ...OSM_DATA.bridges].forEach(r => r.p.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
  return [Math.max(0, x0), Math.max(0, y0), Math.min(DEM.nx * DEM.d, x1), Math.min(DEM.ny * DEM.d, y1)];
})();
const cellAt = (x, y) => { const i = Math.floor(x / DEM.d), j = Math.floor(y / DEM.d); return i < 0 || j < 0 || i >= DEM.nx || j >= DEM.ny ? -1 : idx(i, j); };
// 道路切成小段，各段取中點所在格的水深
const ROAD_SEGS = (() => {
  const segs = [];
  OSM_DATA.roads.forEach(r => {
    for (let i = 0; i + 1 < r.p.length; i++) {
      const [x1, y1] = r.p[i], [x2, y2] = r.p[i + 1], len = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(1, Math.ceil(len / 20));
      for (let s = 0; s < n; s++) {
        const a = s / n, b = (s + 1) / n, xa = x1 + (x2 - x1) * a, ya = y1 + (y2 - y1) * a, xb = x1 + (x2 - x1) * b, yb = y1 + (y2 - y1) * b;
        const k = cellAt((xa + xb) / 2, (ya + yb) / 2); if (k < 0 || DEM.mask[k] === 3) continue; // 對岸（新北）不在模擬範圍
        segs.push({ xa, ya, xb, yb, k, len: len / n, name: r.n, major: /^(primary|secondary|trunk|tertiary|motorway)/.test(r.c) });
      }
    }
  });
  return segs;
})();
const PUBS = OSM_DATA.pubs.map(p => ({ ...p, k: cellAt(p.x, p.y), label: PUB_TYPE[p.t] || p.t })).filter(p => p.k >= 0 && DEM.mask[p.k] === 1); // 只列臺北市側堤內設施
function depthField(lvl) { const n = DEM.nx * DEM.ny, d = new Float32Array(n); for (let k = 0; k < n; k++) d[k] = isNaN(lvl[k]) ? 0 : Math.max(0, lvl[k] - DEM.z[k]); return d; }
function roadStatus(d) { for (let c = 0; c < ROAD_STATUS.length; c++) if (d >= ROAD_STATUS[c].min) return c; return -1; }
function infraStats(fr) {
  const dep = depthField(waterLevels(fr)), km = [0, 0, 0]; let total = 0;
  ROAD_SEGS.forEach(s => { if (DEM.mask[s.k] !== 1) return; /* 只統計堤內道路 */ total += s.len; const c = roadStatus(dep[s.k]); if (c >= 0) km[c] += s.len / 1000; });
  const pubs = PUBS.map(p => ({ ...p, depth: dep[p.k] })).sort((a, b) => b.depth - a.depth);
  return { km, total: total / 1000, pubs };
}
function drawOSMOnMap(g, lvl) {
  const dep = depthField(lvl), sc = CT.scale / DEM.d, H = DEM.ny * CT.scale;
  const X = x => x * sc, Y = y => H - y * sc;
  drawPumpsOnMap(g);
  // 範圍框
  if (!OSM_DATA.full) {
  g.setLineDash([6, 4]); g.strokeStyle = "rgba(20,20,20,.5)"; g.lineWidth = 1.1;
  (OSM_DATA.bounds || [OSM_BOUNDS]).forEach(([bx0, by0, bx1, by1]) => g.strokeRect(X(bx0), Y(by1), X(bx1) - X(bx0), Y(by0) - Y(by1)));
  g.setLineDash([]);
  { const bb = OSM_DATA.bounds || [OSM_BOUNDS], bx1 = Math.max(...bb.map(b => b[2])), by1 = Math.max(...bb.map(b => b[3])); tag(g, X(bx1) - 6, Y(by1) + 16, "OSM 道路與設施資料範圍（虛線框）", "right"); }
  }
  // 道路
  ROAD_SEGS.forEach(s => {
    const c = roadStatus(dep[s.k]);
    g.strokeStyle = c >= 0 ? `rgb(${ROAD_STATUS[c].rgb.join(",")})` : "rgba(255,255,255,.75)";
    g.lineWidth = (s.major ? 2.2 : 1.2) + (c >= 0 ? 0.8 : 0);
    g.beginPath(); g.moveTo(X(s.xa), Y(s.ya)); g.lineTo(X(s.xb), Y(s.yb)); g.stroke();
  });
  // 橋樑
  OSM_DATA.bridges.forEach(b => {
    g.lineCap = "round";
    g.strokeStyle = "#2b2b2b"; g.lineWidth = 5; g.beginPath(); b.p.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); g.stroke();
    g.strokeStyle = "#f4f1ea"; g.lineWidth = 2.5; g.stroke(); g.lineCap = "butt";
  });
  const named = {}; OSM_DATA.bridges.forEach(b => { if (/橋$/.test(b.n) && !named[b.n]) named[b.n] = b; });
  Object.values(named).forEach(b => { const m = b.p[Math.floor(b.p.length / 2)]; tag(g, X(m[0]), Y(m[1]) - 8, b.n); });
  // 其他疏散門（OSM，未納入水門控制）
  (OSM_DATA.gates || []).forEach(gt => {
    const x = X(gt.x), y = Y(gt.y);
    g.fillStyle = "#ffffff"; g.fillRect(x - 5, y - 5, 10, 10); g.lineWidth = 2; g.strokeStyle = "#555"; g.strokeRect(x - 5, y - 5, 10, 10);
  });
  // 公共設施
  PUBS.forEach(p => {
    const d = dep[p.k], c = roadStatus(d);
    g.beginPath(); g.arc(X(p.x), Y(p.y), c >= 0 ? 5 : 3, 0, Math.PI * 2);
    g.fillStyle = c >= 0 ? `rgb(${ROAD_STATUS[c].rgb.join(",")})` : "#ffffff"; g.fill();
    g.lineWidth = c >= 0 ? 2 : 1.2; g.strokeStyle = "#5b2a86"; g.stroke();
  });
}
function nearestPub(x, y) { let best = null, bd = 30; [...PUBS, ...(OSM_DATA.gates || []).map(gt => ({ ...gt, label: `疏散門，${gt.ref}，未納入水門控制` }))].forEach(p => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }); return best; }

// ---- 3D：橋面、道路、設施標記 ----
function buildOSM3D(scene) {
  const W = DEM.nx, H = DEM.ny;
  const L = (x, y) => [x / DEM.d - W / 2, -(y / DEM.d - H / 2)];
  // 道路（貼地線段，依水深上色）
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ROAD_SEGS.length * 6), 3));
  rg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(ROAD_SEGS.length * 6), 3));
  const roads = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ vertexColors: true }));
  roads.frustumCulled = false; scene.add(roads);
  // 橋面：沿線段放扁平方塊，橋面高程取兩端地面較高者再加 6 m（OSM 沒有橋面高程）
  const deck = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x8a8580 });
  OSM_DATA.bridges.forEach(b => {
    for (let i = 0; i + 1 < b.p.length; i++) {
      const [x1, y1] = b.p[i], [x2, y2] = b.p[i + 1], len = Math.hypot(x2 - x1, y2 - y1); if (len < 1) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(len / DEM.d, 0.35, 0.9), mat);
      const [lx1, lz1] = L(x1, y1), [lx2, lz2] = L(x2, y2);
      m.position.set((lx1 + lx2) / 2, 0, (lz1 + lz2) / 2); m.rotation.y = -Math.atan2(lz2 - lz1, lx2 - lx1);
      m.userData = { x1, y1, x2, y2, layer: b.l || 1 }; deck.add(m);
    }
  });
  scene.add(deck);
  // 設施：直立標柱
  const pubs = new THREE.Group();
  PUBS.forEach(p => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1, 10), new THREE.MeshLambertMaterial({ color: 0x5b2a86 }));
    m.userData = p; pubs.add(m);
  });
  scene.add(pubs);
  const og = new THREE.Group(), gm = new THREE.MeshLambertMaterial({ color: 0xbbbbbb });
  (OSM_DATA.gates || []).forEach(gt => { const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.6), gm); m.userData = gt; og.add(m); });
  scene.add(og); T3.ogates = og;
  PUBS.filter(p => p.t === "fire_station" || (p.t === "hospital" && /醫院$/.test(p.n))).forEach(p => T3.addLabel(p.n, p.x / DEM.d - 0.5, p.y / DEM.d - 0.5, DEM.z[p.k] + 14));
  Object.assign(T3, { roads, deck, pubs });
  positionOSM3D();
}
function positionOSM3D() {
  if (!T3.roads) return;
  const s = T3.ex / DEM.d, W = DEM.nx, H = DEM.ny, L = (x, y) => [x / DEM.d - W / 2, -(y / DEM.d - H / 2)];
  const pos = T3.roads.geometry.attributes.position.array;
  ROAD_SEGS.forEach((g, n) => {
    const y = DEM.z[g.k] * s + 0.12, [a, b] = L(g.xa, g.ya), [c, d] = L(g.xb, g.yb), o = n * 6;
    pos[o] = a; pos[o + 1] = y; pos[o + 2] = b; pos[o + 3] = c; pos[o + 4] = y; pos[o + 5] = d;
  });
  T3.roads.geometry.attributes.position.needsUpdate = true;
  T3.deck.children.forEach(m => {
    const { x1, y1, x2, y2, layer } = m.userData, k1 = cellAt(x1, y1), k2 = cellAt(x2, y2);
    const zg = Math.max(k1 >= 0 ? DEM.z[k1] : 0, k2 >= 0 ? DEM.z[k2] : 0, 8);
    m.position.y = (zg + 6 + 3 * (layer - 1)) * s;
  });
  T3.pubs.children.forEach(m => { const p = m.userData, base = dispZ(DEM.z[p.k]) * s; m.scale.y = 6; m.position.y = base + 3; });
  T3.ogates.children.forEach(m => { const gt = m.userData, [lx, lz] = L(gt.x, gt.y); m.position.set(lx, 11.4 * s, lz); });
}
function colorOSM3D(lvl) {
  if (!T3.roads) return;
  const dep = depthField(lvl), col = T3.roads.geometry.attributes.color.array;
  ROAD_SEGS.forEach((g, n) => {
    const c = roadStatus(dep[g.k]), rgb = c >= 0 ? ROAD_STATUS[c].rgb : [250, 250, 250], o = n * 6;
    for (let v = 0; v < 2; v++) { col[o + v * 3] = rgb[0] / 255; col[o + v * 3 + 1] = rgb[1] / 255; col[o + v * 3 + 2] = rgb[2] / 255; }
  });
  T3.roads.geometry.attributes.color.needsUpdate = true;
  T3.pubs.children.forEach(m => { const c = roadStatus(dep[m.userData.k]); m.material.color.setRGB(...(c >= 0 ? ROAD_STATUS[c].rgb.map(v => v / 255) : [0.36, 0.16, 0.53])); });
}

// ---- 抽水站與集水區：抽水站位置取自臺北市資料大平臺「臺北市水利處抽水站」；集水區以最近抽水站劃分 ----
const DRAIN = (() => {
  const st = (OSM_DATA.pumps || []).map(p => {
    let best = -1, bd = 1e9;  // 抽水站多半蓋在堤防上，改用最近的堤內格
    for (let k = 0; k < DEM.mask.length; k++) if (DEM.mask[k] === 1) { const x = (k % DEM.nx + 0.5) * DEM.d, y = (((k / DEM.nx) | 0) + 0.5) * DEM.d, d = (x - p.x) ** 2 + (y - p.y) ** 2; if (d < bd) { bd = d; best = k; } }
    return { ...p, k: best };
  });
  const c = new Int8Array(DEM.mask.length).fill(-1);
  for (let k = 0; k < c.length; k++) if (DEM.mask[k] === 1) {
    const x = (k % DEM.nx + 0.5) * DEM.d, y = (((k / DEM.nx) | 0) + 0.5) * DEM.d; let bi = -1, bd = 1e18;
    st.forEach((s, i) => { const d = (x - s.x) ** 2 + (y - s.y) ** 2; if (d < bd) { bd = d; bi = i; } }); c[k] = bi;
  }
  const area = st.map((_, i) => { let n = 0; for (let k = 0; k < c.length; k++) if (c[k] === i) n++; return n * DEM.d * DEM.d; });
  return { stations: st, catch: c, area };
})();
function drawPumpsOnMap(g) {
  const sc = CT.scale / DEM.d, H = DEM.ny * CT.scale;
  DRAIN.stations.forEach(s => {
    const x = s.x * sc, y = H - s.y * sc;
    g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 7, y + 5); g.lineTo(x - 7, y + 5); g.closePath();
    g.fillStyle = "#1e6fd9"; g.fill(); g.lineWidth = 1.5; g.strokeStyle = "#fff"; g.stroke();
    tag(g, x + 10, y + 4, s.n, "left");
  });
}
