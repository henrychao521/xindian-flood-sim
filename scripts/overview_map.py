"""全市總覽底圖：20 m DEM 暈渲圖＋各河段範圍 → overview/map.jpg、overview/regions.json、overview/index.html
用法：python3 scripts/overview_map.py（需先跑 scripts/mosaic.py）"""
import json, pathlib, numpy as np
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from matplotlib.colors import LightSource

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "overview"; OUT.mkdir(exist_ok=True)
d = np.load(ROOT / "work/taipei_dem20.npz"); G = d["G"].astype(float); X0, Y0 = float(d["x0"]), float(d["y0"])
ny, nx = G.shape
# 新店溪頁面不在 regions/ 內，範圍取自 data/processed/demW.json
dw = json.loads((ROOT / "data/processed/demW.json").read_text())
regs = [{"id": "xindian", "href": "../", "title": "新店溪（萬華・中正・大安）", "river": "新店溪",
         "bbox": [dw["x0"], dw["y0"], dw["x0"] + dw["nx"] * dw["d"], dw["y0"] + dw["ny"] * dw["d"]]}]
xc = ROOT / "data/processed/xindian/compare_100.json"
if xc.exists(): regs[0]["compare"] = {"100": json.loads(xc.read_text(encoding="utf-8"))["ge15cm"]}
xr = ROOT / "data/processed/xindian/results.json"  # 新店溪頁面：PRESETS=pdf,rain 跑 tests/region_check.js 的結果
if xr.exists():
    rs = json.loads(xr.read_text(encoding="utf-8"))
    regs[0]["results"] = {"keyGate": rs["keyGate"], "keyopen_label": "PDF 情境：馬場町門未關（外水 7.0 m，4 h）", "keyopen_ha": rs["keyopen"]["t4h"]["area_ha"],
                          "rain_ha": rs["rain"]["t4h"]["area_ha"], "rain_deep_ha": rs["rain"]["t4h"]["deep_ha"]}
for rid in ["tamsui", "shilin", "zhongshan", "neihu", "jingmei", "beitou"]:
    f = ROOT / f"regions/{rid}.json"
    if not f.exists() or not (ROOT / rid / "index.html").exists(): continue
    c = json.loads(f.read_text(encoding="utf-8"))
    s = json.loads((ROOT / f"data/processed/{rid}/summary.json").read_text(encoding="utf-8"))
    rec = {"id": rid, "href": f"../{rid}/", "title": c["title"].replace("淹水模擬器", ""), "river": c["river"], "districts": c["districts"],
           "bbox": c["bbox"], "inland_km2": s["inland_km2"], "gates": len(s["gates"]), "pumps": len(s["pumps"]), "auto_gates": s.get("auto_gates", 0)}
    cmp = {}
    for case in ("100", "130"):  # scripts/compare_inundation.py：短延時情境 vs 水利處降雨積水模擬圖
        cf = ROOT / f"data/processed/{rid}/compare_{case}.json"
        if cf.exists(): cmp[case] = json.loads(cf.read_text(encoding="utf-8"))["ge15cm"]
    if cmp: rec["compare"] = cmp
    rf = ROOT / f"data/processed/{rid}/results.json"  # tests/region_check.js 的情境結果（4 小時）
    if rf.exists():
        rs = json.loads(rf.read_text(encoding="utf-8"))
        rec["results"] = {"keyGate": rs["keyGate"], "keyopen_ha": rs["keyopen"]["t4h"]["area_ha"], "rain_ha": rs["rain"]["t4h"]["area_ha"], "rain_deep_ha": rs["rain"]["t4h"]["deep_ha"]}
    regs.append(rec)
def sweep_summary(rid):  # Colab GPU 情境集合：1 h 定強度、設計排水的尖峰淹水面積，與抽水可用率 30% 的對照
    sf = ROOT / f"data/processed/{rid}/sweep.json"
    if not sf.exists(): return None
    sw = json.loads(sf.read_text(encoding="utf-8")); sc = sw["scenarios"]
    pick = lambda dr, I, hr=1: next((s for s in sc if s["drain"] == dr and s["hours"] == hr and s["rain"] == I), None)
    d = {I: pick("design", I) for I in (78.8, 100, 130)}; p30 = pick("pump30", 100)
    if not all(d.values()): return None
    return {"peak": {str(I): d[I]["area_peak"] for I in d}, "pump30_100": p30["area_peak"] if p30 else None, "n": len(sc)}
