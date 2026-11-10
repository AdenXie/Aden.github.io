# Run in Blender (it reads OpenEXR):
#   blender -b --factory-startup --python tools/sky-exr-to-raw.py -- <in.exr> <out.f32> [lat_min lat_max]
# Writes raw float32 RGB, rows bottom-to-top as Blender stores them. With a latitude
# range (degrees) only those rows are kept, e.g. the Milky Way band of a galactic map.
import bpy, numpy as np, sys
args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
img = bpy.data.images.load(src)
w, h = img.size
px = np.empty(w * h * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(h, w, 4)[:, :, :3]
if len(args) >= 4:
    lo, hi = (round((float(v) + 90) / 180 * h) for v in args[2:4])
    px = px[lo:hi]
print('SIZE', w, px.shape[0])
lum = px.mean(axis=2)
for q in (50, 90, 99, 99.9, 100):
    print('Q', q, float(np.percentile(lum, q)))
np.ascontiguousarray(px, dtype=np.float32).tofile(out)
