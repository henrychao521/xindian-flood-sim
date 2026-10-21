"""臺北市降雨積水模擬圖（水利處 112 年版，KML，WGS84）→ 各河段 20 m 網格的積水深度等級
輸入：data/raw/taipei_inundation_<case>.kml（case = 78.8、100、130 mm/h）
輸出：data/processed/<id>/inund.json = {"classes": {...}, "cases": {"100": base64 uint8, ...}}，值為 GRIDCODE（0 = 無積水或 < 0.15 m）
用法：python3 scripts/inundation_layer.py [id …]
"""
import sys, re, json, base64, pathlib, numpy as np
from pyproj import Transformer

ROOT = pathlib.Path(__file__).resolve().parent.parent
TO_TM = Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True)
CASES = ["78.8", "100", "130"]

def load_case(case):
    """回傳 (classes, pts, codes)：每個 5 m 方格多邊形的中心點（TWD97）與等級"""
    s = (ROOT / f"data/raw/taipei_inundation_{case}.kml").read_text(encoding="utf-8", errors="replace")
    classes, X, Y, C = {}, [], [], []
    for pm in re.finditer(r"<Placemark>(.*?)</Placemark>", s, re.S):
        body = pm.group(1)
        code = int(re.search(r'<SimpleData name="GRIDCODE">(\d+)<', body).group(1))
        classes[code] = re.search(r"<name>([^<]*)</name>", body).group(1).replace("m_", " m – ").replace("m<", " m<")
        for ring in re.finditer(r"<coordinates>\s*([^<]+?)\s*</coordinates>", body):
            pts = np.array([[float(v) for v in p.split(",")[:2]] for p in ring.group(1).split()])
            X.append(pts[:, 0].mean()); Y.append(pts[:, 1].mean()); C.append(code)
    x, y = TO_TM.transform(np.array(X), np.array(Y))
    return classes, np.array(x), np.array(y), np.array(C, dtype=np.uint8)

def grids(ids):
    for rid in ids:
        if rid == "xindian":
            d = json.loads((ROOT / "data/processed/demW.json").read_text()); yield rid, d["x0"], d["y0"], d["nx"], d["ny"]
        else:
            c = json.loads((ROOT / f"regions/{rid}.json").read_text(encoding="utf-8")); xa, ya, xb, yb = c["bbox"]
            yield rid, xa, ya, (xb - xa) // 20, (yb - ya) // 20

ids = sys.argv[1:] or ["xindian", "tamsui", "shilin", "zhongshan", "neihu", "jingmei", "beitou"]
data = {case: load_case(case) for case in CASES}
for rid, x0, y0, nx, ny in grids(ids):
    out = {"classes": {}, "cases": {}, "source": "臺北市政府工務局水利工程處「臺北市降雨積水模擬圖（112 年更新版）」，政府資料開放授權條款第 1 版"}
    for case, (classes, x, y, c) in data.items():
        out["classes"].update({str(k): v for k, v in classes.items()})
        g = np.zeros((ny, nx), np.uint8)
        i = ((x - x0) // 20).astype(int); j = ((y - y0) // 20).astype(int)
        m = (i >= 0) & (i < nx) & (j >= 0) & (j < ny)
        np.maximum.at(g, (j[m], i[m]), c[m])  # 一格裡有多個 5 m 方格：取最深等級
        out["cases"][case] = base64.b64encode(g.tobytes()).decode()
        print(f"{rid} {case} mm/h: {int((g > 0).sum()) * 0.04:.0f} ha in grid")
    od = ROOT / "data/processed" / rid; od.mkdir(parents=True, exist_ok=True)
    (od / "inund.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