def river_summary(rid):  # 水門失效情境集合：關鍵水門未關在三種洪水規模（潮位 1.6 m）的尖峰面積，與最大洪水＋暴潮、水門全關（只越堤）
    rf = ROOT / f"data/processed/{rid}/river.json"
    if not rf.exists(): return None
    rv = json.loads(rf.read_text(encoding="utf-8")); sc = rv["scenarios"]; Qs = rv["Qpeaks"]; kg = f"g{rv['keyGate']}"
    pick = lambda Q, td, g: next((s for s in sc if s["Qpeak"] == Q and s["tide"] == td and s["gates"] == g), None)
    qs = [Qs[1], Qs[2], Qs[-1]]; ks = [pick(Q, 1.6, kg) for Q in qs]; ov = pick(Qs[-1], 2.0, "none")
    if not all(ks) or not ov: return None
    lab = "／".join(f"{Q}%" if rv["qUnit"] == "%" else f"{Q:,}" for Q in qs) + ("" if rv["qUnit"] == "%" else " m³/s")
    return {"key": rv["gateNames"][rv["keyGate"]], "qlabel": lab, "peaks": [k["area_peak"] for k in ks], "overtop": ov["area_peak"], "overtop_label": (f"{Qs[-1]}%" if rv["qUnit"] == "%" else f"{Qs[-1]:,} m³/s") + "＋暴潮 2.0 m、水門全關"}
for r in regs:
    sw = sweep_summary(r["id"])
    if sw: r["sweep"] = sw
    rv = river_summary(r["id"])
    if rv: r["riversweep"] = rv  # 不能叫 river：那是河名
# 只裁出有資料的範圍（臺北市界外為 NaN）
rows = np.where(~np.isnan(G).all(axis=1))[0]; cols = np.where(~np.isnan(G).all(axis=0))[0]
r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
Gc = G[r0:r1, c0:c1]; ex = [X0 + c0 * 20, X0 + c1 * 20, Y0 + r0 * 20, Y0 + r1 * 20]
ls = LightSource(azdeg=315, altdeg=45)
Zf = np.nan_to_num(Gc, nan=0.0)
from matplotlib.colors import LinearSegmentedColormap
land = LinearSegmentedColormap.from_list("land", [(0, "#eef1e4"), (0.04, "#dfe8c9"), (0.15, "#c3d49e"), (0.4, "#98ad74"), (0.75, "#8a7a5c"), (1, "#f2efe9")])
rgb = ls.shade(np.clip(Zf, 0, 1100), cmap=land, vert_exag=2, blend_mode="soft", vmin=0, vmax=1100)
rgb[np.isnan(Gc)] = [0.93, 0.94, 0.95, 1]
water = ~np.isnan(Gc) & (Gc < 1.0)
rgb[water] = [0.55, 0.75, 0.9, 1]
h, w = Gc.shape
fig = plt.figure(figsize=(w / 100, h / 100), dpi=100); ax = fig.add_axes([0, 0, 1, 1]); ax.axis("off")
ax.imshow(rgb, extent=ex, origin="lower", interpolation="bilinear")
fig.savefig(OUT / "map.jpg", dpi=70, pil_kwargs={"quality": 85}); plt.close(fig)
w, h = round(w * 0.7), round(h * 0.7)
for r in regs:  # 以底圖百分比記錄範圍（左、上、寬、高）
    a, b, c_, e = r["bbox"]
    r["box"] = [round((a - ex[0]) / (ex[1] - ex[0]) * 100, 2), round((ex[3] - e) / (ex[3] - ex[2]) * 100, 2),
                round((c_ - a) / (ex[1] - ex[0]) * 100, 2), round((e - b) / (ex[3] - ex[2]) * 100, 2)]
(OUT / "regions.json").write_text(json.dumps({"extent": ex, "size": [w, h], "regions": regs}, ensure_ascii=False, indent=1), encoding="utf-8")

# ---- 總覽頁 ----
def esc(t): return str(t).replace("&", "&amp;").replace("<", "&lt;")
boxes = "\n".join(
    f'      <a class="box" href="{r["href"]}" style="left:{r["box"][0]}%;top:{r["box"][1]}%;width:{r["box"][2]}%;height:{r["box"][3]}%" '
    f'aria-label="{esc(r["title"])}"><span>{esc(r["title"].split("（")[0])}</span></a>' for r in regs)
