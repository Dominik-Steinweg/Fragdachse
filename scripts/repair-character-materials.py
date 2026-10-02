"""21e4 diagnostic/control + isolated material render; does not modify 21c.

Run in Blender with the hash-verified 21c source.blend already open.
--control reproduces the original interleaved persistent-data pass schedule.
The isolated run fixes pass lifetime: assign materials once per pass, disable
persistent render data, and tag/flush dependency updates before rendering.
21e4 control reproduced opaque-black emission with persistent data (pose 31);
same interleaved schedule without persistence and isolated 37-pose run were clean.
The source Blend and its Beauty materials are deliberately never overwritten.
"""
import bpy, numpy as np, argparse, importlib.util, json, sys, hashlib, shutil
from pathlib import Path
sys.dont_write_bytecode=True
ap=argparse.ArgumentParser();ap.add_argument('--control',action='store_true');ap.add_argument('--device',default='OPTIX',choices=['OPTIX','CPU'])
ap.add_argument('--label',default=None);ap.add_argument('--all',action='store_true');ap.add_argument('--no-persistent',action='store_true')
args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
repo=Path('C:/Fragdachse');source=Path('D:/Fragdachse-render/player-shadow-21c-production');root=Path('D:/Fragdachse-render/player-material-21e4')
out=root/(args.label or ('control' if args.control else 'isolated'))
if out.parent!=root or out.name in ('','.','..'):raise RuntimeError('Invalid label')
job=json.loads((source/'job.json').read_text());spec=job['spec']
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
if Path(bpy.data.filepath).resolve()!=source/'source.blend' or sha(source/'source.blend')!=job['source']['blendSha256']:raise RuntimeError('Wrong source Blend')
if out.exists():raise RuntimeError('Immutable output already exists: '+str(out))
out.mkdir(parents=True);(out/'intermediate').mkdir()
for name in ('albedo','normal'):(out/name).mkdir()
helper=repo/'scripts/asset-pipeline/character_pass_blender.py'
loader=importlib.util.spec_from_file_location('passes',helper);p=importlib.util.module_from_spec(loader);loader.loader.exec_module(p)
scene=next(s for s in bpy.data.scenes if s.get('inputHash')==job['render']['inputHash'] and s.get('asset_manifest'));bpy.context.window.scene=scene
if scene.camera.data.type!='ORTHO' or any(abs(v)>1e-7 for v in scene.camera.rotation_euler):raise RuntimeError('Camera changed')
objects=[o for o in scene.objects if o.type=='MESH' and not o.hide_render]
originals={o:[slot.material for slot in o.material_slots] for o in objects};audit=[]
albedos={m:p.unlit_copy(m,audit) for mats in originals.values() for m in mats if m}
normal=p.emission_material('FD_21e4_normal','normal',spec);ao=p.emission_material('FD_21e4_ao','ao',spec)
scene.render.engine='CYCLES';scene.cycles.use_denoising=False;scene.cycles.seed=spec['shadow']['seed'];scene.cycles.samples=spec['material']['samples']
scene.render.use_persistent_data=args.control and not args.no_persistent
if args.device!='CPU':
 prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type=args.device;prefs.get_devices()
 for d in prefs.devices:d.use=d.type==args.device
 if not any(d.use for d in prefs.devices):raise RuntimeError('Requested render device unavailable')
scene.cycles.device='CPU' if args.device=='CPU' else 'GPU'
scene.render.resolution_x=scene.render.resolution_y=spec['material']['masterSize'];scene.render.resolution_percentage=100
scene.render.pixel_aspect_x=scene.render.pixel_aspect_y=1;scene.render.film_transparent=True
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32';scene.render.image_settings.exr_codec='ZIP'
scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1;scene.use_nodes=False
for ob in scene.objects:
 if ob.type=='LIGHT':ob.hide_render=True
world=bpy.data.worlds.new('FD_21e4_black');world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Strength'].default_value=0;scene.world=world
poses=job['poses'] if args.control or args.all else [p for p in job['poses'] if p['index'] in (9,12,17,22,27)]
def assign(mode):
 for ob,mats in originals.items():
  for i,m in enumerate(mats):ob.material_slots[i].material=albedos[m] if mode=='albedo' else normal if mode=='normal' else ao
  if not args.control:ob.update_tag(refresh={'DATA'})
 if not args.control:bpy.context.view_layer.update()
