"""Run through Blender MCP: import this module by path, then build(repo, spec, revision).
No file is written outside art/poc/pipeline-v1. No existing scenes are removed.
"""
import bpy
import hashlib
import importlib.util
import json
import math
import re
from pathlib import Path
from mathutils import Vector

VERSION = 1


def contained(root, path):
    path = (root / path).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f'Path escapes workspace: {path}')
    return path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_scene(name, ortho):
    scene = bpy.data.scenes.new(name)
    bpy.context.window.scene = scene
    bpy.ops.object.camera_add(location=(0, 0, 8))
    camera = bpy.context.object
    camera.name = 'Locked orthographic camera -Z'
    camera.rotation_euler = (0, 0, 0)
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = ortho
    camera.data.lens = 50
    camera.data.dof.use_dof = False
    scene.camera = camera
    world = bpy.data.worlds.new(name + ' ambient')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.72, .76, .78, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .55
    scene.world = world
    for name, pos, power in [('Soft key', (-3, 4, 7), 250), ('Soft fill', (4, -2, 6), 90)]:
        bpy.ops.object.light_add(type='AREA', location=pos)
        lamp = bpy.context.object
        lamp.name = name
        lamp.data.energy = power
        lamp.data.shape = 'DISK'
        lamp.data.size = 5
        lamp.rotation_euler = (-lamp.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.cycles.seed = 37
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    return scene


class Authoring:
    def __init__(self, scene, images):
        self.scene, self.images = scene, images
        self.strengths = []
        self.form_strengths = []

    def material(self, name, color, family=None, emission=0, form_shading=False):
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*color, 1)
        m.use_nodes = True
        n, l = m.node_tree.nodes, m.node_tree.links
        bs = n.get('Principled BSDF')
        bs.inputs['Base Color'].default_value = (*color, 1)
        bs.inputs['Roughness'].default_value = .92
        bs.inputs['Specular IOR Level'].default_value = .08
        if family:
            tex = n.new('ShaderNodeTexImage')
            tex.image = self.images[family]
            tex.extension = 'EXTEND'
            tex.interpolation = 'Linear'
            uv = n.new('ShaderNodeTexCoord')
            l.new(uv.outputs['Generated'], tex.inputs['Vector'])
            grey = n.new('ShaderNodeRGBToBW')
            l.new(tex.outputs['Color'], grey.inputs[0])
            ramp = n.new('ShaderNodeMapRange')
            ramp.inputs['From Min'].default_value = .10
            ramp.inputs['From Max'].default_value = .65
            ramp.inputs['To Min'].default_value = .48
            ramp.inputs['To Max'].default_value = 1.12
            ramp.clamp = True
            l.new(grey.outputs[0], ramp.inputs['Value'])
            mix = n.new('ShaderNodeMixRGB')
            mix.name = 'Surface detail strength'
            mix.blend_type = 'MULTIPLY'
            mix.inputs[1].default_value = (*color, 1)
            l.new(ramp.outputs[0], mix.inputs[2])
            l.new(mix.outputs[0], bs.inputs['Base Color'])
            self.strengths.append(mix.inputs[0])
            if family == 'organic':
                # Large grouped value variation survives the small silhouette;
                # generated microtexture is a separate, adjustable contribution.
                noise = n.new('ShaderNodeTexNoise')
                noise.inputs['Scale'].default_value = 4.2
                noise.inputs['Detail'].default_value = 1.0
                l.new(uv.outputs['Generated'], noise.inputs['Vector'])
                tones = n.new('ShaderNodeMapRange')
                tones.inputs['To Min'].default_value = .55
                tones.inputs['To Max'].default_value = 1.22
                l.new(noise.outputs['Fac'], tones.inputs['Value'])
                grouped = n.new('ShaderNodeMixRGB')
                grouped.blend_type = 'MULTIPLY'
                grouped.inputs[0].default_value = .7
                l.new(mix.outputs[0], grouped.inputs[1])
                l.new(tones.outputs[0], grouped.inputs[2])
                l.new(grouped.outputs[0], bs.inputs['Base Color'])
        bs.inputs['Emission Color'].default_value = (*color, 1)
        bs.inputs['Emission Strength'].default_value = emission
        if form_shading:
            original = bs.inputs['Base Color'].links[0].from_socket
            geometry = n.new('ShaderNodeNewGeometry')
            facing = n.new('ShaderNodeVectorMath'); facing.operation = 'DOT_PRODUCT'
            l.new(geometry.outputs['Normal'], facing.inputs[0])
            facing.inputs[1].default_value = (0, 0, 1)
            paint = n.new('ShaderNodeVertexColor'); paint.layer_name = 'FD_FormMask'
            multiply = n.new('ShaderNodeMath'); multiply.operation = 'MULTIPLY'
            l.new(facing.outputs['Value'], multiply.inputs[0]); l.new(paint.outputs['Color'], multiply.inputs[1])
            ramp = n.new('ShaderNodeValToRGB'); ramp.name = 'Broad muscle values'
            ramp.color_ramp.interpolation = 'EASE'
            ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
            def linear(v):
                v /= 255
                return v / 12.92 if v <= .04045 else ((v + .055) / 1.055)**2.4
            for i, (pos, rgb) in enumerate([(.08, (13, 20, 30)), (.45, (36, 49, 64)), (.73, (82, 99, 114)), (.98, (161, 174, 184))]):
                e = ramp.color_ramp.elements[0] if i == 0 else ramp.color_ramp.elements.new(pos)
                e.position, e.color = pos, (*[linear(v) for v in rgb], 1)
            l.new(multiply.outputs[0], ramp.inputs[0])
            # Preserve the same restrained texture contribution in both comparisons.
            grey = n.new('ShaderNodeRGBToBW'); l.new(original, grey.inputs[0])
            ratio = n.new('ShaderNodeMath'); ratio.operation = 'DIVIDE'
            l.new(grey.outputs[0], ratio.inputs[0])
            ratio.inputs[1].default_value = sum(a*b for a,b in zip(color, (.2126,.7152,.0722)))
            textured = n.new('ShaderNodeMixRGB'); textured.blend_type = 'MULTIPLY'; textured.inputs[0].default_value = 1
            l.new(ramp.outputs['Color'], textured.inputs[1]); l.new(ratio.outputs[0], textured.inputs[2])
            blend = n.new('ShaderNodeMixRGB'); blend.name = 'Form shadow strength'
            l.new(original, blend.inputs[1]); l.new(textured.outputs[0], blend.inputs[2])
            l.new(blend.outputs[0], bs.inputs['Base Color'])
            self.form_strengths.append(blend.inputs[0])
        return m

    def paint_form_mask(self, ob, sampler):
        """Persist an authored broad value mask on the mesh, independent of texture noise."""
        bpy.context.view_layer.update()
        attr = ob.data.color_attributes.new(name='FD_FormMask', type='FLOAT_COLOR', domain='POINT')
        for v, value in zip(ob.data.vertices, attr.data):
            weight = max(0, min(1, sampler(ob.matrix_world @ v.co)))
            value.color = (weight, weight, weight, 1)

    def ell(self, name, loc, scale, material):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, location=loc)
        ob = bpy.context.object
        ob.name, ob.scale = name, scale
        ob.data.materials.append(material)
        for face in ob.data.polygons:
            face.use_smooth = True
        return ob

    def box(self, name, loc, size, material, bevel=.03):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        ob = bpy.context.object
        ob.name, ob.dimensions = name, size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        ob.data.materials.append(material)
        mod = ob.modifiers.new('Soft machined edge', 'BEVEL')
        mod.width, mod.segments = bevel, 3
        ob.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
        return ob

    def cylinder(self, name, loc, radius, depth, material, vertices=32):
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
        ob = bpy.context.object
        ob.name = name
        ob.data.materials.append(material)
        mod = ob.modifiers.new('Machined edge', 'BEVEL')
        mod.width, mod.segments = .025, 2
        ob.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
        return ob

    def union(self, name, objects):
        bpy.ops.object.select_all(action='DESELECT')
        for ob in objects:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        ob = bpy.context.object
        ob.name = name
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        mod = ob.modifiers.new('Organic continuity', 'REMESH')
        mod.mode, mod.voxel_size, mod.use_smooth_shade = 'VOXEL', .015, True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = ob.modifiers.new('Smooth transitions', 'SMOOTH')
        mod.factor, mod.iterations = .8, 4
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for face in ob.data.polygons:
            face.use_smooth = True
        return ob


