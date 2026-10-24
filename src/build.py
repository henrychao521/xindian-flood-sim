"""組合單一 HTML 頁面：src/ 下的模板與程式 ＋ data/processed/ 的資料 → 輸出檔。
用法：
  python3 src/build.py [輸出路徑]                     新店溪頁面（預設輸出 index.html）
  python3 src/build.py --region <id> [輸出路徑]       其他河段（預設輸出 <id>/index.html）
  加上 --local-three 改用本機 vendor/ 的 three.js（離線測試用）
"""
import sys, json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
S, D = ROOT / "src", ROOT / "data" / "processed"
r = lambda p: p.read_text(encoding="utf-8")
region = sys.argv[sys.argv.index("--region") + 1] if "--region" in sys.argv else None
args = [a for a in sys.argv[1:] if not a.startswith("--") and a != region]

if region:
    RD = D / region
    cfg = json.loads(r(ROOT / f"regions/{region}.json"))
    summ = json.loads(r(RD / "summary.json"))
    src = r(S / "region.src.html")
    data = "const DEM_DATA=" + r(RD / "dem.json") + ";\nconst BLD_DATA=" + r(RD / "bld.json") + ";\nconst OSM_DATA=" + r(RD / "osm.json") + ";\nconst INUND_DATA=" + r(RD / "inund.json") + ";\n"
    regiondata = r(RD / "region_data.js")
    xa, ya, xb, yb = cfg["bbox"]
    gates_txt = "、".join(f"{g[0]}（底檻 EL. {g[2]:.1f} m）" for g in summ["gates"])
    lede = (f"{cfg['river']}沿岸（{cfg['districts']}）的洪水與疏散門失效淹水模擬。調整洪水規模、潮位、雨量與各疏散門狀態，"
            "看河道水位變化、哪座水門會先被河水漫過，以及堤內哪些地方、多少建物和道路會淹水。教學用的簡化模型。")
    terrain_hint = (f"地形取自內政部 2025 年 20 m DEM（臺北市分幅，TWD97 E {xa}–{xb}、N {ya}–{yb}，約 {(xb - xa) / 1000:.1f} × {(yb - ya) / 1000:.1f} km）。"
                    "堤線沿河道邊緣自動建立，必要處依地形手動補描；堤頂高程以 DEM 與設定值取大。"
                    + ("疏散門位置取自臺北市水利處疏散門清單與 OpenStreetMap。" if not summ.get("auto_gates") else "OpenStreetMap 與臺北市水利處疏散門清單都沒有本區的疏散門，頁面上的「水門」是依道路穿越堤線處設定的假想缺口，用來比較堤防不同位置失效的後果，不是實際存在的水門。")
                    + 
                    f"堤內面積約 {summ['inland_km2']} km²；範圍邊界視為封閉。")
    notes = f'''      <section class="panel notes" id="sec-notes" data-tab="notes">
        <h2>模型假設與限制</h2>
        <ul>
          <li><b>河道水位是示意，不是水理演算。</b>各河段節點的常水位取自 DEM 的水面高程，計畫洪水位取堤頂下 1.5 m（出水高），洪水規模以「計畫洪峰流量的百分比」在兩者之間內插（水深約與流量的 0.6 次方成正比），再加上潮位影響。計畫洪峰流量取 {cfg['qDesign']:,} m³/s，只用來換算主流流速動畫。</li>
          <li><b>疏散門：</b>{gates_txt}。{"其中 " + str(summ["auto_gates"]) + " 座是假想缺口：OSM 與臺北市水利處疏散門清單都沒有本區的疏散門，位置取道路穿越堤線處，名稱取自道路名；「未關」情境在這裡代表堤防在該處失效。" if summ.get("auto_gates") else "位置以臺北市水利處疏散門清單（data.taipei）為準，OSM 補足。"}底檻高程取門內外地面（20 m DEM）較高者，是推估值；門寬一律假設 {cfg.get('gateWidth', 8)} m。其他疏散門（{'、'.join(summ['other_gates']) or '無'}）只標示位置。</li>
          <li><b>堤防：</b>20 m 網格通常看不到窄的防洪牆，所以堤線沿河道邊緣建立，堤頂高程設為 EL. {cfg.get('crest', 10)} m 或 DEM 較高值。高灘地與防洪牆的實際位置可能與模型差 20–40 m。</li>
          <li><b>水門流量係數依文獻修正。</b>Q = C·B·H<sup>1.5</sup>，C 取 1.45–1.70（C<sub>d</sub> 0.85–1.0 × 1.705，Henderson 1966；Bos 1985），預設 1.55。</li>
          <li><b>排水系統依臺北市設計標準建模。</b>雨水下水道收水上限 78.8 mm/hr；抽水站 45–60 mm/hr；外水位低於 EL. 2.5 m 時重力閘門可自然排水。雨型是以 T+3 h 為中心、長度等於「降雨延時」的定強度降雨。和臺北市水利處「降雨積水模擬圖」（112 年版，1 小時 78.8／100／130 mm）對照：「短延時暴雨 100 mm/h」情境的積水面積在平地河段與官方同一數量級、山區河段偏高，積水位置的重疊多在兩成以下——本模型是 20 m 網格、集總式下水道、沒有排水溪流，官方是 5 m 地形加實際管網，街道尺度的積水點請以疊圖（地圖下方可開）為準。範圍內抽水站：{'、'.join(summ['pumps']) or '無'}（臺北市資料大平臺），依最近抽水站劃分集水區。</li>
          <li><b>二維水流：</b>局部慣性淺水波法（Bates et al., 2010），建物以孔隙率法處理（臺北市 3D 近似建物模型，範圍內 {summ['buildings']:,} 棟）。</li>
          <li><b>用途限於教學與情境比較。</b>實際的淹水潛勢與疏散資訊，請以經濟部水利署、臺北市政府工務局水利工程處公布的資料為準。</li>
        </ul>
      </section>'''
    ph = {"@@OVERVIEW@@": "../overview/", "@@HERO@@": f"../overview/img/{region}.jpg", "@@TITLE@@": cfg["title"], "@@LEDE@@": lede, "@@TERRAINHINT@@": terrain_hint, "@@NOTES@@": notes}
    out = pathlib.Path(args[0]) if args else ROOT / region / "index.html"
