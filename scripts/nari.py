#!/usr/bin/env python3
"""2001 年納莉颱風歷史情境 → data/processed/<id>/nari.json（頁面「納莉颱風」情境與紀錄對照用）

模擬期間：2001-09-16 19:00 至 09-17 11:00（16 小時；兩波主降雨與基隆河、淡水河 09-17 02:00 的水位峰值）。
資料來源與做法（每一項都寫進 nari.json 的 sources／assumptions，頁面照列）：
- 雨量：中央氣象署 CODiS 測站逐時雨量（scripts/fetch_codis.py 下載到 work/nari/），每個河段取最近的測站
- 河道水位：臺北市水利處〈納莉颱風〉報告的峰值水位（大直橋 7.65 m、臺北橋 3.70 m，09-17 02:00；寶橋 18.54 m，00:00）
  以各河段的水位公式反推流量百分比；沒有觀測站的河段沿河道與相鄰河段銜接。歷線形狀、潮位時刻是假設
- 抽水站失效：水利署〈90 年納莉颱風〉報告（南湖 09-16 22:00、玉成 09-17 08:00）與臺北市水利處報告（大直、濱江、洲美二、南港、成功、萬芳，時間未載，假設在河川峰值 02:00）
- 對照紀錄：水利署報告表 5（資料來源：臺北市政府納莉颱風災害防救處理專案報告）各區淹水地點與深度
用法：python3 scripts/nari.py"""
import json, re, math, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
T0, HOURS, TP = "2001-09-16T19:00", 16, 7.0          # 起點、時長、基隆河／淡水河峰值（09-17 02:00＝T+7）
TIDE = 1.2                                           # 大潮振幅（假設；滿潮與河川峰值同時）
STATIONS = {"xindian": [("466920", "臺北")], "tamsui": [("466920", "臺北")], "shilin": [("C0A9B0", "石牌"), ("C0A9E0", "士林")],
            "zhongshan": [("C0A9A0", "大直")], "neihu": [("C0A9G0", "南港")], "jingmei": [("C1A690", "木柵"), ("C1A730", "公館")], "beitou": [("C1AC50", "關渡"), ("C0A980", "社子")]}
FAIL = {"shilin": [("洲美二抽水站", 7.0, "時間未載，假設 02:00")],
        "zhongshan": [("大直抽水站", 7.0, "時間未載，假設 02:00"), ("濱江抽水站", 7.0, "時間未載，假設 02:00"), ("玉成抽水站", 13.0, "淹沒機具，水利署報告")],
        "neihu": [("南湖抽水站", 3.0, "當機，水利署報告"), ("南港抽水站", 7.0, "時間未載，假設 02:00"), ("成功抽水站", 7.0, "時間未載，假設 02:00")],
        "jingmei": [("萬芳抽水站", 5.0, "時間未載，假設景美溪峰值 00:00")]}
