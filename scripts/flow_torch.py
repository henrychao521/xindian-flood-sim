#!/usr/bin/env python3
"""二維漫地流（src/flow.js 的 PyTorch 移植，可一次算一批情境）：給 Colab GPU 跑降雨情境集合用。

輸入：scripts/dump_flow_input.js 擷取的 work/flow_in/<id>.json（或 data/processed/<id>/flow_input.json）。
用法：
  python3 scripts/flow_torch.py validate <id>            # 以頁面的「短延時暴雨 100 mm/h」情境對照瀏覽器結果
  python3 scripts/flow_torch.py sweep <id> [--device cuda] [--out DIR]   # 降雨強度×延時×排水設定的情境集合（內水型）
  python3 scripts/flow_torch.py validate-river <id>      # 以「關鍵水門未關」情境對照瀏覽器（水門入流、越堤）
  python3 scripts/flow_torch.py river <id> [--device cuda] [--out DIR]   # 洪水規模×潮位×水門失效組合的情境集合
  python3 scripts/flow_torch.py closure <id> [--device cuda] [--out DIR] # 搶險封堵時刻 × 關鍵門／所有門，與兩座門同時失效的所有組合
演算法逐步對應 flow.js（含水門堰流入流、回流、越堤）。
"""
import base64, json, sys, time, math, pathlib
import numpy as np, torch

ROOT = pathlib.Path(__file__).resolve().parent.parent
INTENSITIES = [40, 60, 78.8, 100, 130, 150, 180, 200]   # mm/h（定強度，前後 15 分鐘平滑，與頁面相同）
DURATIONS = [0.5, 1, 2, 3]                               # 小時
RIVER_RAIN = 40.0   # 洩洪情境的市區背景雨（頁面預設 40 mm/h、延時 2 h）
DRAIN = [  # (名稱, 下水道收水 mm/hr, 抽水 mm/hr, 可用率 %)
    ("design", 78.8, 60, 100), ("pump30", 78.8, 60, 30), ("sewer50", 50, 60, 100), ("pump45", 78.8, 45, 100)]

def b64arr(s, dtype): return np.frombuffer(base64.b64decode(s), dtype=dtype).copy()
def load(rid):
    inp = _load(rid)
    sp = ROOT / "data/processed" / rid / "streams.json"  # 山區明渠溪流（scripts/build_streams.py）
    inp["stream"] = json.loads(sp.read_text())["cells"] if sp.exists() else []
    return inp

def _load(rid):
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

