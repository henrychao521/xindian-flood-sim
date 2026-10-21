"""模型的降雨情境 vs 臺北市水利處降雨積水模擬圖（112 年版）
輸入：tests/region_check.js 產生的 <prefix>_stats.json（含 rain_depth_cm_b64，4 小時時的堤內水深）、data/processed/<id>/inund.json
用法：python3 scripts/compare_inundation.py <id> <stats.json> [case=100]
輸出：面積、重疊率（IoU）、命中率（官方積水格中模型也積水的比例）、誤報率，並寫入 data/processed/<id>/compare.json
"""
import sys, json, base64, pathlib, numpy as np
ROOT = pathlib.Path(__file__).resolve().parent.parent
rid, stats_fn = sys.argv[1], sys.argv[2]; case = sys.argv[3] if len(sys.argv) > 3 else "100"
st = json.loads(pathlib.Path(stats_fn).read_text(encoding="utf-8"))
inu = json.loads((ROOT / f"data/processed/{rid}/inund.json").read_text(encoding="utf-8"))
if rid == "xindian": d = json.loads((ROOT / "data/processed/demW.json").read_text())
else: d = json.loads((ROOT / f"data/processed/{rid}/dem.json").read_text())
nx, ny = d["nx"], d["ny"]
mask = np.frombuffer(base64.b64decode(d["mask"]), np.uint8).reshape(ny, nx)
model = np.frombuffer(base64.b64decode(st["rain_depth_cm_b64"]), np.uint8).reshape(ny, nx) / 100.0  # m
A = 0.04  # ha per 20 m cell
out = {"case_mm_h": case, "model_preset": st.get("depth_preset", "rain"), "inland_ha": round(float((mask == 1).sum()) * A, 1)}
for thr, key in ((0.15, "ge15cm"), (0.5, "ge50cm")):
    off = np.frombuffer(base64.b64decode(inu["cases"][case]), np.uint8).reshape(ny, nx)
    off_m = (off >= (2 if thr < 0.5 else 4)) & (mask == 1)  # GRIDCODE 2 = 0.15–0.3 m，4 = 0.5–1 m
    mod_m = (model >= thr) & (mask == 1)
    inter = int((off_m & mod_m).sum()); union = int((off_m | mod_m).sum())
    out[key] = {"official_ha": round(off_m.sum() * A, 1), "model_ha": round(mod_m.sum() * A, 1),
                "iou": round(inter / union, 3) if union else None,
                "hit_rate": round(inter / off_m.sum(), 3) if off_m.sum() else None,   # 官方積水處模型也積水
                "false_alarm": round(1 - inter / mod_m.sum(), 3) if mod_m.sum() else None}  # 模型積水但官方沒有
(ROOT / f"data/processed/{rid}/compare.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(rid, json.dumps(out, ensure_ascii=False))
