"""Evaluated V2 pose invariants shared by preflight and independent verification."""
from array import array
import math
import bpy

EPSILON = 2e-6


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def near(a, b, tolerance=EPSILON):
    return len(a) == len(b) and all(abs(x - y) <= tolerance for x, y in zip(a, b))


def matrix_values(matrix):
    return tuple(value for row in matrix for value in row)


def set_frame(scene, frame):
    scene.frame_set(math.floor(frame), subframe=frame % 1)
    bpy.context.view_layer.update()


def action_curves(owner):
    animation = getattr(owner, 'animation_data', None)
    action = animation.action if animation else None
    if action is None:
        return []
    curves = []
    # Current Blender Actions use layers/strips/channel bags. Legacy Actions are
    # also inspectable when an archived file is opened in a later Blender.
    for layer in getattr(action, 'layers', []):
        for strip in layer.strips:
            for bag in getattr(strip, 'channelbags', []):
                curves.extend(bag.fcurves)
    if not curves:
        curves.extend(getattr(action, 'fcurves', []))
    return curves


def animation_owners(scene):
    owners = {}
    for ob in scene.objects:
        for item in (ob, ob.data):
            if item is not None and action_curves(item):
                owners[item.as_pointer()] = item
        for slot in ob.material_slots:
            if slot.material and slot.material.node_tree and action_curves(slot.material.node_tree):
                owner = slot.material.node_tree
                owners[owner.as_pointer()] = owner
    return list(owners.values())


def snapshot(scene, meshes, rigs, owners):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    geometry = {}
    for ob in meshes:
        evaluated = ob.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            vertices = array('f', [0.0]) * (len(mesh.vertices) * 3)
            mesh.vertices.foreach_get('co', vertices)
            geometry[ob.name] = (matrix_values(evaluated.matrix_world), vertices)
        finally:
            evaluated.to_mesh_clear()
    bones = {f'{rig.name}/{bone.name}': matrix_values(bone.matrix)
             for rig in rigs for bone in rig.evaluated_get(depsgraph).pose.bones}
    properties = {}
    for owner in owners:
        for curve in action_curves(owner):
            value = owner.path_resolve(curve.data_path)
            if not isinstance(value, (float, int, bool)):
                value = value[curve.array_index]
            key = (owner.as_pointer(), curve.data_path, curve.array_index)
            properties[key] = float(value)
    return {'geometry': geometry, 'bones': bones, 'properties': properties}


def mesh_equal(a, b):
    return near(a[0], b[0]) and near(a[1], b[1])


def different_meshes(a, b):
    require(a['geometry'].keys() == b['geometry'].keys(), 'Animated geometry changed its mesh membership')
    return {name for name in a['geometry'] if not mesh_equal(a['geometry'][name], b['geometry'][name])}


def assert_same_pose(a, b, label):
    moved = different_meshes(a, b)
    require(not moved, f'{label}: geometry differs in {sorted(moved)}')
    require(a['bones'].keys() == b['bones'].keys(), f'{label}: rig membership differs')
    require(all(near(a['bones'][name], b['bones'][name]) for name in a['bones']), f'{label}: rig pose differs')
    require(a['properties'].keys() == b['properties'].keys(), f'{label}: animated property membership differs')
    # A continuous mechanical rotor closes at 2*pi. Its Euler value differs by one
    # turn while its evaluated geometry and matrix above must still match exactly.
    def property_matches(name, value):
        difference = value - b['properties'][name]
        if name[1].endswith('rotation_euler'):
            difference = math.atan2(math.sin(difference), math.cos(difference))
        return abs(difference) <= EPSILON
    require(all(property_matches(name, value) for name, value in a['properties'].items()),
            f'{label}: animated property differs (including material emission)')


def hierarchy_root(mesh):
    ob = mesh
    while ob.parent is not None:
        ob = ob.parent
    return ob


