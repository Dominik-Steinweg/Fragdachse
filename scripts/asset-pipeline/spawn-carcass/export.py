"""Render the v6 carcass into game layers (straight top-down, fixed sun, one frame per opening and state).

spawn-structure/intact-<outlet>.png + -emit.png : bones, dark eye embers as emission (the game lights the
eyes; destruction is a bone burst at runtime, so there are no damaged or rubble frames)
spawn-brood-pit/<state>-<outlet>.png + -emit.png : pool, growth, eggs, strands on a transparent ground
(sealed / active); bones cast their shadow into it but are not drawn.
"""
import bpy, bmesh, json, math, os, random
from mathutils import Vector

LIVE = globals()['LIVE']        # injected by bl.py
ROOT = globals()['ROOT']
OUT = f"{ROOT}/art/poc/spawn-structure/blender/{globals().get('LABEL', 'v6')}"
QUICK = globals().get('QUICK', False)
scene = bpy.data.scenes['SpawnCarcassV6']
bpy.context.window.scene = scene
rng = random.Random('carcass-export-v6')
OUTLETS = ['north', 'east', 'south', 'west']
TURNS = {'south': 0, 'west': 1, 'north': 2, 'east': 3}       # quarter turns clockwise on screen
BUILDING_CELLS, PIT_CELLS, PX_PER_CELL = 9, 11, 64
SKELETON = ['v6_spine', 'v6_ribs', 'v6_pelvis', 'v6_legs', 'v6_skull', 'v6_embers', 'v6_socket_floor', 'v6_jaw_teeth_horns']
GROUND = ['atmos6_floor', 'atmos6_growth', 'atmos6_strands', 'atmos6_eggs', 'atmos6_eggs_scatter', 'atmos6_shells', 'atmos6_shards', 'atmos6_stones']

objs = scene.objects
pivot = objs.get('export_pivot') or bpy.data.objects.new('export_pivot', None)
if pivot.name not in scene.collection.objects: scene.collection.objects.link(pivot)
for obj in list(objs):
    if obj.parent is None and obj is not pivot and obj.type != 'CAMERA' and obj.name not in ('v6_sun', 'v6_ground'):
        obj.parent = pivot
for obj in objs:
    if obj.name.startswith('atmos6_litter'): obj.hide_render = True
objs['v6_ground'].hide_render = True

# Ground stays only where the stain is: everything else is transparent and shows the map's own floor.
floor_tree = bpy.data.materials['atmos6_floor'].node_tree
fn, fl = floor_tree.nodes, floor_tree.links
if 'export_cut' not in fn:
    out = next(n for n in fn if n.type == 'OUTPUT_MATERIAL')
    shader = out.inputs['Surface'].links[0].from_socket
    decal = next(n for n in fn if n.type == 'TEX_IMAGE' and n.image and n.image.name.startswith('active'))
    cut = fn.new('ShaderNodeMixShader'); cut.name = 'export_cut'
    clear = fn.new('ShaderNodeBsdfTransparent')
    fade = fn.new('ShaderNodeMath'); fade.operation = 'POWER'; fade.inputs[1].default_value = 0.8; fade.use_clamp = True
    fl.new(decal.outputs['Alpha'], fade.inputs[0]); fl.new(fade.outputs['Value'], cut.inputs['Fac'])
    fl.new(clear.outputs['BSDF'], cut.inputs[1]); fl.new(shader, cut.inputs[2]); fl.new(cut.outputs['Shader'], out.inputs['Surface'])

# Fray the edge: noise eats into the stain's outer ring, which stays semi-transparent.

nodes, links = fn, fl
cut = nodes['export_cut']
decal_alpha = next(n for n in nodes if n.type == 'TEX_IMAGE' and n.image and n.image.name.startswith('active')).outputs['Alpha']
for name in ('edge_noise', 'edge_map', 'edge_mul', 'edge_ramp'):
    if name in nodes: nodes.remove(nodes[name])
