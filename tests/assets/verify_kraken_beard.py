"""Saved-Blender beard contract, shared by the anatomy verifier and local pose review.

Run: blender -b preview.blend --python-exit-code 1 --python this.py -- --report new.json
Does not save or modify the source blend. Tests actual evaluated deformation.
"""
import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import sys
sys.dont_write_bytecode = True
import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/asset-pipeline'))
from kraken_motion_v2 import key_arms
from pose_validation_v2 import action_curves


def positions(ob, deps):
    evaluated = ob.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    try:
        return [evaluated.matrix_world @ v.co for v in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def geometry_signature(ob, deps):
    evaluated = ob.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    try:
        coordinates = array('f', [0]) * (3 * len(mesh.vertices))
        mesh.vertices.foreach_get('co', coordinates)
        return (tuple(v for row in evaluated.matrix_world for v in row),
                hashlib.sha256(coordinates.tobytes()).hexdigest())
    finally:
        evaluated.to_mesh_clear()


def verify_neutral_clip_skin(scene, skin, asset, assign):
    """Body breathing/transforms must remain identical with a neutral beard."""
    modifier = next(m for m in skin.modifiers if m.type == 'ARMATURE')
    deps = bpy.context.evaluated_depsgraph_get()
    def coordinates():
        evaluated = skin.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            data = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
            mesh.vertices.foreach_get('co', data)
            return data
        finally:
            evaluated.to_mesh_clear()
    maximum, samples = 0, 0
    try:
        for clip in json.loads(scene['asset_clips']):
            count = len(clip['frames'])
            for index in sorted({0, count // 2, count - 1}):
                frame = clip['timelineStart'] + index * 24 / clip['frameRate']
                scene.frame_set(math.floor(frame), subframe=frame % 1)
                key_arms(asset, frame, assign, None)
                bpy.context.view_layer.update()
                bound = coordinates()
                modifier.show_viewport = False
                bpy.context.view_layer.update()
                unbound = coordinates()
                modifier.show_viewport = True
                bpy.context.view_layer.update()
                error = float(np.max(np.abs(bound - unbound)))
                assert error == 0, f'Neutral beard changes {clip["name"]} skin: {error}'
                maximum = max(maximum, error)
                samples += 1
    finally:
        modifier.show_viewport = True
        scene.frame_set(0)
        bpy.context.view_layer.update()
    return {'sampledPoses': samples, 'maxCoordinateError': maximum}


def verify_beard(scene):
    scene.frame_set(0)
    skin = next(o for o in scene.objects if o.get('anatomyRole') == 'mantle')
    rig = skin.get('beardRig')
    assert rig and rig.type == 'ARMATURE', 'Fused skin must bind its explicit beard rig'
    chains = json.loads(rig['beardChains'])
    lines = json.loads(rig['beardLines'])
    assert len(chains) == len(lines) == 10, 'Expected ten oral chains'
    assert len({n for c in chains for n in c}) == sum(map(len, chains))
    roots = []
    for chain, line in zip(chains, lines):
        assert 4 <= len(chain) <= 6
        previous = rig.data.bones['root']
        for j, name in enumerate(chain):
            bone = rig.data.bones[name]
            assert bone.parent == previous and bone.use_deform
            assert bone.use_connect == (j > 0)
            assert bone.z_axis.z > 0, 'Roll must preserve dorsal +Z'
            assert (bone.head_local - Vector(line[round(j * (len(line) - 1) / len(chain))][0])).length < 1e-5
            previous = bone
        roots.append(rig.data.bones[chain[0]].head_local.x)
    assert roots == sorted(roots) and roots[4] < 0 < roots[5]
    modifiers = [m for m in skin.modifiers if m.type == 'ARMATURE']
    assert len(modifiers) == 1 and modifiers[0].object == rig
    assert skin.modifiers[-1] == modifiers[0], 'Rest displacement must precede deformation'
    bone_names = {n for chain in chains for n in chain}
    deform = bone_names | {'root'}
    groups = {g.index: g.name for g in skin.vertex_groups}
    sums, affected, tips, fixed = [], [], [0] * len(chains), []
    points = [(i, Vector(p), radius, t) for i, line in enumerate(lines) for p, radius, t in line]
    tree = KDTree(len(points))
    for k, (_, p, _, _) in enumerate(points):
        tree.insert(p, k)
    tree.balance()
    for v in skin.data.vertices:
        weights = {groups[g.group]: g.weight for g in v.groups if groups[g.group] in deform}
        assert weights and all(math.isfinite(w) and 0 < w <= 1 for w in weights.values())
        total = sum(weights.values())
        assert abs(total - 1) < 2e-6, f'Unnormalized skin vertex {v.index}: {total}'
        sums.append(total)
        amount = sum(w for n, w in weights.items() if n in bone_names)
        if amount > 1e-6:
            affected.append(v.index)
        else:
            fixed.append(v.index)
        if v.co.y <= 1.94:
            assert amount == 0, 'Beard pulls stationary mantle, socket or brow skin'
        _, k, distance = tree.find(v.co)
        i, _, radius, t = points[k]
        if t > .65 and distance < radius + .015:
            assert abs(amount - 1) < 2e-6, 'Unbound/free tip vertex'
            assert sum(weights.get(n, 0) for n in chains[i]) > .999, 'Tip follows a different strand'
            tips[i] += 1
    assert affected and all(tips), 'Every beard tip must have fully bound skin'
    bm = bmesh.new(); bm.from_mesh(skin.data)
    assert all(e.is_manifold for e in bm.edges), 'Beard fusion has a crack/open seam'
    pending = set(bm.verts); stack = [pending.pop()]
    while stack:
        vertex = stack.pop()
        for edge in vertex.link_edges:
            other = edge.other_vert(vertex)
            if other in pending:
                pending.remove(other); stack.append(other)
    assert not pending, 'Beard is disconnected from facial skin'
    bm.free()

    # Every authored sample (including closure keys) must reset all beard channels.
    curves = {(c.data_path, c.array_index): c for c in action_curves(rig)}
    frames = {0.0}
    for clip in json.loads(scene['asset_clips']):
        count = len(clip['frames']) + int(clip['loop'])
        frames.update(clip['timelineStart'] + i * 24 / clip['frameRate'] for i in range(count))
    for name in bone_names:
        for path, rest in [('rotation_euler', 0), ('location', 0), ('scale', 1)]:
            for axis in range(3):
                curve = curves.get((f'pose.bones["{name}"].{path}', axis))
                assert curve is not None, f'Missing {name} {path} channel'
                keyed = {round(p.co.x, 4) for p in curve.keyframe_points}
                assert all(round(f, 4) in keyed for f in frames), f'Clip leaves {name} {path} unkeyed'
                # Rotation values may change when authored motions adopt the callback.
                if path != 'rotation_euler':
                    assert all(abs(p.co.y - rest) < 1e-6 for p in curve.keyframe_points)

    # Dirty every channel first; the default helper must explicitly clear each one.
    asset = {'rig': rig, 'parts': {'tentacle_chains': [], 'beard_chains': chains}}
    rest = {name: (tuple(rig.pose.bones[name].rotation_euler), tuple(rig.pose.bones[name].location),
                   tuple(rig.pose.bones[name].scale)) for name in bone_names}
    def assign(ob, path, value, frame):
        setattr(ob, path, value)
    deps = bpy.context.evaluated_depsgraph_get()
    before = positions(skin, deps)
    # Every separate mesh is protected, including all eyeballs, irises and lids.
    others = [o for o in scene.objects if o.type == 'MESH' and o != skin]
    other_before = {o: geometry_signature(o, deps) for o in others}
    try:
        for name in bone_names:
            bone = rig.pose.bones[name]
            bone.location, bone.scale = (.1, .2, .3), (1.2, .8, 1.1)
        key_arms(asset, 0, assign, None,
                 beard=lambda i, side, t: (math.radians(20) * (1 if i % 2 else -1) * (.25 + .75 * t),
                                            0, math.radians(25) * side * (.3 + .7 * t)))
        bpy.context.view_layer.update()
        assert modifiers[0].show_viewport and modifiers[0].show_render, 'Rotation must activate beard skinning'
        after = positions(skin, deps)
        displacement = [(a - b).length for a, b in zip(before, after)]
        assert max(displacement[i] for i in affected) > .08, 'Beard does not actually deform'
        fixed_max = max(displacement[i] for i in fixed)
        assert fixed_max < 2e-6, 'Stationary head/mantle moves under beard pose'
        for ob in others:
            assert geometry_signature(ob, deps) == other_before[ob], f'Beard moves {ob.name}'
        key_arms(asset, 0, assign, None)
        bpy.context.view_layer.update()
        assert not modifiers[0].show_viewport and not modifiers[0].show_render, 'Exact neutral pose must bypass skinning'
        reset = positions(skin, deps)
        assert max((a-b).length for a,b in zip(before, reset)) < 2e-6, 'Default callback did not restore rest'
        for name in bone_names:
            bone = rig.pose.bones[name]
            assert tuple(bone.rotation_euler) == tuple(bone.location) == (0, 0, 0)
            assert tuple(bone.scale) == (1, 1, 1)
    finally:
        for name, (rotation, location, scale) in rest.items():
            bone = rig.pose.bones[name]
            bone.rotation_euler, bone.location, bone.scale = rotation, location, scale
        bpy.context.view_layer.update()
    neutral = verify_neutral_clip_skin(scene, skin, asset, assign)
    return dict(chains=len(chains), bones=sum(map(len, chains)), weightedVertices=len(affected),
                normalizedVertices=len(sums), fullWeightTipVertices=tips,
                fixedVertices=len(fixed), fixedMaxDisplacement=fixed_max,
                maxTestDisplacement=max(displacement), protectedSeparateMeshes=len(others),
                keyedFrames=len(frames), connectedClosedSkin=True, defaultRestReset=True,
                neutralClipSkin=neutral)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    target = Path(args.report)
    if target.exists():
        raise FileExistsError(target)
    report = {'status': 'failed', 'blend': bpy.data.filepath}
    try:
        scene = next(s for s in bpy.data.scenes if s.get('asset_manifest'))
        bpy.context.window.scene = scene
        report['beard'] = verify_beard(scene)
        report['status'] = 'passed'
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
