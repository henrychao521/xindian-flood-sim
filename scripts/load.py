import glob, numpy as np
fs=glob.glob('tpe/x/*/*.grd')
arr=[]
for f in fs:
    a=np.loadtxt(f,dtype=np.float64)
    arr.append(a)
A=np.vstack(arr); print(A.shape, A[:,0].min(),A[:,0].max(),A[:,1].min(),A[:,1].max())
np.save('pts.npy',A)
