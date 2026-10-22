"""Trace the painted carcass into 3D construction data: body centreline + radii, spine band, ribs."""
import importlib.util
import os
from pathlib import Path
import json
import math
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


def morph(mask, size, op):
    f = ImageFilter.MaxFilter(size) if op == 'max' else ImageFilter.MinFilter(size)
    return np.asarray(Image.fromarray((mask * 255).astype('uint8')).filter(f)) > 127


closed = morph(morph(body, 17, 'max'), 17, 'min')
# Solid outline without the spikes and ragged flaps: they stay painted on the ground skirt.
solid = morph(morph(closed, 13, 'min'), 13, 'max')
CX, CY = 542.0, 483.0
PX, PY = painted.PIVOT
CELL = painted.CELL


def bu(x, y):
    return round((x - PX) / CELL, 4), round(-(y - PY) / CELL, 4)


def sample(mask, x, y):
    xi, yi = int(round(x)), int(round(y))
    return 0 <= xi < 1024 and 0 <= yi < 1024 and mask[yi, xi]


# The open ribcage only spans the back of the curl (image angles, y down); holes in the arms are no ribs.
RIBCAGE_DEG = (195, 345)
rays = []
for step in range(720):
    theta = math.radians(step / 2)
    dx, dy = math.cos(theta), math.sin(theta)
    rs = np.arange(40, 520)
    on_solid = np.array([sample(solid, CX + dx * r, CY + dy * r) for r in rs])
    on_body = np.array([sample(body, CX + dx * r, CY + dy * r) for r in rs])
    if not on_solid.any():
        rays.append(None)
        continue
    idx = np.nonzero(on_solid)[0]
    r_in, r_out = rs[idx[0]], rs[idx[-1]]
    deg = step / 2
    # Weight of the open ribcage, ramped over 15 degrees at both ends of its range.
    w = min(1.0, max(0.0, (deg - RIBCAGE_DEG[0]) / 15), max(0.0, (RIBCAGE_DEG[1] - deg) / 15))
    w = w * w * (3 - 2 * w)
    # Over the ribcage only the spine band along the outer edge stays solid: about a third of the body.
    r_band = r_in + w * 0.66 * (r_out - r_in)
    # Ribs: from the outer edge inward, the solid hide ends at the first real gap between them.
    r_gap = 0
    if w > 0:
        gap = 0
        for r in range(r_out, r_in - 1, -1):
            if not sample(body, CX + dx * r, CY + dy * r):
                gap += 1
                if gap >= 4: r_gap = r + gap; break
            else:
                gap = 0
    rays.append({'theta': theta, 'r_in': int(r_in), 'r_out': int(r_out), 'r_band': float(r_band), 'r_gap': int(r_gap), 'cage': w})

# The opening: the longest run of empty rays. The body runs from just after it, all the way round.
empty = [r is None for r in rays]
best, best_start, run, start = 0, 0, 0, 0
for i in range(1440):
    if empty[i % 720]:
        if run == 0: start = i
        run += 1
        if run > best: best, best_start = run, start
    else:
        run = 0
first = (best_start + best) % 720
ordered = [rays[(first + k) % 720] for k in range(720 - best)]
ordered = [r for r in ordered if r is not None]

centre, ribcage = [], []
for r in ordered:
    inner = r['r_band']
    mid = (inner + r['r_out']) / 2
    half = (r['r_out'] - inner) / 2
    x, y = CX + math.cos(r['theta']) * mid, CY + math.sin(r['theta']) * mid
    centre.append({'p': bu(x, y), 'r': round(half / CELL, 4), 'cage': round(r['cage'], 3),
                   'full_r': round((r['r_out'] - r['r_in']) / 2 / CELL, 4)})

