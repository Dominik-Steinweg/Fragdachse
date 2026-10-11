"""World-Z data pass: emission override, neutral float EXR, straight linear PNG.

No scene/material changes survive this call. Beauty alpha is the coverage authority;
the data render has no denoising or reconstruction filter. Camera/pivot never move.
"""
import hashlib
from pathlib import Path
import bpy
import numpy as np
from character_pass_blender import png

ENCODING = 'linear-unorm8-world-z'


def read_pixels(file):
    image = bpy.data.images.load(str(file), check_existing=False)
    try:
        image.colorspace_settings.name = 'Non-Color'
        width, height = image.size
        values = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(values)
        return values.reshape(height, width, 4)[::-1].copy()
    finally:
        bpy.data.images.remove(image)


def emission_material(spec):
    material = bpy.data.materials.new('FD_Elevation_World_Z')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    geometry = nodes.new('ShaderNodeNewGeometry')
    separate = nodes.new('ShaderNodeSeparateXYZ')
    remap = nodes.new('ShaderNodeMapRange')
    remap.clamp = True
    remap.inputs['From Min'].default_value = spec['min']
    remap.inputs['From Max'].default_value = spec['max']
    remap.inputs['To Min'].default_value = 0
    remap.inputs['To Max'].default_value = 1
    emission = nodes.new('ShaderNodeEmission')
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(geometry.outputs['Position'], separate.inputs[0])
    links.new(separate.outputs['Z'], remap.inputs['Value'])
    links.new(remap.outputs['Result'], emission.inputs['Color'])
    links.new(emission.outputs[0], output.inputs['Surface'])
    return material


def render_elevation(scene, folder, index, spec, beauty_file):
    exr_name = f'elevation/masters/frame-{index:04d}.exr'
    png_name = f'elevation/masters/frame-{index:04d}.png'
    (folder / 'elevation/masters').mkdir(parents=True, exist_ok=True)
    material = emission_material(spec)
    settings = [(scene.render, 'filepath'), (scene.render.image_settings, 'file_format'),
                (scene.render.image_settings, 'color_mode'), (scene.render.image_settings, 'color_depth'),
                (scene.render.image_settings, 'exr_codec'), (scene.cycles, 'use_denoising'),
                (scene.cycles, 'pixel_filter_type'), (scene.cycles, 'filter_width'),
                (scene.view_settings, 'view_transform'), (scene.view_settings, 'look'),
                (scene.view_settings, 'exposure'), (scene.view_settings, 'gamma'), (scene, 'use_nodes')]
    saved = [(owner, key, getattr(owner, key)) for owner, key in settings]
    overrides = [(layer, layer.material_override) for layer in scene.view_layers]
    try:
        for layer, _ in overrides:
            layer.material_override = material
        scene.cycles.use_denoising = False
        scene.cycles.pixel_filter_type = 'BOX'
        scene.cycles.filter_width = .01
        scene.view_settings.view_transform = 'Raw'
        scene.view_settings.look = 'None'
        scene.view_settings.exposure = 0
        scene.view_settings.gamma = 1
        scene.use_nodes = False
        scene.render.image_settings.file_format = 'OPEN_EXR'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.image_settings.color_depth = '32'
        scene.render.image_settings.exr_codec = 'ZIP'
        scene.render.filepath = str(folder / exr_name)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        data = read_pixels(folder / exr_name)
        if not np.isfinite(data).all():
            raise ValueError('Non-finite elevation render')
        coverage = data[:, :, 3]
        height = np.clip(data[:, :, 0] / np.maximum(coverage, 1e-8), 0, 1)
        # Supply meaningful edge data where Beauty's wider AA filter has coverage.
        valid = coverage > .01
        for _ in range(4):
            count = np.zeros(valid.shape, dtype=np.float32)
            total = np.zeros_like(height)
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                mask = np.roll(valid, (dy, dx), (0, 1))
                if dy == -1: mask[-1] = False
                if dy == 1: mask[0] = False
                if dx == -1: mask[:, -1] = False
                if dx == 1: mask[:, 0] = False
                total += np.roll(height, (dy, dx), (0, 1)) * mask
                count += mask
            fill = ~valid & (count > 0)
            height[fill] = total[fill] / count[fill]
            valid |= fill
        beauty = read_pixels(folder / beauty_file)
        if beauty.shape != data.shape:
            raise ValueError('Elevation and Beauty canvas differ')
        rgba = np.concatenate([np.repeat(height[:, :, None], 3, axis=2), beauty[:, :, 3:4]], axis=2)
        png(folder / png_name, np.rint(np.clip(rgba, 0, 1) * 255).astype('uint8'))
        digest = lambda name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
        return dict(file=png_name, sha256=digest(png_name), exrFile=exr_name, exrSha256=digest(exr_name),
                    width=data.shape[1], height=data.shape[0], encoding=ENCODING)
    finally:
        for layer, original in overrides:
            layer.material_override = original
        for owner, key, value in saved:
            setattr(owner, key, value)
        bpy.data.materials.remove(material)


