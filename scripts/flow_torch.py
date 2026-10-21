#!/usr/bin/env python3
"""二維漫地流（src/flow.js 的 PyTorch 移植，可一次算一批情境）：給 Colab GPU 跑降雨情境集合用。

輸入：scripts/dump_flow_input.js 擷取的 work/flow_in/<id>.json（或 data/processed/<id>/flow_input.json）。
用法：
  python3 scripts/flow_torch.py validate <id>            # 以頁面的「短延時暴雨 100 mm/h」情境對照瀏覽器結果
  python3 scripts/flow_torch.py sweep <id> [--device cuda] [--out DIR]   # 降雨強度×延時×排水設定的情境集合
只處理水門關閉、河水位低於堤頂的「內水型」情境（水門入流與越堤為零）；演算法逐步對應 flow.js。
"""
import base64, json, sys, time, math, pathlib
import numpy as np, torch

ROOT = pathlib.Path(__file__).resolve().parent.parent
INTENSITIES = [40, 60, 78.8, 100, 130, 150, 180, 200]   # mm/h（定強度，前後 15 分鐘平滑，與頁面相同）
DURATIONS = [0.5, 1, 2, 3]                               # 小時
DRAIN = [  # (名稱, 下水道收水 mm/hr, 抽水 mm/hr, 可用率 %)
    ("design", 78.8, 60, 100), ("pump30", 78.8, 60, 30), ("sewer50", 50, 60, 100), ("pump45", 78.8, 45, 100)]

def b64arr(s, dtype): return np.frombuffer(base64.b64decode(s), dtype=dtype).copy()
def load(rid):
    p = ROOT / "work/flow_in" / f"{rid}.json"
    if p.exists(): return json.loads(p.read_text())
    import gzip
    p = ROOT / "data/processed" / rid / "flow_input.json.gz"  # repo 內的版本（不含瀏覽器水深）
    if p.exists():
        with gzip.open(p, "rt", encoding="utf-8") as f: return json.load(f)
    raise SystemExit(f"no flow input for {rid}; run scripts/dump_flow_input.js first")

def rain_shape(t, hours):
    half, ramp, d = hours / 2, 0.25, abs(t - 3)
    if d <= half - ramp: return 1.0
    if d >= half + ramp: return 0.0
    return 0.5 * (1 + math.cos(math.pi * (d - (half - ramp)) / (2 * ramp)))

