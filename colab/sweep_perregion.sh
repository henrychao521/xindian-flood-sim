#!/usr/bin/env bash
# 從 Studio 用 Colab CLI 跑降雨情境集合：每個河段一次 colab exec，做完立刻下載（colab exec 長時間會斷線、沒連線的 VM 會被收回）。
# 用法：bash colab/sweep_perregion.sh NAME "zhongshan neihu" work/sweep/E [sweep|river|closure]
#   sweep → <id>_sweep.json、<id>_maps.json（複製到 data/processed/<id>/sweep.json、sweep_maps.json）
#   river → <id>_river.json、<id>_river_maps.json（複製到 data/processed/<id>/river.json、river_maps.json）
set -u
NAME=$1; REGIONS=$2; OUT=$3; MODE=${4:-sweep}; S="cc-${NAME}-$(date +%H%M%S)"; T0=$(date +%s); LOG=~/3d/colab-jobs/usage.log; mkdir -p "$OUT"; RC=0
cleanup() { colab stop -s "$S" >/dev/null 2>&1; echo "$(date '+%F %T') $S gpu=L4 minutes=$(( ($(date +%s) - T0 + 59) / 60 )) status=${RC:-?} script=flow_torch.py $MODE ($REGIONS)" >> "$LOG"; echo "[perregion] session $S stopped"; }
trap cleanup EXIT INT TERM
colab new -s "$S" --gpu L4 || { RC=new-failed; exit 1; }
cat > "$OUT/setup.py" <<'PY'
import subprocess, pathlib, os
os.chdir("/content")
if not pathlib.Path("xindian-flood-sim").exists(): subprocess.run(["git","clone","-q","--depth","1","https://github.com/henrychao521/xindian-flood-sim"], check=True)
import torch; print("torch", torch.__version__, torch.cuda.get_device_name(0))
PY
colab exec -s "$S" -f "$OUT/setup.py" || { RC=setup-failed; exit 1; }
for r in $REGIONS; do
  cat > "$OUT/run_$r.py" <<PY
import subprocess, os, sys
os.chdir("/content/xindian-flood-sim")
subprocess.run([sys.executable, "scripts/flow_torch.py", "$MODE", "$r", "--device", "cuda", "--out", "/content/sweep_out"], check=True)
print("REGION_DONE $r")
PY
  echo "[perregion] $r start $(date '+%T')"
  colab exec -s "$S" -f "$OUT/run_$r.py" 2>&1 | grep -aE "REGION_DONE|done|Traceback|Error" | tail -3
  if [ "$MODE" = river ]; then A=${r}_river.json; M=${r}_river_maps.json; elif [ "$MODE" = closure ]; then A=${r}_closure.json; M=$A; else A=${r}_sweep.json; M=${r}_maps.json; fi
  for i in $(seq 1 60); do colab ls -s "$S" /content/sweep_out 2>/dev/null | grep -q "$M" && break; sleep 60; done
  colab download -s "$S" /content/sweep_out/$A "$OUT/$A" && colab download -s "$S" /content/sweep_out/$M "$OUT/$M" || RC=1
  echo "[perregion] $r downloaded $(date '+%T')"; ls -la "$OUT" | grep "$r"
done
exit $RC
