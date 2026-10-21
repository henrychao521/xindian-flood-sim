// 回歸測試：比較兩個建置版本在同一情境下的計算結果
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const out = [];
  for (const f of process.argv.slice(2)) {
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + f);
    await p.evaluate(() => { P = JSON.parse(JSON.stringify(PRESETS[0].p)); P.rain = 0; recompute(); FLOW.result = null; });  // 只比較水門水理（雨型在階段 8 改過）
    await p.waitForFunction(() => FLOW.result, null, { timeout: 900000 });
    out.push(await p.evaluate(() => { const r = [48, 96].map(t => { tIdx = t; const fs = floodStats(frames[t]); return [frames[t].gates[2].zr.toFixed(3), frames[t].gates[2].zin.toFixed(3), fs.total.toFixed(2), FLOW.result.q[t].map(v => v.toFixed(2)).join('/')].join(' '); }); return r.join(' | '); }) + ' errs:' + errs.length);
    await p.close();
  }
  console.log(out.join('\n')); console.log(out.length === 2 && out[0] === out[1] ? 'SAME' : 'DIFF');
  await b.close();
})();
