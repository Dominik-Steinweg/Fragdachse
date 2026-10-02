"""Render repaired source Beauty and complete 21e material passes, pass-major/no cache.
The preserved source Blend is reopened; output is exclusive and never imported here.
"""
import argparse, hashlib, json, math, os, sys, time, shutil
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy
import numpy as np
from mesh_shadow_geometry import select_source_scene
from character_pass_blender import render_float, reduce_blocks, emission_material, unlit_copy, extend_normal_edges, png
ap=argparse.ArgumentParser();ap.add_argument('--root',required=True);ap.add_argument('--poses',default='all')
args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);root=Path(args.root).resolve()
if root.parent.parent!=Path('D:/Fragdachse-render'):raise ValueError('Expected isolated external asset directory')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
g=json.loads((root/'geometry.json').read_text());source=root/'source.blend'
if sha(source)!=g['repairedBlendSha256']:raise ValueError('Changed repaired Blend')
out=root/('renders' if args.poses=='all' else 'preview');out.mkdir(exist_ok=False);(out/'intermediate').mkdir()
for mode in ('beauty','albedo','normal','ao'):(out/mode).mkdir()
os.environ['OPTIX_CACHE_PATH']=str(root.parent/'optix-cache');Path(os.environ['OPTIX_CACHE_PATH']).mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
scene=select_source_scene(bpy.data.scenes,g['render']['inputHash'],g['asset']);bpy.context.window.scene=scene
if scene.camera.data.type!='ORTHO' or any(abs(v)>1e-7 for v in scene.camera.rotation_euler) or abs(scene.camera.data.ortho_scale-g['render']['orthoScale'])>1e-6:raise ValueError('Changed canvas')
spec=json.loads(Path('D:/Fragdachse-render/player-shadow-21c-production/job.json').read_text())['spec']
scene.render.engine='CYCLES';scene.render.use_persistent_data=False
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
if not any(d.use for d in prefs.devices):raise ValueError('OPTIX unavailable')
scene.cycles.device='GPU';scene.cycles.samples=64;scene.cycles.seed=37
scene.render.resolution_x=scene.render.resolution_y=1024;scene.render.resolution_percentage=100;scene.render.film_transparent=True
scene.render.pixel_aspect_x=scene.render.pixel_aspect_y=1
frames=g['render']['frames'] if args.poses=='all' else [f for f in g['render']['frames'] if f['index'] in list(map(int,args.poses.split(',')))]
records=[];originals={o:[slot.material for slot in o.material_slots] for o in scene.objects if o.type=='MESH' and not o.hide_render}
def frame(f):scene.frame_set(math.floor(f['blenderFrame']),subframe=f['blenderFrame']%1);bpy.context.view_layer.update()
for f in frames:
 frame(f);scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='8'
 scene.render.filepath=str(out/'beauty'/f'pose-{f["index"]:02d}-1024.png');start=time.monotonic();bpy.ops.render.render(write_still=True,scene=scene.name)
 records.append(dict(pose=f['index'],mode='beauty',seconds=time.monotonic()-start,sha256=sha(scene.render.filepath)))
 print('R2_RENDER',g['asset'],f['index'],'beauty',flush=True)
audit=[];albedo={m:unlit_copy(m,audit) for mats in originals.values() for m in mats if m}
normal=emission_material('R2_Normal','normal',spec);ao=emission_material('R2_AO','ao',spec)
scene.cycles.use_denoising=False;scene.use_nodes=False;scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32';scene.render.image_settings.exr_codec='ZIP'
for ob in scene.objects:
 if ob.type=='LIGHT':ob.hide_render=True
world=bpy.data.worlds.new('R2_unlit');world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Strength'].default_value=0;scene.world=world
for mode in ('albedo','normal','ao'):
 for ob,mats in originals.items():
  for i,m in enumerate(mats):ob.material_slots[i].material=albedo[m] if mode=='albedo' else normal if mode=='normal' else ao
  ob.update_tag(refresh={'DATA'})
 bpy.context.view_layer.update()
 for f in frames:
  frame(f);pixels,seconds=render_float(scene,out,f'{mode}-{f["index"]:02d}')
  rgb=pixels[:,:,:3][pixels[:,:,3]>.99];black=int(np.count_nonzero(np.max(np.abs(rgb),axis=1)<1e-8))
  if black or not np.isfinite(pixels).all():raise ValueError(f'Invalid {mode} material sample {f["index"]}: {black} black pixels')
  records.append(dict(pose=f['index'],mode=mode,seconds=seconds,opaqueBlack=black))
  (out/'partial.json').write_text(json.dumps(records));print('R2_RENDER',g['asset'],f['index'],mode,round(seconds,2),flush=True)
def load(mode,index):
 image=bpy.data.images.load(str(out/'intermediate'/f'{mode}-{index:02d}.exr'),check_existing=False);image.colorspace_settings.name='Non-Color'
 values=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(values);values=values.reshape(image.size[1],image.size[0],4)[::-1].copy();bpy.data.images.remove(image);return values
coverage=[]
for f in frames:
 i=f['index'];values={mode:load(mode,i) for mode in ('albedo','normal','ao')}
 for size in (64,128):
  a,n,v=[reduce_blocks(values[mode],1024//size) for mode in ('albedo','normal','ao')];c=a[:,:,3:4]
  error=float(max(np.max(np.abs(a[:,:,3]-n[:,:,3])),np.max(np.abs(a[:,:,3]-v[:,:,3]))));coverage.append(dict(pose=i,size=size,error=error))
  if error>.025:raise ValueError('Material coverage mismatch')
  rgb=np.clip(a[:,:,:3]/np.maximum(c,1e-8),0,1);srgb=np.where(rgb<=.0031308,rgb*12.92,1.055*rgb**(1/2.4)-.055)
  normals=n[:,:,:3]/np.maximum(n[:,:,3:4],1e-8)*2-1;normals/=np.maximum(np.linalg.norm(normals,axis=2,keepdims=True),1e-8);normals[c[:,:,0]<1e-6]=[0,0,1]
  ambient=np.clip(v[:,:,:1]/np.maximum(v[:,:,3:4],1e-8),0,1);ambient[c<1e-6]=1;extend_normal_edges(normals,ambient,c)
  for mode,px in [('albedo',np.concatenate([srgb,c],2)),('normal',np.concatenate([normals*.5+.5,ambient],2)),('ao',np.concatenate([np.repeat(ambient,3,axis=2),c],2))]:
   png(out/mode/f'pose-{i:02d}-{size}.png',np.rint(np.clip(px,0,1)*255).astype('uint8'))
receipt=dict(sourceBlendSha256=sha(source),geometrySha256=sha(root/'geometry.json'),scriptSha256=sha(__file__),helperSha256=sha(Path(__file__).parent/'character_pass_blender.py'),
 persistentData=False,passMajor=True,blender=bpy.app.version_string,device='OPTIX',poses=[f['index'] for f in frames],records=records,coverage=coverage,materialAudit=audit)
(out/'receipt.json').write_text(json.dumps(receipt,indent=2));shutil.copyfile(__file__,out/'render.py');shutil.copyfile(Path(__file__).parent/'character_pass_blender.py',out/'character_pass_blender.py')
if sha(source)!=g['repairedBlendSha256']:raise ValueError('Source modified during rendering')
print('R2_RENDER_COMPLETE',root,flush=True)