cards, chart_rows = [], []
SHORT = {"xindian": "新店溪", "tamsui": "淡水河東岸", "shilin": "基隆河下游", "zhongshan": "基隆河中游", "neihu": "基隆河上游", "jingmei": "景美溪", "beitou": "基隆河出海段"}
def fmt_ha(v): return "—" if v is None else f"{v:,.0f}"
for r in regs:
    rid = r["id"]; rv = r.get("riversweep"); sw = r.get("sweep"); cmp100 = r.get("compare", {}).get("100")
    gate_word = "假想缺口" if r.get("auto_gates") else "疏散門"
    facts = (f'<span>堤內 <b class="num">{r["inland_km2"]}</b> km²</span><span>{gate_word} <b class="num">{r["gates"]}</b></span><span>抽水站 <b class="num">{r["pumps"]}</b></span>'
             if "inland_km2" in r else '<span>本專案起點：颱風預報換算、五座疏散門、示範影片</span>')
    q_mid = rv["qlabel"].split("／")[1] if rv else ""
    if rv and "m³/s" in rv["qlabel"] and not q_mid.endswith("m³/s"): q_mid += " m³/s"
    tiles = []
    if rv: tiles.append(("gate", f'{esc(rv["key"])}未關', f'洪峰 {q_mid}・潮位 1.6 m', rv["peaks"][1]))
    if sw: tiles.append(("rain", "時雨量 130 mm", "1 小時・排水設計值", sw["peak"]["130"]))
    if sw and sw.get("pump30_100") is not None: tiles.append(("pump", "抽水站只剩 30%", "時雨量 100 mm・1 小時", sw["pump30_100"]))
    tile_html = "".join(f'<div class="tile tile-{k}"><span class="t-label">{a}</span><span class="t-value num">{fmt_ha(v)}<small>ha</small></span><span class="t-sub">{b}</span></div>' for k, a, b, v in tiles)
    foot = []
    if rv:
        q5 = rv["overtop_label"].split("＋")[0]
        foot.append(f'洪峰 {q5}＋暴潮、水門全關：' + (f'越堤淹 <b class="num">{fmt_ha(rv["overtop"])}</b> ha' if rv["overtop"] >= 1 else '河水仍低於堤頂，不越堤'))
    cf_ = ROOT / f"data/processed/{rid}/closure.json"  # 搶險封堵時間（scripts/flow_torch.py closure）
    if cf_.exists():
        cl = json.loads(cf_.read_text(encoding="utf-8")); Q0 = min(x["Qpeak"] for x in cl["scenarios"] if x["kind"] == "close")
        kk = {x["closeAt"]: x["area_peak"] for x in cl["scenarios"] if x["kind"] == "close" and x["gates"] == "key" and x["Qpeak"] == Q0}
        if kk.get(99, 0) >= 5:
            foot.append(f'{esc(cl["gateNames"][cl["keyGate"]])}未關：1 小時內封堵尖峰淹水 <b class="num">{kk[1]:.0f}</b> ha、沒封堵 <b class="num">{kk[99]:.0f}</b> ha（少淹 <b class="num">{(1 - kk[1] / kk[99]) * 100:.0f}%</b>）')
    nf = ROOT / f"data/processed/{rid}/nari_results.json"
    if nf.exists():
        nr = json.loads(nf.read_text(encoding="utf-8")); good = sum(x["verdict"] == "量級相符" for x in nr["records"]); tot = sum(x["verdict"] != "範圍內沒有這些路名" for x in nr["records"])
        foot.append(f'納莉颱風重建（實測雨量）：最大淹水 <b class="num">{nr["maxArea"]}</b> ha' + (f'，紀錄 {tot} 處中 <b class="num">{good}</b> 處量級相符' if tot else ''))
    if cmp100: foot.append(f'水利處 100 mm/h 積水圖 <b class="num">{cmp100["official_ha"]:.0f}</b> ha，本模型同情境 <b class="num">{cmp100["model_ha"]:.0f}</b> ha、位置命中 <b class="num">{(cmp100["hit_rate"] or 0) * 100:.0f}%</b>')
    img = f"img/{rid}.jpg"
    cards.append(f'''      <a class="card" href="{r["href"]}">
        <div class="thumb"><img src="{img}" width="1200" height="675" loading="lazy" alt="{esc(r["title"])}的 3D 地形與建物（Blender 算圖）"></div>
        <div class="body">
          <h3>{esc(r["title"])}</h3>
          <p class="sub">{esc(r.get("districts", "萬華、中正、大安"))}・{esc(r["river"])}</p>
          <p class="facts">{facts}</p>
          <div class="tiles">{tile_html}</div>
          {"<ul class='foot'>" + "".join(f"<li>{x}</li>" for x in foot) + "</ul>" if foot else ""}
        </div>
      </a>''')
    if rv and sw: chart_rows.append((SHORT.get(rid, rid), r["href"], rv["peaks"][1], sw["peak"]["130"], rv["key"], q_mid))
