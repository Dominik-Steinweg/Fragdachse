"""Render disposable authoring previews; never publish or select a production build.

Use Blender --background --factory-startup --python-exit-code 1 --python this.py
-- --repo <repo> --asset <id> --label <new label> [--indices 0,3,6,9].
"""
import argparse
import json
import os
from pathlib import Path
import sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import blender_pipeline_v2 as pipeline


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--asset', required=True)
    parser.add_argument('--label', required=True)
    parser.add_argument('--indices', default='0,3,6,9')
    parser.add_argument('--variant', choices=['calm', 'rich'], default='rich')
    parser.add_argument('--patch')
    parser.add_argument('--device', choices=['AUTO', 'CPU', 'CUDA', 'OPTIX'], default='AUTO')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    root = Path(args.repo).resolve()
    asset_id, label = pipeline.identifier(args.asset), pipeline.identifier(args.label)
    output = root / 'art/poc/pipeline-v2/previews' / label / asset_id
    if output.exists(): raise FileExistsError('Preview already exists; use a new label')
    catalog = json.loads((root / 'scripts/asset-pipeline/catalog-v2.json').read_text(encoding='utf-8'))
    spec = next(asset for asset in catalog['assets'] if asset['id'] == asset_id)
    if args.patch:
        patch = json.loads(Path(args.patch).read_text(encoding='utf-8-sig'))
        updates = patch.get('assets', patch) if isinstance(patch, dict) else patch
        update = updates[asset_id] if isinstance(updates, dict) else next(item for item in updates if item['id'] == asset_id)
        spec = spec | update
    # Probe in this disposable process; never change an interactive Blender session.
    device = 'CPU'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for candidate in (['OPTIX', 'CUDA', 'CPU'] if args.device == 'AUTO' else [args.device]):
        if candidate == 'CPU': break
        try:
            prefs.compute_device_type = candidate
            prefs.refresh_devices()
            if any(item.type == candidate for item in prefs.devices):
                device = candidate
                break
        except (TypeError, RuntimeError):
            pass
    if args.device not in ('AUTO', 'CPU') and device == 'CPU':
        raise ValueError(f'Requested GPU unavailable: {args.device}')
    fingerprint, sources, textures = pipeline.inputs(root, spec, device)
    session = pipeline.prepare(root, spec, label, fingerprint, sources, textures)
    scene, ctx = session['scene'], session['ctx']
    bpy.context.window.scene = scene
    if device != 'CPU':
        cache = root / 'art/poc/pipeline-v2/cache/optix'
        cache.mkdir(parents=True, exist_ok=True)
        os.environ['OPTIX_CACHE_PATH'] = str(cache)
        for item in prefs.devices: item.use = item.type == device
        scene.cycles.device = 'GPU'
    else:
        scene.cycles.device = 'CPU'
    settings = spec['materialVariants'][args.variant]
    for socket in ctx.strengths: socket.default_value = settings['textureStrength']
    for socket in ctx.form_strengths: socket.default_value = settings['formShadowStrength']
    indices = list(range(len(session['samples']))) if args.indices == 'all' else [int(value) for value in args.indices.split(',')]
    if not indices or any(index < 0 or index >= len(session['samples']) for index in indices): raise ValueError('Invalid preview frame')
    output.mkdir(parents=True)
    for index in indices:
        pipeline.set_frame(scene, session['samples'][index]['blenderFrame'])
        scene.render.filepath = str(output / f'frame-{index:04d}.png')
        bpy.ops.render.render(write_still=True)
    scene.frame_set(0)
    bpy.data.libraries.write(str(output / 'preview.blend'), {scene, *session['texts']}, fake_user=True)
    poses = []
    for index in indices:
        pose = dict(session['samples'][index], clip='idle', phase=0)
        for clip in session['clips']:
            if index in clip['frames']:
                position = clip['frames'].index(index)
                divisor = len(clip['frames']) if clip['loop'] else max(1, len(clip['frames']) - 1)
                pose.update(clip=clip['name'], phase=position / divisor)
        poses.append(pose)
    pipeline.save_json(output / 'preview.json', dict(status='authoring-preview', id=asset_id, spec=spec,
                       indices=indices, variant=args.variant, inputHash=fingerprint, bounds=session['bounds'],
                       baseDiameters=session['baseDiameters'], sources=sources, device=device,
                       poses=poses, clips=session['clips']))
    print(json.dumps({'preview': str(output), 'frames': indices}), flush=True)


if __name__ == '__main__': main()
