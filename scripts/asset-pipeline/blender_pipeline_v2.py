"""Reproducible animated assets. Run build(repo, asset_id, revision) through Blender MCP.

Partial renders live in incomplete/, complete renders move atomically into runs/.
The current Blender scene is restored; unrelated datablocks are never removed.
"""
import hashlib
import importlib.util
import importlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))
import blender_pipeline as shared
import motions_v2

_sessions = {}


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    temp.replace(path)


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', value):
        raise ValueError('Use a lowercase asset/revision identifier')
    return value


def resolve_spec(root, asset_id):
    catalog = json.loads((root / 'scripts/asset-pipeline/catalog-v2.json').read_text(encoding='utf-8'))
    if catalog.get('version') != 2:
        raise ValueError('Expected V2 demand catalog')
    matches = [a for a in catalog['assets'] if a['id'] == asset_id]
    if len(matches) != 1:
        raise ValueError(f'Unknown or ambiguous asset: {asset_id}')
    spec = matches[0]
    if spec.get('production') != 'reference' or not spec.get('recipe'):
        raise ValueError(f'{asset_id} is described but has no executable recipe yet')
    identifier(spec['recipe'])
    expected = 'east' if spec['category'] == 'turret' else 'north'
    if spec['forward'] != expected or spec['pivot'] != [.5, .5]:
        raise ValueError('V2 assets require centered pivot and category-facing convention')
    if not math.isfinite(spec['orthoScale']) or spec['orthoScale'] <= 0:
        raise ValueError('Invalid authored ortho scale')
    names = set()
    for clip in spec['clips']:
        if clip['name'] in names or not isinstance(clip['loop'], bool):
            raise ValueError('Duplicate clip or invalid loop flag')
        names.add(clip['name'])
        if type(clip['frameCount']) is not int or clip['frameCount'] < 2 or clip['frameCount'] > 120:
            raise ValueError('Clip needs 2–120 sampled frames')
        if not math.isfinite(clip['frameRate']) or clip['frameRate'] <= 0:
            raise ValueError('Clip frameRate must be positive')
        if any(not isinstance(value, (int, float)) or not math.isfinite(value)
               for value in clip.get('parameters', {}).values()):
            raise ValueError('Motion parameters must be finite numbers')
    if not set(spec['requiredClips']).issubset(names):
        raise ValueError('Required clip missing')
    for variant in ('calm', 'rich'):
        settings = spec['materialVariants'][variant]
        for name in ('textureStrength', 'formShadowStrength'):
            if not math.isfinite(settings[name]) or not 0 <= settings[name] <= 1:
                raise ValueError(f'Invalid material {variant}.{name}')
    return spec


def inputs(root, spec, device='CPU'):
    names = ['blender_pipeline.py', 'blender_pipeline_v2.py', 'rigs_v2.py', 'motions_v2.py',
             f'recipes_v2/{spec["recipe"]}.py', 'catalog-v2.json',
             'export.mjs', 'export-v2.mjs', 'archive-v2.py', 'publish-v2.ps1', 'texture-prompts.json']
    if spec['recipe'] in ('rocket', 'badger'):
        names.append(f'recipes/{spec["recipe"]}.py')
    # The production library includes shared anatomy/weapon helpers. Snapshot the
    # complete small Python authoring library so transitive imports stay portable.
    names += [str(path.relative_to(BASE)).replace('\\', '/') for pattern in ('*.py', 'recipes_v2/*.py') for path in BASE.glob(pattern)]
    sources = {f'scripts/asset-pipeline/{name}': shared.digest(BASE / name) for name in names}
    for relative in ('package.json', 'package-lock.json'):
        sources[relative] = shared.digest(root / relative)
    textures = {}
    for family, relative in spec['textures'].items():
        path = shared.contained(root, relative)
        textures[family] = {'path': relative, 'sha256': shared.digest(path)}
    payload = {'spec': spec, 'sources': sources, 'textures': textures,
               'blenderVersion': bpy.app.version_string, 'render': {'masterSize': 1024, 'samples': 64, 'seed': 37, 'device': device, 'persistentData': True}}
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return fingerprint, sources, textures


