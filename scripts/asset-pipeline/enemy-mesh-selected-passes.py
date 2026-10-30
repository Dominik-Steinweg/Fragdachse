"""Render a pinned enemy repair to D:, without selecting or importing any asset."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
sys.dont_write_bytecode = True


def through_ground_cut(material, shader):
    """Route a data-pass shader through the material's copied recipe ground cut, if it has one.

    A keyed shader cut (the Grave Titan digging itself out) hides geometry in Beauty; copies of the
    material keep the cut mix and its keyed level, so every pass composites the same transparency.
    """
    nodes, links = material.node_tree.nodes, material.node_tree.links
    cut = nodes.get('Ground cut')
    for output in [n for n in nodes if n.type == 'OUTPUT_MATERIAL']:
        links.new(cut.outputs[0] if cut else shader, output.inputs['Surface'])
    if cut:
        links.new(shader, cut.inputs[2])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', required=True)
    parser.add_argument('--frames', default='all')
    parser.add_argument('--output', help='Exclusive D: directory for material-only repair of an archived source')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    source = Path(args.job).resolve().parent
    output = source
    job = json.loads(Path(args.job).read_text(encoding='utf8'))
    workspace = Path.cwd()
    local_root = workspace/'art/poc/pipeline-v2/enemy-mesh'
    if output.parent != Path(job['outputRoot']).resolve() or not (
            output.is_relative_to(local_root) or output.parent.parent == Path('D:/Fragdachse-render')):
        raise ValueError('Render output must be in the bound local or legacy revision')
    # Repair implementation is the exact archived implementation used for geometry.
    sys.path.insert(0, str(source/'source-tools'))
    sys.path.insert(0, str(Path.cwd()/'scripts/asset-pipeline'))
    import bpy
    import numpy as np
    from mesh_shadow_geometry import select_source_scene
    from enemy_mesh_anatomy import legacy_anatomy, freeze_anchors, follow_body, add_transitions
    from character_pass_blender import (png, render_float, reduce_blocks, emission_material, pass_shader,
                                        unlit_copy, extend_normal_edges)
    def sha(p):
        return hashlib.sha256(Path(p).read_bytes()).hexdigest()
    for member, expected in job['sourceFiles'].items():
        if sha(source/member) != expected:
            raise ValueError('Changed source: '+member)
    target = source/'candidate.blend'
    if args.output:
        output = Path(args.output).resolve()
        if not output.is_relative_to(Path('D:/Fragdachse-render')) or output == source:
            raise ValueError('Repair output must be an exclusive external D: directory')
        output.mkdir(parents=True, exist_ok=False)
        target = source/'render-source.blend'
        prior = json.loads((source/'render-passes.json').read_text(encoding='utf8'))
        if sha(target) != prior['sourceBlendSha256']:
            raise ValueError('Changed archived render source')
    (output/'intermediate/optix').mkdir(parents=True, exist_ok=True)
    if not target.exists(): raise ValueError('Missing persisted repaired source')
    # Every actual render reopens the persisted repaired source independently.
    bpy.ops.wm.open_mainfile(filepath=str(target), load_ui=False)
    scene = select_source_scene(bpy.data.scenes, job['render']['inputHash'], job['id'])
    bpy.context.window.scene = scene
    if scene.camera.data.type != 'ORTHO' or any(abs(v) > 1e-7 for v in scene.camera.rotation_euler):
        raise ValueError('Camera is not exactly top-down')
    if abs(scene.camera.data.ortho_scale-job['render']['orthoScale']) > 1e-5:
        raise ValueError('Canvas scale changed')
    os.environ['OPTIX_CACHE_PATH'] = os.environ.get('OPTIX_CACHE_PATH', str(output/'intermediate/optix'))
    Path(os.environ['OPTIX_CACHE_PATH']).mkdir(parents=True, exist_ok=True)
    prefs = bpy.context.preferences.addons['cycles'].preferences
    device = 'CPU'
    for kind in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = kind; prefs.refresh_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                device = kind; break
        except Exception:
            pass
    scene.cycles.device = 'CPU' if device == 'CPU' else 'GPU'
    scene.render.use_persistent_data = False
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.cycles.samples = 64; scene.cycles.seed = 37
    original_denoising = scene.cycles.use_denoising
    original_view = (scene.view_settings.view_transform, scene.view_settings.look)
    original_world = scene.world
    lights = [o for o in scene.objects if o.type == 'LIGHT']
    light_states = {o:o.hide_render for o in lights}
    originals = {o:[s.material for s in o.material_slots] for o in scene.objects if o.type == 'MESH' and not o.hide_render}
    materials = sorted({m for mats in originals.values() for m in mats if m}, key=lambda m:m.name)
    audit, albedos, emissions = [], {}, {}
    for material in materials:
        clone = material.copy()
        # Archived enemy_surface_parts adds two unnamed MULTIPLY nodes: broad
        # normal-facing shade and AO contact. Identify their exact graph shapes,
        # retain authored grain/stains, then let the shared reachable-graph audit
        # reject any remaining form lighting rather than silently flattening it.
        removed = []
        nodes, links = clone.node_tree.nodes, clone.node_tree.links
        # Kraken V8 dermis (also the plague toad's hide) keeps its value plan, folds and pigment
        # cells; its named form shade, grazing sheen and cavity tint pass their unlit input on.
        if clone.get('FD_SurfaceKind') == 'kraken-dermis-v8':
            for name, reason in (('Form shadow strength', 'dermis form and contact shade'),
                                 ('Iridescent violet-teal sheen', 'dermis grazing sheen'),
                                 ('MS cool recessed flesh', 'dermis cavity AO tint')):
                node = nodes.get(name)
                if node is None:
                    continue
                source, result = (node.inputs[6], node.outputs[2]) if node.type == 'MIX' else (node.inputs[1], node.outputs[0])
                for link in list(result.links):
                    target_socket = link.to_socket; links.remove(link)
                    if source.is_linked: links.new(source.links[0].from_socket, target_socket)
                    else: target_socket.default_value = source.default_value
                removed.append(dict(node=name, reason=reason))
        for node in list(nodes):
            if node.type != 'MIX_RGB' or node.blend_type != 'MULTIPLY' or not node.inputs[2].is_linked:
                continue
            branch = node.inputs[2].links[0].from_node
            contact = branch.type == 'AMBIENT_OCCLUSION'
            form = False
            if branch.type == 'MAP_RANGE' and branch.inputs['Value'].is_linked:
                dot = branch.inputs['Value'].links[0].from_node
                form = dot.type == 'VECT_MATH' and dot.operation == 'DOT_PRODUCT' and any(
                    link.from_node.type == 'NEW_GEOMETRY' and link.from_socket.name == 'Normal'
                    for socket in dot.inputs for link in socket.links)
            if not (contact or form):
                continue
            source = node.inputs[1]
            for link in list(node.outputs[0].links):
                target_socket = link.to_socket; links.remove(link)
                if source.is_linked: links.new(source.links[0].from_socket, target_socket)
                else: target_socket.default_value = source.default_value
            removed.append(dict(node=node.name, reason='enemy contact AO' if contact else 'enemy normal-facing form shade'))
        bs = clone.node_tree.nodes.get('Principled BSDF')
        if not bs or bs.inputs['Emission Strength'].is_linked:
            raise ValueError('Unsupported enemy material emission: '+material.name)
        strength = bs.inputs['Emission Strength'].default_value
        bs.inputs['Emission Strength'].default_value = 0
        albedos[material] = unlit_copy(clone, audit)
        through_ground_cut(albedos[material], albedos[material].node_tree.nodes['FD_Albedo_Output'].outputs[0])
        audit[-1]['sourceMaterial'] = material.name
        audit[-1]['enemyBypassed'] = removed
        audit[-1]['separateEmissionStrength'] = strength
        emitter = material.copy(); emitter.name = 'FD_Enemy_Emission_'+material.name
        nodes, links = emitter.node_tree.nodes, emitter.node_tree.links
        original = nodes.get('Principled BSDF')
        out = nodes.new('ShaderNodeEmission')
        color = original.inputs['Emission Color']
        if color.is_linked:
            links.new(color.links[0].from_socket, out.inputs['Color'])
        else:
            out.inputs['Color'].default_value = color.default_value
        out.inputs['Strength'].default_value = strength
        through_ground_cut(emitter, out.outputs[0])
        emissions[material] = emitter
    ao_spec = {'material':{'aoSamples':16,'aoDistanceBlender':.5}}
    normal_material = emission_material('FD_Enemy_Normal', 'normal', {})
    ao_material = emission_material('FD_Enemy_AO', 'ao', ao_spec)
    # Ground-cut materials get their own normal/AO copies, so the data shader composites through the same cut.
    normals, aos = {}, {}
    for material in materials:
        if not material.node_tree.nodes.get('Ground cut'):
            continue
        for variants, mode, spec in ((normals, 'normal', {}), (aos, 'ao', ao_spec)):
            variant = material.copy(); variant.name = f'FD_Enemy_{mode}_{material.name}'
            through_ground_cut(variant, pass_shader(variant.node_tree.nodes, variant.node_tree.links, mode, spec))
            variants[material] = variant
    dark = bpy.data.worlds.new('FD_Enemy_Data_World'); dark.use_nodes = True
    dark.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
    selected = job['poses'] if args.frames == 'all' else [p for p in job['poses'] if p['index'] in [int(s) for s in args.frames.split(',')]]
    from render_integrity import configure_cache, provenance
    configure_cache(scene, dict(job=job, renderer=sha(__file__), device=device), output)
    report = dict(provenance=provenance(scene, {**job['sourceFiles'], 'renderBlend': sha(target)}), schema='fd-enemy-render-passes', version=1, id=job['id'], sourceBlendSha256=sha(target),
                  rendererSha256=sha(__file__), device=device, masterSize=1024, samples=64, seed=37,
                  canvas=job['coordinates'], layout=job['layout'], materialAudit=audit, frames=[], persistentData=False, passMajor=True,
                  normalEncoding='linear RGB world (X right, Y south, Z up); A raw AO visibility; coverage in albedo A',
                  albedoEncoding='sRGB straight RGB, coverage A; no form light/AO/specular',
                  emissionEncoding='separate sRGB radiance (authored strengths <=1), coverage A')
    # Material tiles are exact block means of the 1024 master; a source size that does not divide it
    # (the Grave Titan's 336) keeps only the 64/128 material sheets and binds its Beauty at seal.
    sizes = sorted({64, 128} | ({job['layout']['frameWidth']} if 1024 % job['layout']['frameWidth'] == 0 else set()))
    for mode in ('beauty', 'albedo', 'normal', 'emission'):
        (output/mode/'masters').mkdir(parents=True, exist_ok=True)
        for size in sizes:
            (output/mode/str(size)).mkdir(exist_ok=True)

    if normals:
        report['groundCut'] = dict(materials=len(normals), method='data shaders composite through the copied keyed recipe cut')

    # Pass-major rendering prevents mutable material graphs from leaking between passes.
    for mode in ('beauty','albedo','normal','ao','emission'):
        scene.world = original_world if mode=='beauty' else dark
        scene.view_settings.view_transform, scene.view_settings.look = original_view if mode=='beauty' else ('Raw','None')
        scene.cycles.use_denoising = original_denoising if mode=='beauty' else False
        for ob,state in light_states.items(): ob.hide_render = state if mode=='beauty' else True
        for ob,mats in originals.items():
            for i,mat in enumerate(mats):
                ob.material_slots[i].material = mat if mode=='beauty' else albedos[mat] if mode=='albedo' else emissions[mat] if mode=='emission' else normals.get(mat, normal_material) if mode=='normal' else aos.get(mat, ao_material)
        scene.render.image_settings.file_format = 'PNG' if mode=='beauty' else 'OPEN_EXR'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.image_settings.color_depth = '8' if mode=='beauty' else '32'
        scene.render.image_settings.exr_codec = 'ZIP'
        for pose in selected:
            index,frame=pose['index'],pose['blenderFrame'];scene.frame_set(math.floor(frame),subframe=frame%1);bpy.context.view_layer.update()
            name=f'frame-{index:04d}.png';start=time.monotonic()
            if mode=='beauty':
                scene.render.filepath=str(output/'beauty/masters'/name);bpy.ops.render.render(write_still=True,scene=scene.name)
            else:
                values,_=render_float(scene,output,f'{mode}-{index:04d}')
                if not np.all(np.isfinite(values)):raise ValueError('Nonfinite material pass')
                if mode in ('albedo','normal') and np.any((values[:,:,3]>.95)&np.all(values[:,:,:3]==0,axis=2)):raise ValueError('Opaque black material corruption')
                np.save(output/'intermediate'/f'{mode}-{index:04d}.npy',values)
            print('FD_ENEMY_RENDER',job['id'],index,mode,round(time.monotonic()-start,2),flush=True)
    for pose in selected:
        index,frame=pose['index'],pose['blenderFrame'];name=f'frame-{index:04d}.png'
        values={mode:np.load(output/'intermediate'/f'{mode}-{index:04d}.npy') for mode in ('albedo','normal','ao','emission')}
        for size in [*sizes, 1024]:
            reduced={k:reduce_blocks(v,1024//size) for k,v in values.items()}
            a,n,ambient=reduced['albedo'],reduced['normal'],reduced['ao'];coverage=a[:,:,3:4]
            if max(float(np.max(np.abs(coverage[:,:,0]-v[:,:,3]))) for v in reduced.values())>.025:raise ValueError('Material coverage mismatch')
            folder='masters' if size==1024 else str(size)
            for mode in ('albedo','emission'):
                v=reduced[mode];rgb=np.clip(v[:,:,:3]/np.maximum(v[:,:,3:4],1e-8),0,1)
                srgb=np.where(rgb<=.0031308,rgb*12.92,1.055*rgb**(1/2.4)-.055)
                png(output/mode/folder/name,np.rint(np.clip(np.concatenate([srgb,coverage],2),0,1)*255).astype('uint8'))
            normals=n[:,:,:3]/np.maximum(n[:,:,3:4],1e-8)*2-1
            normals/=np.maximum(np.linalg.norm(normals,axis=2,keepdims=True),1e-8);normals[coverage[:,:,0]<1e-6]=[0,0,1]
            ao=np.clip(ambient[:,:,:1]/np.maximum(ambient[:,:,3:4],1e-8),0,1);ao[coverage<1e-6]=1
            extend_normal_edges(normals,ao,coverage)
            png(output/'normal'/folder/name,np.rint(np.clip(np.concatenate([normals*.5+.5,ao],2),0,1)*255).astype('uint8'))
        report['frames'].append(dict(index=index,blenderFrame=frame,beautySha256=sha(output/'beauty/masters'/name)))
    report['cache'] = dict(hits=scene['fd_cache_hits'], misses=scene['fd_cache_misses'])
    report['outputs'] = {p.relative_to(output).as_posix(): sha(p) for mode in ('beauty','albedo','normal','emission') for p in (output/mode).rglob('*.png')}
    (output/'render-passes.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print('FD_ENEMY_RENDER_COMPLETE',job['id'],flush=True)

if __name__=='__main__': main()
