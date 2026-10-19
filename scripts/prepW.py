import numpy as np
from scipy import ndimage
Z=np.load('Z2.npy'); ny,nx=Z.shape
P=[(66,209),(58,192),(45,178),(30,163),(18,152),(14,145),(15,133),(22,119),(27,107),(32,91),(39,80),(47,71),(55,65),(65,63),(73,64),(80,69),(90,75),(100,83),(110,91),(120,97),(130,102),(137,106),(147,106),(155,102),(161,95),(170,91),(179,88),(190,83),(200,74),(210,64),(220,53),(230,42),(238,33),(244,25),(250,15),(255,0)]
S=[]
for x,y in P:
    best=None
    for j in range(max(0,y-3),min(ny,y+4)):
        for i in range(max(0,x-3),min(nx,x+4)):
            if best is None or Z[j,i]>Z[best[0],best[1]]: best=(j,i)
    S.append(best)
wall=np.zeros((ny,nx),bool)
for (j0,i0),(j1,i1) in zip(S[:-1],S[1:]):
    k=int(max(abs(j1-j0),abs(i1-i0)))*3+1
    for t in np.linspace(0,1,k):
        wall[int(round(j0+(j1-j0)*t)),int(round(i0+(i1-i0)*t))]=True
# 端點延伸到邊界
wall[S[0][0]:,S[0][1]]=True; wall[:S[-1][0]+1,S[-1][1]]=True
wall=ndimage.binary_dilation(wall,structure=np.ones((2,2),bool))
def flood(seed,block):
    m=np.zeros((ny,nx),bool); st=[seed]; m[seed]=True
    while st:
        j,i=st.pop()
        for a,b in ((1,0),(-1,0),(0,1),(0,-1)):
            jj,ii=j+a,i+b
            if 0<=jj<ny and 0<=ii<nx and not m[jj,ii] and not block[jj,ii]: m[jj,ii]=True; st.append((jj,ii))
    return m
inland=flood((150,150),wall)
print('inland',inland.sum(),'outside',(~inland&~wall).sum(),'river in inland',((Z<0.5)&inland).sum())
np.savez('domW.npz',Z=Z,wall=wall,inland=inland)
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
fig,ax=plt.subplots(figsize=(14,10.5)); ax.imshow(Z,origin='lower',cmap='gist_earth',vmin=0,vmax=12)
ax.imshow(np.ma.masked_where(inland,~inland),origin='lower',cmap='cool',alpha=.35)
yy,xx=np.where(wall); ax.plot(xx,yy,'r.',ms=2)
ax.set_xticks(range(0,nx,10)); ax.set_yticks(range(0,ny,10)); ax.tick_params(labelsize=6); ax.grid(alpha=.3)
plt.savefig('domW.png',dpi=50,bbox_inches='tight')
