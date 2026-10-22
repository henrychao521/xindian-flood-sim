#!/usr/bin/env python3
"""下載各河段範圍內的明渠溪流（OSM waterway=river|stream|canal，不含加蓋／涵洞）→ work/streams/<id>.json（原始，不進 repo）
用 Overpass API；主站忙時換鏡像站。用法：python3 scripts/fetch_streams.py [id …]"""
import json, sys, time, pathlib, urllib.request, urllib.parse
from pyproj import Transformer
ROOT = pathlib.Path(__file__).resolve().parent.parent
MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
tf = Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)

def bbox(rid):
    if rid == "xindian":
        d = json.loads((ROOT / "data/processed/demW.json").read_text()); return [d["x0"], d["y0"], d["x0"] + d["nx"] * d["d"], d["y0"] + d["ny"] * d["d"]]
    return json.loads((ROOT / f"regions/{rid}.json").read_text())["bbox"]

def fetch(rid):
    xa, ya, xb, yb = bbox(rid); lon0, lat0 = tf.transform(xa, ya); lon1, lat1 = tf.transform(xb, yb)
    q = f'[out:json][timeout:90];way["waterway"~"^(river|stream|canal)$"]({lat0:.6f},{lon0:.6f},{lat1:.6f},{lon1:.6f});out tags geom;'
    for attempt in range(8):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "xindian-flood-sim/1.0 (teaching model)"})
            d = json.load(urllib.request.urlopen(req, timeout=120))
            (ROOT / "work/streams").mkdir(parents=True, exist_ok=True)
            (ROOT / f"work/streams/{rid}.json").write_text(json.dumps(d, ensure_ascii=False))
            print(rid, len(d["elements"]), "ways from", url.split("/")[2]); return
        except Exception as e:
            print(rid, "retry", attempt, url.split("/")[2], e); time.sleep(5 * (attempt + 1))
    raise SystemExit(f"{rid}: all mirrors failed")

if __name__ == "__main__":
    for rid in sys.argv[1:] or ["xindian", "tamsui", "shilin", "zhongshan", "neihu", "jingmei", "beitou"]: fetch(rid)
