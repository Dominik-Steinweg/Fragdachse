"""Frame-local eye ellipses from evaluated geometry and the unchanged export camera.

Every enemy has the main pair eyeLeft/eyeRight. Additional eyes come in complete
left/right pairs (eyeExtra1Left/eyeExtra1Right, ...); they are exported in pair order
as the optional `extra` list [left 1, right 1, left 2, right 2, ...].
"""
import math
import re
import bpy
from bpy_extras.object_utils import world_to_camera_view

MAIN_EYES = ('eyeLeft', 'eyeRight')
EXTRA_EYE = re.compile(r'eyeExtra([1-9])(Left|Right)')
MAX_EXTRA_PAIRS = 3


def eye_key(side, pair=0):
    if pair == 0:
        return 'eyeLeft' if side < 0 else 'eyeRight'
    return f'eyeExtra{pair}{"Left" if side < 0 else "Right"}'


def is_eye_socket(name):
    return name in MAIN_EYES or bool(EXTRA_EYE.fullmatch(name))


def extra_pairs(names):
    """Validated extra pair numbers: complete left/right pairs numbered 1..n."""
    eyes = {name for name in names if is_eye_socket(name)}
    if not set(MAIN_EYES).issubset(eyes):
        raise ValueError('Enemy recipes must supply both direct eye mesh sockets')
    pairs = sorted({int(EXTRA_EYE.fullmatch(name).group(1)) for name in eyes - set(MAIN_EYES)})
    if pairs != list(range(1, len(pairs) + 1)) or len(pairs) > MAX_EXTRA_PAIRS:
        raise ValueError(f'Extra eye pairs must be numbered 1..n (n <= {MAX_EXTRA_PAIRS}): {pairs}')
    for pair in pairs:
        if not {eye_key(-1, pair), eye_key(1, pair)}.issubset(eyes):
            raise ValueError(f'Incomplete extra eye pair {pair}')
    return pairs


def register_eye(ctx, side, mesh, pair=0):
    """Capture the direct mesh reference at creation, before head parenting/motion.

    pair 0 is the main eyeLeft/eyeRight; pair k >= 1 adds one further left/right pair.
    """
    if type(pair) is not int or not 0 <= pair <= MAX_EXTRA_PAIRS:
        raise ValueError(f'Invalid eye pair: {pair}')
    key = eye_key(side, pair)
    if key in ctx.eye_sockets:
        raise ValueError(f'Duplicate eye socket: {key}')
    ctx.eye_sockets[key] = mesh
    mesh['eyeSocket'] = key
    return mesh


def project_eye(scene, obj):
    graph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(graph)
    mesh = evaluated.to_mesh()
    try:
        points = []
        for vertex in mesh.vertices:
            p = world_to_camera_view(scene, scene.camera, evaluated.matrix_world @ vertex.co)
            points.append((p.x, 1 - p.y))
        if not points:
            raise ValueError('Eye socket has no evaluated surface')
        x = sum(p[0] for p in points) / len(points)
        y = sum(p[1] for p in points) / len(points)
        xx = sum((p[0]-x)**2 for p in points)
        yy = sum((p[1]-y)**2 for p in points)
        xy = sum((p[0]-x)*(p[1]-y) for p in points)
        angle = .5 * math.atan2(2*xy, xx-yy)
        co, si = math.cos(angle), math.sin(angle)
        u = [(px-x)*co+(py-y)*si for px, py in points]
        v = [-(px-x)*si+(py-y)*co for px, py in points]
        width, height = max(u)-min(u), max(v)-min(v)
        if not (0 < x < 1 and 0 < y < 1 and 0 < width < .25 and 0 < height < .25):
            raise ValueError(f'Eye outside export canvas: {obj.name}')
        return dict(x=round(x, 8), y=round(y, 8), width=round(width, 8),
                    height=round(height, 8), rotation=round(angle, 8))
    finally:
        evaluated.to_mesh_clear()


def sample_eyes(scene, sockets):
    camera = scene.camera
    if camera.data.type != 'ORTHO' or any(abs(a) > 1e-7 for a in camera.rotation_euler):
        raise ValueError('Eye anchors require the orthographic top-down export camera')
    frame = {side: project_eye(scene, sockets[key])
             for side, key in [('left', 'eyeLeft'), ('right', 'eyeRight')]}
    extra = [project_eye(scene, sockets[eye_key(side, pair)])
             for pair in extra_pairs(sockets) for side in (-1, 1)]
    if extra:
        frame['extra'] = extra
    return frame
