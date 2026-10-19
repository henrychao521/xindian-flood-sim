// ---------------- 二維漫地流（局部慣性淺水波，Bates et al. 2010），在 Web Worker 中計算 ----------------
function flowWorkerMain() {
  onmessage = e => {
    const P = e.data, nx = P.nx, ny = P.ny, d = P.d, N = nx * ny, g = 9.81, n2 = P.n * P.n, A = d * d;
    const z = P.z, psi = P.psi, act = new Uint8Array(N); for (let k = 0; k < N; k++) act[k] = P.mask[k] === 1 ? 1 : 0;
    // 孔隙率法：介面通水寬度比例取兩側較小者；建物越密，糙度越高
    const phx = new Float32Array((nx + 1) * ny), phy = new Float32Array(nx * (ny + 1)), nx2 = new Float32Array((nx + 1) * ny), ny2 = new Float32Array(nx * (ny + 1));
    for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) { const a = j * nx + i - 1, f = j * (nx + 1) + i, p = Math.min(psi[a], psi[a + 1]); phx[f] = p; const nn = P.n + 0.08 * (1 - p); nx2[f] = nn * nn; }
    for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) { const a = (j - 1) * nx + i, f = j * nx + i, p = Math.min(psi[a], psi[a + nx]); phy[f] = p; const nn = P.n + 0.08 * (1 - p); ny2[f] = nn * nn; }
    const h = new Float32Array(N), lim = new Float32Array(N), qx = new Float32Array((nx + 1) * ny), qy = new Float32Array(nx * (ny + 1));
    const T = P.simHours * 3600, FR = P.frameSec;
    const weir = (C, B, up, dn, crest) => {
      const s = up >= dn ? 1 : -1, hi = Math.max(up, dn), lo = Math.min(up, dn), h1 = hi - crest; if (h1 <= 0) return 0;
      const h2 = Math.max(0, lo - crest);
      return s * C * B * Math.pow(h1, 1.5) * Math.pow(Math.max(0, 1 - Math.pow(h2 / h1, 1.5)), 0.385);
    };
    const interp = (arr, t) => { const f = t / FR, i = Math.min(arr.length - 2, Math.floor(f)), w = Math.min(1, f - i); return arr[i] * (1 - w) + arr[i + 1] * w; };
    // 每座水門入口與抽水站：入口格周邊 5×5 的堤內格
    const near = k0 => { const out = [], i0 = k0 % nx, j0 = (k0 / nx) | 0; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const i = i0 + a, j = j0 + b; if (i >= 0 && j >= 0 && i < nx && j < ny && act[j * nx + i]) out.push(j * nx + i); } return out; };
    const gateCells = P.gates.map(gt => near(gt.entry));
    const out = { h: [], u: [], v: [], q: [], sew: [] };
    const nC = P.nCatch, cArea = new Float64Array(nC), dem = new Float64Array(nC), fac = new Float64Array(nC), sew = new Float64Array(nC), sewAcc = new Float64Array(nC);
    for (let k = 0; k < N; k++) if (P.catch[k] >= 0) cArea[P.catch[k]] += A;
    const cStore = Array.from(cArea, a => Math.max(1, a * P.storeMM / 1000));
    let t = 0, nextFrame = 0, qLast = P.gates.map(() => 0), qAcc = P.gates.map(() => 0), tAcc = 0;
    const record = () => {
      const hh = new Float32Array(h), uu = new Float32Array(N), vv = new Float32Array(N);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i; if (!act[k] || h[k] < 0.01) continue;
        const hd = Math.max(h[k], 0.05);
        uu[k] = 0.5 * (qx[j * (nx + 1) + i] + qx[j * (nx + 1) + i + 1]) / hd;
        vv[k] = 0.5 * (qy[j * nx + i] + qy[(j + 1) * nx + i]) / hd;
      }
      out.h.push(hh); out.u.push(uu); out.v.push(vv); out.q.push(tAcc > 0 ? qAcc.map(v => v / tAcc) : qLast.slice()); out.sew.push(Array.from(sewAcc)); qAcc.fill(0); tAcc = 0;
      postMessage({ type: "progress", p: t / T });
    };
    while (t <= T + 1e-6) {
      if (t >= nextFrame - 1e-6) { record(); nextFrame += FR; if (t >= T) break; }
      let hmax = 0.01; for (let k = 0; k < N; k++) if (act[k] && h[k] > hmax) hmax = h[k];
      let dt = Math.min(10, 0.5 * d / Math.sqrt(g * hmax)); dt = Math.min(dt, nextFrame - t);
      // x 向通量
      for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) {
        const a = j * nx + i - 1, b = a + 1, f = j * (nx + 1) + i;
        if (!act[a] || !act[b]) { qx[f] = 0; continue; }
        const ea = z[a] + h[a], eb = z[b] + h[b], hf = Math.max(ea, eb) - Math.max(z[a], z[b]);
        if (hf <= 1e-3) { qx[f] = 0; continue; }
        const q = qx[f];
        qx[f] = (q - g * hf * dt * (eb - ea) / d) / (1 + g * dt * nx2[f] * Math.abs(q) / (hf * hf * Math.cbrt(hf)));
      }
      // y 向通量
      for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = (j - 1) * nx + i, b = j * nx + i, f = j * nx + i;
        if (!act[a] || !act[b]) { qy[f] = 0; continue; }
        const ea = z[a] + h[a], eb = z[b] + h[b], hf = Math.max(ea, eb) - Math.max(z[a], z[b]);
        if (hf <= 1e-3) { qy[f] = 0; continue; }
        const q = qy[f];
        qy[f] = (q - g * hf * dt * (eb - ea) / d) / (1 + g * dt * ny2[f] * Math.abs(q) / (hf * hf * Math.cbrt(hf)));
      }
      // 通量限制：任一格流出的水量不得超過格內現有水量（避免負水深與質量誤差）
      for (let k = 0; k < N; k++) {
        if (!act[k]) { lim[k] = 1; continue; }
        const i = k % nx, j = (k / nx) | 0, fl = j * (nx + 1) + i, fb = j * nx + i, ft = (j + 1) * nx + i;
        let out = 0;
        if (qx[fl] < 0) out -= qx[fl] * phx[fl]; if (qx[fl + 1] > 0) out += qx[fl + 1] * phx[fl + 1];
        if (qy[fb] < 0) out -= qy[fb] * phy[fb]; if (qy[ft] > 0) out += qy[ft] * phy[ft];
        out *= dt / d;
        const avail = h[k] * psi[k];
        lim[k] = out > avail ? (avail / out) : 1;
      }
      for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) { const f = j * (nx + 1) + i, q = qx[f]; if (q > 0) qx[f] = q * lim[j * nx + i - 1]; else if (q < 0) qx[f] = q * lim[j * nx + i]; }
      for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) { const f = j * nx + i, q = qy[f]; if (q > 0) qy[f] = q * lim[(j - 1) * nx + i]; else if (q < 0) qy[f] = q * lim[j * nx + i]; }
      // 連續方程式
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i; if (!act[k]) continue;
        const fl = j * (nx + 1) + i, fb = j * nx + i, ft = (j + 1) * nx + i;
        const dh = (qx[fl] * phx[fl] - qx[fl + 1] * phx[fl + 1] + qy[fb] * phy[fb] - qy[ft] * phy[ft]) * dt / d / psi[k];
        h[k] = Math.max(0, h[k] + dh);
      }
      // 降雨全部落到地面
      const r = interp(P.rain, t) / 1000 / 3600 * dt;
      if (r > 0) for (let k = 0; k < N; k++) if (act[k]) h[k] += r / psi[k];
      // 雨水下水道收水 → 管網暫存 → 抽水站／重力閘門排出（依最近抽水站劃分集水區）
      {
        const intake = P.sewerMM / 1000 / 3600 * dt * A, zr = interp(P.zrOut, t), gravity = zr < P.gravityEL;
        dem.fill(0);
        for (let k = 0; k < N; k++) { const c = P.catch[k]; if (c >= 0 && h[k] > 0) dem[c] += Math.min(h[k] * psi[k] * A, intake); }
        for (let c = 0; c < nC; c++) {
          const drain = (P.pumpMM / 1000 / 3600 * cArea[c] * P.avail / 100 + (gravity ? P.sewerMM / 1000 / 3600 * cArea[c] : 0)) * dt;
          const allow = drain + (cStore[c] - sew[c]);
          fac[c] = dem[c] > 0 ? Math.min(1, Math.max(0, allow) / dem[c]) : 0;
          sew[c] += dem[c] * fac[c]; const o = Math.min(drain, sew[c]); sew[c] -= o;
        }
        for (let k = 0; k < N; k++) { const c = P.catch[k]; if (c >= 0 && h[k] > 0 && fac[c] > 0) h[k] = Math.max(0, h[k] - Math.min(h[k] * psi[k] * A, intake) * fac[c] / (A * psi[k])); }
        for (let c = 0; c < nC; c++) sewAcc[c] = sew[c] / cStore[c];
      }
      // 水門入流（含潛沒與回流）、越堤、抽水
      P.gates.forEach((gt, gi) => {
        const cells = gateCells[gi]; if (!cells.length) return;
        const zr = interp(gt.zr, t);
        // 水門後方水位：入口格有積水時取水面，乾的時候視為自由出流
        let wsum = 0, hsum = 0, vol = 0; let cap = 0; cells.forEach(k => { if (h[k] > 0.01) { wsum += (z[k] + h[k]) * h[k]; hsum += h[k]; } vol += h[k] * A * psi[k]; cap += A * psi[k]; });
        const eta = hsum > 0 ? wsum / hsum : -99;
        let Q = 0;
        if (gt.open && (P.closeAt >= P.simHours || t < P.closeAt * 3600)) Q += weir(P.C, gt.width * P.openPct / 100, zr, eta, gt.sill);
        if (zr > gt.levee) Q += weir(1.7, 150, zr, eta, gt.levee);
        if (Q < 0) Q = -Math.min(-Q, vol * 0.5 / dt);
        const net = Q;
        qLast[gi] = Q; qAcc[gi] += Q * dt;
        const per = net * dt / cap;
        cells.forEach(k => { h[k] = Math.max(0, h[k] + per); });
      });
      t += dt; tAcc += dt;
    }
    postMessage({ type: "done", out }, [...out.h, ...out.u, ...out.v].map(a => a.buffer));
  };
}

