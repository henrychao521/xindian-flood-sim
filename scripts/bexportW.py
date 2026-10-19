import pickle, numpy as np, json, base64
from matplotlib.path import Path
feats=pickle.load(open('featsW.pkl','rb'))
X0,Y0,D,NX,NY=299000,2766400,20,280,210
# 去重：同中心點保留最高者
best={}
for f in feats:
    key=(round(f[5].mean()),round(f[6].mean()))
    if key not in best or (f[1] or 0)>(best[key][1] or 0): best[key]=f
feats=list(best.values())
cov=np.zeros((NY,NX)); sub=4
gx=(np.arange(NX*sub)+0.5)*D/sub+X0; gy=(np.arange(NY*sub)+0.5)*D/sub+Y0
GX,GY=np.meshgrid(gx,gy); pts=np.c_[GX.ravel(),GY.ravel()]
inside=np.zeros(len(pts),bool)
out=[]
for f in feats:
    x,y=f[5],f[6]
    # 去除重複頂點
    keep=[0]+[i for i in range(1,len(x)) if abs(x[i]-x[keep[-1] if False else i-1])>0.05 or abs(y[i]-y[i-1])>0.05]
    x=x[keep];y=y[keep]
    if len(x)>3 and abs(x[0]-x[-1])<0.05 and abs(y[0]-y[-1])<0.05: x=x[:-1];y=y[:-1]
    if len(x)<3: continue
    x=np.clip(x,X0,X0+NX*D); y=np.clip(y,Y0,Y0+NY*D)
    m=(pts[:,0]>=x.min())&(pts[:,0]<=x.max())&(pts[:,1]>=y.min())&(pts[:,1]<=y.max())
    if m.any(): inside[np.where(m)[0][Path(np.c_[x,y]).contains_points(pts[m])]]=True
    h=float(f[1] or 3.0)
    out.append([int(round(h*10))]+[int(round(v)) for xy in zip((x-X0),(y-Y0)) for v in xy])
cov=inside.reshape(NY*sub,NX*sub).reshape(NY,sub,NX,sub).mean(axis=(1,3))
print('buildings',len(out),'mean cov',cov.mean(),'cells>0.5',(cov>0.5).sum())
c8=np.round(cov*100).astype(np.uint8)
json.dump({'cov':base64.b64encode(c8.tobytes()).decode(),'b':out},open('bldW.json','w'),separators=(',',':'))
import os; print(os.path.getsize('bldW.json'))
