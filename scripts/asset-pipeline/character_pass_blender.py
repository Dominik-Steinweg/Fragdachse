"""Additive character passes. Open only a copied source blend; never save over it.

All render/intermediate outputs live below the explicit external output directory.
Beauty uses the immutable source masters. This module does not call the V2 builder.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import time
import zlib

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n', encoding='utf8')


def png(path, pixels):
    """Raw data PNG: no display transform, alpha association or colour profile."""
    import numpy as np
    data = np.asarray(pixels, dtype=np.uint8)
    h, w = data.shape[:2]
    channels = 1 if data.ndim == 2 else data.shape[2]
    if channels not in (1, 4):
        raise ValueError('Expected grayscale or RGBA pixels')
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)
    rows = b''.join(b'\0' + data[y].tobytes() for y in range(h))
    raw = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0 if channels == 1 else 6, 0, 0, 0))
    Path(path).write_bytes(raw + chunk(b'IDAT', zlib.compress(rows, 6)) + chunk(b'IEND', b''))


def sample(scene, value):
    scene.frame_set(math.floor(value), subframe=value % 1)


def evaluated_vertices(scene, objects):
    import bpy
    import numpy as np
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    arrays = []
    for ob in objects:
        evaluated = ob.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        try:
            a = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
            mesh.vertices.foreach_get('co', a)
            a = a.reshape(-1, 3)
            matrix = np.asarray(evaluated.matrix_world, dtype=np.float64)
            arrays.append(a @ matrix[:3, :3].T + matrix[:3, 3])
        finally:
            evaluated.to_mesh_clear()
    if not arrays:
        raise ValueError('No caster geometry')
    return np.concatenate(arrays)


def projected_canvases(scene, objects, render, spec):
    """Union evaluated geometry over ALL poses, padded for the entire solar disk."""
    import numpy as np
    c = spec['coordinates']
    scale = c['bodyCanvasWorldPx'] / c['bodyOrthoScaleBlender']
    density = spec['shadow']['texelsPerWorldPx']
    ground = c['groundZBlender']
    extents = [[math.inf, math.inf, -math.inf, -math.inf] for _ in range(48)]
    half_angle = math.radians(spec['shadow']['sunAngularDiameterDegrees'] / 2)
    minimum_z, maximum_z = math.inf, -math.inf
    for frame in render['frames']:
        sample(scene, frame['blenderFrame'])
        points = evaluated_vertices(scene, objects)
        minimum_z = min(minimum_z, float(points[:, 2].min()))
        maximum_z = max(maximum_z, float(points[:, 2].max()))
        x, y = points[:, 0] * scale, -points[:, 1] * scale
        h = np.maximum(0, points[:, 2] - ground) * scale
        for j, elevation in enumerate(spec['grid']['elevationDegrees']):
            e = math.radians(elevation)
            # Conservative bound on the projection displacement across the light cone.
            penumbra = float(h.max()) * (1 / math.tan(e - half_angle) - 1 / math.tan(e))
            pad = spec['shadow']['paddingWorldPx'] + penumbra
            for i, azimuth in enumerate(spec['grid']['azimuthDegrees']):
                a = math.radians(azimuth)
                px = x - h * math.cos(a) / math.tan(e)
                py = y - h * math.sin(a) / math.tan(e)
                b = extents[j * 16 + i]
                b[0] = min(b[0], float(px.min()) - pad)
                b[1] = min(b[1], float(py.min()) - pad)
                b[2] = max(b[2], float(px.max()) + pad)
                b[3] = max(b[3], float(py.max()) + pad)
    canvases = []
    for index, b in enumerate(extents):
        x0, y0 = math.floor(b[0] * density) / density, math.floor(b[1] * density) / density
        x1, y1 = math.ceil(b[2] * density) / density, math.ceil(b[3] * density) / density
        width, height = round((x1 - x0) * density), round((y1 - y0) * density)
        canvases.append(dict(azimuthIndex=index % 16, elevationIndex=index // 16,
                             boundsWorld=[x0, y0, x1, y1], width=width, height=height,
                             texelsPerWorldPx=density, pivotPx=[-x0 * density, -y0 * density],
                             pixelToWorld=[1 / density, 0, 0, 1 / density, x0, y0]))
    return canvases, dict(minZBlender=minimum_z, maxZBlender=maximum_z,
                          evaluatedPoses=len(render['frames']), worldPxPerBlenderUnit=scale)


def emission_material(name, mode, spec):
    import bpy
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    emission = nodes.new('ShaderNodeEmission')
    links.new(emission.outputs[0], output.inputs['Surface'])
    if mode == 'normal':
        geometry = nodes.new('ShaderNodeNewGeometry')
        multiply = nodes.new('ShaderNodeVectorMath'); multiply.operation = 'MULTIPLY'
        multiply.inputs[1].default_value = (.5, -.5, .5)
        add = nodes.new('ShaderNodeVectorMath'); add.operation = 'ADD'
        add.inputs[1].default_value = (.5, .5, .5)
        links.new(geometry.outputs['Normal'], multiply.inputs[0])
        links.new(multiply.outputs[0], add.inputs[0])
        links.new(add.outputs[0], emission.inputs['Color'])
    elif mode == 'ao':
        ao = nodes.new('ShaderNodeAmbientOcclusion')
        ao.samples = spec['material']['aoSamples']
        ao.inputs['Distance'].default_value = spec['material']['aoDistanceBlender']
        ao.only_local = False
        links.new(ao.outputs['AO'], emission.inputs['Color'])
    return material


def unlit_copy(material, report):
    """Explicit adapter for archived V2 node graphs, with a reachable-graph audit."""
    result = material.copy()
    result.name = 'FD_Albedo_' + material.name
    nodes, links = result.node_tree.nodes, result.node_tree.links
    removed = []
    for node in list(nodes):
        temperature = node.type == 'MIX_RGB' and node.inputs[2].is_linked and node.inputs[2].links[0].from_node.name == 'Cool sides and warm crown'
        if node.name in ('Form shadow strength', 'Painted contact depth') or temperature:
            source = node.inputs[1]
            for link in list(node.outputs[0].links):
                target = link.to_socket
                links.remove(link)
                if source.is_linked:
                    links.new(source.links[0].from_socket, target)
                else:
                    target.default_value = source.default_value
            removed.append(node.name)
    bs = nodes.get('Principled BSDF')
    if bs is None:
        raise ValueError('Unsupported material without explicit albedo: ' + material.name)
    strength = bs.inputs['Emission Strength']
    if strength.is_linked or strength.default_value != 0:
        raise ValueError('Emissive material needs a separate emission contract: ' + material.name)
    color = bs.inputs['Base Color']
    reachable = set()
    def visit(socket):
        for link in socket.links:
            node = link.from_node
            if node in reachable:
                continue
            reachable.add(node)
            if node.type in ('AMBIENT_OCCLUSION', 'LAYER_WEIGHT', 'FRESNEL') or (node.type == 'NEW_GEOMETRY' and link.from_socket.name in ('Normal', 'True Normal', 'Incoming')):
                raise ValueError('Residual form lighting in albedo: ' + material.name + '/' + node.name)
            for input_socket in node.inputs:
                visit(input_socket)
    visit(color)
    emission = nodes.new('ShaderNodeEmission'); emission.name = 'FD_Albedo_Output'
    if color.is_linked:
        links.new(color.links[0].from_socket, emission.inputs['Color'])
    else:
        emission.inputs['Color'].default_value = color.default_value
    for output in [n for n in nodes if n.type == 'OUTPUT_MATERIAL']:
        links.new(emission.outputs[0], output.inputs['Surface'])
    report.append(dict(material=material.name, bypassed=removed, reachableNodes=len(reachable),
                       emissionStrength=0, albedoPolicy='base color including texture; no form light, AO or specular',
                       aoPolicy='raw ambient visibility; 1=open, 0=occluded; no artistic contrast bake'))
    return result


def render_float(scene, output, label):
    import bpy
    import numpy as np
    from render_integrity import inspect_float, pass_key, restore, store
    destination = output / 'intermediate' / (label + '.exr')
    destination.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(destination)
    start = time.perf_counter()
    key = pass_key(scene, label)
    cached = bool(key and restore(scene['fd_pass_cache_root'], key, destination))
    counter = 'fd_cache_hits' if cached else 'fd_cache_misses'
    scene[counter] = scene.get(counter, 0) + 1
    if not cached:
        bpy.ops.render.render(write_still=True, scene=scene.name)
    elapsed = time.perf_counter() - start
    image = bpy.data.images.load(str(destination), check_existing=False)
    try:
        image.colorspace_settings.name = 'Non-Color'
        w, h = image.size
        pixels = np.empty(w * h * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape(h, w, 4)[::-1].copy()
        inspect_float(pixels, label.split('-')[0])
    finally:
        bpy.data.images.remove(image)
    if key and not cached:
        store(scene['fd_pass_cache_root'], key, destination)
    return pixels, elapsed


def reduce_blocks(pixels, factor):
    h, w = pixels.shape[:2]
    return pixels.reshape(h // factor, factor, w // factor, factor, *pixels.shape[2:]).mean(axis=(1, 3))


def extend_normal_edges(normals, ao, coverage, iterations=2):
    """Non-PMA data needs valid vectors beside transparent body pixels for bilinear sampling."""
    import numpy as np
    valid = coverage[:, :, 0] > 1e-6
    for _ in range(iterations):
        count = np.zeros(valid.shape, dtype=np.float32)
        vector = np.zeros_like(normals); ambient = np.zeros_like(ao)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            shifted = np.roll(valid, (dy, dx), axis=(0, 1))
            if dy == -1: shifted[-1] = False
            if dy == 1: shifted[0] = False
            if dx == -1: shifted[:, -1] = False
            if dx == 1: shifted[:, 0] = False
            count += shifted
            vector += np.roll(normals, (dy, dx), axis=(0, 1)) * shifted[:, :, None]
            ambient += np.roll(ao, (dy, dx), axis=(0, 1)) * shifted[:, :, None]
        fill = ~valid & (count > 0)
        vector /= np.maximum(np.linalg.norm(vector, axis=2, keepdims=True), 1e-8)
        ambient /= np.maximum(count[:, :, None], 1)
        normals[fill] = vector[fill]; ao[fill] = ambient[fill]
        valid |= fill


def main():
    import bpy
    import numpy as np
    from mathutils import Vector
    parser = argparse.ArgumentParser()
    parser.add_argument('--job', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    job_file = Path(args.job).resolve()
    job = json.loads(job_file.read_text(encoding='utf8'))
    output = job_file.parent
    if output.parent != Path(job['outputRoot']).resolve() or output == Path(job['repo']).resolve():
        raise ValueError('Job outside declared external output root')
    spec = job['spec']; render = job['render']
    if Path(bpy.data.filepath).resolve() != output / 'source.blend' or sha(output / 'source.blend') != job['source']['blendSha256']:
        raise ValueError('Open only the verified copied blend')
    scenes = [s for s in bpy.data.scenes if s.get('inputHash') == render['inputHash'] and s.get('asset_manifest')]
    if len(scenes) != 1:
        raise ValueError('Ambiguous or missing archived asset scene')
    scene = scenes[0]; bpy.context.window.scene = scene
    if scene.camera.data.type != 'ORTHO' or any(abs(v) > 1e-7 for v in scene.camera.rotation_euler):
        raise ValueError('Camera must retain exact top-down orthography')
    if abs(scene.camera.data.ortho_scale - spec['coordinates']['bodyOrthoScaleBlender']) > 1e-5:
        raise ValueError('Source camera differs from pass contract')
    if list(scene.get('pivot', [])) != [.5, .5]:
        raise ValueError('Source pivot mismatch')
    from render_integrity import configure_cache, provenance
    configure_cache(scene, job, output)
    objects = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
    canvases, geometry = projected_canvases(scene, objects, render, spec)
    scene.render.engine = 'CYCLES'; scene.cycles.use_denoising = False
    scene.cycles.seed = spec['shadow']['seed']; scene.cycles.samples = spec['shadow']['samples']
    scene.render.use_persistent_data = False
    device = job['device']
    if device != 'CPU':
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = device; prefs.get_devices()
        found = False
        for item in prefs.devices:
            item.use = item.type == device
            found = found or item.use
        if not found:
            raise ValueError('Requested Cycles device unavailable: ' + device)
        scene.cycles.device = 'GPU'
    else:
        scene.cycles.device = 'CPU'
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_mode = 'RGBA'; scene.render.image_settings.color_depth = '32'
    scene.render.image_settings.exr_codec = 'ZIP'
    scene.view_settings.view_transform = 'Raw'; scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0; scene.view_settings.gamma = 1
    scene.use_nodes = False
    for light in [o for o in scene.objects if o.type == 'LIGHT']:
        light.hide_render = True
    world = bpy.data.worlds.new('FD_pass_black_world'); world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
    scene.world = world
    material_audit = []
    originals = {o: [slot.material for slot in o.material_slots] for o in objects}
    unique_materials = sorted({m for mats in originals.values() for m in mats if m}, key=lambda m: m.name)
    albedos = {m: unlit_copy(m, material_audit) for m in unique_materials}
    normal_mat = emission_material('FD_normal', 'normal', spec)
    ao_mat = emission_material('FD_ao', 'ao', spec)
    manifest = dict(schema='fd-character-passes', version=1,
                    status='production-unreviewed' if spec['status'] == 'production' else 'pilot-unreviewed', spec=spec,
                    sourceFrameCount=len(job['render']['frames']),
                    source=job['source'], poses=job['poses'], canvases=canvases, images=[],
                    geometry=geometry, materialAudit=material_audit, timings=[], blenderVersion=bpy.app.version_string,
                    device=device, masterColorSpace='linear float EXR; premultiplied coverage', sourceBlendUntouched=True,
                    provenance=provenance(scene, job['source']))
    def record(pass_name, pose, pixels, encoding, canvas_index=None):
        h, w = pixels.shape[:2]
        name = f'{pass_name}/pose-{pose:02d}-' + (f'light-{canvas_index:02d}' if canvas_index is not None else str(w)) + '.png'
        png(output / name, pixels)
        image = dict(file=name, pass_name=pass_name, pose=pose, width=w, height=h,
                     channels=1 if pixels.ndim == 2 else 4, encoding=encoding, premultiplied=False,
                     sha256=sha(output / name), downloadBytes=(output / name).stat().st_size, gpuBytesRGBA8=w * h * 4)
        image['pass'] = image.pop('pass_name')
        if canvas_index is not None:
            image['canvasIndex'] = canvas_index
        manifest['images'].append(image)
        write_json(output / 'render-passes.partial.json', manifest)
        print(f'FD_PASS {pass_name} pose={pose} light={canvas_index} {w}x{h}', flush=True)
    # Material jobs: the original camera and body canvas stay fixed.
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = spec['material']['masterSize']
    scene.cycles.samples = spec['material']['samples']
    for mode in ('albedo', 'normal', 'ao'):
        for ob, mats in originals.items():
            for i, material in enumerate(mats):
                ob.material_slots[i].material = albedos[material] if mode == 'albedo' else normal_mat if mode == 'normal' else ao_mat
            ob.update_tag(refresh={'DATA'})
        bpy.context.view_layer.update()
        for pose in job['poses']:
            sample(scene, pose['blenderFrame'])
            pixels, seconds = render_float(scene, output, f'{mode}-{pose["index"]:02d}')
            np.save(output/'intermediate'/f'{mode}-{pose["index"]:02d}.npy', pixels)
            manifest['timings'].append(dict(pass_name=mode, pose=pose['index'], seconds=seconds))
    for pose in job['poses']:
        values = {mode: np.load(output/'intermediate'/f'{mode}-{pose["index"]:02d}.npy') for mode in ('albedo', 'normal', 'ao')}
        for size in spec['material']['sourceSizes']:
            factor = spec['material']['masterSize'] // size
            a = reduce_blocks(values['albedo'], factor)
            normal = reduce_blocks(values['normal'], factor)
            ao = reduce_blocks(values['ao'], factor)
            if np.max(np.abs(a[:, :, 3] - normal[:, :, 3])) > .025 or np.max(np.abs(a[:, :, 3] - ao[:, :, 3])) > .025:
                raise ValueError('Material coverage mismatch')
            coverage = a[:, :, 3:4]
            divisor = np.maximum(coverage, 1e-8)
            rgb = np.clip(a[:, :, :3] / divisor, 0, 1)
            srgb = np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055)
            rgba = np.concatenate([srgb, coverage], axis=2)
            normals = normal[:, :, :3] / np.maximum(normal[:, :, 3:4], 1e-8) * 2 - 1
            normals /= np.maximum(np.linalg.norm(normals, axis=2, keepdims=True), 1e-8)
            normals[coverage[:, :, 0] < 1e-6] = [0, 0, 1]
            ambient = np.clip(ao[:, :, :1] / np.maximum(ao[:, :, 3:4], 1e-8), 0, 1)
            ambient[coverage < 1e-6] = 1
            extend_normal_edges(normals, ambient, coverage)
            data = np.concatenate([normals * .5 + .5, ambient], axis=2)
            record('albedo', pose['index'], np.rint(np.clip(rgba, 0, 1) * 255).astype('uint8'), spec['material']['albedo']['encoding'])
            record('normal', pose['index'], np.rint(np.clip(data, 0, 1) * 255).astype('uint8'), spec['material']['normal']['encoding'])
    # A matte white receiver measures only direct sun. Opaque black casters cannot tint it.
    scene.render.film_transparent = False
    scene.cycles.samples = spec['shadow']['samples']
    scene.cycles.max_bounces = 1; scene.cycles.diffuse_bounces = 0; scene.cycles.glossy_bounces = 0
    receiver = bpy.data.materials.new('FD_white_receiver'); receiver.use_nodes = True
    nodes = receiver.node_tree.nodes; nodes.clear()
    diffuse = nodes.new('ShaderNodeBsdfDiffuse'); diffuse.inputs['Color'].default_value = (1, 1, 1, 1)
    out = nodes.new('ShaderNodeOutputMaterial'); receiver.node_tree.links.new(diffuse.outputs[0], out.inputs['Surface'])
    opaque = receiver.copy(); opaque.name = 'FD_opaque_caster'
    opaque.node_tree.nodes.get('Diffuse BSDF').inputs['Color'].default_value = (0, 0, 0, 1)
    for ob in objects:
        ob.visible_camera = False; ob.visible_shadow = True
        for slot in ob.material_slots:
            slot.material = opaque
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, spec['coordinates']['groundZBlender']))
    plane = bpy.context.object; plane.name = 'FD_shadow_receiver'; plane.data.materials.append(receiver)
    lamp_data = bpy.data.lights.new('FD_directional_sun', 'SUN')
    lamp_data.energy = 1; lamp_data.angle = math.radians(spec['shadow']['sunAngularDiameterDegrees'])
    lamp = bpy.data.objects.new('FD_directional_sun', lamp_data); scene.collection.objects.link(lamp)
    scale = geometry['worldPxPerBlenderUnit']; ss = spec['shadow']['supersample']
    for index, canvas in enumerate(canvases):
        x0, y0, x1, y1 = canvas['boundsWorld']
        scene.camera.location = ((x0 + x1) / (2 * scale), -(y0 + y1) / (2 * scale), 8)
        # AUTO sensor fit uses the larger image dimension for orthographic scale.
        scene.camera.data.sensor_fit = 'AUTO'
        scene.camera.data.ortho_scale = max(x1 - x0, y1 - y0) / scale
        scene.render.resolution_x = canvas['width'] * ss; scene.render.resolution_y = canvas['height'] * ss
        bpy.context.view_layer.update()
        # Verify Blender's actual pixel-to-ground mapping, not an assumed camera convention.
        from bpy_extras.object_utils import world_to_camera_view
        p0 = world_to_camera_view(scene, scene.camera, Vector((x0 / scale, -y1 / scale, spec['coordinates']['groundZBlender'])))
        p1 = world_to_camera_view(scene, scene.camera, Vector((x1 / scale, -y0 / scale, spec['coordinates']['groundZBlender'])))
        if max(abs(p0.x), abs(p0.y), abs(p1.x - 1), abs(p1.y - 1)) > 1e-4:
            raise ValueError('Orthographic canvas projection mismatch')
        a = math.radians(spec['grid']['azimuthDegrees'][canvas['azimuthIndex']])
        e = math.radians(spec['grid']['elevationDegrees'][canvas['elevationIndex']])
        toward_light = Vector((math.cos(a) * math.cos(e), -math.sin(a) * math.cos(e), math.sin(e)))
        lamp.rotation_euler = (-toward_light).to_track_quat('-Z', 'Y').to_euler()
        for ob in objects:
            ob.visible_shadow = False
        baseline, seconds = render_float(scene, output, f'receiver-{index:02d}')
        manifest['timings'].append(dict(pass_name='receiver', canvasIndex=index, seconds=seconds))
        baseline = baseline[:, :, :3].mean(axis=2)
        if baseline.min() < .01:
            raise ValueError('Unlit or clipped receiver')
        for ob in objects:
            ob.visible_shadow = True
        for pose in job['poses']:
            sample(scene, pose['blenderFrame'])
            shaded, seconds = render_float(scene, output, f'shadow-{pose["index"]:02d}-{index:02d}')
            coverage = np.clip(1 - shaded[:, :, :3].mean(axis=2) / baseline, 0, 1)
            mask = np.rint(reduce_blocks(coverage, ss) * 255).astype('uint8')
            edge = max(mask[:2].max(), mask[-2:].max(), mask[:, :2].max(), mask[:, -2:].max())
            if edge > 4 or mask.max() < 64:
                raise ValueError(f'Clipped or empty shadow: pose={pose["index"]}, light={index}, edge={edge}')
            manifest['timings'].append(dict(pass_name='shadow', pose=pose['index'], canvasIndex=index, seconds=seconds))
            record('shadow', pose['index'], mask, spec['shadow']['encoding'], index)
    if sha(output / 'source.blend') != job['source']['blendSha256']:
        raise ValueError('Copied source unexpectedly changed')
    write_json(output / 'render-passes.json', manifest)
    print('FD_CHARACTER_PASSES_COMPLETE ' + str(output / 'render-passes.json'), flush=True)


if __name__ == '__main__':
    main()