# 水利署報告表 5 的臺北市淹水地點（依道路名稱比對模型）
RECORDS = [
    ("neihu", "南港區", "大坑、四分溪（南港路以南）", ["南港路", "四分", "研究院路"], "1.5–3 m"),
    ("neihu", "南港區", "大坑溪以西、忠孝東路七段以北、向陽路以東、基隆路以南", ["忠孝東路七段", "向陽路"], "1.5–3 m"),
    ("neihu", "南港區", "向陽路以西、中坡南北路以東、東新街以北", ["東新街", "中坡北路", "中坡南路"], "1–1.8 m"),
    ("neihu", "內湖區", "東湖路、康寧路三段、南湖大橋北側", ["東湖路", "康寧路三段"], "1.2 m"),
    ("neihu", "內湖區", "康樂街", ["康樂街"], "1.2 m"),
    ("neihu", "內湖區", "大湖山莊街", ["大湖山莊街"], "1.2 m"),
    ("neihu", "內湖區", "環山路、港墘路、金龍路、成功路三段、內湖路二、三段", ["環山路", "港墘路", "金龍路", "成功路三段", "內湖路二段", "內湖路三段"], "1.2 m"),
    ("zhongshan", "內湖區", "環山路、港墘路、金龍路、成功路三段、內湖路二、三段", ["環山路", "港墘路", "金龍路", "成功路三段", "內湖路二段", "內湖路三段"], "1.2 m"),
    ("zhongshan", "中山區", "北安路、明水路、大直街一帶", ["北安路", "明水路", "大直街"], "2.0–2.8 m"),
    ("zhongshan", "中山區", "濱江果菜市場周邊、龍江路西側", ["濱江街", "民族東路", "龍江路"], "1–1.5 m"),
    ("zhongshan", "松山區", "松山機場近大直橋", ["敦化北路", "民權東路三段"], "1.2 m"),
    ("zhongshan", "中山區", "南京東路以北、復興北路以西、建國北路以東", ["復興北路", "建國北路", "長春路", "民生東路二段", "民生東路三段"], "1.0–1.6 m"),
    ("zhongshan", "中山區", "新生北路（基隆河至南京東路）兩側", ["新生北路"], "1.2 m"),
    ("zhongshan", "松山區", "松河路自南京東路至三張犁", ["松河街", "松山路"], "1–1.8 m"),
    ("zhongshan", "松山區", "松山火車站以西、光復北路以東、市民大道以北、南京東路以南", ["八德路四段", "光復北路", "塔悠路"], "1–2 m"),
    ("tamsui", "中山區", "新生北路（基隆河至南京東路）兩側", ["新生北路"], "1.2 m"),
    ("tamsui", "萬華區", "成都路、昆明街、峨嵋街一帶", ["成都路", "昆明街", "峨眉街", "峨嵋街"], "1.0 m"),
    ("xindian", "萬華區", "成都路、昆明街、峨嵋街一帶", ["成都路", "昆明街", "峨眉街", "峨嵋街"], "1.0 m"),
    ("shilin", "士林區", "忠誠路、德行東路、雙溪街一帶", ["忠誠路", "德行東路", "雙溪街"], "1.0 m"),
    ("jingmei", "文山區", "木柵路四、五段", ["木柵路四段", "木柵路五段"], "1.5 m"),
    ("jingmei", "文山區", "老泉街一帶", ["老泉街"], "1.5 m"),
    ("jingmei", "文山區", "新光路三段", ["新光路三段"], "1.0 m"),
    ("jingmei", "文山區", "北政國中（指南路三段）", ["指南路三段", "萬壽路"], "1.5 m"),
]

def rain_series(rid):
    keys = [f"2001-09-{16 + (19 + k + 1) // 24:02d}T{(19 + k + 1) % 24:02d}:00:00" for k in range(HOURS)]
    keys = [k.replace("T00:00:00", "T00:00:00") for k in keys]
    series = []
    for stn, _ in STATIONS[rid]:
        d = {t: v for t, v in json.loads((ROOT / f"work/nari/rain_{stn}.json").read_text())}
        # CODiS 以「該小時結束時刻」標記，24 時記為 23:59
        def get(k):
            if k.endswith("T00:00:00"):
                day = int(k[8:10]) - 1; k = f"2001-09-{day:02d}T23:59:00"
            v = d.get(k); return max(0.0, v) if isinstance(v, (int, float)) else 0.0
        series.append([get(k) for k in keys])
    return [round(sum(s[i] for s in series) / len(series), 1) for i in range(HOURS)]

def nodes(rid):
    if rid == "xindian": return None
    s = (ROOT / f"data/processed/{rid}/region_data.js").read_text(encoding="utf-8")
    return json.loads(re.search(r"const NODES = (\[.*?\]);", s, re.S).group(1))

def stage(n, qpct, tide=TIDE):  # 區域河段的水位公式（與 region_data.js 的 riverStage 相同）
    return n["zn"] + (n["zd"] - n["zn"]) * max(0, qpct / 100) ** 0.6 + n["tf"] * tide

def solve(n, target, tide=TIDE):
    r = (target - n["zn"] - n["tf"] * tide) / (n["zd"] - n["zn"]); return 100 * max(0.0, r) ** (1 / 0.6)

def node_named(ns, name): return next(n for n in ns if n["name"] == name)

