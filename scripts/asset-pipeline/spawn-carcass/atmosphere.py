"""Atmosphere v6 on the v6 carcass: forest floor with litter and debris, a detailed brood pool, branching
void growth that creeps onto the bones, slime strands from the ribs, half-sunk egg clutches with broken
shells, moss and earth on the outer bones, violet nest light."""
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, noise

LIVE = globals()['LIVE']        # injected by bl.py
ROOT = globals()['ROOT']        # injected by bl.py
scene = bpy.data.scenes['SpawnCarcassV6']
rng = random.Random('carcass-atmos-v6')
UP = Vector((0, 0, 1))
NEST = Vector((0.0, 0.3, 0.0))
OPENING = Vector((0.0, -1.0, 0.0))     # the spawn path leaves toward -y: keep it clear

for obj in list(scene.objects):
    if obj.name.startswith('atmos6_'):
        bpy.data.objects.remove(obj, do_unlink=True)


def link(obj):
    scene.collection.objects.link(obj)
    return obj


def material(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    return m, m.node_tree.nodes, m.node_tree.links


def img(path, colour=True):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return im


def in_opening(p, width=0.9):
    """Inside the corridor the enemies leave through: from the nest out toward the base."""
    d = p - NEST; d.z = 0
    along = d.dot(OPENING)
    return along > 0.4 and abs(d.cross(OPENING).z) < width


def obj_from(bm, name, mat, smooth=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
    for poly in mesh.polygons: poly.use_smooth = smooth
    mesh.materials.append(mat)
    return link(bpy.data.objects.new(name, mesh))


def tube(bm, points, radii, seg=8, flat=1.0, up=UP):
    rings = []
    for i, p in enumerate(points):
        a, b = points[max(0, i - 1)], points[min(len(points) - 1, i + 1)]
        tan = (b - a).normalized()
        side = tan.cross(up)
        if side.length < 1e-4: side = tan.cross(Vector((1, 0, 0)))
        side.normalize(); nrm = side.cross(tan).normalized()
        rings.append([bm.verts.new(p + side * math.cos(2 * math.pi * k / seg) * radii[i] + nrm * math.sin(2 * math.pi * k / seg) * radii[i] * flat) for k in range(seg)])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(seg): bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        c = bm.verts.new(sum((v.co for v in ring), Vector()) / seg)
        for k in range(seg):
            f = (ring[k], ring[(k + 1) % seg], c); bm.faces.new(f[::-1] if flip else f)


def blob(bm, centre, radii, rot=0.0, wobble=0.25):
    shape = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
    m = Matrix.Rotation(rot, 3, 'Z')
    seed = Vector((rng.random() * 40, rng.random() * 40, 0))
    for v in shape['verts']:
        local = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
        local *= 1 + wobble * noise.noise(v.co * 1.8 + seed)
        v.co = centre + m @ local
    return shape['verts']


def hit(origin, direction, distance=10.0):
    dg = bpy.context.evaluated_depsgraph_get()
    ok, loc, nrm, idx, obj, _ = scene.ray_cast(dg, origin, direction, distance=distance)
    if ok and obj.name.startswith('v6_') and obj.name != 'v6_ground':
        return loc, nrm, obj.name
    return None


# === Floor: forest floor (the map's own earth and grass) under the painted brood pool ===============
m, nodes, links = material('atmos6_floor')
out = nodes.new('ShaderNodeOutputMaterial'); bsdf = nodes.new('ShaderNodeBsdfPrincipled')
coord = nodes.new('ShaderNodeTexCoord')
tile = nodes.new('ShaderNodeMapping'); tile.inputs['Scale'].default_value = (0.42, 0.42, 1)
links.new(coord.outputs['Object'], tile.inputs['Vector'])
earth = nodes.new('ShaderNodeTexImage'); earth.image = img(f'{ROOT}/tools/source-art/ground-materials/earth.png')
grass = nodes.new('ShaderNodeTexImage'); grass.image = img(f'{ROOT}/tools/source-art/ground-materials/grass.png')
for t in (earth, grass): links.new(tile.outputs['Vector'], t.inputs['Vector'])
patch = nodes.new('ShaderNodeTexNoise'); patch.inputs['Scale'].default_value = 0.9; patch.inputs['Detail'].default_value = 6
links.new(coord.outputs['Object'], patch.inputs['Vector'])
pm = nodes.new('ShaderNodeMapRange'); pm.inputs['From Min'].default_value = 0.42; pm.inputs['From Max'].default_value = 0.6
links.new(patch.outputs['Fac'], pm.inputs['Value'])
# Near the carcass the grass dies back to bare earth.
dist = nodes.new('ShaderNodeVectorMath'); dist.operation = 'LENGTH'
offset = nodes.new('ShaderNodeVectorMath'); offset.operation = 'SUBTRACT'; offset.inputs[1].default_value = NEST
links.new(coord.outputs['Object'], offset.inputs[0]); links.new(offset.outputs['Vector'], dist.inputs[0])
bare = nodes.new('ShaderNodeMapRange'); bare.inputs['From Min'].default_value = 3.0; bare.inputs['From Max'].default_value = 4.3
links.new(dist.outputs['Value'], bare.inputs['Value'])
gm = nodes.new('ShaderNodeMath'); gm.operation = 'MULTIPLY'
links.new(pm.outputs['Result'], gm.inputs[0]); links.new(bare.outputs['Result'], gm.inputs[1])
ground = nodes.new('ShaderNodeMix'); ground.data_type = 'RGBA'
links.new(gm.outputs['Value'], ground.inputs['Factor'])
links.new(earth.outputs['Color'], ground.inputs['A']); links.new(grass.outputs['Color'], ground.inputs['B'])
# The painted pool and creep stain on top, with varied wet slime.
pmap = nodes.new('ShaderNodeMapping'); pmap.inputs['Location'].default_value = (0.5, 0.5, 0); pmap.inputs['Scale'].default_value = (0.1, 0.1, 1)
links.new(coord.outputs['Object'], pmap.inputs['Vector'])
dec = nodes.new('ShaderNodeTexImage'); dec.extension = 'CLIP'
dec.image = img(f'{ROOT}/art/poc/spawn-structure/painted/carcass-p1/spawn-brood-pit/active.png')
links.new(pmap.outputs['Vector'], dec.inputs['Vector'])
membrane = nodes.new('ShaderNodeTexImage'); membrane.image = img(f'{ROOT}/art/poc/dawn/textures/library/organic-membrane-violet-01.png')
mm = nodes.new('ShaderNodeMapping'); mm.inputs['Scale'].default_value = (0.8, 0.8, 1)
links.new(coord.outputs['Object'], mm.inputs['Vector']); links.new(mm.outputs['Vector'], membrane.inputs['Vector'])
mem_dark = nodes.new('ShaderNodeMix'); mem_dark.data_type = 'RGBA'; mem_dark.blend_type = 'MULTIPLY'; mem_dark.inputs['Factor'].default_value = 1
links.new(membrane.outputs['Color'], mem_dark.inputs['A']); mem_dark.inputs['B'].default_value = (0.35, 0.3, 0.4, 1)
core = nodes.new('ShaderNodeMapRange'); core.inputs['From Min'].default_value = 0.6; core.inputs['From Max'].default_value = 1.0
links.new(dec.outputs['Alpha'], core.inputs['Value'])
pool_mix = nodes.new('ShaderNodeMix'); pool_mix.data_type = 'RGBA'; pool_mix.blend_type = 'OVERLAY'
links.new(core.outputs['Result'], pool_mix.inputs['Factor'])
links.new(dec.outputs['Color'], pool_mix.inputs['A']); links.new(mem_dark.outputs['Result'], pool_mix.inputs['B'])
over = nodes.new('ShaderNodeMix'); over.data_type = 'RGBA'
links.new(dec.outputs['Alpha'], over.inputs['Factor'])
links.new(ground.outputs['Result'], over.inputs['A']); links.new(pool_mix.outputs['Result'], over.inputs['B'])
links.new(over.outputs['Result'], bsdf.inputs['Base Color'])
# Glossy puddles inside the pool, matte soil outside.
puddle = nodes.new('ShaderNodeTexNoise'); puddle.inputs['Scale'].default_value = 2.5
links.new(coord.outputs['Object'], puddle.inputs['Vector'])
wet = nodes.new('ShaderNodeMapRange'); wet.inputs['From Min'].default_value = 0.45; wet.inputs['From Max'].default_value = 0.6
wet.inputs['To Min'].default_value = 0.55; wet.inputs['To Max'].default_value = 0.12
links.new(puddle.outputs['Fac'], wet.inputs['Value'])
rough = nodes.new('ShaderNodeMix'); rough.data_type = 'FLOAT'
links.new(dec.outputs['Alpha'], rough.inputs['Factor']); rough.inputs['A'].default_value = 0.92
links.new(wet.outputs['Result'], rough.inputs['B']); links.new(rough.outputs['Result'], bsdf.inputs['Roughness'])
# Relief: earth grain outside, slime cells inside.
bw = nodes.new('ShaderNodeRGBToBW'); links.new(ground.outputs['Result'], bw.inputs['Color'])
cells = nodes.new('ShaderNodeTexVoronoi'); cells.inputs['Scale'].default_value = 7
links.new(coord.outputs['Object'], cells.inputs['Vector'])
height = nodes.new('ShaderNodeMix'); height.data_type = 'FLOAT'
links.new(dec.outputs['Alpha'], height.inputs['Factor']); links.new(bw.outputs['Val'], height.inputs['A']); links.new(cells.outputs['Distance'], height.inputs['B'])
bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.6; bump.inputs['Distance'].default_value = 0.03
links.new(height.outputs['Result'], bump.inputs['Height']); links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
fm = bpy.data.meshes.new('atmos6_floor'); b = bmesh.new()
bmesh.ops.create_grid(b, x_segments=1, y_segments=1, size=6.0); b.to_mesh(fm); b.free()
fm.materials.append(m)
floor = link(bpy.data.objects.new('atmos6_floor', fm)); floor.location.z = -0.002
if 'v6_ground' in scene.objects: scene.objects['v6_ground'].hide_render = True

# === Litter: leaves, needles, twigs, pebbles as flat cut-outs on the forest floor ======================
litter_files = ['leaf-litter-01.png', 'leaf-litter-03.png', 'leaf-litter-04.png', 'needle-litter-02.png', 'twigs-02.png', 'twigs-05.png', 'pebbles-01.png']
litter_mats = []
for name in litter_files:
    mt, nodes, links = material('atmos6_litter_' + name)
    out = nodes.new('ShaderNodeOutputMaterial'); bsdf = nodes.new('ShaderNodeBsdfPrincipled'); bsdf.inputs['Roughness'].default_value = 0.9
    tx = nodes.new('ShaderNodeTexImage'); tx.image = img(f'{ROOT}/tools/source-art/ground-litter-v8/{name}')
    links.new(tx.outputs['Color'], bsdf.inputs['Base Color']); links.new(tx.outputs['Alpha'], bsdf.inputs['Alpha'])
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    litter_mats.append((mt, tx.image.size[0] / tx.image.size[1]))
placed = 0
for k in range(70):
    p = Vector((rng.uniform(-4.6, 4.6), rng.uniform(-4.6, 4.6), 0.004 + 0.001 * k / 70))
    if (p - NEST).length < 2.4 or in_opening(p, 1.2): continue
    mt, aspect = rng.choice(litter_mats)
    size = rng.uniform(0.6, 1.3)
    me = bpy.data.meshes.new('atmos6_litter'); b = bmesh.new()
    bmesh.ops.create_grid(b, x_segments=1, y_segments=1, size=0.5)
    for v in b.verts: v.co.x *= aspect
    b.loops.layers.uv.new('UVMap')
    uv = b.loops.layers.uv.active
    for face in b.faces:
        for loop in face.loops:
            loop[uv].uv = (loop.vert.co.x / aspect + 0.5, loop.vert.co.y + 0.5)
    b.to_mesh(me); b.free()
    me.materials.append(mt)
    o = link(bpy.data.objects.new('atmos6_litter', me))
    o.location = p; o.scale = (size, size, 1); o.rotation_euler.z = rng.uniform(0, 6.28)
    placed += 1

# === Debris: bone shards and stones around the outer bones ============================================
bone_mat = bpy.data.materials['v6_old_bone']
stone_m, nodes, links = material('atmos6_stone')
out = nodes.new('ShaderNodeOutputMaterial'); bsdf = nodes.new('ShaderNodeBsdfPrincipled')
bsdf.inputs['Base Color'].default_value = (0.08, 0.075, 0.07, 1); bsdf.inputs['Roughness'].default_value = 0.85
links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
bm_bone, bm_stone = bmesh.new(), bmesh.new()
for k in range(160):
    ang = rng.uniform(0, 6.28); r = rng.uniform(1.6, 4.0) ** 1.0
    p = NEST + Vector((math.cos(ang), math.sin(ang), 0)) * r
    if in_opening(p, 0.8): continue
    if rng.random() < 0.45:
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)).normalized()
        L = rng.uniform(0.06, 0.22); rad = rng.uniform(0.012, 0.03)
        tube(bm_bone, [p, p + d * L * 0.5 + UP * 0.01, p + d * L], [rad, rad * 0.9, rad * 0.5], seg=6)
    else:
        s_ = rng.uniform(0.02, 0.07)
        blob(bm_stone, p + UP * s_ * 0.2, (s_ * rng.uniform(0.8, 1.4), s_, s_ * 0.6), rng.uniform(0, 6.28), 0.3)
