#!/usr/bin/env python3
"""堤內明渠溪流 → 20 m 網格的「溪流格」→ data/processed/<id>/streams.json
來源：scripts/fetch_streams.py 下載的 OSM（work/streams/<id>.json）。
規則：waterway=river|stream 的明渠段（tunnel／covered 不算，已是雨水下水道的一部分）；canal 只取名稱含「溪」「溝」「分洪道」的明渠（灌溉圳路與無名渠道不算）；
主河道（基隆河、淡水河、新店溪、景美溪、大漢溪）排除；只留堤內格（mask＝1）。
輸出：{"cells": [格索引…], "lines": [[名稱, [[x, y]…]]…]（相對範圍左下角的公尺，畫地圖用）, "names": {名稱: 格數}}
用法：python3 scripts/build_streams.py [id …]"""
import json, sys, re, pathlib
import numpy as np
from pyproj import Transformer
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from look import load_dem, IDS
tf = Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True)
MAIN = {"基隆河", "淡水河", "新店溪", "景美溪", "大漢溪"}

def keep(t):
    if t.get("tunnel") or t.get("covered") == "yes": return False
    w, n = t.get("waterway"), t.get("name", "")
    if n in MAIN: return False  # 主河道由河道模型處理；落在堤內的是堤線沒描到的邊界殘段
    if w in ("river", "stream"): return True
    return w == "canal" and bool(re.search(r"溪|溝|分洪道", n))

def build(rid):
    d, z, m = load_dem(rid); nx, ny, x0, y0, dd = d["nx"], d["ny"], d["x0"], d["y0"], d["d"]
    src = json.loads((ROOT / f"work/streams/{rid}.json").read_text())
    cells, lines, names = set(), [], {}
    for e in src["elements"]:
        t = e.get("tags", {})
        if not keep(t) or "geometry" not in e: continue
        pts = [tf.transform(g["lon"], g["lat"]) for g in e["geometry"]]
        loc = [(x - x0, y - y0) for x, y in pts]
        mine = set()
        for (xa, ya), (xb, yb) in zip(loc, loc[1:]):
            n = max(1, int(np.hypot(xb - xa, yb - ya) / 5))
            for s in np.linspace(0, 1, n + 1):
                i, j = int((xa + (xb - xa) * s) // dd), int((ya + (yb - ya) * s) // dd)
                if 0 <= i < nx and 0 <= j < ny and m[j, i] == 1: mine.add(j * nx + i)
        if not mine: continue
        cells |= mine; nm = t.get("name", "無名溪流")
        names[nm] = names.get(nm, 0) + len(mine)
        lines.append([nm, [[round(x, 1), round(y, 1)] for x, y in loc]])
    out = {"cells": sorted(cells), "lines": lines, "names": dict(sorted(names.items(), key=lambda kv: -kv[1]))}
    (ROOT / "data/processed" / rid / "streams.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(rid, len(cells), "stream cells", list(out["names"].items())[:8])

if __name__ == "__main__":
    for rid in sys.argv[1:] or IDS:
        if (ROOT / f"work/streams/{rid}.json").exists(): build(rid)
        else: print(rid, "no download yet")