const FLOW = { result: null, worker: null, progress: 0, token: 0 };
function runFlow() {
  if (FLOW.worker) FLOW.worker.terminate();
  FLOW.result = null; FLOW.progress = 0;
  const token = ++FLOW.token;
  let worker;
  try {
    const url = URL.createObjectURL(new Blob(["(" + flowWorkerMain.toString() + ")()"], { type: "text/javascript" }));
    worker = new Worker(url);
  } catch (err) { FLOW.failed = true; return; }
  FLOW.worker = worker;
  const gateIds = GATES.map(g => g.id);
  worker.onmessage = e => {
    if (token !== FLOW.token) return;
    if (e.data.type === "progress") { FLOW.progress = e.data.p; updateFlowStatus(); return; }
    FLOW.result = e.data.out; FLOW.worker = null; worker.terminate();
    render();
  };
  worker.postMessage({
    nx: DEM.nx, ny: DEM.ny, d: DEM.d, z: DEM.z, mask: DEM.mask, psi: DEM.psi, n: 0.035,
    simHours: SIM_HOURS, frameSec: FRAME_EVERY * DT, sewer: SEWER_DESIGN,
    rain: frames.map(f => f.rain), C: P.C, openPct: P.openPct, closeAt: P.closeAt,
    sewerMM: P.sewerMM, pumpMM: P.pumpMM, avail: P.avail, storeMM: SEWER_STORE_MM, gravityEL: GRAVITY_EL,
    zrOut: frames.map(f => f.Z[GATES[REGION.keyGate].node]), catch: DRAIN.catch, nCatch: DRAIN.stations.length,
    gates: gateIds.map((id, gi) => {
      const g = GATES[gi];
      return { entry: DEM.entry[id], sill: g.sill, width: g.width, levee: NODES[g.node].levee, open: !!P.gateOpen[id], zr: frames.map(f => f.Z[g.node]) };
    })
  });
}
function updateFlowStatus() {
  const el = $("flowStatus"); if (!el) return;
  if (FLOW.failed) { el.textContent = "這個瀏覽器無法執行背景計算，地圖改用靜水面估算。"; return; }
  if (!FLOW.result) { el.textContent = `二維水流計算中… ${Math.round(FLOW.progress * 100)}%（完成後才會顯示堤內積水）`; const ov = $("calcOverlay"); if (ov) { ov.hidden = false; ov.textContent = `二維水流計算中 ${Math.round(FLOW.progress * 100)}%`; } return; }
  { const ov = $("calcOverlay"); if (ov) ov.hidden = true; }
  const fr = FLOW.result, k = Math.min(tIdx, fr.h.length - 1), q = fr.q[k];
  let vmax = 0; const u = fr.u[k], v = fr.v[k]; for (let i = 0; i < u.length; i++) { const s = Math.hypot(u[i], v[i]); if (s > vmax) vmax = s; }
  const names = GATES.map(g => g.name.replace(/門$/, ""));
  el.innerHTML = `二維水流：水門入流 ${q.map((v, i) => `${names[i]} <b class="num">${fmt(v, 0)}</b>`).join("・")} m³/s・堤內最大流速 <b class="num">${fmt(vmax, 1)}</b> m/s`;
}
// 堤內各格水深：二維結果優先，未完成時用靜水面
function inlandDepth(fr) {
  const n = DEM.nx * DEM.ny, dep = new Float32Array(n);
  if (FLOW.result) { const hh = FLOW.result.h[Math.min(tIdx, FLOW.result.h.length - 1)]; for (let k = 0; k < n; k++) dep[k] = DEM.mask[k] === 1 ? hh[k] : 0; return dep; }
  return dep; // 二維計算完成前不畫堤內積水，避免誤以為水從最低窪處（華江一帶）冒出來
}

