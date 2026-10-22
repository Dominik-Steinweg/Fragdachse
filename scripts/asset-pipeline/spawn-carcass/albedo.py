"""Relief test: albedo + height map of the intact carcass, cut at native resolution on the 8-cell canvas."""
import importlib.util
import os
from pathlib import Path
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[3].as_posix()
spec = importlib.util.spec_from_file_location('painted', f'{ROOT}/scripts/asset-pipeline/spawn-structure-painted.py')
painted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(painted)
OUT = f'{ROOT}/build/spawn-structure/live'
os.makedirs(OUT, exist_ok=True)

grass, magenta = tuple(int(v) for v in painted.GRASS), (255, 0, 255)
a, alpha = painted.intact_body(painted.load('concept.png', grass), painted.load('carcass-intact.png', magenta))
body = alpha > .5


def maxf(img, size):
    return np.asarray(Image.fromarray(img).filter(ImageFilter.MaxFilter(size)))


def distance(mask, steps):
    """Chamfer-like inner distance (px) by repeated erosion."""
    d = np.zeros(mask.shape, float)
    cur = Image.fromarray((mask * 255).astype('uint8'))
    for i in range(steps):
        arr = np.asarray(cur) > 127
        d += arr
        if not arr.any(): break
        cur = cur.filter(ImageFilter.MinFilter(3))
    return d


# The ribcage reads as one arched body: close the rib gaps for the base volume, the gaps stay holes.
closed = np.asarray(Image.fromarray((body * 255).astype('uint8')).filter(ImageFilter.MaxFilter(17)).filter(ImageFilter.MinFilter(17))) > 127
closed &= painted.grow(body, 9)
d = distance(closed, 90)
# Local half width: the largest distance nearby (medial radius), so every cross-section is a round tube.
R = np.asarray(Image.fromarray(np.clip(d * 2, 0, 255).astype('uint8')).filter(ImageFilter.MaxFilter(41))).astype(float) / 2
R = np.maximum(R, 1)
dd = np.minimum(d, R)
tube = np.sqrt(np.clip(dd * (2 * R - dd), 0, None))
tube = np.asarray(Image.fromarray(np.clip(tube * 2, 0, 255).astype('uint8')).filter(ImageFilter.GaussianBlur(3))).astype(float) / 2
# Painted detail as fine relief: bright bone and hide ridges up, dark cracks and holes down.
lum = a.mean(-1)
blur = np.asarray(Image.fromarray(lum.astype('uint8')).filter(ImageFilter.GaussianBlur(10))).astype(float)
detail = np.clip((lum - blur) / 60, -1, 1)
height = np.where(body, tube * .62 + detail * 7, 0)
height = np.clip(height, 0, None)

# Canvas crop (8 cells around the pivot) at native resolution: 960 px.
def crop(arr):
    half = 4 * painted.CELL
    x0, y0 = int(painted.PIVOT[0] - half), int(painted.PIVOT[1] - half)
    pad = np.zeros((960, 960) + arr.shape[2:], arr.dtype)
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(1024, x0 + 960), min(1024, y0 + 960)
    pad[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = arr[sy0:sy1, sx0:sx1]
    return pad

rgba = painted.rgba(a, alpha)
Image.fromarray(crop(rgba), 'RGBA').save(f'{OUT}/albedo.png')
h16 = crop((height / max(height.max(), 1) * 65535).astype(np.uint16))
Image.fromarray(h16).save(f'{OUT}/height.png')
Image.fromarray(crop((height / max(height.max(), 1) * 255).astype('uint8'))).save(f'{OUT}/height-preview.png')
print('max height px', round(float(height.max()), 1), 'max radius', round(float(R.max()), 1))
