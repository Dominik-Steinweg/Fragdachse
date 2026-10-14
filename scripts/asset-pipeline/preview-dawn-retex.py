"""Disposable detail poses for Dawn retexturing; never production.

Blender -b --python-exit-code 1 --python scripts/asset-pipeline/preview-dawn-retex.py
-- --label retex-pilot-r02-detail --output D:/Fragdachse-render/dawn-v1/retex-pilot
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import blender_pipeline_v2 as pipeline


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--assets', nargs='+')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    root = Path(__file__).resolve().parents[2]
    base = Path(args.output).resolve() / pipeline.identifier(args.label)
    if base.exists(): raise FileExistsError('Use a fresh preview label')
    base.mkdir(parents=True)
    for key, folder in [('OPTIX_CACHE_PATH', '.optix-cache'), ('CUDA_CACHE_PATH', '.cuda-cache')]:
        cache = Path(args.output).resolve().parent / folder
        cache.mkdir(parents=True, exist_ok=True)
        os.environ[key] = str(cache)
    ids = args.assets or [f'construction_dawn_wreck_t{tier}' for tier in (1, 2, 3)] + ['construction_dawn_extractor']
    for asset_id in ids:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        spec = pipeline.resolve_spec(root, asset_id)
        fingerprint, sources, textures = pipeline.inputs(root, spec, 'OPTIX')
        session = pipeline.prepare(root, spec, args.label, fingerprint, sources, textures)
        scene, ctx = session['scene'], session['ctx']
        bpy.context.window.scene = scene
        settings = spec['materialVariants']['standard']
        for socket in ctx.strengths: socket.default_value = settings['textureStrength']
        for socket in ctx.form_strengths: socket.default_value = settings['formShadowStrength']
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'; prefs.refresh_devices()
        for device in prefs.devices: device.use = device.type == 'OPTIX'
        if not any(d.use for d in prefs.devices): raise RuntimeError('OPTIX unavailable')
        scene.cycles.device = 'GPU'
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        scene.render.use_persistent_data = False
        size = spec['targetSize'] * 4
        scene.render.resolution_x = scene.render.resolution_y = size
        indices = [0]
        active = next((clip for clip in session['clips'] if clip['name'] == 'active'), None)
        if active is None and session['clips']: active = session['clips'][0]
        if active: indices += [active['frames'][min(len(active['frames'])-1,round(len(active['frames'])*phase))] for phase in (.25,.75)]
        output = base / asset_id; output.mkdir()
        frames = []
        for index in indices:
            sample = session['samples'][index]
            pipeline.set_frame(scene, sample['blenderFrame'])
            file = output / f'frame-{index:04d}.png'
            scene.render.filepath = str(file)
            bpy.ops.render.render(write_still=True)
            frames.append(dict(sample, path=file.name, sha256=hashlib.sha256(file.read_bytes()).hexdigest()))
        scene.frame_set(0)
        bpy.data.libraries.write(str(output / 'preview.blend'), {scene, *session['texts']}, fake_user=True)
        if pipeline.inputs(root, spec, 'OPTIX')[0] != fingerprint: raise RuntimeError('Source changed during preview')
        pipeline.save_json(output / 'preview.json', dict(status='authoring-preview', spec=spec,
            inputHash=fingerprint, sources=sources, textures=textures, frames=frames, clips=session['clips'],
            bounds=session['bounds'], render=dict(size=size, samples=32, device='OPTIX'),
            note='Draft detail poses only; no production/export/selection/import.'))
        print(f'PREVIEW {asset_id}: {indices}', flush=True)


if __name__ == '__main__': main()
