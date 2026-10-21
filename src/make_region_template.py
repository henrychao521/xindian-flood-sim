"""由新店溪頁面模板 page.src.html 產生通用河段模板 region.src.html。
新店溪頁面修正後重新執行本腳本，各河段頁面就會一起更新。"""
import re, pathlib
S = pathlib.Path(__file__).resolve().parent
p = (S / "page.src.html").read_text(encoding="utf-8")

def rep(a, b, count=1):
    global p
    assert a in p, a[:60]
    p = p.replace(a, b, count)

def cut(start, end):  # 刪除 start…end（含 end）
    global p
    i = p.index(start); j = p.index(end, i) + len(end)
    p = p[:i] + p[j:]

rep("<title>新店溪洩洪淹水模擬器</title>", "<title>@@TITLE@@</title>")
rep("<h1>新店溪洩洪淹水模擬器</h1>", "<h1>@@TITLE@@</h1>")
p = re.sub(r'<p class="lede">.*?</p>', '<p class="lede">@@LEDE@@</p>', p, count=1, flags=re.S)
cut('  <details class="panel typhoon" id="typhoonBox">', "  </details>\n")
rep('<label for="q">上游洪峰流量</label>', '<label for="q">洪水規模（計畫洪峰流量 %）</label>')
rep('id="q" min="1000" max="12000" step="250"', 'id="q" min="20" max="140" step="5"')
rep('$("q").value = P.Qpeak; $("qOut").textContent = fmtInt(P.Qpeak) + " m³/s";', '$("q").value = P.Qpeak; $("qOut").textContent = P.Qpeak + "%";')
# 平面示意圖只適用新店溪
i = p.index('        <section class="panel">\n          <div class="chart-head">\n            <h2>平面示意圖</h2>')
j = p.index("        </section>\n", i) + len("        </section>\n")
p = p[:i] + p[j:]
rep('<div class="two">', '<div class="one">')
rep("renderKPIs(fr); renderMap(fr); renderStageTS();", "renderKPIs(fr); renderStageTS();")
rep(" renderVillages(fr);", "")
i = p.index('      <section class="panel">\n        <div class="chart-head">\n          <h2>南萬華各里災情')
j = p.index("      </section>\n", i) + len("      </section>\n")
p = p[:i] + p[j:]
i = p.index('      <section class="panel notes">\n        <h2>模型假設')
j = p.index("      </section>\n", i) + len("      </section>\n")
p = p[:i] + "@@NOTES@@\n" + p[j:]
# 情境範例
i = p.index("const DRAIN0 = "); j = p.index("];\n", i) + 3
p = p[:i] + '''const DRAIN0 = { sewerMM: 78.8, pumpMM: 60, avail: 100, rainHours: 2 };
const KG0 = GATES[REGION.keyGate].id, base = { tide: 1.6, tideSync: true, rain: 40, ...DRAIN0, C: 1.55, openPct: 100, closeAt: 8 };
const PRESETS = [
  { id: "flood80", name: "計畫洪峰 80%＋大潮（水門正常）", p: { ...base, Qpeak: 80, gateOpen: {} } },
  { id: "keyopen", name: `${GATES[REGION.keyGate].name}未關（計畫洪峰 80%）`, p: { ...base, Qpeak: 80, gateOpen: { [KG0]: true } } },
  { id: "allopen", name: "所有水門未關（計畫洪峰 80%）", p: { ...base, Qpeak: 80, gateOpen: Object.fromEntries(GATES.map(g => [g.id, true])) } },
  { id: "rain", name: "內水型：水門關閉＋時雨量 110 mm（1 小時）", p: { ...base, Qpeak: 60, rain: 110, rainHours: 1, gateOpen: {} } },
  { id: "shortrain", name: "短延時暴雨 100 mm/h（對照水利處模擬圖）", p: { ...base, Qpeak: 20, tide: 1.0, tideSync: false, rain: 100, rainHours: 1, gateOpen: {} } },
  { id: "pumpfail", name: "抽水站故障：可用率 30%＋時雨量 70 mm（1 小時）", p: { ...base, Qpeak: 60, rain: 70, rainHours: 1, avail: 30, gateOpen: {} } },
  { id: "over", name: "超過計畫洪峰（120%）＋暴潮", p: { ...base, Qpeak: 120, tide: 2.0, rain: 80, gateOpen: {} } }
];
''' + p[j:]
rep('let activePreset = "pdf";', "let activePreset = PRESETS[0].id;")
# 颱風預報換算（只適用新店溪）
i = p.index("// ---- 颱風預報換算 ----"); j = p.index("});\ntyCompute();\n", i) + len("});\ntyCompute();\n")
p = p[:i] + p[j:]
# 河道縱斷面：依節點自動決定座標範圍
rep("const X = km => box.l + km / 15 * (box.r - box.l);", "const KM = Math.max(1, NODES[NODES.length - 1].km); const X = km => box.l + km / KM * (box.r - box.l);")
rep("const Y = v => box.b - (v + 4) / 26 * (box.b - box.t);", "const Y0 = Math.floor(Math.min(...NODES.map(n => n.bed)) - 1), Y1 = Math.ceil(Math.max(...NODES.map(n => n.levee)) + 2); const Y = v => box.b - (v - Y0) / (Y1 - Y0) * (box.b - box.t);")
rep("axes(svg, X, Y, [0, 2.5, 5, 7.5, 10, 12.5, 15], ticks(-4, 22, 4),", "axes(svg, X, Y, ticks(0, Math.floor(KM), KM > 6 ? 2 : 1), ticks(Y0, Y1, Y1 - Y0 > 16 ? 4 : 2),")
p = p.replace("${X(15)}", "${X(KM)}")
rep('txt(svg, box.l, box.b + 32, "← 下游（華江橋・三河匯流）", {});', 'txt(svg, box.l, box.b + 32, `← ${NODES[0].name}`, {});')
rep('txt(svg, box.r, box.b + 32, "上游（碧潭・翡翠水庫方向）→", { "text-anchor": "end" });', 'txt(svg, box.r, box.b + 32, `${NODES[NODES.length - 1].name} →`, { "text-anchor": "end" });')
p = re.sub(r'aria-label="新店溪由華江橋至碧潭的水位縱斷面"', 'aria-label="河道水位縱斷面"', p)
p = re.sub(r'<div class="hint">地形取自內政部 2025 年 20 m DEM.*?</div>', '<div class="hint">@@TERRAINHINT@@</div>', p, count=1, flags=re.S)
p = re.sub(r"<h2>建物受災統計（[^<]*）</h2>", "<h2>建物受災統計（堤內）</h2>", p)
p = re.sub(r"<h2>道路與公共設施（[^<]*）</h2>", "<h2>道路與公共設施</h2>", p)
p = re.sub(r"<li><b>情境參數：</b>.*?</li>", "<li><b>情境參數：</b>河道水位以「計畫洪峰流量的百分比」內插於常水位與計畫洪水位（堤頂下 1.5 m）之間，屬示意性質；水門流量係數依 Henderson (1966)、Bos (1985) 等文獻；下水道與抽水站標準依臺北市雨水下水道設計規範。</li>", p, count=1, flags=re.S)
p = p.replace("涵蓋整個模擬範圍：萬華、中正、大安區沿新店溪一帶，資料下載日 2026-10-19", "涵蓋整個模擬範圍，資料下載日 2026-10-19")
p = p.replace(".two { display: grid;", ".one { display: grid; gap: 18px; }\n.one svg#tsStage, .one svg#tsFlow { max-width: 680px; }\n.two { display: grid;")
p = p.replace('<meta name="description" content="新店溪洩洪與疏散門失效淹水模擬', '<meta name="description" content="@@TITLE@@')
(S / "region.src.html").write_text(p, encoding="utf-8")
print("wrote region.src.html", len(p))