def simulate(inp, scen, device="cpu", keep_frames=(48,), progress=True):
    """scen: list of dict(rain=mm/h, hours, sewerMM, pumpMM, avail). 回傳每個情境的時間序列統計與水深。"""
    nx, ny, d = inp["nx"], inp["ny"], float(inp["d"]); N = nx * ny; B = len(scen); A = d * d; g = 9.81
    dev = torch.device(device); f32 = torch.float32
    z = torch.tensor(b64arr(inp["z_f32"], np.float32).reshape(ny, nx), device=dev)
    mask = b64arr(inp["mask_u8"], np.uint8).reshape(ny, nx); act = torch.tensor(mask == 1, device=dev)
    psi = torch.tensor(b64arr(inp["psi_f32"], np.float32).reshape(ny, nx), device=dev)
    catch = torch.tensor(b64arr(inp["catch_i32"], np.int32).reshape(ny, nx).astype(np.int64), device=dev)
    nC = int(inp["nCatch"]); n0 = float(inp["n"])
    for gt in inp["gates"]:
        assert not gt["open"] and max(gt["zr"]) <= gt["levee"], "sweep only covers closed gates below the levee crest"
    # 介面孔隙率與糙度（兩側較小者）
    phx = torch.minimum(psi[:, :-1], psi[:, 1:]); phy = torch.minimum(psi[:-1, :], psi[1:, :])
    nx2 = (n0 + 0.08 * (1 - phx)) ** 2; ny2 = (n0 + 0.08 * (1 - phy)) ** 2
    actx = act[:, :-1] & act[:, 1:]; acty = act[:-1, :] & act[1:, :]
    zmx = torch.maximum(z[:, :-1], z[:, 1:]); zmy = torch.maximum(z[:-1, :], z[1:, :])
    T = inp["simHours"] * 3600; FR = float(inp["frameSec"]); nF = int(round(T / FR)) + 1
    # 每個情境的雨量序列（frame 間線性內插）、排水參數
    rain = torch.tensor([[s["rain"] * rain_shape(k * FR / 3600, s["hours"]) for k in range(nF)] for s in scen], device=dev, dtype=f32)
    zrOut = torch.tensor(inp["zrOut"], device=dev, dtype=f32)
    sewerMM = torch.tensor([s["sewerMM"] for s in scen], device=dev, dtype=f32)
    pumpMM = torch.tensor([s["pumpMM"] for s in scen], device=dev, dtype=f32)
    avail = torch.tensor([s["avail"] for s in scen], device=dev, dtype=f32)
    cIdx = catch.flatten(); valid = cIdx >= 0; cIdxv = cIdx[valid]
    f64 = torch.float32 if dev.type == "mps" else torch.float64  # MPS 沒有 float64
    cArea = torch.zeros(nC, device=dev, dtype=f64).index_add_(0, cIdxv, torch.full((int(valid.sum()),), A, device=dev, dtype=f64))
    cStore = torch.clamp(cArea * inp["storeMM"] / 1000, min=1.0).to(f32)[None, :].expand(B, nC).contiguous()
    psiA = (psi * A)
    h = torch.zeros(B, ny, nx, device=dev, dtype=f32); qx = torch.zeros(B, ny, nx - 1, device=dev, dtype=f32); qy = torch.zeros(B, ny - 1, nx, device=dev, dtype=f32)
    sew = torch.zeros(B, nC, device=dev, dtype=f32); hmaxEnv = torch.zeros_like(h)
    out = {"area": [], "deep": [], "maxD": [], "frames": {}}
    actf = act.float(); Acell = A / 1e4
    def interp(arr, t):
        f = t / FR; i = min(arr.shape[-1] - 2, int(f)); w = min(1.0, f - i); return arr[..., i] * (1 - w) + arr[..., i + 1] * w
    t, nextFrame, k, step, t0 = 0.0, 0.0, 0, 0, time.time()
    while t <= T + 1e-6:
        if t >= nextFrame - 1e-6:
            hin = torch.where(act, h, torch.zeros_like(h))
            out["area"].append(((hin >= 0.1).sum(dim=(1, 2)).float() * Acell).tolist())
            out["deep"].append(((hin >= 0.5).sum(dim=(1, 2)).float() * Acell).tolist())
            out["maxD"].append(hin.amax(dim=(1, 2)).tolist())
            hmaxEnv = torch.maximum(hmaxEnv, hin)
            if k in keep_frames: out["frames"][k] = hin.cpu().numpy()
            if progress and k % 12 == 0: print(f"  t={t/3600:.0f}h step={step} {time.time()-t0:.0f}s area={np.mean(out['area'][-1]):.1f}ha", flush=True)
            k += 1; nextFrame += FR
            if t >= T: break
        hmax = max(0.01, float(torch.where(act, h, torch.zeros_like(h)).amax()))
        dt = min(10.0, 0.5 * d / math.sqrt(g * hmax)); dt = min(dt, nextFrame - t)
        eta = z + h
        # x 向通量
        ea, eb = eta[:, :, :-1], eta[:, :, 1:]; hf = torch.maximum(ea, eb) - zmx
        ok = actx & (hf > 1e-3); hfs = torch.clamp(hf, min=1e-3)
        qn = (qx - g * hfs * dt * (eb - ea) / d) / (1 + g * dt * nx2 * qx.abs() / (hfs * hfs * torch.pow(hfs, 1 / 3)))
        qx = torch.where(ok, qn, torch.zeros_like(qx))
        ea, eb = eta[:, :-1, :], eta[:, 1:, :]; hf = torch.maximum(ea, eb) - zmy
        ok = acty & (hf > 1e-3); hfs = torch.clamp(hf, min=1e-3)
        qn = (qy - g * hfs * dt * (eb - ea) / d) / (1 + g * dt * ny2 * qy.abs() / (hfs * hfs * torch.pow(hfs, 1 / 3)))
        qy = torch.where(ok, qn, torch.zeros_like(qy))
        # 通量限制：流出量不超過格內水量
        qxw = qx * phx; qyw = qy * phy
        outflow = torch.zeros_like(h)
        outflow[:, :, 1:] += torch.clamp(-qxw, min=0); outflow[:, :, :-1] += torch.clamp(qxw, min=0)
        outflow[:, 1:, :] += torch.clamp(-qyw, min=0); outflow[:, :-1, :] += torch.clamp(qyw, min=0)
        outflow = outflow * dt / d
        availh = h * psi
        lim = torch.where((outflow > availh) & act, availh / torch.clamp(outflow, min=1e-12), torch.ones_like(h))
        qx = torch.where(qx > 0, qx * lim[:, :, :-1], qx * lim[:, :, 1:])
        qy = torch.where(qy > 0, qy * lim[:, :-1, :], qy * lim[:, 1:, :])
        # 連續方程式
        qxw = qx * phx; qyw = qy * phy
        dh = torch.zeros_like(h)
        dh[:, :, 1:] += qxw; dh[:, :, :-1] -= qxw; dh[:, 1:, :] += qyw; dh[:, :-1, :] -= qyw
        h = torch.where(act, torch.clamp(h + dh * dt / d / psi, min=0), h)
        # 降雨
        r = interp(rain, t) / 1000 / 3600 * dt
        h = h + torch.where(act, r[:, None, None] / psi, torch.zeros_like(h))
        # 雨水下水道 → 管網 → 抽水／重力排出（依集水區）
        intake = sewerMM / 1000 / 3600 * dt * A
        zr = float(interp(zrOut, t)); gravity = 1.0 if zr < inp["gravityEL"] else 0.0
        hv = h.reshape(B, N)[:, valid]; take = torch.minimum(hv * psiA.flatten()[valid], intake[:, None])
        take = torch.where(hv > 0, take, torch.zeros_like(take))
        dem = torch.zeros(B, nC, device=dev, dtype=f32).index_add_(1, cIdxv, take)
        drain = (pumpMM[:, None] / 1000 / 3600 * cArea[None, :].to(f32) * avail[:, None] / 100 + gravity * sewerMM[:, None] / 1000 / 3600 * cArea[None, :].to(f32)) * dt
        allow = drain + (cStore - sew)
        fac = torch.where(dem > 0, torch.clamp(torch.clamp(allow, min=0) / torch.clamp(dem, min=1e-12), max=1), torch.zeros_like(dem))
        sew = sew + dem * fac; o = torch.minimum(drain, sew); sew = sew - o
        facc = fac[:, cIdxv]
        hv = torch.clamp(hv - take * facc / psiA.flatten()[valid][None, :], min=0)
        hh = h.reshape(B, N).clone(); hh[:, valid] = hv; h = hh.reshape(B, ny, nx)
        t += dt; step += 1
    out["hmax"] = hmaxEnv.cpu().numpy(); out["steps"] = step; out["seconds"] = time.time() - t0
    return out

