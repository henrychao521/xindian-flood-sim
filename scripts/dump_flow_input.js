// 擷取各河段頁面送進二維水流 Worker 的輸入（地形、孔隙率、集水區、水門、河道水位、雨量），
// 以及瀏覽器算出的 4 小時統計，存成 work/flow_in/<id>.json 供 scripts/flow_torch.py（Colab GPU 批次）使用與驗證。
// 用法：NODE_PATH=$(npm root -g) node scripts/dump_flow_input.js <html> <id> [preset=shortrain]
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [html, id, preset = 'shortrain'] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { const pm = Worker.prototype.postMessage; Worker.prototype.postMessage = function (m) { if (m && m.nx) window.__P = m; return pm.apply(this, arguments); }; });
  await p.goto('file://' + html); await p.waitForTimeout(1500);
  await p.evaluate(id => { P = JSON.parse(JSON.stringify(PRESETS.find(x => x.id === id).p)); recompute(); FLOW.result = null; }, preset);
  await p.waitForFunction(() => FLOW.result, null, { timeout: 900000 });
  const out = await p.evaluate(() => {
    const b64 = a => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let k = 0; k < u.length; k += 8192) s += String.fromCharCode.apply(null, u.subarray(k, k + 8192)); return btoa(s); };
    const Pm = window.__P, h = FLOW.result.h, stats = [24, 48, 96].map(t => { const fs = (tIdx = t, floodStats(frames[t])); return { t_h: t / 12, area_ha: +fs.total.toFixed(2), deep_ha: +(fs.c2 + fs.c3).toFixed(2), maxD: +fs.maxD.toFixed(3) }; });
    let vol = 0; for (let k = 0; k < h[48].length; k++) if (Pm.mask[k] === 1) vol += h[48][k] * Pm.psi[k]; vol *= Pm.d * Pm.d;
    return {
      region: REGION.id, preset: P && activePreset, nx: Pm.nx, ny: Pm.ny, d: Pm.d, n: Pm.n, simHours: Pm.simHours, frameSec: Pm.frameSec,
      sewerMM: Pm.sewerMM, pumpMM: Pm.pumpMM, avail: Pm.avail, storeMM: Pm.storeMM, gravityEL: Pm.gravityEL, C: Pm.C, openPct: Pm.openPct, closeAt: Pm.closeAt,
      nCatch: Pm.nCatch, rain: Pm.rain, zrOut: Pm.zrOut, z_f32: b64(Pm.z), mask_u8: b64(Pm.mask), psi_f32: b64(Pm.psi), catch_i32: b64(Int32Array.from(Pm.catch)),
      gates: Pm.gates.map(g => ({ entry: g.entry, sill: g.sill, width: g.width, levee: g.levee, open: g.open, zr: g.zr })),
      inland_ha: Array.from(Pm.mask).filter(m => m === 1).length * Pm.d * Pm.d / 1e4,
      js_stats: stats, js_vol_4h_m3: +vol.toFixed(0), js_h4h_cm_u8: b64(Uint8Array.from(h[48], v => Math.min(255, Math.round(v * 100)))),
      P: JSON.parse(JSON.stringify(P)), rainShape: [0.5, 1, 2, 3].map(hr => frames.map(f => +(rainShape(f.t, hr)).toFixed(4)))
    };
  });
  // 洩洪／水門失效情境用：河道水位表（各洪水規模 × 潮位，水門全關、無雨）與「關鍵水門未關」情境的瀏覽器結果（驗證用）
  const riverPreset = (await p.evaluate(() => PRESETS.some(x => x.id === 'pdf'))) ? 'pdf' : 'keyopen';
  await p.evaluate(id => { P = JSON.parse(JSON.stringify(PRESETS.find(x => x.id === id).p)); recompute(); FLOW.result = null; }, riverPreset);
  await p.waitForFunction(() => FLOW.result, null, { timeout: 900000 });
  out.river = await p.evaluate(() => {
    const Pm = window.__P, h = FLOW.result.h;
    const stats = [24, 48, 96].map(t => { const fs = (tIdx = t, floodStats(frames[t])); return { t_h: t / 12, area_ha: +fs.total.toFixed(2), deep_ha: +(fs.c2 + fs.c3).toFixed(2), maxD: +fs.maxD.toFixed(3), q: FLOW.result.q[t].map(v => +v.toFixed(1)) }; });
    const Qs = REGION.qDesign ? [60, 80, 100, 120, 140] : [3000, 5500, 7000, 8500, 10000], tides = [1.0, 1.6, 2.0], Z = {};
    Qs.forEach(Q => tides.forEach(td => { const fr = simulate({ ...P, Qpeak: Q, tide: td, tideSync: true, rain: 0, gateOpen: {} }); Z[`${Q}|${td}`] = fr.map(f => f.Z.map(v => +v.toFixed(3))); }));
    return { preset: activePreset, P: JSON.parse(JSON.stringify(P)), rain: Pm.rain, zrOut: Pm.zrOut, gates: Pm.gates.map(g => ({ open: g.open, zr: g.zr })), js_stats: stats,
             gateNames: GATES.map(g => g.name), gateNodes: GATES.map(g => g.node), keyNode: GATES[REGION.keyGate].node, keyGate: REGION.keyGate, qUnit: REGION.qDesign ? '%' : 'm3/s',
             stages: { Qpeaks: Qs, tides, Z } };
  });
  fs.mkdirSync('work/flow_in', { recursive: true }); fs.writeFileSync(`work/flow_in/${id}.json`, JSON.stringify(out));
  console.log(id, 'errors', errs, 'river', JSON.stringify(out.river.js_stats[1]), 'stats', JSON.stringify(out.js_stats), 'vol', out.js_vol_4h_m3, 'catch', out.nCatch, 'cells', out.nx * out.ny);
  await b.close();
})();
