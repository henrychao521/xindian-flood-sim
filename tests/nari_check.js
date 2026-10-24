// 納莉颱風歷史情境檢查：跑「歷史：納莉颱風」情境，存最大淹水面積、關鍵節點水位峰值、紀錄地點比對 → <outprefix>_nari.json
// 用法：node tests/nari_check.js <html> <outprefix>
const { chromium } = require('playwright');
(async () => {
  const [html, pre] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + html); await p.waitForTimeout(1500);
  const t0 = Date.now();
  await p.evaluate(() => { document.querySelector('.preset[data-id="nari"]').click(); FLOW.result = null; });
  await p.waitForFunction(() => FLOW.result, null, { timeout: 1500000 });
  await p.waitForTimeout(500);
  const out = await p.evaluate(() => {
    const A = []; for (let t = 0; t < frames.length; t += 12) { tIdx = t; const fs = floodStats(frames[t]); A.push(`${hhmm(frames[t].t)} ${fs.total.toFixed(0)}ha/${(fs.c2 + fs.c3).toFixed(0)}`); }
    const hm = maxDepthField(); let wet = 0, deep = 0; for (let k = 0; k < hm.length; k++) if (DEM.mask[k] === 1) { if (hm[k] >= 0.1) wet++; if (hm[k] >= 0.5) deep++; }
    const zr = frames.map(f => f.gates[REGION.keyGate].zr), pk = zr.indexOf(Math.max(...zr));
    return { frames: frames.length, series: A, maxArea: (wet * 0.04).toFixed(0), maxDeep: (deep * 0.04).toFixed(0), keyStagePeak: `${Math.max(...zr).toFixed(2)} at ${hhmm(frames[pk].t)}`, records: nariRecordStats().map(x => ({ district: x.district, where: x.where, depth: x.depth, med: x.med === null ? null : +x.med.toFixed(2), p90: x.p90 === null ? null : +x.p90.toFixed(2), segs: x.n, verdict: nariVerdict(x) })) };
  });
  console.log('nari', 'sec', Math.round((Date.now() - t0) / 1000), 'max', out.maxArea, 'ha, deep', out.maxDeep, 'ha, stage', out.keyStagePeak, out.records.map(x => x.verdict).join('/'), 'errors', errs);
  await p.evaluate(() => showTab('stats')); await p.waitForTimeout(300);
  const sec = await p.$('#nariPanel'); await sec.scrollIntoViewIfNeeded(); await sec.screenshot({ path: pre + '_nari.png' });
  require('fs').writeFileSync(pre + '_nari.json', JSON.stringify(out));
  await b.close();
})();
