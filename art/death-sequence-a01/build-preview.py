"""A01 isolated death-clip authoring. Uses the archived, imported V2-AI badger.

Run in a disposable background Blender process; never saves over the source Blend.
The result is an approval preview, not a pipeline selection or runtime import.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view


def ease(a, b, t):
    v = max(0.0, min(1.0, (t-a)/(b-a)))
    return v*v*(3-2*v)


def key(socket, value, frame):
    socket.default_value = value
    socket.keyframe_insert('default_value', frame=frame)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--indices', default='0,8,16,24,34,46,58,68,71')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    repo = Path(args.repo).resolve()
    output = repo / 'art/poc/death-sequence-a01' / args.revision
    if output.exists():
        raise FileExistsError('Use a fresh revision; previews are not overwritten')
    output.mkdir(parents=True)
    source_path = repo / 'art/poc/pipeline-v2/runs/v2-ai/badger/standard/asset.blend'
    bpy.ops.wm.open_mainfile(filepath=str(source_path))
    source = next(s for s in bpy.data.scenes if s.get('pipelineVersion') == 2)
    bpy.context.window.scene = source
    source.frame_set(0)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()

    # Freeze the true rest-pose geometry, including armature/attributes/materials.
    scene = source.copy()
    scene.name = 'A01 death approval ' + args.revision
    for ob in list(scene.collection.objects):
        scene.collection.objects.unlink(ob)
    if len(scene.objects):
        raise RuntimeError('Unexpected nested source collections')
    body_root = bpy.data.objects.new('A01 corporeal badger motion', None)
    scene.collection.objects.link(body_root)
    bodies = []
    body_gathers = []
    material_map = {}
    opacity_sockets = []
    whiten_sockets = []
    for ob in source.objects:
        if ob.type == 'MESH':
            evaluated = ob.evaluated_get(depsgraph)
            mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
            clone = bpy.data.objects.new('A01 ' + ob.name, mesh)
            scene.collection.objects.link(clone)
            clone.matrix_world = evaluated.matrix_world.copy()
            clone.parent = body_root
            bodies.append(clone)
            # Gather the outstretched arms into the emerging head silhouette.
            # Work in world space because the frozen meshes have different origins.
            clone.shape_key_add(name='Basis')
            gather_key = clone.shape_key_add(name='Gather limbs into spirit')
            inverse = clone.matrix_world.inverted()
            for vertex, target in zip(mesh.vertices, gather_key.data):
                p = clone.matrix_world @ vertex.co
                p.x *= .66
                p.y = .58*p.y
                target.co = inverse @ p
            body_gathers.append(gather_key)
            for slot in clone.material_slots:
                original = slot.material
                if original.name not in material_map:
                    mat = original.copy()
                    mat.name = 'A01 dissolve ' + original.name
                    nodes, links = mat.node_tree.nodes, mat.node_tree.links
                    out = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
                    surface = out.inputs['Surface'].links[0].from_socket
                    white = nodes.new('ShaderNodeEmission')
                    white.inputs['Color'].default_value = (.61, .77, .78, 1)
                    white.inputs['Strength'].default_value = .9
                    ghost_mix = nodes.new('ShaderNodeMixShader')
                    links.new(surface, ghost_mix.inputs[1])
                    links.new(white.outputs[0], ghost_mix.inputs[2])
                    fade = nodes.new('ShaderNodeMixShader')
                    transparent = nodes.new('ShaderNodeBsdfTransparent')
                    links.new(transparent.outputs[0], fade.inputs[1])
                    links.new(ghost_mix.outputs[0], fade.inputs[2])
                    links.new(fade.outputs[0], out.inputs['Surface'])
                    whiten_sockets.append(ghost_mix.inputs[0])
                    opacity_sockets.append(fade.inputs[0])
                    material_map[original.name] = mat
                slot.material = material_map[original.name]
        elif ob.type in ('CAMERA', 'LIGHT'):
            clone = ob.copy()
            clone.data = ob.data.copy()
            scene.collection.objects.link(clone)
            if ob == source.camera:
                scene.camera = clone
    bpy.context.window.scene = scene
    scene.world = source.world.copy()
    # 48 x 96 world-unit canvas, body remains 38.4 world units as in runtime.
    scene.camera.location = (0, 1.375, 8)
    scene.camera.rotation_euler = (0, 0, 0)
    scene.camera.data.ortho_scale = 5.5
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 2048
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.fps = 60
    scene.frame_start, scene.frame_end = 0, 71
    scene.cycles.samples = 32
    scene.cycles.transparent_max_bounces = 64
    scene.cycles.use_denoising = True
    scene.cycles.seed = 37
    scene.render.use_persistent_data = True
    prefs = bpy.context.preferences.addons['cycles'].preferences
    cache = repo / 'art/poc/death-sequence-a01/optix-cache'
    cache.mkdir(parents=True, exist_ok=True)
    os.environ['OPTIX_CACHE_PATH'] = str(cache)
    device = 'CPU'
    for candidate in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = candidate
            prefs.refresh_devices()
            if any(d.type == candidate for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == candidate
                scene.cycles.device = 'GPU'
                device = candidate
                break
        except (RuntimeError, TypeError):
            pass

    spirit_root = bpy.data.objects.new('A01 ascending spirit', None)
    scene.collection.objects.link(spirit_root)
    spirit_opacity = []
    face_opacity = []

    def spirit_material(name, color, face=False, gradient=False):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        n, l = mat.node_tree.nodes, mat.node_tree.links
        n.clear()
        out = n.new('ShaderNodeOutputMaterial')
        emission = n.new('ShaderNodeEmission')
        emission.inputs[0].default_value = (*color, 1)
        if gradient:
            attr = n.new('ShaderNodeAttribute')
            attr.attribute_name = 'soul_radius'
            ramp = n.new('ShaderNodeValToRGB')
            ramp.color_ramp.elements[0].position = 0
            ramp.color_ramp.elements[0].color = (.91, .96, .88, 1)
            ramp.color_ramp.elements[1].position = 1
            ramp.color_ramp.elements[1].color = (.25, .45, .50, 1)
            mid = ramp.color_ramp.elements.new(.72)
            mid.color = (.69, .85, .83, 1)
            l.new(attr.outputs['Fac'], ramp.inputs[0])
            l.new(ramp.outputs[0], emission.inputs[0])
        transparent = n.new('ShaderNodeBsdfTransparent')
        mix = n.new('ShaderNodeMixShader')
        l.new(transparent.outputs[0], mix.inputs[1])
        l.new(emission.outputs[0], mix.inputs[2])
        l.new(mix.outputs[0], out.inputs[0])
        (face_opacity if face else spirit_opacity).append(mix.inputs[0])
        return mat

    soul_mat = spirit_material('A01 pearl soul, cool soft rim', (.78,.90,.86), gradient=True)
    face_mat = spirit_material('A01 crossed eyes and breath', (.009,.025,.035), face=True)
    mask_mat = spirit_material('A01 cupped inner ears', (.20,.36,.39), face=True)
    rings, segments = 22, 128
    verts, faces, radial = [(0,0,2.6)], [], [0]
    for ring in range(1, rings+1):
        r = ring/rings
        for j in range(segments):
            angle = j*math.tau/segments
            south = max(0, -math.cos(angle))
            x = .64*math.sin(angle)*(1-.66*south**2)
            y = .64*math.cos(angle)-.35*south**6
            # Broad rounded lobes, continuous with the membrane, read as badger ears.
            ear = math.exp(-((abs(angle if angle < math.pi else angle-math.tau)-.88)/.21)**2)
            x *= 1+.20*ear
            y += .25*ear
            verts.append((r*x, r*y, 2.45+.15*(1-r*r)))
            radial.append(r)
    for j in range(segments):
        faces.append((0, 1+j, 1+(j+1)%segments))
    for ring in range(rings-1):
        a, b = 1+ring*segments, 1+(ring+1)*segments
        for j in range(segments):
            k = (j+1)%segments
            faces.append((a+j,b+j,b+k,a+k))
    mesh = bpy.data.meshes.new('A01 continuous spirit membrane')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    attr = mesh.attributes.new('soul_radius', 'FLOAT', 'POINT')
    for datum, value in zip(attr.data, radial):
        datum.value = value
    soul = bpy.data.objects.new('A01 flowing badger spirit', mesh)
    scene.collection.objects.link(soul)
    soul.parent = spirit_root
    soul.data.materials.append(soul_mat)
    for poly in mesh.polygons:
        poly.use_smooth = True
    soul.shape_key_add(name='Basis')
    waves = []
    # Quadrature shapes carry a travelling S-wave down the lower membrane.
    # Signed values are essential: both left and right bends must survive export.
    for phase, name in [(0, 'Tail wave sine'), (math.pi/2, 'Tail wave cosine')]:
        wave = soul.shape_key_add(name=name)
        wave.slider_min = -1
        for i, (x,y,z) in enumerate(verts):
            tail = max(0, min(1, -y/.99))
            wave.data[i].co = (x+.42*tail**1.6*math.cos(phase-4.2*tail),
                               y+.12*tail**2*math.sin(phase-3.1*tail), z)
        waves.append(wave)

    def stroke(name, points, radius, mat):
        curve = bpy.data.curves.new(name, 'CURVE')
        curve.dimensions = '3D'
        curve.resolution_u = 12
        curve.bevel_depth = radius
        curve.bevel_resolution = 4
        spline = curve.splines.new('BEZIER')
        spline.bezier_points.add(len(points)-1)
        for p, co in zip(spline.bezier_points, points):
            p.co = (*co, 2.67)
            p.handle_left_type = p.handle_right_type = 'AUTO'
        ob = bpy.data.objects.new(name, curve)
        scene.collection.objects.link(ob)
        ob.parent = spirit_root
        ob.data.materials.append(mat)
        return ob

    def oval(name, cx, cy, rx, ry, mat):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([(cx+rx*math.cos(j*math.tau/64), cy+ry*math.sin(j*math.tau/64), 2.69)
                          for j in range(64)], [], [tuple(range(64))])
        ob = bpy.data.objects.new(name, mesh)
        scene.collection.objects.link(ob)
        ob.parent = spirit_root
        ob.data.materials.append(mat)

    for side in (-1, 1):
        x = side*.225
        stroke('A01 cross eye diagonal', [(x-.075,.185),(x+.075,.335)], .029, face_mat)
        stroke('A01 cross eye diagonal', [(x-.075,.335),(x+.075,.185)], .029, face_mat)
        oval('A01 rounded inner ear', side*.55,.585,.066,.083,mask_mat)
    # A filled opening remains legible at the intended in-game display size.
    oval('A01 open breath mouth', 0,-.055,.070,.102,face_mat)

    for frame in range(72):
        t = frame/71
        gather = ease(.025,.31,t)
        body_root.scale = (1-.18*gather, 1-.10*gather, 1)
        body_root.location = (0, .07*gather, 0)
        for shape in body_gathers:
            shape.value = gather
            shape.keyframe_insert('value', frame=frame)
        body_root.keyframe_insert('scale', frame=frame)
        body_root.keyframe_insert('location', frame=frame)
        for socket in whiten_sockets:
            key(socket, ease(.10,.29,t), frame)
        for socket in opacity_sockets:
            key(socket, 1-ease(.265,.35,t), frame)
        # Remove fully dissolved geometry from ray traversal. Stacked transparent
        # surfaces must not leave black silhouettes after the spirit has departed.
        for ob in bodies:
            ob.hide_render = t >= .35
            ob.keyframe_insert('hide_render', frame=frame)
        birth = ease(.235,.34,t)
        depart = ease(.55,1,t)
        strength = .98*birth*(1-ease(.80,1,t))
        for socket in spirit_opacity:
            key(socket, strength, frame)
        for socket in face_opacity:
            key(socket, .98*ease(.315,.40,t)*(1-ease(.80,.98,t)), frame)
        scale = (.69+.33*ease(.25,.45,t))*(1-.57*depart)
        spirit_root.scale = (scale, scale*(1+.16*ease(.45,.9,t)), 1)
        spirit_root.location = (.10*math.sin(t*12)*ease(.38,.7,t), .07+2.28*ease(.36,1,t), 0)
        spirit_root.keyframe_insert('scale', frame=frame)
        spirit_root.keyframe_insert('location', frame=frame)
        phase = (t-.36)*math.tau*3.5
        amplitude = ease(.30,.53,t)
        for wave, value in zip(waves, [math.sin(phase), math.cos(phase)]):
            wave.value = amplitude*value
            wave.keyframe_insert('value', frame=frame)

    # Fixed camera/anchor proof. Body center must be 75% down the portrait frame.
    scene.frame_set(0)
    bpy.context.view_layer.update()
    center = world_to_camera_view(scene, scene.camera, Vector((0,0,0)))
    if abs(center.x-.5)>.0001 or abs(center.y-.25)>.0001:
        raise RuntimeError(f'Unexpected anchor {tuple(center)}')
    # Proof poses first so faults are visible before the remaining export finishes.
    proof = [0,16,24,34,58,71]
    indices = proof + [i for i in range(72) if i not in proof] if args.indices == 'all' else [int(v) for v in args.indices.split(',')]
    scene['a01_preview'] = True
    scene['a01_revision'] = args.revision
    scene['a01_source'] = str(source_path.relative_to(repo))
    scene['a01_source_sha256'] = hashlib.sha256(source_path.read_bytes()).hexdigest()
    scene['a01_frame_canvas'] = [256,512]
    scene['a01_logical_canvas'] = [48,96]
    scene['a01_anchor'] = [.5,.75]
    source_text = bpy.data.texts.new('build-preview.py')
    source_text.write(Path(__file__).read_text(encoding='utf-8'))
    bpy.ops.file.pack_all()
    bpy.data.libraries.write(str(output/'death-preview.blend'), {scene,source_text}, fake_user=True)
    manifest = dict(status='approval-preview-not-imported', revision=args.revision, frameCount=72,
                    frameRate=60, duration=1.2, sourceSize=[256,512], masterSize=[1024,2048],
                    logicalSize=[48,96], anchor=[.5,.75], sourceBlend=str(source_path.relative_to(repo)),
                    sourceSHA256=scene['a01_source_sha256'], device=device, rendered=indices,
                    oldDuration=38/60, sourceBodyDisplaySize=38.4)
    (output/'preview.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    (output/'masters').mkdir()
    for index in indices:
        scene.frame_set(index)
        scene.render.filepath = str(output/'masters'/f'frame-{index:04d}.png')
        bpy.ops.render.render(write_still=True)
        print(f'A01 FRAME {index} DONE',flush=True)
    print('A01 COMPLETE '+str(output),flush=True)


if __name__ == '__main__':
    main()