def validate_pose(scene):
    camera = scene.camera
    if camera.data.type != 'ORTHO' or any(abs(v) > 1e-7 for v in camera.rotation_euler):
        raise ValueError('Camera must stay orthographic and face exact -Z')
    if abs(camera.location.x) > 1e-7 or abs(camera.location.y) > 1e-7:
        raise ValueError('Animation moved the camera away from the fixed pivot')
    if not scene.render.film_transparent or scene.render.image_settings.color_mode != 'RGBA':
        raise ValueError('Transparent RGBA required')
    deps = bpy.context.evaluated_depsgraph_get()
    points = []
    for ob in scene.objects:
        if ob.type != 'MESH' or ob.hide_render:
            continue
        evaluated = ob.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            points.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        finally:
            evaluated.to_mesh_clear()
    if not points:
        raise ValueError('Asset has no visible evaluated geometry')
    bounds = [min(p.x for p in points), min(p.y for p in points), max(p.x for p in points), max(p.y for p in points)]
    limit = camera.data.ortho_scale * .48
    if any(abs(value) > limit for value in bounds):
        raise ValueError(f'Pose {scene.frame_current} clips 2% border: {bounds}, limit {limit}; author a larger orthoScale')
    return bounds


def set_frame(scene, frame):
    scene.frame_set(math.floor(frame), subframe=frame % 1)


def validate_base(scene, asset, spec):
    if 'mount' not in spec: return None
    meshes = asset['parts'].get('base_meshes', [])
    if spec['category'] != 'turret' or not meshes or len(set(meshes)) != len(meshes):
        raise ValueError('Mounted turret must expose distinct support meshes')
    maximum = spec['mount']['maxBaseDiameter']
    if not 0 < maximum < spec['mount']['rockSize']:
        raise ValueError('Support diameter must be smaller than its rock')
    deps = bpy.context.evaluated_depsgraph_get()
    radius = 0
    for ob in meshes:
        ob['assetBase'] = True
        evaluated = ob.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            for vertex in mesh.vertices:
                point = evaluated.matrix_world @ vertex.co
                radius = max(radius, math.hypot(point.x, point.y))
        finally: evaluated.to_mesh_clear()
    diameter = 2 * radius * spec['targetSize'] / scene.camera.data.ortho_scale
    if diameter > maximum + 1e-5:
        raise ValueError(f'Turret support exceeds rotational footprint: {diameter:.3f} > {maximum} display pixels')
    return diameter


def prepare(root, spec, revision, fingerprint, sources, textures):
    # MCP keeps Python alive. Hashing current files must never label cached old code.
    importlib.invalidate_caches()
    for name in ('blender_pipeline', 'rigs_v2', 'motions_v2',
                 *([f'recipes.{spec["recipe"]}'] if spec['recipe'] in ('badger', 'rocket') else [])):
        if name in sys.modules:
            importlib.reload(sys.modules[name])
    for name, module in list(sys.modules.items()):
        source = getattr(module, '__file__', None)
        if source and Path(source).resolve().is_relative_to(BASE) and ('parts_' in name or name.endswith('_parts')):
            importlib.reload(module)
    images = {}
    for family, info in textures.items():
        image = bpy.data.images.load(str(shared.contained(root, info['path'])), check_existing=False)
        image.colorspace_settings.name = 'sRGB'
        image.pack()
        images[family] = image
    scene = shared.make_scene(f'FD V2 {spec["id"]} {revision}', spec['orthoScale'])
    scene.render.use_persistent_data = True
    ctx = shared.Authoring(scene, images)
    source = BASE / 'recipes_v2' / (spec['recipe'] + '.py')
    module_spec = importlib.util.spec_from_file_location('fd_recipe_' + spec['recipe'].replace('-', '_'), source)
    recipe = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(recipe)
    asset = recipe.build(ctx, spec)
    if set(asset) != {'root', 'parts', 'rig', 'sockets'}:
        raise ValueError('Recipe must return root, parts, rig and sockets')
    samples, clips = motions_v2.author(asset, spec['clips'])
    scene.frame_start, scene.frame_end = math.floor(clips[0]['timelineStart']), math.ceil(clips[-1]['timelineEnd'])
    scene.render.fps = 24
    scene['pipelineVersion'], scene['forward'], scene['pivot'] = 2, spec['forward'], spec['pivot']
    scene['asset_manifest'] = json.dumps(spec)
    scene['asset_clips'] = json.dumps(clips)
    scene['inputHash'] = fingerprint
    texts = set()
    for relative in sources:
        path = shared.contained(root, relative)
        text = bpy.data.texts.new(relative)
        text.write(path.read_text(encoding='utf-8'))
        texts.add(text)
    bounds, bases = {}, {}
    # Validate every evaluated pose before spending time rendering any frame.
    for sample in samples:
        set_frame(scene, sample['blenderFrame'])
        if any(abs(v) > 1e-7 for v in asset['root'].location) or any(abs(v) > 1e-7 for v in asset['root'].rotation_euler):
            raise ValueError('Motion must not translate/rotate the asset root')
        bounds[sample['index']] = validate_pose(scene)
        base = validate_base(scene, asset, spec)
        if base is not None: bases[sample['index']] = base
    scene.frame_set(0)
    return {'scene': scene, 'ctx': ctx, 'asset': asset, 'samples': samples, 'clips': clips, 'bounds': bounds, 'baseDiameters': bases, 'texts': texts}


