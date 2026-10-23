#!/usr/bin/env python3
"""全市合併網格：把七個河段同一情境的水流輸入（scripts/dump_preset_input.js 擷取）拼回內政部 20 m DEM 的同一張網格，
讓水能越過河段邊界（例如納莉颱風時內湖、南港越堤的水往西流進松山、中山），用 scripts/flow_torch.py 的分區模式計算。

- 河段範圍重疊的格：防洪牆＞堤內＞堤外＞對岸的優先順序決定由哪個河段「擁有」，同等級時給離自己範圍邊緣較遠的河段；地形、孔隙率、集水區取擁有者的
- 每個河段保留自己的雨量站雨量、河道水位（水門、越堤、重力排水、溪流排出的判斷）、抽水站與失效時刻
- closed：封閉河段之間的格邊，結果應等於各河段單獨計算（驗證拼接）；open：打開，看跨河段漫流
- 紀錄比對與頁面 src/nari.js 相同：道路名稱以紀錄路名開頭的路段，取所在格的最大水深
輸出：data/processed/city/<preset>_city.json（各河段統計、紀錄比對、封閉 vs 打開）、overview/img/<preset>_city.png（全市最大水深圖，疊在總覽底圖上）
用法：python3 scripts/merge_city.py [preset=nari] [--device mps|cuda|cpu]
      python3 scripts/merge_city.py nari --stream-caps   # 溪流排洪能力敏感度（每條溪流 ∞／200／100／50／20 m³/s）→ data/processed/city/nari_streamcap.json"""
import json, sys, base64, math, pathlib, time
import numpy as np
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
IDS = ["xindian", "tamsui", "shilin", "zhongshan", "neihu", "jingmei", "beitou"]
PRI = {2: 3, 1: 2, 0: 1, 3: 0}  # 擁有權優先順序

def b64(a, dt): return np.frombuffer(base64.b64decode(a), dtype=dt).copy()
def enc(a): return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()