records=[]
def render(pose,mode):
 a,seconds=p.render_float(scene,out,f'{mode}-{pose["index"]:02d}')
 opaque=a[:,:,3]>.99;rgb=a[:,:,:3][opaque]
 records.append(dict(pose=pose['index'],pass_name=mode,seconds=seconds,nonfinite=int(np.count_nonzero(~np.isfinite(a))),opaqueBlack=int(np.count_nonzero(np.max(np.abs(rgb),axis=1)<1e-8)),min=float(rgb.min()),max=float(rgb.max())))
 (out/'report.partial.json').write_text(json.dumps(records,indent=2))
 print('21E4_PASS',json.dumps(records[-1]),flush=True)
 if not args.control and (records[-1]['nonfinite'] or records[-1]['opaqueBlack']):
  raise RuntimeError('Invalid pass: inspect material state; never publish black emission')
if args.control:
 for pose in poses:
  p.sample(scene,pose['blenderFrame'])
  for mode in ('albedo','normal','ao'):assign(mode);render(pose,mode)
else:
 for mode in ('albedo','normal','ao'):
  assign(mode)
  for pose in poses:p.sample(scene,pose['blenderFrame']);render(pose,mode)
 # Reuse exactly the original coverage-weighted reduction/normal convention.
 def load(mode,pose):
  im=bpy.data.images.load(str(out/'intermediate'/f'{mode}-{pose:02d}.exr'),check_existing=False);im.colorspace_settings.name='Non-Color'
  a=np.empty(len(im.pixels),dtype=np.float32);im.pixels.foreach_get(a);a=a.reshape(im.size[1],im.size[0],4)[::-1].copy();bpy.data.images.remove(im);return a
 for pose in poses:
  values={mode:load(mode,pose['index']) for mode in ('albedo','normal','ao')}
  for size in spec['material']['sourceSizes']:
   factor=spec['material']['masterSize']//size
   a=p.reduce_blocks(values['albedo'],factor);n=p.reduce_blocks(values['normal'],factor);v=p.reduce_blocks(values['ao'],factor)
   if max(np.max(np.abs(a[:,:,3]-n[:,:,3])),np.max(np.abs(a[:,:,3]-v[:,:,3])))>.025:raise RuntimeError('Pass coverage mismatch')
   coverage=a[:,:,3:4];rgb=np.clip(a[:,:,:3]/np.maximum(coverage,1e-8),0,1)
   srgb=np.where(rgb<=.0031308,rgb*12.92,1.055*rgb**(1/2.4)-.055)
   rgba=np.concatenate([srgb,coverage],axis=2)
   normals=n[:,:,:3]/np.maximum(n[:,:,3:4],1e-8)*2-1;normals/=np.maximum(np.linalg.norm(normals,axis=2,keepdims=True),1e-8);normals[coverage[:,:,0]<1e-6]=[0,0,1]
   ambient=np.clip(v[:,:,:1]/np.maximum(v[:,:,3:4],1e-8),0,1);ambient[coverage<1e-6]=1;p.extend_normal_edges(normals,ambient,coverage)
   data=np.concatenate([normals*.5+.5,ambient],axis=2)
   for mode,px in [('albedo',rgba),('normal',data)]:p.png(out/mode/f'pose-{pose["index"]:02d}-{size}.png',np.rint(np.clip(px,0,1)*255).astype('uint8'))
receipt=dict(sourceBlendSha256=sha(source/'source.blend'),parentPassManifestSha256=sha(source/'render-passes.json'),helperSha256=sha(helper),scriptSha256=sha(__file__),blender=bpy.app.version_string,device=args.device,control=args.control,persistentData=scene.render.use_persistent_data,poses=[p['index'] for p in poses],materialAudit=audit,records=records)
(out/'receipt.json').write_text(json.dumps(receipt,indent=2));shutil.copyfile(__file__,out/'render_materials.py');shutil.copyfile(helper,out/'character_pass_blender.py')
if sha(source/'source.blend')!=job['source']['blendSha256']:raise RuntimeError('Source changed')
print('21E4_COMPLETE',out,flush=True)