# ---- 比較圖：各河段「關鍵水門未關」與「時雨量 130 mm」的尖峰淹水面積（同一個公頃軸、橫向分組長條；HTML 畫，手機上字不會縮小）----
def chart_html(rows):
    vmax = max([max(a, b) for _, _, a, b, *_ in rows] + [1]); step = 200 if vmax > 800 else 100 if vmax > 300 else 50
    vmax = (int(vmax / step) + 1) * step
    pct = lambda v: f"{v / vmax * 100:.2f}%"
    ticks = "".join(f'<span style="left:{pct(v)}">{v:,}</span>' for v in range(0, vmax + 1, step))
    grid = "".join(f'<i style="left:{pct(v)}"></i>' for v in range(0, vmax + 1, step))
    out = ['<div class="bars" role="table" aria-label="各河段尖峰淹水面積（公頃）">']
    for name, href, a, b, key, q in rows:
        bar = lambda val, cls, lab: f'<div class="bar {cls}" role="cell" tabindex="0" data-tip="{esc(name)}｜{esc(lab)}：{val:,.0f} ha" aria-label="{esc(lab)} {val:,.0f} 公頃"><span class="fill" style="width:{pct(val)}"></span><span class="v num">{val:,.0f}</span></div>'
        out.append(f'<div class="brow" role="row"><a class="bname" role="rowheader" href="{href}">{esc(name)}</a><div class="btrack">{grid}{bar(a, "s1", f"{key}未關・洪峰 {q}")}{bar(b, "s2", "時雨量 130 mm・1 小時")}</div></div>')
    out.append(f'<div class="brow axis" aria-hidden="true"><span class="bname"></span><div class="btrack ticks">{ticks}</div></div></div>')
    return "".join(out)
chart = chart_html(chart_rows) if chart_rows else ""
# 圖說由資料產生：哪些河段水門失效比大雨淹得多、哪些水門未關也不進水
gate_more = [n for n, _, a, b, *_ in chart_rows if a > b]; gate_zero = [n for n, _, a, *_ in chart_rows if a < 1]
chart_note = ("、".join(gate_more) + ("是唯一" if len(gate_more) == 1 else "是") + "水門失效比 130 mm/h 暴雨淹得多的河段" if gate_more else "各河段都是 130 mm/h 暴雨淹得比水門失效多") + "；" \
             + ("、".join(gate_zero) + "的水門底檻高於這個洪水位，水門未關也不進水，主要風險是大雨；" if gate_zero else "") \
             + "130 mm/h 的面積模型普遍高估，絕對值請看下方說明。"
