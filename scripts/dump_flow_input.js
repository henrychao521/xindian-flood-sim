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
  fs.mkdirSync('work/flow_in', { recursive: true }); fs.writeFileSync(`work/flow_in/${id}.json`, JSON.stringify(out));
  console.log(id, 'errors', errs, 'stats', JSON.stringify(out.js_stats), 'vol', out.js_vol_4h_m3, 'catch', out.nCatch, 'cells', out.nx * out.ny);
  await b.close();
})();