def simulate(inp, scen, device="cpu", keep_frames=(48,), progress=True, closed=False):
    """scen: list of dict(rain=mm/h, hours, sewerMM, pumpMM, avail)。回傳每個情境的時間序列統計與水深。
    分區（全市合併網格，scripts/merge_city.py）：inp["zone"]（每格所屬河段）、inp["catchZone"]（每個集水區所屬河段）、inp["failAt"]（各集水區抽水站失效時刻，小時）；
    scen["rainZ"]、scen["zrOutZ"]（河段 × 格）給各河段自己的雨量與河道水位；closed=True 時封閉河段之間的格邊（inp["owner"]），用來驗證拼接。"""
    nx, ny, d = inp["nx"], inp["ny"], float(inp["d"]); N = nx * ny; B = len(scen); A = d * d; g = 9.81
    dev = torch.device(device); f32 = torch.float32
    z = torch.tensor(b64arr(inp["z_f32"], np.float32).reshape(ny, nx), device=dev)
    mask = b64arr(inp["mask_u8"], np.uint8).reshape(ny, nx); act = torch.tensor(mask == 1, device=dev)
    psi = torch.tensor(b64arr(inp["psi_f32"], np.float32).reshape(ny, nx), device=dev)
    catch = torch.tensor(b64arr(inp["catch_i32"], np.int32).reshape(ny, nx).astype(np.int64), device=dev)
    nC = int(inp["nCatch"]); n0 = float(inp["n"])
    # 水門：每個情境可有自己的開關與河道水位序列（scen["open"]: nG 個 bool、scen["zr"]: nG × nF、scen["zrOut"]: nF）；沒給就用輸入檔的（全關、低水位）
    G = inp["gates"]; nG = len(G)
    openG = torch.tensor([[bool(s.get("open", [g["open"] for g in G])[gi]) for gi in range(nG)] for s in scen], device=dev)
    zrG = torch.tensor([s.get("zr", [g["zr"] for g in G]) for s in scen], device=dev, dtype=f32)   # (B, nG, nF)
    C_w, openPct, closeAt = float(inp["C"]), float(inp["openPct"]), float(inp["closeAt"])
    closeB = torch.tensor([float(s.get("closeAt", closeAt)) for s in scen], device=dev, dtype=f32)  # 每個情境的搶險封堵時刻（小時；≥ 模擬時長＝沒封堵）
    # 每座門入口格周邊 5×5 的堤內格，補齊成 (nG, 25)（-1 → 不用），一次向量化處理所有水門
    cellsPad = torch.full((max(nG, 1), 25), -1, dtype=torch.long); nCells = []
    for gi, gt in enumerate(G):
        k0 = gt["entry"]; i0, j0 = k0 % nx, k0 // nx; cells = []
        for a in range(-2, 3):
            for b in range(-2, 3):
                i, j = i0 + a, j0 + b
                if 0 <= i < nx and 0 <= j < ny and mask[j, i] == 1: cells.append(j * nx + i)
        cellsPad[gi, :len(cells)] = torch.tensor(cells, dtype=torch.long); nCells.append(len(cells))
    cellsPad = cellsPad.to(dev); cellOk = (cellsPad >= 0); cellIdx = torch.where(cellOk, cellsPad, torch.zeros_like(cellsPad))  # (nG, 25)
    gW = torch.tensor([gt["width"] for gt in G], device=dev, dtype=f32); gSill = torch.tensor([gt["sill"] for gt in G], device=dev, dtype=f32); gLevee = torch.tensor([gt["levee"] for gt in G], device=dev, dtype=f32)
    zCells = z.flatten()[cellIdx][None]  # (1, nG, 25)
    psCells = (psi * A).flatten()[cellIdx] * cellOk.to(f32); gCap = psCells.sum(1)  # (nG,)
    gActive = nG > 0 and any(n > 0 for n in nCells) and (bool(openG.any()) or bool((zrG > gLevee[None, :, None]).any()))
    flatIdx = cellIdx.flatten()[None, :].expand(B, -1)  # (B, nG*25)
    qAcc = torch.zeros(B, nG, device=dev, dtype=torch.float32 if dev.type == "mps" else torch.float64)
    # 山區溪流：溪流格水面高於河道水位時，水直接排入溪流（同 flow.js）
    strIdx = torch.tensor(inp.get("stream", []), device=dev, dtype=torch.long)
    strOn = torch.tensor([bool(s.get("streams", True)) for s in scen], device=dev)
    zStr = z.flatten()[strIdx] if strIdx.numel() else None
    strZone = torch.tensor(np.asarray(inp["zone"])[inp.get("stream", [])].astype(np.int64), device=dev) if (strIdx.numel() and inp.get("zone") is not None) else None
    # 溪流排洪能力（溢流）：inp["streamLines"]＝每條溪流由上游到下游的格索引；scen["streamCap"]＝每條溪流的排洪能力（m³/s，None＝無限）。
    # 每一步把各格收進的水沿溪流往下游累加，累加流量超過排洪能力後，下游的格子收不進水（水留在地面漫開）
    SL = inp.get("streamLines"); nF = int(round(inp["simHours"] * 3600 / float(inp["frameSec"]))) + 1
    if SL:
        M = max(len(l) for l in SL); slIdx = torch.full((len(SL), M), -1, dtype=torch.long)
        for li, l in enumerate(SL): slIdx[li, :len(l)] = torch.tensor(l, dtype=torch.long)
        slIdx = slIdx.to(dev); slOk = slIdx >= 0; slI = torch.where(slOk, slIdx, torch.zeros_like(slIdx))
        zSL = z.flatten()[slI]; psSL = (psi * A).flatten()[slI]
        slZone = torch.tensor(np.asarray(inp["zone"]).astype(np.int64), device=dev)[slI] if inp.get("zone") is not None else None
        capB = torch.tensor([float("inf") if s.get("streamCap") is None else float(s["streamCap"]) for s in scen], device=dev, dtype=f32)
        # 上游入流（範圍外集水區，scripts/upstream.py）：scen["streamQin"]＝每條溪流線 × 格的流量 m³/s，從線的第一格灌入
        qin = torch.tensor([s.get("streamQin") or [[0.0] * nF] * len(SL) for s in scen], device=dev, dtype=f32)  # (B, 溪流, nF)
    landK = inp.get("landCells") or []
    if landK:  # 不靠近溪流的範圍外山坡逕流，直接加到入口格
        landI = torch.tensor(landK, device=dev, dtype=torch.long); landPs = (psi * A).flatten()[landI]
        landQ = torch.tensor([s.get("landQin") or [[0.0] * nF] * len(landK) for s in scen], device=dev, dtype=f32)  # (B, 入口, nF)
    def weir(Cc, Bw, up, dn, crest):
        sgn = torch.where(up >= dn, 1.0, -1.0); hi = torch.maximum(up, dn); lo = torch.minimum(up, dn)
        h1 = hi - crest; h2 = torch.clamp(lo - crest, min=0)
        q = sgn * Cc * Bw * torch.pow(torch.clamp(h1, min=0), 1.5) * torch.pow(torch.clamp(1 - torch.pow(h2 / torch.clamp(h1, min=1e-9), 1.5), min=0), 0.385)
        return torch.where(h1 > 0, q, torch.zeros_like(q))
    # 介面孔隙率與糙度（兩側較小者）
    phx = torch.minimum(psi[:, :-1], psi[:, 1:]); phy = torch.minimum(psi[:-1, :], psi[1:, :])
    nx2 = (n0 + 0.08 * (1 - phx)) ** 2; ny2 = (n0 + 0.08 * (1 - phy)) ** 2
    actx = act[:, :-1] & act[:, 1:]; acty = act[:-1, :] & act[1:, :]
    if closed and inp.get("owner") is not None:  # 封閉河段之間的格邊（等同各河段單獨計算）
        ow = torch.tensor(np.asarray(inp["owner"]).reshape(ny, nx), device=dev)
        actx = actx & (ow[:, :-1] == ow[:, 1:]); acty = acty & (ow[:-1, :] == ow[1:, :])
    zmx = torch.maximum(z[:, :-1], z[:, 1:]); zmy = torch.maximum(z[:-1, :], z[1:, :])
    T = inp["simHours"] * 3600; FR = float(inp["frameSec"]); nF = int(round(T / FR)) + 1
    # 每個情境的雨量序列（frame 間線性內插）、排水參數
    zoned = "rainZ" in scen[0]
    if zoned:
        zoneT = torch.tensor(np.asarray(inp["zone"]).reshape(ny, nx).astype(np.int64), device=dev)
        rainZ = torch.tensor([s["rainZ"] for s in scen], device=dev, dtype=f32)        # (B, 區, nF)
        zrZ = torch.tensor([s["zrOutZ"] for s in scen], device=dev, dtype=f32)         # (B, 區, nF)
        catchZone = torch.tensor(inp["catchZone"], device=dev, dtype=torch.long)
        rain = rainZ[:, 0]; zrOut = zrZ[:, 0]
    else:
        rain = torch.tensor([s["rainSeries"] if "rainSeries" in s else [s["rain"] * rain_shape(k * FR / 3600, s["hours"]) for k in range(nF)] for s in scen], device=dev, dtype=f32)
        zrOut = torch.tensor([s.get("zrOut", inp["zrOut"]) for s in scen], device=dev, dtype=f32)  # (B, nF)
    failAt = inp.get("failAt") or scen[0].get("failAt")
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
        if progress and step % 2000 == 0 and step: print(f"    step {step} t={t/3600:.2f}h dt={min(10.0, 0.5 * d / math.sqrt(g * hmax)):.2f}s", flush=True)
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
        if zoned:
            rc = interp(rainZ, t)[:, zoneT] / 1000 / 3600 * dt                      # (B, ny, nx)
            h = h + torch.where(act, rc / psi, torch.zeros_like(h))
        else:
            r = interp(rain, t) / 1000 / 3600 * dt
            h = h + torch.where(act, r[:, None, None] / psi, torch.zeros_like(h))
        # 雨水下水道 → 管網 → 抽水／重力排出（依集水區）
        intake = sewerMM / 1000 / 3600 * dt * A
        gravity = (interp(zrZ, t)[:, catchZone] < inp["gravityEL"]).to(f32) if zoned else (interp(zrOut, t) < inp["gravityEL"]).to(f32)[:, None]
        pumpOn = (torch.tensor(failAt, device=dev, dtype=f32) * 3600 > t).to(f32)[None, :] if failAt else 1.0  # 抽水站失效後不再抽水
        hv = h.reshape(B, N)[:, valid]; take = torch.minimum(hv * psiA.flatten()[valid], intake[:, None])
        take = torch.where(hv > 0, take, torch.zeros_like(take))
        dem = torch.zeros(B, nC, device=dev, dtype=f32).index_add_(1, cIdxv, take)
        drain = (pumpMM[:, None] / 1000 / 3600 * cArea[None, :].to(f32) * avail[:, None] / 100 * pumpOn + gravity * sewerMM[:, None] / 1000 / 3600 * cArea[None, :].to(f32)) * dt
        allow = drain + (cStore - sew)
        fac = torch.where(dem > 0, torch.clamp(torch.clamp(allow, min=0) / torch.clamp(dem, min=1e-12), max=1), torch.zeros_like(dem))
        sew = sew + dem * fac; o = torch.minimum(drain, sew); sew = sew - o
        facc = fac[:, cIdxv]
        hv = torch.clamp(hv - take * facc / psiA.flatten()[valid][None, :], min=0)
        hh = h.reshape(B, N).clone(); hh[:, valid] = hv
        if SL:
            hs = hh[:, slI]                                                                 # (B, 溪流, 格)
            zrc = interp(zrZ, t)[:, slZone] if (zoned and slZone is not None) else interp(zrOut, t)[:, None, None]
            drn = (hs > 0) & (zSL[None] + hs > zrc) & slOk[None] & strOn[:, None, None]
            rate = torch.where(drn, hs * psSL[None] / dt, torch.zeros_like(hs))            # 各格收進溪流的流量 m³/s
            qup = interp(qin, t)                                                            # (B, 溪流) 上游入流
            cum = qup[:, :, None] + torch.cumsum(rate, dim=2); prev = cum - rate
            frac = torch.clamp((capB[:, None, None] - prev) / torch.clamp(rate, min=1e-12), min=0, max=1)
            frac = torch.where(drn, frac, torch.zeros_like(frac))
            newh = hs * (1 - frac)
            hh = hh.scatter(1, slI.flatten()[None, :].expand(B, -1), torch.where(slOk[None], newh, hs).reshape(B, -1))
            spill = torch.clamp(qup - capB[:, None], min=0)                                 # 上游來水超過排洪能力：在入口溢到地面
            if bool((spill > 0).any()):
                first = slI[:, 0]; hh = hh.index_add(1, first, spill * dt / psSL[None, :, 0])
        elif zStr is not None:
            hs = hh[:, strIdx]; zrNow = interp(zrZ, t)[:, strZone] if (zoned and strZone is not None) else interp(zrOut, t)[:, None]
            dr = (hs > 0) & (zStr[None, :] + hs > zrNow) & strOn[:, None]
            hh[:, strIdx] = torch.where(dr, torch.zeros_like(hs), hs)
        # 水門入流（含潛沒與回流）、越堤：入口格周邊 5×5 的堤內格平均分攤（所有水門一次算）
        if gActive:
            openNow = openG & ((closeB >= inp["simHours"]) | (closeB * 3600 > t))[:, None]
            zr = interp(zrG, t)  # (B, nG)
            hc = hh[:, cellIdx] * cellOk.to(f32)[None]  # (B, nG, 25)
            w = torch.where(hc > 0.01, hc, torch.zeros_like(hc)); ws = w.sum(2)
            eta = torch.where(ws > 0, ((zCells + hc) * w).sum(2) / torch.clamp(ws, min=1e-9), torch.full_like(ws, -99.0))
            vol = (hc * psCells[None]).sum(2)
            Q = (zr > gLevee[None]).to(f32) * weir(1.7, 150.0, zr, eta, gLevee[None])
            Q = Q + openNow.to(f32) * weir(C_w, gW[None] * openPct / 100, zr, eta, gSill[None])
            Q = torch.where(Q < 0, -torch.minimum(-Q, vol * 0.5 / dt), Q)
            qAcc += (Q * dt).to(qAcc.dtype)
            per = (Q * dt / torch.clamp(gCap[None], min=1e-9))[:, :, None].expand(-1, -1, 25) * cellOk.to(f32)[None]  # (B, nG, 25)
            hh = hh.index_add(1, flatIdx[0], per.reshape(B, -1))
            hh = torch.clamp(hh, min=0)
        if landK:
            hh = hh.index_add(1, landI, interp(landQ, t) * dt / landPs[None])
        h = hh.reshape(B, ny, nx)
        t += dt; step += 1
    out["hmax"] = hmaxEnv.cpu().numpy(); out["steps"] = step; out["seconds"] = time.time() - t0; out["inflow_m3"] = qAcc.cpu().numpy()
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

