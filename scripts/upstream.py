#!/usr/bin/env python3
"""溪流上游集水區入流：在全市 20 m DEM（work/taipei_dem20.npz）上算 D8 流向與累積面積，
找出每條溪流（data/processed/<id>/streams.json 的線，OSM 由上游畫到下游）上游端「不在任何河段堤內範圍」的集水面積
（例如磺溪、外雙溪上游的陽明山），再以合理化公式 Q = C·i·A（C＝0.7，颱風後期土壤飽和）配合最近山區雨量站的逐時雨量，
得到從溪流上游端灌進來的流量歷線。堤內範圍的雨由二維模型自己算，不重複計入。
輸出：data/processed/city/<preset>_upstream.json（每條溪流線：所屬河段、上游端格、上游面積 km²、雨量站、流量歷線 m³/s）
用法：python3 scripts/upstream.py [preset=nari]"""
import json, sys, math, heapq, pathlib
import numpy as np
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from look import load_dem, IDS
C_RUNOFF = 0.7

def d8_accumulate(G, weight):
    """priority-flood 填窪後的 D8 流向與加權累積面積（格數）"""
    H, W = G.shape; Z = np.where(np.isnan(G), -1e9, G).astype(np.float64); valid = ~np.isnan(G)
    filled = Z.copy(); done = np.zeros((H, W), bool); pq = []
    for j in range(H):
        for i in range(W):
            if valid[j, i] and (i == 0 or j == 0 or i == W - 1 or j == H - 1 or not (valid[max(j - 1, 0):j + 2, max(i - 1, 0):i + 2].all())):
                heapq.heappush(pq, (Z[j, i], j, i)); done[j, i] = True
    nb = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    order = []
    while pq:
        zc, j, i = heapq.heappop(pq); order.append(j * W + i)
        for dj, di in nb:
            a, b = j + dj, i + di
            if 0 <= a < H and 0 <= b < W and valid[a, b] and not done[a, b]:
                done[a, b] = True; filled[a, b] = max(Z[a, b], zc + 1e-4); heapq.heappush(pq, (filled[a, b], a, b))
    # 流向：最陡下降（填窪後必有下坡或同高的出口）
    down = np.full(H * W, -1, np.int64); F = filled.ravel()
    for k in order:
        j, i = divmod(k, W); best, bs = -1, 0.0
        for dj, di in nb:
            a, b = j + dj, i + di
            if 0 <= a < H and 0 <= b < W and valid[a, b]:
                s = (F[k] - F[a * W + b]) / (1.4142 if dj and di else 1.0)
                if s > bs: bs, best = s, a * W + b
        down[k] = best
    return order, down

def accumulate(order, down, w):
    acc = w.ravel().astype(np.float64).copy()
    for k in reversed(order):  # 由高到低
        if down[k] >= 0: acc[down[k]] += acc[k]
    return acc

