"""Kabummtula (kaboomtula): a creepy black-violet tarantula with a swollen, vein-lit bomb abdomen.

Seen from straight above and facing north: a low domed cephalothorax with an ocular tubercle of
eight eyes, two bulbous chelicerae with folded fangs and short pedipalps in front, eight thick
segmented legs arching from the carapace margin with their knees high, and behind a narrow pedicel
a taut, swollen abdomen whose void-violet veins and dorsal heart line glow like a lit fuse.

z = 0 is the ground; the tarsi rest on it. Parts for kaboomtula_motion_v2: `carriage` (whole
animal, real leap height), the `vein_glow` emission socket (rest strength `vein_glow_rest`) and the rig: `body` (cephalothorax),
`abdomen`, `chelicera_l/r` with `fang_l/r`, `palp_l/r_femur/tibia` and per leg
`leg_<l|r><1..4>_femur/tibia/tarsus` (1 = front .. 4 = rear). Every bone rolls its Z axis up, so
Euler Z is a yaw seen from the camera and Euler X lifts the bone's tip.
The four corner contact meshes `<corner> broad paw (...)` join the tarsi of legs 1+2 (front) and
3+4 (rear) of one side; each tarsus keeps its own rigid bone.
Sockets: eyeLeft/eyeRight (anterior median eyes) plus three extra pairs, and `mouth` (between
the fangs, the web spit origin).
"""
import math
import random
import bpy
from mathutils import Matrix, Vector
from rigs_v2 import control
from eye_anchors import register_eye
from recipes_v2.enemy_parts_a import smooth_path, outward_normals, horn, ell
from kraken_skin_v8 import linear, skin, paint_pattern, write_rest
from kraken_eye_parts import cap, glossy_material, frame
from kraken_dorsal_parts import fuse
from kraken_arm_parts import bind, smoothstep

SIDES = (('l', -1), ('r', 1))
SEGMENTS = ('femur', 'tibia', 'tarsus')
CORNERS = (('front_left', 'l', (1, 2)), ('front_right', 'r', (1, 2)),
           ('rear_left', 'l', (3, 4)), ('rear_right', 'r', (3, 4)))
# Front to rear: y, half width, underside z, dome height. A low round carapace, narrower head.
CARAPACE = [
    (1.00, .05, .33, .03),
    (0.96, .24, .30, .12),
    (0.88, .34, .28, .18),
    (0.74, .41, .27, .22),
    (0.56, .45, .27, .24),
    (0.38, .45, .27, .23),
    (0.20, .40, .28, .20),
    (0.07, .30, .29, .14),
    (-0.01, .15, .31, .07),
    (-0.05, .03, .33, .02),
]
FOVEA = (0, .36)
# The taut bomb abdomen behind the pedicel (scaled by model.abdomenScale).
ABDOMEN = [
    (-0.02, .12, .30, .08),
    (-0.10, .30, .24, .20),
    (-0.22, .46, .20, .32),
    (-0.40, .56, .17, .41),
    (-0.62, .60, .16, .45),
    (-0.86, .58, .16, .44),
    (-1.08, .50, .17, .39),
    (-1.26, .36, .20, .29),
    (-1.38, .18, .23, .16),
    (-1.44, .04, .26, .05),
]
# Right-side legs (mirrored): carapace root, high knee, ankle, tarsus tip on the ground.
LEGS = [
    dict(root=(.30, .80, .30), knee=(.80, 1.02, .66), ankle=(.98, 1.50, .40), tip=(1.02, 1.95, .06)),
    dict(root=(.40, .60, .30), knee=(1.00, .74, .64), ankle=(1.40, 1.06, .38), tip=(1.62, 1.30, .06)),
    dict(root=(.42, .36, .30), knee=(1.00, .30, .62), ankle=(1.40, .00, .36), tip=(1.62, -.24, .06)),
    dict(root=(.32, .14, .30), knee=(.86, -.16, .66), ankle=(1.10, -.74, .40), tip=(1.20, -1.30, .06)),
]
LEG_RADII = dict(femur=(.118, .130, .108), knee=.110, tibia=(.104, .090), tarsus=(.084, .064, .044))
# Coarse setae per BU of segment length; spike length and base radius in BU.
SETAE = dict(density=80, length=.085, radius=.011)
PALP = dict(root=(.24, .92, .30), knee=(.38, 1.16, .44), tip=(.40, 1.44, .06))
CHELICERA = dict(centre=(.115, 1.05, .33), scale=(.12, .20, .13))
# Eye cluster on the ocular tubercle: pair -> (x, y, radius, look yaw, look pitch), right side.
TUBERCLE = (0, .84)
EYES = {
    0: (.045, .055, .040, 14, 52),   # anterior median: the big forward pair
    1: (.108, .060, .030, 62, 28),   # anterior lateral
    2: (.040, -.025, .026, 22, 72),  # posterior median
    3: (.108, -.040, .030, 112, 34), # posterior lateral
}
# Black-violet palettes: no red (telegraphs only) and no yellow. dark/light/rim are the setae
# value plan; `band` brightens the joint rings, `fringe` the pale hair rim; `skin` is the abdomen.
PALETTES = {
    'void': dict(dark='#0c0910', light='#2d2338', rim='#8a76a0', band=.55, fringe=.45, chitin='#433653',
                 skin_dark='#0d0812', skin_light='#2a1d36', skin_rim='#6f5a86'),
    'cobalt': dict(dark='#090a12', light='#222a46', rim='#6f7cb0', band=.25, fringe=.55, chitin='#36406a',
                   skin_dark='#0b0a16', skin_light='#211d3c', skin_rim='#5b5f92'),
    'bone': dict(dark='#0b0a0d', light='#28232c', rim='#cfc4d9', band=.95, fringe=.30, chitin='#3e3743',
                 skin_dark='#0c090e', skin_light='#261d2c', skin_rim='#6c5f78'),
}
VOID = linear('#b347ff')
VOID_HOT = linear('#e2a8ff')
# Abdomen veins: the authored vessel map (texture family `veins`) or, without it, noise isolines on
# rest coordinates (main vessels + capillaries), stretched so the big vessels run lengthwise.
VEINS = {
    'web': dict(scale=2.0, stretch=.75, width=.028, fine=2.3, fineWidth=.013, finePeak=.45, distortion=.3, warp=.15,
                heart=.55, strength=2.2, textureScale=.55, textureLow=.035, textureHigh=.14),
}


