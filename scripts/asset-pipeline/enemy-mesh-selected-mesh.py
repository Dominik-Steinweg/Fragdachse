"""Export an unchanged selected enemy as a fixed, animated shadow proxy.

No anatomical repairs or source saves. Use the existing rest-union/barycentric
tools, and retain dense source geometry for independent silhouette validation.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
import numpy as np

sys.path.insert(0, str(Path.cwd()/'scripts/asset-pipeline'))
from mesh_shadow_geometry import select_source_scene
from mesh_shadow_blender import candidates, evaluated, bind, emit, save
from enemy_mesh_union import prepare_union, sample_union


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--job', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    root = Path(args.job).resolve().parent
    workspace = Path.cwd()
    if not root.is_relative_to(workspace/'art/poc/pipeline-v2/enemy-mesh'):
        raise ValueError('Output must stay in the worktree')
    job = json.loads(Path(args.job).read_text(encoding='utf8'))
    for member, expected in job['sourceFiles'].items():
        if hashlib.sha256((root/member).read_bytes()).hexdigest() != expected:
            raise ValueError('Changed source: '+member)
    bpy.ops.wm.open_mainfile(filepath=str(root/'candidate.blend'), load_ui=False)
    scene = select_source_scene(bpy.data.scenes, job['render']['inputHash'], job['id'])
    bpy.context.window.scene = scene
    scene.frame_set(0); bpy.context.view_layer.update()
    scale = job['coordinates']['worldPxPerBlenderUnit']
    parts, excluded = candidates(scene, 0)
    rigid = job.get('profile') == 'rigid'
    # The shared paw builder names biped and quadruped feet explicitly; rigid assets have none.
    biped = any(p['ob'].name.startswith('left broad paw') for p in parts)
    names = {} if rigid else {'left_leg': 'left', 'right_leg': 'right'} if biped else {
        name: name for name in ['front_left', 'front_right', 'rear_left', 'rear_right']}
    legs = list(names)
    paws = {}
    for leg in legs:
        matches = [p['ob'] for p in parts if p['ob'].name.startswith(names[leg]+' broad paw')]
        if len(matches) != 1:
            raise ValueError('Expected one authored paw for '+leg)
        paws[leg] = matches[0]
    proxy, attempts = prepare_union(scene, parts, scale, dict(limbs=list(names.values())), 2000, job['poses'])
    bind(proxy)
    rest_heights = {leg: float(evaluated(paw)[0][:, 2].min())*scale for leg, paw in paws.items()}
    samples, contacts, reference = [], [], []
    faces = proxy['sourceTris'].astype('<u4')
    for pose in job['poses']:
        value = pose['blenderFrame']
        scene.frame_set(math.floor(value), subframe=value % 1); bpy.context.view_layer.update()
        points, _, _ = sample_union(proxy)
        transformed = points*[scale, -scale, scale]
        samples.append((points[proxy['binding']]*proxy['weights'][:, :, None]).sum(1)*[scale, -scale, scale])
        reference.append(save(root, f"reference/pose-{pose['index']:04d}.bin", transformed.astype('<f4').tobytes()))
        feet = []
        for leg, paw in paws.items():
            co, _, _ = evaluated(paw)
            position = np.array([co[:, 0].mean(), co[:, 1].mean(), co[:, 2].min()])*[scale, -scale, scale]
            lift = float(np.clip((position[2]-rest_heights[leg])/1.5, 0, 1))
            feet.append(dict(leg=leg, position=position.tolist(), groundWeight=1-lift*lift*(3-2*lift)))
        contacts.append(dict(pose=pose['index'], feet=feet))
        print('FD_SELECTED_POSE', pose['index'], flush=True)
    audit = dict(method='unchanged selected geometry/rest union/source-triangle binding', attempts=attempts,
                 excluded=excluded, union=proxy['unionAudit'], maxRestSnapWorld=proxy['maxRestSnapBlender']*scale)
    mesh = emit(root, job['id'], np.stack(samples), proxy['triangles'], [p['index'] for p in job['poses']], audit)
    refs = dict(poses=reference, indices=save(root, 'reference/indices.bin', faces.tobytes()), vertexCount=len(points))
    result = dict(schema='fd-projected-enemy-mesh', version=1, status='diagnostic', id=job['id'],
                  profile=job.get('profile', 'creature'),
                  revision=job['revision'], sourceRevision=job['sourceRevision'], coordinates=job['coordinates'],
                  poses=job['poses'], contacts=contacts, mesh=mesh, sourceFiles=job['sourceFiles'],
                  blenderVersion=bpy.app.version_string, reference=refs)
    save(root, 'mesh-manifest.json', (json.dumps(result, indent=2)+'\n').encode())
    print('FD_SELECTED_MESH_COMPLETE', mesh['vertexCount'], mesh['triangleCount'], flush=True)


if __name__ == '__main__':
    main()
