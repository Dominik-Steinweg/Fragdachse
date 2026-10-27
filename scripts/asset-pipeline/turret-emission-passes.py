"""Emission pass of a selected rigid sheet asset (turrets): what glows in every sheet frame, nothing else.

Run by turret-emission.mjs on the selected, archived asset.blend: the scene renders once more per frame with
every light hidden and a black world, so only emissive surfaces remain, occluded by the geometry in front
of them and at the strength the clip keyed for that frame. Each master is stored as PNG: RGB the normalized
hue (sRGB), alpha the intensity (peak radiance / range), the encoding of the fort's emission layers.
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


def srgb(linear):
    return np.where(linear <= .0031308, linear * 12.92, 1.055 * np.power(np.maximum(linear, 0), 1 / 2.4) - .055)


frames = []
for frame in job['frames']:
    blender_frame = frame['blenderFrame']
    scene.frame_set(math.floor(blender_frame), subframe=blender_frame % 1)
    exr = out / f'emission-{frame["index"]:04d}.exr'
    scene.render.filepath = str(exr)
    bpy.ops.render.render(write_still=True)
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

(out / 'emission.json').write_text(json.dumps({'range': emission_range, 'encoding': 'srgb-hue-alpha-intensity', 'frames': frames},
                                              indent=2) + '\n', encoding='utf8')
print('EMISSION_PASS_OK', len(frames))