# ---- 納莉颱風全市合併計算（scripts/merge_city.py）----
nari_city_html = ""
ncf = ROOT / "data/processed/city/nari_city.json"
if ncf.exists() and (OUT / "img/nari_city.png").exists():
    nc = json.loads(ncf.read_text(encoding="utf-8")); NAMES = {r["id"]: r["title"].split("（")[0] for r in regs}
    rows_ = []
    for rid_, v in nc["runs"]["open"]["regions"].items():
        c = nc["runs"]["closed"]["regions"][rid_]; ok_c = sum(x["verdict"] == "量級相符" for x in c["records"]); ok_o = sum(x["verdict"] == "量級相符" for x in v["records"])
        wet_c = sum(x["verdict"] in ("量級相符", "有淹、偏淺", "模型偏深") for x in c["records"]); wet_o = sum(x["verdict"] in ("量級相符", "有淹、偏淺", "模型偏深") for x in v["records"])
        nrec = sum(x["verdict"] != "範圍內沒有這些路名" for x in v["records"])
        rows_.append(f'<tr><td>{esc(NAMES.get(rid_, rid_))}</td><td class="r num">{c["max_env_ha"]:,.0f}</td><td class="r num">{v["max_env_ha"]:,.0f}</td><td class="r num">{nrec}</td><td class="r num">{wet_c}／{wet_o}</td><td class="r num">{ok_c}／{ok_o}</td></tr>')
    stream_html = ""
    scf = ROOT / "data/processed/city/nari_streamcap.json"
    if scf.exists():
        sc = json.loads(scf.read_text(encoding="utf-8")); LB = {"no_upstream": "沒有範圍外來水（基準）", "land_only": "只有山坡逕流（上限）"}
        cols = ["shilin", "zhongshan", "neihu", "jingmei", "beitou"]
        body = []
        for run in sc["runs"]:
            lab = LB.get(run["label"]) or ("溪流來水・排洪能力不限" if run["cap"] is None else f'溪流來水・每條溪 {run["cap"]} m³/s')
            sh = run["regions"]["shilin"]["records"][0] if run["regions"]["shilin"]["records"] else None
            body.append(f'<tr><td>{lab}</td>' + "".join(f'<td class="r num">{run["regions"][c]["max_env_ha"]:,.0f}</td>' for c in cols) + f'<td>{sh["verdict"] if sh else "—"}</td></tr>')
        up = sc.get("upstream") or {}
        stream_html = (f'<h3 style="font-size:14px;margin:8px 0 2px">範圍外來水與溪流排洪能力</h3><p class="hint">模擬範圍外還有 {up.get("area_km2", 0):.0f} km² 的山坡（陽明山、南港山區等）會流進市區。以 D8 流向找出入口，合理化公式（C = 0.7）配最近山區雨量站的逐時雨量估算流量：靠近溪流的灌進溪流、沿溪往下游累加，超過排洪能力的部分溢到地面；不靠近溪流的直接流到入口格（集中在一格，偏高，當上限看）。各溪流的實際排洪能力沒有公開資料，所以掃描幾個值。</p>'
                       f'<div class="table-wrap"><table class="nc"><thead><tr><th>情境（最大淹水 ha）</th><th class="r">士林</th><th class="r">中山</th><th class="r">內湖</th><th class="r">景美溪</th><th class="r">北投</th><th>士林忠誠路、德行東路（紀錄 1.0 m）</th></tr></thead><tbody>{"".join(body)}</tbody></table></div>')
    nari_city_html = f'''  <section class="panel nari-city" aria-labelledby="ncH">
    <h2 id="ncH">納莉颱風（2001/9/16 19:00–9/17 11:00）：全市合併計算</h2>
    <p class="hint">七個河段拼回同一張 20 m 網格、打開河段之間的邊界，讓內湖、南港越堤的水能往西流進松山、中山。雨量用各區氣象署測站實測值，河道水位依觀測峰值反推，抽水站依紀錄時刻失效。GPU 版計算 {nc["runs"]["open"]["seconds"]} 秒。</p>
    <div class="nc-grid">
      <div class="map nc-map"><img src="map.jpg" width="{w}" height="{h}" alt="臺北市地形"><img class="ov" src="img/nari_city.png" width="{w}" height="{h}" alt="納莉颱風全市合併計算的最大水深"></div>
      <div>
        <div class="legend"><span><i style="background:rgb(120,170,230)"></i>0.1–0.5 m</span><span><i style="background:rgb(40,110,200)"></i>0.5–1 m</span><span><i style="background:rgb(20,60,160)"></i>1–2 m</span><span><i style="background:rgb(60,20,120)"></i>≥ 2 m</span></div>
        <div class="table-wrap"><table class="nc"><thead><tr><th>河段</th><th class="r">最大淹水 ha（邊界封閉）</th><th class="r">打開邊界</th><th class="r">紀錄地點</th><th class="r">模型有淹 封閉／打開</th><th class="r">量級相符 封閉／打開</th></tr></thead><tbody>{"".join(rows_)}</tbody></table></div>
        {stream_html}
        <p class="hint">打開邊界後，中山河段多淹 {nc["extra_ha_by_region"].get("zhongshan", 0):,.0f} 公頃，水來自內湖、南港越堤。中山的紀錄地點有一處從沒淹變成有淹（內湖科學園區一帶），北安路、明水路與松河路一帶水深加深；但南港變淺：模型以每座水門一段越堤代表堤防缺口，灌進來的總水量比當年少。萬華、士林、北投的紀錄淹水來自地區排水、磺溪溢堤與工地進水，本模型沒有這些機制。</p>
      </div>
    </div>
  </section>
'''
html = f'''<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="臺北市各河段洩洪、潮位、降雨與疏散門失效的互動淹水模擬總覽。教學用簡化模型。">
<title>臺北市河川淹水模擬</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@700&display=swap">
<style>
:root {{
  --bg: #eef3f6; --surface: #ffffff; --ink: #12212b; --muted: #566875; --line: #d3dde4;
  --accent: #0e6a86; --accent-soft: #dcecf2; --s1: #2a78d6; --s2: #eb6834; --s3: #6b7a86;
  --font-display: "Noto Serif TC", "Songti TC", serif;
  --font-body: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
  --font-data: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  color-scheme: light;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{ --bg: #0c151c; --surface: #13202a; --ink: #e2ebf1; --muted: #8fa2b0; --line: #243540; --accent: #45b8d6; --accent-soft: #173444; --s1: #3987e5; --s2: #d95926; --s3: #8fa2b0; color-scheme: dark; }}
}}
:root[data-theme="dark"] {{ --bg: #0c151c; --surface: #13202a; --ink: #e2ebf1; --muted: #8fa2b0; --line: #243540; --accent: #45b8d6; --accent-soft: #173444; --s1: #3987e5; --s2: #d95926; --s3: #8fa2b0; color-scheme: dark; }}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; }}
body {{ background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 14px; line-height: 1.55; }}
main {{ max-width: 1240px; margin: 0 auto; padding: 32px 16px 56px; display: grid; gap: 28px; }}
.eyebrow {{ font-size: 12px; letter-spacing: .1em; color: var(--accent); font-weight: 700; margin: 0 0 6px; }}
h1 {{ font-family: var(--font-display); font-size: clamp(26px, 3.8vw, 40px); margin: 0; line-height: 1.2; }}
h2 {{ font-size: 17px; margin: 0 0 4px; }}
.lede {{ margin: 10px 0 0; color: var(--muted); max-width: 72ch; font-size: 15px; }}
.top {{ display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 20px; align-items: start; }}
@media (max-width: 900px) {{ .top {{ grid-template-columns: 1fr; }} }}
.panel {{ background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; min-width: 0; }}
.map {{ position: relative; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--surface); }}
.map img {{ display: block; width: 100%; height: auto; }}
.box {{ position: absolute; border: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); border-radius: 3px; text-decoration: none; }}
.box:hover, .box:focus-visible {{ background: color-mix(in srgb, var(--accent) 30%, transparent); outline: none; }}
.box span {{ position: absolute; left: 3px; top: 2px; font-size: 11px; font-weight: 700; color: #0b2430; background: rgba(255,255,255,.88); padding: 0 4px; border-radius: 3px; white-space: nowrap; }}
.hint {{ color: var(--muted); font-size: 12.5px; margin: 4px 0 0; }}
.legend {{ display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12.5px; color: var(--muted); margin: 8px 0 4px; }}
.legend i {{ display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -1px; margin-right: 5px; }}
.bars {{ display: grid; gap: 10px; margin-top: 6px; }}
.brow {{ display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 10px; align-items: center; }}
@media (max-width: 480px) {{ .brow {{ grid-template-columns: 1fr; gap: 3px; }} .brow.axis .bname {{ display: none; }} }}
.bname {{ font-size: 13px; font-weight: 500; color: var(--ink); text-decoration: none; text-align: right; }}
@media (max-width: 480px) {{ .bname {{ text-align: left; }} }}
a.bname:hover {{ color: var(--accent); text-decoration: underline; }}
.btrack {{ position: relative; display: grid; gap: 2px; padding-right: 44px; }}
.btrack > i {{ position: absolute; top: -3px; bottom: -3px; width: 1px; background: var(--line); }}
.bar {{ position: relative; height: 14px; display: flex; align-items: center; outline: none; }}
.bar .fill {{ height: 100%; border-radius: 0 4px 4px 0; min-width: 1px; position: relative; z-index: 1; }}
.bar.s1 .fill {{ background: var(--s1); }} .bar.s2 .fill {{ background: var(--s2); }}
.bar .v {{ font-size: 11.5px; color: var(--muted); margin-left: 6px; position: relative; z-index: 1; }}
.bar:hover .fill, .bar:focus-visible .fill {{ filter: brightness(1.12); }}
.bar:focus-visible {{ box-shadow: 0 0 0 2px var(--accent); border-radius: 3px; }}
.ticks {{ height: 16px; }}
.ticks span {{ position: absolute; transform: translateX(-50%); font-family: var(--font-data); font-size: 11px; color: var(--muted); }}
svg.cmp {{ display: block; width: 100%; height: auto; overflow: visible; }}
svg.cmp text {{ font-family: var(--font-body); fill: var(--muted); font-size: 12px; }}
svg.cmp .row {{ fill: var(--ink); font-size: 13px; font-weight: 500; }}
svg.cmp a:hover .row {{ fill: var(--accent); text-decoration: underline; }}
svg.cmp .val {{ font-family: var(--font-data); font-size: 11.5px; fill: var(--muted); }}
svg.cmp .tick {{ font-family: var(--font-data); font-size: 11px; }}
svg.cmp .grid {{ stroke: var(--line); stroke-width: 1; }}
svg.cmp .s1 {{ fill: var(--s1); }} svg.cmp .s2 {{ fill: var(--s2); }}
svg.cmp .hit {{ fill: transparent; }}
svg.cmp .bar:hover path, svg.cmp .bar:focus path {{ opacity: .8; }} svg.cmp .bar:focus {{ outline: none; }}
.tip {{ position: fixed; pointer-events: none; background: var(--ink); color: var(--surface); font-size: 12.5px; padding: 5px 9px; border-radius: 6px; z-index: 10; max-width: 280px; }}
.section-head {{ display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }}
.cards {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }}
@media (max-width: 400px) {{ .cards {{ grid-template-columns: 1fr; }} }}
.card {{ display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; color: inherit; text-decoration: none; transition: border-color .15s, transform .15s; }}
.card:hover, .card:focus-visible {{ border-color: var(--accent); transform: translateY(-2px); outline: none; }}
.thumb {{ aspect-ratio: 16 / 9; background: #dfe7ec; overflow: hidden; }}
.thumb img {{ display: block; width: 100%; height: 100%; object-fit: cover; }}
.body {{ padding: 12px 14px 14px; display: grid; gap: 8px; }}
.card h3 {{ font-size: 16px; margin: 0; color: var(--accent); line-height: 1.35; }}
.sub {{ margin: -4px 0 0; color: var(--muted); font-size: 13px; }}
.facts {{ margin: 0; display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 12.5px; color: var(--muted); }}
.facts b {{ color: var(--ink); font-weight: 500; }}
.tiles {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }}
.tile {{ background: var(--surface); padding: 8px 9px; display: grid; gap: 1px; min-width: 0; }}
.t-label {{ font-size: 12px; color: var(--ink); font-weight: 500; line-height: 1.3; }}
.tile-gate .t-label::before, .tile-rain .t-label::before, .tile-pump .t-label::before {{ content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: 1px; }}
.tile-gate .t-label::before {{ background: var(--s1); }} .tile-rain .t-label::before {{ background: var(--s2); }} .tile-pump .t-label::before {{ background: var(--s3); }}
.t-value {{ font-size: 21px; line-height: 1.2; }}
.t-value small {{ font-size: 12px; color: var(--muted); margin-left: 3px; font-family: var(--font-body); }}
.t-sub {{ font-size: 11.5px; color: var(--muted); line-height: 1.3; }}
@media (max-width: 440px) {{ .tiles {{ grid-template-columns: 1fr; }} .tile {{ grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; column-gap: 10px; }} .t-value {{ grid-row: span 2; text-align: right; }} }}
.foot {{ margin: 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; display: grid; gap: 2px; }}
.foot b {{ color: var(--ink); font-weight: 500; }}
.num {{ font-family: var(--font-data); font-variant-numeric: tabular-nums; }}
.notes {{ color: var(--muted); font-size: 13px; }}
.nari-city {{ display: grid; gap: 10px; }}
.nc-grid {{ display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 18px; align-items: start; }}
@media (max-width: 900px) {{ .nc-grid {{ grid-template-columns: minmax(0, 1fr); }} }}
.nc-map {{ position: relative; }} .nc-map .ov {{ position: absolute; inset: 0; width: 100%; height: 100%; }}
.table-wrap {{ overflow-x: auto; }}
table.nc {{ width: 100%; border-collapse: collapse; font-size: 13px; min-width: 520px; }}
table.nc th, table.nc td {{ padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: left; }}
table.nc th {{ font-size: 12px; color: var(--muted); font-weight: 500; }} table.nc .r {{ text-align: right; }}
.notes ul {{ margin: 6px 0 0; padding-left: 20px; display: grid; gap: 3px; }}
.notes b {{ color: var(--ink); }}
footer {{ color: var(--muted); font-size: 12px; }}
footer a, .notes a {{ color: var(--accent); }}
</style>
</head>
<body>
<main>
  <header>
    <p class="eyebrow">TAIPEI RIVER FLOOD SIMULATOR・7 個河段</p>
    <h1>臺北市河川淹水模擬</h1>
    <p class="lede">從新店溪出發，沿淡水河、基隆河、景美溪把臺北市主要河段都做成互動模擬：調整洪水規模、潮位、雨量與疏散門狀態，看哪座水門先被漫過、堤內哪裡會淹。每個河段另外在 GPU 上算了上百個降雨與水門失效情境，可以直接比較「多大的雨、哪座門」會淹多少。</p>
  </header>
  <div class="top">
    <div class="map">
      <img src="map.jpg" width="{w}" height="{h}" alt="臺北市 20 m 地形暈渲圖，標出各河段模擬範圍">
{boxes}
    </div>
    <section class="panel" aria-labelledby="cmpH">
      <h2 id="cmpH">哪個河段比較怕外水、哪個比較怕大雨？</h2>
      <p class="hint">尖峰淹水面積（8 小時內堤內水深 ≥ 0.1 m 的最大面積），GPU 情境集合結果。點河段名稱進入該頁。</p>
      <div class="legend"><span><i style="background:var(--s1)"></i>關鍵水門未關・計畫洪峰 100%（新店溪 7,000 m³/s）</span><span><i style="background:var(--s2)"></i>時雨量 130 mm・1 小時</span></div>
      {chart}
      <p class="hint">{chart_note}</p>
    </section>
  </div>
{nari_city_html}
  <section aria-labelledby="regH">
    <div class="section-head"><h2 id="regH">七個河段</h2><span class="hint">卡片數字都是尖峰淹水面積（公頃）；封面是 Blender 由同一份地形與建物資料算出的 3D 圖</span></div>
    <div class="cards">
{chr(10).join(cards)}
    </div>
  </section>
  <section class="panel notes">
    <b>共同的模型設定</b>
    <ul>
      <li>地形：內政部 2025 年 20 m DEM；堤線沿河道邊緣自動建立，必要處依地形與 OpenStreetMap 手動補描。頁面 3D 與卡片封面的地形底圖（暈渲、環境遮蔽、建物落影）由 Blender 依同一份資料算出。</li>
      <li>河道水位以「計畫洪峰流量的百分比」在常水位與計畫洪水位之間內插，屬示意，不是水理演算；超過 120% 時各河段的面積主要來自越堤，絕對值只能看相對順序。</li>
      <li>疏散門位置以臺北市水利處疏散門清單（data.taipei）為準，OSM 補足；士林・社子與北投・關渡兩份資料都沒有疏散門，頁面上的「水門」是依道路穿越堤線處設定的假想缺口。</li>
      <li>堤內淹水以二維局部慣性淺水波法計算，排水系統依臺北市雨水下水道（78.8 mm/hr）與抽水站設計標準；GPU 情境集合用同一套模型的 PyTorch 移植版在 Colab 批次計算，與瀏覽器結果逐格一致。</li>
      <li>雨型是以 T+3 h 為中心、長度等於「降雨延時」的定強度降雨。和臺北市水利處「降雨積水模擬圖」（112 年版）比：平地河段面積量級相近、山區河段偏高，位置命中率多在兩成以下（本模型是 20 m 網格、集總式下水道、沒有排水溪流），街道尺度的積水點請看各頁面的疊圖。</li>
      <li>各河段範圍邊界視為封閉，相鄰河段之間的水不互通。</li>
    </ul>
  </section>
  <footer>
    教學與情境比較用的簡化模擬，不是官方淹水預報或疏散指示。
    資料：內政部國土測繪中心 20 m DEM（政府資料開放授權條款第 1 版）、臺北市 3D 近似建物模型（經 <a href="https://github.com/sheethub/tpe3d">sheethub/tpe3d</a> 轉換）、臺北市抽水站、臺北市疏散門資訊、臺北市降雨積水模擬圖、© OpenStreetMap contributors（ODbL）。
    原始碼：<a href="https://github.com/henrychao521/xindian-flood-sim">github.com/henrychao521/xindian-flood-sim</a>
  </footer>
</main>
<div class="tip" id="tip" hidden></div>
<script>
// 比較圖的滑鼠／鍵盤提示
(() => {{
  const tip = document.getElementById("tip");
  const show = (el, x, y) => {{ tip.textContent = el.dataset.tip; tip.hidden = false; tip.style.left = Math.min(x + 12, innerWidth - tip.offsetWidth - 8) + "px"; tip.style.top = (y + 14) + "px"; }};
  document.querySelectorAll(".bars .bar").forEach(el => {{
    el.addEventListener("mousemove", e => show(el, e.clientX, e.clientY));
    el.addEventListener("mouseleave", () => tip.hidden = true);
    el.addEventListener("focus", () => {{ const r = el.getBoundingClientRect(); show(el, r.left + r.width / 3, r.top); }});
    el.addEventListener("blur", () => tip.hidden = true);
  }});
}})();
</script>
</body>
</html>
'''
(OUT / "index.html").write_text(html, encoding="utf-8")
print("wrote", OUT / "map.jpg", w, h, len(regs), "regions")

