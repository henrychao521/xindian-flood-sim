# 在 Colab GPU 跑七個河段的降雨情境集合（scripts/flow_torch.py sweep），結果打包成 /content/sweep.tgz。
# 由 Studio 以 colab-job 執行：colab-job --gpu L4 --name flood-sweep --get /content/sweep.tgz --out work/sweep colab/sweep_gpu.py
import subprocess, os, sys, time, pathlib, traceback
REPO = "https://github.com/henrychao521/xindian-flood-sim"
os.chdir("/content")
if not pathlib.Path("xindian-flood-sim").exists():
    subprocess.run(["git", "clone", "-q", "--depth", "1", REPO], check=True)
os.chdir("xindian-flood-sim")
subprocess.run(["git", "log", "--oneline", "-1"])
import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "-", flush=True)
out = pathlib.Path("/content/sweep_out"); out.mkdir(exist_ok=True)
regions = sys.argv[1:] or ["xindian", "tamsui", "shilin", "zhongshan", "neihu", "jingmei", "beitou"]
t0 = time.time(); done = []
try:
    for r in regions:
        t1 = time.time()
        subprocess.run([sys.executable, "scripts/flow_torch.py", "sweep", r, "--device", "cuda", "--out", str(out)], check=True)
        done.append(r); print(f"== {r} finished in {time.time()-t1:.0f}s (total {time.time()-t0:.0f}s)", flush=True)
except Exception:
    traceback.print_exc()
finally:
    subprocess.run(["tar", "czf", "/content/sweep.tgz", "-C", "/content", "sweep_out"])
    print("packed", done, os.path.getsize("/content/sweep.tgz") // 1024, "KB", flush=True)
