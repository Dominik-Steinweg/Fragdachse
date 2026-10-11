"""Nine-pose Kraken lighting pilot from hash-pinned, saved production geometry."""
import sys
sys.dont_write_bytecode = True
import argparse, hashlib, json, math, time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy
import numpy as np
from character_pass_blender import png
from kraken_ls_material import adapt


def digest(file): return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def write(file,value): Path(file).write_text(json.dumps(value,indent=2)+'\n',encoding='utf8')
def sample(scene,value):
    scene.frame_set(math.floor(value),subframe=value%1)
    bpy.context.view_layer.update()


def geometry(objects):
    deps=bpy.context.evaluated_depsgraph_get(); positions=[]; triangles=[]; count=0
    for obj in objects:
        evaluated=obj.evaluated_get(deps); mesh=evaluated.to_mesh()
        try:
            if not len(mesh.vertices): continue
            a=np.empty(len(mesh.vertices)*3,dtype=np.float32);mesh.vertices.foreach_get('co',a);a=a.reshape(-1,3)
            matrix=np.asarray(evaluated.matrix_world,dtype=np.float64)
            a=a@matrix[:3,:3].T+matrix[:3,3]
            mesh.calc_loop_triangles()
            t=np.empty(len(mesh.loop_triangles)*3,dtype=np.int32);mesh.loop_triangles.foreach_get('vertices',t)
            positions.append(a);triangles.append(t.reshape(-1,3)+count);count+=len(a)
        finally:evaluated.to_mesh_clear()
    return np.concatenate(positions),np.concatenate(triangles)


def proxy(scene,vertices,triangles,target):
    mesh=bpy.data.meshes.new('LS_temporary_proxy');mesh.from_pydata(vertices.tolist(),[],triangles.tolist());mesh.update()
    obj=bpy.data.objects.new('LS_temporary_proxy',mesh);scene.collection.objects.link(obj);obj.hide_render=True
    mod=obj.modifiers.new('Pilot evaluated-pose reduction','DECIMATE');mod.ratio=min(1,target/len(triangles));mod.use_collapse_triangulate=True
    try:
        bpy.context.view_layer.update()
        return geometry([obj])
    finally:
        bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(mesh)


