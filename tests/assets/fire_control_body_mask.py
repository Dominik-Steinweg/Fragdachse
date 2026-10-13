"""Fixed hardware mask from an accepted Blend, excluding the entire optical stack.

Auxiliary measurement render only; never saves or modifies the source Blend.
White = hardware, black = optical glass or emitting material, transparent = air.
"""
import argparse
import sys
from pathlib import Path
import bpy

p = argparse.ArgumentParser()
p.add_argument('--blend', required=True)
p.add_argument('--output', required=True)
a = p.parse_args(sys.argv[sys.argv.index('--')+1:])
assert not Path(a.output).exists()
bpy.ops.wm.open_mainfile(filepath=a.blend)
scene, = [s for s in bpy.data.scenes if s.get('asset_manifest')]
bpy.context.window.scene = scene
scene.frame_set(0)
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    bs = mat.node_tree.nodes.get('Principled BSDF')
    optical = (bs and bs.inputs['Emission Strength'].default_value > 0) or mat.name.startswith('Deep teal optical glass')
    mat.node_tree.nodes.clear()
    output = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
    flat = mat.node_tree.nodes.new('ShaderNodeEmission')
    flat.inputs['Color'].default_value = (0, 0, 0, 1) if optical else (1, 1, 1, 1)
    mat.node_tree.links.new(flat.outputs[0], output.inputs['Surface'])
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
scene.cycles.use_denoising = False
scene.render.filepath = a.output
bpy.ops.render.render(write_still=True)
