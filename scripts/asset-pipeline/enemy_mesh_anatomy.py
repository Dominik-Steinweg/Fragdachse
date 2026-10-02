"""Explicit pilot anatomy and source-rig repair; no player/shared recipe mutations.

Archived sources use hash-bound legacy names from enemy-mesh-pilot.json. New recipe
callers can pass the same direct references. No global object-name discovery.
"""
import math
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mesh_shadow_blender import evaluated

LEGS = ('front_left', 'front_right', 'rear_left', 'rear_right')
FOLLOW_BONE = 'enemy_body_attachment'


def legacy_anatomy(scene, pilot):
    def required(name, kind):
        ob = scene.objects.get(name)
        if ob is None or ob.type != kind:
            raise ValueError('Selected source lacks declared anatomy: ' + name)
        return ob
    body = required(pilot['bodyControl'], 'EMPTY')
    rig = required(pilot['rig'], 'ARMATURE')
    cores = [required(name, 'MESH') for name in pilot['body']]
    def owned(ob):
        p = ob.parent
        while p is not None:
            if p == body: return True
            if not pilot.get('allowBodyDescendants'): break
            p = p.parent
        return False
    if any(not owned(ob) for ob in cores):
        raise ValueError('Body ownership differs from selected source')
    limbs = {}
    for name in LEGS:
        upper = required(name + pilot.get('upperSuffix', ' tapered foreleg'), 'MESH')
        foot = required(name + pilot.get('footSuffix', ' broad articulated paw'), 'MESH')
        fur = [ob for ob in scene.objects if ob.type == 'MESH'
               and ob.get(pilot['proximalProperty']) and ob.vertex_groups.get(name)]
        if len(fur) != pilot.get('proximalFurCount', 1) or name not in rig.pose.bones:
            raise ValueError('Missing/ambiguous explicitly tagged proximal fur: ' + name)
        for ob in [upper, *fur]:
            if not ob.vertex_groups.get('root') or not any(m.type == 'ARMATURE' and m.object == rig for m in ob.modifiers):
                raise ValueError('Unexpected proximal binding: ' + ob.name)
        limbs[name] = dict(upper=upper, foot=foot, fur=fur)
    return dict(body=body, rig=rig, cores=cores, limbs=limbs)


def follow_body(anatomy):
    """Retarget only pre-existing root weights of muscle/proximal fur, preserving sums.

    WORLD-space COPY_TRANSFORMS accounts for the pounce parent shared by body and
    armature. Copying body.location into the limb would double-transform the jump.
    """
    rig = anatomy['rig']
    if rig.data.bones.get(FOLLOW_BONE):
        raise ValueError('Source already repaired; use an immutable original')
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bone = rig.data.edit_bones.new(FOLLOW_BONE)
    bone.head, bone.tail = (0, 0, 0), (0, .25, 0)
    bone.parent = rig.data.edit_bones['root']
    bpy.ops.object.mode_set(mode='OBJECT')
    follow = rig.pose.bones[FOLLOW_BONE].constraints.new('COPY_TRANSFORMS')
    follow.target = anatomy['body']
    follow.owner_space = follow.target_space = 'WORLD'
    changed = []
    for name in LEGS:
        limb = anatomy['limbs'][name]
        for ob in [limb['upper'], *limb['fur']]:
            ob.vertex_groups['root'].name = FOLLOW_BONE
            ob['FD_EnemyBodyAttachment'] = name
            changed.append(ob.name)
    bpy.context.view_layer.update()
    return changed


def freeze_anchors(anatomy):
    """Freeze a body-interior and muscle-interior anchor per limb in rest pose.

    Find the closest point on a declared body core and inset towards its centroid.
    No reassignment in later poses: repaired anatomy cannot move the test corridor.
    Individual body-core identities and local coordinates are retained for audit.
    """
    inverse = anatomy['body'].matrix_world.inverted()
    cores = []
    for ob in anatomy['cores']:
        points, triangles, _ = evaluated(ob)
        cores.append((ob, points, BVHTree.FromPolygons(points.tolist(), triangles.tolist(), all_triangles=True)))
    result = {}
    for name in LEGS:
        upper = anatomy['limbs'][name]['upper']
        points, _, _ = evaluated(upper)
        center = points.mean(0)
        candidates = []
        for ob, body_points, tree in cores:
            point, normal, index, distance = tree.find_nearest(Vector(center))
            if point is not None:
                candidates.append((distance, ob, np.array(point), body_points.mean(0)))
        _, ob, surface, centroid = min(candidates, key=lambda row: row[0])
        body_point = surface * .65 + centroid * .35
        result[name] = dict(bodyCore=ob.name, bodyLocal=list(inverse @ Vector(body_point)),
                            upperVertexCount=len(points), restUpperCenter=center.tolist())
    return result


