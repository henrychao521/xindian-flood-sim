import numpy as np, json, base64
from scipy import ndimage
d=np.load('domW.npz'); Z=d['Z'].copy(); wall=d['wall']; inland=d['inland']; ny,nx=Z.shape
X0,Y0=299000,2766400
wj,wi=np.where(wall)
crest=np.where(wi<35,10.2,np.where(wi<65,10.5,np.where(wi<140,11.2,np.where(wi<200,12.5,13.5))))
Z[wj,wi]=np.maximum(Z[wj,wi],crest)
Zi=Z.copy(); Zi[inland]=np.maximum(Zi[inland],2.6)
def nearest_wall(i,j):
    k=np.argmin((wi-i)**2+(wj-j)**2); return int(wi[k]),int(wj[k])
gates={'huajiang':nearest_wall(15.2,153.0),'huazhong':nearest_wall(51.8,63.7),'machangding':nearest_wall(95.4,83.1),'guting':nearest_wall(174.8,89.8),'jingfu':nearest_wall(215,60)}
sills={'huajiang':4.2,'huazhong':4.6,'machangding':5.2,'guting':6.2,'jingfu':7.2}
for g,(i,j) in gates.items(): Zi[j,i]=sills[g]
low1=(d['Z']<1.0)
lab,n=ndimage.label(low1); sz=ndimage.sum(low1,lab,range(1,n+1)); riv=np.isin(lab,[k+1 for k in range(n) if sz[k]>80])
far=(ndimage.distance_transform_edt(~riv)>10)&~inland&~wall
mask=np.where(wall,2,np.where(inland,1,np.where(far,3,0))).astype(np.uint8)
zc=np.round(Zi*100).astype('<i2')
Zm=ndimage.median_filter(np.where(inland,Zi,99),size=5)
low=np.unravel_index(np.argmin(np.where(inland&ndimage.binary_erosion(inland,iterations=3),Zm,99)),Zi.shape)
print('gates',gates,'low',low,'inland',inland.sum())
for g,(i,j) in gates.items(): print(g, 'behind-gate ground', np.round(np.median(Zi[max(0,j-3):j+4,max(0,i-3):i+4][inland[max(0,j-3):j+4,max(0,i-3):i+4]]),2))
out=dict(nx=int(nx),ny=int(ny),x0=X0,y0=Y0,d=20,z=base64.b64encode(zc.tobytes()).decode(),mask=base64.b64encode(mask.tobytes()).decode(),gates={k:[v[0],v[1]] for k,v in gates.items()},low=[int(low[1]),int(low[0])])
json.dump(out,open('demW.json','w'),separators=(',',':'))
