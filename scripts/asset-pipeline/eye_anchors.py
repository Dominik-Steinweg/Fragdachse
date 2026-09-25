"""Frame-local eye ellipses from evaluated geometry and the unchanged export camera."""
import math
import bpy
from bpy_extras.object_utils import world_to_camera_view


def register_eye(ctx, side, mesh):
    """Capture the direct mesh reference at creation, before head parenting/motion."""
    key = 'eyeLeft' if side < 0 else 'eyeRight'
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
    return {side: project_eye(scene, sockets[key])
            for side, key in [('left', 'eyeLeft'), ('right', 'eyeRight')]}
