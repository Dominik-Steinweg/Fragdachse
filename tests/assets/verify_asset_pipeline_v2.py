"""Inspect a saved V2 Blend in real Blender; optional independent CPU frame render.

Not part of Vitest and not an asset authoring dependency. No Blend is ever saved.
Run: blender --background <asset.blend> --python-exit-code 1 --python <this file>
     -- --manifest <render.json> --report <new report.json>
"""
import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import traceback

import bpy


sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/asset-pipeline'))
from pose_validation_v2 import (EPSILON, require, near, matrix_values, set_frame, action_curves,
    animation_owners, snapshot, different_meshes, assert_same_pose, hierarchy_root,
    fixed_presentation, assert_fixed_presentation, assert_geometry_bounds, assert_clip_boundary)
from contracts_v2 import validate_clips, validate_extensions


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify(scene, manifest, report, source_folder):
    checks = report['checks']
    spec = json.loads(scene['asset_manifest'])
    validate_clips(manifest['clips'], sampled=True)
    validate_extensions(manifest)
    for key in ('id', 'category', 'recipe', 'targetSize', 'sourceSizes', 'forward', 'pivot', 'orthoScale', 'requiredClips'):
        require(spec[key] == manifest[key], f'Embedded asset description differs: {key}')
    require(spec.get('displayScale', 1) == manifest.get('displayScale', 1), 'Padded canvas scale differs')
    for field in ('elevation', 'runtimeAtlas', 'runtimeContract', 'runtimeBudgetMB'):
        require(spec.get(field) == manifest.get(field), f'Embedded extension differs: {field}')
    require(json.loads(scene['asset_clips']) == manifest['clips'], 'Embedded clips differ from export manifest')
    require(scene['inputHash'] == manifest['inputHash'], 'Embedded input fingerprint differs')
    require(scene['pipelineVersion'] == manifest['pipelineVersion'] == 2, 'Expected V2 scene and manifest')
    require(list(scene['pivot']) == manifest['pivot'] == [.5, .5], 'Expected centered pivot')
    require(scene['forward'] == manifest['forward'], 'Embedded facing differs')
    require(scene.render.fps == 24 and scene.render.fps_base == 1, 'Authored Blender timeline must use 24 fps')
    require(scene.render.engine == 'CYCLES' and scene.cycles.samples == 64 and scene.cycles.seed == 37,
            'Cycles quality/seed differs from the master contract')
    require(scene.render.resolution_x == scene.render.resolution_y == manifest['masterSize'] == 1024
            and scene.render.resolution_percentage == 100, 'Expected full 1024 master resolution')
    require(scene.render.film_transparent and scene.render.image_settings.color_mode == 'RGBA'
            and scene.render.image_settings.file_format == 'PNG', 'Expected transparent RGBA PNG output')
    checks.append({'name': 'embedded_spec_and_master_settings', 'passed': True})

    embedded_texts = {text.as_string() for text in bpy.data.texts}
    for relative, expected_hash in manifest['sources'].items():
        source = (source_folder / relative).resolve()
        require(source.is_relative_to(source_folder), 'Source archive path escapes its folder')
        raw = source.read_bytes()
        require(digest(raw) == expected_hash, f'Archived pipeline source changed: {relative}')
        # Authoring embeds read_text() output, which normalizes Windows CRLF.
        # Check original bytes against the manifest and normalized text against
        # Blender's text datablocks rather than mistaking line endings for loss.
        normalized = raw.decode('utf-8').replace('\r\n', '\n').replace('\r', '\n')
        require(normalized in embedded_texts, f'Used pipeline source is missing or changed in the Blend: {relative}')
    images = {node.image for ob in scene.objects for slot in ob.material_slots
              if slot.material and slot.material.node_tree for node in slot.material.node_tree.nodes
              if node.type == 'TEX_IMAGE' and node.image is not None}
    require(bool(images), 'No material texture sources found')
    require(all(image.packed_file is not None for image in images), 'A used texture is not packed into the Blend')
    packed_hashes = {digest(bytes(image.packed_file.data)) for image in images}
    require({texture['sha256'] for texture in manifest['textures'].values()}.issubset(packed_hashes),
            'Packed original texture pixels differ from manifest')
    checks.append({'name': 'packed_original_textures_and_pipeline_sources', 'passed': True,
                   'textures': len(images), 'sources': len(manifest['sources'])})

    frames = manifest['frames']
    require([frame['index'] for frame in frames] == list(range(len(frames))), 'Frame indices are not contiguous')
    require(manifest['idleFrame'] == 0 and frames[0]['blenderFrame'] == 0, 'Expected separate idle pose at frame zero')
    referenced = [manifest['idleFrame']]
    for clip in manifest['clips']:
        authored = next((clip_spec for clip_spec in spec['clips'] if clip_spec['name'] == clip['name']), None)
        require(authored is not None, f'No authored clip for {clip["name"]}')
        require(all(authored[key] == clip[key] for key in ('name', 'motion', 'frameRate', 'loop')),
                f'Authored timing or motion differs for {clip["name"]}')
        require(authored['frameCount'] == len(clip['frames']), f'Wrong sampled count for {clip["name"]}')
        for field in ('markers', 'start', 'end', 'next'):
            default = 'rest' if field == 'end' else None
            require(clip.get(field, default) == authored.get(field, default), f'Authored {field} differs for {clip["name"]}')
        if clip['name'] == 'claw':
            markers = clip.get('markers', {})
            require(markers == authored.get('markers') and not clip['loop']
                    and 0 < markers.get('strike', -1) < markers.get('impact', -1) < len(clip['frames']) - 1,
                    'Claw contact markers must survive export in order')
        step = 24 / clip['frameRate']
        expected = [clip['timelineStart'] + i * step for i in range(len(clip['frames']))]
        require(near([frames[index]['blenderFrame'] for index in clip['frames']], expected),
                f'Export samples do not match the 24 fps timeline for {clip["name"]}')
        require(abs(clip['timelineEnd'] - max(clip['timelineStart'] + len(clip['frames']) * step - 1, expected[-1])) <= EPSILON,
                f'Invalid timeline duration for {clip["name"]}')
        referenced.extend(clip['frames'])
    require(sorted(referenced) == list(range(len(frames))), 'Clip/idle frames overlap or leave unassigned samples')
    checks.append({'name': 'sampled_timeline_spacing', 'passed': True, 'fps': 24, 'frames': len(frames)})

    meshes = [ob for ob in scene.objects if ob.type == 'MESH' and not ob.hide_render]
    require(bool(meshes), 'No visible mesh geometry')
    roots = {hierarchy_root(ob) for ob in meshes}
    require(len(roots) == 1, 'All visible geometry must share one authored root')
    root = roots.pop()
    require(root.type == 'EMPTY', 'Expected explicit asset-root control')
    rigs = [ob for ob in scene.objects if ob.type == 'ARMATURE']
    owners = animation_owners(scene)
    if not manifest['clips']:
        require(spec['category'] in ('weapon', 'utility', 'construction', 'companion') and len(frames) == 1 and not owners,
                'Only explicitly static assets may omit Actions and clips')
        if spec['category'] in ('weapon', 'utility'):
            require(spec['heldItem'] == manifest['heldItem'], 'Saved held-item anchors differ')
        checks.append({'name': 'static_asset_contract', 'passed': True})
    else:
        require(any(ob.type in ('EMPTY', 'ARMATURE', 'MESH') and action_curves(ob) for ob in scene.objects),
                'No real object or rig Action is attached')
        checks.append({'name': 'authored_actions_present', 'passed': True,
                       'actions': [{'owner': owner.name, 'action': owner.animation_data.action.name,
                                    'curves': len(action_curves(owner))} for owner in owners]})

    set_frame(scene, 0)
    presentation = fixed_presentation(scene, root)
    require(abs(presentation['orthoScale'] - manifest['camera']['orthoScale']) <= EPSILON,
            'Saved orthographic scale differs from manifest')
    idle = snapshot(scene, meshes, rigs, owners)
    assert_geometry_bounds(scene, meshes, idle, 0)
    rigged = {ob.name for ob in meshes if any(mod.type == 'ARMATURE' and mod.object in rigs for mod in ob.modifiers)}
    stable_grip = spec['category'] == 'character' and spec.get('model', {}).get('upperBodyMotion') == 'stable-grip'
    balanced_player = spec['category'] == 'character' and spec.get('model', {}).get('upperBodyMotion') in ('balanced', 'stable-grip')
    stable_upper = ({ob.name for ob in meshes if ob.get('motionRole') == 'grip'} if stable_grip else
                    {ob.name for ob in meshes} - rigged if spec['category'] == 'character' and not balanced_player else set())
    if stable_grip:
        require(bool(stable_upper), 'Stable-grip player needs explicit fixed hand geometry')
    roles = {role: {ob.name for ob in meshes if ob.get('motionRole') == role} for role in ('head', 'arms', 'body', 'left_leg', 'right_leg')}
    bases = [ob for ob in meshes if ob.get('assetBase')]
    if balanced_player:
        require(all(roles.values()), 'Balanced player needs explicit head, arms, body and leg geometry roles')
    if 'mount' in spec:
        require(bases and 0 < spec['mount']['maxBaseDiameter'] < spec['mount']['rockSize'] == 32,
                'Mounted turret needs an explicit support smaller than its 32-pixel rock')
    if spec['category'] in ('character', 'enemy', 'boss-part'):
        require(bool(rigs) and bool(rigged), 'Locomotion requires a saved rig and weighted limb geometry')
    if spec['category'] == 'character' and not balanced_player:
        require(bool(stable_upper), 'No fixed upper-body geometry available to verify')
    moved_all = set()
    per_clip = []
    for clip in manifest['clips']:
        first, last = None, None
        moved = set()
        movement = set()
        for index in clip['frames']:
            frame = frames[index]['blenderFrame']
            set_frame(scene, frame)
            assert_fixed_presentation(scene, root, presentation, frame)
            state = snapshot(scene, meshes, rigs, owners)
            first = state if first is None else first
            last = state
            movement.update(different_meshes(first, state))
            changed = different_meshes(idle, state)
            require(not changed.intersection(stable_upper), f'Player upper body moved: {sorted(changed.intersection(stable_upper))}')
            if clip['motion'] == 'player_idle':
                require(not changed.intersection(roles['left_leg'] | roles['right_leg']), 'Breathing moves planted feet')
            moved.update(changed)
            # The transformed, evaluated vertices must remain inside the same
            # two-percent safety border at every sampled pose, including rigging.
            assert_geometry_bounds(scene, meshes, state, frame)
            if bases:
                from mathutils import Vector, Matrix
                radius = 0
                for ob in bases:
                    matrix, vertices = state['geometry'][ob.name]
                    world = Matrix([matrix[i:i+4] for i in range(0, 16, 4)])
                    for i in range(0, len(vertices), 3):
                        point = world @ Vector(vertices[i:i+3])
                        radius = max(radius, math.hypot(point.x, point.y))
                diameter = 2 * radius * spec['targetSize'] / presentation['orthoScale']
                require(diameter <= spec['mount']['maxBaseDiameter'] + EPSILON, 'Turret support exceeds its rotational mount footprint')
                require(abs(diameter - frames[index]['baseDiameter']) < 1e-4, 'Recorded support footprint differs from evaluated source')
        require(bool(movement), f'Clip {clip["name"]} contains no visible geometric movement')
        if clip['motion'] == 'player_idle':
            require(bool(moved.intersection(roles['body'])) and bool(moved.intersection(roles['arms'])),
                    'Breathing must visibly move chest and shoulders')
        def boundary_sample(frame):
            set_frame(scene, frame)
            assert_fixed_presentation(scene, root, presentation, frame)
            state = snapshot(scene, meshes, rigs, owners)
            assert_geometry_bounds(scene, meshes, state, frame)
            return state
        assert_clip_boundary(clip, manifest['clips'], idle, first, last, boundary_sample)
        if clip['name'] == 'claw' and 'leapDistance' in clip.get('parameters', {}):
            controls = [ob for ob in owners if ob.get('attackMotion')]
            require(len(controls) == 1, 'Pounce requires one authored visual motion control')
            control = controls[0]
            markers = clip['markers']
            positions = []
            for pose_index in (markers['strike'], markers['impact'], markers['impact'] + 1, len(clip['frames']) - 1):
                set_frame(scene, frames[clip['frames'][pose_index]]['blenderFrame'])
                positions.append(control.location.y)
            require(positions[0] < 0 < positions[1] < positions[2], 'Pounce must coil, launch and follow through beyond contact')
            require(abs(positions[-1]) < EPSILON, 'Pounce must return to its fixed pivot')
            checks.append({'name': 'claw_pounce_anticipation_contact_followthrough', 'passed': True,
                           'forwardPositions': positions})
        moved_all.update(moved)
        per_clip.append({'name': clip['name'], 'loop': clip['loop'], 'movingMeshes': len(moved),
                         'samples': len(clip['frames'])})
    if rigged:
        require(rigged.issubset(moved_all), f'Saved limb meshes do not move: {sorted(rigged - moved_all)}')
    checks.append({'name': 'fixed_presentation_and_unclipped_evaluated_poses', 'passed': True})
    checks.append({'name': 'clip_motion_and_closure', 'passed': True, 'clips': per_clip})
    if rigged:
        checks.append({'name': 'rigged_limbs_change', 'passed': True, 'meshes': len(rigged)})
    if stable_upper:
        checks.append({'name': 'player_weapon_grips_stay_fixed' if stable_grip else 'player_upper_body_stays_fixed', 'passed': True, 'meshes': len(stable_upper)})
    if balanced_player:
        require(all(names.issubset(moved_all) for names in roles.values()), 'Balanced player contains unanimated body/head/arm/leg geometry')
        checks.append({'name': 'balanced_player_whole_body_motion', 'passed': True, 'roles': {role: len(names) for role, names in roles.items()}})
    if bases:
        checks.append({'name': 'turret_support_fits_32px_rock_at_all_angles', 'passed': True, 'baseMeshes': len(bases), 'maximumDiameter': spec['mount']['maxBaseDiameter']})
    set_frame(scene, 0)


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--render-frame', type=int)
    parser.add_argument('--render-output')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (args.render_frame is None) != (args.render_output is None):
        parser.error('--render-frame and --render-output must be supplied together')
    return args