def cm_u8(a): return base64.b64encode(np.minimum(255, np.round(a * 100)).astype(np.uint8).tobytes()).decode()

def validate(rid, device):
    inp = load(rid); p = inp["P"]
    sc = [dict(rain=p["rain"], hours=p["rainHours"], sewerMM=p["sewerMM"], pumpMM=p["pumpMM"], avail=p["avail"])]
    print(rid, "scenario", sc[0], "cells", inp["nx"] * inp["ny"]); r = simulate(inp, sc, device)
    js = {s["t_h"]: s for s in inp["js_stats"]}; mask = b64arr(inp["mask_u8"], np.uint8).reshape(inp["ny"], inp["nx"]) == 1
    psi = b64arr(inp["psi_f32"], np.float32).reshape(inp["ny"], inp["nx"]); h4 = r["frames"][48][0]
    jsh = b64arr(inp["js_h4h_cm_u8"], np.uint8).reshape(inp["ny"], inp["nx"]) / 100
    vol = float((h4 * psi * mask).sum() * inp["d"] ** 2)
    for k, th in ((24, 2), (48, 4), (96, 8)):
        print(f"  {th}h  torch area {r['area'][k][0]:.2f} deep {r['deep'][k][0]:.2f} maxD {r['maxD'][k][0]:.3f} | js area {js[th]['area_ha']} deep {js[th]['deep_ha']} maxD {js[th]['maxD']}")
    both = ((h4 >= 0.1) & (jsh >= 0.1) & mask).sum(); either = (((h4 >= 0.1) | (jsh >= 0.1)) & mask).sum()
    print(f"  4h volume torch {vol:.0f} m3 vs js {inp['js_vol_4h_m3']} ; cell IoU(>=0.1 m) {both / max(1, either):.3f} ; max |dh| {np.abs(h4 - jsh)[mask].max():.3f} m ; steps {r['steps']} in {r['seconds']:.0f}s")

