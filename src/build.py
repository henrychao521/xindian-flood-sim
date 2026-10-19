"""組合單一 HTML 頁面：src/ 下的模板與程式 ＋ data/processed/ 的資料 → 輸出檔。
用法：python3 src/build.py [輸出路徑，預設 index.html] [--local-three]
"""
import sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
S, D = ROOT / "src", ROOT / "data" / "processed"
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else ROOT / "index.html"
r = lambda p: p.read_text(encoding="utf-8")
src = r(S / "page.src.html")
data = ("const DEM_DATA=" + r(D / "demW.json") + ";\nconst BLD_DATA=" + r(D / "bldW.json") + ";\nconst OSM_DATA=" + r(D / "osm2.json") + ";\n")
for a, b in [("//@@DEMDATA@@", data), ("//@@ENGINE@@", r(S / "engine.js")), ("//@@TERRAIN@@", r(S / "terrain.js")), ("//@@FLOW@@", r(S / "flow.js") + "\n" + r(S / "osm.js"))]:
    assert a in src, a
    src = src.replace(a, b)
if "--local-three" in sys.argv:  # 離線測試用
    src = src.replace("https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js", "vendor/three.min.js").replace("https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js", "vendor/OrbitControls.js")
# 補上完整 HTML 文件骨架（claude.ai Artifact 版本由平台自動包裝）
i = src.index("<style>")
head = src[:i].replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
rest = src[i:]
j = rest.index("</style>") + len("</style>")
doc = ('<!doctype html>\n<html lang="zh-Hant-TW">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
       '<meta name="description" content="新店溪洩洪與疏散門失效淹水模擬：實測地形、3D 建物、二維水流與排水系統。教學用簡化模型。">\n'
       + head + rest[:j].replace("<style>\n", "<style>\nhtml, body { margin: 0; } [hidden] { display: none !important; } img { max-width: 100%; }\n", 1)
       + "\n</head>\n<body>\n" + rest[j:] + "\n</body>\n</html>\n")
out.write_text(doc, encoding="utf-8")
print("wrote", out, len(doc))
