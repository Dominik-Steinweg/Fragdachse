"""Extract persisted source geometry for independent CPU silhouette comparisons."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
sys.dont_write_bytecode = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    root = Path(args.job).resolve().parent
    job = json.loads(Path(args.job).read_text(encoding='utf8'))
    if root.parent != Path(job['outputRoot']).resolve() or root.parent.parent != Path('D:/Fragdachse-render'):
        raise ValueError('Review must remain in D: revision')
    sys.path.insert(0,str(root/'source-tools'))
    import bpy
    import numpy as np
    from mesh_shadow_blender import evaluated
    from mesh_shadow_geometry import select_source_scene
    from enemy_mesh_anatomy import FOLLOW_BONE
    output = root/'review-source'; output.mkdir(exist_ok=False)
    bpy.ops.wm.open_mainfile(filepath=str(root/'candidate.blend'),load_ui=False)
    scene = select_source_scene(bpy.data.scenes,job['render']['inputHash'],job['id'])
    bpy.context.window.scene = scene
    objects = sorted([o for o in scene.objects if o.type=='MESH' and not o.hide_render],key=lambda o:o.name)
    source_triangles, signatures, offset = [], {}, 0
    for ob in objects:
        p,t,s = evaluated(ob)
        source_triangles.append(t+offset); offset+=len(p); signatures[ob.name]=s
    np.concatenate(source_triangles).astype('<u4').tofile(output/'indices.bin')
    scale = job['coordinates']['worldPxPerBlenderUnit']
    with (output/'positions.bin').open('xb') as stream:
        for pose in job['poses']:
            f=pose['blenderFrame'];scene.frame_set(math.floor(f),subframe=f%1)
            bpy.context.view_layer.update()
            points=[]
            for ob in objects:
                p,t,s=evaluated(ob)
                if s!=signatures[ob.name]:raise ValueError('Source topology changed')
                points.append(p*[scale,-scale,scale])
            p=np.concatenate(points).astype('<f4')
            if np.max(np.abs(p[:,:2])) > job['coordinates']['canvasWorldPx']*.48:
                raise ValueError('Source violates 2% canvas border')
            stream.write(p.tobytes())
    old=np.load(root/'before-review.npz')
    old['positions'].astype('<f4').tofile(output/'before-proxy-positions.bin')
    old['indices'].astype('<u4').tofile(output/'before-proxy-indices.bin')
    # The review sheet compares the actual unrepaired source projection, not a
    # previous simplification whose own errors could hide the original gap.
    original_objects=[o for o in objects if not o.get('FD_EnemyTransition')]
    constraint=scene.objects[job['pilot']['rig']].pose.bones[FOLLOW_BONE].constraints[0]
    constraint.influence=0;bpy.context.view_layer.update()
    old_faces=[];old_offset=0
    for ob in original_objects:
        p,t,_=evaluated(ob);old_faces.append(t+old_offset);old_offset+=len(p)
    np.concatenate(old_faces).astype('<u4').tofile(output/'before-source-indices.bin')
    with (output/'before-source-positions.bin').open('xb') as stream:
        for pose in job['poses']:
            f=pose['blenderFrame'];scene.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
            p=np.concatenate([evaluated(o)[0] for o in original_objects])*[scale,-scale,scale]
            stream.write(p.astype('<f4').tobytes())
    constraint.influence=1
    metadata=dict(vertexCount=offset,triangleCount=sum(len(t) for t in source_triangles),poses=31,
                  beforeSourceVertexCount=old_offset,
                  sourceBlendSha256=hashlib.sha256((root/'candidate.blend').read_bytes()).hexdigest(),
                  files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in output.iterdir()})
    (output/'source.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf8')
    (root/'source-geometry-proof.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf8')
    print('FD_ENEMY_REVIEW_SOURCE '+json.dumps(metadata),flush=True)


if __name__=='__main__':main()