obj_from(bm_bone, 'atmos6_shards', bone_mat)
obj_from(bm_stone, 'atmos6_stones', stone_m)

# === Slime material (growth, strands, pads) ==========================================================
slime, nodes, links = material('atmos6_slime')
out = nodes.new('ShaderNodeOutputMaterial'); bsdf = nodes.new('ShaderNodeBsdfPrincipled')
bsdf.inputs['Base Color'].default_value = (0.035, 0.012, 0.05, 1); bsdf.inputs['Roughness'].default_value = 0.18
bsdf.inputs['Coat Weight'].default_value = 0.5
coord = nodes.new('ShaderNodeTexCoord')
veins = nodes.new('ShaderNodeTexVoronoi'); veins.feature = 'DISTANCE_TO_EDGE'; veins.inputs['Scale'].default_value = 16
links.new(coord.outputs['Object'], veins.inputs['Vector'])
vm = nodes.new('ShaderNodeMapRange'); vm.inputs['From Max'].default_value = 0.03
vm.inputs['To Min'].default_value = 0.6; vm.inputs['To Max'].default_value = 0.0
links.new(veins.outputs['Distance'], vm.inputs['Value'])
bsdf.inputs['Emission Color'].default_value = (0.5, 0.15, 1.0, 1)
links.new(vm.outputs['Result'], bsdf.inputs['Emission Strength'])
links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

