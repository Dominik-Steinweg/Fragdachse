"""Pure NumPy geometry/scene selection contracts, testable without importing Blender."""
import json
import numpy as np

# Double area / longest edge squared. Relative to each triangle, not asset size:
# a tiny bevel can be perfectly well conditioned. BVH coordinates use float32.
MIN_TRIANGLE_QUALITY = 1e-7


def clean_triangles(points, triangles):
    points = np.asarray(points, dtype=np.float64)
    triangles = np.asarray(triangles, dtype=np.int32).reshape(-1, 3)
    if points.ndim != 2 or points.shape[1] != 3 or not np.isfinite(points).all():
        raise ValueError('Nonfinite or invalid source positions')
    if triangles.size and (triangles.min() < 0 or triangles.max() >= len(points)):
        raise ValueError('Triangle index outside source vertices')
    abc = points[triangles]
    ab, ac, bc = abc[:, 1]-abc[:, 0], abc[:, 2]-abc[:, 0], abc[:, 2]-abc[:, 1]
    scale = np.sqrt(np.maximum.reduce([np.sum(e*e, axis=1) for e in [ab, ac, bc]]))
    safe = np.where(scale > 0, scale, 1)
    quality = np.linalg.norm(np.cross(ab/safe[:, None], ac/safe[:, None]), axis=1)
    valid = (scale > 0) & (quality > MIN_TRIANGLE_QUALITY)
    kept = triangles[valid]
    # Drop repeated faces, including reversed winding, but NEVER weld source vertices:
    # coincident rest vertices may have different skinning and must retain identity.
    _, first = np.unique(np.sort(kept, axis=1), axis=0, return_index=True)
    result = kept[np.sort(first)]
    return result, dict(inputTriangles=len(triangles), degenerateTriangles=int((~valid).sum()),
                        duplicateTriangles=len(kept)-len(result), outputTriangles=len(result))


def triangle_binding(point, triangle):
    """Nearest point weights in float64; normalized cross products avoid Gram cancellation.

    BVH chooses a cleaned source triangle. Recompute the closest point here instead
    of trusting its rounded float32 hit position. Outside hits use the nearest edge.
    """
    triangle = np.asarray(triangle, dtype=np.float64)
    point = np.asarray(point, dtype=np.float64)
    if triangle.shape != (3, 3) or point.shape != (3,) or not np.isfinite(triangle).all() or not np.isfinite(point).all():
        raise ValueError('Invalid binding geometry')
    a, b, c = triangle
    scale = max(np.linalg.norm(b-a), np.linalg.norm(c-a), np.linalg.norm(c-b))
    if scale == 0:
        raise ValueError('Binding triangle has no extent')
    ab, ac, ap = (b-a)/scale, (c-a)/scale, (point-a)/scale
    normal = np.cross(ab, ac)
    squared_area = float(np.dot(normal, normal))
    if squared_area <= MIN_TRIANGLE_QUALITY**2:
        raise ValueError('Binding triangle below relative quality threshold')
    u = np.dot(np.cross(ap, ac), normal)/squared_area
    v = np.dot(np.cross(ab, ap), normal)/squared_area
    weights = np.array([1-u-v, u, v])
    if np.any(weights < 0):
        # Convex triangle: an exterior closest point lies on an edge or endpoint.
        candidates = []
        for i, j in [(0, 1), (1, 2), (2, 0)]:
            edge = (triangle[j]-triangle[i])/scale
            t = np.clip(np.dot((point-triangle[i])/scale, edge)/np.dot(edge, edge), 0, 1)
            w = np.zeros(3); w[i], w[j] = 1-t, t
            distance = np.linalg.norm((w @ triangle-point)/scale)
            candidates.append((distance, w))
        weights = min(candidates, key=lambda item: item[0])[1]
    weights /= weights.sum()
    if not np.isfinite(weights).all():
        raise ValueError('Nonfinite binding weights')
    return weights, float(np.linalg.norm(weights @ triangle-point))


def select_source_scene(scenes, input_hash, asset_id):
    matches = [s for s in scenes if s.get('inputHash') == input_hash and s.get('asset_manifest')]
    if len(matches) != 1:
        raise ValueError('Missing unique selected source scene')
    scene = matches[0]
    if json.loads(scene['asset_manifest']).get('id') != asset_id:
        raise ValueError('Selected source scene has wrong asset id')
    return scene