// ---- 粒子動畫 ----
const PART = { list: [], running: false, last: 0, speed: 120 };
function resetParticles() { PART.list = []; const c = $("flowLayer"); if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); }
function spawn(p) {
  const fr = FLOW.result; if (!fr) return false;
  const k0 = Math.min(tIdx, fr.h.length - 1), hh = fr.h[k0], u = fr.u[k0], v = fr.v[k0];
  for (let tries = 0; tries < 30; tries++) {
    const k = (Math.random() * DEM.nx * DEM.ny) | 0;
    if (hh[k] > 0.05 && Math.hypot(u[k], v[k]) > 0.03) { p.x = (k % DEM.nx) + Math.random(); p.y = ((k / DEM.nx) | 0) + Math.random(); p.age = 0; p.life = 40 + Math.random() * 60; return true; }
  }
  p.age = 999; return false;
}
function stepParticles(ts) {
  const c = $("flowLayer");
  if (!c || !FLOW.result || document.hidden) { PART.running = false; return; }
  const dtA = Math.min(0.05, (ts - (PART.last || ts)) / 1000); PART.last = ts;
  const g = c.getContext("2d"), sc = CT.scale, H = DEM.ny;
  g.globalCompositeOperation = "destination-out"; g.fillStyle = "rgba(0,0,0,0.08)"; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-over";
  const fr = FLOW.result, k0 = Math.min(tIdx, fr.h.length - 1), hh = fr.h[k0], u = fr.u[k0], v = fr.v[k0];
  const target = 1400;
  while (PART.list.length < target) PART.list.push({ age: 999, life: 0 });
  g.lineWidth = 1.4; g.strokeStyle = "rgba(255,255,255,0.9)"; g.beginPath();
  for (const p of PART.list) {
    if (p.age > p.life && !spawn(p)) continue;
    const i = p.x | 0, j = p.y | 0;
    if (i < 0 || j < 0 || i >= DEM.nx || j >= DEM.ny) { p.age = 999; continue; }
    const k = j * DEM.nx + i;
    if (hh[k] < 0.02) { p.age = 999; continue; }
    const nxp = p.x + u[k] * PART.speed * dtA / DEM.d, nyp = p.y + v[k] * PART.speed * dtA / DEM.d;
    g.moveTo(p.x * sc, (H - p.y) * sc); g.lineTo(nxp * sc, (H - nyp) * sc);
    p.x = nxp; p.y = nyp; p.age++;
  }
  g.stroke();
  requestAnimationFrame(stepParticles);
}
function startParticles() {
  if (PART.running || !FLOW.result) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  PART.running = true; PART.last = 0; requestAnimationFrame(stepParticles);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) startParticles(); });