# === Void growth: branching, flat to the ground, fused into the pool, climbing the first bone =========
bm = bmesh.new()


def grow(p, heading, thickness, depth, steps):
    pts = [p.copy()]
    for step in range(steps):
        heading = (heading + Vector((noise.noise(p * 2.1), noise.noise(p * 2.1 + Vector((7, 3, 0))), 0)) * 0.4).normalized()
        found = hit(p + UP * 0.03, heading, 0.1)
        if found:
            loc, nrm, _ = found
            for h in range(1, rng.randint(4, 9)):
                pts.append(loc + UP * 0.055 * h + nrm * 0.025 - heading * 0.01 * h)
            break
        p = p + heading * 0.065; p.z = 0.012
        if in_opening(p, 0.7): break
        pts.append(p.copy())
        if depth < 2 and step > 3 and rng.random() < 0.13:
            grow(p, (heading + Vector((-heading.y, heading.x, 0)) * rng.choice((-0.9, 0.9))).normalized(), thickness * 0.65, depth + 1, steps - step)
    if len(pts) < 3: return
    radii = [thickness * (1 - 0.85 * i / (len(pts) - 1)) + 0.004 for i in range(len(pts))]
    tube(bm, pts, radii, seg=7, flat=0.45)


roots = 0
for k in range(34):
    ang = rng.uniform(0, 2 * math.pi)
    d = Vector((math.cos(ang), math.sin(ang), 0))
    start = NEST + d * rng.uniform(0.85, 1.15) + UP * 0.01
    if in_opening(start, 0.9): continue
    # A flat pad where the root leaves the pool.
    blob(bm, start, (0.12, 0.08, 0.02), ang, 0.4)
    grow(start, d, rng.uniform(0.035, 0.055), 0, 26)
    roots += 1