def sweep(rid, device, outdir):
    inp = load(rid); scen, meta = [], []
    for dn, sw, pm, av in DRAIN:
        for hr in DURATIONS:
            for I in INTENSITIES:
                scen.append(dict(rain=I, hours=hr, sewerMM=sw, pumpMM=pm, avail=av)); meta.append(dict(drain=dn, hours=hr, rain=I))
    print(rid, len(scen), "scenarios on", device, "cells", inp["nx"] * inp["ny"], flush=True)
    r = simulate(inp, scen, device)
    area = np.array(r["area"]); deep = np.array(r["deep"]); maxD = np.array(r["maxD"])  # (frames, B)
    res = {"region": rid, "nx": inp["nx"], "ny": inp["ny"], "d": inp["d"], "inland_ha": inp["inland_ha"], "frame_min": inp["frameSec"] / 60,
           "intensities": INTENSITIES, "durations": DURATIONS, "drain": [dict(id=a, sewerMM=b, pumpMM=c, avail=e) for a, b, c, e in DRAIN],
           "steps": r["steps"], "seconds": round(r["seconds"]), "device": device, "scenarios": []}
    mask = b64arr(inp["mask_u8"], np.uint8).reshape(inp["ny"], inp["nx"]) == 1
    for b, m in enumerate(meta):
        res["scenarios"].append({**m, "area_4h": round(float(area[48, b]), 2), "deep_4h": round(float(deep[48, b]), 2), "maxD_4h": round(float(maxD[48, b]), 3),
                                 "area_peak": round(float(area[:, b].max()), 2), "deep_peak": round(float(deep[:, b].max()), 2), "t_peak_h": round(float(area[:, b].argmax()) * inp["frameSec"] / 3600, 2),
                                 "area_8h": round(float(area[96, b]), 2), "area_series": [round(float(v), 1) for v in area[::3, b]]})
    # 地圖：設計排水、延時 1 h 的各強度最大水深（包絡）；以及「淹水機率」＝設計排水下 32 個情境（強度×延時）中最大水深 ≥ 0.15 m 的比例
    maps = {"hmax_cm": {}, "prob_pct": None}
    idx = {(m["drain"], m["hours"], m["rain"]): b for b, m in enumerate(meta)}
    for I in INTENSITIES: maps["hmax_cm"][str(I)] = cm_u8(r["hmax"][idx[("design", 1, I)]] * mask)
    design = [b for b, m in enumerate(meta) if m["drain"] == "design"]
    prob = (r["hmax"][design] >= 0.15).mean(axis=0) * mask
    maps["prob_pct"] = base64.b64encode(np.round(prob * 100).astype(np.uint8).tobytes()).decode()
    maps["prob_n"] = len(design); maps["h4h_cm"] = {dn: cm_u8(r["frames"][48][idx[(dn, 1, 100)]] * mask) for dn, *_ in DRAIN}
    outdir = pathlib.Path(outdir); outdir.mkdir(parents=True, exist_ok=True)
    (outdir / f"{rid}_sweep.json").write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")))
    (outdir / f"{rid}_maps.json").write_text(json.dumps(maps, separators=(",", ":")))
    print(rid, "done", r["steps"], "steps", round(r["seconds"]), "s; design 1 h 100 mm/h 4h area", res["scenarios"][idx[("design", 1, 100)]]["area_4h"], "ha", flush=True)

if __name__ == "__main__":
    cmd, rid = sys.argv[1], sys.argv[2]
    device = "cuda" if "--device" in sys.argv and sys.argv[sys.argv.index("--device") + 1] == "cuda" else ("cuda" if torch.cuda.is_available() else "cpu")
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else str(ROOT / "work/sweep")
    validate(rid, device) if cmd == "validate" else sweep(rid, device, out)
