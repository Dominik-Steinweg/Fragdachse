"""One-time, hash-bound migration of selected V2 eye surfaces. Never saves a Blend/PNG.

Run in a separate background Blender process:
blender --background --python-exit-code 1 --python scripts/asset-pipeline/export-eye-anchors.py -- --repo .
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eye_anchors import sample_eyes


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def migrate(root):
    runtime_path = root / 'src/config/pipelineAssets.json'
    runtime = json.loads(runtime_path.read_text(encoding='utf-8'))
    # Exact, audited names are ONLY an adapter for immutable historical revisions.
    # New builds carry direct eyeLeft/eyeRight mesh sockets from their recipes.
    special = {
        'zombie-badger': ('v2-ao', 'Milky blind zombie eye'),
        'alien-badger': ('v2-am', 'Large swept black alien eye'),
        'pyro-badger': ('v2-an', 'Separate smoked respirator eyepiece'),
    }
    for asset in runtime['assets']:
        if asset['category'] != 'enemy':
            continue
        revision, name = special.get(asset['id'], ('v2-ap', 'Living narrow enemy eye'))
        if asset['revision'] != revision:
            raise ValueError(f'Unreviewed legacy revision: {asset["id"]}')
        folder = root / f'art/poc/pipeline-v2/runs/{revision}/{asset["id"]}'
        selection = json.loads((folder / 'selection.json').read_text())
        variant = asset['variant']
        blend = folder / variant / 'asset.blend'
        source = json.loads((folder / variant / 'render.json').read_text())
        blend_hash = digest(blend)
        if (selection['id'] != asset['id'] or selection['revision'] != revision
                or selection['variant'] != variant or selection['layout'] != asset['layout']
                or selection['idleFrame'] != asset['idleFrame']
                or source['inputHash'] != selection['inputHash']):
            raise ValueError('Selected source metadata differs from runtime')
        if selection['files'][f'{variant}/render.json'] != digest(folder / variant / 'render.json'):
            raise ValueError('Selected render metadata hash mismatch')
        if selection['files'][f'{variant}/asset.blend'] != blend_hash:
            raise ValueError('Selected Blend hash mismatch')
        for field in ('sheet', 'idle'):
            expected = asset['hashes'][field]
            if expected != selection['files'][selection[field]] or digest(root / 'public' / asset[f'{field}Path']) != expected:
                raise ValueError('Runtime image does not match the selected source')
        if len(source['frames']) != asset['layout']['frameCount']:
            raise ValueError('Runtime frame count differs from selected source')
        if any(a['frames'] != b['frames'] or a['frameRate'] != b['frameRate']
               for a, b in zip(asset['clips'], source['clips'], strict=True)):
            raise ValueError('Runtime animation differs from selected source')
        bpy.ops.wm.open_mainfile(filepath=str(blend))
        scenes = [s for s in bpy.data.scenes if s.get('inputHash') == source['inputHash']]
        if len(scenes) != 1:
            raise ValueError('Expected exactly one selected asset scene')
        scene = scenes[0]
        bpy.context.window.scene = scene
        sockets = {'eyeLeft': scene.objects[name], 'eyeRight': scene.objects[name + '.001']}
        if any(o.type != 'MESH' or o.parent is None for o in sockets.values()):
            raise ValueError('Legacy eyes must be meshes attached to the animated head')
        frames = []
        for sample in source['frames']:
            frame = sample['blenderFrame']
            scene.frame_set(math.floor(frame), subframe=frame % 1)
            bpy.context.view_layer.update()
            frames.append(sample_eyes(scene, sockets))
        if not frames[0]['left']['x'] < frames[0]['right']['x']:
            raise ValueError('Legacy eye-side binding is reversed')
        asset['eyeAnchors'] = {
            'version': 1,
            'source': {'revision': revision, 'variant': variant, 'blendSha256': blend_hash,
                       'sheetSha256': asset['hashes']['sheet'], 'idleSha256': asset['hashes']['idle']},
            'frames': frames,
        }
        print(f'Eye anchors: {asset["id"]}, {len(frames)} selected poses')
    # Commit only after every selected source has passed validation.
    runtime_path.write_text(json.dumps(runtime, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    migrate(Path(args.repo).resolve())
