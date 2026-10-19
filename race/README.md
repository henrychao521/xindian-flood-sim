# Terrain GP

F1 風格的瀏覽器賽車，可用高度圖、臺北實測地形或 OpenStreetMap 地圖當賽道。

- `index.html`、`game.js`：遊戲本體（three.js r128，從 cdnjs / jsDelivr 載入）。
- `data/taipei.json`：臺北街道賽資料，由 `tools/prep_taipei.py` 從本 repo 的 `data/processed`（20 m DEM、3D 建物、OSM 道路）打包而成。
  在 `race/` 目錄執行 `python3 tools/prep_taipei.py` 可重新產生。

線上對戰使用 claude.ai Artifact 的即時房間功能，只在 claude.ai 上開啟時可用；GitHub Pages 版本支援單人計時與電腦對手。

資料來源：內政部國土測繪中心 2025 年 20 m DEM（政府資料開放授權條款第 1 版）；臺北市 3D 近似建物模型（sheethub/tpe3d）；道路 © OpenStreetMap contributors（ODbL）。
