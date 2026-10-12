"""Compare original/current recipe defaults with the production camera, lights and samples.

Blender --background --python tests/assets/verify_shape_production.py -- <original recipe.py>
Outputs only disposable shape proof files; never touches production builds.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import importlib.util
import json
import hashlib

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'scripts/asset-pipeline'))
definition = importlib.util.spec_from_file_location('shape', root / 'scripts/asset-pipeline/shape-v2.py')
shape = importlib.util.module_from_spec(definition)
definition.loader.exec_module(shape)
original = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
catalog = json.loads((root / 'scripts/asset-pipeline/catalog-v2.json').read_text(encoding='utf8'))
spec = next(a for a in catalog['assets'] if a['id'] == 'abyssal-kraken')
folder = root / 'art/poc/pipeline-v2/shapes/production-proof'
folder.mkdir(parents=True, exist_ok=True)
hashes = {}
geometry_hashes = {}
geometries = {}
images = {}
for name, recipe in [('before', str(original.with_suffix(''))), ('after', spec['recipe'])]:
    resolved = dict(spec, recipe=recipe)
    # Unique cache key forces both recipes to construct geometry independently.
    key = hashlib.sha256((original.read_text(encoding='utf8') if name == 'before' else
                          (root / 'scripts/asset-pipeline/recipes_v2/abyssal-kraken.py').read_text(encoding='utf8')).encode()).hexdigest()
    scene, asset, _ = shape.draft.model(dict(spec=resolved, model=str(folder / (name + '-' + key + '.blend')), modelHash=key))
    assert 'draft' not in resolved
    shape.draft.motions_v2.author(asset, spec['clips'])
    scene.frame_set(0)
    vertices, triangles = shape.draft.geometry([o for o in scene.objects if o.type == 'MESH' and not o.hide_render])
    # Blender's evaluated triangle enumeration can differ between independent
    # builds. Compare the same indexed surface irrespective of that enumeration.
    canonical = shape.np.sort(triangles, axis=1)
    canonical = canonical[shape.np.lexsort((canonical[:, 2], canonical[:, 1], canonical[:, 0]))]
    geometry_hashes[name] = hashlib.sha256(vertices.tobytes() + canonical.tobytes()).hexdigest()
    geometries[name] = (vertices, triangles)
    assert scene.render.resolution_x == 1024 and scene.cycles.samples == 64
    # Select GPU only. All production render and denoising defaults stay untouched.
    prefs = shape.bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'; prefs.refresh_devices()
    for device in prefs.devices: device.use = device.type == 'OPTIX'
    scene.cycles.device = 'GPU'
    scene.render.filepath = str(folder / (name + '.png'))
    if '--geometry-only' not in sys.argv: shape.bpy.ops.render.render(write_still=True, scene=scene.name)
    pixels = shape.draft.read_pixels(scene.render.filepath)
    images[name] = shape.np.rint(pixels * 255).astype('int16')
    hashes[name] = hashlib.sha256(pixels.tobytes()).hexdigest()
# Cycles/OIDN parallel reductions can move a few PNG channels by one quantization
# step. A repeat of the unchanged scene measures that noise independently.
scene.render.filepath = str(folder / 'repeat.png')
if '--geometry-only' not in sys.argv: shape.bpy.ops.render.render(write_still=True, scene=scene.name)
repeat = shape.np.rint(shape.draft.read_pixels(scene.render.filepath) * 255).astype('int16')
def delta(a, b):
    values = shape.np.abs(a - b)
    return dict(changedChannels=int(shape.np.count_nonzero(values)), maxChannelDelta=int(values.max()), meanChannelDelta=float(values.mean()))
comparison, noise = delta(images['before'], images['after']), delta(images['after'], repeat)
a, b = geometries['before'], geometries['after']
geometry_difference = dict(verticesBefore=len(a[0]), verticesAfter=len(b[0]), trianglesBefore=len(a[1]), trianglesAfter=len(b[1]),
    maxPositionDelta=float(shape.np.max(shape.np.abs(a[0] - b[0]))) if a[0].shape == b[0].shape else None,
    identicalIndices=bool(shape.np.array_equal(a[1], b[1])))
shape.draft.save(folder / 'comparison.json', dict(asset=spec['id'], frame=0, resolution=1024, samples=64,
                pixelHashes=hashes, pixelIdentical=hashes['before'] == hashes['after'], geometryHashes=geometry_hashes,
                geometryIdentical=geometry_hashes['before'] == geometry_hashes['after'], geometryDifference=geometry_difference,
                comparison=comparison, unchangedRepeat=noise))
assert geometry_hashes['before'] == geometry_hashes['after'], geometry_hashes
assert comparison['maxChannelDelta'] <= 1 and comparison['meanChannelDelta'] < .0001, comparison
print('Production geometry identical; pixel comparison: ' + str(comparison), flush=True)
