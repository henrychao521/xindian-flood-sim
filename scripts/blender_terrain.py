"""Blender：由 DEM 與建物資料重建各河段的 3D 場景，算出頁面用的地形底圖與總覽縮圖。
用法（背景執行，不需開 Blender 視窗）：
  blender -b --factory-startup --python scripts/blender_terrain.py -- <id> tex   [樣本數]   → work/blender/<id>_tex.png（地形）、<id>_shadow.png（加建物）
  之後 python3 scripts/compose_texture.py <id> 合成 → tex/<id>.jpg
  blender -b --factory-startup --python scripts/blender_terrain.py -- <id> hero  [樣本數]   → work/blender/<id>_hero.png
tex：正上方正交投影，範圍＝頁面 3D 地形網格（格中心到格中心），北朝上；地形色階＋太陽暈渲＋天空環境遮蔽。
     算兩張：只有地形、地形＋建物（建物不入鏡、只投影），合成時取兩者比值當建物落影，建物底下不算（避免黑塊）。
高程用 data/processed/<id>/disp.json（原始 DEM，市界外平滑補值），色彩用 look.json 的色階；市界外淡化成紙色。
hero：斜俯視全景（建物白模＋常水位河面），給總覽卡片與 README 用。
座標與頁面 three.js 相同：1 單位＝1 格（20 m），高度＝dispZ(z) × 12 / 20（垂直誇張 12 倍、15 m 以上壓縮成 1/10），建物每公尺 0.25 單位。
"""
import bpy, bmesh, sys, json, math, base64, re, pathlib
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RID, MODE = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else (64 if MODE == "tex" else 96)
OUT = ROOT / "work/blender"; OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / "scripts"))
from look import load_dem, paths, look  # noqa: E402

EX, BLD_SCALE, PX = (12.0, 0.25, 8) if MODE == "tex" else (5.0, 0.15, 8)   # 垂直誇張、建物高度比例、貼圖每格像素（封面圖誇張少一點，堤防才不會像一排高牆）
d, Z0, M = load_dem(RID); ny, nx = Z0.shape; LK = look(RID)
DP = json.loads((ROOT / "data/processed" / RID / "disp.json").read_text())
Z = (np.frombuffer(base64.b64decode(DP["z"]), "<i2").astype(np.float32) / 10).reshape(ny, nx)
FL = np.frombuffer(base64.b64decode(DP["nodata"]), "u1").reshape(ny, nx); NOD = (FL & 1).astype(bool); WALL = (FL & 2).astype(bool) | (M == 2)
disp = lambda z: np.where(z > 15, 15 + (z - 15) * 0.1, z)
H = disp(Z) * EX / d["d"]

def hex2lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]

def ramp(stops, v):
    xs = [s[0] for s in stops]; cs = [np.array(hex2lin(s[1])) for s in stops]
    v = np.clip(v, xs[0], xs[-1]); out = np.zeros(v.shape + (3,), np.float32)
    for a in range(len(xs) - 1):
        sel = (v >= xs[a]) & (v <= xs[a + 1]); f = ((v - xs[a]) / max(1e-9, xs[a + 1] - xs[a]))[..., None]
        out[sel] = (cs[a] * (1 - f) + cs[a + 1] * f)[sel]
    return out

# ---- 每格顏色（線性色彩空間）----
t = (Z - LK["zlo"]) / (LK["zhi"] - LK["zlo"])
col = np.where((Z <= LK["zhi"])[..., None], ramp(LK["low"], t), ramp(LK["hill"], Z - LK["zhi"]))
grey = col.mean(axis=2, keepdims=True)
col[M == 0] = (col * 0.55 + grey * 0.25 + np.array(hex2lin("#8fa9b4")) * 0.2)[M == 0]        # 堤外：偏灰藍（多在水面下）
col[M == 3] = (col * 0.35 + grey * 0.35 + np.array(hex2lin("#d9d6cf")) * 0.3)[M == 3]        # 對岸、不在模擬範圍：淡化
col[WALL] = np.array(hex2lin("#5d6166"))                                                       # 防洪牆（含畫面加寬的一格）
col[NOD] = np.array(hex2lin("#e4e0d8"))                                                          # 臺北市界外（無資料）
if MODE == "hero":
    col[M == 3] = (col * 0.6 + np.array(hex2lin("#d9d6cf")) * 0.4)[M == 3]
    col[NOD] = np.array(hex2lin("#ece8e1"))

# ---- 場景 ----
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