coord = next(n for n in nodes if n.type == 'TEX_COORD')
noise = nodes.new('ShaderNodeTexNoise'); noise.name = 'edge_noise'
noise.inputs['Scale'].default_value = 1.4; noise.inputs['Detail'].default_value = 8; noise.inputs['Roughness'].default_value = 0.65
links.new(coord.outputs['Object'], noise.inputs['Vector'])
nmap = nodes.new('ShaderNodeMapRange'); nmap.name = 'edge_map'
nmap.inputs['To Min'].default_value = 0.55; nmap.inputs['To Max'].default_value = 1.35
links.new(noise.outputs['Fac'], nmap.inputs['Value'])
mul = nodes.new('ShaderNodeMath'); mul.name = 'edge_mul'; mul.operation = 'MULTIPLY'; mul.use_clamp = True
links.new(decal_alpha, mul.inputs[0]); links.new(nmap.outputs['Result'], mul.inputs[1])
# Outer ring at most ~70 % opaque, the pool itself solid.
ramp = nodes.new('ShaderNodeValToRGB'); ramp.name = 'edge_ramp'
ramp.color_ramp.elements[0].position = 0.12; ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
ramp.color_ramp.elements[1].position = 0.95; ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
mid = ramp.color_ramp.elements.new(0.55); mid.color = (0.7, 0.7, 0.7, 1)
# The organic stain (ground.py) replaces the painted disc as the cut-out, when present.
organic = nodes.get('org_frayed')
links.new((organic.outputs['Value'] if organic else mul.outputs['Value']), ramp.inputs['Fac'])
links.new(ramp.outputs['Color'], cut.inputs['Fac'])

cam_data = bpy.data.cameras.get('export_top') or bpy.data.cameras.new('export_top')
cam_data.type = 'ORTHO'
cam = objs.get('export_top') or bpy.data.objects.new('export_top', cam_data)
if cam.name not in scene.collection.objects: scene.collection.objects.link(cam)
cam.location = (0, 0, 10); cam.rotation_euler = (0, 0, 0)
scene.camera = cam
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'

sun = objs['v6_sun']; nest_light = objs['atmos6_nest_light']; world_bg = scene.world.node_tree.nodes['Background']
LIGHTS = (sun.data.energy, nest_light.data.energy, world_bg.inputs['Strength'].default_value)


def lighting(on):
    sun.data.energy, nest_light.data.energy, world_bg.inputs['Strength'].default_value = LIGHTS if on else (0, 0, 0)


def islands(mesh):
    """Connected face groups of a mesh (index lists)."""
    bm = bmesh.new(); bm.from_mesh(mesh); bm.faces.ensure_lookup_table()
    seen, groups = set(), []
    for f in bm.faces:
        if f.index in seen: continue
        stack, group = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop(); group.append(g.index)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen: seen.add(h.index); stack.append(h)
        groups.append(group)
    bm.free()
    return groups


ribs = objs['v6_ribs']
dg = bpy.context.evaluated_depsgraph_get()
rib_baked = bpy.data.meshes.new_from_object(ribs.evaluated_get(dg), depsgraph=dg)
rib_groups = islands(rib_baked)


def rib_variant(name, keep_share):
    mesh = rib_baked.copy(); mesh.name = name
    bm = bmesh.new(); bm.from_mesh(mesh); bm.faces.ensure_lookup_table()
    drop = set()
    r = random.Random(name)
    for group in rib_groups:
        if len(group) > 40 and r.random() > keep_share: drop.update(group)
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in drop], context='FACES')
    bm.to_mesh(mesh); bm.free()
    obj = objs.get(name) or bpy.data.objects.new(name, mesh)
    obj.data = mesh
    if obj.name not in scene.collection.objects: scene.collection.objects.link(obj)
    obj.parent = ribs.parent; obj.matrix_world = ribs.matrix_world
    return obj


rib_damaged = rib_variant('export_ribs_damaged', 0.62)
rib_rubble = rib_variant('export_ribs_rubble', 0.3)
skeleton_root = objs['v6_root']


def show(names, camera=True, shadow=True):
    for n in names:
        o = objs[n]; o.hide_render = False; o.visible_camera = camera; o.visible_shadow = shadow


def hide(names):
    for n in names: objs[n].hide_render = True


def building_state(state):
    show(SKELETON)
    for o in (rib_damaged, rib_rubble): o.hide_render = True
    skeleton_root.scale = (1, 1, 1)
    if state != 'intact':
        objs['v6_ribs'].hide_render = True
        (rib_damaged if state == 'damaged' else rib_rubble).hide_render = False
    if state == 'rubble':
        skeleton_root.scale = (1, 1, 0.32)      # collapsed
        objs['v6_embers'].hide_render = True


