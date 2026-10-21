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
