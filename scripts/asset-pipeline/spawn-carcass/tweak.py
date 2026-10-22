"""v6 tweaks: darker violet eyes (the game adds the glow on the GPU), glowing eggs scattered organically
inside and behind the skeleton, a calmer pool surface in the top view, litter kept off the stain."""
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, noise

scene = bpy.data.scenes['SpawnCarcassV6']
rng = random.Random('carcass-eggs-v6')
UP = Vector((0, 0, 1))
NEST = Vector((0.0, 0.3, 0.0))
OPENING = Vector((0.0, -1.0, 0.0))

# Eyes: deep violet embers; the runtime emissive pass carries the glow.
ember = bpy.data.materials['v6_ember'].node_tree.nodes['Principled BSDF']
ember.inputs['Emission Color'].default_value = (0.26, 0.05, 0.55, 1)
for n in bpy.data.materials['v6_ember'].node_tree.nodes:
    if n.type == 'MAP_RANGE': n.inputs['To Max'].default_value = 2.2

# Eggs glow from inside dark shells.
egg = bpy.data.materials['atmos6_egg'].node_tree.nodes
egg['Principled BSDF'].inputs['Base Color'].default_value = (0.045, 0.016, 0.065, 1)
egg['Principled BSDF'].inputs['Emission Color'].default_value = (0.42, 0.1, 0.9, 1)
for n in egg:
    if n.type == 'MAP_RANGE': n.inputs['To Min'].default_value = 0.65; n.inputs['To Max'].default_value = 0.12

# Finer slime veins.
for n in bpy.data.materials['atmos6_slime'].node_tree.nodes:
    if n.type == 'TEX_VORONOI': n.inputs['Scale'].default_value = 30

# Moss only low on the bones, never on the tops of the ribs and the spine.
for name in ('v6_bone', 'v6_old_bone'):
    tree = bpy.data.materials[name].node_tree
    nodes, links = tree.nodes, tree.links
    for old in ('atmos6_mosslow', 'atmos6_mossmul'):
        if old in nodes: nodes.remove(nodes[old])
    low = nodes.new('ShaderNodeMapRange'); low.name = 'atmos6_mosslow'
    low.inputs['From Min'].default_value, low.inputs['From Max'].default_value = 0.25, 0.55
    low.inputs['To Min'].default_value, low.inputs['To Max'].default_value = 0.8, 0.0
    links.new(nodes['atmos6_sep'].outputs['Z'], low.inputs['Value'])
    mul = nodes.new('ShaderNodeMath'); mul.name = 'atmos6_mossmul'; mul.operation = 'MULTIPLY'
    links.new(nodes['atmos6_mo2'].outputs['Value'], mul.inputs[0]); links.new(low.outputs['Result'], mul.inputs[1])
    links.new(mul.outputs['Value'], nodes['atmos6_mosscol'].inputs['Factor'])

# Pool: no cell relief and no grey puddle speckles from straight above; the membrane lies faint and light
# over the painted egg nest instead of darkening it into blotches.
floor = bpy.data.materials['atmos6_floor'].node_tree.nodes
for n in floor:
    if n.type == 'BUMP': n.inputs['Strength'].default_value = 0.18
    if n.type == 'TEX_VORONOI': n.inputs['Scale'].default_value = 3.5
    if n.type == 'MAP_RANGE' and abs(n.inputs['To Min'].default_value - 0.55) < 1e-6: n.inputs['To Min'].default_value = 0.32; n.inputs['To Max'].default_value = 0.22
    if n.type == 'MAP_RANGE' and abs(n.inputs['From Min'].default_value - 0.6) < 1e-6 and n.inputs['Value'].is_linked:
        n.inputs['To Max'].default_value = 0.35
    if n.type == 'MIX' and n.blend_type == 'MULTIPLY' and n.inputs['A'].is_linked and n.inputs['A'].links[0].from_node.type == 'TEX_IMAGE':
        n.inputs['B'].default_value = (0.6, 0.55, 0.65, 1)

# Litter only on the forest floor, never on the stain.
for obj in list(scene.objects):
    if obj.name.startswith('atmos6_litter') and (Vector((obj.location.x, obj.location.y, 0)) - NEST).length < 2.9:
        bpy.data.objects.remove(obj, do_unlink=True)


def in_opening(p, width=0.9):
    d = p - NEST; d.z = 0
    return d.dot(OPENING) > 0.4 and abs(d.cross(OPENING).z) < width


def covered(p):
    """A bone above this ground point: sheltered spot inside the skeleton."""
    dg = bpy.context.evaluated_depsgraph_get()
    ok, loc, nrm, idx, obj, _ = scene.ray_cast(dg, p + UP * 3, Vector((0, 0, -1)))
    return ok and obj.name.startswith('v6_') and obj.name != 'v6_ground' and loc.z > 0.12


for obj in list(scene.objects):
    if obj.name == 'atmos6_eggs_scatter': bpy.data.objects.remove(obj, do_unlink=True)
bm = bmesh.new()
placed = 0
for k in range(900):
    ang = rng.uniform(0, 2 * math.pi)
    r = rng.uniform(1.5, 3.3)
    p = NEST + Vector((math.cos(ang), math.sin(ang), 0)) * r
    if in_opening(p, 1.0): continue
    # Organic clustering: eggs gather where the noise is high, and under the bones.
    density = noise.noise(p * 0.9) * 0.5 + 0.5
    shelter = covered(p)
    chance = (0.02 + 0.07 * max(0, density - 0.45)) * (2.2 if shelter else 1.0) * (0.5 if r > 2.6 else 1.0)
    if rng.random() > chance: continue
    for e in range(rng.choice((1, 1, 2, 3))):
        q = p + Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 0))
        size = rng.uniform(0.05, 0.11)
        shape = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
        tilt = Matrix.Rotation(rng.uniform(-0.5, 0.5), 3, 'X') @ Matrix.Rotation(rng.uniform(0, 6.3), 3, 'Z')
        for v in shape['verts']:
            v.co = q + UP * size * 0.25 + tilt @ Vector((v.co.x * size * 0.8, v.co.y * size * 0.8, v.co.z * size))
        placed += 1
mesh = bpy.data.meshes.new('atmos6_eggs_scatter'); bm.to_mesh(mesh); bm.free()
for poly in mesh.polygons: poly.use_smooth = True
mesh.materials.append(bpy.data.materials['atmos6_egg'])
scene.collection.objects.link(bpy.data.objects.new('atmos6_eggs_scatter', mesh))
result = {'scattered_eggs': placed}