def grid_mesh(name, heights, colors):
    xs = np.arange(nx) - (nx - 1) / 2; ys = np.arange(ny) - (ny - 1) / 2
    X, Y = np.meshgrid(xs, ys)
    verts = np.stack([X.ravel(), Y.ravel(), heights.ravel()], 1)
    ii, jj = np.meshgrid(np.arange(nx - 1), np.arange(ny - 1)); a = (jj * nx + ii).ravel()
    faces = np.stack([a, a + 1, a + nx + 1, a + nx], 1)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts)); me.vertices.foreach_set("co", verts.astype(np.float32).ravel())
    me.loops.add(faces.size); me.loops.foreach_set("vertex_index", faces.astype(np.int32).ravel())
    me.polygons.add(len(faces)); me.polygons.foreach_set("loop_start", (np.arange(len(faces)) * 4).astype(np.int32)); me.polygons.foreach_set("loop_total", np.full(len(faces), 4, np.int32))
    me.update(); me.validate()
    if colors is not None:
        at = me.color_attributes.new("col", "FLOAT_COLOR", "POINT")
        rgba = np.concatenate([colors.reshape(-1, 3), np.ones((nx * ny, 1), np.float32)], 1)
        at.data.foreach_set("color", rgba.astype(np.float32).ravel())
    me.polygons.foreach_set("use_smooth", np.ones(len(faces), bool))
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob); return ob

def vc_material(name, rough=1.0):
    mt = bpy.data.materials.new(name); mt.use_nodes = True; nt = mt.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    at = nt.nodes.new("ShaderNodeAttribute"); at.attribute_name = "col"
    nt.links.new(at.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    for k in ("Specular IOR Level", "Specular"):
        if k in bsdf.inputs: bsdf.inputs[k].default_value = 0.15
    return mt

def flat_material(name, hexcol, rough=0.9, alpha=1.0, transmission=0.0):
    mt = bpy.data.materials.new(name); mt.use_nodes = True
    bsdf = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*hex2lin(hexcol), 1); bsdf.inputs["Roughness"].default_value = rough
    if alpha < 1: bsdf.inputs["Alpha"].default_value = alpha
    return mt

terrain = grid_mesh("terrain", H, col); terrain.data.materials.append(vc_material("terrain"))
if MODE == "hero":  # 實體模型風格的底座：沿四邊往下拉到統一的底面
    bm = bmesh.new(); bm.from_mesh(terrain.data); bm.verts.ensure_lookup_table()
    edges = [e for e in bm.edges if e.is_boundary]
    floor = float(H.min()) - 3.0
    ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
    for v in [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]: v.co.z = floor
    side_faces = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMFace)]
    terrain.data.materials.append(flat_material("base", "#3e4954", 0.7))
    for f in side_faces: f.material_index = 1; f.smooth = False
    bm.to_mesh(terrain.data); bm.free()