def validate_scene(scene, pivot):
    camera = scene.camera
    if camera.data.type != 'ORTHO' or any(abs(a) > 1e-7 for a in camera.rotation_euler):
        raise ValueError('Camera must be orthographic with zero rotation / exact -Z view')
    if not scene.render.film_transparent or scene.render.image_settings.color_mode != 'RGBA':
        raise ValueError('Transparent RGBA required')
    bpy.context.view_layer.update()
    points = [ob.matrix_world @ Vector(corner) for ob in scene.objects
              if ob.type == 'MESH' and not ob.hide_render for corner in ob.bound_box]
    if not points:
        raise ValueError('Asset has no visible mesh')
    # Explicit pivot -> camera placement, no automatic crop or recentring.
    span = camera.data.ortho_scale
    camera.location.x = (.5 - pivot[0]) * span
    camera.location.y = (pivot[1] - .5) * span
    bounds = [min(v.x for v in points), min(v.y for v in points), max(v.x for v in points), max(v.y for v in points)]
    if any((v.x - camera.location.x) / span < -.48 or (v.x - camera.location.x) / span > .48
           or (v.y - camera.location.y) / span < -.48 or (v.y - camera.location.y) / span > .48 for v in points):
        raise ValueError(f'Asset clips required 2% border: {bounds}; increase orthoScale explicitly')
    return bounds