// ---- 3D 水流粒子：堤內用二維流場，新店溪主河道用流向場（由河道往下游出口的距離推得）----
const RIVER = (() => {
  const n = DEM.nx * DEM.ny, ch = new Uint8Array(n), dist = new Float32Array(n).fill(Infinity), q = [];
  for (let k = 0; k < n; k++) if (DEM.mask[k] === 0 && DEM.z[k] < 1.0) ch[k] = 1;
  const edge = REGION.outlet || "W", push0 = k => { if (ch[k] && dist[k] !== 0) { dist[k] = 0; q.push(k); } };  // 下游出口所在邊界
  if (edge.includes("W")) for (let j = 0; j < DEM.ny; j++) push0(idx(0, j));
  if (edge.includes("E")) for (let j = 0; j < DEM.ny; j++) push0(idx(DEM.nx - 1, j));
  if (edge.includes("S")) for (let i = 0; i < DEM.nx; i++) push0(idx(i, 0));
  if (edge.includes("N")) for (let i = 0; i < DEM.nx; i++) push0(idx(i, DEM.ny - 1));
  for (let h = 0; h < q.length; h++) {
    const k = q[h], i = k % DEM.nx, j = (k / DEM.nx) | 0;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= DEM.nx || jj >= DEM.ny) continue;
      const kk = idx(ii, jj); if (ch[kk] && dist[kk] === Infinity) { dist[kk] = dist[k] + 1; q.push(kk); }
    }
  }
  const dx = new Float32Array(n), dy = new Float32Array(n);
  for (let j = 0; j < DEM.ny; j++) for (let i = 0; i < DEM.nx; i++) {
    const k = idx(i, j); if (!ch[k] || !isFinite(dist[k])) continue;
    let sx = 0, sy = 0;
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
      const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= DEM.nx || jj >= DEM.ny) continue;
      const kk = idx(ii, jj); if (!ch[kk] || !isFinite(dist[kk])) continue;
      const r = Math.hypot(a, b) || 1; sx -= a * (dist[kk] - dist[k]) / r; sy -= b * (dist[kk] - dist[k]) / r;
    }
    const m = Math.hypot(sx, sy) || 1; dx[k] = sx / m; dy[k] = sy / m;
  }
  return { ch, dx, dy };
})();
const P3 = { inland: 1600, river: 700, speed: 120, last: 0 };
function init3DParticles(scene) {
  const N = P3.inland + P3.river;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 6), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * 6), 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat); lines.frustumCulled = false; lines.renderOrder = 2;
  scene.add(lines);
  P3.lines = lines; P3.p = Array.from({ length: N }, (_, n) => ({ river: n >= P3.inland, age: 999, life: 0, x: 0, y: 0 }));
}
function spawn3D(p, hh, u, v, zr) {
  for (let tries = 0; tries < 25; tries++) {
    const k = (Math.random() * DEM.nx * DEM.ny) | 0;
    const ok = p.river ? (RIVER.ch[k] && DEM.z[k] < zr) : (hh && hh[k] > 0.05 && Math.hypot(u[k], v[k]) > 0.03);
    if (ok) { p.x = (k % DEM.nx) + Math.random(); p.y = ((k / DEM.nx) | 0) + Math.random(); p.age = 0; p.life = 50 + Math.random() * 70; return true; }
  }
  p.age = 999; return false;
}
function animate3D(ts) {
  if (!T3.ok || !frames.length) return;
  const playing = typeof tPos === "number" ? tPos : tIdx;
  if (T3.dirty || T3.lastT !== playing) { draw3DWater(playing); T3.lastT = playing; T3.dirty = false; }
  if (!P3.lines) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dtA = reduce ? 0 : Math.min(0.05, (ts - (P3.last || ts)) / 1000); P3.last = ts;
  const k0 = Math.min(Math.floor(playing), frames.length - 1), fr = frames[k0];
  const zr = fr.gates[REGION.keyGate].zr, Q = qAbs(fr), vRiver = Q / ((REGION.riverWidth || 300) * Math.max(2, zr + 3 - (REGION.bedRef || 0)));
  const R = FLOW.result, L = R ? R.h.length - 1 : 0;
  const hh = R ? R.h[Math.min(k0, L)] : null, u = R ? R.u[Math.min(k0, L)] : null, v = R ? R.v[Math.min(k0, L)] : null;
  const pos = P3.lines.geometry.attributes.position, col = P3.lines.geometry.attributes.color, s = T3.ex / DEM.d, lvl = T3.lvl;
  const streak = 2.5;
  P3.p.forEach((p, n) => {
    let alive = !(p.age > p.life) || spawn3D(p, hh, u, v, zr);
    let vx = 0, vy = 0, k = -1;
    if (alive) {
      const i = p.x | 0, j = p.y | 0;
      if (i < 0 || j < 0 || i >= DEM.nx || j >= DEM.ny) alive = false;
      else {
        k = idx(i, j);
        if (p.river) { if (!RIVER.ch[k]) alive = false; else { vx = RIVER.dx[k] * vRiver; vy = RIVER.dy[k] * vRiver; } }
        else if (!hh || hh[k] < 0.02) alive = false; else { vx = u[k]; vy = v[k]; }
      }
    }
    const o = n * 6;
    if (!alive || !lvl || isNaN(lvl[k])) { p.age = 999; for (let a = 0; a < 6; a++) pos.array[o + a] = 0; col.array.fill(0, o, o + 6); return; }
    p.x += vx * P3.speed * dtA / DEM.d; p.y += vy * P3.speed * dtA / DEM.d; p.age++;
    const spd = Math.hypot(vx, vy), len = Math.min(6, 0.6 + spd * streak);
    const [lx, lz] = toLocal(p.x - 0.5, p.y - 0.5), y = (dispZ(DEM.z[k]) + lvl[k] - DEM.z[k]) * s + 0.15;
    const m = spd || 1;
    pos.array[o] = lx; pos.array[o + 1] = y; pos.array[o + 2] = lz;
    pos.array[o + 3] = lx - vx / m * len; pos.array[o + 4] = y; pos.array[o + 5] = lz + vy / m * len;
    const fade = Math.min(1, p.age / 10) * Math.min(1, (p.life - p.age) / 15), c = p.river ? 0.6 : 1;
    col.array[o] = c * fade; col.array[o + 1] = c * fade; col.array[o + 2] = fade;
    col.array[o + 3] = 0; col.array[o + 4] = 0; col.array[o + 5] = 0;
  });
  pos.needsUpdate = true; col.needsUpdate = true;
}
