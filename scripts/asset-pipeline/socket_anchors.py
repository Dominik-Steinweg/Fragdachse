"""Object-origin sockets in normalized, untrimmed canvas space (Y down), plus world Z."""
import math

import bpy
from bpy_extras.object_utils import world_to_camera_view
from eye_anchors import is_eye_socket


EYE_SOCKETS = {'eyeLeft', 'eyeRight'}  # main pair; extra eye pairs are excluded via is_eye_socket


def sample_sockets(scene, sockets):
    camera = scene.camera
    if camera.data.type != 'ORTHO' or any(abs(a) > 1e-7 for a in camera.rotation_euler):
        raise ValueError('Sockets require the orthographic top-down export camera')
    graph = bpy.context.evaluated_depsgraph_get()
    result = {}
    for name, obj in sockets.items():
        if is_eye_socket(name):
            continue
        world = obj.evaluated_get(graph).matrix_world.translation
        projected = world_to_camera_view(scene, camera, world)
        x, y, z = projected.x, 1 - projected.y, world.z
        if not all(math.isfinite(v) for v in (x, y, z)) or not (0 <= x <= 1 and 0 <= y <= 1):
            raise ValueError(f'Socket outside export canvas: {name}: {(x, y, z)}')
        result[name] = dict(x=round(x, 8), y=round(y, 8), z=round(z, 8))
    return result


def validate_socket_frames(frames, count, required=()):
    if not isinstance(frames, list) or len(frames) != count or not frames:
        raise ValueError('Socket frame count mismatch')
    names = set(frames[0])
    if not set(required).issubset(names) or any(is_eye_socket(name) for name in names):
        raise ValueError('Missing required sockets or eye sockets in generic output')
    for frame in frames:
        if set(frame) != names:
            raise ValueError('Socket names differ between frames')
        for name, point in frame.items():
            if (not isinstance(name, str) or not name or set(point) != {'x', 'y', 'z'}
                    or any(type(v) not in (int, float) or not math.isfinite(v) for v in point.values())
                    or not (0 <= point['x'] <= 1 and 0 <= point['y'] <= 1)):
                raise ValueError(f'Invalid socket point: {name}')
