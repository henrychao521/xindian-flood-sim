"""畫出區域 DEM（格點座標）供描繪堤防：python3 scripts/region_plot.py <region_id> [extra.json]"""
import sys, json, pathlib, numpy as np, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
plt.rcParams["font.family"] = ["WenQuanYi Zen Hei"]
ROOT = pathlib.Path(__file__).resolve().parent.parent
cfg = json.loads((ROOT / f"regions/{sys.argv[1]}.json").read_text())
d = np.load(ROOT / "work/taipei_dem20.npz"); G = d["G"]; X0, Y0 = float(d["x0"]), float(d["y0"])
xa, ya, xb, yb = cfg["bbox"]
Z = G[int((ya - Y0) // 20):int((yb - Y0) // 20), int((xa - X0) // 20):int((xb - X0) // 20)]
ny, nx = Z.shape
fig, ax = plt.subplots(figsize=(nx / 18, ny / 18))
ax.imshow(np.where(np.isnan(Z), -3, Z), origin="lower", cmap="gist_earth", vmin=cfg.get("vmin", 0), vmax=cfg.get("vmax", 12))
yy, xx = np.where(Z > cfg.get("ridge", 7.5)); ax.plot(xx, yy, "r.", ms=1.2)
for p in cfg.get("levee", []):
    a = np.array(p); ax.plot(a[:, 0], a[:, 1], "y-", lw=1.5)
pump = ROOT / "data/raw/taipei_pump_stations.csv"
import csv
for r in csv.DictReader(open(pump, encoding="utf-8-sig")):
    x, y = float(r["X坐標"]), float(r["Y坐標"])
    if xa <= x <= xb and ya <= y <= yb: ax.plot((x - xa) / 20, (y - ya) / 20, "c^", ms=6); ax.text((x - xa) / 20, (y - ya) / 20, r["站名"], fontsize=6, color="c")
for g in cfg.get("osmGates", []):
    ax.plot((g["x"] - xa) / 20, (g["y"] - ya) / 20, "ms", ms=5); ax.text((g["x"] - xa) / 20, (g["y"] - ya) / 20, g["n"].replace("疏散門", ""), fontsize=6, color="m")
ax.set_xticks(range(0, nx, 10)); ax.set_yticks(range(0, ny, 10)); ax.tick_params(labelsize=5); ax.grid(alpha=.3)
out = ROOT / f"work/{sys.argv[1]}_plot.png"; plt.savefig(out, dpi=55, bbox_inches="tight"); print(out, Z.shape)
