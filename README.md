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

各階段的做法、修正與情境結果記在 [`docs/STAGES.md`](docs/STAGES.md)。

## 重建

```sh
python3 scripts/mosaic.py                 # 全市 20 m DEM（需 data/raw/taipei_20mDEM_2025.zip）
python3 scripts/build_region.py <id>      # 依 regions/<id>.json 產生 data/processed/<id>/（會從 OSM API 下載資料）
python3 src/make_region_template.py       # 新店溪模板 → 通用河段模板
python3 src/build.py                      # 新店溪 → index.html
python3 src/build.py --region <id>        # 河段 → <id>/index.html
python3 scripts/overview_map.py           # 全市總覽 → overview/
scripts/run_checks.sh [id …]              # 以上全部＋tests/region_check.js 情境檢查，結果寫入 data/processed/<id>/results.json
```

## 功能

- 河道水位縱斷面與各河段疏散門開關情境（新店溪：華江、華中、馬場町、古亭、景福）
- 內政部 20 m 實測 DEM 地形、等高線與 3D 建物（臺北市 3D 近似建物模型）
- 二維局部慣性淺水波水流（Bates et al., 2010），建物以孔隙率法處理
- 雨水下水道（78.8 mm/hr）與抽水站（45–60 mm/hr）排水模型
- OpenStreetMap 道路、橋樑、公共設施淹水狀態
- 颱風預報換算（合理化公式估算新店溪洪峰，只有新店溪頁面）
- 疏散門缺少 OSM 資料的河段，依道路穿越堤線處推定位置（頁面上註明）

## 資料來源與授權

- 地形：內政部國土測繪中心 2025 年 20 m DEM，政府資料開放授權條款第 1 版
- 建物：臺北市自動化 3D 近似建物模型，經 [sheethub/tpe3d](https://github.com/sheethub/tpe3d) 轉換
- 抽水站：臺北市水利處抽水站（data.gov.tw 資料集 143901）
- 道路、橋樑、設施、疏散門：© OpenStreetMap contributors，ODbL
- 3D 繪圖：three.js（MIT）

## 免責聲明

教學與情境比較用的簡化模擬，不是官方淹水預報或疏散指示。實際資訊請以中央氣象署、經濟部水利署與臺北市政府公告為準。
