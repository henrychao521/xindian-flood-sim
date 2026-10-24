// ---------------- 即時降雨與排水負荷（民生公共物聯網 SensorThings API）----------------
// 資料：中央氣象署自動雨量站（臺北市 72 站，每 10 分鐘）與臺北市水利處雨水下水道水位站（128 站，每 10 分鐘），
// 皆由 sta.colife.org.tw 提供，CORS 開放、不用金鑰，頁面直接讀、不經伺服器。
// 作法：測站投影到 TWD97 落到 20 m 格，雨量站依距離加權到各抽水站集水區，水位站算「滿管比例」＝（水位 − 管底）／管高；
// 「用實測雨量模擬」把過去 3 小時實測＋未來 2 小時外推當雨量序列送進同一套模型，抽水站是否運轉由使用者勾選（設備變因）。
const STA = "https://sta.colife.org.tw";
const LIVE = { rain: [], sewer: [], times: [], at: null, err: null, loading: false, timer: null, catch: null };
const LIVE_Q = {
  rain: `${STA}/STA_Rain/v1.0/Datastreams?$top=200&$filter=name eq 'Past10Min' and Thing/properties/CountyName eq '臺北市'&$select=id,name&$expand=Thing($select=name,properties),Thing/Locations($select=location),Observations($top=18;$orderby=phenomenonTime desc;$select=phenomenonTime,result)`,
  sewer: `${STA}/STA_RainSewer/v1.0/Datastreams?$top=200&$filter=name eq '水位' and Thing/properties/CountyName eq '臺北市'&$select=id,name,description&$expand=Thing($select=name,properties),Thing/Locations($select=location),Observations($top=18;$orderby=phenomenonTime desc;$select=phenomenonTime,result)`
};
// WGS84 → TWD97 TM2（中央經線 121°E、k₀ 0.9999、假東距 250,000 m、GRS80）
function toTWD97(lon, lat) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9999, lon0 = 121 * Math.PI / 180, E0 = 250000;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), e4 = e2 * e2, e6 = e4 * e2;
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180, sp = Math.sin(p), cp = Math.cos(p), tp = Math.tan(p);
  const N = a / Math.sqrt(1 - e2 * sp * sp), T = tp * tp, C = ep2 * cp * cp, A = (l - lon0) * cp;
  const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * p - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * p) + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * p) - 35 * e6 / 3072 * Math.sin(6 * p));
  const x = E0 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const y = k0 * (M + N * tp * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [x, y];
}
// 集水區：抽水站劃分（DRAIN.catch）；沒有抽水站的河段整區當一個集水區
function liveCatchments() {
  if (LIVE.catch) return LIVE.catch;
  const n = DEM.nx * DEM.ny, st = DRAIN.stations.length ? DRAIN.stations : [{ n: "全區", x: DEM.nx * DEM.d / 2, y: DEM.ny * DEM.d / 2 }];
  const cs = st.map(s => ({ name: s.n, cx: 0, cy: 0, cells: 0, gauges: [] }));
  for (let k = 0; k < n; k++) {
    if (DEM.mask[k] !== 1) continue;
    const c = DRAIN.stations.length ? DRAIN.catch[k] : 0; if (c < 0) continue;
    cs[c].cx += (k % DEM.nx + 0.5) * DEM.d; cs[c].cy += (((k / DEM.nx) | 0) + 0.5) * DEM.d; cs[c].cells++;
  }
  cs.forEach(c => { if (c.cells) { c.cx /= c.cells; c.cy /= c.cells; } });
  return (LIVE.catch = cs);
}
function liveParse(kind, data) {
  const out = [];
  (data.value || []).forEach(ds => {
    const th = ds.Thing || {}, loc = th.Locations && th.Locations[0] && th.Locations[0].location; if (!loc) return;
    const [X, Y] = toTWD97(loc.coordinates[0], loc.coordinates[1]), x = X - DEM.x0, y = Y - DEM.y0;
    const i = Math.floor(x / DEM.d), j = Math.floor(y / DEM.d), inside = i >= 0 && i < DEM.nx && j >= 0 && j < DEM.ny;
    const k = inside ? j * DEM.nx + i : -1, pr = th.properties || {};
    const obs = {}; (ds.Observations || []).forEach(o => { obs[o.phenomenonTime] = o.result; });
    const series = (ds.Observations || []).map(o => [new Date(o.phenomenonTime).getTime(), o.result]).sort((a, b) => a[0] - b[0]);
    const latest = ds.Observations && ds.Observations[0] ? ds.Observations[0].phenomenonTime : null;
    if (kind === "rain") {
      const margin = 3000;  // 範圍外 3 km 內的雨量站也拿來加權
      if (x < -margin || y < -margin || x > DEM.nx * DEM.d + margin || y > DEM.ny * DEM.d + margin) return;
      out.push({ id: pr.stationID, name: pr.stationName, town: pr.TownName, x, y, inside, obs, series, latest });
    } else {
      if (!inside || DEM.mask[k] !== 1) return;  // 只看本河段堤內的下水道水位站
      const base = /Base_Elev=([-\d.]+)/.exec(ds.description || ""), pipe = Number(pr.StationPipeDepth), manhole = Number(pr.StationManholeDepth);
      const c = DRAIN.stations.length ? DRAIN.catch[k] : 0;
      out.push({ id: pr.stationID, name: pr.stationName, x, y, k, catch: c, base: base ? Number(base[1]) : null, pipe: pipe > 0 ? pipe : null, manhole, obs, series, latest });
    }
  });
  return out;
}
async function liveLoad() {
  if (LIVE.loading) return; LIVE.loading = true; LIVE.err = null; renderLive();
  try {
    const [r, s] = await Promise.all([fetch(encodeURI(LIVE_Q.rain)), fetch(encodeURI(LIVE_Q.sewer))]);
    if (!r.ok || !s.ok) throw new Error(`HTTP ${r.status}/${s.status}`);
    LIVE.rain = liveParse("rain", await r.json()); LIVE.sewer = liveParse("sewer", await s.json());
    // 共同時間軸：以雨量站最新時刻為「現在」，往前 18 格（3 小時）
    const latest = LIVE.rain.map(g => g.latest).filter(Boolean).sort().pop();
    if (!latest) throw new Error("沒有雨量觀測");
    LIVE.at = new Date(latest); LIVE.times = Array.from({ length: 18 }, (_, i) => new Date(LIVE.at.getTime() - (17 - i) * 600000).toISOString().replace(".000Z", "Z"));
    LIVE.fetchedAt = new Date();
    liveAggregate();
  } catch (e) { LIVE.err = String(e.message || e); }
  LIVE.loading = false; renderLive(); if (frames.length) renderContour(frames[tIdx]);
}
// 測站在時刻 t（ISO）的觀測：取 ±5 分鐘內最近的一筆（各站回報的分鐘數不一定對齊），沒有就 undefined
function obsAt(st, t) {
  const ms = new Date(t).getTime(); let best, bd = 300001;
  for (const [m, v] of st.series) { const d = Math.abs(m - ms); if (d < bd) { bd = d; best = v; } }
  return best;
}
// 各集水區：雨量（最近 3 個雨量站反距離加權；缺測的站不參與該時刻的加權）、下水道滿管比例（有效站的中位數與最大）
function liveAggregate() {
  const cs = liveCatchments();
  cs.forEach(c => {
    const near = LIVE.rain.map(g => ({ g, d: Math.hypot(g.x - c.cx, g.y - c.cy) })).sort((a, b) => a.d - b.d).slice(0, 3);
    const wsum = near.reduce((a, n) => a + 1 / Math.max(200, n.d), 0);
    c.gauges = near.map(n => ({ name: n.g.name, w: (1 / Math.max(200, n.d)) / wsum, km: n.d / 1000 }));
    c.r10 = LIVE.times.map(t => {  // mm／10 分鐘
      const have = near.map(n => [obsAt(n.g, t), 1 / Math.max(200, n.d)]).filter(([v]) => v !== undefined);
      const w = have.reduce((a, [, wi]) => a + wi, 0); return w ? have.reduce((a, [v, wi]) => a + v * wi, 0) / w : 0;
    });
    c.missing = LIVE.times.reduce((a, t) => a + near.filter(n => obsAt(n.g, t) === undefined).length, 0);
    c.mm1h = c.r10.slice(12).reduce((a, v) => a + v, 0); c.mm3h = c.r10.reduce((a, v) => a + v, 0); c.mm10 = c.r10[17];
    const st = LIVE.sewer.filter(s => s.catch === cs.indexOf(c));
    const fresh = t => t && (LIVE.at - new Date(t)) <= 3600000;
    st.forEach(s => {
      const v = obsAt(s, LIVE.times[17]) ?? (s.latest ? s.obs[s.latest] : undefined);
      s.fill = (s.base !== null && s.pipe && v !== undefined && fresh(s.latest)) ? (v - s.base) / s.pipe : null;
      s.ok = s.fill !== null && s.fill > -0.5 && s.fill < 3;  // 高程設定有誤或離線的站剔除（例如管底高程比水位高 4 m 的）
      s.level = v;
    });
    const ok = st.filter(s => s.ok).map(s => s.fill).sort((a, b) => a - b);
    c.sewerN = st.length; c.sewerOk = ok.length; c.fillMed = ok.length ? ok[Math.floor(ok.length / 2)] : null; c.fillMax = ok.length ? ok[ok.length - 1] : null;
    c.fillMaxName = ok.length ? st.filter(s => s.ok).sort((a, b) => b.fill - a.fill)[0].name : "";
  });
}
function liveStatus(c) {
  if (c.mm1h >= 78.8 || (c.fillMax !== null && c.fillMax >= 1)) return ["超過設計", "var(--danger)"];
  if (c.mm1h >= 40 || c.mm10 >= 10 || (c.fillMax !== null && c.fillMax >= 0.7)) return ["注意", "var(--warn)"];
  if (c.mm1h > 0 || c.mm10 > 0) return ["有雨", "var(--accent)"];
  return ["無雨", "var(--muted)"];
}
const liveTime = d => { const x = new Date(d.getTime() + 8 * 3600000); return `${x.getUTCMonth() + 1}/${x.getUTCDate()} ${String(x.getUTCHours()).padStart(2, "0")}:${String(x.getUTCMinutes()).padStart(2, "0")}`; };
function renderLive() {
  const sec = $("livePanel"); if (!sec) return;
  const when = $("liveWhen"), body = $("liveBody");
  if (LIVE.loading) when.textContent = "讀取中…";
  else if (LIVE.err) when.textContent = `無法讀取（${LIVE.err}）；民生公共物聯網服務暫時無回應時會這樣，稍後再試`;
  else if (LIVE.at) when.textContent = `觀測時刻 ${liveTime(LIVE.at)}（臺灣時間）・雨量站 ${LIVE.rain.length} 站（範圍內 ${LIVE.rain.filter(g => g.inside).length}）・堤內下水道水位站 ${LIVE.sewer.length} 站・讀取於 ${liveTime(LIVE.fetchedAt)}`;
  else when.textContent = "尚未讀取";
  if (!LIVE.at) { body.innerHTML = `<tr><td colspan="9" class="hint">按「讀取最新觀測」。</td></tr>`; return; }
  const cs = liveCatchments(), sew = FLOW.result && P.live ? FLOW.result.sew[Math.min(P.live.nowIdx, FLOW.result.sew.length - 1)] : null;
  body.innerHTML = cs.map((c, i) => {
    const [label, color] = liveStatus(c);
    const fill = c.fillMed === null ? `<span class="hint">無有效站</span>` : `<b class="num">${Math.round(c.fillMed * 100)}%</b>／<b class="num">${Math.round(c.fillMax * 100)}%</b> <span class="hint">${c.fillMaxName}</span>`;
    const model = sew && DRAIN.stations.length ? `<b class="num">${Math.round(sew[i] * 100)}%</b>` : "—";
    return `<tr><td><b>${c.name}</b></td><td class="r num">${c.mm10.toFixed(1)}</td><td class="r num">${c.mm1h.toFixed(1)}</td><td class="r num">${c.mm3h.toFixed(1)}</td><td class="hint">${c.gauges.map(g => `${g.name} ${Math.round(g.w * 100)}%`).join("、")}${c.missing ? `・缺 ${c.missing} 筆` : ""}</td><td class="r num">${c.sewerOk}／${c.sewerN}</td><td class="r">${fill}</td><td><span class="pill" style="background:${color}">${label}</span></td><td class="r">${model}</td></tr>`;
  }).join("");
  // 設備變因：抽水站停機勾選（只建一次）
  const pumps = $("livePumps");
  if (pumps && !pumps.children.length) pumps.innerHTML = DRAIN.stations.length ? DRAIN.stations.map((s, i) => `<label class="check"><input type="checkbox" class="livePumpOff" data-i="${i}"> ${s.n.replace("抽水站", "")} 停機</label>`).join("") : `<span class="hint">本河段沒有抽水站，排水只靠重力閘門與溪流。</span>`;
  const note = $("liveNote");
  if (note) note.innerHTML = `雨量站是中央氣象署自動站，下水道水位站是臺北市水利處（經內政部國土管理署、民生公共物聯網 sta.colife.org.tw 發布，每 10 分鐘），座標投影到 20 m 格後依最近抽水站劃分集水區；雨量用最近三站反距離加權。「滿管比例」＝（水位 − 管底高程）／管高，1 代表水已到管頂，超過代表人孔內壅水；比例在 −50% 以下或 300% 以上視為站的高程設定或感測有誤，不納入。抽水站是否運轉沒有公開資料，請用上面的勾選當作變因；河道設為常水位（洪水規模可再用左側滑桿調高），下水道收水能力、抽水機可用率、潮位沿用左側滑桿。模擬用的是集水區面積加權的單一雨量序列，看不到各區雨量差異。`;
}
function liveRun() {
  if (!LIVE.at) { liveLoad().then(() => LIVE.at && liveRun()); return; }
  const cs = liveCatchments(), tot = cs.reduce((a, c) => a + c.cells, 0) || 1;
  const past = LIVE.times.map((_, t) => cs.reduce((a, c) => a + c.r10[t] * c.cells, 0) / tot * 6);  // mm/h
  const mode = $("liveFuture").value, last60 = past.slice(12).reduce((a, v) => a + v, 0) / 6;
  const fut = mode === "stop" ? 0 : mode === "last10" ? past[17] : mode === "last60" ? last60 : P.rain;
  const series = past.concat(Array(12).fill(fut));
  const t0 = new Date(LIVE.at.getTime() - 17 * 600000 + 8 * 3600000), pad = v => String(v).padStart(2, "0");
  const off = [...document.querySelectorAll(".livePumpOff:checked")].map(e => DRAIN.stations[Number(e.dataset.i)].n);
  P = { ...P, rainSeries: series, rainStepH: 1 / 6, simHours: 5, t0: `${t0.getUTCFullYear()}-${pad(t0.getUTCMonth() + 1)}-${pad(t0.getUTCDate())}T${pad(t0.getUTCHours())}:${pad(t0.getUTCMinutes())}`,
        Qpeak: REGION.qDesign ? 20 : 1500, tideSync: false, closeAt: 99, pumpFail: off.map(n => ({ name: n, at: 0 })), rain: Math.round(Math.max(...series)), rainHours: 1,
        live: { nowIdx: 17 * 2, future: mode, off } };  // 現在＝第 17 個 10 分鐘＝第 34 個 5 分鐘影格
  delete P.tp; delete P.qBase; delete P.tideT;
  tIdx = P.live.nowIdx; activePreset = null; syncControls(); recompute();
  $("liveRunNote").textContent = `已送出：${liveTime(new Date(LIVE.at.getTime() - 17 * 600000))} 起 3 小時實測（區域平均最大 ${Math.max(...past).toFixed(0)} mm/h、3 小時 ${(past.reduce((a, v) => a + v, 0) / 6).toFixed(0)} mm）＋未來 2 小時 ${fut.toFixed(0)} mm/h${off.length ? `；停機：${off.join("、")}` : ""}。時間軸顯示真實時刻，拖到觀測時刻以後就是預估。`;
}
// 地圖：下水道水位站（方塊，顏色＝滿管比例）、雨量站（圓點＋1 小時雨量）
function drawLiveOnMap(g) {
  const chk = $("liveShow"); if (!LIVE.at || (chk && !chk.checked)) return;
  const sc = CT.scale / DEM.d, H = DEM.ny * CT.scale;
  LIVE.sewer.forEach(s => {
    const x = s.x * sc, y = H - s.y * sc, f = s.ok ? s.fill : null;
    g.fillStyle = f === null ? "#9aa5ad" : f >= 1 ? "#c0392b" : f >= 0.7 ? "#e67e22" : f >= 0.3 ? "#2e86c1" : "#7fb3d5";
    g.fillRect(x - 5, y - 5, 10, 10); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.strokeRect(x - 5, y - 5, 10, 10);
  });
  LIVE.rain.filter(r => r.inside).forEach(r => {
    const x = r.x * sc, y = H - r.y * sc, mm = LIVE.times.slice(12).reduce((a, t) => a + (obsAt(r, t) ?? 0), 0);
    g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fillStyle = mm >= 40 ? "#c0392b" : mm > 0 ? "#1e8449" : "#5d6d7e"; g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.stroke();
    tag(g, x + 9, y + 4, `${r.name} 1 h ${mm.toFixed(0)} mm`, "left");
  });
}
function liveHover(k) {
  if (!LIVE.at) return "";
  const s = LIVE.sewer.find(s => s.k === k); if (!s) return "";
  return `・下水道水位站 ${s.name}：${s.ok ? `滿管 ${Math.round(s.fill * 100)}%（水位 EL. ${s.level} m，管底 ${s.base} m，管高 ${s.pipe} m）` : "無有效觀測或高程設定有誤"}`;
}
(() => {
  const b = $("liveLoad"); if (!b) return;
  b.addEventListener("click", liveLoad);
  $("liveRun").addEventListener("click", liveRun);
  $("liveShow").addEventListener("change", () => { if (frames.length) renderContour(frames[tIdx]); });
  $("liveAuto").addEventListener("change", e => { clearInterval(LIVE.timer); if (e.target.checked) { liveLoad(); LIVE.timer = setInterval(liveLoad, 600000); } });
})();
