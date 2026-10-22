#!/usr/bin/env python3
"""各河段的地形色階與等高線範圍（頁面與 Blender 共用）→ data/processed/<id>/look.json
zlo＝堤內高程第 2 百分位；zhi＝max(zlo＋5 m, 堤頂中位數)。zlo–zhi 是「會不會淹」的關鍵高程，用完整色階；zhi 以上是山坡，改用林地色。
用法：python3 scripts/look.py [id …]"""
import json, re, sys, base64, pathlib
import numpy as np
ROOT = pathlib.Path(__file__).resolve().parent.parent
IDS = ["xindian", "tamsui", "shilin", "zhongshan", "neihu", "jingmei", "beitou"]
# 低地色階（t＝0→1，zlo→zhi）：低處偏青綠、高處偏暖，與淹水藍色區隔
LOW = [(0.0, "#5f9483"), (0.22, "#94bd8f"), (0.45, "#d8dba4"), (0.7, "#e2bf8a"), (1.0, "#bf8f66")]
# 山坡（zhi 以上的公尺數）
HILL = [(0, "#bf8f66"), (6, "#9aa07a"), (40, "#7f9170"), (150, "#94998a"), (400, "#b9b7ae")]

def paths(rid):
    if rid == "xindian": return ROOT / "data/processed/demW.json", ROOT / "data/processed/bldW.json", ROOT / "src/xindian_data.js"
    d = ROOT / "data/processed" / rid; return d / "dem.json", d / "bld.json", d / "region_data.js"

def load_dem(rid):
    d = json.loads(paths(rid)[0].read_text()); nx, ny = d["nx"], d["ny"]
    z = np.frombuffer(base64.b64decode(d["z"]), "<i2").astype(np.float32).reshape(ny, nx) / 100
    m = np.frombuffer(base64.b64decode(d["mask"]), "u1").reshape(ny, nx)
    return d, z, m

def look(rid):
    _, z, m = load_dem(rid)
    s = paths(rid)[2].read_text(encoding="utf-8")
    lev = [float(x) for x in re.findall(r'levee"?\s*:\s*([0-9.]+)', s)]
    zlo = float(np.floor(np.percentile(z[m == 1], 2) * 2) / 2)
    zhi = float(np.ceil(max(zlo + 5, float(np.median(lev))) * 2) / 2)  # 堤頂中位數（新店溪、景美溪上游堤頂高，取最大會把低地色階壓扁）
    step = 0.5 if zhi - zlo <= 10 else 1.0
    return {"zlo": zlo, "zhi": zhi, "contour_step": step, "contour_major": 1.0 if step == 0.5 else 5.0, "low": LOW, "hill": HILL}

if __name__ == "__main__":
    for rid in sys.argv[1:] or IDS:
        lk = look(rid); out = ROOT / "data/processed" / rid / "look.json"
        out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(lk, ensure_ascii=False))
        print(rid, lk["zlo"], lk["zhi"], lk["contour_step"])
