"""Pack xindian-flood-sim's Taipei DEM, OSM roads and 3D buildings into one JSON for Terrain GP.
Coordinates: metres relative to TWD97 E 299000 / N 2766400 (x east, y north)."""
import json, base64, sys
src = sys.argv[1] if len(sys.argv) > 1 else '../data/processed'
dem = json.load(open(f'{src}/demW.json'))
osm = json.load(open(f'{src}/osm2.json'))
bld = json.load(open(f'{src}/bldW.json'))
SX, SY = dem['nx'] * dem['d'], dem['ny'] * dem['d']
CLS = {'trunk': 0, 'primary': 1, 'secondary': 2, 'tertiary': 3, 'residential': 4, 'unclassified': 4, 'living_street': 4,
       'trunk_link': 5, 'primary_link': 5, 'secondary_link': 5, 'tertiary_link': 5}
inside = lambda p: -40 <= p[0] <= SX + 40 and -40 <= p[1] <= SY + 40
roads = []
for r in osm['roads']:
    c = CLS.get(r['c'])
    if c is None: continue
    run = []
    for p in r['p'] + [None]:
        if p is not None and inside(p): run.append(p); continue
        if len(run) >= 2:
            roads.append([c, r['n'] or ''] + [int(round(v * 10)) for q in run for v in q])
        run = []
def rdp(pts, eps):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    L = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5 or 1e-9
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L
        if d > dmax: dmax, idx = d, i
    if dmax <= eps: return [pts[0], pts[-1]]
    return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)

def simplify(b, eps=1.2):
    h, xy = b[0], b[1:]
    pts = [(xy[i], xy[i + 1]) for i in range(0, len(xy), 2)]
    if len(pts) <= 4: return b
    # split the ring at its farthest-apart vertices so RDP works on two open chains
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    a = rdp(pts[:far + 1], eps); c = rdp(pts[far:] + [pts[0]], eps)
    ring = a[:-1] + c[:-1]
    if len(ring) < 3: return b
    return [h] + [v for q in ring for v in q]

bld['b'] = [simplify(b) for b in bld['b']]

out = {
    'name': '臺北市 萬華・中正・大安', 'nx': dem['nx'], 'ny': dem['ny'], 'd': dem['d'], 'z': dem['z'], 'mask': dem['mask'],
    'roads': roads, 'buildings': bld['b'],
    'credits': '地形：內政部國土測繪中心 2025 年 20 m DEM（政府資料開放授權條款第 1 版）· 建物：臺北市 3D 近似建物模型（sheethub/tpe3d）· 道路：© OpenStreetMap contributors（ODbL）',
}
json.dump(out, open('data/taipei.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('roads', len(roads), 'buildings', len(out['buildings']))
