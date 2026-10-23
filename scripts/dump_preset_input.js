// 擷取某個情境（預設「歷史：納莉颱風」）送進二維水流 Worker 的完整輸入，加上瀏覽器算出的最大水深，
// 存成 work/flow_in/<id>_<preset>.json，供 scripts/merge_city.py 拼成全市網格（GPU 版跨河段計算）使用。
// 用法：NODE_PATH=$(npm root -g) node scripts/dump_preset_input.js <html> <id> [preset=nari]
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [html, id, preset = 'nari'] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { const pm = Worker.prototype.postMessage; Worker.prototype.postMessage = function (m) { if (m && m.nx) window.__P = m; return pm.apply(this, arguments); }; });
  await p.goto('file://' + html); await p.waitForTimeout(1500);
  await p.evaluate(id => { P = JSON.parse(JSON.stringify(PRESETS.find(x => x.id === id).p)); activePreset = id; recompute(); FLOW.result = null; }, preset);
  await p.waitForFunction(() => FLOW.result, null, { timeout: 1800000 });
  const out = await p.evaluate(() => {
    const b64 = a => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let k = 0; k < u.length; k += 8192) s += String.fromCharCode.apply(null, u.subarray(k, k + 8192)); return btoa(s); };
    const Pm = window.__P, hm = maxDepthField();
    return { region: REGION.id, x0: DEM.x0, y0: DEM.y0, nx: Pm.nx, ny: Pm.ny, d: Pm.d, n: Pm.n, simHours: Pm.simHours, frameSec: Pm.frameSec,
      sewerMM: Pm.sewerMM, pumpMM: Pm.pumpMM, avail: Pm.avail, storeMM: Pm.storeMM, gravityEL: Pm.gravityEL, C: Pm.C, openPct: Pm.openPct, closeAt: Pm.closeAt,
      nCatch: Pm.nCatch, rain: Array.from(Pm.rain), zrOut: Array.from(Pm.zrOut), failAt: Pm.failAt, stream: Array.from(Pm.stream || []), streamOn: Pm.streamOn,
      z_f32: b64(Pm.z), mask_u8: b64(Pm.mask), psi_f32: b64(Pm.psi), catch_i32: b64(Int32Array.from(Pm.catch)),
      gates: Pm.gates.map(g => ({ entry: g.entry, sill: g.sill, width: g.width, levee: g.levee, open: g.open, zr: Array.from(g.zr) })),
      js_hmax_cm_u16: b64(Uint16Array.from(hm, v => Math.min(65535, Math.round(v * 100)))),
      js_area_series: FLOW.result.h.map(h => { let a = 0; for (let k = 0; k < h.length; k++) if (Pm.mask[k] === 1 && h[k] >= 0.1) a++; return +(a * Pm.d * Pm.d / 1e4).toFixed(2); }) };
  });
  fs.mkdirSync('work/flow_in', { recursive: true }); fs.writeFileSync(`work/flow_in/${id}_${preset}.json`, JSON.stringify(out));
  console.log(id, preset, 'errors', errs, 'frames', out.rain.length, 'max area', Math.max(...out.js_area_series), 'ha');
  await b.close();
})();