def profile_rows(profile, steps=6):
    points, heights = smooth_path([(w, y, z) for y, w, z, _ in profile], [h for *_, h in profile], steps=steps)
    return [(p[1], p[0], p[2], h) for p, h in zip(points, heights)]


def sampler(rows):
    def section(y):
        if y >= rows[0][0]:
            return rows[0][1:]
        for (ya, *a), (yb, *b) in zip(rows, rows[1:]):
            if yb <= y <= ya:
                t = (ya - y) / ((ya - yb) or 1)
                return tuple(u + (v - u) * t for u, v in zip(a, b))
        return rows[-1][1:]
    return section


def dome(c, name, rows, material, exponent, belly=.30, sides=72):
    """Closed lofted shell: domed top, slightly flattened belly."""
    vertices, faces = [], []
    for y, w, z, h in rows:
        for j in range(sides):
            a = math.tau * j / sides
            s = math.sin(a)
            lift = h * s ** exponent if s > 0 else h * belly * s
            vertices.append((w * math.cos(a), y, z + lift))
    for i in range(len(rows) - 1):
        for j in range(sides):
            faces.append((i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j))
    faces.extend([tuple(range(sides - 1, -1, -1)), tuple((len(rows) - 1) * sides + j for j in range(sides))])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, mesh)
    c.scene.collection.objects.link(ob)
    return ob


def surface_of(section, exponent):
    def surface(x, y):
        w, z, h = section(y)
        crown = math.sqrt(max(0, 1 - (x / max(w, .01)) ** 2))
        return z + h * crown ** exponent
    return surface


def abdomen_rows(scale):
    """Swell the abdomen: wider and higher, a little longer, the belly closer to the ground."""
    rows = []
    for y, w, z, h in ABDOMEN:
        rows.append((-.02 + (y + .02) * (1 + (scale - 1) * .55), w * scale, z - .05 * (scale - 1), h * scale))
    return profile_rows(rows)


def setae(c, name, dark, light, rim, density, softness=.6, roughness=(.62, .80)):
    """Dense matte setae over chitin: the dermis plan retuned to short black-violet hair."""
    material = skin(c, name, linear(dark), linear(light), rim=linear(rim), softness=softness, roughness=roughness)
    nodes = material.node_tree.nodes
    bs = nodes['Principled BSDF']
    bs.inputs['Subsurface Weight'].default_value = .04
    nodes['Dermis density on rest pose'].inputs['Scale'].default_value = density
    tint = nodes['MS blue violet plum tint']
    tint.inputs[1].default_value = (.86, .84, 1.16, 1)
    tint.inputs[2].default_value = (1.12, .82, 1.18, 1)
    nodes['MS pigment tint strength'].inputs[1].default_value = .40
    nodes['MS cell strength'].inputs[1].default_value = .20
    nodes['Iridescent violet-teal sheen'].inputs[7].default_value = (*linear('#5a4a78'), 1)
    return material