def build():
    out = {}
    zs = nodes("zhongshan"); q_zs = solve(node_named(zs, "大直"), 7.65)
    stage_zs0 = stage(zs[0], q_zs)                                  # 中山橋（中山河段下游端）
    sh = nodes("shilin"); q_sh = solve(node_named(sh, "劍潭"), stage_zs0)
    bt = nodes("beitou"); q_bt = solve(node_named(bt, "洲美方向"), stage(node_named(sh, "洲美"), q_sh))
    tm = nodes("tamsui"); q_tm = solve(node_named(tm, "臺北橋"), 3.70)
    nh = nodes("neihu"); q_nh = solve(node_named(nh, "南湖大橋"), 13.0)
    jm = nodes("jingmei"); mz = node_named(jm, "木柵"); q_jm = solve(mz, mz["levee"] + 0.3)
    Q = {"zhongshan": (q_zs, "大直節點峰值 7.65 m（大直橋觀測，09-17 02:00）"), "shilin": (q_sh, "劍潭節點銜接中山河段下游端水位"),
         "beitou": (q_bt, "洲美方向節點銜接士林河段洲美水位"), "tamsui": (q_tm, "臺北橋節點峰值 3.70 m（臺北橋觀測，09-17 02:00）"),
         "neihu": (q_nh, "南湖大橋節點峰值 13.0 m（水利處報告：洪水位超過 13 m）"), "jingmei": (q_jm, f"木柵節點高於堤頂 0.3 m（紀錄：09-16 23:00 景美溪右岸木柵路溢流；寶橋實測 18.54 m 高於模型堤頂，無法直接套用）")}
    # 新店溪：華江橋略高於臺北橋（假設 +0.2 m）；新店溪水位公式 a + k·Qk^0.85 + tf·潮位 + bend·Qk/5.5 + jm·Qk/5.5
    hj = {"a": 0.6, "k": 0.85, "tf": 1.0, "bend": 0, "jm": 0}; target = 3.90
    lo, hi = 0.0, 20.0
    for _ in range(60):
        mid = (lo + hi) / 2; v = hj["a"] + hj["k"] * mid ** 0.85 + hj["tf"] * TIDE
        lo, hi = (mid, hi) if v < target else (lo, mid)
    Q["xindian"] = (lo * 1000, "華江橋節點 3.90 m（假設比臺北橋實測 3.70 m 高 0.2 m）")
    for rid, (q, why) in Q.items():
        tp = 5.0 if rid == "jingmei" else TP
        rec = [{"district": d, "where": w, "roads": rs, "depth": dp} for r, d, w, rs, dp in RECORDS if r == rid]
        out[rid] = {"t0": T0, "hours": HOURS, "rain": rain_series(rid), "stations": [n for _, n in STATIONS[rid]],
                    "Qpeak": round(q, 1) if rid != "xindian" else round(q, -1), "qBase": 0.35, "tp": tp, "tide": TIDE, "tideT": tp,
                    "Qnote": why, "pumpFail": [{"name": n, "at": a, "note": note} for n, a, note in FAIL.get(rid, [])], "records": rec,
                    "sources": ["中央氣象署 CODiS 測站逐時雨量（" + "、".join(n for _, n in STATIONS[rid]) + "站）",
                                "臺北市政府工務局水利工程處〈納莉颱風〉（峰值水位、抽水站與堤防狀況）",
                                "經濟部水利署〈90 年納莉颱風〉事件報告（時序、表 5 臺北市淹水地區及深度）"],
                    "assumptions": ["河川歷線為單峰（09-17 02:00；景美溪 00:00），第二波降雨造成的水位回升沒有模擬", "滿潮與河川峰值同時，大潮振幅 1.2 m",
                                    "未記載時間的抽水站失效假設在河川峰值", "水門照常關閉；基隆河堤防缺口（大坑溪匯流口、南湖大橋臨時堤）以內湖河段整段越堤代表"]}
        out[rid]["rain_total"] = round(sum(out[rid]["rain"]), 1); out[rid]["rain_max"] = max(out[rid]["rain"])
        (ROOT / "data/processed" / rid / "nari.json").write_text(json.dumps(out[rid], ensure_ascii=False))
        print(f'{rid:10} Q {out[rid]["Qpeak"]:>7}  rain {out[rid]["rain_total"]:6.1f} mm (max {out[rid]["rain_max"]}/h)  fails {len(out[rid]["pumpFail"])}  records {len(rec)}  | {why}')

if __name__ == "__main__":
    build()
