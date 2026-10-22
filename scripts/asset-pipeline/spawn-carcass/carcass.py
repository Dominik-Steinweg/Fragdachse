"""Brutkadaver 3D v4: organic, weathered carcass of a curled reptile/dragon.

Every part is modelled from simple volumes, fused by a voxel remesh (like clay) and weathered by layered
displacement (lumps, Voronoi cracks, erosion), then lightly smoothed. Path from the painted concept
(trace.json): index 0 = tail tip (lower left), end = head (lower right).
"""
import bpy, bmesh, json, math, random
from mathutils import Vector, Matrix, noise

LIVE = globals()['LIVE']        # injected by bl.py
NAME = 'SpawnCarcassV6'
data = json.load(open(f'{LIVE}/trace.json'))
rng = random.Random('carcass-v4')
HEIGHT = 1.6
SPINE_LIFT = 1.3
RING_CENTRE = Vector((0.0, 0.5, 0.0))
STEP = 0.05
SKULL_LEN = 2.3
TAIL_BONES = 1.3
UP = Vector((0, 0, 1))

scene = bpy.data.scenes.get(NAME) or bpy.data.scenes.new(NAME)
for obj in list(scene.collection.objects):
    bpy.data.objects.remove(obj, do_unlink=True)


# --- Helpers ---------------------------------------------------------------------------------------
def gauss(values, sigma):
    radius = int(sigma * 3)
    weights = [math.exp(-0.5 * (k / sigma) ** 2) for k in range(-radius, radius + 1)]
    out = []
    for i in range(len(values)):
        acc = wsum = 0.0
        for k, w in zip(range(-radius, radius + 1), weights):
            j = min(len(values) - 1, max(0, i + k)); acc += values[j] * w; wsum += w
        out.append(acc / wsum)
    return out


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def frame(tan, up_hint=UP):
    x = tan.normalized(); z = (up_hint - x * up_hint.dot(x)).normalized(); y = z.cross(x)
    return Matrix((x, y, z)).transposed()


def ellipsoid(bm, centre, basis, radii, seg=(14, 9), wobble=0.0, seed=0.0):
    shape = bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)
    for v in shape['verts']:
        local = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
        if wobble:
            local *= 1 + wobble * noise.noise(v.co * 1.7 + Vector((seed, seed * 1.3, seed * 0.7)))
        v.co = centre + basis @ local


def tube(bm, points, radii, seg=10, flat=1.0, up=UP, jag=0.0, wobble=0.0):
    """Swept tube; `flat` squashes the section along `up`, `jag` splinters the end, `wobble` bends the axis."""
    rings = []
    seed = rng.random() * 50
    for i, p in enumerate(points):
        a, b = points[max(0, i - 1)], points[min(len(points) - 1, i + 1)]
        tan = (b - a).normalized()
        side = tan.cross(up)
        if side.length < 1e-4: side = tan.cross(Vector((1, 0, 0)))
        side.normalize(); nrm = side.cross(tan).normalized()
        bend = side * noise.noise(Vector((i * 0.7, seed, 0))) * wobble + nrm * noise.noise(Vector((seed, i * 0.7, 3))) * wobble
        ring = []
        for k in range(seg):
            ang = 2 * math.pi * k / seg
            off = tan * rng.uniform(-jag, jag) if (jag and i == len(points) - 1) else Vector()
            ring.append(bm.verts.new(p + bend + off + side * math.cos(ang) * radii[i] + nrm * math.sin(ang) * radii[i] * flat))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(seg): bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        c = bm.verts.new(sum((v.co for v in ring), Vector()) / seg)
        for k in range(seg):
            f = (ring[k], ring[(k + 1) % seg], c); bm.faces.new(f[::-1] if flip else f)


def finish(bm, name, mat):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
    for poly in mesh.polygons: poly.use_smooth = True
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh); scene.collection.objects.link(obj)
    return obj


def noise_tex(name, kind, size, **extra):
    tex = bpy.data.textures.get(name)
    if tex and tex.type != kind: bpy.data.textures.remove(tex); tex = None
    tex = tex or bpy.data.textures.new(name, kind)
    tex.noise_scale = size
    if kind == 'VORONOI':
        tex.distance_metric = 'DISTANCE'; tex.weight_1 = -1.0; tex.weight_2 = 1.0; tex.noise_intensity = 1.6
    if kind == 'CLOUDS':
        tex.noise_depth = extra.get('depth', 2); tex.noise_basis = 'BLENDER_ORIGINAL'
    if kind == 'MUSGRAVE':
        tex.musgrave_type = 'RIDGED_MULTIFRACTAL'; tex.noise_intensity = 1.0
    return tex