def river_scen(inp, Q, tide, open_idx, rain=RIVER_RAIN, hours=2):
    """洩洪情境：河道水位取自頁面算好的水位表（洪水規模 × 潮位），指定哪些水門未關。"""
    rv = inp["river"]; Z = rv["stages"]["Z"][f"{Q:g}|{tide:g}"]; nF = len(Z)  # JS 的數字鍵：2.0 → "2"
    zr = [[Z[k][node] for k in range(nF)] for node in rv["gateNodes"]]
    return dict(rain=rain, hours=hours, sewerMM=78.8, pumpMM=60, avail=100, open=[gi in open_idx for gi in range(len(zr))], zr=zr, zrOut=[Z[k][rv["keyNode"]] for k in range(nF)])

def validate_river(rid, device):
    inp = load(rid); rv = inp["river"]; p = rv["P"]
    sc = [dict(rain=p["rain"], hours=p["rainHours"], sewerMM=p["sewerMM"], pumpMM=p["pumpMM"], avail=p["avail"], open=[g["open"] for g in rv["gates"]], zr=[g["zr"] for g in rv["gates"]], zrOut=rv["zrOut"])]
    print(rid, rv["preset"], "open", [n for n, g in zip(rv["gateNames"], rv["gates"]) if g["open"]]); r = simulate(inp, sc, device)
    js = {s["t_h"]: s for s in rv["js_stats"]}
    for k, th in ((24, 2), (48, 4), (96, 8)):
        print(f"  {th}h  torch area {r['area'][k][0]:.2f} deep {r['deep'][k][0]:.2f} maxD {r['maxD'][k][0]:.3f} | js area {js[th]['area_ha']} deep {js[th]['deep_ha']} maxD {js[th]['maxD']}")
    print("  gate inflow m3 (torch)", [round(float(v)) for v in r["inflow_m3"][0]], "| js 4h instantaneous q m3/s", js[4]["q"], "steps", r["steps"], f"{r['seconds']:.0f}s")

