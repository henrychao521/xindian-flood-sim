"""全市總覽底圖：20 m DEM 暈渲圖＋各河段範圍 → overview/map.png、overview/regions.json
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
for rid in ["tamsui", "shilin", "zhongshan", "neihu", "jingmei", "beitou"]:
    f = ROOT / f"regions/{rid}.json"
    if not f.exists() or not (ROOT / rid / "index.html").exists(): continue
    c = json.loads(f.read_text(encoding="utf-8"))
    s = json.loads((ROOT / f"data/processed/{rid}/summary.json").read_text(encoding="utf-8"))
    regs.append({"id": rid, "href": f"../{rid}/", "title": c["title"].replace("淹水模擬器", ""), "river": c["river"], "districts": c["districts"],
                 "bbox": c["bbox"], "inland_km2": s["inland_km2"], "gates": len(s["gates"]), "pumps": len(s["pumps"])})
# 只裁出有資料的範圍（臺北市界外為 NaN）
rows = np.where(~np.isnan(G).all(axis=1))[0]; cols = np.where(~np.isnan(G).all(axis=0))[0]
r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
Gc = G[r0:r1, c0:c1]; ex = [X0 + c0 * 20, X0 + c1 * 20, Y0 + r0 * 20, Y0 + r1 * 20]
ls = LightSource(azdeg=315, altdeg=45)
Zf = np.nan_to_num(Gc, nan=0.0)
rgb = ls.shade(np.clip(Zf, -2, 400), cmap=plt.get_cmap("gist_earth"), vert_exag=3, blend_mode="soft", vmin=-60, vmax=600)
rgb[np.isnan(Gc)] = [0.93, 0.94, 0.95, 1]
water = ~np.isnan(Gc) & (Gc < 1.0)
rgb[water] = [0.55, 0.75, 0.9, 1]
h, w = Gc.shape
fig = plt.figure(figsize=(w / 100, h / 100), dpi=100); ax = fig.add_axes([0, 0, 1, 1]); ax.axis("off")
ax.imshow(rgb[::-1], extent=ex, origin="lower", interpolation="bilinear")
fig.savefig(OUT / "map.png", dpi=100); plt.close(fig)
for r in regs:  # 以底圖百分比記錄範圍（左、上、寬、高）
    a, b, c_, e = r["bbox"]
    r["box"] = [round((a - ex[0]) / (ex[1] - ex[0]) * 100, 2), round((ex[3] - e) / (ex[3] - ex[2]) * 100, 2),
                round((c_ - a) / (ex[1] - ex[0]) * 100, 2), round((e - b) / (ex[3] - ex[2]) * 100, 2)]
(OUT / "regions.json").write_text(json.dumps({"extent": ex, "size": [w, h], "regions": regs}, ensure_ascii=False, indent=1), encoding="utf-8")
print("wrote", OUT / "map.png", w, h, len(regs), "regions")
