"""Small CPU-only integration check. Run with Blender --background --python ... -- <output>."""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import importlib.util
import bpy
import numpy as np

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'scripts/asset-pipeline'))
definition = importlib.util.spec_from_file_location('draft', root / 'scripts/asset-pipeline/draft-v2.py')
draft = importlib.util.module_from_spec(definition); definition.loader.exec_module(draft)
out = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
out.mkdir(parents=True, exist_ok=True)
scene = draft.shared.make_scene('AOV fixture', 4)
scene.render.resolution_x = scene.render.resolution_y = 32
scene.cycles.samples = 4; scene.cycles.device = 'CPU'; scene.cycles.use_denoising = False
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, .5))
obj = bpy.context.object
m = bpy.data.materials.new('fixture'); m.use_nodes = True
bs = m.node_tree.nodes.get('Principled BSDF')
bs.inputs['Base Color'].default_value = (.2, .4, .6, 1)
bs.inputs['Emission Color'].default_value = (.1, .2, .3, 1)
bs.inputs['Emission Strength'].default_value = 2
obj.data.materials.append(m)
draft.setup_passes(scene, {'elevation': {'min': -2, 'max': 2}}, out)
scene.render.filepath = str(out / 'beauty.png')
bpy.ops.render.render(write_still=True, scene=scene.name)
for name, expected in [('albedo', [.2, .4, .6]), ('normal', [.5, .5, 1]), ('height', [.875]*3), ('emission', [.2, .4, .6])]:
    files = list(out.glob('FD_' + name + '*.exr'))
    assert len(files) == 1, (name, files)
    values = draft.read_pixels(files[0])[16, 16, :3]
    assert np.allclose(values, expected, atol=.01), (name, values, expected)
assert bs.inputs['Base Color'].default_value[0] == np.float32(.2)
print('Draft CPU AOV integration passed')