def river(rid, device, outdir):
    inp = load(rid); rv = inp["river"]; Qs, tides = rv["stages"]["Qpeaks"], rv["stages"]["tides"]; nG = len(rv["gateNames"])
    sets = [("none", [])] + [(f"g{gi}", [gi]) for gi in range(nG)] + [("all", list(range(nG)))]
    scen, meta = [], []
    for Q in Qs:
        for td in tides:
            for name, idx in sets: scen.append(river_scen(inp, Q, td, idx)); meta.append(dict(Qpeak=Q, tide=td, gates=name))
    print(rid, len(scen), "river scenarios on", device, flush=True); r = simulate(inp, scen, device)
    area = np.array(r["area"]); deep = np.array(r["deep"]); maxD = np.array(r["maxD"])
    res = {"region": rid, "qUnit": rv["qUnit"], "Qpeaks": Qs, "tides": tides, "gateNames": rv["gateNames"], "keyGate": rv["keyGate"], "rain": RIVER_RAIN,
           "steps": r["steps"], "seconds": round(r["seconds"]), "device": device, "scenarios": []}
    for b, m in enumerate(meta):
        res["scenarios"].append({**m, "area_4h": round(float(area[48, b]), 2), "deep_4h": round(float(deep[48, b]), 2), "maxD_4h": round(float(maxD[48, b]), 3),
                                 "area_peak": round(float(area[:, b].max()), 2), "deep_peak": round(float(deep[:, b].max()), 2), "t_peak_h": round(float(area[:, b].argmax()) * inp["frameSec"] / 3600, 2),
                                 "area_8h": round(float(area[96, b]), 2), "inflow_m3": [round(float(v)) for v in r["inflow_m3"][b]]})
    mask = b64arr(inp["mask_u8"], np.uint8).reshape(inp["ny"], inp["nx"]) == 1
    idx = {(m["Qpeak"], m["tide"], m["gates"]): b for b, m in enumerate(meta)}
    Qmid = Qs[2]; maps = {"Qpeak": Qmid, "tide": 1.6, "hmax_cm": {name: cm_u8(r["hmax"][idx[(Qmid, 1.6, name)]] * mask) for name, _ in sets}}
    maps["hmax_cm_none_max"] = cm_u8(r["hmax"][idx[(Qs[-1], 2.0, "none")]] * mask)  # 最大洪水＋暴潮、水門全關：只有越堤
    outdir = pathlib.Path(outdir); outdir.mkdir(parents=True, exist_ok=True)
    (outdir / f"{rid}_river.json").write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")))
    (outdir / f"{rid}_river_maps.json").write_text(json.dumps(maps, separators=(",", ":")))
    kg = f"g{rv['keyGate']}"; print(rid, "done", r["steps"], "steps", round(r["seconds"]), "s; key gate open @", Qmid, "tide 1.6: 4h", res["scenarios"][idx[(Qmid, 1.6, kg)]]["area_4h"], "ha peak", res["scenarios"][idx[(Qmid, 1.6, kg)]]["area_peak"], flush=True)

