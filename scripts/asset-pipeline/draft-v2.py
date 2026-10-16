"""One Cycles render per draft frame. Original beauty shader and lighting remain intact.

The disposable model cache stores explicit recipe references before any animation.
No production builder, pose audit, archive or source file is modified.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util
import json
import math
import hashlib
import time
import os

# Background Blender cannot assume that the user's driver-cache directories are writable.
# This cache is shared only by disposable drafts and never touches production artifacts.
for variable, directory in [('OPTIX_CACHE_PATH', '.optix-cache'), ('CUDA_CACHE_PATH', '.cuda-cache')]:
    cache = Path(os.environ.get(variable, Path(__file__).resolve().parents[2] / 'art/poc/pipeline-v2/drafts' / directory))
    cache.mkdir(parents=True, exist_ok=True)
    os.environ[variable] = str(cache)
import bpy
import numpy as np
import blender_pipeline as shared
import motions_v2
from character_pass_blender import png
from elevation_v2 import read_pixels
from kraken_ls_export import geometry
from bpy_extras.object_utils import world_to_camera_view


def save(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, indent=2) + '\n', encoding='utf8')


def encode(value):
    if isinstance(value, bpy.types.Object): return {'$object': value.name}
    if isinstance(value, bpy.types.NodeSocket):
        material = next((m.name for m in bpy.data.materials if m.node_tree == value.id_data), None)
        return {'$socket': dict(material=material, group=value.id_data.name if material is None else None, path=value.path_from_id())}
    if isinstance(value, dict): return {k: encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [encode(v) for v in value]
    if value is None or isinstance(value, (str, bool, int, float)): return value
    raise TypeError(f'Unsupported recipe cache reference: {type(value)}')


def decode(value):
    if isinstance(value, dict):
        if '$object' in value: return bpy.data.objects[value['$object']]
        if '$socket' in value:
            reference = value['$socket']
            tree = bpy.data.materials[reference['material']].node_tree if reference['material'] else bpy.data.node_groups[reference['group']]
            return tree.path_resolve(reference['path'])
        return {k: decode(v) for k, v in value.items()}
    if isinstance(value, list): return [decode(v) for v in value]
    return value


def model(job):
    cache, spec = Path(job['model']), job['spec']
    if cache.exists():
        bpy.ops.wm.open_mainfile(filepath=str(cache))
        scene = bpy.context.scene
        if scene.get('draftModelHash') != job['modelHash']: raise ValueError('Model cache mismatch')
        if scene.get('draftBlenderVersion') == bpy.app.version_string:
            return scene, decode(json.loads(scene['draftReferences'])), True
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = Path(__file__).resolve().parents[2]
    images = {}
    for family, relative in spec.get('textures', {}).items():
        image = bpy.data.images.load(str(root / relative), check_existing=False)
        image.colorspace_settings.name = 'sRGB'
        image.pack()
        images[family] = image
    scene = shared.make_scene('Draft ' + spec['id'], spec['orthoScale'])
    ctx = shared.Authoring(scene, images)
    source = Path(__file__).parent / 'recipes_v2' / (spec['recipe'] + '.py')
    definition = importlib.util.spec_from_file_location('draft_recipe', source)
    recipe = importlib.util.module_from_spec(definition)
    definition.loader.exec_module(recipe)
    asset = recipe.build(ctx, spec)
    asset['sockets'].update(ctx.eye_sockets)
    if spec['category'] == 'enemy':
        from rigs_v2 import control, attach
        children = list(asset['root'].children)
        motion = control(scene, 'Attack motion — visual pounce', parent=asset['root'])
        motion['attackMotion'] = True
        attach(children, motion)
        asset['parts']['attack_motion'] = motion
    settings = spec['materialVariants'].get('standard', next(iter(spec['materialVariants'].values())))
    for socket in ctx.strengths: socket.default_value = settings['textureStrength']
    for socket in ctx.form_strengths: socket.default_value = settings['formShadowStrength']
    scene['draftModelHash'] = job['modelHash']
    scene['draftBlenderVersion'] = bpy.app.version_string
    scene['draftReferences'] = json.dumps(encode(asset))
    cache.parent.mkdir(parents=True, exist_ok=True)
    temp = cache.with_suffix('.tmp.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(temp), check_existing=False)
    temp.replace(cache)
    return scene, asset, False


def neutral_albedo(nodes, links, source):
    """Copy only the albedo branch; the beauty BSDF and its drivers stay untouched.

    Matches the production adapter's three named directional/sheeny bypasses.
    All other pigment, cavity, texture and AO nodes remain shared.
    """
    cache = {}
    def visit(output):
        if output in cache: return cache[output]
        node = output.node
        if node.name in ('Broad form value', 'Deep cool flanks and lit organic ridge edges'):
            one = nodes.new('ShaderNodeValue'); one.outputs[0].default_value = 1
            cache[output] = one.outputs[0]
            return one.outputs[0]
        changed = {}
        for socket in node.inputs:
            if socket.is_linked:
                original = socket.links[0].from_socket
                replacement = visit(original)
                if replacement != original: changed[socket.identifier] = replacement
        sheen = node.name == 'Iridescent violet-teal sheen'
        if not changed and not sheen:
            cache[output] = output
            return output
        copy = nodes.new(node.bl_idname)
        # Set enum configuration before accessing dynamic inputs (Mix/Math etc.).
        for prop in node.bl_rna.properties:
            if prop.is_readonly or prop.identifier in ('name', 'location', 'parent'): continue
            if prop.type in ('BOOLEAN', 'INT', 'FLOAT', 'STRING', 'ENUM'):
                try: setattr(copy, prop.identifier, getattr(node, prop.identifier))
                except (AttributeError, TypeError, ValueError): pass
        for old, new in zip(node.inputs, copy.inputs):
            if hasattr(old, 'default_value'):
                try: new.default_value = old.default_value
                except (TypeError, ValueError): pass
            if old.is_linked: links.new(changed.get(old.identifier, old.links[0].from_socket), new)
        if sheen:
            for link in list(copy.inputs[0].links): links.remove(link)
            copy.inputs[0].default_value = 0
        result = copy.outputs[list(node.outputs).index(output)]
        cache[output] = result
        return result
    return visit(source)


def setup_passes(scene, spec, temp):
    animated_defaults = []
    layer = scene.view_layers[0]
    names = ['FD_albedo', 'FD_normal', 'FD_height', 'FD_emission']
    for name in names:
        aov = layer.aovs.add(); aov.name = name; aov.type = 'COLOR'
    materials = {m for ob in scene.objects if ob.type == 'MESH' and not ob.hide_render for m in ob.data.materials if m}
    for material in materials:
        nodes, links = material.node_tree.nodes, material.node_tree.links
        bs = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bs is None: raise ValueError('Unsupported draft material: ' + material.name)
        geom = nodes.new('ShaderNodeNewGeometry')
        def aov(name, source=None, value=None):
            node = nodes.new('ShaderNodeOutputAOV'); node.name = name; node.aov_name = name
            if source is not None: links.new(source, node.inputs['Color'])
            elif value is not None: node.inputs['Color'].default_value = value
            return node
        color = bs.inputs['Base Color']
        color_aov = aov(names[0], neutral_albedo(nodes, links, color.links[0].from_socket) if color.is_linked else None, color.default_value)
        if not color.is_linked: animated_defaults.append((color, color_aov.inputs['Color']))
        normal = bs.inputs['Normal'].links[0].from_socket if bs.inputs['Normal'].is_linked else geom.outputs['Normal']
        mul = nodes.new('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = (.5, -.5, .5)
        add = nodes.new('ShaderNodeVectorMath'); add.operation = 'ADD'; add.inputs[1].default_value = (.5, .5, .5)
        links.new(normal, mul.inputs[0]); links.new(mul.outputs[0], add.inputs[0]); aov(names[1], add.outputs[0])
        xyz = nodes.new('ShaderNodeSeparateXYZ'); links.new(geom.outputs['Position'], xyz.inputs[0])
        remap = nodes.new('ShaderNodeMapRange'); remap.clamp = False
        remap.inputs['From Min'].default_value = spec['elevation']['min']; remap.inputs['From Max'].default_value = spec['elevation']['max']
        links.new(xyz.outputs['Z'], remap.inputs['Value']); aov(names[2], remap.outputs[0])
        emit = nodes.new('ShaderNodeVectorMath'); emit.operation = 'SCALE'
        for source, target in [(bs.inputs['Emission Color'], emit.inputs[0]), (bs.inputs['Emission Strength'], emit.inputs['Scale'])]:
            if source.is_linked: links.new(source.links[0].from_socket, target)
            else:
                value = source.default_value
                target.default_value = tuple(value)[:3] if source.type == 'RGBA' else value
                animated_defaults.append((source, target))
        aov(names[3], emit.outputs[0])
    graph = bpy.data.node_groups.new('Draft passes', 'CompositorNodeTree')
    scene.compositing_node_group = graph
    render = graph.nodes.new('CompositorNodeRLayers'); render.scene = scene
    outputs = {}
    for name in names:
        output = graph.nodes.new('CompositorNodeOutputFile')
        output.directory = str(temp); output.file_name = name
        output.format.media_type = 'IMAGE'; output.format.file_format = 'OPEN_EXR'
        output.format.color_mode = 'RGBA'; output.format.color_depth = '32'; output.format.exr_codec = 'ZIP'
        output.file_output_items.clear(); output.file_output_items.new('RGBA', name)
        graph.links.new(render.outputs[name], output.inputs[0]); outputs[name] = output
    def sync_defaults():
        for source, target in animated_defaults:
            value = source.default_value
            target.default_value = tuple(value)[:3] if source.type == 'RGBA' and target.type == 'VECTOR' else value
    return sync_defaults


def coarse_mesh(vertices, triangles, target):
    """Linear-time vertex clustering. No costly evaluated-mesh decimation per frame."""
    lo, hi = vertices.min(axis=0), vertices.max(axis=0)
    resolution = max(2, round(math.sqrt(target / 6)))
    cells = np.rint((vertices - lo) / np.maximum(hi - lo, 1e-9) * resolution).astype(np.int32)
    _, inverse = np.unique(cells, axis=0, return_inverse=True)
    count = np.bincount(inverse)
    points = np.stack([np.bincount(inverse, weights=vertices[:, axis]) / count for axis in range(3)], axis=1)
    faces = inverse[triangles]
    faces = faces[(faces[:, 0] != faces[:, 1]) & (faces[:, 0] != faces[:, 2]) & (faces[:, 1] != faces[:, 2])]
    faces = np.unique(faces, axis=0)
    return points, faces


def sockets(scene, asset, warnings, label):
    result = {}
    deps = bpy.context.evaluated_depsgraph_get()
    for name, obj in asset['sockets'].items():
        if name in ('eyeLeft', 'eyeRight') or name.startswith('eyeExtra'): continue
        world = obj.evaluated_get(deps).matrix_world.translation
        p = world_to_camera_view(scene, scene.camera, world)
        x, y, z = float(p.x), float(1 - p.y), float(world.z)
        if not all(math.isfinite(v) for v in (x, y, z)): raise ValueError('Non-finite socket')
        if not (0 <= x <= 1 and 0 <= y <= 1): warnings.add(f'{label}: socket {name} outside canvas (clamped)')
        result[name] = dict(x=max(0, min(1, x)), y=max(0, min(1, y)), z=z)
    return result


def render_job(job):
    start = time.perf_counter()
    scene, asset, cache_hit = model(job)
    spec, settings = job['spec'], job['settings']
    samples, clips = motions_v2.author(asset, spec['clips'])
    scene.frame_set(0)
    size = round(spec['targetSize'] * spec.get('displayScale', 1))
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.use_persistent_data = True
    scene.cycles.samples = settings['samples']; scene.cycles.use_denoising = settings['denoise']
    scene.cycles.denoiser = 'OPTIX' if settings['device'] == 'OPTIX' else 'OPENIMAGEDENOISE'
    scene.cycles.device = 'CPU' if settings['device'] == 'CPU' else 'GPU'
    if settings['device'] != 'CPU':
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = settings['device']; prefs.refresh_devices()
        for device in prefs.devices: device.use = device.type == settings['device']
        if not any(device.use for device in prefs.devices): raise ValueError('Requested GPU unavailable')
    folder = Path(job['output']) / 'standard'
    temp = Path(job['output']) / 'passes'; temp.mkdir(parents=True, exist_ok=True)
    packed = bool(spec.get('materialPass'))
    sync_defaults = setup_passes(scene, spec, temp) if packed else lambda: None
    objects = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
    warnings, records = set(), {}
    groups = [{'name': '__rest', 'frames': [0]}, *clips]
    for clip in groups:
        if clip['name'] not in job['render']: continue
        frames = []
        out = folder / 'clips' / clip['name']; out.mkdir(parents=True, exist_ok=True)
        for local, index in enumerate(clip['frames']):
            value = samples[index]['blenderFrame']
            scene.frame_set(math.floor(value), subframe=value % 1)
            bpy.context.view_layer.update()
            sync_defaults()
            label = f'{clip["name"]}/{local:04d}'
            stem = out / f'frame-{local:04d}'
            scene.render.filepath = str(stem) + '-beauty.png'
            bpy.ops.render.render(write_still=True, scene=scene.name)
            frame = {'beauty': str(Path(scene.render.filepath).relative_to(folder)).replace('\\', '/'),
                     'sockets': sockets(scene, asset, warnings, label)}
            beauty = read_pixels(scene.render.filepath)
            coverage = beauty[:, :, 3:4]
            margin = math.ceil(size * settings.get('borderRatio', .02))
            if margin:
                border = np.concatenate([coverage[:margin].ravel(), coverage[-margin:].ravel(), coverage[:, :margin].ravel(), coverage[:, -margin:].ravel()])
                if np.any(border > .01): warnings.add(f'{clip["name"]}: canvas border touched')
            if not packed: frame['color'] = frame['beauty']
            else:
                arrays = {}
                for name in ('albedo', 'normal', 'height', 'emission'):
                    files = list(temp.glob('FD_' + name + '*.exr'))
                    if len(files) != 1: raise ValueError(f'Expected one AOV file: {name}, {files}')
                    pixels = read_pixels(files[0]); files[0].unlink()
                    # Cycles color AOVs are coverage-premultiplied; combined alpha is authoritative.
                    arrays[name] = pixels[:, :, :3] / np.maximum(coverage, 1e-8)
                h = arrays['height'][:, :, :1]
                interior = coverage[:, :, 0] > .99
                if np.any(h[:, :, 0][interior] < 0) or np.any(h[:, :, 0][interior] > 1): warnings.add(f'{clip["name"]}: height range clamped')
                n = arrays['normal'] * 2 - 1
                n /= np.maximum(np.abs(n).sum(axis=2, keepdims=True), 1e-8)
                xy = n[:, :, :2].copy()
                xy = np.where(n[:, :, 2:3] < 0, (1 - np.abs(xy[:, :, ::-1])) * np.where(xy >= 0, 1, -1), xy) * .5 + .5
                color = arrays['albedo']
                color = np.where(color <= .0031308, color * 12.92, 1.055 * np.maximum(color, 0) ** (1 / 2.4) - .055)
                emission = arrays['emission'] / 8
                for name, values in dict(color=np.concatenate([color, coverage], axis=2),
                    elevation=np.concatenate([h, xy, coverage], axis=2),
                    emission=np.concatenate([emission, coverage * (emission.max(axis=2, keepdims=True) > .5 / 255)], axis=2)).items():
                    file = Path(str(stem) + '-' + name + '.png')
                    png(file, np.rint(np.clip(values, 0, 1) * 255).astype('uint8'))
                    frame[name] = str(file.relative_to(folder)).replace('\\', '/')
                vertices, triangles = geometry(objects)
                pv, pt = coarse_mesh(vertices, triangles, settings['triangles'])
                pv *= np.array([size / spec['orthoScale'], -size / spec['orthoScale'], size / spec['orthoScale']])
                lo, hi = pv.min(axis=0), pv.max(axis=0)
                quant = np.rint((pv - lo) / np.maximum(hi - lo, 1e-9) * 65535).astype('<u2')
                if len(pv) > 65535 or not len(pt): raise ValueError('Invalid draft mesh')
                def binary(suffix, data):
                    file = Path(str(stem) + suffix); data.tofile(file)
                    return dict(file=str(file.relative_to(folder)).replace('\\', '/'), bytes=file.stat().st_size,
                                sha256=hashlib.sha256(file.read_bytes()).hexdigest())
                frame['mesh'] = dict(vertexCount=len(pv), triangleCount=len(pt), bounds=dict(min=lo.tolist(), max=hi.tolist()),
                    positions=binary('-positions.bin', quant), indices=binary('-indices.bin', pt.astype('<u2')))
            frames.append(frame)
            print(f'DRAFT {spec["id"]} {label} {time.perf_counter() - start:.2f}s', flush=True)
        records[clip['name']] = {'frames': frames}
    # Cheap semantic checks; geometry continuity is sampled at end/next using socket positions.
    for clip in clips:
        if any(not isinstance(i, int) or i < 0 or i >= len(clip['frames']) for i in clip.get('markers', {}).values()):
            warnings.add(f'{clip["name"]}: marker outside clip')
        target = next((c for c in clips if c['name'] == clip.get('next')), None)
        if clip.get('next') and (clip.get('end') != 'free' or target is None): warnings.add(f'{clip["name"]}: invalid end/next')
        if clip['name'] in records and target and target['name'] in records:
            a, b = records[clip['name']]['frames'][-1]['sockets'], records[target['name']]['frames'][0]['sockets']
            if any(math.hypot(a[n]['x'] - b[n]['x'], a[n]['y'] - b[n]['y']) > .03 for n in a.keys() & b.keys()):
                warnings.add(f'{clip["name"]}: socket discontinuity to {target["name"]}')
    save(Path(job['output']) / 'rendered.json', dict(records=records, warnings=sorted(warnings), seconds=time.perf_counter() - start, modelCacheHit=cache_hit))


if __name__ == '__main__':
    jobs = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf8'))
    for job in jobs:
        if job['render']: render_job(job)
