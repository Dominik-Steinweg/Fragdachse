"""Hitbox coverage of a rendered south building frame: per template cell bone coverage and an overlay image.
    python -I scripts/asset-pipeline/spawn-carcass/hitbox_check.py <frame.png> <overlay.png>

The template mirrors SOUTH_BODY in src/config/spawnStructure.ts (and BODY in carcass.py)."""
import sys
import numpy as np
from PIL import Image, ImageDraw
fr = Image.open(sys.argv[1]).convert('RGBA').resize((432, 432), Image.LANCZOS)
a = np.array(fr)[..., 3].astype(float) / 255
cell = 432 / 9
BODY = ['.####.', '######', '##...#', '#...##', '#...##', '....#.']
offx, offy = 1.5, 1.0
inside, outside = [], 0.0
np.set_printoptions(precision=2, suppress=True, linewidth=160)
cov = np.zeros((8, 8))
for ty in range(-1, 7):
    for tx in range(-1, 7):
        x0, y0 = int(round((tx + offx) * cell)), int(round((ty + offy) * cell))
        x1, y1 = int(round((tx + 1 + offx) * cell)), int(round((ty + 1 + offy) * cell))
        cov[ty + 1, tx + 1] = (a[y0:y1, x0:x1] > 0.5).mean()
print(cov)
body = np.zeros_like(a, bool)
for gy, row in enumerate(BODY):
    for gx, m in enumerate(row):
        if m == '#':
            body[int(round((gy + offy) * cell)):int(round((gy + 1 + offy) * cell)), int(round((gx + offx) * cell)):int(round((gx + 1 + offx) * cell))] = True
solid = a > 0.5
print('bone px outside hitbox: %.1f%%' % (100 * (solid & ~body).sum() / solid.sum()))
print('min coverage of a hitbox cell: %.2f' % min(cov[gy + 1, gx + 1] for gy, row in enumerate(BODY) for gx, m in enumerate(row) if m == '#'))
big = fr.resize((864, 864), Image.LANCZOS)
bg = Image.new('RGBA', big.size, (62, 78, 52, 255)); bg.alpha_composite(big)
dr = ImageDraw.Draw(bg, 'RGBA'); c2 = 864 / 9
for gy, row in enumerate(BODY):
    for gx, m in enumerate(row):
        x, y = (gx + offx) * c2, (gy + offy) * c2
        if m == '#': dr.rectangle([x + 2, y + 2, x + c2 - 2, y + c2 - 2], outline=(255, 60, 60, 230), width=3)
x, y = (2 + offx) * c2, (2 + offy) * c2; dr.rectangle([x, y, x + 2 * c2, y + 3 * c2], outline=(80, 200, 255, 200), width=3)
bg.save(sys.argv[2])
