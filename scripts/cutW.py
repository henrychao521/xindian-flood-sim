import json, glob, numpy as np
from pyproj import Transformer
T=Transformer.from_crs('EPSG:4326','EPSG:3826',always_xy=True)
xa,xb,ya,yb=299000,304600,2766400,2770600
feats=[]; total=0
for f in sorted(glob.glob('repo/geojsons/*.json')):
    try: d=json.load(open(f))
    except Exception as e: print('bad',f,e); continue
    for ft in d['features']:
        total+=1
        g=ft['geometry']
        if g['type']!='Polygon': continue
        ring=np.array(g['coordinates'][0])
        x,y=T.transform(ring[:,0],ring[:,1])
        if x.max()<xa or x.min()>xb or y.max()<ya or y.min()>yb: continue
        x=np.array(x);y=np.array(y)
        area=0.5*abs(np.dot(x,np.roll(y,1))-np.dot(y,np.roll(x,1)))
        feats.append((f.split('/')[-1],ft['properties'].get('height'),ft['properties'].get('color'),area,len(x),x,y))
print('total',total,'in domain',len(feats))
import collections
print(collections.Counter(f[0] for f in feats))
ar=np.array([f[3] for f in feats]); hs=np.array([f[1] or 0 for f in feats])
print('area pct',np.percentile(ar,[5,25,50,75,95]),'zero-area',(ar<1).sum())
print('height pct',np.percentile(hs,[5,25,50,75,95,99]))
print(collections.Counter(f[2] for f in feats).most_common(8))
import pickle; pickle.dump(feats,open('featsW.pkl','wb'))