def render_float(scene,file):
    scene.render.filepath=str(file)
    start=time.perf_counter();bpy.ops.render.render(write_still=True,scene=scene.name)
    image=bpy.data.images.load(str(file),check_existing=False)
    try:
        image.colorspace_settings.name='Non-Color'
        w,h=image.size;pixels=np.empty(w*h*4,dtype=np.float32);image.pixels.foreach_get(pixels)
        pixels=pixels.reshape(h,w,4)[::-1].copy()
        if not np.isfinite(pixels).all():raise ValueError('Nonfinite float render')
        return pixels,time.perf_counter()-start
    finally:bpy.data.images.remove(image)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--job',required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);job=json.loads(Path(args.job).read_text(encoding='utf8'))
    source=Path(job['source']);out=Path(job['out']);render=job['render']
    if Path(bpy.data.filepath).resolve()!=source/'asset.blend' or digest(bpy.data.filepath)!=job['provenance']['blend']:
        raise ValueError('Source blend mismatch')
    scene=bpy.context.scene
    if scene.camera.data.type!='ORTHO' or any(abs(v)>1e-7 for v in scene.camera.rotation_euler):raise ValueError('Not exact top-down')
    if abs(scene.camera.data.ortho_scale-render['orthoScale'])>1e-5:raise ValueError('Canvas mismatch')
    objects=[o for o in scene.objects if o.type=='MESH' and not o.hide_render]
    materials=list({m for ob in objects for m in ob.data.materials if m})
    write(out/'material-nodes.json',[{'name':m.name,'nodes':[{'name':n.name,'type':n.type} for n in m.node_tree.nodes]} for m in materials])
    scale=render['targetSize']*render.get('displayScale',1)/render['orthoScale']
    pose_geometry=[];minimum=math.inf;maximum=-math.inf
    for pose in job['poses']:
        sample(scene,pose['blenderFrame']);v,t=geometry(objects)
        minimum=min(minimum,float(v[:,2].min()));maximum=max(maximum,float(v[:,2].max()))
        pose_geometry.append((v,t))
    height_range=[math.floor((minimum-.1)*10)/10,math.ceil((maximum+.1)*10)/10]
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=False;scene.cycles.seed=37
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    found=False
    for d in prefs.devices:d.use=d.type=='OPTIX';found=found or d.use
    if not found:raise ValueError('OPTIX unavailable; no implicit CPU fallback')
    scene.cycles.device='GPU';scene.render.use_persistent_data=False
    scene.render.resolution_x=scene.render.resolution_y=1024;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
    scene.render.image_settings.exr_codec='ZIP';scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
    scene.view_settings.exposure=0;scene.view_settings.gamma=1;scene.use_nodes=False
    for layer in scene.view_layers:layer.material_override=None
    results=[];audit=[]
    for pose,(vertices,triangles) in zip(job['poses'],pose_geometry):
        sample(scene,pose['blenderFrame']);name=pose['name'];folder=out/name;folder.mkdir(exist_ok=True)
        if digest(source/pose['file'])!=pose['sha256']:raise ValueError('Beauty hash mismatch')
        # Geometry in asset-world coordinates: X right, Y south, Z up.
        dense=vertices*np.array([scale,-scale,scale]);dense.astype('<f4').tofile(folder/'source-positions.bin')
        triangles.astype('<u4').tofile(folder/'source-indices.bin')
        target=8000 if job['role'] in ('water','land') else 4000
        pv,pt=proxy(scene,vertices,triangles,target)
        if len(pv)>65535:raise ValueError('Proxy exceeds U16 indices')
        pv=pv*np.array([scale,-scale,scale]);lo=pv.min(axis=0);hi=pv.max(axis=0)
        quant=np.rint((pv-lo)/np.maximum(hi-lo,1e-9)*65535).astype('<u2')
        quant.tofile(folder/'positions.bin');pt.astype('<u2').tofile(folder/'indices.bin')
        mesh={'vertexCount':len(pv),'triangleCount':len(pt),'bounds':{'min':lo.tolist(),'max':hi.tolist()},
              'positions':{'file':f'{name}/positions.bin','bytes':quant.nbytes,'sha256':digest(folder/'positions.bin')},
              'indices':{'file':f'{name}/indices.bin','bytes':pt.size*2,'sha256':digest(folder/'indices.bin')},
              'sourceVertexCount':len(vertices),'sourceTriangleCount':len(triangles)}
        timings={}
        for mode in ('albedo','normal','height','emission'):
            replacements={};records=[]
            for m in materials:
                replacement,record=adapt(m,mode,height_range);replacements[m]=replacement;records.append(record)
            slots=[]
            for ob in objects:
                for i,m in enumerate(ob.data.materials):
                    if m in replacements:slots.append((ob.data,i,m));ob.data.materials[i]=replacements[m]
            try:
                pixels,elapsed=render_float(scene,folder/(mode+'.exr'));timings[mode]=elapsed
                a=pixels[:,:,3:4];straight=pixels[:,:,:3]/np.maximum(a,1e-8)
                if mode=='height' and np.any((straight[:,:,0][a[:,:,0]>.99]<0)|(straight[:,:,0][a[:,:,0]>.99]>1)):
                    raise ValueError('Height outside encoding; no clamping allowed')
                # Preserve float HDR emission for later publication/tone handling.
                np.save(folder/(mode+'.npy'),pixels)
            finally:
                for data,i,m in slots:data.materials[i]=m
                for m in replacements.values():bpy.data.materials.remove(m)
            audit.extend(records)
        results.append({'name':name,'clip':pose['clip'],'clipFrame':pose['clipFrame'],'sourceFrame':pose['index'],
                        'blenderFrame':pose['blenderFrame'],'beauty':pose['file'],'beautySha256':pose['sha256'],
                        'heightGeometryBU':[float(vertices[:,2].min()),float(vertices[:,2].max())],'mesh':mesh,'timings':timings})
        write(out/'ls-progress.json',results)
    write(out/'ls-raw.json',{'schema':'kraken-light-shadow-pilot','version':1,'revision':job['revision'],
        'role':job['role'],'id':job['id'],'size':job['size'],'worldPxPerBU':scale,'heightRange':height_range,
        'heightRangeScope':'all vertices of selected pilot poses; full-production range not certified',
        'materialAudit':audit,'poses':results,'provenance':job['provenance']})
    if digest(source/'asset.blend')!=job['provenance']['blend']:raise ValueError('Source changed')


if __name__=='__main__':main()
