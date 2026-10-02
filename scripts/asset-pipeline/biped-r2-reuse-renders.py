"""Reuse images only after exact evaluated geometry/material/camera equivalence.
Useful when correcting mesh export metadata without changing any rendered surface.
"""
import argparse,hashlib,json,math,shutil,sys
from pathlib import Path
sys.dont_write_bytecode=True;sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy,numpy as np
from mesh_shadow_blender import evaluated
from mesh_shadow_geometry import select_source_scene
ap=argparse.ArgumentParser();ap.add_argument('--before',required=True);ap.add_argument('--after',required=True);args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
old,new=Path(args.before),Path(args.after);sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def extract(root):
 g=json.loads((root/'geometry.json').read_text())
 if sha(root/'source.blend')!=g['repairedBlendSha256']:raise ValueError('Changed source')
 bpy.ops.wm.open_mainfile(filepath=str(root/'source.blend'),load_ui=False);s=select_source_scene(bpy.data.scenes,g['render']['inputHash'],g['asset']);bpy.context.window.scene=s
 objects=sorted([o for o in s.objects if o.type=='MESH' and not o.hide_render],key=lambda o:o.name);rows=[]
 for f in g['render']['frames']:
  v=f['blenderFrame'];s.frame_set(math.floor(v),subframe=v%1);bpy.context.view_layer.update();parts={}
  for o in objects:
   p,t,_=evaluated(o);parts[o.name]=dict(positions=hashlib.sha256(p.tobytes()).hexdigest(),indices=hashlib.sha256(t.tobytes()).hexdigest(),materials=[m.name for m in o.data.materials])
  rows.append(dict(pose=f['index'],parts=parts,camera=np.array(s.camera.matrix_world).ravel().tolist(),ortho=s.camera.data.ortho_scale))
 return g,rows
a,ar=extract(old);b,br=extract(new)
if a['source']!=b['source'] or ar!=br:raise ValueError('Geometry/material/camera differs; fresh renders required')
if (new/'renders').exists():
 for file in (old/'renders').rglob('*'):
  if file.is_file() and sha(file)!=sha(new/'renders'/file.relative_to(old/'renders')):raise ValueError('Incomplete or changed inherited renders')
else:shutil.copytree(old/'renders',new/'renders')
proof=dict(beforeBlendSha256=a['repairedBlendSha256'],afterBlendSha256=b['repairedBlendSha256'],beforeGeometrySha256=sha(old/'geometry.json'),afterGeometrySha256=sha(new/'geometry.json'),
 receiptSha256=sha(new/'renders/receipt.json'),method='exact Float64 evaluated vertices, triangles, material assignments and camera, every exported pose',rows=br)
(new/'render-reuse-proof.json').write_text(json.dumps(proof,indent=2));print('R2_REUSE_PROVED',len(br),flush=True)
