// 由 scripts/build_region.py 依 regions/beitou.json 自動產生，請勿手動修改
const NODES = [{"id": "n0", "name": "a", "km": 0.0, "cell": [10, 10], "bed": -4.0, "plain": 3.0, "levee": 10.0, "zn": 0.0, "zd": 8.5, "tf": 0.5}];
const GATES = [];
const VILLAGES = [];
// 河道水位：常水位 zn 到計畫洪水位 zd 之間，依「計畫洪峰流量的比例 r」以 r^0.6 內插（寬淺河道曼寧公式的水深—流量關係），再加潮位影響
function riverStage(node, Qk, tide) { const r = Math.max(0, Qk * 10); return node.zn + (node.zd - node.zn) * Math.pow(r, 0.6) + node.tf * tide; }
const REGION = {"id": "beitou", "keyGate": 0, "outlet": "W", "cam": [-150, 175, 200], "labels": [], "mapLabels": [], "qDesign": 25000, "riverWidth": 300, "bedRef": 0, "title": "基隆河出海段（北投・關渡）淹水模擬器", "river": "基隆河出海段、磺溪", "districts": "北投、關渡、士林北"};