# Ribs: body pixels inside the closed outline but inward of the solid spine band.
band = np.zeros(body.shape, bool)
yy, xx = np.mgrid[0:1024, 0:1024]
ang = (np.degrees(np.arctan2(yy - CY, xx - CX)) % 360 * 2).astype(int) % 720
rad = np.hypot(xx - CX, yy - CY)
band_r = np.array([(r['r_gap'] if r and r['cage'] > .5 and r['r_gap'] - r['r_in'] > 14 else 0) for r in rays])
in_rib_zone = (band_r[ang] > 0) & (rad < band_r[ang] - 3) & body & closed
labels = np.zeros(body.shape, int)
ribs = []
seen = np.zeros(body.shape, bool)
for y0, x0 in zip(*np.nonzero(in_rib_zone)):
    if seen[y0, x0]: continue
    part = painted.flood(in_rib_zone & ~seen, [(x0, y0)])
    seen |= part
    n = int(part.sum())
    if n < 120: continue
    py, px = np.nonzero(part)
    pts = np.stack([px, py], 1).astype(float)
    mean = pts.mean(0)
    cov = np.cov((pts - mean).T)
    w, v = np.linalg.eigh(cov)
    axis = v[:, 1]
    proj = (pts - mean) @ axis
    p0, p1 = mean + axis * proj.min(), mean + axis * proj.max()
    length = proj.max() - proj.min()
    if length < 25: continue
    # Outer end = farther from the ring centre (the spine side).
    if math.hypot(*(p0 - [CX, CY])) < math.hypot(*(p1 - [CX, CY])): p0, p1 = p1, p0
    ribs.append({'outer': bu(*p0), 'inner': bu(*p1), 'width': round(n / length / CELL, 4), 'length': round(length / CELL, 3)})

# One rib can fall apart into two parallel pieces: keep the longest of near-coincident lines.
def line_distance(rib, other):
    (ox, oy), (ix, iy) = other['outer'], other['inner']
    mx, my = [(rib['outer'][k] + rib['inner'][k]) / 2 for k in (0, 1)]
    vx, vy = ix - ox, iy - oy
    t = max(0, min(1, ((mx - ox) * vx + (my - oy) * vy) / (vx * vx + vy * vy)))
    return math.hypot(mx - ox - vx * t, my - oy - vy * t)
kept = []
for rib in sorted(ribs, key=lambda r: -r['length']):
    if all(line_distance(rib, other) > .1 for other in kept): kept.append(rib)
ribs = kept

# Ground skirt: everything painted outside the solid body and the ribs (spikes, flaps, fringe).
cage_w = np.array([(r['cage'] if r else 0) for r in rays])
# The painted spikes beyond the spine are the outer ribs, now modelled: keep them off the ground.
outer_cage = (cage_w[ang] > .3) & (rad > np.array([(r['r_band'] if r else 0) for r in rays])[ang])
skirt = body & ~painted.grow(solid, -2) & ~painted.grow(in_rib_zone, 2) & (a.mean(-1) > 75) & ~outer_cage
skirt_rgba = painted.rgba(a, np.where(skirt, alpha, 0))
half = 4 * CELL
x0, y0 = int(PX - half), int(PY - half)
canvas = Image.new('RGBA', (960, 960), (0, 0, 0, 0))
canvas.paste(Image.fromarray(skirt_rgba, 'RGBA'), (-x0, -y0))
canvas.save(f'{OUT}/skirt.png')

json.dump({'centre': centre, 'ribs': ribs, 'cell': CELL}, open(f'{OUT}/trace.json', 'w'), indent=1)

# Debug overlay: centreline, band and ribs on the painting.
dbg = Image.fromarray(painted.rgba(a, alpha)).convert('RGB')
from PIL import ImageDraw
d = ImageDraw.Draw(dbg)
for c in centre:
    x, y = c['p'][0] * CELL + PX, -c['p'][1] * CELL + PY
    d.ellipse((x - 1, y - 1, x + 1, y + 1), fill=(255, int(255 * (1 - c['cage'])), 0))
for rib in ribs:
    (ox, oy), (ix, iy) = rib['outer'], rib['inner']
    d.line((ox * CELL + PX, -oy * CELL + PY, ix * CELL + PX, -iy * CELL + PY), fill=(255, 255, 0), width=2)
dbg.save(f'{OUT}/trace-debug.png')
print('centre points', len(centre), 'ribcage points', sum(c['cage'] > .5 for c in centre), 'ribs', len(ribs))