growth = obj_from(bm, 'atmos6_growth', slime)
r = growth.modifiers.new('fuse', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = 0.012; r.use_smooth_shade = True
s = growth.modifiers.new('soften', 'SMOOTH'); s.iterations = 2

# === Slime strands hanging from ribs and spine into the pool ===========================================
bm = bmesh.new()
strands = 0
tries = 0
while strands < 26 and tries < 600:
    tries += 1
    p = NEST + Vector((rng.uniform(-2.6, 2.6), rng.uniform(-2.2, 2.8), 3.0))
    if (Vector((p.x, p.y, 0)) - NEST).length > 2.7: continue
    found = hit(p, Vector((0, 0, -1)))
    if not found: continue
    loc, nrm, name = found
    if name not in ('v6_ribs', 'v6_spine') or loc.z < 0.3: continue
    top = loc - UP * 0.02
    drop = rng.random() < 0.3                     # some only drip, not reaching the ground
    bottom_z = rng.uniform(0.12, 0.3) if drop else 0.0
    sway = Vector((rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06), 0))
    pts = [top.lerp(Vector((top.x, top.y, bottom_z)), t) + sway * math.sin(math.pi * t) for t in (0, 0.2, 0.45, 0.7, 0.9, 1.0)]
    radii = [0.022, 0.009, 0.006, 0.007, 0.012, 0.03 if drop else 0.02]
    tube(bm, pts, radii, seg=6)
    if drop:
        blob(bm, pts[-1] - UP * 0.02, (0.03, 0.03, 0.04), 0, 0.1)
    else:
        blob(bm, Vector((pts[-1].x, pts[-1].y, 0.0)), (0.09, 0.07, 0.015), rng.uniform(0, 6.3), 0.3)
    strands += 1
