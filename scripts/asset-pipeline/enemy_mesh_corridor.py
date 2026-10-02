"""Analytic triangle-union coverage in a narrow, anatomically authored corridor.

NumPy only, independent of Blender. Open gaps are measured without flood filling or
closing the silhouette. Other limbs, equipment and fur cannot hide a missing core.
"""
import math
import numpy as np

VIEWS = [(a * 22.5, e) for e in (20, 28, 35, 45, 60) for a in range(16)] + [(0., 90.)]


def project(points, azimuth, elevation):
    if not 0 < elevation <= 90:
        raise ValueError('Sun must be above horizon')
    a, e = math.radians(azimuth), math.radians(elevation)
    points = np.asarray(points)
    return points[..., :2] - np.maximum(points[..., 2:3], 0) * np.array([math.cos(a), math.sin(a)]) / math.tan(e)


def merge_intervals(intervals):
    merged = []
    for lo, hi in sorted(intervals):
        if hi < lo:
            continue
        if merged and lo <= merged[-1][1] + 1e-8:
            merged[-1][1] = max(hi, merged[-1][1])
        else:
            merged.append([float(lo), float(hi)])
    return merged


def segment_coverage(start, end, triangles):
    """Exact parameter intervals covered by projected triangles, winding independent."""
    start, end, triangles = np.asarray(start), np.asarray(end), np.asarray(triangles)
    if not len(triangles):
        return []
    edge = np.roll(triangles, -1, axis=1) - triangles
    area = edge[:, 0, 0] * -edge[:, 2, 1] - edge[:, 0, 1] * -edge[:, 2, 0]
    valid = np.abs(area) > 1e-10
    sign = np.sign(area)[:, None]
    delta = start - triangles
    c = (edge[:, :, 0] * delta[:, :, 1] - edge[:, :, 1] * delta[:, :, 0]) * sign
    direction = end - start
    d = (edge[:, :, 0] * direction[1] - edge[:, :, 1] * direction[0]) * sign
    parallel = np.abs(d) < 1e-12
    valid &= ~np.any(parallel & (c < -1e-9), axis=1)
    cuts = -c / np.where(parallel, 1., d)
    lo = np.maximum(0., np.max(np.where(d > 1e-12, cuts, -np.inf), axis=1))
    hi = np.minimum(1., np.min(np.where(d < -1e-12, cuts, np.inf), axis=1))
    valid &= hi >= lo
    return merge_intervals(zip(lo[valid], hi[valid]))


def missing_intervals(covered):
    missing, last = [], 0.
    for lo, hi in covered:
        if lo > last:
            missing.append([last, lo])
        last = max(last, hi)
    if last < 1:
        missing.append([last, 1.])
    return missing


def corridor_metric(start, end, surfaces, azimuth, elevation, width=.5, cache=None):
    """Five parallel probes across a 0.5-world-pixel corridor, frozen for A/B.

    The centreline controls attachment acceptance. Side probes report area only;
    naturally tapering anatomy must not fail just because a wide strip leaves skin.
    """
    ends = project(np.array([start, end]), azimuth, elevation)
    direction = ends[1] - ends[0]
    length = float(np.linalg.norm(direction))
    if length < 1e-8:
        return dict(maxGapWorld=0., missingAreaWorld2=0., endpointsCovered=True)
    side = np.array([-direction[1], direction[0]]) / length
    def projected_surface(p, t):
        key = (id(p), id(t), azimuth, elevation)
        if cache is None:
            return project(p, azimuth, elevation)[t]
        if key not in cache:
            triangles = project(p, azimuth, elevation)[t]
            cache[key] = (triangles, triangles.min(1), triangles.max(1))
        return cache[key]
    lower, upper = ends.min(0) - width / 2, ends.max(0) + width / 2
    selected = []
    for p, t in surfaces:
        value = projected_surface(p, t)
        triangles, low, high = value if cache is not None else (value, value.min(1), value.max(1))
        selected.append(triangles[np.all(high >= lower, axis=1) & np.all(low <= upper, axis=1)])
    projected = np.concatenate(selected)
    rows = []
    for offset in np.linspace(-width / 2, width / 2, 5):
        coverage = segment_coverage(ends[0] + side * offset, ends[1] + side * offset, projected)
        missing = missing_intervals(coverage)
        rows.append(dict(covered=coverage, missing=missing, total=sum(b-a for a, b in missing) * length))
    center = rows[2]
    return dict(maxGapWorld=float(max((b-a for a, b in center['missing']), default=0.) * length),
                missingAreaWorld2=float(np.mean([r['total'] for r in rows]) * width),
                endpointsCovered=bool(center['covered'] and center['covered'][0][0] <= 1e-7
                                      and center['covered'][-1][1] >= 1-1e-7))


def compare_sample(before, after, views=VIEWS):
    if set(before) != set(after) or len(before) != 4:
        raise ValueError('Expected four explicit anatomical corridors')
    rows = []
    for azimuth, elevation in views:
        cache = {}
        for leg, original in before.items():
            # Same BEFORE anchors for both: no repaired-surface nearest-point search.
            args = original['start'], original['end']
            old = corridor_metric(*args, original['surfaces'], azimuth, elevation, cache=cache)
            new = corridor_metric(*args, after[leg]['surfaces'], azimuth, elevation, cache=cache)
            rows.append(dict(leg=leg, azimuth=azimuth, elevation=elevation, before=old, after=new,
                             flaggedBefore=old['maxGapWorld'] > .25,
                             flaggedAfter=new['maxGapWorld'] > .25))
    return rows
