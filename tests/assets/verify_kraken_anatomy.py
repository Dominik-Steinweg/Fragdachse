"""Ray-test the saved Kraken: restrained resting cup edges, clear attack exposure.

Run with the same background-Blender workflow as verify_asset_pipeline_v2.py.
No rendered pixels or animation state are fabricated; rays hit evaluated skin.
"""
import argparse
import json
import math
from pathlib import Path
import sys
sys.dont_write_bytecode=True
import bpy
import bmesh
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from verify_asset_pipeline_v2 import animation_owners, snapshot, assert_same_pose, set_frame, assert_clip_boundary
from verify_kraken_beard import verify_beard


def visible_cups(scene):
    deps = bpy.context.evaluated_depsgraph_get()
    span = scene.camera.data.ortho_scale
    cups = arms = 0
    per_arm = {}
    evaluated = {}
    grid = 128
    for y in range(grid):
        for x in range(grid):
            origin = Vector(((x+.5)/grid*span-span/2, (y+.5)/grid*span-span/2, scene.camera.location.z))
            hit, _, _, face, obj, _ = scene.ray_cast(deps, origin, Vector((0,0,-1)))
            if not hit or obj.get('motionRole') != 'tentacle':
                continue
            arms += 1
            # Scene ray_cast returns an evaluated face index but the original
            # object. Subdivision changes topology, so resolve both the polygon
            # and its material slot on the evaluated object for this pose.
            if obj.name not in evaluated:
                evaluated[obj.name] = obj.evaluated_get(deps)
            surface = evaluated[obj.name]
            assert 0 <= face < len(surface.data.polygons), 'Ray hit has no evaluated polygon'
            material = surface.material_slots[surface.data.polygons[face].material_index].material
            if material.get('ventralSuckerSurface'):
                cups += 1
                index = str(obj['tentacleIndex'])
                per_arm[index] = per_arm.get(index, 0)+1
    return dict(armHits=arms, suckerHits=cups, fraction=cups/max(1,arms), perArm=per_arm)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    target=Path(args.report)
    if target.exists(): raise FileExistsError(target)
    report={'status':'failed','blend':bpy.data.filepath}
    try:
        scene=next(s for s in bpy.data.scenes if s.get('asset_manifest') and json.loads(s['asset_manifest'])['id']=='abyssal-kraken')
        bpy.context.window.scene=scene
        report['beard']=verify_beard(scene)
        assert scene.camera.data.type=='ORTHO' and all(abs(v)<1e-7 for v in scene.camera.rotation_euler)
        arms=[o for o in scene.objects if o.get('motionRole')=='tentacle']
        assert len(arms)==8, 'Expected eight continuously weighted tentacles'
        skin=next(o for o in scene.objects if o.get('anatomyRole')=='mantle')
        bm=bmesh.new(); bm.from_mesh(skin.data)
        pending=set(bm.verts); components=[]
        while pending:
            stack=[pending.pop()]; group=[]
            while stack:
                vertex=stack.pop(); group.append(vertex)
                for edge in vertex.link_edges:
                    other=edge.other_vert(vertex)
                    if other in pending: pending.remove(other); stack.append(other)
            components.append({'vertices':len(group),'min':[min(v.co[i] for v in group) for i in range(3)],'max':[max(v.co[i] for v in group) for i in range(3)]})
        report['mantleSurface']={'connectedComponents':len(components),'components':components,'closed':all(e.is_manifold for e in bm.edges)}
        bm.free()
        assert len(components)==1 and report['mantleSurface']['closed'], 'Mantle, dorsal crests and lateral fins must share one closed continuous skin'
        scene.frame_set(0)
        rest=visible_cups(scene)
        report['rest']=rest
        assert rest['armHits']>1000, 'Ray sample missed the authored body'
        assert .002<rest['fraction']<.04, 'Rest should show a few ventral cup edges, not the whole underside'
        clips=json.loads(scene['asset_clips'])
        normal=[]
        for loop in (c for c in clips if c['name'] in ('idle','move')):
            for index in range(len(loop['frames'])):
                frame=loop['timelineStart']+index*24/loop['frameRate']
                scene.frame_set(math.floor(frame),subframe=frame%1)
                sample={'clip':loop['name'],'index':index,**visible_cups(scene)}
                normal.append(sample)
                assert sample['fraction']<.06, f'Normal {loop["name"]} exposes too much underside at {index}'
        report['normalMotion']=normal
        # The water body's current attack is the brood throw; slam belongs to
        # the land body / separate strike tentacle. Sample the full throw so
        # anticipation and release are covered without inventing impact markers.
        clip=next(c for c in clips if c['motion']=='kraken_throw_egg')
        samples=[]
        for index in range(len(clip['frames'])):
            frame=clip['timelineStart']+index*24/clip['frameRate']
            scene.frame_set(math.floor(frame),subframe=frame%1)
            samples.append({'clip':clip['name'],'index':index,**visible_cups(scene)})
        report['attack']=samples
        assert max(s['fraction'] for s in samples)>max(rest['fraction']+.015,.025), 'Attack should expose substantially more underside than rest'
        assert all(max(s['perArm'].get(str(i),0) for s in samples)>25 for i in (0,4)), 'Both attacking arms must expose their ventral cups'
        # Resting twist is authored into every clip, including loop closure and
        # attack recovery. Check evaluated meshes and bones, not only key values.
        meshes=[o for o in scene.objects if o.type=='MESH' and not o.hide_render]
        rigs=[o for o in scene.objects if o.type=='ARMATURE']
        owners=animation_owners(scene)
        set_frame(scene,0)
        resting=snapshot(scene,meshes,rigs,owners)
        closures=[]
        def sample(frame):
            set_frame(scene,frame)
            return snapshot(scene,meshes,rigs,owners)
        for clip in clips:
            first=sample(clip['timelineStart'])
            last=sample(clip['timelineStart']+(len(clip['frames'])-1)*24/clip['frameRate'])
            assert_clip_boundary(clip,clips,resting,first,last,sample)
            closures.append(clip['name'])
        report['verifiedClipClosures']=closures
        report['status']='passed'
    except Exception as exc:
        report['error']=str(exc)
        raise
    finally:
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__': main()