obj_from(bm, 'atmos6_strands', slime)

# === Egg clutches: half sunk in the slime, some burst open ===========================================
egg_m, nodes, links = material('atmos6_egg')
out = nodes.new('ShaderNodeOutputMaterial'); bsdf = nodes.new('ShaderNodeBsdfPrincipled')
bsdf.inputs['Base Color'].default_value = (0.07, 0.025, 0.1, 1); bsdf.inputs['Roughness'].default_value = 0.2
bsdf.inputs['Coat Weight'].default_value = 0.7
lw = nodes.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.3
em = nodes.new('ShaderNodeMapRange'); em.inputs['To Min'].default_value = 0.28; em.inputs['To Max'].default_value = 0.0
links.new(lw.outputs['Facing'], em.inputs['Value'])
bsdf.inputs['Emission Color'].default_value = (0.45, 0.12, 0.95, 1)
links.new(em.outputs['Result'], bsdf.inputs['Emission Strength'])
links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
bm, bm_shell = bmesh.new(), bmesh.new()
eggs = 0
for k in range(16):
    ang = rng.uniform(0, 2 * math.pi)
    c = NEST + Vector((math.cos(ang), math.sin(ang), 0)) * rng.uniform(0.75, 1.9)
    if in_opening(c, 1.0): continue
    for e in range(rng.randint(3, 8)):
        p = c + Vector((rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), 0))
        size = rng.uniform(0.06, 0.13)
        if rng.random() < 0.22:
            # Burst shell: a cup open to the top, ragged rim.
            verts = blob(bm_shell, p + UP * size * 0.25, (size * 0.8, size * 0.8, size), rng.uniform(0, 6.3), 0.1)
            cut = [v for v in verts if v.co.z > p.z + size * (0.45 + 0.25 * rng.random())]
            bmesh.ops.delete(bm_shell, geom=cut, context='VERTS')
        else:
            blob(bm, p + UP * size * 0.15, (size * 0.78, size * 0.78, size), rng.uniform(0, 6.3), 0.08)
        eggs += 1
