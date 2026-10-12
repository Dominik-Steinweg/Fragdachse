"""Model-only authoring: no motion dispatch, pose sampling, or animation keying."""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util
import json
import time
import hashlib
import math

definition = importlib.util.spec_from_file_location('draft_helpers', Path(__file__).with_name('draft-v2.py'))
draft = importlib.util.module_from_spec(definition)
definition.loader.exec_module(draft)
bpy, np = draft.bpy, draft.np


def configure(scene, settings):
    scene.render.use_persistent_data = True
    scene.cycles.samples = settings['samples']
    scene.cycles.use_denoising = settings['denoise']
    scene.cycles.denoiser = 'OPTIX' if settings['device'] == 'OPTIX' else 'OPENIMAGEDENOISE'
    scene.cycles.device = 'CPU' if settings['device'] == 'CPU' else 'GPU'
    if settings['device'] != 'CPU':
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = settings['device']
        prefs.refresh_devices()
        for device in prefs.devices: device.use = device.type == settings['device']
        if not any(device.use for device in prefs.devices): raise ValueError('Requested GPU unavailable')


def rest_passes(scene, asset, spec, folder, temp, warnings, mesh):
    """Encode the single rest frame using the established draft/runtime pass contract."""
    frame = dict(beauty='top.png', color='top.png', sockets=draft.sockets(scene, asset, warnings, 'rest'))
    coverage = draft.read_pixels(folder / 'top.png')[:, :, 3:4]
    arrays = {}
    for name in ('albedo', 'normal', 'height', 'emission'):
        files = list(temp.glob('FD_' + name + '*.exr'))
        if len(files) != 1: raise ValueError(f'Expected one AOV file: {name}')
        arrays[name] = draft.read_pixels(files[0])[:, :, :3] / np.maximum(coverage, 1e-8)
        files[0].unlink()
    height = arrays['height'][:, :, :1]
    interior = coverage[:, :, 0] > .99
    if np.any(height[:, :, 0][interior] < 0) or np.any(height[:, :, 0][interior] > 1):
        warnings.add('rest: height range clamped')
    normal = arrays['normal'] * 2 - 1
    normal /= np.maximum(np.abs(normal).sum(axis=2, keepdims=True), 1e-8)
    xy = normal[:, :, :2].copy()
    xy = np.where(normal[:, :, 2:3] < 0, (1 - np.abs(xy[:, :, ::-1])) * np.where(xy >= 0, 1, -1), xy) * .5 + .5
    color = arrays['albedo']
    color = np.where(color <= .0031308, color * 12.92, 1.055 * np.maximum(color, 0) ** (1 / 2.4) - .055)
    emission = arrays['emission'] / 8
    for name, pixels in dict(color=np.concatenate([color, coverage], axis=2),
                            elevation=np.concatenate([height, xy, coverage], axis=2),
                            emission=np.concatenate([emission, coverage * (emission.max(axis=2, keepdims=True) > .5 / 255)], axis=2)).items():
        draft.png(folder / (name + '.png'), np.rint(np.clip(pixels, 0, 1) * 255).astype('uint8'))
        frame[name] = name + '.png'
    if mesh:
        objects = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
        vertices, triangles = draft.geometry(objects)
        vertices, triangles = draft.coarse_mesh(vertices, triangles, 512)
        scale = round(spec['targetSize'] * spec.get('displayScale', 1)) / spec['orthoScale']
        vertices *= np.array([scale, -scale, scale])
        lo, hi = vertices.min(axis=0), vertices.max(axis=0)
        quant = np.rint((vertices - lo) / np.maximum(hi - lo, 1e-9) * 65535).astype('<u2')
        if len(vertices) > 65535 or not len(triangles): raise ValueError('Invalid shape mesh')
        def binary(name, data):
            file = folder / name
            data.tofile(file)
            return dict(file=name, bytes=file.stat().st_size, sha256=hashlib.sha256(file.read_bytes()).hexdigest())
        frame['mesh'] = dict(vertexCount=len(vertices), triangleCount=len(triangles), bounds=dict(min=lo.tolist(), max=hi.tolist()),
                            positions=binary('positions.bin', quant), indices=binary('indices.bin', triangles.astype('<u2')))
    return frame


def render(job):
    start = time.perf_counter()
    # Recipes receive an empty clip list. The draft helper builds only the model and
    # its construction rig, and saves it before keying. Never call render_job/author.
    scene, asset, cache_hit = draft.model(job)
    if len(bpy.data.actions): raise ValueError('Shape recipes must not author animation Actions')
    spec, settings, folder = job['spec'], job['settings'], Path(job['output'])
    configure(scene, settings)
    size = round(spec['targetSize'] * spec.get('displayScale', 1))
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    bpy.context.view_layer.update()
    warnings = set()
    temp = folder / 'passes'
    temp.mkdir(parents=True, exist_ok=True)
    needs_passes = bool(spec.get('elevation'))
    if needs_passes: draft.setup_passes(scene, spec, temp)()
    scene.render.filepath = str(folder / 'top.png')
    bpy.ops.render.render(write_still=True, scene=scene.name)
    frame = rest_passes(scene, asset, spec, folder, temp, warnings, job['exportDraft'] and bool(spec.get('materialPass'))) if needs_passes else dict(
        beauty='top.png', color='top.png', sockets=draft.sockets(scene, asset, warnings, 'rest'))
    # The side view is a diagnostic exception to the gameplay camera. Keep the
    # production lights and scale; center only its Z extent to expose the form.
    side = None
    if 'side' in job['views']:
        from mathutils import Vector
        deps = bpy.context.evaluated_depsgraph_get()
        points = [obj.evaluated_get(deps).matrix_world @ Vector(p) for obj in scene.objects
                  if obj.type == 'MESH' and not obj.hide_render for p in obj.evaluated_get(deps).bound_box]
        lo = [min(p[i] for p in points) for i in range(3)]
        hi = [max(p[i] for p in points) for i in range(3)]
        center = Vector((0, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))
        scene.camera.location = center + Vector((max(spec['orthoScale'], hi[0] - lo[0]) * 2, 0, 0))
        scene.camera.rotation_euler = (center - scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.camera.data.ortho_scale = max(spec['orthoScale'], (hi[1] - lo[1]) * 1.05, (hi[2] - lo[2]) * 1.05)
        if needs_passes: scene.render.use_compositing = False
        scene.render.filepath = str(folder / 'side.png')
        bpy.ops.render.render(write_still=True, scene=scene.name)
        side = dict(orthoScale=scene.camera.data.ortho_scale, center=list(center))
    draft.save(folder / 'rendered.json', dict(frame=frame, modelCacheHit=cache_hit, actionCount=len(bpy.data.actions),
               side=side, warnings=sorted(warnings), seconds=time.perf_counter() - start))


if __name__ == '__main__':
    render(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf8')))
