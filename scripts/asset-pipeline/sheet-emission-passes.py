"""Emission pass of a selected sheet asset (turrets, enemies): what glows in every sheet frame, nothing else.

Run by sheet-emission.mjs on the selected, archived asset.blend (or an authoring preview.blend): the scene
renders once more per frame with every light hidden and a black world, so only emissive surfaces remain,
occluded by the geometry in front of them and at the strength the clip keyed for that frame. Each master
is stored as PNG: RGB the normalized hue (sRGB), alpha the intensity (peak radiance / range), the encoding
of the fort's emission layers.

`channel` (optional) keeps only materials whose custom property FD_EmissionChannel equals it; every other
material becomes a black occluder. `neutral` (requires a channel) replaces those emitters by white emission
of strength 1: with range 1 the sheet is a tintable coverage mask that the runtime fades and colours.
`zones` (requires `neutral`) assigns every channel surface to a stage by its object's name: the emitter of
stage k of n is (linear(k / n), 0, 1), so the stored (sRGB) red of the normalized hue is k / n, evenly spaced
codes for every stage, while alpha stays the coverage. The runtime lights the zones up to a stage
(encoding `srgb-zone-alpha-coverage`).
"""
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
job = json.loads(Path(args[0]).read_text(encoding='utf8'))
out = Path(job['output'])
out.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
if 'asset_manifest' not in scene:
    # Library-written previews may open on another scene; the asset scene carries its manifest.
    scene = next(s for s in bpy.data.scenes if 'asset_manifest' in s)
    bpy.context.window.scene = scene

prefs = bpy.context.preferences.addons['cycles'].preferences
if job.get('device', 'OPTIX') != 'CPU':
    prefs.compute_device_type = job.get('device', 'OPTIX')
    prefs.refresh_devices()
    for d in prefs.devices:
        d.use = d.type == prefs.compute_device_type
    scene.cycles.device = 'GPU'

# Emission only: no light reaches any surface, so diffuse and specular render black.
for ob in scene.objects:
    if ob.type == 'LIGHT':
        ob.hide_render = True
world = bpy.data.worlds.new('Emission pass black world')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
scene.world = world
scene.cycles.samples = job.get('samples', 32)
scene.cycles.use_denoising = False
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.render.image_settings.file_format = 'OPEN_EXR'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '32'

emission_range = float(job.get('range', 2.0))
channel, neutral = job.get('channel'), bool(job.get('neutral'))
zones = job.get('zones')
if neutral and not channel:
    raise ValueError('A neutral emission mask needs a channel')
if zones and not neutral:
    raise ValueError('Emission zones need a neutral channel mask')


def emitter(name, color, strength):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    for node in list(nodes):
        if node.type != 'OUTPUT_MATERIAL':
            nodes.remove(node)
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = color
    emission.inputs['Strength'].default_value = strength
    links.new(emission.outputs[0], nodes['Material Output'].inputs['Surface'])
    return material


def linear(srgb_value):
    """Linear value whose sRGB code is `srgb_value`."""
    return srgb_value / 12.92 if srgb_value <= .04045 else ((srgb_value + .055) / 1.055) ** 2.4


def zone_of(name):
    """Stage of an object by its recipe part name (a prefix also matches Blender's .001 copies)."""
    for zone in zones:
        if any(name == prefix or name.startswith(prefix + '.') for prefix in zone['objects']):
            return zone['stage']
    return None


channel_materials = set()
zone_objects = {}
if channel:
    occluder = emitter('Emission pass black occluder', (0, 0, 0, 1), 0)
    mask = emitter(f'Emission pass {channel} mask', (1, 1, 1, 1), 1) if neutral else None
    stage_count = max(zone['stage'] for zone in zones) if zones else 0
    zone_masks = {zone['stage']: emitter(f'Emission pass {channel} zone {zone["stage"]}', (linear(zone['stage'] / stage_count), 0, 1, 1), 1)
                  for zone in zones} if zones else {}
    generated = {occluder, mask, *zone_masks.values()}
    for ob in scene.objects:
        if ob.type != 'MESH' or ob.hide_render:
            continue
        for slot in ob.material_slots:
            material = slot.material
            if material is None or material in generated:
                continue
            if material.get('FD_EmissionChannel') == channel:
                channel_materials.add(material.name)
                # A coloured channel pass keeps the authored (possibly keyed) emission graph unchanged.
                if zones:
                    stage = zone_of(ob.name)
                    if stage is None:
                        raise ValueError(f'Channel surface on {ob.name} belongs to no emission zone')
                    zone_objects.setdefault(stage, set()).add(ob.name)
                    slot.material = zone_masks[stage]
                elif neutral:
                    slot.material = mask
            else:
                slot.material = occluder
    if not channel_materials:
        raise ValueError(f'No material carries FD_EmissionChannel = {channel}')
    for zone in zones or []:
        if zone['stage'] not in zone_objects:
            raise ValueError(f'Emission zone {zone["stage"]} matches no channel surface')


def srgb(linear):
    return np.where(linear <= .0031308, linear * 12.92, 1.055 * np.power(np.maximum(linear, 0), 1 / 2.4) - .055)


frames = []
for frame in job['frames']:
    blender_frame = frame['blenderFrame']
    scene.frame_set(math.floor(blender_frame), subframe=blender_frame % 1)
    exr = out / f'emission-{frame["index"]:04d}.exr'
    scene.render.filepath = str(exr)
    bpy.ops.render.render(write_still=True, scene=scene.name)
    image = bpy.data.images.load(str(exr))
    width, height = image.size
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
    bpy.data.images.remove(image)
    rgb = pixels[:, :, :3]
    peak = rgb.max(axis=2)
    hue = np.where(peak[:, :, None] > 1e-6, rgb / np.maximum(peak[:, :, None], 1e-6), 0)
    encoded = np.zeros_like(pixels)
    encoded[:, :, :3] = np.clip(srgb(hue), 0, 1)
    encoded[:, :, 3] = np.clip(peak / emission_range, 0, 1)
    png = out / f'emission-{frame["index"]:04d}.png'
    target = bpy.data.images.new(png.stem, width, height, alpha=True, float_buffer=False)
    target.colorspace_settings.name = 'Non-Color'
    target.pixels.foreach_set(encoded.ravel())
    target.filepath_raw = str(png)
    target.file_format = 'PNG'
    target.save()
    bpy.data.images.remove(target)
    exr.unlink()
    frames.append({'index': frame['index'], 'file': png.name, 'peak': float(peak.max())})

report = {'range': emission_range, 'encoding': 'srgb-zone-alpha-coverage' if zones else 'srgb-hue-alpha-intensity', 'frames': frames}
if channel:
    report.update(channel=channel, neutral=neutral, channelMaterials=sorted(channel_materials))
if zones:
    report.update(zones=[{'stage': stage, 'objects': sorted(names)} for stage, names in sorted(zone_objects.items())])
(out / 'emission.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
print('EMISSION_PASS_OK', len(frames))