else:
    src = r(S / "page.src.html")
    data = "const DEM_DATA=" + r(D / "demW.json") + ";\nconst BLD_DATA=" + r(D / "bldW.json") + ";\nconst OSM_DATA=" + r(D / "osm2.json") + ";\nconst INUND_DATA=" + r(D / "xindian/inund.json") + ";\n"
    regiondata = r(S / "xindian_data.js")
    ph = {"@@OVERVIEW@@": "overview/", "@@HERO@@": "overview/img/xindian.jpg"}
    out = pathlib.Path(args[0]) if args else ROOT / "index.html"

# Colab GPU 降雨情境集合（scripts/flow_torch.py sweep）：有結果才嵌入
sd = D / (region or "xindian")
sweep = "null"
if (sd / "sweep.json").exists():
    sw = json.loads(r(sd / "sweep.json"))
    if (sd / "sweep_maps.json").exists():
        mp = json.loads(r(sd / "sweep_maps.json")); mp.pop("h4h_cm", None)
        mp["hmax_cm"] = {k: v for k, v in mp["hmax_cm"].items() if k in ("78.8", "100", "130", "150", "200")}
        sw["maps"] = mp
    sw["official"] = {}
    for case in ("100", "130"):
        cf = sd / f"compare_{case}.json"
        if cf.exists(): sw["official"][case] = json.loads(r(cf))["ge15cm"]["official_ha"]
    sweep = json.dumps(sw, ensure_ascii=False, separators=(",", ":"))
data += "const SWEEP_DATA=" + sweep + ";\n"
river = "null"  # 洩洪／水門失效情境集合（scripts/flow_torch.py river）
if (sd / "river.json").exists():
    rv = json.loads(r(sd / "river.json"))
    if (sd / "river_maps.json").exists(): rv["maps"] = json.loads(r(sd / "river_maps.json"))
    river = json.dumps(rv, ensure_ascii=False, separators=(",", ":"))
