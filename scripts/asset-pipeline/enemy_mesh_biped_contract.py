"""Contacts and repair bounds for independently audited two-legged enemy exports."""
import argparse,json,math,sys,hashlib
from pathlib import Path
sys.dont_write_bytecode=True;sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy,numpy as np
from mesh_shadow_geometry import select_source_scene
from mesh_shadow_blender import evaluated
from biped_mesh_repair import anatomy
ap=argparse.ArgumentParser();ap.add_argument('--job',required=True);args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);root=Path(args.job).parent;job=json.loads(Path(args.job).read_text());g=json.loads((root/'biped-evidence/geometry.json').read_text());qa=json.loads((root/'biped-evidence/source-corridors.json').read_text());decoded=json.loads((root/'biped-evidence/decoded-corridors.json').read_text())
if qa['afterFailures'] or decoded['failed'] or decoded['samples']!=5022:raise ValueError('Failed biped corridors')
regions={};contacts=[];rest={}
for source in ('source.blend','candidate.blend'):
 bpy.ops.wm.open_mainfile(filepath=str(root/source),load_ui=False);scene=select_source_scene(bpy.data.scenes,job['render']['inputHash'],job['id']);bpy.context.window.scene=scene;scene.frame_set(0);bpy.context.view_layer.update();a=anatomy(scene)
 feet={}
 for side in a['legs']:
  matches=[o for o in scene.objects if o.type=='MESH' and o.name.split('.')[0] in ('Compact fur paw','Forward foot') and o.vertex_groups.get(side)]
  if len(matches)!=1:raise ValueError('Unknown foot identity: '+side)
  feet[side]=matches[0]
  if source=='source.blend':rest[side]=float(evaluated(matches[0])[0][:,2].min())
 for p in job['poses']:
  f=p['blenderFrame'];scene.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update();pose=p['index'];points=[evaluated(o)[0] for o in a['legs'].values()]
  if source=='candidate.blend':
   points += [evaluated(o)[0] for o in scene.objects if o.get('FD_BipedHipTransition')]
   current=[]
   for side,ob in feet.items():
    v=evaluated(ob)[0];low=float(v[:,2].min());lift=max(0.,(low-rest[side])*g['scale']);t=min(1.,lift/1.5);position=v.mean(0)*[g['scale'],-g['scale'],g['scale']];position[2]=low*g['scale']
    current.append(dict(leg=side,position=position.tolist(),groundWeight=1-t*t*(3-2*t)))
   contacts.append(dict(pose=pose,feet=current))
  regions.setdefault(pose,[]).extend(dict(min=v.min(0).tolist(),max=v.max(0).tolist()) for v in points)
rows=[dict(sampleId=r['sample'],**{k:r[k] for k in ('leg','azimuth','elevation','before','after')},flaggedBefore=r['before']['maxGapWorld']>.25,flaggedAfter=r['after']['maxGapWorld']>.25) for r in qa['rows']]
report=dict(samples=118,probes=len(rows),flaggedBefore=qa['beforeFailures'],flaggedAfter=0,untouchedObjectsVerified=qa['untouchedObjects'],rows=rows)
proxy=dict(probes=decoded['samples'],flaggedAfter=0,maximumGapAfter=decoded['maxGapWorld'],rows=[dict(pose=r['pose'],leg=r['leg'],azimuth=r['azimuth'],elevation=r['elevation'],after={k:r[k] for k in ('maxGapWorld','missingAreaWorld2','endpointsCovered')}) for r in decoded['rows']])
m=dict(schema='fd-projected-enemy-mesh',version=1,id=job['id'],revision=job['revision'],status='diagnostic',coordinates=job['coordinates'],poses=job['poses'],mesh=g['mesh'],contacts=contacts,sourceFiles=job['sourceFiles'],blenderVersion=bpy.app.version_string,contactPolicy=dict(reference='rest evaluated foot minimum Z',fadeWorldPx=1.5,gameplayAuthority=False))
for name,value in [('repair-bounds.json',regions),('corridors.json',report),('proxy-corridors.json',proxy),('mesh-manifest.json',m),('geometry-receipt.json',dict(status='source-and-proxy-corridors-passed',pending=['silhouette-review','beauty-material-renders','visual-review']))]:
 with (root/name).open('x') as stream:json.dump(value,stream,indent=2)
print('R4_BIPED_READY',job['id'],flush=True)

