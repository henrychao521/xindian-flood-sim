import numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
A=np.load('pts.npy')
x0,x1,y0,y1=297000,305000,2764000,2772000
m=(A[:,0]>=x0)&(A[:,0]<x1)&(A[:,1]>=y0)&(A[:,1]<y1)
B=A[m]
nx,ny=(x1-x0)//20,(y1-y0)//20
G=np.full((ny,nx),np.nan)
i=((B[:,0]-x0)//20).astype(int); j=((B[:,1]-y0)//20).astype(int)
G[j,i]=B[:,2]
print('nan',np.isnan(G).sum(), np.nanmin(G),np.nanmax(G))
np.save('G.npy',G)
fig,ax=plt.subplots(figsize=(11,11))
im=ax.imshow(G,origin='lower',extent=[x0,x1,y0,y1],cmap='terrain',vmin=-2,vmax=14)
ax.contour(np.arange(x0,x1,20)+10,np.arange(y0,y1,20)+10,G,levels=[4,5,6,8,10],colors='k',linewidths=.4)
for n,(x,y) in {'qingnian':(300784,2768364),'machang':(301449,2768787),'huazhong':(299753,2768947),'huajiang':(299243,2770297),'zhongzheng':(302181,2767317),'baozang':(303726,2767046),'longshan':(300445,2769991)}.items():
    ax.plot(x,y,'r^'); ax.text(x,y,n,color='r')
plt.colorbar(im); ax.grid(alpha=.3); plt.savefig('overview.png',dpi=70,bbox_inches='tight')
