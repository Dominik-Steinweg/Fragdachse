"""Production Kraken passes. Beauty remains the immutable coverage/reference master.

All evaluated poses are range-checked before rendering. Mesh topology is per pose;
coordinates are world pixels (X right, Y south, Z up), independent of atlas trim.
"""
import math
import hashlib
import bpy
import numpy as np
from character_pass_blender import png
from elevation_v2 import read_pixels
from kraken_ls_export import geometry, proxy, render_float
from kraken_ls_material import adapt

ENCODING = 'linear-unorm8-z-oct-normal-v1'


def height_range(scene, samples):
    objects = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
    lo, hi = math.inf, -math.inf
    for sample in samples:
        value = sample['blenderFrame']
        scene.frame_set(math.floor(value), subframe=value % 1)
        bpy.context.view_layer.update()
        vertices, _ = geometry(objects)
        lo = min(lo, float(vertices[:, 2].min()))
        hi = max(hi, float(vertices[:, 2].max()))
    return math.floor((lo - .1) * 10) / 10, math.ceil((hi + .1) * 10) / 10


def render_passes(scene, folder, index, spec, beauty_file):
    objects = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
    materials = list({m for ob in objects for m in ob.data.materials if m})
    vertices, triangles = geometry(objects)
    height = spec['elevation']
    if vertices[:, 2].min() <= height['min'] or vertices[:, 2].max() >= height['max']:
        raise ValueError('Kraken geometry exceeds certified height range')
    scale = spec['targetSize'] * spec.get('displayScale', 1) / spec['orthoScale']
    pv, pt = proxy(scene, vertices, triangles, 8000 if spec['id'] in ('abyssal-kraken', 'abyssal-kraken-land') else 4000)
    if len(pv) > 65535:
        raise ValueError('Kraken mesh exceeds U16 indices')
    pv *= np.array([scale, -scale, scale])
    lo, hi = pv.min(axis=0), pv.max(axis=0)
    quant = np.rint((pv - lo) / np.maximum(hi - lo, 1e-9) * 65535).astype('<u2')
    base = f'material/masters/frame-{index:04d}'
    (folder / 'material/masters').mkdir(parents=True, exist_ok=True)
    def record(name):
        file = folder / name
        return dict(file=name, sha256=hashlib.sha256(file.read_bytes()).hexdigest(), bytes=file.stat().st_size)
    quant.tofile(folder / (base + '-positions.bin'))
    pt.astype('<u2').tofile(folder / (base + '-indices.bin'))
    mesh = dict(vertexCount=len(pv), triangleCount=len(pt), bounds=dict(min=lo.tolist(), max=hi.tolist()),
                positions=record(base + '-positions.bin'), indices=record(base + '-indices.bin'))
    properties = [(scene.render, 'filepath'), (scene.render.image_settings, 'file_format'),
                  (scene.render.image_settings, 'color_mode'), (scene.render.image_settings, 'color_depth'),
                  (scene.render.image_settings, 'exr_codec'), (scene.cycles, 'samples'), (scene.cycles, 'use_denoising'),
                  (scene.view_settings, 'view_transform'), (scene.view_settings, 'look'),
                  (scene.view_settings, 'exposure'), (scene.view_settings, 'gamma'), (scene, 'use_nodes')]
    saved = [(obj, key, getattr(obj, key)) for obj, key in properties]
    passes, arrays = {}, {}
    try:
        scene.cycles.samples = 32
        scene.cycles.use_denoising = False
        scene.view_settings.view_transform = 'Raw'
        scene.view_settings.look = 'None'
        scene.view_settings.exposure = 0
        scene.view_settings.gamma = 1
        scene.use_nodes = False
        scene.render.image_settings.file_format = 'OPEN_EXR'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.image_settings.color_depth = '32'
        scene.render.image_settings.exr_codec = 'ZIP'
        for mode in ('albedo', 'normal', 'height', 'emission'):
            replacements = {m: adapt(m, mode, [height['min'], height['max']])[0] for m in materials}
            slots = []
            for ob in objects:
                for i, m in enumerate(ob.data.materials):
                    if m in replacements:
                        slots.append((ob.data, i, m))
                        ob.data.materials[i] = replacements[m]
            try:
                name = base + '-' + mode + '.exr'
                pixels, seconds = render_float(scene, folder / name)
                alpha = pixels[:, :, 3:4]
                arrays[mode] = pixels[:, :, :3] / np.maximum(alpha, 1e-8)
                passes[mode] = dict(**record(name), seconds=seconds)
            finally:
                for data, i, m in slots:
                    data.materials[i] = m
                for m in replacements.values():
                    bpy.data.materials.remove(m)
        coverage = read_pixels(folder / beauty_file)[:, :, 3:4]
        interior = coverage[:, :, 0] > .99
        h = arrays['height'][:, :, :1]
        if np.any(h[:, :, 0][interior] < 0) or np.any(h[:, :, 0][interior] > 1):
            raise ValueError('Height outside encoding; clamping forbidden')
        n = arrays['normal'] * 2 - 1
        n /= np.maximum(np.sum(np.abs(n), axis=2, keepdims=True), 1e-8)
        xy = n[:, :, :2].copy()
        folded = (1 - np.abs(xy[:, :, ::-1])) * np.where(xy >= 0, 1, -1)
        xy = np.where(n[:, :, 2:3] < 0, folded, xy) * .5 + .5
        albedo = arrays['albedo']
        albedo = np.where(albedo <= .0031308, albedo * 12.92, 1.055 * np.maximum(albedo, 0) ** (1 / 2.4) - .055)
        emission_range = 8
        if np.max(arrays['emission'][interior]) > emission_range:
            raise ValueError('Emission exceeds versioned range')
        emission = arrays['emission'] / emission_range
        packed = dict(albedo=np.concatenate([albedo, coverage], axis=2),
                      elevation=np.concatenate([h, xy, coverage], axis=2),
                      emission=np.concatenate([emission, coverage * (np.max(emission, axis=2, keepdims=True) > .5 / 255)], axis=2))
        for mode, values in packed.items():
            name = base + '-' + mode + '.png'
            png(folder / name, np.rint(np.clip(values, 0, 1) * 255).astype('uint8'))
            passes[mode + 'Png'] = record(name)
        return dict(version=1, encoding=ENCODING, worldPxPerBU=scale, emissionRange=emission_range,
                    heightGeometryBU=[float(vertices[:, 2].min()), float(vertices[:, 2].max())], mesh=mesh, passes=passes)
    finally:
        for obj, key, value in saved:
            setattr(obj, key, value)
