"""Hash-bound biped source repair, dense corridor audit and fixed-topology export.
Run in background Blender. All large products belong to an exclusive D: revision.
"""
import argparse, hashlib, json, math, sys, shutil, time
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import numpy as np
from mesh_shadow_geometry import select_source_scene
from mesh_shadow_blender import evaluated, candidates, fixed_proxy, bake, emit, part_audit, hand_sources
from enemy_mesh_corridor import VIEWS, corridor_metric
from biped_mesh_repair import anatomy, anchors, repair, sample, add_transitions

ap=argparse.ArgumentParser();ap.add_argument('--asset',default='badger',choices=['badger','alien-badger','pyro-badger']);ap.add_argument('--revision',required=True);ap.add_argument('--quick',action='store_true')
args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
repo=Path('C:/Fragdachse');root=Path('D:/Fragdachse-render')/args.revision/args.asset
if root.parent.parent!=Path('D:/Fragdachse-render') or not args.revision.startswith('player-r2-'):raise ValueError('Unsafe revision')
root.mkdir(parents=True,exist_ok=False)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
revision='v2-ai' if args.asset=='badger' else 'v2-claw-leap-a'
source=repo/'art/poc/pipeline-v2/runs'/revision/args.asset
selection=json.loads((source/'selection.json').read_text());base=source/selection['variant'];render=json.loads((base/'render.json').read_text())
for name in ('asset.blend','render.json'):
 if sha(base/name)!=selection['files'][selection['variant']+'/'+name]:raise ValueError('Changed selected source')
provenance=dict(blendSha256=sha(base/'asset.blend'),renderSha256=sha(base/'render.json'),archiveSha256=sha(source/'source-bundle.zip'))
shutil.copyfile(base/'asset.blend',root/'original.blend');shutil.copyfile(base/'render.json',root/'source-render.json');shutil.copyfile(source/'selection.json',root/'source-selection.json')
tools={}
for name in ('render_integrity.py','biped-mesh-r2.py','biped_mesh_repair.py','mesh_shadow_blender.py','mesh_shadow_geometry.py','enemy_mesh_corridor.py'):
 p=Path(__file__).parent/name;(root/'source-tools').mkdir(exist_ok=True);shutil.copyfile(p,root/'source-tools'/name);tools[name]=sha(p)
bpy.ops.wm.open_mainfile(filepath=str(root/'original.blend'),load_ui=False)
scene=select_source_scene(bpy.data.scenes,render['inputHash'],args.asset);bpy.context.window.scene=scene
scene.frame_set(0);bpy.context.view_layer.update();a=anatomy(scene);frozen=anchors(a)
# Player display contract includes its 1.2 presentation scale; the archived
# targetSize is only the 32px reference plane. Enemies own their displayScale.
scale=(38.4 if args.asset=='badger' else render['targetSize']*render.get('displayScale',1))/render['orthoScale']
times=[dict(id='p'+str(f['index']),frame=f['blenderFrame'],pose=f['index']) for f in render['frames']]
for clip in render['clips']:
 frames=[render['frames'][i]['blenderFrame'] for i in clip['frames']]
 for i in range(len(frames)-(0 if clip['loop'] else 1)):
  end=frames[i+1] if i+1<len(frames) else clip['timelineEnd']
  for t in (.25,.5,.75):times.append(dict(id=f'{clip["name"]}-{i}+{t}',frame=frames[i]+(end-frames[i])*t,pose=None))
changed=set(a['legs'].values());untouched=[o for o in scene.objects if o.type=='MESH' and not o.hide_render and o not in changed]
def set_frame(value):scene.frame_set(math.floor(value),subframe=value%1);bpy.context.view_layer.update()
def digest_objects():return {o.name:hashlib.sha256(evaluated(o)[0].tobytes()).hexdigest() for o in untouched}
before=[];original_hashes=[]
for t in times:
 set_frame(t['frame']);before.append(sample(a,frozen,scale));original_hashes.append(digest_objects())
set_frame(0);weights=repair(a);transitions=add_transitions(scene,a,times,before,scale);rows=[]
for index,t in enumerate(times):
 if args.quick and t['pose'] not in (0,3,4,5,9,10,11):continue
 set_frame(t['frame']);after=sample(a,frozen,scale)
 if digest_objects()!=original_hashes[index]:raise ValueError('Repair moved an unrelated object')
 for azimuth,elevation in VIEWS:
  cache={}
  for leg,old in before[index].items():
   values=[corridor_metric(old['start'],old['end'],surfaces,azimuth,elevation,cache=cache) for surfaces in (old['surfaces'],after[leg]['surfaces'])]
   rows.append(dict(sample=t['id'],pose=t['pose'],leg=leg,azimuth=azimuth,elevation=elevation,before=values[0],after=values[1]))
 print('R2_SAMPLE',t['id'],flush=True)
qa=dict(source=provenance,tools=tools,asset=args.asset,weights=weights,transitions=transitions,samples=len(times),views=len(VIEWS),untouchedObjects=len(untouched),
 beforeFailures=sum(r['before']['maxGapWorld']>.25 for r in rows),afterFailures=sum(r['after']['maxGapWorld']>.25 for r in rows),
 maxGapAfter=max(r['after']['maxGapWorld'] for r in rows),rows=rows)
(root/'source-corridors.json').write_text(json.dumps(qa,indent=2))
if qa['afterFailures']:raise ValueError('Proximal weighting leaves open corridors; add local source geometry')
set_frame(0);scene.render.use_persistent_data=False
bpy.data.libraries.write(str(root/'source.blend'),{scene},fake_user=True,compress=True)
# Reopen the persisted source independently before exporting, including the original hand sockets.
bpy.ops.wm.open_mainfile(filepath=str(root/'source.blend'),load_ui=False);scene=select_source_scene(bpy.data.scenes,render['inputHash'],args.asset);bpy.context.window.scene=scene;set_frame(0)
parts,excluded=candidates(scene,.075);hands=hand_sources(parts)
bridges=[p for p in parts if p['ob'].get('FD_BipedHipTransition')];ordinary=[p for p in parts if p not in bridges]
attempts=fixed_proxy(scene,ordinary,3000,(1000,1900,2000,3800))
# Small attachment sleeves are source geometry, not disposable coat detail.
for p in bridges:p['proxy']=p['rest'].copy();p['triangles']=p['sourceTris'].copy();p['proxyTriangleCleanup']=p['sourceTriangleCleanup']
positions,triangles,sockets=bake(scene,parts,render['frames'],scale,hands=hands)
audit=dict(method='rest-decimation/source-triangle-barycentric-skinning',attempts=attempts,excluded=excluded,parts=part_audit(parts,scale))
mesh=emit(root,args.asset,positions,triangles,list(range(len(render['frames']))),audit)
receipt=dict(asset=args.asset,revision=args.revision,source=provenance,repairedBlendSha256=sha(root/'source.blend'),render=render,scale=scale,mesh=mesh,sockets=sockets,
 sourceQa=dict(samples=qa['samples'],views=qa['views'],quick=args.quick,beforeFailures=qa['beforeFailures'],afterFailures=qa['afterFailures'],untouchedObjects=qa['untouchedObjects']),
 proxyFillers=False,tools=tools,persistentData=False,status='geometry-awaiting-image-review')
from render_integrity import provenance as export_provenance
receipt['provenance']=export_provenance(sources=provenance)
(root/'geometry.json').write_text(json.dumps(receipt,indent=2));print('R2_GEOMETRY_COMPLETE',json.dumps(receipt['sourceQa']),mesh['vertexCount'],mesh['triangleCount'],flush=True)