def main():
    args = arguments()
    report_path = Path(args.report).resolve()
    require(not report_path.exists(), 'Report output must be a new file')
    if args.render_output:
        require(Path(args.render_output).suffix.lower() == '.png', 'Render output must be a PNG path')
        require(not Path(args.render_output).exists(), 'Independent render must be a new file')
    report = {'version': 2, 'status': 'failed', 'blend': bpy.data.filepath,
              'manifest': str(Path(args.manifest).resolve()), 'blenderVersion': bpy.app.version_string,
              'checks': []}
    started = time.monotonic()
    try:
        manifest_bytes = Path(args.manifest).read_bytes()
        manifest = json.loads(manifest_bytes)
        report.update(id=manifest['id'], variant=manifest['variant'], revision=manifest['revision'],
                      manifestSha256=digest(manifest_bytes), blendSha256=digest(Path(bpy.data.filepath).read_bytes()))
        scenes = [scene for scene in bpy.data.scenes if scene.get('inputHash') == manifest['inputHash']
                  and scene.get('asset_manifest') and json.loads(scene['asset_manifest']).get('id') == manifest['id']]
        require(len(scenes) == 1, 'Saved Blend must contain exactly one matching asset scene')
        scene = scenes[0]
        bpy.context.window.scene = scene
        report['scene'] = scene.name
        verify(scene, manifest, report, Path(args.manifest).resolve().parent.parent / 'archive-source')
        if 'elevation' in manifest:
            from elevation_v2 import verify_elevation
            report['checks'].append(verify_elevation(scene, manifest, Path(args.manifest).resolve().parent))
        if args.render_frame is not None:
            require(0 <= args.render_frame < len(manifest['frames']), 'Render frame index outside manifest')
            output = Path(args.render_output).resolve()
            output.parent.mkdir(parents=True, exist_ok=True)
            set_frame(scene, manifest['frames'][args.render_frame]['blenderFrame'])
            # CPU keeps this portability check independent of saved GPU preferences.
            # Resolution, samples, camera, seed and all materials remain untouched.
            scene.cycles.device = 'CPU'
            scene.render.filepath = str(output)
            bpy.ops.render.render(write_still=True)
            require(output.exists(), 'Independent render was not written')
            rendered = bpy.data.images.load(str(output), check_existing=False)
            try:
                require(tuple(rendered.size) == (1024, 1024) and rendered.channels == 4,
                        'Independent render is not a 1024 RGBA image')
            finally:
                bpy.data.images.remove(rendered)
            report['checks'].append({'name': 'independent_saved_blend_render', 'passed': True,
                                     'index': args.render_frame, 'device': 'CPU', 'output': str(output),
                                     'sha256': digest(output.read_bytes())})
        report['status'] = 'passed'
    except Exception as error:
        report['error'] = str(error)
        report['traceback'] = traceback.format_exc()
    report['elapsedSeconds'] = round(time.monotonic() - started, 3)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
        handle.write('\n')
    print(json.dumps(report, ensure_ascii=False), flush=True)
    require(report['status'] == 'passed', f'Real-Blender verification failed: {report.get("error")}')


if __name__ == '__main__':
    main()
