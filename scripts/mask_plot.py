"""檢查用圖：遮罩（河道/堤內/堤線/遠處）＋ OSM 河川中線、堤防、疏散門。用法：python3 scripts/mask_plot.py <id>"""
import sys, json, base64, glob, pathlib, numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
import xml.etree.ElementTree as ET
from pyproj import Transformer
from matplotlib.colors import ListedColormap
ROOT = pathlib.Path(__file__).resolve().parent.parent; RID = sys.argv[1]
cfg = json.loads((ROOT / f"regions/{RID}.json").read_text(encoding="utf-8")); xa, ya = cfg["bbox"][:2]
t = Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True)
nodes, lines, gates = {}, [], []
for f in sorted(glob.glob(str(ROOT / f"work/{RID}/osm/*.osm"))):
    for ev, el in ET.iterparse(f):
        if el.tag == "node":
            nodes[el.get("id")] = (float(el.get("lon")), float(el.get("lat")))
            tg = {x.get("k"): x.get("v") for x in el.findall("tag")}
            if "疏散門" in tg.get("name", ""): gates.append((tg["name"], nodes[el.get("id")]))
        elif el.tag == "way":
            tg = {x.get("k"): x.get("v") for x in el.findall("tag")}
            if tg.get("waterway") in ("river", "stream", "canal") or tg.get("man_made") == "dyke":
                lines.append((tg.get("name", ""), "dyke" if tg.get("man_made") == "dyke" else "river", [x.get("ref") for x in el.findall("nd")]))
        if el.tag in ("node", "way", "relation"): el.clear()
d = json.load(open(ROOT / f"data/processed/{RID}/dem.json")); nx, ny = d["nx"], d["ny"]
m = np.frombuffer(base64.b64decode(d["mask"]), np.uint8).reshape(ny, nx)
plt.rcParams["font.family"] = ["WenQuanYi Zen Hei"]
fig, ax = plt.subplots(figsize=(nx / 18, ny / 18))
Zc = np.frombuffer(base64.b64decode(d["z"]), "<i2").reshape(ny, nx) / 100
ax.imshow(np.clip(Zc, 0, 12), origin="lower", cmap="gist_earth")
ax.imshow(np.ma.masked_where(m == 3, m), alpha=.45, origin="lower", cmap=ListedColormap(["#fdd", "#bdf", "#060", "#ddd"]), vmin=-.5, vmax=3.5)
for n, k, ids in lines:
    p = np.array([t.transform(*nodes[i]) for i in ids if i in nodes])
    if len(p) < 2: continue
    p = (p - [xa, ya]) / 20
    ax.plot(p[:, 0], p[:, 1], "-", color="b" if k == "river" else "r", lw=1.2)
    if n and k == "river" and 0 <= p[len(p) // 2][0] < nx and 0 <= p[len(p) // 2][1] < ny: ax.text(*p[len(p) // 2], n, fontsize=8, color="b", clip_on=True)
for n, ll in gates:
    X, Y = t.transform(*ll); ax.plot((X - xa) / 20, (Y - ya) / 20, "ms"); ax.text((X - xa) / 20 + 2, (Y - ya) / 20, n, fontsize=7, color="m", clip_on=True)
for s in cfg["inlandSeeds"]: ax.plot(*s, "r*", ms=12)
ax.set_xlim(0, nx); ax.set_ylim(0, ny); ax.set_xticks(range(0, nx, 10)); ax.set_yticks(range(0, ny, 10)); ax.grid(alpha=.3); ax.tick_params(labelsize=5)
plt.savefig(ROOT / f"work/{RID}/mask.png", dpi=55, bbox_inches="tight"); print("plot", ROOT / f"work/{RID}/mask.png")
