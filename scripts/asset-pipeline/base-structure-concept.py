"""Concept renders of the rustic base styles, made to be composed onto real game ground captures.

Usage: blender --background --factory-startup --python base-structure-concept.py -- job.json
job = {spec, modelHash, model, output, settings: {samples, device, denoise}, pxPerMetre, aspect, views}

Views (all orthographic top views at the job's canvas unless noted):
- day: sun and sky, transparent film, a shadow catcher under everything, so structures, courtyard
  ground and cast shadows lay straight onto a game capture.
- mask: coverage of structures and courtyard ground only (1 sample).
- lamp: lamp and fire lights only, world black, structures visible over a white diffuse ground; the
  board multiplies the day capture by it, as the game's light map does at night. 16-bit, Standard.
- oblique: day light from the south-east in perspective, a diagnostic exception like the shape
  mode's side view.
- top: the pipeline's soft rig moved far away (bridge_parts.distant_lights) and no concept ground,
  so kit frames and whole shapes are rendered under identical light.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util
import json
import math


def load(name, file):
    definition = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(definition)
    definition.loader.exec_module(module)
    return module


shape = load('shape_helpers', 'shape-v2.py')
draft = shape.draft
bpy = draft.bpy

# Colour, watts and height lift (fire light sits above the basket so the coals keep their colour).
LIGHTS = {'lamp': ((1.0, .70, .40), 12, 0), 'fire': ((1.0, .55, .25), 16, .25), 'torch': ((1.0, .56, .26), 5, .05), 'torchlet': ((1.0, .58, .28), 3, .04)}
# Game sun at noon: shadows fall towards the screen bottom (-Y), slightly left.
SUN = (-.12, -.40, -.91)


def sun(scene, name, direction, energy, color, angle):
    from mathutils import Vector
    data = bpy.data.lights.new(name, 'SUN')
    data.energy, data.color, data.angle = energy, color, math.radians(angle)
    ob = bpy.data.objects.new(name, data)
    scene.collection.objects.link(ob)
    ob.rotation_euler = Vector(direction).normalized().to_track_quat('-Z', 'Y').to_euler()
    return ob


def world(scene, color, strength):
    nodes = scene.world.node_tree.nodes
    nodes['Background'].inputs[0].default_value = (*color, 1)
    nodes['Background'].inputs[1].default_value = strength


def plane(scene, name, size, z, color=None):
    half = size / 2
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(-half, -half, z), (half, -half, z), (half, half, z), (-half, half, z)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(ob)
    if color:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = 1
        mesh.materials.append(mat)
    return ob


def emission_scale(factor):
    for mat in bpy.data.materials:
        if not mat.name.startswith('Separate') or not mat.node_tree: continue
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                node.inputs['Emission Strength'].default_value *= factor


def render(job):
    from mathutils import Vector
    scene, asset, _ = draft.model(job)
    shape.configure(scene, job['settings'])
    out = Path(job['output']); out.mkdir(parents=True, exist_ok=True)
    spec = job['spec']
    width = round(spec['orthoScale'] * job['pxPerMetre'])
    scene.render.resolution_x, scene.render.resolution_y = width, round(width * job.get('aspect', 1))
    scene.view_settings.view_transform = 'Standard'
    scene.render.film_transparent = True
    rig = [ob for ob in scene.objects if ob.type == 'LIGHT']
    concept = [ob for ob in scene.objects if ob.get('fdConceptOnly')]
    sockets = {name: ob.matrix_world.translation.copy() for name, ob in asset['sockets'].items()}
    views = job['views']
    samples = scene.cycles.samples
    span = spec['orthoScale'] * 2.5

    def show(objects, visible):
        for ob in objects: ob.hide_render = not visible

    def shoot(name, depth='8'):
        scene.render.image_settings.color_depth = depth
        scene.render.filepath = str(out / f'{name}.png')
        bpy.ops.render.render(write_still=True, scene=scene.name)

    if 'top' in views:
        from bridge_parts import distant_lights
        show(concept, False)
        distant_lights(scene, factor=10)
        shoot('top')
    show(rig, False)
    show(concept, True)
    catcher = plane(scene, 'Concept shadow catcher', span, -.002)
    catcher.is_shadow_catcher = True
    day_sun = sun(scene, 'Concept noon sun', SUN, 3.2, (1.0, .96, .9), 2.0)
    world(scene, (.6, .68, .8), .6)
    if 'day' in views:
        shoot('day')
    if 'mask' in views:
        catcher.hide_render = True
        scene.cycles.samples, scene.cycles.use_denoising = 1, False
        shoot('mask')
        scene.cycles.samples, scene.cycles.use_denoising = samples, job['settings']['denoise']
        catcher.hide_render = False
    if 'oblique' in views:
        catcher.hide_render = True
        floor = plane(scene, 'Concept oblique floor', span, -.004, (.05, .07, .035))
        camera = scene.camera
        camera.data.type = 'PERSP'; camera.data.lens = 38
        deps = bpy.context.evaluated_depsgraph_get()
        points = [o.evaluated_get(deps).matrix_world @ Vector(c) for o in scene.objects
                  if o.type == 'MESH' and not o.hide_render and not o.get('fdConceptOnly') and o is not floor
                  for c in o.evaluated_get(deps).bound_box]
        lo = Vector([min(p[i] for p in points) for i in range(3)]); hi = Vector([max(p[i] for p in points) for i in range(3)])
        target = (lo + hi) / 2
        camera.location = target + Vector((5.6, -8.4, 7.4)).normalized() * (hi - lo).length / 2 * 2.3
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.resolution_x, scene.render.resolution_y = 1100, 760
        scene.render.film_transparent = False
        shoot('oblique')
        scene.render.film_transparent = True
        floor.hide_render = True
    if 'lamp' in views:
        catcher.hide_render = True
        day_sun.hide_render = True
        world(scene, (0, 0, 0), 0)
        white = plane(scene, 'Concept light catcher', span, -.003, (.8, .8, .8))
        emission_scale(1.5)
        for name, position in sockets.items():
            kind = name.split('_')[0]
            if kind not in LIGHTS: continue
            color, energy, lift = LIGHTS[kind]
            data = bpy.data.lights.new('Concept ' + name, 'POINT')
            data.energy, data.color, data.shadow_soft_size = energy, color, .1
            ob = bpy.data.objects.new('Concept ' + name, data)
            ob.location = position + Vector((0, 0, lift))
            scene.collection.objects.link(ob)
        width = round(spec['orthoScale'] * job['pxPerMetre'])
        scene.render.resolution_x, scene.render.resolution_y = width, round(width * job.get('aspect', 1))
        scene.camera.data.type = 'ORTHO'
        scene.camera.location, scene.camera.rotation_euler = (0, 0, 8), (0, 0, 0)
        scene.render.film_transparent = False
        shoot('lamp', '16')
        white.hide_render = True
    draft.save(out / 'concept.json', dict(sockets={k: list(v) for k, v in sockets.items()},
               objects=sum(1 for o in scene.objects if o.type == 'MESH')))


if __name__ == '__main__':
    render(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf8')))
