"""依 regions/<id>.json 產生一個河段的模擬資料：
  data/processed/<id>/dem.json、bld.json、osm.json、region_data.js

前置：python3 scripts/mosaic.py（全市 DEM）、work/tpe3d/*.json（sheethub/tpe3d 建物）
用法：python3 scripts/build_region.py <id> [--plot]
"""
import sys, json, csv, glob, math, time, pathlib, subprocess, base64, re
import numpy as np
from scipy import ndimage
from matplotlib.path import Path
from pyproj import Transformer

ROOT = pathlib.Path(__file__).resolve().parent.parent
RID = sys.argv[1]
cfg = json.loads((ROOT / f"regions/{RID}.json").read_text(encoding="utf-8"))
OUT = ROOT / "data/processed" / RID
OUT.mkdir(parents=True, exist_ok=True)
WORK = ROOT / "work" / RID
WORK.mkdir(parents=True, exist_ok=True)
D = 20
xa, ya, xb, yb = cfg["bbox"]
TO_LL = Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)
TO_TM = Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True)

# ---------------- 1. 地形 ----------------
d = np.load(ROOT / "work/taipei_dem20.npz"); G = d["G"]; X0, Y0 = float(d["x0"]), float(d["y0"])
Z = G[int((ya - Y0) // D):int((yb - Y0) // D), int((xa - X0) // D):int((xb - X0) // D)].astype(np.float64)
ny, nx = Z.shape
Z[Z < -20] = np.nan  # DEM 少數異常值（例如 −327 m）
nodata = np.isnan(Z)
Z[nodata] = 20.0  # 範圍外（無資料）視為高地，不參與計算

# ---------------- 2. OSM（官方 API 分塊下載，快取於 work/<id>/osm） ----------------
osmdir = WORK / "osm"; osmdir.mkdir(exist_ok=True)
lon0, lat0 = TO_LL.transform(xa, ya); lon1, lat1 = TO_LL.transform(xb, yb)
tiles = []
x = lon0
while x < lon1:
    y = lat0
    while y < lat1:
        tiles.append((x, y, min(x + 0.01, lon1), min(y + 0.01, lat1))); y += 0.01
    x += 0.01
for k, b in enumerate(tiles):
    fn = osmdir / f"t{k:02d}.osm"
    if not fn.exists() or fn.stat().st_size < 1000:
        bb = ",".join(f"{v:.4f}" for v in b)
        subprocess.run(["curl", "-sS", "-m", "180", "-o", str(fn), f"https://api.openstreetmap.org/api/0.6/map?bbox={bb}"], check=False)
        time.sleep(1)
import xml.etree.ElementTree as ET
nodes, ways = {}, {}
for fn in sorted(osmdir.glob("t*.osm")):
    for ev, el in ET.iterparse(fn, events=("end",)):
        if el.tag == "node":
            tg = {t.get("k"): t.get("v") for t in el.findall("tag")}
            nodes[el.get("id")] = (float(el.get("lon")), float(el.get("lat")), tg or None)
        elif el.tag == "way":
            ways[el.get("id")] = ([nd.get("ref") for nd in el.findall("nd")], {t.get("k"): t.get("v") for t in el.findall("tag")})
        if el.tag in ("node", "way", "relation"): el.clear()
def xy(ids):
    out = []
    for i in ids:
        if i in nodes:
            X, Y = TO_TM.transform(nodes[i][0], nodes[i][1]); out.append((round(X - xa, 1), round(Y - ya, 1)))
    return out

# ---------------- 3. 河道、堤線、堤內 ----------------
waterMax = cfg.get("waterMax", 1.0)
low = (Z < waterMax) & ~nodata
for poly in cfg.get("notChannel", []):  # 堤內的低窪地（例如洲美），不要誤判為河道
    jj, ii = np.mgrid[0:ny, 0:nx]
    low &= ~Path(np.array(poly)).contains_points(np.c_[ii.ravel(), jj.ravel()]).reshape(ny, nx)
lab, n = ndimage.label(low)
sz = ndimage.sum(low, lab, range(1, n + 1))
chan = np.isin(lab, [k + 1 for k in range(n) if sz[k] >= cfg.get("minChannel", 150)])
for poly in cfg.get("extraChannel", []):  # 手動補上的河道（例如上游水面較高的河段）
    pts = np.array(poly)
    for (i0, j0), (i1, j1) in zip(pts[:-1], pts[1:]):
        for t in np.linspace(0, 1, int(max(abs(i1 - i0), abs(j1 - j0))) * 3 + 1):
            i, j = int(round(i0 + (i1 - i0) * t)), int(round(j0 + (j1 - j0) * t))
            chan[max(0, j - 2):j + 3, max(0, i - 2):i + 3] = True
for nm in cfg.get("osmRivers", []):  # 依 OSM 河道中線補上河道（上游水面高於 waterMax 的河段）
    hw = cfg.get("osmRiverHalfWidth", 2)
    for ids, tg in ways.values():
        if tg.get("waterway") != "river" or tg.get("name") != nm: continue
        p = np.array(xy(ids)) / D
        for a2, b2 in zip(p[:-1], p[1:]):
            for t in np.linspace(0, 1, int(max(abs(b2 - a2))) * 3 + 2):
                i, j = int(round(a2[0] + (b2[0] - a2[0]) * t)), int(round(a2[1] + (b2[1] - a2[1]) * t))
                if 0 <= i < nx and 0 <= j < ny: chan[max(0, j - hw):j + hw + 1, max(0, i - hw):i + hw + 1] = True
dist = ndimage.distance_transform_edt(~chan)
ring = (dist > 0) & (dist <= cfg.get("wallDist", 2.0))
block = chan | ring | nodata
manual = np.zeros_like(chan)
for poly in cfg.get("levee", []):  # 手動描繪的堤線（格點座標），會吸附到附近最高點
    S = []
    for x, y in poly:
        best = None
        for j in range(max(0, y - 2), min(ny, y + 3)):
            for i in range(max(0, x - 2), min(nx, x + 3)):
                if best is None or Z[j, i] > Z[best]: best = (j, i)
        S.append(best)
    for (j0, i0), (j1, i1) in zip(S[:-1], S[1:]):
        for t in np.linspace(0, 1, int(max(abs(j1 - j0), abs(i1 - i0))) * 3 + 1):
            manual[int(round(j0 + (j1 - j0) * t)), int(round(i0 + (i1 - i0) * t))] = True
manual = ndimage.binary_dilation(manual, structure=np.ones((2, 2), bool))
block |= manual
seeds = [tuple(s[::-1]) for s in cfg["inlandSeeds"]]
inland = np.zeros_like(chan)
for s in seeds:
    if not block[s]:
        inland |= (ndimage.label(~block)[0] == ndimage.label(~block)[0][s])
for s in seeds: assert inland[s], f"seed {s} is blocked"
wall = (ring | manual) & ndimage.binary_dilation(inland, iterations=1) & ~inland
far = (dist > 10) & ~inland & ~wall
mask = np.where(wall, 2, np.where(inland, 1, np.where(far, 3, 0))).astype(np.uint8)
mask[nodata & ~inland] = 3

# 堤頂：DEM 與設定值取大（20 m 網格會把窄的防洪牆平均掉）
crest = cfg.get("crest", 10.0)
Zb = Z.copy()
if any("crest" in nd for nd in cfg["nodes"]):  # 坡陡的河川：各段堤頂取最近節點的設定值
    wj0, wi0 = np.where(wall)
    nc = np.array([nd["cell"] for nd in cfg["nodes"]]); ncr = np.array([nd.get("crest", crest) for nd in cfg["nodes"]])
    near = np.argmin((wi0[:, None] - nc[None, :, 0]) ** 2 + (wj0[:, None] - nc[None, :, 1]) ** 2, axis=1)
    Zb[wj0, wi0] = np.maximum(Z[wj0, wi0], ncr[near])
else:
    Zb[wall] = np.maximum(Z[wall], crest)
Zi = Zb.copy()
pitFloor = cfg.get("pitFloor", float(np.percentile(Z[inland], 0.5)))
Zi[inland] = np.maximum(Zi[inland], pitFloor)
# 山坡上的小窪地多半是 20 m DEM 的誤差，下雨時會積出數公尺深的假水池：
# 以 priority-flood 填平，只處理比堤頂還高的格子（堤內平地的低窪處保留）
import heapq
fillAbove = cfg.get("fillAbove", max(pitFloor + 8, float(Zb[wall].max()) + 1 if wall.any() else crest + 1))
done = ~inland.copy(); F = Zi.copy(); hq = []
for j, i in zip(*np.where(inland & ndimage.binary_dilation(~inland))): hq.append((F[j, i], j, i)); done[j, i] = True
# 範圍邊界是封閉的（模型不讓水流出去），所以邊界不當出口：山坡流到邊界積成的假水池也一併填平
heapq.heapify(hq)
while hq:
    h, j, i = heapq.heappop(hq)
    for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        jj, ii = j + dj, i + di
        if 0 <= jj < ny and 0 <= ii < nx and not done[jj, ii]:
            done[jj, ii] = True; F[jj, ii] = max(F[jj, ii], h); heapq.heappush(hq, (F[jj, ii], jj, ii))
hill = inland & (Zi > fillAbove)
filled_cells = int((F[hill] > Zi[hill] + 0.01).sum())
Zi[hill] = F[hill]

# ---------------- 3b. 道路、公共設施、抽水站（抽水站需用到堤內範圍）----------------
HW = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "living_street", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
AM = {"school", "kindergarten", "hospital", "clinic", "police", "fire_station", "townhall", "community_centre", "library", "social_facility", "university", "college", "marketplace", "post_office"}
roads, bridges, pubs, gates_osm = [], [], [], []
for wid, (ids, tg) in ways.items():
    hw = tg.get("highway")
    if hw in HW:
        pts = xy(ids)
        if len(pts) < 2: continue
        rec = {"n": tg.get("name", ""), "c": hw, "p": pts}
        if tg.get("bridge") in ("yes", "viaduct"):
            lay = tg.get("layer", "1"); rec["l"] = int(lay) if lay.lstrip("-").isdigit() else 1; bridges.append(rec)
        elif tg.get("tunnel") != "yes": roads.append(rec)
    am = tg.get("amenity")
    if am in AM and tg.get("name"):
        pts = xy(ids)
        if len(pts) >= 3:
            pubs.append({"n": tg["name"], "t": am, "x": round(sum(p[0] for p in pts) / len(pts), 1), "y": round(sum(p[1] for p in pts) / len(pts), 1)})
for nid, (lon, lat, tg) in nodes.items():
    if not tg: continue
    X, Y = TO_TM.transform(lon, lat)
    if not (xa <= X <= xb and ya <= Y <= yb): continue
    nm = tg.get("name", "")
    if "疏散門" in nm and tg.get("amenity") != "bicycle_rental":
        gates_osm.append({"n": nm, "ref": tg.get("alt_name", ""), "x": round(X - xa, 1), "y": round(Y - ya, 1)})
    if tg.get("amenity") in AM and nm:
        pubs.append({"n": nm, "t": tg["amenity"], "x": round(X - xa, 1), "y": round(Y - ya, 1)})
seen = set(); pubs2 = []
for p in pubs:
    key = (p["n"], round(p["x"] / 50), round(p["y"] / 50))
    if key not in seen: seen.add(key); pubs2.append(p)
pubs = pubs2
gseen = {}; [gseen.setdefault(g["n"], g) for g in gates_osm]; gates_osm = list(gseen.values())
pumps = []
for r in csv.DictReader(open(ROOT / "data/raw/taipei_pump_stations.csv", encoding="utf-8-sig")):
    X, Y = float(r["X坐標"]), float(r["Y坐標"])
    if xa <= X <= xb and ya <= Y <= yb:
        i, j = int((X - xa) // D), int((Y - ya) // D)
        if not inland[max(0, j - 8):j + 9, max(0, i - 8):i + 9].any(): continue  # 堤外（例如社子島）的抽水站不服務本範圍堤內
        pumps.append({"n": re.sub(r"\(.*?\)", "", r["站名"]).removesuffix("抽水站") + "抽水站", "x": round(X - xa, 1), "y": round(Y - ya, 1), "river": r["河系"]})

# ---------------- 4. 疏散門：OSM 位置 → 最近堤線格；底檻取門內外地面較高者 ----------------
wj, wi = np.where(wall)
ctrl = cfg.get("gates")  # 選用：只納入哪些疏散門（名稱），其餘只標示
gates, other_gates = [], []
for g in gates_osm:
    i, j = g["x"] / D, g["y"] / D
    if len(wi) == 0: break
    k = int(np.argmin((wi - i) ** 2 + (wj - j) ** 2))
    if math.hypot(wi[k] - i, wj[k] - j) * D > cfg.get("gateSnap", 80):
        other_gates.append({"n": g["n"], "ref": g["ref"] or "疏散門", "x": g["x"], "y": g["y"]}); continue
    gi, gj = int(wi[k]), int(wj[k])
    if any(g2["cell"] == [gi, gj] for g2 in gates):  # 兩座門吸附到同一格：只保留第一座
        other_gates.append({"n": g["n"], "ref": g["ref"] or "疏散門", "x": g["x"], "y": g["y"]}); continue
    win = (slice(max(0, gj - 3), gj + 4), slice(max(0, gi - 3), gi + 4))
    zin = np.median(Z[win][inland[win]]) if inland[win].any() else Z[gj, gi]
    zout_cells = Z[win][(mask[win] == 0) & ~chan[win]]
    zout = np.median(zout_cells) if len(zout_cells) else zin
    sill = round(float(max(zin, zout, pitFloor + 0.3)), 2)
    rec = {"name": g["n"].replace("疏散門", "門"), "osm": g["n"], "ref": g["ref"], "cell": [gi, gj], "sill": sill}
    if ctrl is None or g["n"] in ctrl: gates.append(rec)
    else: other_gates.append({"n": g["n"], "ref": g["ref"] or "疏散門", "x": g["x"], "y": g["y"]})
for g in cfg.get("extraGates", []):  # OSM 沒有標註的水門（依文獻或推定位置）
    i, j = g["cell"]; k = int(np.argmin((wi - i) ** 2 + (wj - j) ** 2)); gi, gj = int(wi[k]), int(wj[k])
    gates.append({"name": g["name"], "osm": "", "ref": g.get("note", "推定位置"), "cell": [gi, gj], "sill": g.get("sill", round(float(Z[gj, gi]), 2))})
if cfg.get("autoGates"):  # OSM 沒有疏散門資料時：道路由堤內穿過堤線通往高灘地處，推定為疏散門
    cand = []
    for r in roads:
        if r["c"] in ("motorway", "trunk", "motorway_link", "trunk_link"): continue
        p = np.array(r["p"]) / D
        seq = []
        for a, b in zip(p[:-1], p[1:]):
            for t in np.linspace(0, 1, max(2, int(np.hypot(*(b - a)) * 4))):
                i, j = int(a[0] + (b[0] - a[0]) * t), int(a[1] + (b[1] - a[1]) * t)
                if 0 <= i < nx and 0 <= j < ny and (not seq or seq[-1][:2] != (i, j)): seq.append((i, j, mask[j, i]))
        for k in range(1, len(seq) - 1):
            if seq[k][2] != 2: continue
            back = [s[2] for s in seq[max(0, k - 4):k]]; fwd = [s[2] for s in seq[k + 1:k + 5]]
            outs = [s for s in seq[k + 1:k + 5] + seq[max(0, k - 4):k] if s[2] == 0 and not chan[s[1], s[0]]]
            if (1 in back and outs and 0 in fwd) or (1 in fwd and outs and 0 in back):
                cand.append((seq[k][0], seq[k][1], r["n"] or "無名道路", r["c"]))
    rank = {"primary": 0, "secondary": 1, "tertiary": 2}
    cand.sort(key=lambda c: (rank.get(c[3], 3), c[2] == "無名道路"))
    taken = [g["cell"] for g in gates]; n0 = len(taken)
    for i, j, nm, _ in cand:
        if len(taken) - n0 >= cfg["autoGates"]: break
        if any(math.hypot(i - a, j - b) * D < cfg.get("autoGateSpacing", 600) for a, b in taken): continue
        if any(Path(np.array(q)).contains_point((i, j)) for q in cfg.get("autoGateExclude", [])): continue
        taken.append([i, j])
        win = (slice(max(0, j - 3), j + 4), slice(max(0, i - 3), i + 4))
        zin = np.median(Z[win][inland[win]]) if inland[win].any() else Z[j, i]
        zo = Z[win][(mask[win] == 0) & ~chan[win]]
        sill = round(float(max(zin, np.median(zo) if len(zo) else zin, pitFloor + 0.3)), 2)
        gates.append({"name": f"{nm}門", "osm": "auto", "ref": "推定位置（道路穿越堤線處）", "cell": [i, j], "sill": sill})
for g in gates: Zi[g["cell"][1], g["cell"][0]] = g["sill"]

# ---------------- 5. 河段節點：常水位（DEM 水面）、計畫洪水位（堤頂 − 出水高）----------------
nodes_out = []
cum = 0.0
prev = None
for nd in cfg["nodes"]:
    i, j = nd["cell"]
    if prev is not None: cum += math.hypot(i - prev[0], j - prev[1]) * D / 1000
    prev = (i, j)
    win = (slice(max(0, j - 6), j + 7), slice(max(0, i - 6), i + 7))
    if not chan[win].any():  # 節點不在河道上：吸附到最近的河道格
        cj, ci = np.where(chan); k = int(np.argmin((ci - i) ** 2 + (cj - j) ** 2)); i, j = int(ci[k]), int(cj[k])
        win = (slice(max(0, j - 6), j + 7), slice(max(0, i - 6), i + 7))
    zn = float(np.percentile(Z[win][chan[win]], cfg.get("znPercentile", 50)))
    zn = nd.get("zn", zn)
    plain_cells = Z[win][(mask[win] == 0) & ~chan[win]]
    plain = float(np.median(plain_cells)) if len(plain_cells) else zn + 3
    lev = nd.get("crest", round(zn + cfg["crestAboveZn"], 1) if "crestAboveZn" in cfg else crest)
    nodes_out.append({"id": f"n{len(nodes_out)}", "name": nd["name"], "km": round(cum, 2), "cell": [i, j],
                      "bed": round(zn - nd.get("depth", 4), 2), "plain": round(max(plain, zn + 0.5), 2), "levee": lev,
                      "zn": round(zn, 2), "zd": round(lev - nd.get("freeboard", 1.5), 2), "tf": nd.get("tf", 0.5)})
for g in gates:
    i, j = g["cell"]
    g["node"] = int(np.argmin([(n["cell"][0] - i) ** 2 + (n["cell"][1] - j) ** 2 for n in nodes_out]))

# ---------------- 6. 建物（臺北市 3D 近似建物模型，sheethub/tpe3d）----------------
TB = Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True)
best = {}
for fn in sorted((ROOT / "work/tpe3d").glob("*.json")):
    try: dd = json.load(open(fn))
    except Exception: continue
    for ft in dd["features"]:
        gm = ft["geometry"]
        if gm["type"] != "Polygon": continue
        ring = np.array(gm["coordinates"][0])
        X, Y = TB.transform(ring[:, 0], ring[:, 1]); X = np.array(X); Y = np.array(Y)
        if X.max() < xa or X.min() > xb or Y.max() < ya or Y.min() > yb: continue
        key = (round(X.mean()), round(Y.mean()))
        h = ft["properties"].get("height") or 3.0
        if key not in best or h > best[key][0]: best[key] = (h, X, Y)
sub = 4
gx = (np.arange(nx * sub) + 0.5) * D / sub + xa; gy = (np.arange(ny * sub) + 0.5) * D / sub + ya
GX, GY = np.meshgrid(gx, gy); P2 = np.c_[GX.ravel(), GY.ravel()]
inside = np.zeros(len(P2), bool); blds = []
for h, X, Y in best.values():
    X = np.clip(X, xa, xb); Y = np.clip(Y, ya, yb)
    keep = [0] + [k for k in range(1, len(X)) if abs(X[k] - X[k - 1]) > 0.05 or abs(Y[k] - Y[k - 1]) > 0.05]
    X, Y = X[keep], Y[keep]
    if len(X) > 3 and abs(X[0] - X[-1]) < 0.05 and abs(Y[0] - Y[-1]) < 0.05: X, Y = X[:-1], Y[:-1]
    if len(X) < 3: continue
    m = (P2[:, 0] >= X.min()) & (P2[:, 0] <= X.max()) & (P2[:, 1] >= Y.min()) & (P2[:, 1] <= Y.max())
    if m.any(): inside[np.where(m)[0][Path(np.c_[X, Y]).contains_points(P2[m])]] = True
    blds.append([int(round(h * 10))] + [int(round(v)) for xy2 in zip(X - xa, Y - ya) for v in xy2])
cov = inside.reshape(ny * sub, nx * sub).reshape(ny, sub, nx, sub).mean(axis=(1, 3))

# ---------------- 7. 最低窪處（擴散起點）----------------
Zm = ndimage.median_filter(np.where(inland, Zi, 99), size=5)
er = ndimage.binary_erosion(inland, iterations=3)
low_c = np.unravel_index(np.argmin(np.where(er if er.any() else inland, Zm, 99)), Zi.shape)

# ---------------- 8. 輸出 ----------------
dem = {"nx": nx, "ny": ny, "x0": xa, "y0": ya, "d": D,
       "z": base64.b64encode(np.round(np.clip(Zi, -300, 320) * 100).astype("<i2").tobytes()).decode(),  # int16 公分：超過 327 m 會溢位，高山一律截到 320 m
       "mask": base64.b64encode(mask.tobytes()).decode(),
       "gates": {f"g{k}": g["cell"] for k, g in enumerate(gates)}, "low": [int(low_c[1]), int(low_c[0])]}
(OUT / "dem.json").write_text(json.dumps(dem, separators=(",", ":")))
(OUT / "bld.json").write_text(json.dumps({"cov": base64.b64encode(np.round(cov * 100).astype(np.uint8).tobytes()).decode(), "b": blds}, separators=(",", ":")))
(OUT / "osm.json").write_text(json.dumps({"roads": roads, "bridges": bridges, "pubs": pubs, "gates": other_gates, "pumps": pumps, "bounds": [], "full": True}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
G_JS = [{"id": f"g{k}", "basin": "wanhua", "name": g["name"], "node": g["node"], "sill": g["sill"], "width": cfg.get("gateWidth", 8),
         "zb": float(pitFloor), "amax": 1e6, "area": g["ref"] or g["osm"] or "推定位置", "assumedZb": False} for k, g in enumerate(gates)]
keyGate = next((k for k, g in enumerate(gates) if g["name"] == cfg.get("keyGate")), 0)
reg = {"id": RID, "keyGate": keyGate, "outlet": cfg.get("outlet", "W"), "cam": cfg.get("cam", [-150, 175, 200]),
       "labels": cfg.get("labels", []), "mapLabels": cfg.get("mapLabels", []), "qDesign": cfg["qDesign"], "riverWidth": cfg.get("riverWidth", 300), "bedRef": cfg.get("bedRef", 0),
       "title": cfg["title"], "river": cfg["river"], "districts": cfg["districts"]}
js = ("// 由 scripts/build_region.py 依 regions/%s.json 自動產生，請勿手動修改\n" % RID
      + "const NODES = " + json.dumps(nodes_out, ensure_ascii=False) + ";\n"
      + "const GATES = " + json.dumps(G_JS, ensure_ascii=False) + ";\n"
      + "const VILLAGES = [];\n"
      + "// 河道水位：常水位 zn 到計畫洪水位 zd 之間，依「計畫洪峰流量的比例 r」以 r^0.6 內插（寬淺河道曼寧公式的水深—流量關係），再加潮位影響\n"
      + "function riverStage(node, Qk, tide) { const r = Math.max(0, Qk * 10); return node.zn + (node.zd - node.zn) * Math.pow(r, 0.6) + node.tf * tide; }\n"
      + "const REGION = " + json.dumps(reg, ensure_ascii=False) + ";\n")
(OUT / "region_data.js").write_text(js, encoding="utf-8")
summary = {"grid": [nx, ny], "inland_km2": round(float(inland.sum()) * D * D / 1e6, 2), "wall_cells": int(wall.sum()), "gates": [(g["name"], g["cell"], g["sill"], nodes_out[g["node"]]["name"]) for g in gates],
           "other_gates": [g["n"] for g in other_gates], "auto_gates": sum(g["osm"] == "auto" for g in gates), "pumps": [p["n"] for p in pumps], "buildings": len(blds), "roads": len(roads), "bridges": len(bridges), "pubs": len(pubs),
           "nodes": [(n["name"], n["km"], n["zn"], n["zd"], n["plain"]) for n in nodes_out], "pitFloor": round(float(pitFloor), 2), "hill_pits_filled": filled_cells, "low": dem["low"]}
(OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False))

if "--plot" in sys.argv:
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    plt.rcParams["font.family"] = ["WenQuanYi Zen Hei"]
    fig, ax = plt.subplots(figsize=(nx / 18, ny / 18))
    ax.imshow(np.clip(Z, 0, 12), origin="lower", cmap="gist_earth")
    ax.imshow(np.ma.masked_where(mask != 1, mask), origin="lower", cmap="autumn", alpha=.25)
    ax.imshow(np.ma.masked_where(~chan, chan), origin="lower", cmap="winter", alpha=.6)
    yy, xx = np.where(wall); ax.plot(xx, yy, "k.", ms=1.5)
    for g in gates: ax.plot(*g["cell"], "ms", ms=6); ax.text(g["cell"][0] + 2, g["cell"][1], g["name"], fontsize=7, color="m")
    for p in pumps: ax.plot(p["x"] / D, p["y"] / D, "c^", ms=6); ax.text(p["x"] / D + 2, p["y"] / D, p["n"], fontsize=6, color="c")
    for n in nodes_out: ax.plot(*n["cell"], "wo", ms=5); ax.text(n["cell"][0] + 2, n["cell"][1] + 2, n["name"], fontsize=7, color="w")
    for s in cfg["inlandSeeds"]: ax.plot(*s, "r*", ms=10)
    ax.set_xticks(range(0, nx, 10)); ax.set_yticks(range(0, ny, 10)); ax.tick_params(labelsize=5); ax.grid(alpha=.3)
    plt.savefig(WORK / "check.png", dpi=55, bbox_inches="tight"); print("plot", WORK / "check.png")