def verify_elevation(scene, manifest, folder):
    """Independent ray samples catch inverted, gamma-encoded or constant height data.

    Alpha tolerance: 1/255 at full master size. Interior ray checks: at least 95%
    within 4/255 of clamped world Z; the median must be within 2/255. Edges excluded.
    """
    from mathutils import Vector
    from pose_validation_v2 import set_frame, require
    spec = manifest['elevation']
    reports = []
    for frame in manifest['frames']:
        record = frame['elevation']
        for key, digest_key in (('file', 'sha256'), ('exrFile', 'exrSha256')):
            file = (folder / record[key]).resolve()
            require(file.is_relative_to(folder.resolve()), 'Elevation path escapes bundle')
            require(hashlib.sha256(file.read_bytes()).hexdigest() == record[digest_key], 'Elevation hash mismatch')
        data = read_pixels(folder / record['file'])
        beauty = read_pixels(folder / frame['file'])
        require(data.shape == beauty.shape == (manifest['masterSize'], manifest['masterSize'], 4), 'Elevation master dimensions differ')
        require(np.max(np.abs(data[:, :, 3] - beauty[:, :, 3])) <= 1.01 / 255, 'Elevation alpha differs from Beauty')
        require(np.max(np.abs(data[:, :, :3] - data[:, :, :1])) <= 1 / 255, 'Elevation RGB must be scalar linear data')
        set_frame(scene, frame['blenderFrame'])
        deps = bpy.context.evaluated_depsgraph_get()
        span, size = scene.camera.data.ortho_scale, manifest['masterSize']
        pairs = []
        stride = max(1, size // 48)
        for y in range(stride // 2, size, stride):
            for x in range(stride // 2, size, stride):
                if np.min(beauty[max(0, y-2):y+3, max(0, x-2):x+3, 3]) < .99:
                    continue
                origin = Vector(((x + .5) / size * span - span / 2,
                                 span / 2 - (y + .5) / size * span, scene.camera.location.z))
                hit, point, *_ = scene.ray_cast(deps, origin, Vector((0, 0, -1)))
                if hit:
                    expected = np.clip((point.z - spec['min']) / (spec['max'] - spec['min']), 0, 1)
                    pairs.append((expected, float(data[y, x, 0])))
        require(len(pairs) >= 8, 'Too few interior elevation ray samples')
        pairs = np.asarray(pairs)
        errors = np.abs(pairs[:, 0] - pairs[:, 1]) * 255
        require(np.median(errors) <= 2 and np.mean(errors <= 4) >= .95, 'Elevation world-Z/monotonicity plausibility failed')
        reports.append(dict(index=frame['index'], rays=len(pairs), medianError8bit=float(np.median(errors)),
                            fractionWithin4=float(np.mean(errors <= 4)), expectedRange=float(np.ptp(pairs[:, 0]))))
    return dict(name='elevation_world_z_coverage_and_monotonicity', passed=True, frames=reports)
