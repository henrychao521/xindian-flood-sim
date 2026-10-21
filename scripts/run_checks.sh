#!/usr/bin/env bash
# 全部河段重建＋檢查：資料 → 頁面 → 本機測試頁 → tests/region_check.js → results.json → 總覽頁
# 用法：[SKIP_DATA=1] scripts/run_checks.sh [河段 id …]（不給就是全部；SKIP_DATA=1 跳過 build_region.py，沿用 data/processed）。需要 playwright（NODE_PATH 指到全域 node_modules）與 vendor/ 的 three.js
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=${TMP:-$ROOT/work/checks}; mkdir -p "$TMP"
[ -d "$TMP/vendor" ] || ln -s "$ROOT/vendor" "$TMP/vendor" 2>/dev/null || true
export NODE_PATH=${NODE_PATH:-$(npm root -g)}
REGIONS=${*:-"xindian tamsui shilin zhongshan neihu jingmei beitou"}
for r in $REGIONS; do
  echo "== $r"
  if [ "$r" = xindian ]; then
    python3 "$ROOT/src/build.py" >/dev/null
    python3 "$ROOT/src/build.py" --local-three "$TMP/t_xindian.html" >/dev/null
    (cd "$TMP" && PRESETS=pdf,rain,shortrain node "$ROOT/tests/region_check.js" "$TMP/t_xindian.html" "$TMP/t_xindian")
  else
    [ -n "${SKIP_DATA:-}" ] || python3 "$ROOT/scripts/build_region.py" "$r" >/dev/null  # SKIP_DATA=1：只改頁面程式時不重做資料（不需 OSM 與 DEM）
    python3 "$ROOT/src/build.py" --region "$r" >/dev/null
    python3 "$ROOT/src/build.py" --region "$r" --local-three "$TMP/t_$r.html" >/dev/null
    (cd "$TMP" && PRESETS=keyopen,rain,shortrain node "$ROOT/tests/region_check.js" "$TMP/t_$r.html" "$TMP/t_$r")
  fi
  mkdir -p "$ROOT/data/processed/$r"; cp "$TMP/t_${r}_stats.json" "$ROOT/data/processed/$r/results.json"
done
python3 "$ROOT/scripts/overview_map.py"
for r in $REGIONS; do  # 與水利處降雨積水模擬圖比對（最後一個情境＝短延時 100 mm/h）
  for c in 100 130; do python3 -I "$ROOT/scripts/compare_inundation.py" "$r" "$TMP/t_${r}_stats.json" $c; done
done
python3 "$ROOT/scripts/overview_map.py"  # 卡片上的對照數字來自 compare_*.json
