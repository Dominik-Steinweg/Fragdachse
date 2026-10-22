"""Runtime passes of one lobby structure: beauty, albedo, elevation, emission layers, solid mask, sockets.

Usage: blender --background --factory-startup --python lobby-structure-passes.py -- job.json
job = {spec, modelHash, model, output, settings: {samples, device, denoise}, size}

One Cycles render carries the beauty plus the draft AOV contract (albedo, normal, height,
emission) and one extra `FD_layer` AOV that names each emissive material's runtime layer.
A second, cheap render without `fdNoCollide` rigging gives the solid coverage the outline is
derived from. Data passes are written without colour transforms.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util
import json

definition = importlib.util.spec_from_file_location('shape_helpers', Path(__file__).with_name('shape-v2.py'))
shape = importlib.util.module_from_spec(definition)
definition.loader.exec_module(shape)
draft = shape.draft
bpy, np = draft.bpy, draft.np

# Runtime emission layers: gating differs per layer (forge burns by day, lamps follow the night).
LAYERS = (('forge', ('Separate forge ember',)), ('lamp', ('Separate lantern emission', 'Separate window glow')),
          ('cyan', ('Separate base cyan',)))


def layer_of(material):
    for index, (_, prefixes) in enumerate(LAYERS, start=1):
        if material.name.startswith(prefixes): return index
    return 0


def add_layer_aovs(scene, temp):
    """One 0/1 weight AOV per layer: antialiased edges blend weights, never neighbouring layer ids."""
    graph = scene.compositing_node_group
    render = next(n for n in graph.nodes if n.bl_idname == 'CompositorNodeRLayers')
    materials = {m for ob in scene.objects if ob.type == 'MESH' for m in ob.data.materials if m}
    for index in range(1, len(LAYERS) + 1):
        name = f'FD_layer{index}'
        aov = scene.view_layers[0].aovs.add(); aov.name = name; aov.type = 'VALUE'
        for material in materials:
            node = material.node_tree.nodes.new('ShaderNodeOutputAOV')
            node.aov_name = name
            node.inputs['Value'].default_value = 1.0 if layer_of(material) == index else 0.0
        output = graph.nodes.new('CompositorNodeOutputFile')
        output.directory = str(temp); output.file_name = name
        output.format.media_type = 'IMAGE'; output.format.file_format = 'OPEN_EXR'
        output.format.color_mode = 'RGBA'; output.format.color_depth = '32'; output.format.exr_codec = 'ZIP'
        output.file_output_items.clear(); output.file_output_items.new('FLOAT', name)
        graph.links.new(render.outputs[name], output.inputs[0])


def render(job):
    scene, asset, _ = draft.model(job)
    shape.configure(scene, job['settings'])
    spec, out = job['spec'], Path(job['output'])
    out.mkdir(parents=True, exist_ok=True)
    temp = out / 'passes'; temp.mkdir(exist_ok=True)
    scene.render.resolution_x = scene.render.resolution_y = job['size']
    draft.setup_passes(scene, spec, temp)()
    add_layer_aovs(scene, temp)
    scene.render.filepath = str(out / 'top.png')
    bpy.ops.render.render(write_still=True, scene=scene.name)
    weights = []
    for index in range(1, len(LAYERS) + 1):
        file = next(temp.glob(f'FD_layer{index}*.exr'))
        weights.append(draft.read_pixels(file)[:, :, 0]); file.unlink()
    warnings = set()
    frame = shape.rest_passes(scene, asset, spec, out, temp, warnings, False)
    # Split the emission pass by runtime layer: RGB keeps the hue, alpha carries the intensity.
    emission = draft.read_pixels(out / 'emission.png')
    coverage = np.maximum(draft.read_pixels(out / 'top.png')[:, :, 3], 1e-6)
    rgb = emission[:, :, :3]
    peak = np.maximum(rgb.max(axis=2, keepdims=True), 1e-6)
    layers = []
    for (name, _), weight in zip(LAYERS, weights):
        share = np.clip(weight / coverage, 0, 1) * (emission[:, :, 3] > 0)
        if share.max() < .5: continue
        pixels = np.zeros_like(emission)
        pixels[:, :, :3] = np.where(share[:, :, None] > 0, rgb / peak, 0)
        pixels[:, :, 3] = np.clip(peak[:, :, 0] * 8, 0, 1) * share
        draft.png(out / f'emission-{name}.png', np.rint(pixels * 255).astype('uint8'))
        layers.append(name)
    # Solid coverage for the outline: everything except rigging players walk under.
    scene.render.use_compositing = False
    scene.view_layers[0].use_pass_combined = True
    for ob in scene.objects:
        if ob.get('fdNoCollide'): ob.hide_render = True
    scene.cycles.samples = 1; scene.cycles.use_denoising = False
    scene.render.filepath = str(out / 'solid.png')
    bpy.ops.render.render(write_still=True, scene=scene.name)
    draft.save(out / 'passes.json', dict(id=spec['id'], size=job['size'], orthoScale=spec['orthoScale'], turn=spec['model'].get('turn', 0),
               elevation=spec['elevation'], sockets=frame['sockets'], layers=layers, warnings=sorted(warnings)))


if __name__ == '__main__':
    render(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf8')))
