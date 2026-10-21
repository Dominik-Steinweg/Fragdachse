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
        # A symbol loop is keyframed on every exported frame; frame N would repeat frame 0.
        loop = spec.get('loop') if spec['role'] == 'symbol' else None
        frame_count = loop['frames'] if loop else 1
        frame_bounds, pulse_bounds = [], None
        for frame in range(frame_count):
            scene.frame_set(frame)
            frame_bounds.append(pipeline.validate_pose(scene))
            # Pulsing around the declared root must stay within the fixed base face.
            if spec['role'] == 'symbol':
                original = session['asset']['root'].scale.copy()
                session['asset']['root'].scale = (1.08, 1.08, 1)
                bpy.context.view_layer.update()
                scaled = pipeline.validate_pose(scene)
                if max(abs(v) for v in scaled) > .9:
                    raise ValueError(f'Pulsing symbol exceeds the common face: {spec["id"]} frame {frame}')
                pulse_bounds = [min(a, b) if i < 2 else max(a, b) for i, (a, b) in enumerate(zip(pulse_bounds or scaled, scaled))]
                session['asset']['root'].scale = original
                bpy.context.view_layer.update()
        scene.frame_set(0)
        bounds = frame_bounds[0]
        pulse_bounds = pulse_bounds or bounds
        result = dict(id=spec['id'], bounds=bounds, pulseBounds=pulse_bounds, frames=frame_count,
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
            start = time.perf_counter(); frames = []
            for index in range(frame_count):
                scene.frame_set(index)
                name = f'masters/frame-{index:04d}.png'
                scene.render.filepath = str(folder / name)
                bpy.ops.render.render(write_still=True, scene=scene.name)
                frames.append(dict(index=index, blenderFrame=index, file=name,
                                   sha256=pipeline.shared.digest(folder / name), bounds=frame_bounds[index]))
            scene.frame_set(0)
            result['renderSeconds'] = time.perf_counter()-start
            clips = [dict(name='idle', motion='powerup-loop', frameRate=loop['fps'], loop=True,
                          frames=list(range(frame_count)))] if loop else []
            bpy.data.libraries.write(str(folder / 'asset.blend'), {scene, *session['texts']}, fake_user=True)
            manifest = dict(spec, pipelineVersion=2, revision=revision, variant='standard',
                variantLabel='Matte worn relief', materialParameters=spec['materialVariants']['standard'],
                blenderVersion=bpy.app.version_string, renderDevice=device, masterSize=1024,
                sources=sources, textures=textures, inputHash=fingerprint, idleFrame=0, clips=clips, frames=frames,
                camera=dict(type='ORTHO', rotation=list(scene.camera.rotation_euler), location=list(scene.camera.location),
                            orthoScale=scene.camera.data.ortho_scale, transparent=True, bounds=bounds))
            from render_integrity import provenance
            manifest['provenance'] = provenance(scene, sources)
            pipeline.save_json(folder / 'render.json', manifest)
            pipeline.save_json(asset_folder / 'build.json', dict(pipelineVersion=2, id=spec['id'], revision=revision,
                status='complete', inputHash=fingerprint, variants={'standard': {'frames': frames}}))
        results.append(result)
        print('FD_POWERUP '+json.dumps(result), flush=True)
    if not args.validate_only: pipeline.save_json(output / 'render-summary.json', dict(device=device, assets=results))
    print('FD_POWERUP_DONE '+json.dumps({'validated': len(results), 'rendered': not args.validate_only}), flush=True)


if __name__ == '__main__': main()