def archive_inputs(root, out, sources, textures):
    expected = dict(sources) | {t['path']: t['sha256'] for t in textures.values()}
    for relative, wanted in expected.items():
        source = shared.contained(root, relative)
        target = shared.contained(out / 'archive-source', relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        if shared.digest(target) != wanted:
            raise ValueError(f'Source changed while snapshotting: {relative}')


def publish(base, source, target):
    """Expose a complete revision atomically through the native platform file operation."""
    shared.contained(base, source)
    shared.contained(base, target)
    if target.exists():
        raise FileExistsError('Published revision already exists')
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        source.rename(target)
    except PermissionError:
        if os.name != 'nt':
            raise
        shell = shutil.which('pwsh') or shutil.which('powershell')
        if not shell:
            raise
        subprocess.run([shell, '-NoProfile', '-NonInteractive', '-File', str(BASE / 'publish-v2.ps1'),
                        '-Root', str(base), '-Source', str(source), '-Destination', str(target)],
                       check=True, capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)


def build(repo, asset_id, revision, max_frames=None, device='CPU'):
    """Render a fresh revision, or resume an identical partial build in bounded chunks."""
    root = Path(repo).resolve()
    identifier(asset_id); identifier(revision)
    if device not in ('CPU', 'CUDA', 'OPTIX'):
        raise ValueError('Supported render device: CPU, CUDA, OPTIX')
    if max_frames is not None and (type(max_frames) is not int or max_frames < 1):
        raise ValueError('max_frames must be a positive integer')
    spec = resolve_spec(root, asset_id)
    fingerprint, sources, textures = inputs(root, spec, device)
    base = root / 'art/poc/pipeline-v2'
    out = base / 'incomplete' / revision / asset_id
    complete = base / 'runs' / revision / asset_id
    if complete.exists():
        raise FileExistsError(f'Complete revisions are immutable: {complete}')
    previous_scene = bpy.context.window.scene
    previous_frame = previous_scene.frame_current
    prefs = bpy.context.preferences.addons['cycles'].preferences
    previous_device_type = prefs.compute_device_type
    previous_devices = [(d, d.use) for d in prefs.devices]
    previous_cache_path = os.environ.get('OPTIX_CACHE_PATH')
    rendered = 0
    try:
        if (out / 'build.json').exists():
            state = json.loads((out / 'build.json').read_text(encoding='utf-8'))
            if state['inputHash'] != fingerprint:
                raise ValueError('Partial build inputs changed; use a new revision')
            # All accepted frames are immutable even during resume.
            for variant in state['variants'].values():
                for frame in variant['frames']:
                    path = shared.contained(out, frame['relative'])
                    if not path.is_file() or shared.digest(path) != frame['sha256']:
                        raise ValueError(f'Partial frame changed or missing: {frame["relative"]}')
        else:
            if out.exists():
                raise ValueError('Unrecognized incomplete directory; choose a fresh revision')
            state = {'pipelineVersion': 2, 'id': asset_id, 'revision': revision, 'inputHash': fingerprint,
                     'status': 'incomplete', 'variants': {name: {'frames': []} for name in ('calm', 'rich')}}
            out.mkdir(parents=True)
            archive_inputs(root, out, sources, textures)
            save_json(out / 'build.json', state)
        key = (str(root), asset_id, revision, fingerprint)
        session = _sessions.get(key)
        if session is None:
            session = prepare(root, spec, revision, fingerprint, sources, textures)
            if inputs(root, spec, device)[0] != fingerprint:
                raise ValueError('Sources changed during authoring; use a new revision')
            _sessions[key] = session
        scene, ctx = session['scene'], session['ctx']
        bpy.context.window.scene = scene
        if device != 'CPU':
            # Keep acceleration caches in the same writable workspace as the renders.
            cache = base / 'cache/optix'
            cache.mkdir(parents=True, exist_ok=True)
            os.environ['OPTIX_CACHE_PATH'] = str(cache)
            prefs.compute_device_type = device
            prefs.refresh_devices()
            available = [d for d in prefs.devices if d.type == device]
            if not available:
                raise ValueError(f'No {device} render device available')
            for d in prefs.devices:
                d.use = d.type == device
            scene.cycles.device = 'GPU'
        for variant, settings in spec['materialVariants'].items():
            if variant not in ('calm', 'rich'):
                continue
            for socket in ctx.strengths:
                socket.default_value = settings['textureStrength']
            for socket in ctx.form_strengths:
                socket.default_value = settings['formShadowStrength']
            folder = out / variant
            (folder / 'masters').mkdir(parents=True, exist_ok=True)
            done = {frame['index'] for frame in state['variants'][variant]['frames']}
            for sample in session['samples']:
                index = sample['index']
                if index in done:
                    continue
                if max_frames is not None and rendered >= max_frames:
                    return {'status': 'incomplete', 'id': asset_id, 'output': str(out),
                            'rendered': sum(len(v['frames']) for v in state['variants'].values()),
                            'total': 2 * len(session['samples'])}
                set_frame(scene, sample['blenderFrame'])
                name = f'masters/frame-{index:04d}.png'
                scene.render.filepath = str(folder / name)
                bpy.ops.render.render(write_still=True)
                record = dict(sample, file=name, relative=f'{variant}/{name}', sha256=shared.digest(folder / name), bounds=session['bounds'][index])
                if session['baseDiameters']: record['baseDiameter'] = session['baseDiameters'][index]
                state['variants'][variant]['frames'].append(record)
                save_json(out / 'build.json', state)
                rendered += 1
            scene.frame_set(0)
            scene.render.filepath = str(folder / 'masters/frame-0000.png')
            bpy.data.libraries.write(str(folder / 'asset.blend'), {scene, *session['texts']}, fake_user=True)
            manifest = dict(spec, pipelineVersion=2, revision=revision, variant=variant,
                            variantLabel=settings['label'], materialParameters=settings,
                            blenderVersion=bpy.app.version_string, renderDevice=device, masterSize=1024,
                            textures=textures, sources=sources, inputHash=fingerprint,
                            idleFrame=0, clips=session['clips'],
                            frames=[{k: v for k, v in f.items() if k != 'relative'} for f in state['variants'][variant]['frames']],
                            camera={'type':'ORTHO','rotation':list(scene.camera.rotation_euler),
                                    'location':list(scene.camera.location),'orthoScale':scene.camera.data.ortho_scale,
                                    'transparent':True,'bounds':session['bounds'][0]})
            save_json(folder / 'render.json', manifest)
        state['status'] = 'complete'
        save_json(out / 'build.json', state)
        publish(base, out, complete)
        _sessions.pop(key, None)
        scene.render.use_persistent_data = False
        return {'status': 'complete', 'id': asset_id, 'output': str(complete),
                'framesPerVariant': len(session['samples']), 'variants': ['calm','rich']}
    finally:
        bpy.context.window.scene = previous_scene
        previous_scene.frame_set(previous_frame)
        prefs.compute_device_type = previous_device_type
        for d, use in previous_devices:
            d.use = use
        if previous_cache_path is None:
            os.environ.pop('OPTIX_CACHE_PATH', None)
        else:
            os.environ['OPTIX_CACHE_PATH'] = previous_cache_path


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True)
    parser.add_argument('--asset', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--max-frames', type=int)
    parser.add_argument('--device', choices=['CPU', 'CUDA', 'OPTIX'], default='CPU')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    targets = [a['id'] for a in json.loads((Path(args.repo)/'scripts/asset-pipeline/catalog-v2.json').read_text(encoding='utf-8'))['assets'] if a.get('production') == 'reference'] if args.asset == 'references' else [args.asset]
    for target in targets:
        print(json.dumps(build(args.repo, target, args.revision, args.max_frames, args.device)), flush=True)
