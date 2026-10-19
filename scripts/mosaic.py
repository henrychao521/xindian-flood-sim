"""拼接內政部 20 m DEM（臺北市分幅 XYZ 文字檔）成單一網格 → work/taipei_dem20.npz"""
import zipfile, io, numpy as np, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
z = zipfile.ZipFile(ROOT / "data/raw/taipei_20mDEM_2025.zip")
pts = []
for n in z.namelist():
    if n.endswith(".grd") and "__MACOSX" not in n:
        pts.append(np.loadtxt(io.BytesIO(z.read(n))))
A = np.vstack(pts)
x0, y0 = A[:, 0].min(), A[:, 1].min()
nx, ny = int((A[:, 0].max() - x0) // 20) + 1, int((A[:, 1].max() - y0) // 20) + 1
G = np.full((ny, nx), np.nan, np.float32)
G[((A[:, 1] - y0) // 20).astype(int), ((A[:, 0] - x0) // 20).astype(int)] = A[:, 2]
(ROOT / "work").mkdir(exist_ok=True)
np.savez_compressed(ROOT / "work/taipei_dem20.npz", G=G, x0=x0, y0=y0)
print("grid", G.shape, "origin", x0, y0, "valid", np.isfinite(G).sum())
