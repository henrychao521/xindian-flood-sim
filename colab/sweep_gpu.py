# 在 Colab GPU 跑七個河段的降雨情境集合（scripts/flow_torch.py sweep），結果打包成 /content/sweep.tgz。
# 由 Studio 以 colab-job 執行（七個河段約 95 分鐘，分兩個 session 平行跑比較保險；REGIONS 那行可改成子集）：
#   colab-job --gpu L4 --name flood-sweep --get /content/sweep.tgz --out work/sweep colab/sweep_gpu.py
import subprocess, os, sys, time, pathlib, traceback
REPO = "https://github.com/henrychao521/xindian-flood-sim"
os.chdir("/content")
if not pathlib.Path("xindian-flood-sim").exists():
    subprocess.run(["git", "clone", "-q", "--depth", "1", REPO], check=True)
os.chdir("xindian-flood-sim")
subprocess.run(["git", "log", "--oneline", "-1"])
import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "-", flush=True)
out = pathlib.Path("/content/sweep_out"); out.mkdir(exist_ok=True)
regions = ["xindian", "tamsui", "shilin", "zhongshan", "neihu", "jingmei", "beitou"]
t0 = time.time(); done = []
def pack():  # 每做完一個河段就打包一次，中途被停掉也留得住已完成的結果
    subprocess.run(["tar", "czf", "/content/sweep.tgz", "-C", "/content", "sweep_out"])
    print("packed", done, os.path.getsize("/content/sweep.tgz") // 1024, "KB", flush=True)
try:
    for r in regions:
        t1 = time.time()
        subprocess.run([sys.executable, "scripts/flow_torch.py", "sweep", r, "--device", "cuda", "--out", str(out)], check=True)
        done.append(r); print(f"== {r} finished in {time.time()-t1:.0f}s (total {time.time()-t0:.0f}s)", flush=True); pack()
except Exception:
    traceback.print_exc()
finally:
    pack()
