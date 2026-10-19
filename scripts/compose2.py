import json, re
from matplotlib.path import Path
from pyproj import Transformer
d=json.load(open('osm/osm.json'))
def area(pts): return abs(sum(pts[i][0]*pts[(i+1)%len(pts)][1]-pts[(i+1)%len(pts)][0]*pts[i][1] for i in range(len(pts))))/2
schools=[p for p in d['pubs'] if p['t']=='school' and 'p' in p]
campus=sorted([p for p in schools if area(p['p'])>2500],key=lambda p:-area(p['p']))
sites=[]
for c in campus:
    if any(Path(s['p']).contains_point((c['x'],c['y'])) for s in sites): continue
    names=[s['n'] for s in schools if s['n'] and Path(c['p']).contains_point((s['x'],s['y']))]+([c['n']] if c['n'] else [])
    nm=next((m.group(1) for n in names for m in [re.match(r'(.+?(國小|國中|高中|高職|大學|學校))',n)] if m),'')
    sites.append({**c,'n':nm or '學校'})
named_schools=[p for p in d['pubs'] if p['t']=='school' and p['n'] and re.search(r'(國小|國中|高中|高職|大學|學校)$',p['n'])]
others=[p for p in d['pubs'] if p['t']!='school' and p['n'] and p['t']!='public']
seen=set(); out=[]
for p in sites+named_schools+others:
    key=(p['n'],round(p['x']/50),round(p['y']/50))
    if key in seen: continue
    seen.add(key); out.append({k:v for k,v in p.items() if k!='p'})
d['pubs']=out
seenG=set(); d['gates']=[]
for g in d.get('gates_found',[]):
    if g['n'] in ('華江疏散門','華中一疏散門','馬場疏散門') or g['n'] in seenG: continue
    if not (0<=g['x']<=5600 and 0<=g['y']<=4200): continue
    seenG.add(g['n']); d['gates'].append({'n':g['n'],'ref':g['ref'] or '疏散門','x':g['x'],'y':g['y']})
d.pop('gates_found',None)
d['pumps']=[{'n':n+'抽水站','x':round(x-299000,1),'y':round(y-2766400,1)} for n,x,y in [('貴陽',300393.75,2770483.71),('雙園',299328.75,2769244.03),('古亭',302790.71,2768105.06),('景美',303946.17,2766923.45)]]
T=Transformer.from_crs('EPSG:4326','EPSG:3826',always_xy=True)
bx=[]
for b in d['bounds']:
    x0,y0=T.transform(b['minlon'],b['minlat']); x1,y1=T.transform(b['maxlon'],b['maxlat'])
    bx.append([round(x0-299000),round(y0-2766400),round(x1-299000),round(y1-2766400)])
d['bounds']=bx
d['bounds']=[]; d['full']=True
json.dump(d,open('osm/osm2.json','w'),ensure_ascii=False,separators=(',',':'))
print(len(out),'pubs',len(d['roads']),'roads',len(d['bridges']),'bridges')