# ---- 建物（擠出；tex 模式只投影、不入鏡）----
B = json.loads(paths(RID)[1].read_text())["b"]
verts, faces = [], []
for a in B:
    pts = [(a[i], a[i + 1]) for i in range(1, len(a) - 1, 2)]
    if len(pts) > 2 and pts[0] == pts[-1]: pts = pts[:-1]
    if len(pts) < 3: continue
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    ci = min(nx - 1, max(0, int(cx // d["d"]))); cj = min(ny - 1, max(0, int(cy // d["d"])))
    base = float(H[cj, ci]) - 0.05; top = float(H[cj, ci]) + a[0] / 10 * BLD_SCALE
    n0 = len(verts)
    for (x, y) in pts: verts.append((x / d["d"] - 0.5 - (nx - 1) / 2, y / d["d"] - 0.5 - (ny - 1) / 2, base))
    for (x, y) in pts: verts.append((x / d["d"] - 0.5 - (nx - 1) / 2, y / d["d"] - 0.5 - (ny - 1) / 2, top))
    n = len(pts)
    for i in range(n): faces.append((n0 + i, n0 + (i + 1) % n, n0 + n + (i + 1) % n, n0 + n + i))
    faces.append(tuple(range(n0 + n, n0 + 2 * n)))
bm_me = bpy.data.meshes.new("buildings"); bm_me.from_pydata(verts, [], faces); bm_me.validate(); bm_me.update()
bld = bpy.data.objects.new("buildings", bm_me); sc.collection.objects.link(bld)
bld.data.materials.append(flat_material("bld", "#f1eee8", 0.8))
print("buildings", len(B), "faces", len(faces))

# ---- 光源與環境 ----
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (*hex2lin("#dbe6ee"), 1); bg.inputs["Strength"].default_value = 0.55 if MODE == "tex" else 0.8
sun_d = bpy.data.lights.new("sun", "SUN"); sun_d.energy = 3.0; sun_d.angle = math.radians(6)
sun = bpy.data.objects.new("sun", sun_d); sc.collection.objects.link(sun)
# 光從西北方（地圖暈渲慣例）、仰角 50°（建物陰影不要太長）：把太陽放在西北上空、對準原點
el = math.radians(50 if MODE == "tex" else 36); sun.location = (-math.cos(el) * 0.7071 * 500, math.cos(el) * 0.7071 * 500, math.sin(el) * 500)
origin = bpy.data.objects.new("origin", None); sc.collection.objects.link(origin)
c = sun.constraints.new("TRACK_TO"); c.target = origin; c.track_axis = "TRACK_NEGATIVE_Z"; c.up_axis = "UP_Y"

# ---- 相機 ----
cam_d = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_d); sc.collection.objects.link(cam); sc.camera = cam
r = sc.render
if MODE == "tex":
    bld.visible_camera = False                   # 建物不入鏡，但仍投下陰影與遮蔽
    cam_d.type = "ORTHO"; cam_d.ortho_scale = max(nx - 1, ny - 1)
    cam.location = (0, 0, 400); cam.rotation_euler = (0, 0, 0)
    r.resolution_x, r.resolution_y = (nx - 1) * PX, (ny - 1) * PX
    cam_d.sensor_fit = "HORIZONTAL" if nx >= ny else "VERTICAL"
    cam_d.clip_end = 2000
else:
    # 常水位河面：堤外格中低於最近河道節點常水位的格（新店溪沒有節點常水位，取 1.2 m）
    s = paths(RID)[2].read_text(encoding="utf-8")
    nodes = re.findall(r'"cell": \[(\d+), (\d+)\][^}]*?"zn": ([0-9.\-]+)', s)
    if nodes:
        ci = np.array([[int(a), int(b)] for a, b, _ in nodes]); zn = np.array([float(c) for *_, c in nodes])
        jj, ii = np.mgrid[0:ny, 0:nx]
        dist = (ii[..., None] - ci[:, 0]) ** 2 + (jj[..., None] - ci[:, 1]) ** 2
        ZN = zn[dist.argmin(axis=2)] + 0.3
    else:
        ZN = np.full_like(Z, 1.2)
    wet = (M == 0) & (Z < ZN)
    WH = np.where(wet, disp(ZN) * EX / d["d"], H - 0.6)
    water = grid_mesh("water", WH, None)
    wm = bpy.data.materials.new("water"); wm.use_nodes = True; bs = next(n for n in wm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bs.inputs["Base Color"].default_value = (*hex2lin("#2f6f96"), 1); bs.inputs["Roughness"].default_value = 0.12
    water.data.materials.append(wm)
    cam_d.type = "PERSP"; cam_d.lens = 30
    # 對準堤內區域的中心，從西南方、仰角約 36° 拍
    span = max(nx, ny); jj, ii = np.nonzero(M == 1)
    tx, ty = float(ii.mean() - (nx - 1) / 2), float(jj.mean() - (ny - 1) / 2)
    dist, az, elv = 1.1 * span, math.radians(215), math.radians(36)
    cam.location = (tx + dist * math.cos(elv) * math.sin(az), ty + dist * math.cos(elv) * math.cos(az), dist * math.sin(elv))
    tgt = bpy.data.objects.new("tgt", None); sc.collection.objects.link(tgt); tgt.location = (tx, ty, float(np.median(H[M == 1])))
    con = cam.constraints.new("TRACK_TO"); con.target = tgt; con.track_axis = "TRACK_NEGATIVE_Z"; con.up_axis = "UP_Y"
    cam_d.clip_end = 5000
    r.resolution_x, r.resolution_y = 1600, 900
    # 天空：上淺下白的漸層，畫面乾淨
    nt = world.node_tree; tc = nt.nodes.new("ShaderNodeTexCoord"); grad = nt.nodes.new("ShaderNodeTexGradient"); cr = nt.nodes.new("ShaderNodeValToRGB")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["Window"], sep.inputs[0]); nt.links.new(sep.outputs["Y"], cr.inputs["Fac"])
    cr.color_ramp.elements[0].color = (*hex2lin("#f3f1ec"), 1); cr.color_ramp.elements[1].color = (*hex2lin("#c9d8e3"), 1)
    lp = nt.nodes.new("ShaderNodeLightPath"); mix = nt.nodes.new("ShaderNodeMixShader"); bg2 = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(cr.outputs["Color"], bg2.inputs["Color"]); out = next(n for n in nt.nodes if n.type == "OUTPUT_WORLD")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"]); nt.links.new(bg.outputs[0], mix.inputs[1]); nt.links.new(bg2.outputs[0], mix.inputs[2]); nt.links.new(mix.outputs[0], out.inputs["Surface"])

# ---- 算圖設定 ----
r.engine = "CYCLES"
cy = sc.cycles; cy.samples = SAMPLES; cy.use_denoising = True
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    cy.device = "GPU"
except Exception as e:
    print("GPU unavailable, using CPU:", e)
sc.view_settings.view_transform = "Standard"     # 保留色階原色（AgX／Filmic 會把顏色洗淡）
r.image_settings.file_format = "PNG"; r.image_settings.color_mode = "RGB"
if MODE == "tex":
    bld.hide_render = True
    r.filepath = str(OUT / f"{RID}_tex.png"); bpy.ops.render.render(write_still=True); print("wrote", r.filepath)
    bld.hide_render = False
    r.filepath = str(OUT / f"{RID}_shadow.png"); bpy.ops.render.render(write_still=True); print("wrote", r.filepath)
else:
    r.filepath = str(OUT / f"{RID}_{MODE}.png"); bpy.ops.render.render(write_still=True); print("wrote", r.filepath)