obj_from(bm, 'atmos6_eggs', egg_m)
shell = obj_from(bm_shell, 'atmos6_shells', egg_m)
shell.modifiers.new('thick', 'SOLIDIFY').thickness = 0.008

# === Bones: slime creeping up near the nest, moss and earth on the outer side ========================
nest_mark = link(bpy.data.objects.new('atmos6_nest_mark', None)); nest_mark.location = NEST
moss_img = img(f'{ROOT}/art/poc/dawn/textures/library/mask-moss-01.png', False)
for bone_mat in ('v6_bone', 'v6_old_bone'):
    mt = bpy.data.materials[bone_mat]
    nodes, links = mt.node_tree.nodes, mt.node_tree.links
    for n in [n for n in nodes if n.name.startswith('atmos6_')]: nodes.remove(n)
    bsdf = nodes['Principled BSDF']
    base = bsdf.inputs['Base Color'].links[0].from_socket
    if base.node.name.startswith('atmos6_'): continue
    def node(kind, name):
        n = nodes.new(kind); n.name = 'atmos6_' + name; return n
    tc = node('ShaderNodeTexCoord', 'tc'); tc.object = nest_mark
    sep = node('ShaderNodeSeparateXYZ', 'sep'); links.new(tc.outputs['Object'], sep.inputs['Vector'])
    flat = node('ShaderNodeCombineXYZ', 'flat'); links.new(sep.outputs['X'], flat.inputs['X']); links.new(sep.outputs['Y'], flat.inputs['Y'])
    dist = node('ShaderNodeVectorMath', 'dist'); dist.operation = 'LENGTH'; links.new(flat.outputs['Vector'], dist.inputs[0])
    # Slime: near the nest, low on the bone.
    near = node('ShaderNodeMapRange', 'near'); near.inputs['From Min'].default_value = 1.2; near.inputs['From Max'].default_value = 2.3
    near.inputs['To Min'].default_value = 1; near.inputs['To Max'].default_value = 0
    links.new(dist.outputs['Value'], near.inputs['Value'])
    low = node('ShaderNodeMapRange', 'low'); low.inputs['From Min'].default_value = 0.05; low.inputs['From Max'].default_value = 0.55
    low.inputs['To Min'].default_value = 1; low.inputs['To Max'].default_value = 0
    links.new(sep.outputs['Z'], low.inputs['Value'])
    sl = node('ShaderNodeMath', 'slime'); sl.operation = 'MULTIPLY'; sl.use_clamp = True
    links.new(near.outputs['Result'], sl.inputs[0]); links.new(low.outputs['Result'], sl.inputs[1])
    # Moss: away from the nest, on upward faces, patchy.
    far = node('ShaderNodeMapRange', 'far'); far.inputs['From Min'].default_value = 1.9; far.inputs['From Max'].default_value = 2.6
    links.new(dist.outputs['Value'], far.inputs['Value'])
    geo = node('ShaderNodeNewGeometry', 'geo'); gsep = node('ShaderNodeSeparateXYZ', 'gsep'); links.new(geo.outputs['Normal'], gsep.inputs['Vector'])
    upf = node('ShaderNodeMapRange', 'up'); upf.inputs['From Min'].default_value = 0.25; upf.inputs['From Max'].default_value = 0.7
    links.new(gsep.outputs['Z'], upf.inputs['Value'])
    mtex = node('ShaderNodeTexImage', 'moss'); mtex.image = moss_img; mtex.projection = 'BOX'; mtex.projection_blend = 0.3
    mmap = node('ShaderNodeMapping', 'mmap'); mmap.inputs['Scale'].default_value = (1.3, 1.3, 1.3)
    links.new(tc.outputs['Object'], mmap.inputs['Vector']); links.new(mmap.outputs['Vector'], mtex.inputs['Vector'])
    mo1 = node('ShaderNodeMath', 'mo1'); mo1.operation = 'MULTIPLY'; links.new(far.outputs['Result'], mo1.inputs[0]); links.new(upf.outputs['Result'], mo1.inputs[1])
    mo2 = node('ShaderNodeMath', 'mo2'); mo2.operation = 'MULTIPLY'; mo2.use_clamp = True; links.new(mo1.outputs['Value'], mo2.inputs[0]); links.new(mtex.outputs['Color'], mo2.inputs[1])
    # Earth: every bone darkens toward its foot.
    foot = node('ShaderNodeMapRange', 'foot'); foot.inputs['From Min'].default_value = 0.0; foot.inputs['From Max'].default_value = 0.16
    foot.inputs['To Min'].default_value = 0.85; foot.inputs['To Max'].default_value = 0.0
    links.new(sep.outputs['Z'], foot.inputs['Value'])
    c1 = node('ShaderNodeMix', 'earth'); c1.data_type = 'RGBA'; links.new(foot.outputs['Result'], c1.inputs['Factor'])
    links.new(base, c1.inputs['A']); c1.inputs['B'].default_value = (0.06, 0.045, 0.03, 1)
    c2 = node('ShaderNodeMix', 'mosscol'); c2.data_type = 'RGBA'; links.new(mo2.outputs['Value'], c2.inputs['Factor'])
    links.new(c1.outputs['Result'], c2.inputs['A']); c2.inputs['B'].default_value = (0.045, 0.07, 0.025, 1)
    c3 = node('ShaderNodeMix', 'slimecol'); c3.data_type = 'RGBA'; links.new(sl.outputs['Value'], c3.inputs['Factor'])
    links.new(c2.outputs['Result'], c3.inputs['A']); c3.inputs['B'].default_value = (0.035, 0.012, 0.05, 1)
    links.new(c3.outputs['Result'], bsdf.inputs['Base Color'])
    rgh = node('ShaderNodeMapRange', 'rough'); rgh.inputs['To Min'].default_value = 0.85; rgh.inputs['To Max'].default_value = 0.2
    links.new(sl.outputs['Value'], rgh.inputs['Value']); links.new(rgh.outputs['Result'], bsdf.inputs['Roughness'])

# === Light and mood ====================================================================================
ld = bpy.data.lights.get('atmos6_nest_light') or bpy.data.lights.new('atmos6_nest_light', 'POINT')
ld.energy = 110; ld.color = (0.6, 0.28, 1.0); ld.shadow_soft_size = 0.9
light = link(bpy.data.objects.new('atmos6_nest_light', ld)); light.location = NEST + UP * 0.45
light.visible_camera = False; light.visible_glossy = False
world = bpy.data.worlds.get('atmos_world') or bpy.data.worlds.new('atmos_world')
world.use_nodes = True
bg = world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.55, 0.6, 0.75, 1); bg.inputs['Strength'].default_value = 0.32
scene.world = world
scene.objects['v6_sun'].data.energy = 2.6
result = {'litter': placed, 'roots': roots, 'strands': strands, 'eggs': eggs}