def pit_state(state):
    eggs = ['atmos6_eggs', 'atmos6_eggs_scatter']
    egg_mat = bpy.data.materials['atmos6_egg'].node_tree.nodes['Principled BSDF']
    slime_mat = bpy.data.materials['atmos6_slime'].node_tree.nodes['Principled BSDF']
    egg_mat.inputs['Emission Strength'].default_value = 0.0
    for n in eggs + ['atmos6_growth', 'atmos6_strands']: objs[n].hide_render = False
    em_egg = next(n for n in bpy.data.materials['atmos6_egg'].node_tree.nodes if n.type == 'MAP_RANGE')
    em_slime = next(n for n in bpy.data.materials['atmos6_slime'].node_tree.nodes if n.type == 'MAP_RANGE')
    em_egg.inputs['To Min'].default_value, em_slime.inputs['To Min'].default_value = 0.3, 0.2
    slime_mat.inputs['Base Color'].default_value = (0.025, 0.01, 0.035, 1); slime_mat.inputs['Roughness'].default_value = 0.18
    if state == 'sealed':
        em_egg.inputs['To Min'].default_value, em_slime.inputs['To Min'].default_value = 0.05, 0.03
        slime_mat.inputs['Roughness'].default_value = 0.6
    if state == 'dry':
        for n in eggs + ['atmos6_strands']: objs[n].hide_render = True
        em_egg.inputs['To Min'].default_value, em_slime.inputs['To Min'].default_value = 0.0, 0.0
        slime_mat.inputs['Base Color'].default_value = (0.06, 0.05, 0.05, 1); slime_mat.inputs['Roughness'].default_value = 0.9


def render(path, cells, samples):
    cam_data.ortho_scale = cells
    scene.render.resolution_x = scene.render.resolution_y = cells * PX_PER_CELL
    scene.cycles.samples = samples
    scene.cycles.use_denoising = samples > 16
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=scene.name)


os.makedirs(f'{OUT}/spawn-structure', exist_ok=True); os.makedirs(f'{OUT}/spawn-brood-pit', exist_ok=True)
done = []
outlets = ['south'] if QUICK else OUTLETS
for outlet in outlets:
    pivot.rotation_euler = (0, 0, -TURNS[outlet] * math.pi / 2)
    # Bones.
    hide(GROUND)
    for state in ['intact']:          # destruction is a bone burst at runtime, no rubble frames
        building_state(state)
        lighting(True); render(f'{OUT}/spawn-structure/{state}-{outlet}.png', BUILDING_CELLS, 48)
        lighting(False); render(f'{OUT}/spawn-structure/{state}-{outlet}-emit.png', BUILDING_CELLS, 8)
        done.append(f'building {state} {outlet}')
    # Ground: the bones only cast their shadows into it.
    building_state('intact')
    show(SKELETON, camera=False, shadow=True)
    show([n for n in GROUND if n in objs])
    for state in (['active'] if QUICK else ['sealed', 'active']):
        pit_state(state)
        lighting(True); render(f'{OUT}/spawn-brood-pit/{state}-{outlet}.png', PIT_CELLS, 48)
        lighting(False); render(f'{OUT}/spawn-brood-pit/{state}-{outlet}-emit.png', PIT_CELLS, 8)
        done.append(f'pit {state} {outlet}')
lighting(True); pit_state('active'); building_state('intact'); show(SKELETON); show([n for n in GROUND if n in objs])
pivot.rotation_euler = (0, 0, 0)
# Eye sockets in the south frame, normalized to the building canvas: the runtime lights them on the GPU.
emb = objs['v6_embers']
dg = bpy.context.evaluated_depsgraph_get()
points = [emb.matrix_world @ v.co for v in emb.evaluated_get(dg).data.vertices]
centre = sum(points, Vector()) / len(points)
far = max(points, key=lambda p: (p - centre).length)
eyes = [[p for p in points if ((p - far).length < (p - (2 * centre - far)).length) == side] for side in (True, False)]
eyes = sorted((sum(e, Vector()) / len(e) for e in eyes), key=lambda p: p.x)


def socket(p):
    return {'x': round(0.5 + p.x / BUILDING_CELLS, 6), 'y': round(0.5 - p.y / BUILDING_CELLS, 6), 'z': round(p.z, 3)}


json.dump({'buildingCells': BUILDING_CELLS, 'pitCells': PIT_CELLS, 'pxPerCell': PX_PER_CELL,
           'sockets': {'core': socket(centre), 'eyeA': socket(eyes[0]), 'eyeB': socket(eyes[1]),
                       'mouth': {'x': 0.5, 'y': round(0.5 + 2.0 / BUILDING_CELLS, 6), 'z': 0}}},
          open(f'{OUT}/export.json', 'w'), indent=1)
result = {'rendered': len(done), 'rib_islands': len(rib_groups)}