def build(repo, spec_file, revision):
    root = Path(repo).resolve()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', revision):
        raise ValueError('Use a new lowercase revision identifier')
    spec_path = contained(root, spec_file)
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    variant_settings = {}
    for variant, texture_strength, label in [('calm', .22, 'Ruhig / illustrativ'), ('rich', .78, 'Detailreich')]:
        settings = dict(label=label, textureStrength=texture_strength, formShadowStrength=0)
        settings.update(spec.get('materialVariants', {}).get(variant, {}))
        if not isinstance(settings['label'], str) or not settings['label'].strip():
            raise ValueError('Variant label must be nonempty')
        for key in ('textureStrength', 'formShadowStrength'):
            if not isinstance(settings[key], (int, float)) or not math.isfinite(settings[key]) or not 0 <= settings[key] <= 1:
                raise ValueError(f'Invalid material parameter: {key}')
        variant_settings[variant] = settings
    if not all(re.fullmatch(r'[a-z0-9][a-z0-9-]*', spec[key]) for key in ('id', 'recipe')):
        raise ValueError('Invalid asset or recipe ID')
    if spec['forward'] not in ('north', 'east') or spec['category'] not in ('character', 'enemy', 'turret'):
        raise ValueError('Unsupported orientation or category')
    if len(spec['pivot']) != 2 or any(not 0 <= x <= 1 for x in spec['pivot']):
        raise ValueError('Pivot must be two normalized coordinates')
    out = contained(root, f'art/poc/pipeline-v1/runs/{revision}/{spec["id"]}')
    if out.exists():
        raise FileExistsError(f'Revision already exists; choose a fresh revision: {out}')
    images, provenance = {}, {}
    for family, rel in spec['textures'].items():
        path = contained(root, rel)
        if not path.is_file():
            raise FileNotFoundError(f'Generate/copy the {family} texture first: {path}')
        images[family] = bpy.data.images.load(str(path), check_existing=False)
        images[family].colorspace_settings.name = 'sRGB'
        images[family].pack()
        provenance[family] = {'path': rel, 'sha256': digest(path)}
    recipe_path = contained(root, f'scripts/asset-pipeline/recipes/{spec["recipe"]}.py')
    module_spec = importlib.util.spec_from_file_location('asset_recipe', recipe_path)
    recipe = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(recipe)
    scene = make_scene(f'FD {spec["id"]} {revision}', spec['orthoScale'])
    ctx = Authoring(scene, images)
    recipe.build(ctx)
    scene['forward'] = spec['forward']
    bounds = validate_scene(scene, spec['pivot'])
    out.mkdir(parents=True)
    scene['asset_manifest'] = json.dumps(spec)
    scene['pivot'] = spec['pivot']
    scene['pipelineVersion'] = VERSION
    script_paths = [Path(__file__), recipe_path]
    texts = set()
    for path in script_paths:
        text = bpy.data.texts.new(path.name)
        text.write(path.read_text(encoding='utf-8'))
        texts.add(text)
    # Same model, camera and lamps; texture and authored form contrast are independent.
    for variant, settings in variant_settings.items():
        for socket in ctx.strengths:
            socket.default_value = settings['textureStrength']
        for socket in ctx.form_strengths:
            socket.default_value = settings['formShadowStrength']
        folder = out / variant
        folder.mkdir()
        scene.render.filepath = str(folder / 'master.png')
        bpy.ops.render.render(write_still=True)
        bpy.data.libraries.write(str(folder / 'asset.blend'), {scene, *texts}, fake_user=True)
        manifest = dict(spec, pipelineVersion=VERSION, revision=revision, variant=variant,
                        variantLabel=settings['label'], materialParameters=settings,
                        blenderVersion=bpy.app.version_string, masterSize=1024, textures=provenance,
                        camera={'type': 'ORTHO', 'rotation': list(scene.camera.rotation_euler), 'bounds': bounds,
                                'location': list(scene.camera.location), 'orthoScale': scene.camera.data.ortho_scale,
                                'transparent': scene.render.film_transparent},
                        sources={path.name: digest(path) for path in script_paths})
        (folder / 'render.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return {'output': str(out), 'variants': ['calm', 'rich']}


def create_template(repo, name='template-v1.blend'):
    root = Path(repo).resolve()
    out = contained(root / 'art/poc/pipeline-v1', name)
    if out.exists():
        raise FileExistsError(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    scene = make_scene('FD asset template', 3.15)
    # Empty collection for new models, explicit pivot and stable export defaults.
    collection = bpy.data.collections.new('Asset geometry')
    scene.collection.children.link(collection)
    scene['pipelineVersion'] = VERSION
    scene['pivot'] = [.5, .5]
    bpy.data.libraries.write(str(out), {scene}, fake_user=True)
    return str(out)