def main(preset="nari"):
    g = np.load(ROOT / "work/taipei_dem20.npz"); G = g["G"].astype(np.float64); X0, Y0 = float(g["x0"]), float(g["y0"]); H, W = G.shape
    inland = np.zeros((H, W), bool); covered = np.zeros((H, W), bool); offs = {}
    for rid in IDS:
        d, z, m = load_dem(rid); c0, r0 = int(round((d["x0"] - X0) / 20)), int(round((d["y0"] - Y0) / 20)); offs[rid] = (c0, r0, d)
        inland[r0:r0 + d["ny"], c0:c0 + d["nx"]] |= (m == 1); covered[r0:r0 + d["ny"], c0:c0 + d["nx"]] = True
    weight = (~covered & ~np.isnan(G)).astype(np.float64)  # 不在任何河段範圍內的有資料格（範圍內的雨由二維模型算；主河道也在範圍內，不會被當成上游）
    print("D8 on", W, "x", H, "…", flush=True); order, down = d8_accumulate(G, weight)
    jj, ii = np.mgrid[0:H, 0:W]
    acc = accumulate(order, down, weight).reshape(H, W)                     # 上游（範圍外）格數
    accx = accumulate(order, down, weight * (X0 + (ii + 0.5) * 20)).reshape(H, W); accy = accumulate(order, down, weight * (Y0 + (jj + 0.5) * 20)).reshape(H, W)
    st = {s["stationID"]: s for s in json.loads((ROOT / "work/nari/tp_stations.json").read_text())}
    have = [k for k in st if (ROOT / f"work/nari/rain_{k}.json").exists()]
    T0h, HOURS = 19, 16
    def series(stn):
        dd = {t: v for t, v in json.loads((ROOT / f"work/nari/rain_{stn}.json").read_text())}
        out = []
        for k in range(HOURS):
            hh = T0h + k + 1; day = 16 + hh // 24; hr = hh % 24
            key = f"2001-09-{day - 1:02d}T23:59:00" if hr == 0 else f"2001-09-{day:02d}T{hr:02d}:00:00"
            v = dd.get(key); out.append(max(0.0, v) if isinstance(v, (int, float)) else 0.0)
        return out
    # 入口：範圍外的格，D8 下一格落在某河段堤內 → 範圍外逕流從這裡進入模擬範圍（每格只流出一次，不會重複計算）
    down2 = down.reshape(H, W); dn = down2[~covered & ~np.isnan(G)]; src = np.flatnonzero((~covered & ~np.isnan(G)).ravel())
    inl_flat = inland.ravel(); ok = (dn >= 0) & inl_flat[np.maximum(dn, 0)]
    inlets = {}
    for k, m in zip(src[ok], dn[ok]):
        a = acc.ravel()[k]; e = inlets.setdefault(int(m), [0.0, 0.0, 0.0]); e[0] += a; e[1] += accx.ravel()[k]; e[2] += accy.ravel()[k]
    # 溪流線的堤內格（全市座標）→ 線索引
    line_of, line_meta = {}, []
    for rid in IDS:
        sj = ROOT / f"data/processed/{rid}/streams.json"
        if not sj.exists(): continue
        c0, r0, d = offs[rid]; _, _, mm_ = load_dem(rid)
        for li, (name, pts) in enumerate(json.loads(sj.read_text())["lines"]):
            gi = len(line_meta); line_meta.append({"region": rid, "line": li, "name": name})
            for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
                n_ = max(1, int(math.hypot(xb - xa, yb - ya) / 5))
                for s_ in np.linspace(0, 1, n_ + 1):
                    il, jl = int((xa + (xb - xa) * s_) // 20), int((ya + (yb - ya) * s_) // 20)
                    if 0 <= il < d["nx"] and 0 <= jl < d["ny"] and mm_[jl, il] == 1: line_of.setdefault((jl + r0) * W + il + c0, gi)
    lc = np.array(list(line_of.keys())); lj, lI = lc // W, lc % W
    agg_line, agg_land = {}, {}
    for m, (a, sx, sy) in inlets.items():
        if a * 400 / 1e6 < 0.05: continue  # 太小的入口（< 5 公頃）忽略
        j, i = divmod(m, W); d2 = (lj - j) ** 2 + (lI - i) ** 2; nn = int(d2.argmin())
        if d2[nn] <= 10 ** 2:  # 200 m 內有溪流 → 進溪流
            e = agg_line.setdefault(line_of[int(lc[nn])], [0.0, 0.0, 0.0])
        else:  # 不靠近溪流 → 山坡逕流直接流到地面
            e = agg_land.setdefault(m, [0.0, 0.0, 0.0])
        e[0] += a; e[1] += sx; e[2] += sy
    def entry(a, sx, sy):
        X, Y = sx / a, sy / a; near = sorted(have, key=lambda k: math.hypot(st[k]["X"] - X, st[k]["Y"] - Y))[0]
        A = a * 400 / 1e6; rr = series(near)
        return {"area_km2": round(A, 2), "centroid": [round(X), round(Y)], "station": st[near]["stationName"], "q_m3s": [round(C_RUNOFF * r / 1000 / 3600 * A * 1e6, 2) for r in rr]}
    lines_out = [{**line_meta[g], **entry(*v)} for g, v in agg_line.items() if v[0] * 400 / 1e6 >= 0.3]
    land_out = [{"cell_mosaic": [int(m % W), int(m // W)], **entry(*v)} for m, v in agg_land.items() if v[0] * 400 / 1e6 >= 0.3]
    lines_out.sort(key=lambda l: -l["area_km2"])
    (ROOT / "data/processed/city").mkdir(parents=True, exist_ok=True)
    land_out.sort(key=lambda l: -l["area_km2"])
    (ROOT / f"data/processed/city/{preset}_upstream.json").write_text(json.dumps({"C": C_RUNOFF, "hours": HOURS, "mosaic_origin": [X0, Y0], "lines": lines_out, "land": land_out}, ensure_ascii=False, indent=1))
    for l in lines_out[:15]: print("stream", l["region"], l["name"], l["area_km2"], "km²", l["station"], "peak", max(l["q_m3s"]), "m³/s")
    for l in land_out[:8]: print("land", l["cell_mosaic"], l["area_km2"], "km²", l["station"], "peak", max(l["q_m3s"]), "m³/s")
    print(len(lines_out), "stream inflows,", len(land_out), "overland inflows; total area", round(sum(l["area_km2"] for l in lines_out + land_out), 1), "km²")

if __name__ == "__main__":
    main(*(a for a in sys.argv[1:] if not a.startswith("--")))
