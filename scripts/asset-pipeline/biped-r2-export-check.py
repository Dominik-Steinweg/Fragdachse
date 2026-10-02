"""Independent decoded-export corridor check against frozen original-source anchors."""
import argparse,hashlib,json,math,sys
from pathlib import Path
sys.dont_write_bytecode=True;sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy,numpy as np
from mesh_shadow_geometry import select_source_scene
from biped_mesh_repair import anatomy,anchors,sample
from enemy_mesh_corridor import VIEWS,corridor_metric
ap=argparse.ArgumentParser();ap.add_argument('--root',required=True);args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);root=Path(args.root)
g=json.loads((root/'geometry.json').read_text());m=g['mesh'];sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
for key in ('positions','indices'):
 if sha(root/m[key]['file'])!=m[key]['sha256']:raise ValueError('Changed mesh bytes')
if sha(root/'original.blend')!=g['source']['blendSha256']:raise ValueError('Changed original source')
p=np.fromfile(root/m['positions']['file'],dtype='<u2').reshape(len(m['poseIndices']),m['vertexCount'],3)/65535
p=p*(np.array(m['bounds']['max'])-m['bounds']['min'])+m['bounds']['min']
indices=np.fromfile(root/m['indices']['file'],dtype='<u2').reshape(-1,3)
if indices.max()>=m['vertexCount'] or not np.isfinite(p).all():raise ValueError('Invalid decoding')
parts={};offset=0
for part in m['audit']['parts']:
 end=offset+part['proxyVertices'];chosen=indices[(indices[:,0]>=offset)&(indices[:,0]<end)]
 if np.any(chosen<offset) or np.any(chosen>=end):raise ValueError('Cross-part triangle')
 parts[part['object']]=chosen;offset=end
if offset!=m['vertexCount']:raise ValueError('Incomplete anatomy ranges')
bpy.ops.wm.open_mainfile(filepath=str(root/'original.blend'),load_ui=False);scene=select_source_scene(bpy.data.scenes,g['render']['inputHash'],g['asset']);bpy.context.window.scene=scene;scene.frame_set(0);bpy.context.view_layer.update()
a=anatomy(scene);frozen=anchors(a);rows=[]
for f in g['render']['frames']:
 value=f['blenderFrame'];scene.frame_set(math.floor(value),subframe=value%1);bpy.context.view_layer.update();original=sample(a,frozen,g['scale']);pose=f['index']
 for azimuth,elevation in VIEWS:
  cache={}
  for side,old in original.items():
   names=['Pelvis','Standing torso',a['legs'][side].name,side+' closed hip transition']
   triangles=np.concatenate([parts[name] for name in names]);result=corridor_metric(old['start'],old['end'],[(p[pose],triangles)],azimuth,elevation)
   rows.append(dict(pose=pose,leg=side,azimuth=azimuth,elevation=elevation,**result))
 print('R2_DECODED',pose,flush=True)
report=dict(meshSha256=m['positions']['sha256'],samples=len(rows),failed=sum(r['maxGapWorld']>.25 for r in rows),maxGapWorld=max(r['maxGapWorld'] for r in rows),rows=rows)
(root/'decoded-corridors.json').write_text(json.dumps(report,indent=2))
if report['failed']:raise ValueError('Decoded export opens attachment corridors')
print('R2_DECODED_COMPLETE',report['samples'],report['maxGapWorld'],flush=True)

