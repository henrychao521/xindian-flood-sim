"""把 data/processed/<id>/results.json 與 compare_*.json 整理成 Markdown 表格（貼到 docs/STAGES.md 用）"""
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
NAMES = {"xindian": "新店溪", "tamsui": "淡水河東岸", "shilin": "基隆河下游（士林・社子）", "zhongshan": "基隆河中游（中山・松山・大直）",
         "neihu": "基隆河上游（內湖・南港）", "jingmei": "景美溪", "beitou": "基隆河出海段（北投・關渡）"}
print("| 河段 | 關鍵水門未關（4 h） | 時雨量 110 mm・1 h（4 h） | 短延時 100 mm/h：本模型／官方 ≥ 0.15 m | 命中率 | 130 mm/h：本模型／官方 | 命中率 |")
print("|---|---|---|---|---|---|---|")
for rid, name in NAMES.items():
    d = ROOT / f"data/processed/{rid}"
    if not (d / "results.json").exists(): continue
    r = json.loads((d / "results.json").read_text(encoding="utf-8"))
    ko, ra = r["keyopen"]["t4h"], r["rain"]["t4h"]
    cells = [name, f'{ko["area_ha"]:.0f} ha（{r["keyGate"]}）', f'{ra["area_ha"]:.0f} ha，≥ 0.5 m {ra["deep_ha"]:.0f} ha']
    for case in ("100", "130"):
        cf = d / f"compare_{case}.json"
        if cf.exists():
            g = json.loads(cf.read_text(encoding="utf-8"))["ge15cm"]
            cells += [f'{g["model_ha"]:.0f}／{g["official_ha"]:.0f} ha', f'{(g["hit_rate"] or 0) * 100:.0f}%']
        else: cells += ["—", "—"]
    print("| " + " | ".join(cells) + " |")
