import bpy, numpy as np, sys, os
src = sys.argv[sys.argv.index('--') + 1]
out = sys.argv[sys.argv.index('--') + 2]
img = bpy.data.images.load(src)
w, h = img.size
px = np.empty(w * h * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(h, w, 4)[:, :, :3]
lum = px.mean(axis=2)
print('SIZE', w, h)
for q in (50, 90, 99, 99.9, 100):
    print('Q', q, float(np.percentile(lum, q)))
# Raw float32 RGB, rows bottom-to-top as Blender stores them.
px.astype(np.float32).tofile(out)
