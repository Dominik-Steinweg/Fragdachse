"""External-drive V2 render adapter. --validate-only constructs/checks but never saves/renders."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import blender_pipeline_v2 as pipeline


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job')
    parser.add_argument('--validate-only', action='store_true')
    parser.add_argument('--repo')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    if args.validate_only:
        root = Path(args.repo).resolve()
        revision, device, output = 'powerups-validation', 'CPU', None
    else:
        job_path = Path(args.job).resolve()
        job = json.loads(job_path.read_text(encoding='utf-8'))
        output = job_path.parent
        allowed = Path('D:/Fragdachse-render').resolve()
        if output.parent != allowed or output.name != job['revision']:
            raise ValueError('Powerup renders must use a new revision directly below D:/Fragdachse-render')
        root = output / 'source'
        for name, expected in job['files'].items():
            file = (root / name).resolve()
            if not file.is_relative_to(root) or pipeline.shared.digest(file) != expected:
                raise ValueError('Snapshot source changed: '+name)
        revision, device = job['revision'], job['device']
        os.environ['OPTIX_CACHE_PATH'] = str(output / 'cache')
    spec_set = json.loads((root / 'scripts/asset-pipeline/powerups-v2.json').read_text(encoding='utf-8'))
    results = []
    for spec in spec_set['assets']:
        fingerprint, sources, textures = pipeline.inputs(root, spec, device)
        # Bind the separate layered-icon catalog and reference layers too.
        name = 'scripts/asset-pipeline/powerups-v2.json'
        sources[name] = pipeline.shared.digest(root / name)
        for key, name in [('reference-icon', spec['reference']), ('reference-symbol', spec.get('symbolReference'))]:
            if name: textures[key] = dict(path=name, sha256=pipeline.shared.digest(root / name))
        fingerprint = hashlib.sha256(json.dumps(dict(spec=spec, sources=sources, textures=textures,
            blender=bpy.app.version_string, device=device), sort_keys=True).encode()).hexdigest()
        session = pipeline.prepare(root, spec, revision, fingerprint, sources, textures)
        scene, ctx = session['scene'], session['ctx']
        # Local presentation override; all other V2 beauty assets retain their rig.
        lighting = spec_set['presentation']['lighting']
        scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = lighting['ambient']
        lamps = {ob.name: ob for ob in scene.objects if ob.type == 'LIGHT'}
        for name, settings in [('Soft key', lighting['key']), ('Soft fill', lighting['fill'])]:
            lamp = next(ob for label, ob in lamps.items() if label.split('.')[0] == name)
            lamp.location = settings['position']; lamp.data.energy = settings['energy']
            lamp.data.size = settings['size']
            lamp.rotation_euler = (-lamp.location).to_track_quat('-Z','Y').to_euler()
        for socket in ctx.strengths: socket.default_value = spec['materialVariants']['standard']['textureStrength']
        for socket in ctx.form_strengths: socket.default_value = 0
        bounds = pipeline.validate_pose(scene)
        # Pulsing around the declared root must stay within the fixed base face.
        if spec['role'] == 'symbol':
            original = session['asset']['root'].scale.copy()
            session['asset']['root'].scale = (1.08, 1.08, 1)
            bpy.context.view_layer.update()
            pulse_bounds = pipeline.validate_pose(scene)
            if max(abs(v) for v in pulse_bounds) > .9:
                raise ValueError('Pulsing symbol exceeds the common face: '+spec['id'])
            session['asset']['root'].scale = original
            bpy.context.view_layer.update()
        else: pulse_bounds = bounds
        result = dict(id=spec['id'], bounds=bounds, pulseBounds=pulse_bounds,
                      meshes=len([o for o in scene.objects if o.type=='MESH']), lighting=lighting)
        if not args.validate_only:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            if device != 'CPU':
                prefs.compute_device_type = device; prefs.refresh_devices()
                if not any(d.type == device for d in prefs.devices): raise ValueError('Unavailable render device: '+device)
                for d in prefs.devices: d.use = d.type == device
            scene.cycles.device = 'CPU' if device == 'CPU' else 'GPU'
            asset_folder = output / spec['id']
            folder = asset_folder / 'standard'; (folder / 'masters').mkdir(parents=True)
            pipeline.archive_inputs(root, asset_folder, sources, textures)
            scene.render.filepath = str(folder / 'masters/frame-0000.png')
            start = time.perf_counter(); bpy.ops.render.render(write_still=True, scene=scene.name)
            result['renderSeconds'] = time.perf_counter()-start
            frame = dict(index=0, blenderFrame=0, file='masters/frame-0000.png',
                         sha256=pipeline.shared.digest(folder / 'masters/frame-0000.png'), bounds=bounds)
            bpy.data.libraries.write(str(folder / 'asset.blend'), {scene, *session['texts']}, fake_user=True)
            manifest = dict(spec, pipelineVersion=2, revision=revision, variant='standard',
                variantLabel='Matte worn relief', materialParameters=spec['materialVariants']['standard'],
                blenderVersion=bpy.app.version_string, renderDevice=device, masterSize=1024,
                sources=sources, textures=textures, inputHash=fingerprint, idleFrame=0, clips=[], frames=[frame],
                camera=dict(type='ORTHO', rotation=list(scene.camera.rotation_euler), location=list(scene.camera.location),
                            orthoScale=scene.camera.data.ortho_scale, transparent=True, bounds=bounds))
            from render_integrity import provenance
            manifest['provenance'] = provenance(scene, sources)
            pipeline.save_json(folder / 'render.json', manifest)
            pipeline.save_json(asset_folder / 'build.json', dict(pipelineVersion=2, id=spec['id'], revision=revision,
                status='complete', inputHash=fingerprint, variants={'standard': {'frames': [frame]}}))
        results.append(result)
        print('FD_POWERUP '+json.dumps(result), flush=True)
    if not args.validate_only: pipeline.save_json(output / 'render-summary.json', dict(device=device, assets=results))
    print('FD_POWERUP_DONE '+json.dumps({'validated': len(results), 'rendered': not args.validate_only}), flush=True)


if __name__ == '__main__': main()
