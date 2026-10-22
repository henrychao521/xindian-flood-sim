# 臺北市河川淹水模擬（由新店溪出發）

臺北市各河段洩洪、潮位、降雨與疏散門失效的互動淹水模擬。從新店溪（萬華、中正、大安）開始，逐段延伸到淡水河、基隆河與景美溪。

- 全市總覽：https://henrychao521.github.io/xindian-flood-sim/overview/
- 新店溪（起點）：https://henrychao521.github.io/xindian-flood-sim/

| 河段 | 頁面 | 涵蓋 |
|---|---|---|
| 新店溪 | [`/`](https://henrychao521.github.io/xindian-flood-sim/) | 萬華、中正、大安 |
| 淡水河東岸 | [`/tamsui/`](https://henrychao521.github.io/xindian-flood-sim/tamsui/) | 萬華北、大同、中山西 |
| 基隆河下游 | [`/shilin/`](https://henrychao521.github.io/xindian-flood-sim/shilin/) | 士林、社子、洲美 |
| 基隆河中游 | [`/zhongshan/`](https://henrychao521.github.io/xindian-flood-sim/zhongshan/) | 中山、松山、大直、內湖西 |
| 基隆河上游 | [`/neihu/`](https://henrychao521.github.io/xindian-flood-sim/neihu/) | 內湖、南港 |
| 景美溪 | [`/jingmei/`](https://henrychao521.github.io/xindian-flood-sim/jingmei/) | 景美、木柵 |
| 基隆河出海段 | [`/beitou/`](https://henrychao521.github.io/xindian-flood-sim/beitou/) | 北投、關渡 |

各階段的做法、修正與情境結果記在 [`docs/STAGES.md`](docs/STAGES.md)；在本機接手的環境與指令見 [`docs/LOCAL.md`](docs/LOCAL.md)。

## 重建

```sh
python3 scripts/mosaic.py                 # 全市 20 m DEM（需 data/raw/taipei_20mDEM_2025.zip）
python3 scripts/build_region.py <id>      # 依 regions/<id>.json 產生 data/processed/<id>/（會從 OSM API 下載資料）
python3 src/make_region_template.py       # 新店溪模板 → 通用河段模板
python3 src/build.py                      # 新店溪 → index.html
python3 src/build.py --region <id>        # 河段 → <id>/index.html
python3 scripts/overview_map.py           # 全市總覽 → overview/
scripts/run_checks.sh [id …]              # 以上全部＋tests/region_check.js 情境檢查，結果寫入 data/processed/<id>/results.json
SKIP_DATA=1 scripts/run_checks.sh [id …]  # 只改 src/ 時：跳過 build_region.py（不需 OSM／DEM），重建頁面＋檢查＋總覽
```

### 3D 地形底圖與封面（Blender）

```sh
python3 scripts/look.py                   # 各河段色階與等高線範圍 → data/processed/<id>/look.json
python3 scripts/display_dem.py            # 3D 顯示高程（原始 DEM、市界外補值、堤防加寬）→ disp.json（需 work/taipei_dem20.npz）
blender -b --factory-startup --python scripts/blender_terrain.py -- <id> tex    # 地形＋建物落影兩張 → work/blender/
python3 scripts/compose_texture.py <id>   # 合成 → tex/<id>.jpg（3D 地形與等高線圖的底圖）
blender -b --factory-startup --python scripts/blender_terrain.py -- <id> hero   # 斜俯視封面 → work/blender/<id>_hero.png（轉成 overview/img/<id>.jpg）
```

沒有 Blender 時頁面仍可用：沒有 `tex/<id>.jpg` 就用頂點色與簡易暈渲。

### 降雨情境集合（Colab GPU）

```sh
NODE_PATH=$(npm root -g) node scripts/dump_flow_input.js work/checks/t_<id>.html <id>   # 擷取頁面送進二維水流的輸入 → work/flow_in/<id>.json（repo 內有壓縮版）
python3 scripts/flow_torch.py validate <id>              # PyTorch 移植版 vs 瀏覽器（短延時暴雨 100 mm/h）
python3 scripts/flow_torch.py sweep <id> --device cuda   # 128 個降雨情境（強度×延時×排水設定）→ work/sweep/<id>_sweep.json、<id>_maps.json
python3 scripts/flow_torch.py validate-river <id>        # 水門入流／越堤 vs 瀏覽器（關鍵水門未關情境）
python3 scripts/flow_torch.py river <id> --device cuda   # 洪水規模×潮位×水門失效組合 → <id>_river.json、<id>_river_maps.json
bash colab/sweep_perregion.sh NAME "<id> <id>" work/sweep/X [sweep|river]   # 從 Studio 用 Colab CLI 跑，一個河段一次 exec、做完立刻下載
python3 scripts/sweep_table.py                           # 結果表（docs/STAGES.md 階段 9、10）
```

在 Colab 上跑：`colab/sweep_gpu.py`（一個河段 8–30 分鐘，L4）。從 Studio 以 Colab CLI 執行用 `colab/sweep_perregion.sh`：一個河段一次 `colab exec`、做完立刻下載（`colab exec` 長時間會斷線、沒有連線的 VM 會被收回，見 `docs/STAGES.md` 階段 9）。結果放到 `data/processed/<id>/sweep.json` 與 `sweep_maps.json` 後重建頁面，頁面就會多出「降雨強度與淹水面積」面板和「淹水門檻／淹水機率／最大水深包絡」圖層；`river.json`、`river_maps.json` 則加上「洪水規模與淹水面積：水門失效」圖與「水門失效包絡」圖層。

## 功能

- 河道水位縱斷面與各河段疏散門開關情境（新店溪：華江、華中、馬場町、古亭、景福）
- 內政部 20 m 實測 DEM 地形、等高線與 3D 建物（臺北市 3D 近似建物模型）；地形底圖（暈渲、環境遮蔽、建物落影）與總覽封面由 Blender 依同一份資料算出
- 二維局部慣性淺水波水流（Bates et al., 2010），建物以孔隙率法處理
- 雨水下水道（78.8 mm/hr）與抽水站（45–60 mm/hr）排水模型
- OpenStreetMap 道路、橋樑、公共設施淹水狀態
- 疏散門位置以臺北市水利處疏散門清單（data.taipei）為準，OSM 補足
- GPU 情境集合（`scripts/flow_torch.py`，二維水流的 PyTorch 移植，在 Colab 批次計算）：128 個降雨強度×延時×排水情境，以及洪水規模×潮位×水門失效組合；每頁有強度–面積與洪水規模–面積曲線、淹水門檻圖（多大的雨會淹到這裡）、淹水機率、最大水深包絡與各水門失效包絡圖層
- 可疊上臺北市水利處「降雨積水模擬圖」（112 年版，78.8／100／130 mm/h）對照；`scripts/compare_inundation.py` 計算面積、命中率與 IoU
- 颱風預報換算（合理化公式估算新店溪洪峰，只有新店溪頁面）
- 疏散門缺少 OSM 資料的河段，依道路穿越堤線處推定位置（頁面上註明）

## 在 Colab 重跑（CPU 前處理）

`colab/run_all.ipynb`（[在 Colab 開啟](https://colab.research.google.com/github/henrychao521/xindian-flood-sim/blob/main/colab/run_all.ipynb)）會掛載 Drive 當快取、安裝 Playwright 與 three.js、從 sheethub/tpe3d 取建物、拼接 DEM，然後跑 `scripts/run_checks.sh` 重建所有河段的資料、頁面、情境檢查與水利處積水模擬圖對照，最後推到分支 `colab-results`。需要在 Colab Secrets 放 `GH_TOKEN`。不需要 GPU，全程約 2–3 小時（OSM 下載佔多數，第二次有快取）。

repo 內已含重跑所需的原始資料：內政部 20 m DEM（zip）、抽水站、疏散門、水利處降雨積水模擬圖（KML）。只有 OSM 分塊（約 1.3 GB，由 OSM API 重新下載）與 sheethub/tpe3d 建物（72 MB，由其 repo 取得）不放在這裡。

## 資料來源與授權

- 地形：內政部國土測繪中心 2025 年 20 m DEM，政府資料開放授權條款第 1 版
- 建物：臺北市自動化 3D 近似建物模型，經 [sheethub/tpe3d](https://github.com/sheethub/tpe3d) 轉換
- 抽水站：臺北市水利處抽水站（data.gov.tw 資料集 143901）
- 疏散門：臺北市水利處「臺北市疏散門資訊」（data.taipei，政府資料開放授權條款第 1 版）
- 降雨積水模擬圖：臺北市政府工務局水利工程處「臺北市降雨積水模擬圖（112 年更新版）」（data.gov.tw 資料集 121550，政府資料開放授權條款第 1 版）
- 道路、橋樑、設施、疏散門：© OpenStreetMap contributors，ODbL
- 3D 繪圖：three.js（MIT）

## 免責聲明

教學與情境比較用的簡化模擬，不是官方淹水預報或疏散指示。實際資訊請以中央氣象署、經濟部水利署與臺北市政府公告為準。