def add_transitions(scene, anatomy, anchors, samples):
    """Bake small closed muscle sleeves into the source, with fixed vertex identity.

    End rings are inside the declared body and proximal muscle. Only their short
    connecting segment is added, never a hull of feet, toes, fur or equipment.
    Absolute shape keys persist the evaluated quarter-phase motion in the Blend.
    No runtime callback or shadow-only filler is needed to render the archive.
    """
    times = sorted({0., *[s['blenderFrame'] for s in samples]})
    poses = {name: [] for name in LEGS}
    sides = 12
    faces = []
    for ring in range(2):
        for j in range(sides):
            a, b = ring*sides+j, ring*sides+(j+1)%sides
            faces.extend([(a, b, b+sides), (a, b+sides, a+sides)])
    for j in range(sides):
        faces.extend([(36, (j+1)%sides, j), (37, 24+j, 24+(j+1)%sides)])
    for frame in times:
        scene.frame_set(math.floor(frame), subframe=frame % 1)
        bpy.context.view_layer.update()
        for name in LEGS:
            start = np.array(anatomy['body'].matrix_world @ Vector(anchors[name]['bodyLocal']))
            points, _, _ = evaluated(anatomy['limbs'][name]['upper'])
            end = points.mean(0)
            axis = end-start; axis /= np.linalg.norm(axis)
            side = np.cross(axis, [0., 0., 1.])
            if np.linalg.norm(side) < .1:
                side = np.cross(axis, [0., 1., 0.])
            side /= np.linalg.norm(side); up = np.cross(axis, side)
            # A short inscribed sleeve, below the fur silhouette, not a new limb.
            radius = .12
            vertices = []
            for t in (0., .5, 1.):
                center = start*(1-t) + end*t
                for j in range(sides):
                    angle = j*2*math.pi/sides
                    vertices.append(center + radius*(math.cos(angle)*side + math.sin(angle)*up))
            poses[name].append(np.array([*vertices, start, end]))
    for name in LEGS:
        limb = anatomy['limbs'][name]
        mesh = bpy.data.meshes.new(name+' closed attachment mesh')
        mesh.from_pydata(poses[name][0].tolist(), [], faces); mesh.update()
        ob = bpy.data.objects.new(name+' closed muscle transition', mesh)
        scene.collection.objects.link(ob)
        ob['FD_EnemyTransition'] = name
        for material in limb['upper'].data.materials:
            mesh.materials.append(material)
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        for index, (frame, positions) in enumerate(zip(times, poses[name])):
            key = ob.shape_key_add(name=f'phase_{index:03d}')
            key.data.foreach_set('co', positions.ravel())
            key.interpolation = 'KEY_LINEAR'
            keys = mesh.shape_keys
            keys.use_relative = False
            keys.eval_time = key.frame
            keys.keyframe_insert('eval_time', frame=frame)
        action = keys.animation_data.action
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for point in curve.keyframe_points:
                            point.interpolation = 'LINEAR'
        limb['transition'] = ob
    scene.frame_set(0); bpy.context.view_layer.update()
    return dict(method='closed 12-sided, 3-ring source muscle sleeves; absolute quarter-phase shape keys',
                radiusBlender=.12, bakedSamples=len(times), verticesPerLeg=38,
                objects=[anatomy['limbs'][n]['transition'].name for n in LEGS])


def sample_anatomy(anatomy, anchors, scale, transitions=True):
    conversion = np.array([scale, -scale, scale])
    body = []
    for ob in anatomy['cores']:
        p, t, _ = evaluated(ob)
        body.append((p * conversion, t))
    result = {}
    for name in LEGS:
        limb = anatomy['limbs'][name]
        p, t, _ = evaluated(limb['upper'])
        if len(p) != anchors[name]['upperVertexCount']:
            raise ValueError('Anatomical vertex identity changed')
        start = np.array(anatomy['body'].matrix_world @ Vector(anchors[name]['bodyLocal'])) * conversion
        end = p.mean(0) * conversion
        surfaces = body + [(p * conversion, t)]
        if transitions and 'transition' in limb:
            bp, bt, _ = evaluated(limb['transition'])
            surfaces.append((bp * conversion, bt))
        result[name] = dict(start=start, end=end, surfaces=surfaces)
    return result


def contact_anchors(anatomy, pose, scale, rest_heights):
    feet = []
    for name in LEGS:
        points, _, _ = evaluated(anatomy['limbs'][name]['foot'])
        low = float(points[:, 2].min())
        # Contact fade is presentation metadata, never a gameplay height/grounding rule.
        lift = max(0., (low - rest_heights[name]) * scale)
        t = min(1., lift / 1.5)
        weight = 1 - t * t * (3 - 2 * t)
        point = points.mean(0) * [scale, -scale, scale]
        point[2] = low * scale
        feet.append(dict(leg=name, position=point.tolist(), groundWeight=weight))
    return dict(pose=pose, feet=feet)
