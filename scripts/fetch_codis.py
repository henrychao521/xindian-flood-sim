#!/usr/bin/env python3
"""下載中央氣象署 CODiS（氣候資料服務系統）測站逐時雨量 → work/nari/rain_<站號>.json（原始，不進 repo）
用法：python3 scripts/fetch_codis.py <站號> <站型 cwb|auto_C0|auto_C1> <起日 YYYY-MM-DD> <迄日 YYYY-MM-DD>"""
import json, sys, time, pathlib, datetime, subprocess, urllib.parse
ROOT = pathlib.Path(__file__).resolve().parent.parent
def day(stn, typ, d):
    # 用 curl：Python 3.14 的 ssl 會因氣象署憑證缺 Subject Key Identifier 而拒絕連線（curl 照常驗證憑證）
    body = urllib.parse.urlencode({"date": f"{d}T00:00:00.000+08:00", "type": "report_date", "stn_ID": stn, "stn_type": typ, "more": "", "start": f"{d}T00:00:00", "end": f"{d}T23:59:59", "item": ""})
    r = subprocess.run(["curl", "-s", "-m", "60", "-X", "POST", "-A", "Mozilla/5.0", "-H", "Referer: https://codis.cwa.gov.tw/StationData", "-d", body, "https://codis.cwa.gov.tw/api/station"], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)
if __name__ == "__main__":
    stn, typ, a, b = sys.argv[1:5]
    d0, d1 = datetime.date.fromisoformat(a), datetime.date.fromisoformat(b); out = []
    while d0 <= d1:
        js = day(stn, typ, d0.isoformat())
        for st in js.get("data", []):
            for r in st.get("dts", []):
                p = (r.get("Precipitation") or {}).get("Accumulation")
                out.append([r["DataTime"], p])
        d0 += datetime.timedelta(days=1); time.sleep(1)
    dst = ROOT / f"work/nari/rain_{stn}.json"; dst.parent.mkdir(parents=True, exist_ok=True); dst.write_text(json.dumps(out))
    tot = sum(v for _, v in out if isinstance(v, (int, float)) and v >= 0)
    mx = max(((v, t) for t, v in out if isinstance(v, (int, float))), default=None)
    print(stn, len(out), "hours, total", round(tot, 1), "mm, max", mx)
