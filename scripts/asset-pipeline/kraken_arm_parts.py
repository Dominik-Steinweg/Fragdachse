"""Kraken V8 arms: sunk and flared roots, muscle segmentation, ventral cups, creased skin
and rigged webbing between neighbouring arms, so the crown reads as one organism."""
import math
import random
import bpy
from mathutils import Vector, noise
from recipes_v2.enemy_parts_a import smooth_path, outward_normals
from kraken_skin_v8 import write_rest

CHAIN = 16


def smoothstep(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def crease_texture(name, scale):
    """Voronoi F2-F1: raised cells with sunken borders, i.e. creased living skin."""
    tex = bpy.data.textures.get(name) or bpy.data.textures.new(name, 'VORONOI')
    tex.distance_metric = 'DISTANCE'
    tex.weight_1, tex.weight_2, tex.weight_3, tex.weight_4 = -1, 1, 0, 0
    tex.noise_scale = scale
    tex.noise_intensity = 1.6
    return tex


def creases(ob, scale, strength, subdivide=0, group=None):
    """Rest-pose displacement; must precede the armature modifier in the stack."""
    if subdivide:
        sub = ob.modifiers.new('Skin resolution', 'SUBSURF')
        sub.levels = sub.render_levels = subdivide
    mod = ob.modifiers.new('Creased living skin', 'DISPLACE')
    mod.texture = crease_texture(f'Kraken crease {scale:.3f}', scale)
    mod.texture_coords = 'LOCAL'
    mod.strength, mod.mid_level = strength, .35
    if group:
        mod.vertex_group = group
    return mod


def arm_curve(base, heading, length, bend, turns, curl_length, side=1, z=(.40, .18, .42), samples=40, sink=.35):
    """Arm centre line: steady sweep, then a tightening spiral at the tip (degrees, BU).

    Right-side parameters; `side` mirrors in X. The root is sunk `sink` BU back into the head.
    """
    h = math.radians(heading)
    x, y = base
    ds = length / samples
    k0 = math.radians(bend) / length
    points = [(side * (x - math.cos(h) * sink), y - math.sin(h) * sink, z[0] + .05)]
    for i in range(samples + 1):
        s = i * ds
        t = s / length
        zt = z[0] + (z[1] - z[0]) * smoothstep(0, .45, t) + (z[2] - z[1]) * smoothstep(.62, 1, t)
        points.append((side * x, y, zt))
        curl = max(0, min(1, (s - (length - curl_length)) / curl_length))
        h += (k0 - 2 * math.tau * turns / curl_length * curl) * ds
        x += math.cos(h) * ds
        y += math.sin(h) * ds
    return points


def arm(c, index, points, width, materials, flare_amount=.45, steps=16, taper=.45, flatten=(1.25, .78),
        twist=(0, 0), side=1, cup_step=2, rows=(-40, 0, 40)):
    """One mesh per arm incl. ventral cups; chain weights; returns (object, centres, radii, weights).

    The cross-section is a flattened oval rolled by `twist` (root, tip degrees; positive rolls the
    ventral side towards the arm's right) so the pale underside and cups show at the curl.
    """
    n = len(points)
    centers, radii = smooth_path(points, [width * (1 - i / (n - 1)) ** taper + .014 for i in range(n)], steps=steps)
    vertices, faces, slots, weights, pattern = [], [], [], [], []
    sides = 44
    hx, hz = flatten

    def vertex(p, t, plan):
        vertices.append(tuple(p)); weights.append(t); pattern.append(plan)

    def face(indices, slot):
        faces.append(indices); slots.append(slot)

    frames = []
    count = len(centers)
    for i, point in enumerate(centers):
        tangent = (Vector(centers[min(i + 1, count - 1)]) - Vector(centers[max(0, i - 1)])).normalized()
        cross = Vector((-tangent.y, tangent.x, 0)).normalized()
        normal = tangent.cross(cross).normalized()
        t = i / (count - 1)
        roll = math.radians(twist[0] + (twist[1] - twist[0]) * smoothstep(.45, .92, t)) * side
        cross, normal = cross * math.cos(roll) + normal * math.sin(roll), normal * math.cos(roll) - cross * math.sin(roll)
        frames.append((tangent, cross, normal))
        flare = 1 + flare_amount * math.exp(-(t / .07) ** 2)  # root swells into the shoulder
        rings = 1 - .035 * (.5 + .5 * math.cos(math.tau * i / 3.2)) * smoothstep(.06, .14, t)
        for j in range(sides):
            angle = math.tau * j / sides
            s = math.sin(angle)
            top = max(0, s)
            groove = top * .04 * math.cos(angle * 3)
            radial = radii[i] * flare * rings * (1 + groove)
            stripe = 1 - .85 * top ** 1.3
            flank = stripe + (.75 - stripe) * (1 - smoothstep(.05, .22, t))
            belly = smoothstep(-.15, -.65, s)  # pale ventral skin and web side
            vertex(Vector(point) + radial * (math.cos(angle) * hx * cross + s * hz * normal), t,
                   (flank * (.80 + .20 * t), belly, abs(math.cos(angle)) * (1 - belly)))
    for i in range(count - 1):
        for j in range(sides):
            face((i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j), 0)
    face(tuple(range(sides - 1, -1, -1)), 0)
    face(tuple((count - 1) * sides + j for j in range(sides)), 0)
    # Three staggered ventral cup rows; distal cups shrink with the arm.
    for i in range(max(3, int(count * .06)), count - 3, cup_step):
        tangent, cross, up = frames[i]
        radius = radii[i]
        for k, row in enumerate(rows):
            if (i // cup_step + k) % 2 and row != 0:
                continue
            a = math.radians(-90 + row)
            normal = (cross * math.cos(a) * hx + up * math.sin(a) * hz)
            surface = Vector(centers[i]) + normal * radius * .97
            normal.normalize()
            across = tangent.cross(normal).normalized()
            r = radius * (.26 if row else .30)
            start = len(vertices); segments = 14
            for scale, height in [(1.10, 0), (1, .045), (.66, .060), (.46, .018), (.30, .012)]:
                for j in range(segments):
                    b = math.tau * j / segments
                    vertex(surface + normal * height * (radius / .22) + r * scale * (math.cos(b) * tangent + math.sin(b) * across),
                           i / (count - 1), (1, 1, 0))
            for q in range(4):
                for j in range(segments):
                    face((start + q * segments + j, start + q * segments + (j + 1) % segments,
                          start + (q + 1) * segments + (j + 1) % segments, start + (q + 1) * segments + j), 1 if q < 2 else 2)
            face(tuple(start + 4 * segments + j for j in range(segments)), 2)
    mesh = bpy.data.meshes.new(f'Kraken V8 arm {index + 1}')
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    for material in materials:
        mesh.materials.append(material)
    for polygon, slot in zip(mesh.polygons, slots):
        polygon.material_index = slot; polygon.use_smooth = True
    attr = mesh.color_attributes.new(name='FD_Pattern', type='FLOAT_COLOR', domain='POINT')
    for value, plan in zip(attr.data, pattern):
        value.color = (*plan, 1)
    ob = bpy.data.objects.new(mesh.name, mesh)
    c.scene.collection.objects.link(ob)
    ob['motionRole'] = 'tentacle'; ob['tentacleIndex'] = index
    # Scales only on the dorsal skin; the pale underside stays smooth and fleshy.
    group = ob.vertex_groups.new(name='Dorsal scales')
    for v, plan in enumerate(pattern):
        if plan[1] < .5:
            group.add([v], 1 - plan[1], 'REPLACE')
    write_rest(ob)
    c.paint_form_mask(ob, lambda p: .70 + .30 * max(0, min(1, p.z + .2)))
    return ob, centers, radii, weights


def bind(ob, rig, weights_per_vertex):
    """weights_per_vertex: list of [(bone_name, weight), ...]; adds the armature last."""
    groups = {}
    for v, pairs in enumerate(weights_per_vertex):
        for name, weight in pairs:
            if weight <= 0:
                continue
            group = groups.get(name) or ob.vertex_groups.new(name=name)
            groups[name] = group
            group.add([v], weight, 'ADD')
    modifier = ob.modifiers.new('Smooth muscular tentacle skin', 'ARMATURE')
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    return modifier


def chain_weights(chain, t):
    count = len(chain)
    position = max(0, min(count - 1, t * count - .5))
    a = int(position); b = min(count - 1, a + 1); blend = position - a
    return [(chain[a], 1 - blend)] + ([(chain[b], blend)] if b != a and blend > 0 else [])


def web(c, name, arm_a, arm_b, chain_a, chain_b, material, reach=.66, rows=30, cols=24):
    """A curved, tensioned membrane with buried insertions and a concave free edge.

    Retraction follows each arm's centre line, so the edge and its skin weights
    refer to the same longitudinal position even when neighbouring arms flex.
    """
    (centers_a, radii_a), (centers_b, radii_b) = arm_a, arm_b
    vertices, faces, bones, pattern = [], [], [], []
    na, nb = len(centers_a) - 1, len(centers_b) - 1
    def sample(centers, radii, t):
        f = t * (len(centers) - 1)
        i = min(len(centers) - 2, int(f))
        blend = f - i
        return Vector(centers[i]).lerp(Vector(centers[i + 1]), blend), radii[i] * (1 - blend) + radii[i + 1] * blend

    for k in range(rows + 1):
        u = k / rows
        for j in range(cols + 1):
            s = j / cols
            bulge = 4 * s * (1 - s)
            t = .015 + (reach * (1 - .46 * math.sin(math.pi * s) ** .85)) * u
            ca, ra = sample(centers_a, radii_a, t)
            cb, rb = sample(centers_b, radii_b, t)
            toward = cb - ca
            toward.z = 0
            toward.normalize()
            # Insert into the curved medial flank, below its visible upper skin.
            # Broad folds lift away from that insertion instead of a straight seam.
            pa = ca + toward * ra * .70 + Vector((0, 0, ra * .42))
            pb = cb - toward * rb * .70 + Vector((0, 0, rb * .42))
            span = (pb - pa).length
            p = pa.lerp(pb, s)
            p.z -= min(.19, span * .13) * bulge
            p.z += .024 * math.sin(s * math.pi * 5 + u * 1.7) * bulge * math.sin(math.pi * u)
            vertices.append(tuple(p))
            bones.append([(bone, w * (1 - s)) for bone, w in chain_weights(chain_a, t)] +
                         [(bone, w * s) for bone, w in chain_weights(chain_b, t)])
            edge = smoothstep(.86, 1, u)
            # Dark where the web roots into arms and mantle, pale only across the open membrane.
            pattern.append((.56 + .12 * bulge, (.36 + .28 * edge) * bulge * smoothstep(0, .30, u), .25))
    for k in range(rows):
        for j in range(cols):
            a = k * (cols + 1) + j
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    outward_normals(data)
    data.materials.append(material)
    for polygon in data.polygons:
        polygon.use_smooth = True
    attr = data.color_attributes.new(name='FD_Pattern', type='FLOAT_COLOR', domain='POINT')
    for value, plan in zip(attr.data, pattern):
        value.color = (*plan, 1)
    ob = bpy.data.objects.new(name, data)
    c.scene.collection.objects.link(ob)
    sub = ob.modifiers.new('Soft membrane folds', 'SUBSURF')
    sub.levels = sub.render_levels = 1
    solid = ob.modifiers.new('Thick muscular webbing', 'SOLIDIFY')
    solid.thickness, solid.offset = .045, 0
    write_rest(ob)
    c.paint_form_mask(ob, lambda p: .65)
    ob['motionRole'] = 'webbing'
    return ob, bones
