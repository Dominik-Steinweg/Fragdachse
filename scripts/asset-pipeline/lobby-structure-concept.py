"""Concept review renders for lobby structures: strict top view at source size plus one oblique view.

Usage: blender --background --factory-startup --python lobby-structure-concept.py -- job.json
job = {spec, modelHash, model, output, settings: {samples, device, denoise}, topSize, oblique: [w, h]}
The oblique camera is a diagnostic exception, exactly like the shape mode's side view.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util
import json


def load(name, file):
    definition = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(definition)
    definition.loader.exec_module(module)
    return module


shape = load('shape_helpers', 'shape-v2.py')
draft = shape.draft
bpy = draft.bpy


def render(job):
    from mathutils import Vector
    scene, asset, _ = draft.model(job)
    shape.configure(scene, job['settings'])
    out = Path(job['output']); out.mkdir(parents=True, exist_ok=True)
    scene.render.resolution_x = scene.render.resolution_y = job['topSize']
    scene.render.filepath = str(out / 'top.png')
    bpy.ops.render.render(write_still=True, scene=scene.name)
    warnings = set()
    sockets = draft.sockets(scene, asset, warnings, 'rest')
    camera = scene.camera
    camera.data.type = 'PERSP'
    camera.data.lens = 38
    # Frame the evaluated bounds from the south-east, whatever the asset's height.
    deps = bpy.context.evaluated_depsgraph_get()
    points = [o.evaluated_get(deps).matrix_world @ Vector(c) for o in scene.objects
              if o.type == 'MESH' and not o.hide_render for c in o.evaluated_get(deps).bound_box]
    lo = Vector([min(p[i] for p in points) for i in range(3)]); hi = Vector([max(p[i] for p in points) for i in range(3)])
    target = (lo + hi) / 2
    radius = (hi - lo).length / 2
    camera.location = target + Vector((5.6, -8.4, 7.4)).normalized() * radius * 3.1
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.resolution_x, scene.render.resolution_y = job['oblique']
    scene.render.filepath = str(out / 'oblique.png')
    bpy.ops.render.render(write_still=True, scene=scene.name)
    draft.save(out / 'concept.json', dict(sockets=sockets, warnings=sorted(warnings),
               objects=sum(1 for o in scene.objects if o.type == 'MESH')))


if __name__ == '__main__':
    render(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf8')))
