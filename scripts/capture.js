// 用法：node capture.js <html> <scenario-json-list> <outdir>
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [html, listFile, outDir] = process.argv.slice(2);
  const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + html);
  await p.addStyleTag({ content: `#view3d{width:640px!important;height:400px!important} #capCap{position:absolute;left:12px;top:10px;background:rgba(255,255,255,.9);color:#111;font:600 14px "WenQuanYi Zen Hei",sans-serif;padding:8px 12px;border-radius:6px;line-height:1.45;z-index:5;pointer-events:none}` });
  await p.waitForTimeout(1500);
  for (const sc of list) {
    const dir = `${outDir}/${sc.id}`; fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    await p.evaluate(sc => {
      P = { Qpeak: 6750, tide: 1.6, tideSync: true, rain: sc.rain, sewerMM: 78.8, pumpMM: 60, avail: 100, C: 1.55, openPct: 100, closeAt: 8, gateOpen: sc.gate ? { [sc.gate]: true } : {} };
      if (!window.__real) { window.__real = T3.renderer.render.bind(T3.renderer); T3.renderer.render = () => {}; stepParticles = () => {}; T3.controls.enableDamping = false; }
      activePreset = null; syncControls(); recompute(); FLOW.result = null;
      if (timer) stop();
      T3.camera.position.set(-120, 95, 95); T3.controls.target.set(-55, 3, -5);
      let c = document.getElementById('capCap'); if (!c) { c = document.createElement('div'); c.id = 'capCap'; document.getElementById('view3d').appendChild(c); }
    }, sc);
    await p.waitForFunction(() => FLOW.result, null, { timeout: 600000 });
    const stats = [];
    let ts = 1000;
    for (let t = 0; t <= (process.env.QUICK ? 24 : 96); t += (process.env.QUICK ? 24 : 2)) {
      const st = await p.evaluate(({ t, ts, label }) => {
        tIdx = t; tPos = t; T3.dirty = true;
        for (let i = 0; i < 4; i++) { animate3D(ts + i * 40); }
        T3.controls.update(); window.__real(T3.scene, T3.camera);
        const fs = floodStats(frames[t]), inf = infraStats(frames[t]), bs = buildingStats(frames[t]);
        const q = FLOW.result.q[t].reduce((a, v) => a + Math.max(0, v), 0);
        document.getElementById('capCap').innerHTML = `${label}<br>${hhmm(frames[t].t)}・河水灌入 ${Math.round(q)} m³/s<br>堤內淹水 ${fs.total.toFixed(0)} ha・受影響建物 ${bs.total} 棟`;
        return { t, area: fs.total, deep: fs.c2 + fs.c3, road: inf.km[0], bld: bs.total, q };
      }, { t, ts, label: sc.label });
      ts += 160;
      stats.push(st);
      await (await p.$('#view3d')).screenshot({ path: `${dir}/f${String(t / 2).padStart(3, '0')}.png` });
    }
    fs.writeFileSync(`${dir}/stats.json`, JSON.stringify(stats));
    console.log(sc.id, 'done', Math.round((Date.now() - t0) / 1000) + 's', 'peak area', Math.max(...stats.map(s => s.area)).toFixed(1));
  }
  await b.close();
})();
