#!/usr/bin/env python3
"""合成頁面用的地形貼圖：Blender 算出的「只有地形」× 建物落影（兩張的比值，建物底下不算、強度減半）→ tex/<id>.jpg
用法：python3 scripts/compose_texture.py [id …]"""
import json, sys, pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from look import load_dem, paths, IDS
PX, STRENGTH = 8, 0.55

def compose(rid):
    A = np.asarray(Image.open(ROOT / f"work/blender/{rid}_tex.png").convert("RGB")).astype(np.float32)
    Bimg = np.asarray(Image.open(ROOT / f"work/blender/{rid}_shadow.png").convert("RGB")).astype(np.float32)
    h, w = A.shape[:2]; d, z, m = load_dem(rid); ny, nx = z.shape
    # 建物底面（與 Blender 相同座標：格中心 i 對應像素 i*PX，北朝上）
    fp = Image.new("L", (w, h), 0); dr = ImageDraw.Draw(fp)
    for a in json.loads(paths(rid)[1].read_text())["b"]:
        pts = [((a[i] / d["d"] - 0.5) * PX, h - (a[i + 1] / d["d"] - 0.5) * PX) for i in range(1, len(a) - 1, 2)]
        if len(pts) >= 3: dr.polygon(pts, fill=255)
    fp = np.asarray(fp.filter(ImageFilter.MaxFilter(5))) > 0
    ratio = np.clip(Bimg.mean(2) / np.maximum(A.mean(2), 1), 0, 1)
    ratio[fp] = 1.0
    ratio = np.asarray(Image.fromarray((ratio * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255
    out = A * (1 - STRENGTH * (1 - ratio))[..., None]
    (ROOT / "tex").mkdir(exist_ok=True); dst = ROOT / "tex" / f"{rid}.jpg"
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst, quality=84, optimize=True, progressive=True)
    print(rid, dst.name, w, h, dst.stat().st_size // 1024, "KB")

if __name__ == "__main__":
    for rid in sys.argv[1:] or IDS: compose(rid)
