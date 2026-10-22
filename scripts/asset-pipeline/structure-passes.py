"""Emissive layers and sockets of a construction from a saved authoring preview Blend.

blender --background <preview.blend> --factory-startup --python structure-passes.py -- <out-dir> <layers.json>

layers.json: {"layers": {"<pass>": ["<material>", ...]}, "sockets": {"<key>": "<empty object name>"}}
Writes emission-<pass>.png per declared pass and sockets.json (normalized full-canvas x/y, world z).
Same camera, pivot and resolution as the beauty; world light and lamps off, albedo black, so only
authored emission remains. An emissive material outside the declared passes is an error.
"""
import json
import sys
from pathlib import Path
import bpy
from bpy_extras.object_utils import world_to_camera_view

GAIN = 4.0

args = sys.argv[sys.argv.index('--') + 1:]
out = Path(args[0])
config = json.loads(Path(args[1]).read_text(encoding='utf-8'))
layers = {name: set(materials) for name, materials in config['layers'].items()}
out.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
for ob in scene.objects:
    if ob.type == 'LIGHT': ob.hide_render = True
if scene.world and scene.world.node_tree:
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0
originals = {}
for mat in bpy.data.materials:
    bs = mat.node_tree.nodes.get('Principled BSDF') if mat.node_tree else None
    if bs is None: continue
    for link in list(bs.inputs['Base Color'].links): mat.node_tree.links.remove(link)
    bs.inputs['Base Color'].default_value = (0, 0, 0, 1)
    for name in ('Coat Weight', 'Specular IOR Level'):
        if name in bs.inputs: bs.inputs[name].default_value = 0
    strength = bs.inputs['Emission Strength']
    if strength.is_linked: raise ValueError(f'Animated emission is not supported: {mat.name}')
    originals[mat.name] = (strength, strength.default_value)
declared = set().union(*layers.values()) if layers else set()
unknown = {name for name, (_, value) in originals.items() if value > 0} - declared
if unknown: raise ValueError(f'Emissive material outside the declared layers: {sorted(unknown)}')
for layer, names in layers.items():
    for name, (strength, value) in originals.items():
        strength.default_value = value * GAIN if name in names else 0
    scene.render.filepath = str(out / f'emission-{layer}.png')
    bpy.ops.render.render(write_still=True)
sockets = {}
for key, name in config.get('sockets', {}).items():
    ob = scene.objects[name]
    world = ob.matrix_world.translation
    p = world_to_camera_view(scene, scene.camera, world)
    sockets[key] = {'x': round(float(p.x), 6), 'y': round(float(1 - p.y), 6), 'z': round(float(world.z), 6)}
(out / 'sockets.json').write_text(json.dumps(sockets, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passes': str(out), 'sockets': sockets}))