CLOSES = [0.5, 1, 1.5, 2, 3, 4, 6, 99]  # 搶險封堵時刻（小時；99＝沒封堵）
def closure(rid, device, outdir):
    """水門失效後多快封堵：關鍵門／所有門未關 × 計畫洪峰 100%、120%（新店溪 7,000、8,500 m³/s）× 封堵時刻；外加 100% 時兩座門同時失效的所有組合"""
    inp = load(rid); rv = inp["river"]; Qs, nG, kg = rv["stages"]["Qpeaks"], len(rv["gateNames"]), rv["keyGate"]
    scen, meta = [], []
    for Q in (Qs[2], Qs[3]):
        for name, idx in (("key", [kg]), ("all", list(range(nG)))):
            for c in CLOSES:
                sc = river_scen(inp, Q, 1.6, idx); sc["closeAt"] = c; scen.append(sc); meta.append(dict(kind="close", Qpeak=Q, gates=name, closeAt=c))
    for a in range(nG):
        for b in range(a + 1, nG):
            scen.append(river_scen(inp, Qs[2], 1.6, [a, b])); meta.append(dict(kind="pair", Qpeak=Qs[2], gates=[a, b], closeAt=99))
    print(rid, len(scen), "closure/pair scenarios on", device, flush=True); r = simulate(inp, scen, device, keep_frames=(), progress=True)
    area = np.array(r["area"]); deep = np.array(r["deep"])
    res = {"region": rid, "qUnit": rv["qUnit"], "gateNames": rv["gateNames"], "keyGate": kg, "closes": CLOSES, "rain": RIVER_RAIN, "tide": 1.6,
           "steps": r["steps"], "seconds": round(r["seconds"]), "device": device, "scenarios": []}
    for b, m in enumerate(meta):
        res["scenarios"].append({**m, "area_peak": round(float(area[:, b].max()), 1), "deep_peak": round(float(deep[:, b].max()), 1), "area_8h": round(float(area[-1, b]), 1),
                                 "inflow_m3": round(float(r["inflow_m3"][b].sum()))})
    outdir = pathlib.Path(outdir); outdir.mkdir(parents=True, exist_ok=True)
    (outdir / f"{rid}_closure.json").write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")))
    k = [x for x in res["scenarios"] if x["kind"] == "close" and x["gates"] == "key" and x["Qpeak"] == Qs[2]]
    print(rid, "done", round(r["seconds"]), "s; key gate @100%:", [(x["closeAt"], x["area_peak"]) for x in k], flush=True)

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
    device = sys.argv[sys.argv.index("--device") + 1] if "--device" in sys.argv else ("cuda" if torch.cuda.is_available() else "cpu")  # cuda / mps / cpu
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else str(ROOT / "work/sweep")
    {"validate": lambda: validate(rid, device), "validate-river": lambda: validate_river(rid, device), "river": lambda: river(rid, device, out), "closure": lambda: closure(rid, device, out)}.get(cmd, lambda: sweep(rid, device, out))()
