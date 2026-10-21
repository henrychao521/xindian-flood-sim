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
for r in regs:
    sw = sweep_summary(r["id"])
    if sw: r["sweep"] = sw
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
cards = []
for r in regs:
    res = r.get("results")
    gate_word = "假想缺口" if r.get("auto_gates") else "疏散門"
    stats = (f'<dl><div><dt>堤內面積</dt><dd class="num">{r["inland_km2"]} km²</dd></div><div><dt>{gate_word}</dt><dd class="num">{r["gates"]}</dd></div>'
             f'<div><dt>抽水站</dt><dd class="num">{r["pumps"]}</dd></div></dl>'
             + (f'<dl class="res"><div><dt>{esc(res.get("keyopen_label", res["keyGate"] + "未關（計畫洪峰 80%，4 h）"))}</dt><dd class="num">{res["keyopen_ha"]:.0f} ha</dd></div>'
                f'<div><dt>時雨量 110 mm・1 小時（4 h）</dt><dd class="num">{res["rain_ha"]:.0f} ha</dd><dt>・水深 ≥ 0.5 m</dt><dd class="num">{res["rain_deep_ha"]:.0f} ha</dd></div></dl>' if res else "")
             + (f'<dl class="res"><div><dt>短延時 100 mm/h：本模型／水利處圖</dt><dd class="num">{r["compare"]["100"]["model_ha"]:.0f}／{r["compare"]["100"]["official_ha"]:.0f} ha</dd><dt>・命中</dt><dd class="num">{(r["compare"]["100"]["hit_rate"] or 0) * 100:.0f}%</dd></div></dl>' if r.get("compare", {}).get("100") else "")
             ) if "inland_km2" in r else \
            ('<dl><div><dt>特色</dt><dd>本專案起點：颱風預報換算、五座疏散門、示範影片</dd></div></dl>'
             + (f'<dl class="res"><div><dt>{esc(res["keyopen_label"])}</dt><dd class="num">{res["keyopen_ha"]:.0f} ha</dd></div>'
                f'<div><dt>時雨量 110 mm・1 小時（4 h）</dt><dd class="num">{res["rain_ha"]:.0f} ha</dd><dt>・水深 ≥ 0.5 m</dt><dd class="num">{res["rain_deep_ha"]:.0f} ha</dd></div></dl>' if res else "")
             + (f'<dl class="res"><div><dt>短延時 100 mm/h：本模型／水利處圖</dt><dd class="num">{r["compare"]["100"]["model_ha"]:.0f}／{r["compare"]["100"]["official_ha"]:.0f} ha</dd><dt>・命中</dt><dd class="num">{(r["compare"]["100"]["hit_rate"] or 0) * 100:.0f}%</dd></div></dl>' if r.get("compare", {}).get("100") else ""))
    if r.get("sweep"):
        sw = r["sweep"]
        stats += (f'<dl class="res"><div><dt>GPU 情境集合尖峰（1 h）78.8／100／130 mm/h</dt><dd class="num">{sw["peak"]["78.8"]:.0f}／{sw["peak"]["100"]:.0f}／{sw["peak"]["130"]:.0f} ha</dd></div>'
                  + (f'<div><dt>抽水可用率 30%・100 mm/h</dt><dd class="num">{sw["pump30_100"]:.0f} ha</dd></div>' if sw["pump30_100"] is not None else "") + '</dl>')
    cards.append(f'''      <a class="card" href="{r["href"]}">
        <h2>{esc(r["title"])}</h2>
        <p>{esc(r.get("districts", "萬華、中正、大安"))}・{esc(r["river"])}</p>
        {stats}
      </a>''')
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
  --accent: #0e6a86; --accent-soft: #dcecf2;
  --font-display: "Noto Serif TC", "Songti TC", serif;
  --font-body: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
  --font-data: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  color-scheme: light;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{ --bg: #0c151c; --surface: #13202a; --ink: #e2ebf1; --muted: #8fa2b0; --line: #243540; --accent: #45b8d6; --accent-soft: #173444; color-scheme: dark; }}
}}
:root[data-theme="dark"] {{ --bg: #0c151c; --surface: #13202a; --ink: #e2ebf1; --muted: #8fa2b0; --line: #243540; --accent: #45b8d6; --accent-soft: #173444; color-scheme: dark; }}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; }}
body {{ background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 14px; line-height: 1.55; }}
main {{ max-width: 1180px; margin: 0 auto; padding: 28px 16px 48px; display: grid; gap: 20px; }}
h1 {{ font-family: var(--font-display); font-size: clamp(24px, 3.4vw, 34px); margin: 0; line-height: 1.25; }}
.lede {{ margin: 6px 0 0; color: var(--muted); max-width: 70ch; }}
.layout {{ display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 20px; align-items: start; }}
@media (max-width: 860px) {{ .layout {{ grid-template-columns: 1fr; }} }}
.map {{ position: relative; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--surface); }}
.map img {{ display: block; width: 100%; height: auto; }}
.box {{ position: absolute; border: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); border-radius: 3px; text-decoration: none; }}
.box:hover, .box:focus-visible {{ background: color-mix(in srgb, var(--accent) 30%, transparent); outline: none; }}
.box span {{ position: absolute; left: 3px; top: 2px; font-size: 11px; font-weight: 700; color: #0b2430; background: rgba(255,255,255,.85); padding: 0 4px; border-radius: 3px; white-space: nowrap; }}
.cards {{ display: grid; gap: 10px; }}
.card {{ display: block; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; color: inherit; text-decoration: none; }}
.card:hover, .card:focus-visible {{ border-color: var(--accent); outline: none; }}
.card h2 {{ font-size: 15px; margin: 0; color: var(--accent); }}
.card p {{ margin: 2px 0 6px; color: var(--muted); font-size: 13px; }}
dl {{ display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 0; }}
dl div {{ display: flex; gap: 6px; align-items: baseline; }}
dt {{ color: var(--muted); font-size: 12px; }}
dd {{ margin: 0; font-size: 13px; }}
.res {{ margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--line); }}
.num {{ font-family: var(--font-data); font-variant-numeric: tabular-nums; }}
.notes {{ background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px; color: var(--muted); font-size: 13px; }}
.notes ul {{ margin: 6px 0 0; padding-left: 20px; }}
footer {{ color: var(--muted); font-size: 12px; }}
footer a, .notes a {{ color: var(--accent); }}
</style>
</head>
<body>
<main>
  <header>
    <h1>臺北市河川淹水模擬</h1>
    <p class="lede">從新店溪出發，沿淡水河、基隆河、景美溪把臺北市主要河段都做成互動模擬：調整洪水規模、潮位、雨量與疏散門狀態，看哪座水門先被漫過、堤內哪裡會淹。點地圖上的框或右側卡片進入各河段。</p>
  </header>
  <div class="layout">
    <div class="map">
      <img src="map.jpg" width="{w}" height="{h}" alt="臺北市 20 m 地形暈渲圖，標出各河段模擬範圍">
{boxes}
    </div>
    <div class="cards">
{chr(10).join(cards)}
    </div>
  </div>
  <section class="notes">
    <b>共同的模型設定</b>
    <ul>
      <li>地形：內政部 2025 年 20 m DEM；堤線沿河道邊緣自動建立，必要處依地形與 OpenStreetMap 手動補描。</li>
      <li>河道水位以「計畫洪峰流量的百分比」在常水位與計畫洪水位之間內插，屬示意，不是水理演算。</li>
      <li>疏散門位置以臺北市水利處疏散門清單（data.taipei）為準，OSM 補足；士林・社子與北投・關渡兩份資料都沒有疏散門，頁面上的「水門」是依道路穿越堤線處設定的假想缺口。</li>
      <li>堤內淹水以二維局部慣性淺水波法計算，排水系統依臺北市雨水下水道與抽水站設計標準。</li>
      <li>雨型是以 T+3 h 為中心、長度等於「降雨延時」的定強度降雨；「時雨量 110 mm」情境是 1 小時。每個頁面都可疊上臺北市水利處「降雨積水模擬圖」（112 年版）對照。</li>
      <li>各河段範圍邊界視為封閉，相鄰河段之間的水不互通。</li>
      <li>卡片上的公頃數是固定情境在 4 小時時的堤內淹水面積（水深 ≥ 0.1 m），用來比較各河段的相對規模，不是淹水潛勢圖。「短延時 100 mm/h」一列是本模型與臺北市水利處降雨積水模擬圖（112 年版）的對照：平地河段面積量級相近、山區河段偏高，位置命中率多在兩成以下，街道尺度的積水點請看各頁面的疊圖。</li>
    </ul>
  </section>
  <footer>
    教學與情境比較用的簡化模擬，不是官方淹水預報或疏散指示。
    資料：內政部國土測繪中心 20 m DEM（政府資料開放授權條款第 1 版）、臺北市 3D 近似建物模型（經 <a href="https://github.com/sheethub/tpe3d">sheethub/tpe3d</a> 轉換）、臺北市抽水站、© OpenStreetMap contributors（ODbL）。
    原始碼：<a href="https://github.com/henrychao521/xindian-flood-sim">github.com/henrychao521/xindian-flood-sim</a>
  </footer>
</main>
</body>
</html>
'''
(OUT / "index.html").write_text(html, encoding="utf-8")
print("wrote", OUT / "map.jpg", w, h, len(regs), "regions")
