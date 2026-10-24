// 河段頁面檢查：錯誤、各情境統計、截圖。用法：node region_check.js <html> <outprefix>
const { chromium } = require('playwright');
(async () => {
  const [html, pre] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + html); await p.waitForTimeout(1500);
  const stats = { keyGate: await p.evaluate(() => GATES[REGION.keyGate].name), region: await p.evaluate(() => REGION.id) };
  let lastId = null;
  for (const id of (process.env.PRESETS || 'keyopen,rain').split(',')) {  // 新店溪頁面用 PRESETS=pdf,rain；最後一個情境的 4 小時水深會另存，供與水利處模擬圖比對
    lastId = id;
    await p.evaluate(id => { P = JSON.parse(JSON.stringify(PRESETS.find(x => x.id === id).p)); recompute(); FLOW.result = null; }, id);
    await p.waitForFunction(() => FLOW.result, null, { timeout: 900000 });
    stats[id === 'pdf' ? 'keyopen' : id] = await p.evaluate(() => Object.fromEntries([24, 48, 96].map(t => { tIdx = t; const fs = floodStats(frames[t]), s = infraStats(frames[t]), b = buildingStats(frames[t]); return [`t${t / 12}h`, { area_ha: +fs.total.toFixed(1), deep_ha: +(fs.c2 + fs.c3).toFixed(1), maxD: +fs.maxD.toFixed(2), roadcut_km: +s.km[0].toFixed(1), bld: b.total, q: FLOW.result.q[t].map(v => +v.toFixed(0)) }]; })));
    console.log(id, await p.evaluate(() => [24, 48, 96].map(t => { tIdx = t; const fs = floodStats(frames[t]); const s = infraStats(frames[t]); const b = buildingStats(frames[t]); return `t${t / 12}h zr ${frames[t].gates[REGION.keyGate].zr.toFixed(2)} q ${FLOW.result.q[t].map(v => v.toFixed(0)).join('/')} area ${fs.total.toFixed(0)}ha max ${fs.maxD.toFixed(2)} roadcut ${s.km[0].toFixed(1)}km bld ${b.total}`; }).join('\n   ')));
  }
  // 時雨量情境 4 小時的堤內水深（公分，上限 255）→ 與臺北市水利處降雨積水模擬圖比對用
  stats.depth_preset = lastId;
  stats.rain_depth_cm_b64 = await p.evaluate(() => { const h = FLOW.result.h[48], u = new Uint8Array(h.length); for (let k = 0; k < h.length; k++) u[k] = DEM.mask[k] === 1 ? Math.min(255, Math.round(h[k] * 100)) : 0; let s = ''; for (let k = 0; k < u.length; k += 8192) s += String.fromCharCode.apply(null, u.subarray(k, k + 8192)); return btoa(s); });
  require('fs').writeFileSync(pre + '_stats.json', JSON.stringify(stats));
  await p.evaluate(() => { tIdx = 48; render(); });
  await p.waitForTimeout(2000);
  await p.screenshot({ path: pre + '_top.png' });
  await p.evaluate(() => showTab('map')); await p.waitForTimeout(300);
  const c = await p.$('.terrain-grid'); await c.scrollIntoViewIfNeeded(); await p.waitForTimeout(1500); await c.screenshot({ path: pre + '_terrain.png' });
  await p.evaluate(() => showTab('now')); await p.waitForTimeout(300);
  const pr = await p.$('#profile'); await pr.scrollIntoViewIfNeeded(); await pr.screenshot({ path: pre + '_profile.png' });
  await p.setViewportSize({ width: 400, height: 900 }); await p.waitForTimeout(500);
  console.log('errors', errs, 'mobile sw', await p.evaluate(() => document.documentElement.scrollWidth));
  await b.close();
})();