data += "const RIVER_DATA=" + river + ";\n"
cl = sd / "closure.json"  # 搶險封堵時間與兩座水門同時失效（scripts/flow_torch.py closure）
data += "const CLOSURE_DATA=" + (r(cl) if cl.exists() else "null") + ";\n"
# 地形色階、顯示高程、Blender 底圖（scripts/look.py、display_dem.py、blender_terrain.py＋compose_texture.py）
rid_ = region or "xindian"; lk = json.loads(r(sd / "look.json")) if (sd / "look.json").exists() else None
if lk and (ROOT / "tex" / f"{rid_}.jpg").exists():
    lk["tex"] = f"tex/{rid_}.jpg" if (not region or "--local-three" in sys.argv) else f"../tex/{rid_}.jpg"  # 測試頁在 work/checks（有 tex 連結）
data += "const LOOK=" + (json.dumps(lk, ensure_ascii=False) if lk else "null") + ";\n"
cityf = D / "city" / "nari_city.json"  # 全市合併網格（scripts/merge_city.py）：本河段在封閉／打開河段邊界時的結果
nc = None
if cityf.exists():
    cj = json.loads(r(cityf)); rr = region or "xindian"
    nc = {"closed": cj["runs"]["closed"]["regions"][rr], "open": cj["runs"]["open"]["regions"][rr], "extra_ha": cj["extra_ha_by_region"][rr], "seconds": cj["runs"]["open"]["seconds"], "device": cj["device"]}
data += "const NARI_CITY=" + (json.dumps(nc, ensure_ascii=False) if nc else "null") + ";\n"
data += "const NARI_DATA=" + (r(sd / "nari.json") if (sd / "nari.json").exists() else "null") + ";\n"
data += "const STREAM_DATA=" + (r(sd / "streams.json") if (sd / "streams.json").exists() else "null") + ";\n"
data += "const DISP_DATA=" + (r(sd / "disp.json") if (sd / "disp.json").exists() else "null") + ";\n"
for a, b in [("//@@DEMDATA@@", data), ("//@@SWEEP@@", r(S / "sweep.js")), ("//@@NARI@@", r(S / "nari.js")), ("//@@LIVE@@", r(S / "live.js")), ("//@@REGIONDATA@@", regiondata), ("//@@ENGINE@@", r(S / "engine.js")), ("//@@TERRAIN@@", r(S / "terrain.js")), ("//@@FLOW@@", r(S / "flow.js") + "\n" + r(S / "osm.js"))]:
    assert a in src, a
    src = src.replace(a, b)
for a, b in ph.items():
    assert a in src, a
    src = src.replace(a, b)
if "--local-three" in sys.argv:  # 離線測試用
    src = src.replace("https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js", "vendor/three.min.js").replace("https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js", "vendor/OrbitControls.js")
# 補上完整 HTML 文件骨架（claude.ai Artifact 版本由平台自動包裝）
i = src.index("<style>")
head = src[:i].replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
rest = src[i:]
j = rest.index("</style>") + len("</style>")
desc = ph.get("@@TITLE@@", "新店溪洩洪與疏散門失效淹水模擬") + "：實測地形、3D 建物、二維水流與排水系統。教學用簡化模型。" if region else "新店溪洩洪與疏散門失效淹水模擬：實測地形、3D 建物、二維水流與排水系統。教學用簡化模型。"
doc = ('<!doctype html>\n<html lang="zh-Hant-TW">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
       f'<meta name="description" content="{desc}">\n'
       + head + rest[:j].replace("<style>\n", "<style>\nhtml, body { margin: 0; } [hidden] { display: none !important; } img { max-width: 100%; }\n", 1)
       + "\n</head>\n<body>\n" + rest[j:] + "\n</body>\n</html>\n")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(doc, encoding="utf-8")
print("wrote", out, len(doc))
