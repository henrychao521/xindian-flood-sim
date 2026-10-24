# 在本機接手這個專案

適用於在自己電腦上用 Claude Code（桌面版或終端機）或單純手動操作。分三部分：環境、常用指令、給 Claude 的開場提示。

## 1. 準備環境（一次）

```bash
git clone https://github.com/henrychao521/xindian-flood-sim.git
cd xindian-flood-sim

# Python 3.10+
python3 -m pip install numpy scipy pyproj matplotlib

# Node 18+，Playwright（headless Chromium 跑情境檢查用）
npm i -g playwright@1.56.1
npx playwright install chromium

# three.js 本機副本（離線測試頁用；正式頁面用 CDN）
mkdir -p vendor
curl -sSL -o vendor/three.min.js https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js
curl -sSL -o vendor/OrbitControls.js https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js

# 建物資料（sheethub/tpe3d，72 MB）與全市 DEM 拼接
git clone --depth 1 https://github.com/sheethub/tpe3d /tmp/tpe3d
mkdir -p work/tpe3d && cp /tmp/tpe3d/geojsons/*.json work/tpe3d/
python3 scripts/mosaic.py          # → work/taipei_dem20.npz
```

`work/`、`vendor/` 都在 `.gitignore`，不會進 repo。OSM 分塊會在第一次跑 `build_region.py` 時從 OSM API 下載到 `work/<id>/osm/`（全部約 1.3 GB，之後重用）。

## 2. 常用指令

| 目的 | 指令 |
|---|---|
| 只改頁面程式（`src/`）後重建 | `python3 src/make_region_template.py && python3 src/build.py && for r in tamsui shilin zhongshan neihu jingmei beitou; do python3 src/build.py --region $r; done` |
| 改某河段設定（`regions/<id>.json`）後重做資料 | `python3 scripts/build_region.py <id> --plot` → 看 `work/<id>/check.png`，再 `python3 scripts/mask_plot.py <id>` |
| 全部重跑＋情境檢查＋對照＋總覽 | `bash scripts/run_checks.sh`（單一河段：`bash scripts/run_checks.sh tamsui`） |
| 新店溪回歸測試（水門水理不變） | `node tests/regress.js <舊版html> <新版html>`，期望 `SAME` |
| 結果表 | `python3 scripts/results_table.py` |
| 重算 3D 底圖與封面（Blender 5.1） | 見 README「3D 地形底圖與封面」；七個河段底圖各約 30 秒、封面各約 5 秒（Metal GPU） |
| 即時面板檢查（需網路） | `node tests/live_check.js <html> <prefix>` |
| 本機預覽 | `python3 -m http.server 8080` → http://localhost:8080/overview/ |

推上 `main` 後 GitHub Pages 約一兩分鐘更新。

## 3. 給本機 Claude 的開場提示（直接貼）

```
這個 repo 是臺北市河川淹水模擬器（7 個河段的靜態頁面＋前處理腳本）。
先讀 README.md 和 docs/STAGES.md，STAGES 記錄了每個階段的做法、修正與目前限制。
規則：
- 改 src/ 之後要重建所有頁面（README「重建」一節的指令），改 regions/ 之後要跑 scripts/build_region.py 並看 work/<id>/check.png。
- 任何模型改動都要跑 bash scripts/run_checks.sh（或單一河段），確認 errors [] 與 mobile sw 400，再把結果寫進 docs/STAGES.md 新階段。
- 每個階段完成就 commit 並 push 到 main；資料備份在 data/raw 與 data/processed。
- 不要把 PDF 或 OSM 原始檔放進 repo。
- 右欄是分頁（data-tab：now／map／sweep／live／stats／notes），新面板要加 data-tab；測試截圖前先 showTab()。長說明放進 <details class="how">。
目前的下一步候選：（1）山區排水溪流已在階段 12 完成，內湖、景美溪仍高估約 5 倍；（2）5 m DEM 屬一般公務機密、需機關申請，暫停；（3）納莉颱風、跨河段漫流、溪流溢流、封堵時間已在階段 13–16 完成；下一步可把全市網格做成頁面可互動的版本，或補各溪流的計畫流量；（4）情境集合（階段 9、10）目前的水門組合只有全關、單一門、全部未關，可擴到多門組合與封堵時間。
```

## 4. Colab

Studio 上裝了 Colab CLI（`~/.local/bin/colab`，Pro 方案可開 L4／A100），GPU 工作直接從終端機送：`colab new -s 名 --gpu L4` → `colab exec -s 名 -f 腳本.py` → `colab download` → **一定要 `colab stop -s 名`**（或用 `~/.local/bin/colab-job` 包起來，自動關機與記帳）。降雨情境集合的流程見 README「降雨情境集合（Colab GPU）」與 `docs/STAGES.md` 階段 9（一個河段一次 exec、做完立刻下載）。本機 M4 Max 也可以用 `--device mps` 跑同一支程式，速度與 L4 相當。

以下是沒有 CLI 時的筆記本流程。Colab 無法從本機的 Claude 直接呼叫（沒有 API）。流程是：本機 Claude 推 repo → 在瀏覽器開 `colab/run_all.ipynb`（[Colab 連結](https://colab.research.google.com/github/henrychao521/xindian-flood-sim/blob/main/colab/run_all.ipynb)）跑 → 結果推到分支 `colab-results` → 本機 Claude 拉回來看。若用 Claude 桌面版並裝了 Claude in Chrome，可以請它在 Chrome 裡開 Colab 連結、按「全部執行」並回報輸出，但儲存格內容與秘密（`GH_TOKEN`）仍要自己設定。

## 5. 連結

- 線上總覽：https://henrychao521.github.io/xindian-flood-sim/overview/
- 新店溪（起點）：https://henrychao521.github.io/xindian-flood-sim/
- 原始碼：https://github.com/henrychao521/xindian-flood-sim
- 作品站卡片：https://henrychao521.github.io