def fixed_presentation(scene, root):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    camera = scene.camera
    require(camera and camera.data.type == 'ORTHO', 'Camera must be orthographic')
    require(near(camera.rotation_euler, (0, 0, 0)), 'Camera must look exactly down -Z')
    require(near(camera.location, (0, 0, 8)), 'Camera must retain the locked location')
    root_matrix = root.evaluated_get(depsgraph).matrix_world
    scale = root_matrix[0][0]
    centered_uniform = (scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1)
    require(math.isfinite(scale) and scale > 0 and near(matrix_values(root_matrix), centered_uniform),
            'Asset root must stay centered, north-facing and uniformly scaled')
    return {'root': matrix_values(root_matrix),
            'camera': matrix_values(camera.evaluated_get(depsgraph).matrix_world),
            'orthoScale': camera.data.ortho_scale,
            'lights': {ob.name: (matrix_values(ob.evaluated_get(depsgraph).matrix_world),
                                  tuple(ob.data.color), ob.data.energy, ob.data.size)
                       for ob in scene.objects if ob.type == 'LIGHT'}}


def assert_fixed_presentation(scene, root, baseline, frame):
    current = fixed_presentation(scene, root)
    require(current == baseline, f'Camera or lighting changed at timeline frame {frame}')


def assert_geometry_bounds(scene, meshes, state, frame):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    limit = scene.camera.data.ortho_scale * .48 + EPSILON
    for ob in meshes:
        matrix = ob.evaluated_get(depsgraph).matrix_world
        coords = state['geometry'][ob.name][1]
        for offset in range(0, len(coords), 3):
            x, y, z = coords[offset:offset + 3]
            wx = matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z + matrix[0][3]
            wy = matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z + matrix[1][3]
            require(abs(wx) <= limit and abs(wy) <= limit, f'Clipped evaluated mesh {ob.name} at frame {frame}')


def assert_clip_boundary(clip, clips, rest, first, last, sample):
    """sample(timeline frame) returns the same evaluated snapshot as first/last.

    Legacy starts were unconstrained (e.g. immediate mechanical recoil). Only an
    explicitly authored start=rest adds a check; start=free records the exception.
    """
    if clip.get('start') == 'rest':
        assert_same_pose(rest, first, clip['name'] + ' start at rest')
    if clip['loop']:
        closure = clip['timelineStart'] + len(clip['frames']) * 24 / clip['frameRate']
        assert_same_pose(first, sample(closure), clip['name'] + ' loop closure')
        require(bool(different_meshes(first, last)), 'Last loop sample duplicates its first pose')
    elif clip.get('end', 'rest') == 'rest':
        assert_same_pose(rest, last, clip['name'] + ' return to rest')
    elif clip.get('end') == 'free' and 'next' in clip:
        target = next(c for c in clips if c['name'] == clip['next'])
        assert_same_pose(last, sample(target['timelineStart']), clip['name'] + ' transition to ' + target['name'])


def validate_animation(scene, asset, spec, clips, frames):
    """Fail before rendering on broken boundaries, unmoving clips or moving roots."""
    meshes = [ob for ob in scene.objects if ob.type == 'MESH' and not ob.hide_render]
    rigs = [ob for ob in scene.objects if ob.type == 'ARMATURE']
    owners = animation_owners(scene)
    rigged = {ob.name for ob in meshes if any(mod.type == 'ARMATURE' and mod.object in rigs for mod in ob.modifiers)}
    if spec['category'] in ('character', 'enemy', 'boss-part'):
        require(bool(rigs) and bool(rigged), 'Animated character/enemy/boss-part requires a rig and weighted meshes')
    set_frame(scene, 0)
    baseline = fixed_presentation(scene, asset['root'])
    def sample(frame):
        set_frame(scene, frame)
        assert_fixed_presentation(scene, asset['root'], baseline, frame)
        state = snapshot(scene, meshes, rigs, owners)
        assert_geometry_bounds(scene, meshes, state, frame)
        return state
    rest = sample(0)
    moved_all = set()
    for clip in clips:
        first = sample(frames[clip['frames'][0]]['blenderFrame'])
        last = first
        moved = set()
        for index in clip['frames'][1:]:
            last = sample(frames[index]['blenderFrame'])
            moved.update(different_meshes(first, last))
        require(bool(moved), f'Clip {clip["name"]} contains no visible geometric movement')
        moved_all.update(moved)
        assert_clip_boundary(clip, clips, rest, first, last, sample)
    if rigged:
        require(rigged.issubset(moved_all), f'Saved limb meshes do not move: {sorted(rigged - moved_all)}')
    set_frame(scene, 0)


