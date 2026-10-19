import xml.etree.ElementTree as ET, json, collections
from pyproj import Transformer
T=Transformer.from_crs('EPSG:4326','EPSG:3826',always_xy=True)
import glob
U=''
files=sorted(glob.glob('osm/api/*.osm'))
nodes={}; ways={}; bounds=[]
for fn in files:
    for ev,el in ET.iterparse(U+fn,events=('end',)):
        if el.tag=='bounds': bounds.append({k:float(v) for k,v in el.attrib.items()})
        elif el.tag=='node':
            tags={t.get('k'):t.get('v') for t in el.findall('tag')}
            nodes[el.get('id')]=(float(el.get('lon')),float(el.get('lat')),tags if tags else None)
        elif el.tag=='way':
            ways[el.get('id')]=([n.get('ref') for n in el.findall('nd')],{t.get('k'):t.get('v') for t in el.findall('tag')})
        if el.tag in('node','way','relation'): el.clear()
print('nodes',len(nodes),'ways',len(ways))
AM={'school','kindergarten','hospital','clinic','police','fire_station','townhall','community_centre','library','social_facility','university','college','marketplace','post_office'}
cnt=collections.Counter()
roads=[];bridges=[];pubs=[]
def xy(ids):
    pts=[]
    for i in ids:
        if i in nodes: x,y=T.transform(nodes[i][0],nodes[i][1]); pts.append((round(x-299000,1),round(y-2766400,1)))
    return pts
HW={'motorway','trunk','primary','secondary','tertiary','residential','unclassified','living_street','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link','service'}
for wid,(ids,tg) in ways.items():
    hw=tg.get('highway')
    if hw in HW:
        pts=xy(ids)
        if len(pts)<2: continue
        rec={'n':tg.get('name',''),'c':hw,'p':pts}
        if tg.get('bridge') in('yes','viaduct'): rec['l']=int(tg.get('layer','1') or 1) if (tg.get('layer','1') or '1').lstrip('-').isdigit() else 1; bridges.append(rec)
        elif tg.get('tunnel') not in('yes',) and hw!='service': roads.append(rec)
        cnt[hw]+=1
    am=tg.get('amenity'); bd=tg.get('building')
    if am in AM or bd in ('school','hospital','public','government','civic','kindergarten'):
        pts=xy(ids)
        if len(pts)>=3:
            cx=sum(p[0] for p in pts)/len(pts); cy=sum(p[1] for p in pts)/len(pts)
            pubs.append({'n':tg.get('name',''),'t':am or bd,'x':round(cx,1),'y':round(cy,1),'p':pts})
gates_found=[]
for nid,(lon,lat,tg) in nodes.items():
    if not tg: continue
    nm=tg.get('name','')
    if '疏散門' in nm and tg.get('amenity')!='bicycle_rental':
        x,y=T.transform(lon,lat); gates_found.append({'n':nm,'ref':tg.get('alt_name',''),'x':round(x-299000,1),'y':round(y-2766400,1)})
    am=tg.get('amenity')
    if am in AM:
        x,y=T.transform(lon,lat); pubs.append({'n':tg.get('name',''),'t':am,'x':round(x-299000,1),'y':round(y-2766400,1)})
# dedupe pubs by name+type, prefer polygons
seen={}; out=[]
for p in sorted(pubs,key=lambda p:0 if 'p' in p else 1):
    key=(p['n'],p['t']) if p['n'] else (p['x']//30,p['y']//30,p['t'])
    if key in seen: continue
    seen[key]=1; out.append(p)
pubs=out
tong=[r for r in roads if r['n']=='同安街']
json.dump(tong,open('osm/tongan.json','w'),ensure_ascii=False)
print('roads',len(roads),'bridges',len(bridges),'pubs',len(pubs))
print(collections.Counter(p['t'] for p in pubs))
print('bridge names',collections.Counter(b['n'] for b in bridges).most_common(20))
print('gates',[(g['n'],g['x'],g['y']) for g in gates_found]); print('named pubs sample',[p['n'] for p in pubs if p['n']][:40])
b=bounds; print('union bounds',min(x['minlat'] for x in b),min(x['minlon'] for x in b),max(x['maxlat'] for x in b),max(x['maxlon'] for x in b))
json.dump({'roads':roads,'bridges':bridges,'pubs':pubs,'bounds':bounds,'gates_found':gates_found},open('osm/osm.json','w'),ensure_ascii=False,separators=(',',':'))
import os; print('size',os.path.getsize('osm/osm.json'))
