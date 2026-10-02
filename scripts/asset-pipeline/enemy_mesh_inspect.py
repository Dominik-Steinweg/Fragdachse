"""Read-only Blender diagnosis: sources remain unsaved; reports go to stdout.

Use --full for all 118 sample times / 81 views. The default is a quick diagnosis,
not an export or an acceptance claim. Even the repaired scene exists only in RAM.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
from mesh_shadow_geometry import select_source_scene
from mesh_shadow_blender import evaluated
from enemy_mesh_anatomy import legacy_anatomy, freeze_anchors, sample_anatomy, follow_body
from enemy_mesh_corridor import compare_sample, VIEWS


def samples(render, full):
    result = [dict(sampleId='p'+str(f['index']), blenderFrame=f['blenderFrame']) for f in render['frames']
              if full or f['index'] in (0, 4, 10, 18, 19, 20, 21, 23)]
    if full:
        for clip in render['clips']:
            frames = [render['frames'][i]['blenderFrame'] for i in clip['frames']]
            for i in range(len(frames) - (0 if clip['loop'] else 1)):
                end = frames[i+1] if i+1 < len(frames) else clip['timelineEnd']
                for t in (.25, .5, .75):
                    result.append(dict(sampleId=f'{clip["name"]}-{i}+{t}', blenderFrame=frames[i]+(end-frames[i])*t))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--asset', choices=['zombie-badger', 'rabid-badger'], required=True)
    parser.add_argument('--full', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    repo = Path(args.repo)
    config = json.loads((repo/'scripts/asset-pipeline/enemy-mesh-pilot.json').read_text())
    pilot = next(p for p in config['assets'] if p['id'] == args.asset)
    base = repo/'art/poc/pipeline-v2/runs'/pilot['sourceRevision']/args.asset
    selection = json.loads((base/'selection.json').read_text())
    render_file = base/selection['variant']/'render.json'
    blend_file = base/selection['variant']/'asset.blend'
    for file in (render_file, blend_file):
        if hashlib.sha256(file.read_bytes()).hexdigest() != selection['files'][file.relative_to(base).as_posix()]:
            raise ValueError('Selected source hash changed')
    render = json.loads(render_file.read_text())
    bpy.ops.wm.open_mainfile(filepath=str(blend_file), load_ui=False)
    scene = select_source_scene(bpy.data.scenes, render['inputHash'], args.asset)
    bpy.context.window.scene = scene
    scene.frame_set(0); bpy.context.view_layer.update()
    anatomy = legacy_anatomy(scene, pilot)
    anchors = freeze_anchors(anatomy)
    scale = render['targetSize'] * render['displayScale'] / render['orthoScale']
    times = samples(render, args.full)
    changed = {o.name for limb in anatomy['limbs'].values() for o in [limb['upper'], *limb['fur']]}
    untouched = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render and o.name not in changed]
    before, fingerprints = {}, {}
    for sample in times:
        frame = sample['blenderFrame']; scene.frame_set(math.floor(frame), subframe=frame % 1)
        bpy.context.view_layer.update()
        before[sample['sampleId']] = sample_anatomy(anatomy, anchors, scale)
        fingerprints[sample['sampleId']] = [hashlib.sha256(evaluated(o)[0].tobytes()).hexdigest() for o in untouched]
    scene.frame_set(0); bpy.context.view_layer.update()
    modified = follow_body(anatomy)
    views = VIEWS if args.full else [(0, 90), (0, 35), (90, 35), (180, 35), (270, 35)]
    for sample in times:
        frame = sample['blenderFrame']; scene.frame_set(math.floor(frame), subframe=frame % 1)
        bpy.context.view_layer.update()
        now = [hashlib.sha256(evaluated(o)[0].tobytes()).hexdigest() for o in untouched]
        if now != fingerprints[sample['sampleId']]:
            raise ValueError('Repair moved non-proximal geometry')
        rows = compare_sample(before[sample['sampleId']], sample_anatomy(anatomy, anchors, scale), views)
        print('FD_ENEMY_DIAG '+json.dumps(dict(asset=args.asset, sample=sample['sampleId'],
            before=sum(r['flaggedBefore'] for r in rows), after=sum(r['flaggedAfter'] for r in rows),
            maxBefore=max(r['before']['maxGapWorld'] for r in rows),
            maxAfter=max(r['after']['maxGapWorld'] for r in rows),
            worst=sorted(rows, key=lambda r:r['after']['maxGapWorld'], reverse=True)[:2])), flush=True)
    print('FD_ENEMY_DIAG_COMPLETE '+json.dumps(dict(asset=args.asset, samples=len(times), views=len(views),
        modified=modified, unchangedMeshObjects=len(untouched), sourceSaved=False, full=args.full)), flush=True)


if __name__ == '__main__':
    main()
