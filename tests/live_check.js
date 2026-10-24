// 即時面板檢查：讀取民生公共物聯網測站 → 表格 → 用實測雨量模擬 → 模型管網欄。用法：node live_check.js <html> <outprefix>
const { chromium } = require('playwright');
(async () => {
  const [html, pre] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.goto('file://' + html); await p.waitForTimeout(1500);
  await p.evaluate(() => liveLoad());
  await p.waitForFunction(() => !LIVE.loading && (LIVE.at || LIVE.err), null, { timeout: 120000 });
  console.log('status:', await p.evaluate(() => $("liveWhen").textContent));
  console.log(await p.evaluate(() => [...document.querySelectorAll('#liveBody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()).join(' | ')).join('\n')));
  await p.evaluate(() => showTab('live')); await p.waitForTimeout(300);
  const sec = await p.$('#livePanel'); await sec.scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await sec.screenshot({ path: pre + '_panel.png' });
  await p.evaluate(() => showTab('map')); await p.waitForTimeout(500);
  const cw = await p.$('.contour-wrap'); await cw.scrollIntoViewIfNeeded(); await p.waitForTimeout(800); await cw.screenshot({ path: pre + '_map.png' });
  await p.evaluate(() => { document.querySelector('.livePumpOff') && (document.querySelector('.livePumpOff').checked = true); $("liveFuture").value = "slider"; P.rain = 100; liveRun(); FLOW.result = null; });
  console.log('run:', await p.evaluate(() => [$("liveRunNote").textContent, $("clock").textContent, P.simHours, P.rainSeries.length, P.t0, P.pumpFail]));
  await p.waitForFunction(() => FLOW.result, null, { timeout: 900000 });
  await p.evaluate(() => { render(); renderLive(); });
  console.log('after flow:', await p.evaluate(() => [...document.querySelectorAll('#liveBody tr')].map(tr => { const c = [...tr.children]; return c[0].textContent.trim() + ' obs ' + c[6].textContent.trim().slice(0, 12) + ' model ' + c[8].textContent.trim(); }).join('\n')));
  console.log('t=now stats:', await p.evaluate(() => { const fs = floodStats(frames[tIdx]); return [hhmm(frames[tIdx].t), fs.total.toFixed(1) + ' ha']; }));
  await p.evaluate(() => { tIdx = frames.length - 1; render(); });
  console.log('t=end stats:', await p.evaluate(() => { const fs = floodStats(frames[tIdx]); return [hhmm(frames[tIdx].t), fs.total.toFixed(1) + ' ha']; }));
  await p.setViewportSize({ width: 400, height: 900 }); await p.waitForTimeout(500);
  console.log('errors', errs, 'mobile sw', await p.evaluate(() => document.documentElement.scrollWidth));
  await b.close();
})();