def veins(c, material, style, centre_y):
    """Void-violet vessels and the dorsal heart line as emission colour; strength stays a socket."""
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bs = nodes['Principled BSDF']
    rest = nodes['Rest-pose skin coordinates'].outputs['Vector']

    def node(kind, label):
        out = nodes.new(kind)
        out.name = out.label = label
        return out

    def vector(op, a, b, label):
        out = node('ShaderNodeVectorMath', label)
        out.operation = op
        links.new(a, out.inputs[0])
        if isinstance(b, tuple):
            out.inputs[1].default_value = b
        else:
            links.new(b, out.inputs[1])
        return out.outputs[0]

    def value(op, a, b, label):
        out = node('ShaderNodeMath', label)
        out.operation = op
        for socket, v in zip(out.inputs, (a, b)):
            if isinstance(v, (int, float)):
                socket.default_value = v
            else:
                links.new(v, socket)
        return out.outputs[0]

    def line(distance, width, peak, label):
        out = node('ShaderNodeMapRange', label)
        out.interpolation_type = 'SMOOTHSTEP'
        out.clamp = True
        out.inputs['From Min'].default_value = 0
        out.inputs['From Max'].default_value = width
        out.inputs['To Min'].default_value = peak
        out.inputs['To Max'].default_value = 0
        links.new(distance, out.inputs['Value'])
        return out.outputs[0]

    centred = vector('SUBTRACT', rest, (0, centre_y, .30), 'Abdomen-centred rest coordinates')
    stretched = vector('MULTIPLY', centred, (1, style['stretch'], 1), 'Vessels run along the abdomen')
    texture = c.images.get('veins')
    if texture:
        # The authored vessel skin: its own folds for the hide, its bright vessels as the glow mask.
        nodes['Authored dermis folds'].image = texture
        nodes['Dermis density on rest pose'].inputs['Scale'].default_value = style['textureScale']
        sample = node('ShaderNodeTexImage', 'Authored vessel map')
        sample.image = texture
        sample.extension = 'REPEAT'
        sample.projection = 'BOX'
        sample.projection_blend = .35
        density = node('ShaderNodeVectorMath', 'Vessel map density')
        density.operation = 'SCALE'
        density.inputs['Scale'].default_value = style['textureScale']
        links.new(stretched, density.inputs[0])
        links.new(density.outputs[0], sample.inputs['Vector'])
        grey = node('ShaderNodeRGBToBW', 'Vessel brightness')
        links.new(sample.outputs['Color'], grey.inputs[0])
        mask = node('ShaderNodeMapRange', 'Vessel glow mask')
        mask.interpolation_type = 'SMOOTHSTEP'
        mask.clamp = True
        mask.inputs['From Min'].default_value = style['textureLow']
        mask.inputs['From Max'].default_value = style['textureHigh']
        links.new(grey.outputs[0], mask.inputs['Value'])
        glow = mask.outputs[0]
    else:
        warp = node('ShaderNodeTexNoise', 'Vessel meander')
        warp.inputs['Scale'].default_value = 2.2
        warp.inputs['Detail'].default_value = 2
        links.new(stretched, warp.inputs['Vector'])
        bent = vector('SUBTRACT', warp.outputs['Color'], (.5, .5, .5), 'Centred meander')
        amplitude = node('ShaderNodeVectorMath', 'Meander amplitude')
        amplitude.operation = 'SCALE'
        amplitude.inputs['Scale'].default_value = style['warp']
        links.new(bent, amplitude.inputs[0])
        coords = vector('ADD', stretched, amplitude.outputs[0], 'Meandering vessel coordinates')
        # Vessels are noise isolines: continuous, meandering and joining like real vessels
        # (Voronoi edges would close into cells and read as cracks).
        vessels = []
        for label, scale, width, peak in (('Main vessels', style['scale'], style['width'], 1),
                                          ('Capillaries', style['scale'] * style['fine'], style['fineWidth'], style['finePeak'])):
            field = node('ShaderNodeTexNoise', label + ' field')
            field.inputs['Scale'].default_value = scale
            field.inputs['Detail'].default_value = 2
            field.inputs['Distortion'].default_value = style['distortion']
            links.new(coords, field.inputs['Vector'])
            contour = value('ABSOLUTE', value('SUBTRACT', field.outputs['Fac'], .5, label + ' centred'), 0, label + ' contour distance')
            vessels.append(line(contour, width, peak, label + ' line'))
        glow = value('MAXIMUM', vessels[0], vessels[1], 'Vessel glow')
    # Dorsal heart line: the real cardiac mark of a spider abdomen, here the fuse.
    split = node('ShaderNodeSeparateXYZ', 'Heart line axes')
    links.new(centred, split.inputs[0])
    across = value('ABSOLUTE', split.outputs['X'], 0, 'Distance from the dorsal midline')
    heart = line(across, .085, style['heart'], 'Dorsal heart line')
    length = node('ShaderNodeMapRange', 'Heart line length')
    length.interpolation_type = 'SMOOTHSTEP'
    length.inputs['From Min'].default_value = .62
    length.inputs['From Max'].default_value = .30
    length.inputs['To Min'].default_value = 0
    length.inputs['To Max'].default_value = 1
    distance = value('ABSOLUTE', split.outputs['Y'], 0, 'Distance from the abdomen centre')
    links.new(distance, length.inputs['Value'])
    heart = value('MULTIPLY', heart, length.outputs[0], 'Heart line on the back')
    top = value('MULTIPLY', split.outputs['Z'], 4, 'Heart on the dorsal side')
    heart = value('MULTIPLY', heart, value('MINIMUM', value('MAXIMUM', top, 0, 'Dorsal clamp'), 1, 'Dorsal mask'), 'Dorsal heart')
    glow = value('MAXIMUM', glow, heart, 'Veins and heart')
    # Vessels fade into the pedicel so the waist stays dark and readable.
    waist = node('ShaderNodeMapRange', 'Dark pedicel')
    waist.clamp = True
    waist.inputs['From Min'].default_value = -.12
    waist.inputs['From Max'].default_value = -.32
    axes = node('ShaderNodeSeparateXYZ', 'Rest axes')
    links.new(rest, axes.inputs[0])
    links.new(axes.outputs['Y'], waist.inputs['Value'])
    glow = value('MULTIPLY', glow, waist.outputs[0], 'Vessel glow without the pedicel')
    hot = node('ShaderNodeMix', 'Void vessel colour')
    hot.data_type = 'RGBA'
    hot.inputs[6].default_value = (*VOID, 1)
    hot.inputs[7].default_value = (*VOID_HOT, 1)
    links.new(value('MULTIPLY', glow, glow, 'Hot vessel cores'), hot.inputs[0])
    emission = node('ShaderNodeMix', 'Vein emission colour')
    emission.data_type = 'RGBA'
    emission.inputs[6].default_value = (0, 0, 0, 1)
    links.new(glow, emission.inputs[0])
    links.new(hot.outputs[2], emission.inputs[7])
    links.new(emission.outputs[2], bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value = style['strength']
    # The taut skin around the vessels turns violet even where it does not glow.
    base = bs.inputs['Base Color'].links[0].from_socket
    tinted = node('ShaderNodeMix', 'Vessel-tinted skin')
    tinted.data_type = 'RGBA'
    links.new(value('MULTIPLY', glow, .25, 'Vessel tint'), tinted.inputs[0])
    links.new(base, tinted.inputs[6])
    tinted.inputs[7].default_value = (*linear('#3c1660'), 1)
    links.new(tinted.outputs[2], bs.inputs['Base Color'])
    bs.inputs['Subsurface Weight'].default_value = .14
    bs.inputs['Subsurface Radius'].default_value = (.8, .3, 1.0)
    return bs.inputs['Emission Strength']


def leg_points(spec, side, reach, knee):
    root = Vector(spec['root'])
    out = []
    for name in ('root', 'knee', 'ankle', 'tip'):
        p = Vector(spec[name])
        d = p - root
        q = Vector((root.x + d.x * reach, root.y + d.y * reach, p.z))
        if name == 'knee':
            q.z = p.z * knee
        elif name == 'ankle':
            q.z = p.z * (1 + (knee - 1) * .5)
        out.append(Vector((side * q.x, q.y, q.z)))
    return out


def arc(a, b, lift, count=4):
    """Points from a to b bulging upwards by `lift` (setae-covered segments are slightly bowed)."""
    return [tuple(a + (b - a) * (k / (count - 1)) + Vector((0, 0, lift * math.sin(math.pi * k / (count - 1)))))
            for k in range(count)]


def fringe(c, name, points, radii, material, seed, density=None, length=None, lean=.65):
    """Coarse tarantula setae: thin three-sided spikes over a horn path, leaning distally.

    Lateral and dorsal spikes break the tube outline into a soft hairy fringe; none point down.
    """
    density = density or SETAE['density']
    length = length or SETAE['length']
    path, rad = smooth_path(points, radii)
    path = [Vector(p) for p in path]
    arcs = [0]
    for a, b in zip(path, path[1:]):
        arcs.append(arcs[-1] + (b - a).length)
    rng = random.Random(seed)
    vertices, faces = [], []
    for _ in range(max(6, round(arcs[-1] * density))):
        s = rng.random() * arcs[-1]
        k = max(0, min(len(path) - 2, next(i for i in range(len(arcs) - 1) if arcs[i + 1] >= s)))
        t = (s - arcs[k]) / max(arcs[k + 1] - arcs[k], 1e-8)
        p = path[k].lerp(path[k + 1], t)
        r = rad[k] + (rad[k + 1] - rad[k]) * t
        tangent = (path[k + 1] - path[k]).normalized()
        lateral = tangent.cross(Vector((0, 0, 1)))
        lateral = lateral.normalized() if lateral.length > 1e-6 else Vector((1, 0, 0))
        dorsal = lateral.cross(tangent).normalized()
        a = rng.uniform(-.35, math.pi + .35)  # lateral .. over the top .. other lateral
        out = lateral * math.cos(a) + dorsal * math.sin(a)
        base = p + out * r * .82
        axis = (out + tangent * lean).normalized()
        tip = base + axis * length * rng.uniform(.6, 1.25)
        side = axis.cross(tangent if abs(axis.dot(tangent)) < .95 else Vector((0, 0, 1))).normalized()
        other = axis.cross(side).normalized()
        w = SETAE['radius'] * rng.uniform(.8, 1.2)
        i = len(vertices)
        for q in range(3):
            angle = math.tau * q / 3
            vertices.append(tuple(base + (side * math.cos(angle) + other * math.sin(angle)) * w))
        vertices.append(tuple(tip))
        faces += [(i, i + 1, i + 3), (i + 1, i + 2, i + 3), (i + 2, i, i + 3), (i + 2, i + 1, i)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh)
    c.scene.collection.objects.link(ob)
    return ob


def paint_limb(ob, joints, palette):
    """Dark setae with pale joint rings (patella, metatarsus) and a soft pale hair fringe."""
    lengths, total = [], 0
    for a, b in zip(joints, joints[1:]):
        lengths.append(total)
        total += (b - a).length
    rings = [lengths[1], lengths[2]] if len(lengths) > 2 else [lengths[-1]]

    def along(p):
        best, position = 9, 0
        for start, a, b in zip(lengths, joints, joints[1:]):
            seg = b - a
            t = max(0, min(1, (p - a).dot(seg) / max(seg.length_squared, 1e-8)))
            d = (a + seg * t - p).length
            if d < best:
                best, position = d, start + t * seg.length
        return position

    def sample(p, n):
        s = along(p)
        band = max(math.exp(-((s - r - .05) / .055) ** 2) for r in rings)
        fringe = smoothstep(.55, .05, n.z)
        return .30 + .25 * smoothstep(.2, .9, n.z), max(palette['band'] * band, palette['fringe'] * fringe), .55
    paint_pattern(ob, sample)


def build_leg(c, name, points, radii, material, palette):
    """Femur (with coxa), tibia (with patella) and tarsus (with metatarsus): rigid segments."""
    root, knee, ankle, tip = points
    seed = sum(ord(ch) for ch in name)
    femur_path, femur_radii = arc(root, knee, .04), list(radii['femur']) + [radii['femur'][-1]]
    tibia_path, tibia_radii = arc(knee, ankle, .03, 3), list(radii['tibia']) + [radii['tibia'][-1]]
    tarsus_path, tarsus_radii = arc(ankle, tip, .02), list(radii['tarsus']) + [radii['tarsus'][-1]]
    femur = horn(c, f'{name} femur', femur_path, femur_radii, material, sides=14)
    kneecap = ell(c, f'{name} patella', tuple(knee), (radii['knee'],) * 3, material)
    tibia = horn(c, f'{name} tibia', tibia_path, tibia_radii, material, sides=14)
    ankle_ball = ell(c, f'{name} metatarsal joint', tuple(ankle), (radii['tibia'][-1] * .95,) * 3, material)
    tarsus = horn(c, f'{name} tarsus', tarsus_path, tarsus_radii, material, sides=14)
    end = radii['tarsus'][-1]
    pad = ell(c, f'{name} scopula', tuple(tip + Vector((0, 0, .004))), (end * 1.05, end * 1.25, end * .85), material)
    parts = dict(femur=[femur, fringe(c, f'{name} femur setae', femur_path, femur_radii, material, seed)],
                 tibia=[kneecap, tibia, fringe(c, f'{name} tibia setae', tibia_path, tibia_radii, material, seed + 1)],
                 tarsus=[ankle_ball, tarsus, pad, fringe(c, f'{name} tarsus setae', tarsus_path, tarsus_radii, material,
                                                         seed + 2, length=SETAE['length'] * .75)])
    for objects in parts.values():
        for ob in objects:
            paint_limb(ob, points, palette)
            write_rest(ob)
            c.paint_form_mask(ob, lambda p: .60 + .40 * max(0, min(1, p.z / .6)))
    return parts


def join(objects, name):
    """Join meshes (vertex order follows `objects`); returns the mesh and its vertex counts."""
    bpy.context.view_layer.update()
    counts = []
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.convert(target='MESH')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        counts.append(len(ob.data.vertices))
        ob.select_set(False)
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    out.name = name
    return out, counts


def eye_cluster(c, surface, mats, eye_scale):
    """Eight eyes on the ocular tubercle: glossy domes with void-violet lenses facing outwards."""
    tx, ty = TUBERCLE
    objects = []
    for pair, (ex, ey, er, yaw, pitch) in EYES.items():
        for _, side in SIDES:
            x, y, r = tx + side * ex * eye_scale, ty + ey * eye_scale, er * eye_scale
            centre = Vector((x, y, surface(x, y) + r * .25))
            yaw_r, pitch_r = math.radians(yaw), math.radians(pitch)
            look = Vector((side * math.sin(yaw_r) * math.cos(pitch_r), math.cos(yaw_r) * math.cos(pitch_r), math.sin(pitch_r)))
            f, right, up = frame(look)
            label = f'{"Left" if side < 0 else "Right"} eye {pair}'
            ball = c.ell(label + ' glossy dome', tuple(centre), (r, r, r), mats['eyeball'])
            lens = cap(c, label + ' void lens', centre, r * 1.015, f, right, up, math.radians(58), mats['lens'])
            register_eye(c, side, lens, pair=pair)
            objects += [ball, lens]
    return objects


def build(c, spec):
    draft = spec.get('draft') or {}
    model = spec.get('model') or {}
    swell = model.get('abdomenScale', 1)
    reach, knee_height = model.get('legReach', 1), model.get('kneeHeight', 1)
    thickness, eye_scale = model.get('legThickness', 1), model.get('eyeScale', 1)
    palette = PALETTES[model.get('palette', 'void')]
    style = VEINS[model.get('veins', 'web')]

    hair = setae(c, 'Kabummtula black-violet setae', palette['dark'], palette['light'], palette['rim'], 1.15)
    chitin = setae(c, 'Kabummtula velvet carapace', palette['dark'], palette['chitin'], palette['rim'], 1.6,
                   softness=.45, roughness=(.56, .72))
    limb_hair = setae(c, 'Kabummtula banded leg setae', palette['dark'], palette['light'], palette['rim'], 1.35)
    hide = skin(c, 'Kabummtula taut bomb abdomen', linear(palette['skin_dark']), linear(palette['skin_light']),
                rim=linear(palette['skin_rim']), softness=.4, roughness=(.46, .60))
    mats = {
        'eyeball': glossy_material(c, 'Kabummtula glossy eye domes', linear('#0e0716'), roughness=.14),
        'lens': c.material('Kabummtula void eye lenses', linear('#8a3cf0'), emission=1.1),
        'fang': glossy_material(c, 'Kabummtula glossy black fangs', linear('#0b0710'), roughness=.30),
        'venom': c.material('Kabummtula void venom beads', VOID, emission=.8),
    }

    root = control(c.scene, 'Kabummtula fixed export pivot')
    carriage = control(c.scene, 'Kabummtula carriage (leap height)', parent=root)

    # Cephalothorax: carapace and ocular tubercle as one continuous chitin shell.
    cara_rows = profile_rows(CARAPACE)
    cara_section = sampler(cara_rows)
    cara_surface = surface_of(cara_section, .70)
    shell = dome(c, 'Kabummtula carapace', cara_rows, chitin, .70)
    tx, ty = TUBERCLE
    tubercle = ell(c, 'Kabummtula ocular tubercle', (tx, ty, cara_surface(tx, ty) - .02),
                   (.12 * eye_scale, .10 * eye_scale, .07), chitin)
    carapace = fuse(c, [shell, tubercle], chitin, voxel=.012 * draft.get('voxelScale', 1))
    carapace.name = 'Kabummtula continuous carapace and ocular tubercle'

    def paint_carapace(p, n):
        w, _, _ = cara_section(p.y)
        across = abs(p.x) / max(w, .05)
        dx, dy = p.x - FOVEA[0], (p.y - FOVEA[1]) * 1.1
        r = math.hypot(dx, dy)
        striae = abs(math.sin(math.atan2(dy, dx) * 4)) ** 8 * smoothstep(.06, .30, r)
        fovea = math.exp(-(r / .055) ** 2)
        margin = smoothstep(.70, .97, across)
        head = smoothstep(.55, .80, p.y) * (1 - margin)
        flank = (.50 + .25 * margin - .38 * striae - .12 * head) * (1 - .70 * fovea)
        return flank, palette['fringe'] * margin * 1.2, .75
    paint_pattern(carapace, paint_carapace)
    write_rest(carapace)
    c.paint_form_mask(carapace, lambda p: .58 + .42 * max(0, min(1, (p.z - .25) / .3)))

    top = lambda x, y: cara_surface(x, y) + .07 * math.exp(-((x - tx) ** 2 + (y - ty) ** 2) / (.11 * eye_scale) ** 2)
    eyes = eye_cluster(c, top, mats, eye_scale)

    # Abdomen behind a narrow pedicel.
    abd_rows = abdomen_rows(swell)
    abd_section = sampler(abd_rows)
    belly = dome(c, 'Kabummtula swollen abdomen', abd_rows, hide, .85, belly=.28, sides=96)
    pedicel = ell(c, 'Kabummtula pedicel', (0, -.04, .31), (.10, .10, .08), hide)
    centre_y = sum(r[0] for r in abd_rows) / len(abd_rows)
    tail_y = abd_rows[-1][0]
    spinnerets = [horn(c, 'Kabummtula spinneret', [(side * .07, tail_y + .10, .28), (side * .10, tail_y - .02, .25),
                                                    (side * .12, tail_y - .12, .20)], [.045, .040, .030], hide, sides=10)
                  for _, side in SIDES]
    abdomen = fuse(c, [belly, pedicel, *spinnerets], hide, voxel=.012 * draft.get('voxelScale', 1))
    abdomen.name = 'Kabummtula continuous bomb abdomen'

    def paint_abdomen(p, n):
        w, _, _ = abd_section(p.y)
        across = abs(p.x) / max(w, .05)
        return .30 + .30 * smoothstep(.4, .95, across), .45 * smoothstep(.55, .05, n.z), .7
    paint_pattern(abdomen, paint_abdomen)
    write_rest(abdomen)
    c.paint_form_mask(abdomen, lambda p: .55 + .45 * max(0, min(1, (p.z - .2) / .45)))
    vein_glow = veins(c, hide, style, centre_y)

    # Chelicerae with folded fangs, venom beads at the tips; pedipalps beside them.
    jaws = {}
    for key, side in SIDES:
        cx, cy, cz = CHELICERA['centre']
        chelicera = ell(c, f'Kabummtula {key} chelicera', (side * cx, cy, cz), CHELICERA['scale'], hair, taper=.25)
        chelicera.rotation_euler.x = -.22
        base = Vector((side * .12, 1.19, .22))
        fang_points = [tuple(base), tuple(base + Vector((-side * .05, .06, -.04))), tuple(base + Vector((-side * .12, .05, -.09)))]
        fang = horn(c, f'Kabummtula {key} fang', fang_points, [.040, .030, .012], mats['fang'], sides=12)
        venom = c.ell(f'Kabummtula {key} venom bead', fang_points[-1], (.018, .018, .018), mats['venom'])
        for ob in (chelicera,):
            paint_pattern(ob, lambda p, n: (.42, palette['fringe'] * .8 * smoothstep(.6, .1, n.z), .5))
            write_rest(ob)
            c.paint_form_mask(ob, lambda p: .7)
        jaws[key] = dict(chelicera=chelicera, fang=[fang, venom], base=base)
    palps = {}
    for key, side in SIDES:
        root_p, knee_p, tip_p = (Vector((side * x, y, z)) for x, y, z in (PALP['root'], PALP['knee'], PALP['tip']))
        femur_path, femur_radii = arc(root_p, knee_p, .03, 3), [.080 * thickness, .084 * thickness, .078 * thickness]
        tibia_path, tibia_radii = arc(knee_p, tip_p, .03, 3), [.074 * thickness, .066 * thickness, .058 * thickness]
        femur = horn(c, f'Kabummtula {key} palp femur', femur_path, femur_radii, hair, sides=12)
        joint = ell(c, f'Kabummtula {key} palp patella', tuple(knee_p), (.076 * thickness,) * 3, hair)
        tibia = horn(c, f'Kabummtula {key} palp tibia', tibia_path, tibia_radii, hair, sides=12)
        club = ell(c, f'Kabummtula {key} palp tarsus', tuple(tip_p + Vector((0, 0, .01))), (.062 * thickness, .080 * thickness, .048), hair)
        seed = 900 + side
        femur_setae = fringe(c, f'Kabummtula {key} palp femur setae', femur_path, femur_radii, hair, seed, length=SETAE['length'] * .8)
        tibia_setae = fringe(c, f'Kabummtula {key} palp tibia setae', tibia_path, tibia_radii, hair, seed + 1, length=SETAE['length'] * .8)
        for ob in (femur, joint, tibia, club, femur_setae, tibia_setae):
            paint_limb(ob, [root_p, knee_p, tip_p], palette)
            write_rest(ob)
            c.paint_form_mask(ob, lambda p: .65)
        palps[key] = dict(points=(root_p, knee_p, tip_p), femur=[femur, femur_setae], tibia=[joint, tibia, club, tibia_setae])

    radii = {k: (tuple(r * thickness for r in v) if isinstance(v, tuple) else v * thickness) for k, v in LEG_RADII.items()}
    legs = {}
    for key, side in SIDES:
        for n, leg in enumerate(LEGS, 1):
            points = leg_points(leg, side, reach, knee_height)
            legs[f'{key}{n}'] = dict(points=points, **build_leg(c, f'Kabummtula leg {key}{n}', points, radii, limb_hair, palette))

    # Armature: every bone rolls its Z axis up, so Euler Z is a yaw seen from the camera.
    data = bpy.data.armatures.new('Kabummtula tarantula rig')
    rig = bpy.data.objects.new('Kabummtula rig', data)
    c.scene.collection.objects.link(rig)
    rig.parent = carriage
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    edit = data.edit_bones

    def bone(name, head, tail, parent=None, connect=False):
        b = edit.new(name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = edit[parent]
            b.use_connect = connect
        b.align_roll(Vector((0, 0, 1)))
        return b
    bone('root', (0, 0, 0), (0, .2, 0))
    bone('body', (0, .10, .40), (0, .80, .40), 'root')
    bone('abdomen', (0, -.04, .36), (0, tail_y + .2, .36), 'body')
    for key, side in SIDES:
        cx, cy, cz = CHELICERA['centre']
        bone(f'chelicera_{key}', (side * cx, .90, cz + .02), (side * cx, 1.22, cz - .02), 'body')
        base = jaws[key]['base']
        bone(f'fang_{key}', tuple(base), tuple(base + Vector((-side * .12, .02, -.04))), f'chelicera_{key}')
        root_p, knee_p, tip_p = palps[key]['points']
        bone(f'palp_{key}_femur', tuple(root_p), tuple(knee_p), 'body')
        bone(f'palp_{key}_tibia', tuple(knee_p), tuple(tip_p), f'palp_{key}_femur', connect=True)
        for n in range(1, 5):
            root_l, knee_l, ankle_l, tip_l = legs[f'{key}{n}']['points']
            bone(f'leg_{key}{n}_femur', tuple(root_l), tuple(knee_l), 'body')
            bone(f'leg_{key}{n}_tibia', tuple(knee_l), tuple(ankle_l), f'leg_{key}{n}_femur', connect=True)
            bone(f'leg_{key}{n}_tarsus', tuple(ankle_l), tuple(tip_l), f'leg_{key}{n}_tibia', connect=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    for b in rig.pose.bones:
        b.rotation_mode = 'XYZ'

    def rigid(ob, name, group=None):
        ob.parent = carriage
        bind(ob, rig, [[(name, 1)]] * len(ob.data.vertices))
        if group:
            ob['meshUnionGroup'] = group

    rigid(carapace, 'body')
    for ob in eyes:
        rigid(ob, 'body')
    rigid(abdomen, 'abdomen', 'abdomen')
    for key, _ in SIDES:
        rigid(jaws[key]['chelicera'], f'chelicera_{key}', f'chelicera-{key}')
        for ob in jaws[key]['fang']:
            rigid(ob, f'fang_{key}', f'fang-{key}')
        for segment in ('femur', 'tibia'):
            for ob in palps[key][segment]:
                rigid(ob, f'palp_{key}_{segment}', f'palp-{key}-{segment}')
        for n in range(1, 5):
            for segment in ('femur', 'tibia'):
                for ob in legs[f'{key}{n}'][segment]:
                    rigid(ob, f'leg_{key}{n}_{segment}', f'leg-{key}{n}-{segment}')
    # Corner contacts: one authored paw mesh per corner joins the tarsi of two legs; every
    # tarsus keeps its own rigid bone through its vertex range.
    for corner, key, (a, b) in CORNERS:
        pieces = legs[f'{key}{a}']['tarsus'] + legs[f'{key}{b}']['tarsus']
        paw, counts = join(pieces, f'{corner} broad paw (tarsi {a}+{b})')
        split = sum(counts[:len(legs[f'{key}{a}']['tarsus'])])
        paw.parent = carriage
        bind(paw, rig, [[(f'leg_{key}{a if i < split else b}_tarsus', 1)] for i in range(len(paw.data.vertices))])
        paw['meshUnionGroup'] = f'tarsi-{corner}'

    bpy.context.view_layer.update()
    sockets = {}
    rest = rig.data.bones['body']
    mouth = control(c.scene, 'Kabummtula mouth socket')
    mouth.parent, mouth.parent_type, mouth.parent_bone = rig, 'BONE', 'body'
    mouth.matrix_parent_inverse = (rest.matrix_local @ Matrix.Translation((0, rest.length, 0))).inverted()
    mouth.location = (0, 1.30, .20)
    sockets['mouth'] = mouth
    return {'root': root, 'parts': {'carriage': carriage, 'vein_glow': vein_glow, 'vein_glow_rest': style['strength'],
                                    'spider_legs': [f'{key}{n}' for key, _ in SIDES for n in range(1, 5)]},
            'rig': rig, 'sockets': sockets}
