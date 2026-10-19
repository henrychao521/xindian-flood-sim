// 河段頁面檢查：錯誤、各情境統計、截圖。用法：node region_check.js <html> <outprefix>
const { chromium } = require('playwright');
(async () => {
  const [html, pre] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + html); await p.waitForTimeout(1500);
  for (const id of ['keyopen', 'rain']) {
    await p.evaluate(id => { P = JSON.parse(JSON.stringify(PRESETS.find(x => x.id === id).p)); recompute(); FLOW.result = null; }, id);
    await p.waitForFunction(() => FLOW.result, null, { timeout: 900000 });
    console.log(id, await p.evaluate(() => [24, 48, 96].map(t => { tIdx = t; const fs = floodStats(frames[t]); const s = infraStats(frames[t]); const b = buildingStats(frames[t]); return `t${t / 12}h zr ${frames[t].gates[REGION.keyGate].zr.toFixed(2)} q ${FLOW.result.q[t].map(v => v.toFixed(0)).join('/')} area ${fs.total.toFixed(0)}ha max ${fs.maxD.toFixed(2)} roadcut ${s.km[0].toFixed(1)}km bld ${b.total}`; }).join('\n   ')));
  }
  await p.evaluate(() => { tIdx = 48; render(); });
  await p.waitForTimeout(2000);
  await p.screenshot({ path: pre + '_top.png' });
  const c = await p.$('.terrain-grid'); await c.scrollIntoViewIfNeeded(); await p.waitForTimeout(1500); await c.screenshot({ path: pre + '_terrain.png' });
  const pr = await p.$('#profile'); await pr.scrollIntoViewIfNeeded(); await pr.screenshot({ path: pre + '_profile.png' });
  await p.setViewportSize({ width: 400, height: 900 }); await p.waitForTimeout(500);
  console.log('errors', errs, 'mobile sw', await p.evaluate(() => document.documentElement.scrollWidth));
  await b.close();
})();