def organic(obj, voxel, layers, smooth=0, cutters=()):
    """Fuse like clay, weather with displacement layers (kind, size, strength, mid), cut openings, soften."""
    r = obj.modifiers.new('fuse', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = voxel; r.use_smooth_shade = True
    for cut in cutters:
        b = obj.modifiers.new(cut.name, 'BOOLEAN'); b.operation = 'DIFFERENCE'; b.object = cut; b.solver = 'EXACT'; b.use_hole_tolerant = True
    for k, (kind, size, strength, mid) in enumerate(layers):
        d = obj.modifiers.new(f'weather{k}', 'DISPLACE')
        d.texture = noise_tex(f'{obj.name}_t{k}', kind, size); d.texture_coords = 'GLOBAL'
        d.strength = strength; d.mid_level = mid
    if smooth:
        s = obj.modifiers.new('soften', 'SMOOTH'); s.iterations = smooth; s.factor = 0.5
    return obj


# Weathering presets: (texture, size, strength, mid level).
LUMPS = ('CLOUDS', 0.55, 0.07, 0.5)
CRACKS = ('VORONOI', 0.16, 0.035, 0.2)
ERODE = ('MUSGRAVE', 0.25, 0.02, 0.5)
FINE_CRACKS = ('VORONOI', 0.07, 0.015, 0.2)


# --- Materials ---------------------------------------------------------------------------------------
def image(name, path, colour):
    img = bpy.data.images.get(name)
    if img: bpy.data.images.remove(img)
    img = bpy.data.images.load(path); img.name = name
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return img


albedo = image('v6_albedo', f'{LIVE}/albedo.png', True)
hide_img = image('v6_hide', f'{ROOT}/tools/source-art/spawn-structure/hide-seamless.png', True)


def weathered(name, base, painted=False, glow=None):
    """Matte weathered surface: base colour over the hide tile, dirt in crevices (AO), pale worn edges,
    darker cracks; `painted` projects the concept painting where it covers the carcass."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled'); bsdf.inputs['Roughness'].default_value = 0.85
    coord = nodes.new('ShaderNodeTexCoord')
    tile = nodes.new('ShaderNodeTexImage'); tile.image = hide_img; tile.projection = 'BOX'; tile.projection_blend = 0.4
    tmap = nodes.new('ShaderNodeMapping'); tmap.inputs['Scale'].default_value = (0.9, 0.9, 0.9)
    links.new(coord.outputs['Object'], tmap.inputs['Vector']); links.new(tmap.outputs['Vector'], tile.inputs['Vector'])
    lum = nodes.new('ShaderNodeRGBToBW'); links.new(tile.outputs['Color'], lum.inputs['Color'])
    gain = nodes.new('ShaderNodeMath'); gain.operation = 'MULTIPLY'; gain.inputs[1].default_value = 1.7
    links.new(lum.outputs['Val'], gain.inputs[0])
    colour = nodes.new('ShaderNodeMix'); colour.data_type = 'RGBA'; colour.blend_type = 'MULTIPLY'; colour.inputs['Factor'].default_value = 1
    colour.inputs['A'].default_value = (*base, 1); links.new(gain.outputs['Value'], colour.inputs['B'])
    stain = nodes.new('ShaderNodeTexNoise'); stain.inputs['Scale'].default_value = 1.6; stain.inputs['Detail'].default_value = 4.0
    links.new(coord.outputs['Object'], stain.inputs['Vector'])
    stain_mask = nodes.new('ShaderNodeMapRange')
    stain_mask.inputs['From Min'].default_value = 0.45; stain_mask.inputs['From Max'].default_value = 0.68
    links.new(stain.outputs['Fac'], stain_mask.inputs['Value'])
    stained = nodes.new('ShaderNodeMix'); stained.data_type = 'RGBA'; stained.blend_type = 'MULTIPLY'
    links.new(stain_mask.outputs['Result'], stained.inputs['Factor'])
    links.new(colour.outputs['Result'], stained.inputs['A']); stained.inputs['B'].default_value = (0.45, 0.4, 0.33, 1)
    geo_up = nodes.new('ShaderNodeNewGeometry'); sep_up = nodes.new('ShaderNodeSeparateXYZ')
    links.new(geo_up.outputs['Normal'], sep_up.inputs['Vector'])
    bleach_mask = nodes.new('ShaderNodeMapRange')
    bleach_mask.inputs['From Min'].default_value = 0.5; bleach_mask.inputs['From Max'].default_value = 0.95
    bleach_mask.inputs['To Max'].default_value = 0.35
    links.new(sep_up.outputs['Z'], bleach_mask.inputs['Value'])
    bleached = nodes.new('ShaderNodeMix'); bleached.data_type = 'RGBA'; bleached.blend_type = 'SCREEN'
    links.new(bleach_mask.outputs['Result'], bleached.inputs['Factor'])
    links.new(stained.outputs['Result'], bleached.inputs['A']); bleached.inputs['B'].default_value = (0.6, 0.57, 0.5, 1)
    current = bleached.outputs['Result']
    if painted:
        pmap = nodes.new('ShaderNodeMapping')
        pmap.inputs['Location'].default_value = (0.5, 0.5, 0); pmap.inputs['Scale'].default_value = (1 / 8, 1 / 8, 1)
        ptex = nodes.new('ShaderNodeTexImage'); ptex.image = albedo; ptex.extension = 'EXTEND'
        links.new(coord.outputs['Object'], pmap.inputs['Vector']); links.new(pmap.outputs['Vector'], ptex.inputs['Vector'])
        geo0 = nodes.new('ShaderNodeNewGeometry'); sep0 = nodes.new('ShaderNodeSeparateXYZ')
        links.new(geo0.outputs['Normal'], sep0.inputs['Vector'])
        facing = nodes.new('ShaderNodeMapRange')
        facing.inputs['From Min'].default_value = 0.25; facing.inputs['From Max'].default_value = 0.6
        links.new(sep0.outputs['Z'], facing.inputs['Value'])
        weight = nodes.new('ShaderNodeMath'); weight.operation = 'MULTIPLY'
        links.new(ptex.outputs['Alpha'], weight.inputs[0]); links.new(facing.outputs['Result'], weight.inputs[1])
        mix = nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
        links.new(weight.outputs['Value'], mix.inputs['Factor'])
        links.new(current, mix.inputs['A']); links.new(ptex.outputs['Color'], mix.inputs['B'])
        current = mix.outputs['Result']
    # Cracks: Voronoi edges darkened.
    vor = nodes.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'; vor.inputs['Scale'].default_value = 5.5
    links.new(coord.outputs['Object'], vor.inputs['Vector'])
    patch = nodes.new('ShaderNodeTexNoise'); patch.inputs['Scale'].default_value = 2.2
    links.new(coord.outputs['Object'], patch.inputs['Vector'])
    mask = nodes.new('ShaderNodeMapRange')
    mask.inputs['From Min'].default_value = 0.5; mask.inputs['From Max'].default_value = 0.62
    links.new(patch.outputs['Fac'], mask.inputs['Value'])
    crack_depth = nodes.new('ShaderNodeMapRange')
    crack_depth.inputs['From Min'].default_value = 0.0; crack_depth.inputs['From Max'].default_value = 0.04
    crack_depth.inputs['To Min'].default_value = 0.6; crack_depth.inputs['To Max'].default_value = 1.0
    links.new(vor.outputs['Distance'], crack_depth.inputs['Value'])
    crack = nodes.new('ShaderNodeMix'); crack.data_type = 'FLOAT'
    links.new(mask.outputs['Result'], crack.inputs['Factor'])
    crack.inputs['A'].default_value = 1.0
    links.new(crack_depth.outputs['Result'], crack.inputs['B'])
    cracked = nodes.new('ShaderNodeMix'); cracked.data_type = 'RGBA'; cracked.blend_type = 'MULTIPLY'; cracked.inputs['Factor'].default_value = 1
    links.new(current, cracked.inputs['A']); links.new(crack.outputs['Result'], cracked.inputs['B'])
    # Dirt in crevices.
    ao = nodes.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 0.25
    dirt = nodes.new('ShaderNodeMapRange')
    dirt.inputs['To Min'].default_value = 0.22; dirt.inputs['To Max'].default_value = 1.0
    links.new(ao.outputs['AO'], dirt.inputs['Value'])
    dirty = nodes.new('ShaderNodeMix'); dirty.data_type = 'RGBA'; dirty.blend_type = 'MULTIPLY'; dirty.inputs['Factor'].default_value = 1
    links.new(cracked.outputs['Result'], dirty.inputs['A']); links.new(dirt.outputs['Result'], dirty.inputs['B'])
    # Pale worn edges.
    geo = nodes.new('ShaderNodeNewGeometry')
    edge = nodes.new('ShaderNodeMapRange')
    edge.inputs['From Min'].default_value = 0.52; edge.inputs['From Max'].default_value = 0.62
    edge.inputs['To Max'].default_value = 0.35
    links.new(geo.outputs['Pointiness'], edge.inputs['Value'])
    worn = nodes.new('ShaderNodeMix'); worn.data_type = 'RGBA'; worn.blend_type = 'SCREEN'
    links.new(edge.outputs['Result'], worn.inputs['Factor'])
    links.new(dirty.outputs['Result'], worn.inputs['A']); worn.inputs['B'].default_value = (0.75, 0.7, 0.62, 1)
    links.new(worn.outputs['Result'], bsdf.inputs['Base Color'])
    bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35; bump.inputs['Distance'].default_value = 0.01
    links.new(lum.outputs['Val'], bump.inputs['Height']); links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    if glow:
        # Ember: violet light in veins, not a flat lamp.
        veins = nodes.new('ShaderNodeTexNoise'); veins.inputs['Scale'].default_value = 14.0; veins.inputs['Detail'].default_value = 6.0
        links.new(coord.outputs['Object'], veins.inputs['Vector'])
        ramp = nodes.new('ShaderNodeMapRange')
        ramp.inputs['From Min'].default_value = 0.42; ramp.inputs['From Max'].default_value = 0.62
        ramp.inputs['To Max'].default_value = glow[1]
        links.new(veins.outputs['Fac'], ramp.inputs['Value'])
        bsdf.inputs['Emission Color'].default_value = (*glow[0], 1)
        links.new(ramp.outputs['Result'], bsdf.inputs['Emission Strength'])
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


BONE = weathered('v6_bone', (0.44, 0.38, 0.28))
OLD_BONE = weathered('v6_old_bone', (0.33, 0.29, 0.23))
HIDE = weathered('v6_hide', (0.11, 0.085, 0.07), painted=True)
EMBER = weathered('v6_ember', (0.03, 0.01, 0.04), glow=((0.5, 0.15, 1.0), 4.5))

# --- Path ----------------------------------------------------------------------------------------------
raw = [(p['p'][0], p['p'][1], max(0.0, p['r']), p['full_r'], p['cage']) for p in data['centre']]
dist = [0.0]
for q0, q1 in zip(raw, raw[1:]): dist.append(dist[-1] + math.hypot(q1[0] - q0[0], q1[1] - q0[1]))
samples, j = [], 0
for k in range(int(dist[-1] / STEP) + 1):
    d = k * STEP
    while j < len(dist) - 2 and dist[j + 1] < d: j += 1
    t = (d - dist[j]) / max(1e-6, dist[j + 1] - dist[j])
    samples.append([raw[j][c] + (raw[j + 1][c] - raw[j][c]) * t for c in range(5)])
cols = list(zip(*samples))
xs, ys = gauss(cols[0], 6), gauss(cols[1], 6)
rs, full, cage = gauss(cols[2], 12), gauss(cols[3], 10), gauss(cols[4], 4)
n = len(xs)
_len = [0.0]
for i in range(1, n): _len.append(_len[-1] + math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]))
_tail_end = _len[next(i for i in range(n) if cage[i] > 0.02)] - 0.2
for i in range(n):
    if _len[i] >= _tail_end: break
    k = (1 - _len[i] / _tail_end) ** 1.6
    v = Vector((xs[i], ys[i], 0)) - RING_CENTRE
    v.normalize()
    # Outward and a little back along the body: the tail lies stretched instead of curling into the nest.
    xs[i] += v.x * 1.05 * k; ys[i] += v.y * 1.05 * k
xs, ys = gauss(xs, 4), gauss(ys, 4)
seglen = [0.0]
for i in range(1, n): seglen.append(seglen[-1] + math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]))
LENGTH = seglen[-1]


def index_at(s):
    return min(n - 1, max(0, next((k for k in range(n) if seglen[k] >= s), n - 1)))


def point(i):
    return Vector((xs[i], ys[i], 0))


def tangent(i):
    a, b = max(0, i - 3), min(n - 1, i + 3)
    return Vector((xs[b] - xs[a], ys[b] - ys[a], 0)).normalized()


def outward_at(p):
    v = p - RING_CENTRE; v.z = 0
    return v.normalized()


cage_idx = [i for i in range(n) if cage[i] > 0.02]
CAGE_START, CAGE_END = seglen[cage_idx[0]], seglen[cage_idx[-1]]
PELVIS = CAGE_START + 0.15            # the hip sits where the ribcage begins
SKULL_START = LENGTH - SKULL_LEN * 0.92
spine_h = [full[i] * SPINE_LIFT for i in range(n)]

hide_top = {}

# --- Spine: tail vertebrae on the ground, sacrum at the hip, free column over the ribcage ----------
spine_idx = [i for i in range(n) if seglen[i] < SKULL_START - 0.1]


def column_z(i):
    s = seglen[i]
    tail = 0.08 + 0.55 * smoothstep(0, PELVIS - 0.3, s)
    over_cage = spine_h[i]
    neck = 0.62 - 0.2 * smoothstep(CAGE_END, SKULL_START, s)
    z = tail + (over_cage - tail) * smoothstep(PELVIS - 0.5, PELVIS + 0.4, s)
    return z + (neck - z) * smoothstep(CAGE_END - 0.3, CAGE_END + 0.4, s)


spine_z = dict(zip(spine_idx, gauss([column_z(i) for i in spine_idx], 5)))
bm = bmesh.new()
last = -1.0
for i in spine_idx:
    s = seglen[i]
    size = 0.4 + 0.6 * smoothstep(0, PELVIS, s)
    size *= 1 + 0.45 * smoothstep(CAGE_END - 0.2, SKULL_START, s)
    if s - last < 0.1 + 0.09 * size: continue
    last = s
    tan = tangent(i)
    c = Vector((xs[i], ys[i], spine_z[i]))
    loose = smoothstep(TAIL_BONES * 0.9, 0.0, s)
    if loose > 0.05:
        # The tail tip has fallen apart: vertebrae shifted, tilted, half sunk.
        c += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.1 * loose - UP * 0.04 * loose
        tan = (tan + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.6 * loose).normalized()
    basis = frame(tan)
    ellipsoid(bm, c, basis, (0.11 * size, 0.12 * size, 0.11 * size), wobble=0.18, seed=s)
    # Neural spine leaning back, often snapped; transverse processes.
    height = (0.1 + rng.random() * 0.16) * size
    tube(bm, [c + UP * 0.06 * size, c + UP * (0.06 + height) - tan * 0.07 * size], [0.05 * size, 0.012], seg=7, jag=0.03)
    for sgn in (-1, 1):
        tube(bm, [c, c + basis.col[1] * sgn * 0.17 * size - UP * 0.03], [0.042 * size, 0.016 * size], seg=6, jag=0.02)
    if s < PELVIS - 0.3:
        # Chevron under each tail vertebra, raking back.
        tube(bm, [c - UP * 0.05 * size, c - UP * 0.13 * size - tan * 0.1 * size], [0.035 * size, 0.012], seg=6)
    if loose < 0.3:
        nxt = index_at(s + 0.08)
        tube(bm, [c, Vector((xs[nxt], ys[nxt], spine_z.get(nxt, c.z)))], [0.06 * size, 0.06 * size], seg=8)
spine_obj = organic(finish(bm, 'v6_spine', BONE), 0.022, [CRACKS, ERODE, FINE_CRACKS], smooth=1)

# --- Ribcage: barrel-shaped, flat ribs bulging out before they fall; many end in the air ------------
rib_at = []
s = PELVIS + 0.35
while s < CAGE_END - 0.05:
    rib_at.append(index_at(s)); s += 0.3 + rng.uniform(-0.04, 0.05)
bm = bmesh.new()


def rib(i, lateral, reach, width, outer):
    zs = spine_z[i]
    start = Vector((xs[i], ys[i], zs))
    roll = rng.random()
    if roll < 0.4: end_deg = rng.uniform(-8, 2)               # reaches the ground
    elif roll < 0.8: end_deg = rng.uniform(15, 50)            # ends in the air
    else: end_deg = rng.uniform(55, 72)                       # snapped short
    pts, radii = [], []
    B = zs * 0.97
    steps = 10
    for k in range(steps + 1):
        deg = 92 - (92 - end_deg) * k / steps
        th = math.radians(deg)
        x = reach * math.cos(th) * (1.0 + (0.12 if outer else 0.06) * math.sin(math.pi * k / steps))
        z = zs - B + B * math.sin(th)
        back = -tangent(i) * reach * 0.22 * (1 - math.sin(th))
        pts.append(start + lateral * x + back + UP * (max(-0.08 if k == steps else 0.04, z) - zs))
        radii.append(width * (1.0 - 0.4 * k / steps))
    broken = end_deg > 10
    tube(bm, pts, radii, seg=8, flat=0.5, up=tangent(i), jag=0.06 if broken else 0, wobble=0.025)
    return broken, pts


for k, i in enumerate(rib_at):
    pos = (seglen[i] - PELVIS) / max(0.1, CAGE_END - PELVIS)
    bell = 0.55 + 0.45 * math.sin(math.pi * min(1, max(0, pos)))
    out = outward_at(point(i))
    w = (0.085 + 0.03 * bell) * rng.uniform(0.85, 1.15)
    broken, pts = rib(i, -out, (0.55 + 0.8 * full[i]) * bell, w, False)
    rib(i, out, (0.38 + 0.35 * full[i]) * bell, w * 0.95, True)
    if broken and rng.random() < 0.5:
        # The lost piece lies below, half sunk.
        a = Vector((pts[-1].x, pts[-1].y, 0.02)) + Vector((rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), 0))
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)).normalized()
        tube(bm, [a, a + d * 0.2 + UP * 0.03, a + d * 0.42], [w * 0.8, w * 0.7, w * 0.4], seg=8, flat=0.5, jag=0.05, wobble=0.02)
ribs_obj = organic(finish(bm, 'v6_ribs', BONE), 0.018, [CRACKS, FINE_CRACKS], smooth=1)

# --- Pelvis: sacrum with curved iliac blades, ischia raking back ---------------------------------
bm = bmesh.new()
ip = index_at(PELVIS); P = point(ip); tp = tangent(ip); op = outward_at(P); zp = spine_z[ip]


def blade(bm, root, along, out, length, height, thickness):
    """A curved bony plate: swept flat section, flaring outward and thinning to a ragged rim."""
    pts, radii = [], []
    for k in range(7):
        t = k / 6
        pts.append(root + along * (t - 0.5) * length + out * (0.12 * math.sin(math.pi * t)) + UP * height * math.sin(math.pi * t) * 0.3)
        radii.append(height * (0.55 + 0.45 * math.sin(math.pi * t)))
    tube(bm, pts, radii, seg=10, flat=thickness / max(1e-3, height), up=out, jag=0.03, wobble=0.02)


for sgn in (-1, 1):
    side = op * sgn
    socket = P + side * 0.38 + UP * (zp * 0.5)
    blade(bm, P + side * 0.22 + UP * (zp - 0.02), tp, (side + UP * 0.6).normalized(), 0.62, 0.17, 0.05)
    ellipsoid(bm, socket, frame(tp), (0.12, 0.12, 0.1), wobble=0.25, seed=sgn)
    tube(bm, [P + side * 0.18 + UP * (zp - 0.08), socket], [0.08, 0.09], seg=8)
    tube(bm, [socket, socket - tp * 0.32 + side * 0.04 - UP * 0.18, socket - tp * 0.5 - UP * 0.3], [0.08, 0.06, 0.035], seg=8, jag=0.04, wobble=0.03)
for k in range(4):
    # Sacral vertebrae fused into one bar.
    c = P + tp * (k - 1.5) * 0.14 + UP * (zp + 0.02)
    ellipsoid(bm, c, frame(tp), (0.09, 0.15, 0.1), wobble=0.15, seed=k)
pelvis_obj = organic(finish(bm, 'v6_pelvis', BONE), 0.022, [LUMPS[:2] + (0.04, 0.5), CRACKS, ERODE], smooth=1)


# --- Leg bones: femur with head and condyles, snapped; a half-sunk claw ------------------------------
def long_bone(bm, a, b, radius, broken_at=None):
    """Shaft from joint a to joint b with knobbly ends; snapped at `broken_at` (0..1) if given."""
    stop = b if broken_at is None else a.lerp(b, broken_at)
    mid = a.lerp(stop, 0.5) + UP * 0.04
    tube(bm, [a, a.lerp(mid, 0.5), mid, mid.lerp(stop, 0.5), stop], [radius * 1.3, radius, radius * 0.85, radius * 0.9, radius * (0.8 if broken_at else 1.2)],
         seg=10, jag=0.07 if broken_at else 0, wobble=0.02)
    ellipsoid(bm, a, frame(b - a), (radius * 1.5, radius * 1.4, radius * 1.3), wobble=0.2, seed=a.x)
    if broken_at is None:
        side = (b - a).cross(UP).normalized()
        for sgn in (-1, 1):
            ellipsoid(bm, b + side * sgn * radius * 0.7, frame(b - a), (radius * 1.2, radius * 0.9, radius * 1.0), wobble=0.2, seed=b.y + sgn)


def claw(bm, at, toward, scale):
    """A foot pressed into the ground: three digits ending in curved claws, half buried."""
    for k in (-1, 0, 1):
        d = (toward + toward.cross(UP) * k * 0.45).normalized()
        a = at + UP * -0.02
        b = a + d * 0.25 * scale + UP * 0.05
        c = b + d * 0.18 * scale - UP * 0.06
        tube(bm, [a, b], [0.06 * scale, 0.05 * scale], seg=8, wobble=0.01)
        tube(bm, [b, b.lerp(c, 0.5) + UP * 0.04, c], [0.045 * scale, 0.03 * scale, 0.005], seg=8)


bm = bmesh.new()
# Hind leg: femur out of the hip socket, knee down at the outside, shin snapped; foot sunk in.
socket = P + op * 0.42 + UP * (zp * 0.42)
knee = P + op * 1.0 + tp * 0.45 + UP * 0.14
long_bone(bm, socket, knee, 0.14)
foot = P + op * 1.25 - tp * 0.15
long_bone(bm, knee, foot + UP * 0.05, 0.11, broken_at=0.6)
claw(bm, foot, (op * 0.35 + tp).normalized(), 1.7)
# The other hind leg folded under the body: only the femur shows.
long_bone(bm, P - op * 0.3 + UP * (zp * 0.35), P - op * 0.6 + tp * 0.5 + UP * 0.08, 0.12, broken_at=0.75)
# Fore leg at the shoulder: humerus snapped, a claw lying beside the neck.
ia = index_at(CAGE_END - 0.35); A = point(ia); ta = tangent(ia); oa = outward_at(A)
shoulder = A + oa * 0.35 + UP * (spine_z.get(ia, 0.9) * 0.55)
long_bone(bm, shoulder, A + oa * 0.95 - ta * 0.3 + UP * 0.1, 0.13, broken_at=0.7)
claw(bm, A + oa * 1.05 + ta * 0.35, (oa * 0.6 + ta).normalized(), 1.6)
isc = index_at(CAGE_END - 0.45); S = point(isc); ts = tangent(isc); os_ = outward_at(S); zs_ = spine_z.get(isc, 1.0)
for sgn in (-1, 1):
    side = os_ * sgn
    blade(bm, S + side * 0.28 + UP * (zs_ * 0.72), ts, (side + UP * 0.2).normalized(), 0.55, 0.2, 0.05)
legs_obj = organic(finish(bm, 'v6_legs', OLD_BONE), 0.02, [('CLOUDS', 0.4, 0.035, 0.5), CRACKS, FINE_CRACKS], smooth=1)

# --- Skull: angular reptile skull, slanted almond orbits, weathered -----------------------------------
ib = index_at(SKULL_START); it = n - 1
B = point(ib); T = point(it) + tangent(it) * 0.15
D = T - B; L = D.length; D.normalize()
side = Vector((D.y, -D.x, 0))
if side.dot(outward_at(B)) < 0: side = -side


def sk(f, lat=0.0, z=0.0):
    return B + D * (f * L) + side * lat + UP * z


bm = bmesh.new()
W, H = 0.62, 0.3

# Section outline (x = lateral, z = height), counter-clockwise from the bottom middle: flat underside,
# flaring cheeks, sloping sides, a flat roof with a slight median ridge.
SECTION = [(0.0, 0.0), (0.32, 0.0), (0.66, 0.07), (0.92, 0.24), (1.0, 0.42), (0.9, 0.64), (0.66, 0.84), (0.36, 0.97), (0.0, 1.02)]
SECTION = SECTION + [(-x, z) for x, z in reversed(SECTION[1:-1])]


def skull_profile(f):
    """Half width and height along the skull (0 = occiput, 1 = snout tip): a wedge in plan view,
    rising from the snout to the brows, the roof dropping a little toward the occiput."""
    width = W * (1 - 0.8 * smoothstep(0.25, 1.0, f) ** 0.9) * (0.82 + 0.18 * smoothstep(0.0, 0.12, f))
    height = H * (0.84 + 0.16 * smoothstep(0.0, 0.3, f)) * (1 - 0.62 * smoothstep(0.4, 1.0, f) ** 0.9)
    return width, height


rings = []
for k in range(25):
    f = k / 24
    width, height = skull_profile(f)
    base = sk(f, 0.025 * math.sin(f * 5), 0.06)
    ring = [bm.verts.new(base + side * x * width + UP * z * height) for x, z in SECTION]
    rings.append(ring)
SEGS = len(SECTION)
for r0, r1 in zip(rings, rings[1:]):
    for q in range(SEGS): bm.faces.new((r0[q], r0[(q + 1) % SEGS], r1[(q + 1) % SEGS], r1[q]))
for ring, flip in ((rings[0], True), (rings[-1], False)):
    cc = bm.verts.new(sum((v.co for v in ring), Vector()) / SEGS)
    for q in range(SEGS):
        f_ = (ring[q], ring[(q + 1) % SEGS], cc); bm.faces.new(f_[::-1] if flip else f_)


def roof(f, lat):
    """Point on the skull roof at fraction f and lateral share lat (0 = midline, 1 = roof edge)."""
    width, height = skull_profile(f)
    return sk(f, lat * width * 0.66, 0.06 + height * (1.0 - 0.1 * lat))


for sgn in (-1, 1):
    # Brow crest: from the snout ridge back over the orbit into the horn base.
    tube(bm, [roof(0.72, sgn * 0.35), roof(0.55, sgn * 0.6) + UP * 0.04, roof(0.4, sgn * 0.62) + UP * 0.07,
              roof(0.22, sgn * 0.7) + UP * 0.05, roof(0.04, sgn * 0.82) + UP * 0.1], [0.035, 0.06, 0.07, 0.06, 0.1], seg=10, wobble=0.02)
    # Cheek (jugal) bar along the lower flank.
    tube(bm, [sk(0.06, sgn * 0.62, 0.16), sk(0.3, sgn * 0.64, 0.18), sk(0.55, sgn * 0.48, 0.14)], [0.08, 0.085, 0.05], seg=10, wobble=0.02)
    # Postorbital bar behind the eye.
    # Horn cores.
    core = sk(-0.05, sgn * 0.48, 0.5)
    tube(bm, [roof(0.06, sgn * 0.85) + UP * 0.08, core], [0.12, 0.1], seg=10)
    tube(bm, [core, sk(-0.2, sgn * 0.57, 0.6), sk(-0.38, sgn * 0.61, 0.62), sk(-0.54, sgn * 0.54, 0.54), sk(-0.62, sgn * 0.46, 0.44)],
         [0.1, 0.08, 0.06, 0.035, 0.008], seg=10, wobble=0.025)
# Median ridge on the snout.
tube(bm, [roof(0.95, 0), roof(0.75, 0) + UP * 0.03, roof(0.55, 0) + UP * 0.02], [0.025, 0.04, 0.02], seg=8)


def almond(name, centre, axis, length, width, depth, slant):
    """Orbit cutter: a slanted almond with pointed corners and a ragged rim."""
    b = bmesh.new()
    ax = (axis * math.cos(slant) + side.cross(UP).normalized() * 0 + axis.cross(UP) * math.sin(slant)).normalized()
    lat = ax.cross(UP).normalized()
    rings_ = []
    for k in range(13):
        t = k / 12
        prof = max(0.12, math.sin(math.pi * t) ** 0.65)
        c = centre + ax * (t - 0.5) * length
        ring = []
        for q in range(14):
            a = 2 * math.pi * q / 14
            jag = 1 + rng.uniform(-0.12, 0.12)
            ring.append(b.verts.new(c + lat * math.cos(a) * width * prof * jag + UP * math.sin(a) * depth * max(0.25, prof)))
        rings_.append(ring)
    for r0, r1 in zip(rings_, rings_[1:]):
        for q in range(14): b.faces.new((r0[q], r0[(q + 1) % 14], r1[(q + 1) % 14], r1[q]))
    for ring, flip in ((rings_[0], True), (rings_[-1], False)):
        cc = b.verts.new(sum((v.co for v in ring), Vector()) / 14)
        for q in range(14):
            f_ = (ring[q], ring[(q + 1) % 14], cc); b.faces.new(f_[::-1] if flip else f_)
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    mesh = bpy.data.meshes.new(name); b.to_mesh(mesh); b.free()
    obj = bpy.data.objects.new(name, mesh); scene.collection.objects.link(obj)
    obj.hide_render = True; obj.display_type = 'WIRE'
    for ray in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
        setattr(obj, ray, False)
    return obj


cutters = []
for sgn in (-1, 1):
    # Orbits slant from the inner front up to the outer back, like a predator's frown.
    cutters.append(almond(f'v6_orbit_{sgn}', roof(0.42, sgn * 1.02) + side * sgn * 0.03, D, 0.44, 0.15, 0.22, -sgn * 0.35))
    cutters.append(almond(f'v6_temporal_{sgn}', roof(0.15, sgn * 0.55) + UP * 0.02, D, 0.3, 0.1, 0.2, sgn * 0.3))
    cutters.append(almond(f'v6_nostril_{sgn}', roof(0.9, sgn * 0.45), D, 0.14, 0.045, 0.1, sgn * 0.2))
skull_obj = organic(finish(bm, 'v6_skull', BONE), 0.02, [('CLOUDS', 0.5, 0.04, 0.5), CRACKS, ERODE, FINE_CRACKS], smooth=1, cutters=cutters)

# Embers deep in the orbits: irregular, glowing in veins.
bm = bmesh.new()
for sgn in (-1, 1):
    ellipsoid(bm, roof(0.42, sgn * 1.0) - UP * 0.12, frame(D), (0.15, 0.09, 0.07), seg=(16, 10), wobble=0.45, seed=sgn * 7)
ember_obj = finish(bm, 'v6_embers', EMBER)
socket_marks = []
for sgn in (-1, 1):
    mark = bpy.data.objects.new(f'v6_socket_mark_{sgn}', None)
    mark.location = roof(0.42, sgn * 1.0) - UP * 0.12
    scene.collection.objects.link(mark); socket_marks.append(mark)
nodes, links = BONE.node_tree.nodes, BONE.node_tree.links
bsdf = nodes['Principled BSDF']
base_link = bsdf.inputs['Base Color'].links[0].from_socket
soot = None
for mark in socket_marks:
    tc = nodes.new('ShaderNodeTexCoord'); tc.object = mark
    length = nodes.new('ShaderNodeVectorMath'); length.operation = 'LENGTH'
    links.new(tc.outputs['Object'], length.inputs[0])
    fall = nodes.new('ShaderNodeMapRange')
    fall.inputs['From Min'].default_value = 0.1; fall.inputs['From Max'].default_value = 0.3
    fall.inputs['To Min'].default_value = 0.06; fall.inputs['To Max'].default_value = 1.0
    links.new(length.outputs['Value'], fall.inputs['Value'])
    if soot is None:
        soot = fall.outputs['Result']
    else:
        both = nodes.new('ShaderNodeMath'); both.operation = 'MINIMUM'
        links.new(soot, both.inputs[0]); links.new(fall.outputs['Result'], both.inputs[1]); soot = both.outputs['Value']
darken = nodes.new('ShaderNodeMix'); darken.data_type = 'RGBA'; darken.blend_type = 'MULTIPLY'; darken.inputs['Factor'].default_value = 1
links.new(base_link, darken.inputs['A'])
to_rgb = nodes.new('ShaderNodeCombineColor')
for ch in ('Red', 'Green', 'Blue'): links.new(soot, to_rgb.inputs[ch])
links.new(to_rgb.outputs['Color'], darken.inputs['B'])
links.new(darken.outputs['Result'], bsdf.inputs['Base Color'])
# Socket floor: dark flesh below the ember, so the hole never shows the ground.
bm = bmesh.new()
for sgn in (-1, 1):
    ellipsoid(bm, roof(0.42, sgn * 0.9) - UP * 0.22, frame(D), (0.24, 0.16, 0.1), wobble=0.2, seed=sgn * 2)
socket_obj = finish(bm, 'v6_socket_floor', weathered('v6_flesh', (0.05, 0.03, 0.04)))

# Teeth (irregular, some missing), lower jaw askew, horns.
bm = bmesh.new()
for k in range(10):
    f = 0.4 + k * 0.058
    wd = skull_profile(f)[0] * 0.86
    for sgn in (-1, 1):
        if rng.random() < 0.18: continue
        size = rng.uniform(0.75, 1.5)
        root = sk(f, sgn * wd, 0.1)
        tip = root + side * sgn * 0.05 - UP * 0.17 * size + D * rng.uniform(-0.04, 0.04)
        tube(bm, [root, root.lerp(tip, 0.5) + side * sgn * 0.02, tip], [0.04 * size, 0.028 * size, 0.004], seg=7, jag=0.02 if size < 0.9 else 0)
for sgn in (-1, 1):
    tube(bm, [sk(0.04, sgn * 0.44, 0.06), sk(0.45, sgn * 0.4, 0.03 + 0.02 * sgn), sk(0.8, sgn * 0.2, 0.02), sk(0.97, sgn * 0.06, 0.03)], [0.1, 0.085, 0.06, 0.04], seg=10, flat=0.7, wobble=0.02)
jaw_obj = organic(finish(bm, 'v6_jaw_teeth_horns', BONE), 0.016, [CRACKS, FINE_CRACKS], smooth=1)

# --- Stage -------------------------------------------------------------------------------------------
root = bpy.data.objects.new('v6_root', None); scene.collection.objects.link(root)
for obj in (spine_obj, ribs_obj, pelvis_obj, legs_obj, skull_obj, ember_obj, socket_obj, jaw_obj, *cutters, *socket_marks): obj.parent = root
g_mesh = bpy.data.meshes.new('v6_ground'); b = bmesh.new()
bmesh.ops.create_grid(b, x_segments=1, y_segments=1, size=8.0); b.to_mesh(g_mesh); b.free()
ground = bpy.data.objects.new('v6_ground', g_mesh); ground.is_shadow_catcher = True; scene.collection.objects.link(ground)
top_data = bpy.data.cameras.new('v6_top'); top_data.type = 'ORTHO'; top_data.ortho_scale = 8.0
top = bpy.data.objects.new('v6_top', top_data); top.location = (0, 0, 10); scene.collection.objects.link(top); scene.camera = top
obl_data = bpy.data.cameras.new('v6_oblique'); obl_data.lens = 50
obl = bpy.data.objects.new('v6_oblique', obl_data); scene.collection.objects.link(obl)
sun_data = bpy.data.lights.new('v6_sun', 'SUN'); sun_data.energy = 3.2; sun_data.angle = math.radians(6)
sun = bpy.data.objects.new('v6_sun', sun_data); sun.rotation_euler = (math.radians(40), 0, math.radians(45)); scene.collection.objects.link(sun)
scene.world = bpy.data.worlds.get('relief_world')
scene.render.engine = 'CYCLES'; scene.cycles.device = 'GPU'; scene.cycles.samples = 64; scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
bpy.context.window.scene = scene
result = {'length': round(LENGTH, 2), 'ribs': len(rib_at), 'pelvis_s': round(PELVIS, 2), 'skull_len': round(L, 2)}
