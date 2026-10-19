# 開發階段紀錄

## 階段 0：新店溪臺北市側（萬華、中正、大安）— 完成

- 頁面：`index.html`（由 `python3 src/build.py` 產生）
- 範圍：TWD97 E 299000–304600、N 2766400–2770600（20 m 網格，280 × 210）
- 五座疏散門：華江、華中、馬場町（OSM 位置）、古亭（同安街底推定）、景福（概略）
- 示範影片與 18 個情境統計：`docs/videos/`

## 資料夾結構

| 路徑 | 內容 |
|---|---|
| `src/` | 頁面模板、計算引擎（engine.js）、地形與 3D（terrain.js）、二維水流（flow.js）、OSM 圖層（osm.js）、組建腳本 |
| `scripts/` | 前處理腳本：DEM 拼接與堤防描繪、建物切割、OSM 解析、影片拍攝 |
| `data/raw/` | 原始資料：內政部 20 m DEM（臺北市分幅）、臺北市抽水站清單 |
| `data/processed/` | 前處理結果：地形與遮罩、建物、OSM 道路設施 |
| `docs/` | 階段紀錄、示範影片 |

## 未納入 repo 的資料

- 使用者提供的設計文件 PDF（含個人對話紀錄，不放公開 repo）
- OSM 原始下載檔（約 256 MB，可用 OSM API 重新下載，見 `scripts/parse.py`）
- sheethub/tpe3d 原始 GeoJSON（72 MB，可從 https://github.com/sheethub/tpe3d 取得）

## 階段 1：通用河段流程＋淡水河東岸 — 完成

- 共用程式拆成核心（`src/engine.js`、`terrain.js`、`flow.js`、`osm.js`）與各河段資料（`src/xindian_data.js`、`data/processed/<id>/region_data.js`）
- `scripts/mosaic.py`：拼接全市 20 m DEM（`work/`，不進 repo，可重建）
- `scripts/build_region.py <id>`：依 `regions/<id>.json` 裁切地形、自動建立堤線（河道邊緣＋手動補描）、OSM 疏散門→堤線、抽水站、建物、OSM 道路設施、河段節點水位
- `src/make_region_template.py`：由新店溪模板產生通用河段模板 `src/region.src.html`
- `python3 src/build.py --region <id>` → `<id>/index.html`
- 回歸測試 `tests/regress.js`：新店溪頁面重構前後計算結果一致；`tests/region_check.js`：河段頁面檢查
- 淡水河東岸（`tamsui/`）：萬華北、大同、中山西；堤內 11.9 km²；疏散門 貴陽、大稻埕、國順、敦煌、林安泰
- 道路中斷統計改為只計堤內道路（新店溪頁面數字因此略降）