def merge(preset):
    R = [json.loads((ROOT / f"work/flow_in/{rid}_{preset}.json").read_text()) for rid in IDS]
    g = np.load(ROOT / "work/taipei_dem20.npz"); X0, Y0 = float(g["x0"]), float(g["y0"])
    offs = [(int(round((r["x0"] - X0) / 20)), int(round((r["y0"] - Y0) / 20))) for r in R]
    c0 = min(o[0] for o in offs); r0 = min(o[1] for o in offs)
    c1 = max(o[0] + r["nx"] for o, r in zip(offs, R)); r1 = max(o[1] + r["ny"] for o, r in zip(offs, R))
    W, H = c1 - c0, r1 - r0; N = W * H
    z = np.zeros((H, W), np.float32); mask = np.full((H, W), 3, np.uint8); psi = np.ones((H, W), np.float32)
    catch = np.full((H, W), -1, np.int64); owner = np.full((H, W), -1, np.int64); pri = np.full((H, W), -1, np.int8)
    edist = np.full((H, W), -1, np.int32)
    catchZone, failAt, gates, streams, cOff, lines_ = [], [], [], [], 0, []
    for ri, (r, (ox, oy)) in enumerate(zip(R, offs)):
        nx, ny = r["nx"], r["ny"]; sl = (slice(oy - r0, oy - r0 + ny), slice(ox - c0, ox - c0 + nx))
        zz = b64(r["z_f32"], np.float32).reshape(ny, nx); mm = b64(r["mask_u8"], np.uint8).reshape(ny, nx)
        pp = b64(r["psi_f32"], np.float32).reshape(ny, nx); cc = b64(r["catch_i32"], np.int32).reshape(ny, nx).astype(np.int64)
        pr = np.vectorize(PRI.get)(mm).astype(np.int8)
        # 同等級時交給離自己範圍邊緣較遠（較靠內部）的河段：避免某河段水門入口格被劃給相鄰河段
        jj, ii = np.mgrid[0:ny, 0:nx]; edge = np.minimum(np.minimum(ii, nx - 1 - ii), np.minimum(jj, ny - 1 - jj)).astype(np.int32)
        take = (pr > pri[sl]) | ((pr == pri[sl]) & (edge > edist[sl]))
        edist[sl][take] = edge[take]
        for arr, src in ((z, zz), (mask, mm), (psi, pp)): arr[sl][take] = src[take]
        catch[sl][take] = np.where(cc[take] >= 0, cc[take] + cOff, -1); owner[sl][take] = ri; pri[sl][take] = pr[take]
        catchZone += [ri] * r["nCatch"]; failAt += list(r["failAt"] or [1e9] * r["nCatch"]); cOff += r["nCatch"]
        loc2glob = lambda k: (k // nx + oy - r0) * W + (k % nx + ox - c0)
        for gt in r["gates"]: gates.append({**gt, "entry": int(loc2glob(gt["entry"])), "zone": ri})
        streams += [int(loc2glob(k)) for k in r["stream"]]
        # 溪流線（由上游到下游，OSM 水道的繪製方向）→ 依序經過的堤內格
        sj = ROOT / f"data/processed/{IDS[ri]}/streams.json"
        if sj.exists():
            for li_, (_, pts) in enumerate(json.loads(sj.read_text())["lines"]):
                seq = []
                for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
                    n_ = max(1, int(math.hypot(xb - xa, yb - ya) / 5))
                    for s_ in np.linspace(0, 1, n_ + 1):
                        i_, j_ = int((xa + (xb - xa) * s_) // 20), int((ya + (yb - ya) * s_) // 20)
                        if 0 <= i_ < nx and 0 <= j_ < ny and mm[j_, i_] == 1:
                            k_ = int(loc2glob(j_ * nx + i_))
                            if not seq or seq[-1] != k_: seq.append(k_)
                if seq: lines_.append((IDS[ri], li_, seq))
    streams = sorted({k for k in streams if mask.flat[k] == 1})
    seen, streamLines, lineKey = set(), [], {}  # 每格只屬於一條溪流（先出現的）
    for rid_, li_, seq in lines_:
        q = [k for k in seq if mask.flat[k] == 1 and k not in seen]; seen.update(q)
        if q: lineKey[(rid_, li_)] = len(streamLines); streamLines.append(q)
    owner[owner < 0] = 0
    base = R[0]
    for key in ("sewerMM", "pumpMM", "avail", "storeMM", "gravityEL", "C", "openPct", "simHours", "frameSec", "n"):
        assert all(abs(r[key] - base[key]) < 1e-9 for r in R), key
    inp = {"nx": W, "ny": H, "d": 20, "n": base["n"], "simHours": base["simHours"], "frameSec": base["frameSec"], "sewerMM": base["sewerMM"], "pumpMM": base["pumpMM"],
           "avail": base["avail"], "storeMM": base["storeMM"], "gravityEL": base["gravityEL"], "C": base["C"], "openPct": base["openPct"], "closeAt": base["closeAt"],
           "nCatch": cOff, "z_f32": enc(z), "mask_u8": enc(mask), "psi_f32": enc(psi), "catch_i32": enc(catch.astype(np.int32)), "zrOut": base["zrOut"],
           "gates": [{k: v for k, v in gt.items() if k != "zone"} for gt in gates], "stream": streams, "streamLines": streamLines, "zone": owner.ravel(), "owner": owner.ravel(), "catchZone": catchZone, "failAt": failAt}
    scen = {"rainZ": [r["rain"] for r in R], "zrOutZ": [r["zrOut"] for r in R], "sewerMM": base["sewerMM"], "pumpMM": base["pumpMM"], "avail": base["avail"],
            "streams": bool(base["streamOn"]), "open": [gt["open"] for gt in gates], "zr": [gt["zr"] for gt in gates]}
    meta = {"W": W, "H": H, "c0": c0, "r0": r0, "offs": offs, "x0": X0 + c0 * 20, "y0": Y0 + r0 * 20, "inland_cells": int((mask == 1).sum()), "lineKey": lineKey}
    # 範圍外集水區入流（scripts/upstream.py）：溪流線入流與山坡入流，逐時 → 每 5 分鐘一格
    up = ROOT / f"data/processed/city/{preset}_upstream.json"
    if up.exists():
        U = json.loads(up.read_text()); nF = len(base["rain"]); fr = base["frameSec"]
        tofr = lambda q: [q[min(len(q) - 1, int(k * fr / 3600))] for k in range(nF)]
        sq = [[0.0] * nF for _ in streamLines]; used = 0
        for l in U["lines"]:
            gi = lineKey.get((l["region"], l["line"]))
            if gi is not None: sq[gi] = [a + b for a, b in zip(sq[gi], tofr(l["q_m3s"]))]; used += 1
        landCells, landQ = [], []
        for l in U["land"]:
            i, j = l["cell_mosaic"][0] - c0, l["cell_mosaic"][1] - r0
            if 0 <= i < W and 0 <= j < H and mask[j, i] == 1: landCells.append(int(j * W + i)); landQ.append(tofr(l["q_m3s"]))
        meta["upstream"] = {"stream_lines_used": used, "stream_lines_total": len(U["lines"]), "land_used": len(landCells), "land_total": len(U["land"]),
                            "area_km2": round(sum(l["area_km2"] for l in U["lines"] + U["land"]), 1)}
        scen["streamQin"] = sq; scen["landQin"] = landQ; inp["landCells"] = landCells
    return R, inp, scen, meta, mask, owner

def road_segs(rid, nx, ny, d, mask_local):
    f = ROOT / ("data/processed/osm2.json" if rid == "xindian" else f"data/processed/{rid}/osm.json")
    segs = []
    for rd in json.loads(f.read_text())["roads"]:
        p = rd["p"]
        for (x1, y1), (x2, y2) in zip(p, p[1:]):
            L = math.hypot(x2 - x1, y2 - y1); n = max(1, math.ceil(L / 20))
            for s in range(n):
                xm = x1 + (x2 - x1) * (s + 0.5) / n; ym = y1 + (y2 - y1) * (s + 0.5) / n
                i, j = int(xm // d), int(ym // d)
                if 0 <= i < nx and 0 <= j < ny and mask_local[j, i] != 3: segs.append((rd.get("n", ""), j * nx + i, L / n))
    return segs

def verdict(med, p90, lo, hi):
    if med is None: return "範圍內沒有這些路名"
    if p90 < 0.3: return "模型幾乎沒淹"
    if med > hi + 1: return "模型偏深"
    if med < lo * 0.5: return "有淹、偏淺"
    return "量級相符"

def records(rid, r, hm_local):
    nf = ROOT / f"data/processed/{rid}/nari.json"
    if not nf.exists(): return []
    mask_local = b64(r["mask_u8"], np.uint8).reshape(r["ny"], r["nx"]); segs = road_segs(rid, r["nx"], r["ny"], r["d"], mask_local)
    out = []
    for rec in json.loads(nf.read_text())["records"]:
        sel = [(k, L) for nm, k, L in segs if nm and mask_local.flat[k] == 1 and any(nm.startswith(x) for x in rec["roads"])]
        dvals = sorted(float(hm_local.flat[k]) for k, _ in sel)
        rng = [float(x) for x in rec["depth"].replace("m", "").replace(" ", "").replace("–", "-").split("-")]; lo, hi = rng[0], rng[-1]
        med = dvals[len(dvals) // 2] if dvals else None; p90 = dvals[int(len(dvals) * 0.9)] if dvals else None
        out.append({"district": rec["district"], "where": rec["where"], "depth": rec["depth"], "segs": len(sel), "med": None if med is None else round(med, 2), "p90": None if p90 is None else round(p90, 2), "verdict": verdict(med, p90, lo, hi)})
    return out

def city_png(hm, mask, meta, path):
    """全市最大水深圖：透明底，裁成總覽底圖（overview/regions.json 的 extent）範圍，疊在 map.jpg 上"""
    from PIL import Image
    ov = json.loads((ROOT / "overview/regions.json").read_text()); ex = ov["extent"]; w, h = ov["size"]
    img = np.zeros((meta["H"], meta["W"], 4), np.uint8); d = np.where(mask == 1, hm, 0)
    for lo, rgb, a in ((0.1, (120, 170, 230), 150), (0.5, (40, 110, 200), 200), (1.0, (20, 60, 160), 225), (2.0, (60, 20, 120), 235)):
        sel = d >= lo; img[sel, :3] = rgb; img[sel, 3] = a
    img = img[::-1]  # 北朝上
    big = Image.new("RGBA", (int(round((ex[1] - ex[0]) / 20)), int(round((ex[3] - ex[2]) / 20))), (0, 0, 0, 0))
    ox = int(round((meta["x0"] - ex[0]) / 20)); oy = int(round((ex[3] - (meta["y0"] + meta["H"] * 20)) / 20))
    big.alpha_composite(Image.fromarray(img, "RGBA"), (max(0, ox), max(0, oy)))
    big.resize((w, h), Image.NEAREST).save(path, optimize=True)

CAPS = [None, 300, 150, 80, 40]  # 每條溪流的排洪能力 m³/s（None＝無限）；另加一個「沒有上游入流」的基準
def stream_caps(preset, device):
    import flow_torch as ft
    R, inp, scen, meta, mask, owner = merge(preset)
    print("stream lines", len(inp["streamLines"]), "cells", sum(len(l) for l in inp["streamLines"]), flush=True)
    print("upstream", meta.get("upstream"), flush=True)
    base0 = {k: v for k, v in scen.items() if k not in ("streamQin", "landQin")}
    nL = len(inp.get("landCells") or []); nF_ = len(scen["rainZ"][0])
    streams_only = {**scen, "landQin": [[0.0] * nF_ for _ in range(nL)]}                        # 只有溪流上游來水
    land_only = {**scen, "streamQin": [[0.0] * nF_ for _ in scen.get("streamQin", [])], "streamCap": None}  # 只有山坡逕流
    LABELS = ["no_upstream"] + [f"streams_cap_{c}" for c in CAPS] + ["land_only"]
    scens = [{**base0, "streamCap": None}] + [{**streams_only, "streamCap": c} for c in CAPS] + [land_only]
    t0 = time.time(); r = ft.simulate(inp, scens, device, keep_frames=(), progress=True, closed=False)
    res = {"preset": preset, "labels": LABELS, "caps": [None] + CAPS + [None], "upstream": meta.get("upstream"), "seconds": round(time.time() - t0), "device": device, "runs": []}
    for b, c in enumerate(LABELS):
        hm = r["hmax"][b]; run = {"label": c, "cap": res["caps"][b], "regions": {}}
        for ri, (rid, rr, (ox, oy)) in enumerate(zip(IDS, R, meta["offs"])):
            sl = (slice(oy - meta["r0"], oy - meta["r0"] + rr["ny"]), slice(ox - meta["c0"], ox - meta["c0"] + rr["nx"]))
            hl = hm[sl]; ml = b64(rr["mask_u8"], np.uint8).reshape(rr["ny"], rr["nx"]); own = owner[sl] == ri
            run["regions"][rid] = {"max_env_ha": round(float(((hl >= 0.1) & (ml == 1) & own).sum() * 0.04), 1), "records": records(rid, rr, hl)}
        res["runs"].append(run)
        print("cap", c, {k: v["max_env_ha"] for k, v in run["regions"].items()}, flush=True)
    (ROOT / f"data/processed/city/{preset}_streamcap.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))

def main():
    if "--stream-caps" in sys.argv:
        preset = next((a for a in sys.argv[1:] if not a.startswith("--") and a not in ("mps", "cuda", "cpu")), "nari")
        return stream_caps(preset, sys.argv[sys.argv.index("--device") + 1] if "--device" in sys.argv else "mps")
    preset = next((a for a in sys.argv[1:] if not a.startswith("--") and a not in ("mps", "cuda", "cpu")), "nari")
    device = sys.argv[sys.argv.index("--device") + 1] if "--device" in sys.argv else "mps"
    import flow_torch as ft
    R, inp, scen, meta, mask, owner = merge(preset)
    print("city grid", meta["W"], "x", meta["H"], "inland", meta["inland_cells"], "gates", len(inp["gates"]), "catchments", inp["nCatch"], "stream cells", len(inp["stream"]), flush=True)
    res = {"preset": preset, "grid": [meta["W"], meta["H"]], "inland_ha": meta["inland_cells"] * 0.04, "device": device, "runs": {}}
    hms = {}
    for mode in ("closed", "open"):
        t0 = time.time(); r = ft.simulate(inp, [scen], device, keep_frames=(), progress=True, closed=(mode == "closed"))
        hm = r["hmax"][0]; hms[mode] = hm; area = np.array(r["area"])[:, 0]
        run = {"seconds": round(time.time() - t0), "steps": r["steps"], "max_area_ha": round(float(area.max()), 1), "regions": {}}
        for ri, (rid, rr, (ox, oy)) in enumerate(zip(IDS, R, meta["offs"])):
            sl = (slice(oy - meta["r0"], oy - meta["r0"] + rr["ny"]), slice(ox - meta["c0"], ox - meta["c0"] + rr["nx"]))
            hl = hm[sl]; ml = b64(rr["mask_u8"], np.uint8).reshape(rr["ny"], rr["nx"]); own = owner[sl] == ri
            env = float(((hl >= 0.1) & (ml == 1) & own).sum() * 0.04); deep = float(((hl >= 0.5) & (ml == 1) & own).sum() * 0.04)
            js = b64(rr["js_hmax_cm_u16"], np.uint16).reshape(rr["ny"], rr["nx"]) / 100
            js_env = float(((js >= 0.1) & (ml == 1)).sum() * 0.04)
            run["regions"][rid] = {"max_env_ha": round(env, 1), "deep_env_ha": round(deep, 1), "browser_env_ha": round(js_env, 1), "records": records(rid, rr, hl)}
        res["runs"][mode] = run
        print(mode, run["seconds"], "s", {k: (v["max_env_ha"], v["browser_env_ha"]) for k, v in run["regions"].items()}, flush=True)
    # 打開後多淹的面積（擁有者分區）與往哪裡流
    diff = (hms["open"] >= 0.1) & ~(hms["closed"] >= 0.1) & (mask == 1)
    res["extra_ha_by_region"] = {rid: round(float((diff & (owner == ri)).sum() * 0.04), 1) for ri, rid in enumerate(IDS)}
    (ROOT / "data/processed/city").mkdir(parents=True, exist_ok=True)
    (ROOT / f"data/processed/city/{preset}_city.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    city_png(hms["open"], mask, meta, ROOT / f"overview/img/{preset}_city.png")
    print("extra flooded when open:", res["extra_ha_by_region"])

if __name__ == "__main__":
    main()
