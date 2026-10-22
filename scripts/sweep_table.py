#!/usr/bin/env python3
"""把 data/processed/<id>/sweep.json（Colab GPU 降雨情境集合）整理成 docs/STAGES.md 用的 Markdown 表。用法：python3 scripts/sweep_table.py"""
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
NAMES = {"xindian": "新店溪", "tamsui": "淡水河東岸", "shilin": "基隆河下游（士林・社子）", "zhongshan": "基隆河中游（中山・松山・大直）", "neihu": "基隆河上游（內湖・南港）", "jingmei": "景美溪", "beitou": "基隆河出海段（北投・關渡）"}
rows = []
for rid, name in NAMES.items():
    f = ROOT / f"data/processed/{rid}/sweep.json"
    if not f.exists(): continue
    sw = json.loads(f.read_text()); sc = sw["scenarios"]
    pick = lambda dr, I, hr=1: next(s for s in sc if s["drain"] == dr and s["hours"] == hr and s["rain"] == I)
    off = {}
    for c in ("100", "130"):
        cf = ROOT / f"data/processed/{rid}/compare_{c}.json"
        if cf.exists(): off[c] = json.loads(cf.read_text())["ge15cm"]["official_ha"]
    d = {I: pick("design", I) for I in (78.8, 100, 130, 200)}
    rows.append((name, d, pick("pump30", 100), pick("sewer50", 100), pick("design", 100, 3), off, sw))
print("| 河段 | 78.8 mm/h | 100 mm/h（T+4 h／尖峰） | 130 mm/h | 200 mm/h | 100 mm/h・抽水 30% | 100 mm/h・下水道 50 | 100 mm/h・延時 3 h | 官方 100／130 | GPU 秒數 |")
print("|---|---|---|---|---|---|---|---|---|---|")
for name, d, p30, s50, h3, off, sw in rows:
    print(f"| {name} | {d[78.8]['area_peak']:.0f} | {d[100]['area_4h']:.0f}／{d[100]['area_peak']:.0f} | {d[130]['area_peak']:.0f} | {d[200]['area_peak']:.0f} | {p30['area_peak']:.0f} | {s50['area_peak']:.0f} | {h3['area_peak']:.0f} | {off.get('100', float('nan')):.0f}／{off.get('130', float('nan')):.0f} | {sw['seconds']} |")

# ---- 水門失效情境集合（river.json）----
print()
print("| 河段 | 關鍵水門 | 關鍵門未關：Q₁／Q₂／Q₃／Q₄／Q₅（潮位 1.6 m）尖峰 ha | 所有門未關 Q₃ | 全關 Q₅＋暴潮（越堤） | 關鍵門 Q₃：暴潮 2.0 − 潮位 1.0 | GPU 秒數 |")
print("|---|---|---|---|---|---|---|")
for rid, name in NAMES.items():
    f = ROOT / f"data/processed/{rid}/river.json"
    if not f.exists(): continue
    rv = json.loads(f.read_text()); sc = rv["scenarios"]; Qs = rv["Qpeaks"]; kg = f"g{rv['keyGate']}"
    pick = lambda Q, td, g: next((s for s in sc if s["Qpeak"] == Q and s["tide"] == td and s["gates"] == g), None)
    ks = [pick(Q, 1.6, kg) for Q in Qs]
    if not all(ks): continue
    qlab = "／".join(str(Q) for Q in Qs) + ("%" if rv["qUnit"] == "%" else " m³/s")
    a20, a10 = pick(Qs[2], 2.0, kg), pick(Qs[2], 1.0, kg)
    peaks = "／".join(f"{k['area_peak']:.0f}" for k in ks); allq = pick(Qs[2], 1.6, "all"); ov = pick(Qs[-1], 2.0, "none")
    tide_eff = f"{a20['area_peak'] - a10['area_peak']:+.0f}" if a20 and a10 else "—"
    print(f"| {name} | {rv['gateNames'][rv['keyGate']]} | {qlab}：{peaks} | {allq['area_peak'] if allq else float('nan'):.0f} | {ov['area_peak'] if ov else float('nan'):.0f} | {tide_eff} | {rv['seconds']} |")
