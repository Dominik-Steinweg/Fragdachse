"""Concept renders of the rustic base styles: day, night, oblique and the neutral kit top view.

Usage: blender --background --factory-startup --python base-structure-concept.py -- job.json
job = {spec, modelHash, model, output, settings: {samples, device, denoise}, pxPerMetre, aspect, views}

Concept views add a sun or moon, lamp lights at the recipe's sockets and the concept-only ground;
they judge mood and are never runtime passes. The `top` view keeps the pipeline's soft rig, moved
far away (bridge_parts.distant_lights) so every cell sees the same light direction, and hides the
concept ground: kit frames and whole shapes are rendered under identical light.
The oblique camera is a diagnostic exception, like the shape mode's side view.
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

# Colour, watts and height lift: fire light sits above the basket so the coals keep their colour.
LIGHTS = {'lamp': ((1.0, .70, .40), 22, 0), 'window': ((1.0, .66, .38), 16, 0), 'fire': ((1.0, .52, .22), 40, .35)}


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
    scene.view_settings.view_transform = 'AgX'
    rig = [ob for ob in scene.objects if ob.type == 'LIGHT']
    concept = [ob for ob in scene.objects if ob.get('fdConceptOnly')]
    sockets = {name: ob.matrix_world.translation.copy() for name, ob in asset['sockets'].items()}
    views = job['views']

    def show(objects, visible):
        for ob in objects: ob.hide_render = not visible

    def shoot(name):
        scene.render.filepath = str(out / f'{name}.png')
        bpy.ops.render.render(write_still=True, scene=scene.name)

    if 'top' in views:
        from bridge_parts import distant_lights
        show(concept, False)
        distant_lights(scene, factor=10)
        scene.render.film_transparent = True
        shoot('top')
    show(rig, False)
    show(concept, True)
    scene.render.film_transparent = False
    day_sun = sun(scene, 'Concept afternoon sun', (-.3, .35, -.89), 3.4, (1.0, .94, .84), 2.5)
    if 'day' in views:
        world(scene, (.56, .66, .80), .75)
        shoot('day')
    if 'oblique' in views:
        camera = scene.camera
        ortho, location, rotation = camera.data.type, camera.location.copy(), camera.rotation_euler.copy()
        camera.data.type = 'PERSP'; camera.data.lens = 38
        deps = bpy.context.evaluated_depsgraph_get()
        points = [o.evaluated_get(deps).matrix_world @ Vector(c) for o in scene.objects
                  if o.type == 'MESH' and not o.hide_render and not o.get('fdConceptOnly') for c in o.evaluated_get(deps).bound_box]
        lo = Vector([min(p[i] for p in points) for i in range(3)]); hi = Vector([max(p[i] for p in points) for i in range(3)])
        target = (lo + hi) / 2
        radius = (hi - lo).length / 2
        camera.location = target + Vector((5.6, -8.4, 7.4)).normalized() * radius * 2.3
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        keep = scene.render.resolution_x, scene.render.resolution_y
        scene.render.resolution_x, scene.render.resolution_y = 1100, 760
        world(scene, (.56, .66, .80), .75)
        shoot('oblique')
        scene.render.resolution_x, scene.render.resolution_y = keep
        camera.data.type, camera.location, camera.rotation_euler = ortho, location, rotation
    if 'night' in views:
        day_sun.hide_render = True
        sun(scene, 'Concept moon', (.35, -.45, -.82), .05, (.62, .72, 1.0), 1.0)
        world(scene, (.03, .04, .08), .6)
        emission_scale(1.5)
        for name, position in sockets.items():
            kind = name.split('_')[0]
            if kind not in LIGHTS: continue
            color, energy, lift = LIGHTS[kind]
            data = bpy.data.lights.new('Concept ' + name, 'POINT')
            data.energy, data.color, data.shadow_soft_size = energy, color, .12
            ob = bpy.data.objects.new('Concept ' + name, data)
            ob.location = position + Vector((0, 0, lift))
            scene.collection.objects.link(ob)
        shoot('night')
    draft.save(out / 'concept.json', dict(sockets={k: list(v) for k, v in sockets.items()},
               objects=sum(1 for o in scene.objects if o.type == 'MESH')))


if __name__ == '__main__':
    render(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf8')))
