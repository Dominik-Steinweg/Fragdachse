"""Static weapon silhouette policy and software QA. NumPy only; no bpy or rendering."""
import math
import struct
import zlib
import time
import traceback
import numpy as np

DENSITY = 3
MIN_IOU = .95
EDGE_TOLERANCE_PIXELS = 2
VIEWS = [(0., 90.)] + [(a * 22.5, e) for e in (28., 35., 45.) for a in range(16)]


def weapon_budget(points):
    size = float(np.ptp(points, axis=0).max())
    maximum = min(1600, max(600, math.ceil((300 + 24 * size) / 100) * 100))
    return dict(policy='held-adaptive-v3', sizeWorld=size, baseVertices=maximum, maxVertices=1600, maxTriangles=3200)


def weapon_candidate_plan(budget):
    base, maximum = budget['baseVertices'], budget['maxVertices']
    plan = [dict(voxelWorld=v, vertexLimit=base, fractions=(.55, .8, 1.)) for v in (.20, .12, .075)]
    if base < maximum:
        plan.append(dict(voxelWorld=.075, vertexLimit=maximum, fractions=(.7, .9, 1.)))
    plan.extend(dict(voxelWorld=v, vertexLimit=maximum, fractions=(.7, .9, 1.)) for v in (.05, .035))
    return plan


def evaluate_weapon_batch(weapons, export_one, record=lambda row: None):
    """Finish every recoverable asset job before rejecting an incomplete production."""
    meshes, rows = [], []
    ids = [w['render']['id'] for w in weapons]
    if not ids or len(set(ids)) != len(ids):
        raise ValueError('Empty or duplicate weapon batch')
    for weapon in weapons:
        started = time.monotonic()
        row = dict(asset=weapon['render']['id'])
        try:
            mesh = export_one(weapon)
            if mesh['id'] != row['asset']:
                raise ValueError('Export returned another weapon')
            row.update(status='passed', vertices=mesh['vertexCount'], triangles=mesh['triangleCount'],
                       qualityReport=mesh['audit']['qualityReport'])
            meshes.append(mesh)
        except Exception as error:
            row.update(status='failed', error=str(error), errorType=type(error).__name__, traceback=traceback.format_exc())
        row['seconds'] = time.monotonic()-started
        rows.append(row)
        record(row)
    return meshes, dict(schema='fd-weapon-batch', version=1, expectedIds=ids, evaluated=len(rows),
                        passed=sum(r['status']=='passed' for r in rows), failed=sum(r['status']=='failed' for r in rows), rows=rows)


def project(points, azimuth, elevation):
    # Grip-local Z can be negative. The hand is above the ground: its common
    # projected translation cancels from the source/proxy comparison.
    a, e = math.radians(azimuth), math.radians(elevation)
    return points[:, :2] - points[:, 2, None] * np.array([math.cos(a), math.sin(a)]) / math.tan(e)


def raster(points, triangles, bounds, density=DENSITY):
    lo, hi = np.array(bounds[:2]), np.array(bounds[2:])
    w, h = np.ceil((hi-lo)*density).astype(int)
    if np.any(points < lo) or np.any(points > hi):
        raise ValueError('Weapon quality canvas clips geometry')
    out = np.zeros((h, w), bool)
    xy = (points-lo)*density
    for t in xy[triangles]:
        ab, ac = t[1]-t[0], t[2]-t[0]
        area = ab[0]*ac[1]-ab[1]*ac[0]
        if abs(area) < 1e-9:
            continue
        lower = np.maximum(0, np.floor(t.min(0)).astype(int))
        upper = np.minimum([w-1, h-1], np.ceil(t.max(0)).astype(int))
        if np.any(upper < lower):
            continue
        x, y = np.meshgrid(np.arange(lower[0], upper[0]+1)+.5, np.arange(lower[1], upper[1]+1)+.5)
        inside = np.ones(x.shape, bool)
        for j in range(3):
            a, b = t[j], t[(j+1) % 3]
            inside &= ((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]))*np.sign(area) >= -1e-9
        out[lower[1]:upper[1]+1, lower[0]:upper[0]+1] |= inside
    return out


def dilate(mask, radius=EDGE_TOLERANCE_PIXELS):
    h, w = mask.shape
    padded = np.pad(mask, radius)
    out = np.zeros_like(mask)
    for y in range(radius*2+1):
        for x in range(radius*2+1):
            out |= padded[y:y+h, x:x+w]
    return out


def reference_views(points, triangles):
    views = []
    for azimuth, elevation in VIEWS:
        xy = project(points, azimuth, elevation)
        bounds = np.r_[np.floor(xy.min(0))-2, np.ceil(xy.max(0))+2].tolist()
        mask = raster(xy, triangles, bounds)
        views.append(dict(azimuth=azimuth, elevation=elevation, bounds=bounds, mask=mask, dilated=dilate(mask)))
    return views


def compare_views(points, triangles, references):
    rows, masks = [], []
    for ref in references:
        mask = raster(project(points, ref['azimuth'], ref['elevation']), triangles, ref['bounds'])
        source = ref['mask']
        union = int(np.count_nonzero(source | mask))
        if not union:
            raise ValueError('Empty weapon silhouette')
        iou = float(np.count_nonzero(source & mask) / union)
        missed = int(np.count_nonzero(source & ~dilate(mask)))
        extra = int(np.count_nonzero(mask & ~ref['dilated']))
        rows.append(dict(azimuth=ref['azimuth'], elevation=ref['elevation'], iou=iou,
                         missingBeyondTolerancePixels=missed, extraBeyondTolerancePixels=extra,
                         sourceAreaWorld2=float(source.sum()/DENSITY**2)))
        masks.append(mask)
    return dict(passed=all(r['iou'] >= MIN_IOU and not r['missingBeyondTolerancePixels'] and not r['extraBeyondTolerancePixels'] for r in rows),
                minimumIou=min(r['iou'] for r in rows), rows=rows), masks


def quantized_roundtrip(points):
    lo, hi = points.min(0), points.max(0)
    span = np.where(hi > lo, hi-lo, 1)
    return lo + np.rint((points-lo)/span*65535).clip(0, 65535)/65535*(hi-lo)


def silhouette_sheet(references, masks):
    columns, header = 7, 22
    width = max(m.shape[1] for m in masks) + 8
    height = max(m.shape[0] for m in masks) + header + 8
    pixels = np.full((math.ceil(len(masks)/columns)*height, columns*width, 3), 30, np.uint8)
    for i, (ref, mask) in enumerate(zip(references, masks)):
        y, x = i//columns*height+header+4, i % columns*width+4
        tile = pixels[y:y+mask.shape[0], x:x+mask.shape[1]]
        tile[ref['mask'] & mask] = [220, 220, 220]
        tile[ref['mask'] & ~mask] = [255, 75, 60]
        tile[mask & ~ref['mask']] = [0, 220, 230]
    def chunk(name, data):
        return struct.pack('>I', len(data))+name+data+struct.pack('>I', zlib.crc32(name+data) & 0xffffffff)
    h, w, _ = pixels.shape
    scanlines = b''.join(b'\0'+row.tobytes() for row in pixels)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(scanlines)) + chunk(b'IEND', b''))
    return png, dict(columns=columns, cellWidth=width, cellHeight=height, width=w, height=h)
