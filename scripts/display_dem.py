#!/usr/bin/env python3
"""頁面 3D 與 Blender 用的「顯示高程」→ data/processed/<id>/disp.json（只影響畫面，水理仍用 dem.json）
- 取原始 20 m DEM（work/taipei_dem20.npz，scripts/mosaic.py 產生），不含前處理為了水理填平的山區窪地、也不截 320 m
- 臺北市界外（原始 DEM 無資料；dem.json 裡填成 20.0 m）以周邊高程平滑補值，另存 nodata 遮罩，畫面上淡化並註明
- 防洪牆格維持 dem.json 的堤頂高程（DEM 看不到窄牆）
格式：{"z": base64 int16 公寸, "nodata": base64 uint8（bit0＝市界外補值、bit1＝為畫面加寬的防洪牆）}
用法：python3 scripts/display_dem.py [id …]"""
import json, sys, base64, pathlib
import numpy as np
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from look import load_dem, IDS

def inpaint(z, hole, iters=800):
    z = z.copy(); z[hole] = np.nanmean(z[~hole]) if (~hole).any() else 0
    for _ in range(iters):
        p = np.pad(z, 1, mode="edge")
        avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4
        z[hole] = avg[hole]
    return z

def display(rid):
    d, z, m = load_dem(rid)
    g = np.load(ROOT / "work/taipei_dem20.npz"); G = g["G"]; X0, Y0 = float(g["x0"]), float(g["y0"])
    c0, r0 = int(round((d["x0"] - X0) / 20)), int(round((d["y0"] - Y0) / 20))
    R = G[r0:r0 + d["ny"], c0:c0 + d["nx"]].astype(np.float64)
    nod = np.isnan(R)
    R = inpaint(R, nod) if nod.any() else R
    R[m == 2] = np.maximum(R[m == 2], z[m == 2])
    # 斜向的防洪牆在高度網格上會變成一排鋸齒：往堤外（非堤內）的四鄰加寬一格，連成一道牆
    wall = np.zeros_like(nod)
    for dj, di in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        src = np.roll(np.roll(m == 2, dj, 0), di, 1); hz = np.roll(np.roll(np.where(m == 2, R, -1e9), dj, 0), di, 1)
        sel = src & (m != 1) & (m != 2) & ~nod
        R[sel] = np.maximum(R[sel], hz[sel]); wall |= sel
    return R, nod, wall

if __name__ == "__main__":
    for rid in sys.argv[1:] or IDS:
        R, nod, wall = display(rid)
        out = {"z": base64.b64encode(np.round(R * 10).astype("<i2").tobytes()).decode(), "nodata": base64.b64encode((nod.astype("u1") | (wall.astype("u1") << 1)).tobytes()).decode()}
        (ROOT / "data/processed" / rid / "disp.json").write_text(json.dumps(out))
        print(rid, "nodata cells", int(nod.sum()), "max %.0f m" % R.max())
