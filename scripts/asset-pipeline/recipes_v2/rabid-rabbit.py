"""Rabid Rabbit (rabid-rabbit): a small, fast, feral hare that hunts players, seen from above (display 22).

A crouched, egg-shaped body, widest at the haunches, carries a lean head whose two long ears lie
flat back over the neck: from straight above they are the key recognition feature. The long hind
feet lie along the flanks, the forepaws sit under the chest. Fur is a matte value plan over the
painted fur-lock texture: dark dorsal saddle, lit flanks, a pale belly fur edge that keeps the
outline readable on dark ground, and a pale ring around each eye.

GA1 prototypes: `draft.formVariant` (a-d) and `draft.palette` select the form and colourway
(`--model-settings` writes spec.draft); the catalog `model.*` values are the defaults.
  a Feldhase: lean and long, long hind feet, long black-tipped ears laid flat back.
  b Wildkaninchen-Berserker: compact and hunched, short ears pointing forward, big hind feet,
    bared incisors under a pulled-back lip.
  c Raeudiger Zombie-Hase: bald mangy patches, a torn ear, a visible spine ridge.
  d Void-gezeichnet: a raised hackle crest along neck and spine, glowing veins in the ears.
Palettes: wild (agouti brown-grey), white (dirty white, bloodied muzzle), charcoal (black with
violet glow) and ash (grey-greenish). Red stays rare (telegraphs own it); no yellow.

z = 0 is the ground. Parts for rabid_rabbit_motion_v2: `carriage` (whole animal, real leap
height), optional `ear_glow` emission socket (rest strength `ear_glow_rest`) and the rig: `body`
(chest), `hips` (loin and rump, pivot mid-back), `head`, `jaw`, `ear_l`/`ear_r`, `tail`, per front
leg `<leg>_upper/_lower/_foot` and per rear leg `<leg>_thigh/_shin/_foot`. Every bone rolls its Z
axis up, so Euler Z is a yaw seen from the camera and Euler X lifts the bone's tip.
Feet are the authored paw meshes `<leg> broad paw ...` used by the enemy mesh contacts.
Sockets: eyeLeft/eyeRight (irises) and `mouth` (between the incisors, on the jaw).
"""
import math
import random
import bpy
from mathutils import Matrix, Vector
from rigs_v2 import control
from eye_anchors import register_eye
from recipes_v2.enemy_parts_a import smooth_path, outward_normals, horn, ell
from kraken_skin_v8 import linear, skin, paint_pattern, write_rest
from kraken_eye_parts import cap, lid_shell, glossy_material, frame
from kraken_dorsal_parts import fuse
from kraken_arm_parts import bind, smoothstep
from zombie_surface_parts import Surface, patch, oval, mesh_object

LEGS = ('front_left', 'front_right', 'rear_left', 'rear_right')
FRONT_SEGMENTS = ('upper', 'lower', 'foot')
REAR_SEGMENTS = ('thigh', 'shin', 'foot')
# Torso front to rear: y, half width, equator z, dome height (scaled by the form). A crouched
# rabbit is a round pear: narrow shoulders, the back arching highest over loin and haunches.
TORSO = [
    (0.92, .22, .58, .12),
    (0.78, .36, .52, .24),
    (0.58, .48, .46, .36),
    (0.34, .53, .41, .48),
    (0.06, .59, .38, .60),
    (-0.26, .67, .37, .72),
    (-0.58, .78, .37, .82),
    (-0.88, .82, .38, .84),
    (-1.14, .70, .40, .72),
    (-1.32, .45, .42, .52),
    (-1.44, .18, .45, .26),
    (-1.48, .04, .47, .05),
]
NECK = .78  # torso row the head grows from; head offsets are authored relative to it
FORMS = {
    'a': dict(length=1.04, width=.88, hump=0, headLength=1.0, headWidth=1.0, ear='back', earLength=1.50, earWidth=.22,
              earYaw=8, earBend=4, earTip=.24, footLength=1.12, footWidth=.95, footOut=.08, legThickness=.92,
              eyeScale=1.0, incisors=.8, tail='hare'),
    'b': dict(length=.94, width=1.0, hump=.16, headLength=.94, headWidth=1.10, ear='forward', earLength=.86, earWidth=.16,
              earYaw=18, earPitch=16, earBend=-8, earTip=.12, footLength=1.0, footWidth=1.30, footOut=.08, legThickness=1.15,
              eyeScale=1.05, incisors=1.7, snarl=True, tail='cotton'),
    'c': dict(length=.98, width=.95, hump=.05, headLength=.98, headWidth=1.02, ear='back', earLength=1.22, earWidth=.21,
              earYaw=10, earBend=6, earTip=.10, footLength=1.0, footWidth=1.0, footOut=.06, legThickness=.95,
              eyeScale=1.0, incisors=1.1, mange=True, tornEar=True, spine=True, tail='cotton'),
    'd': dict(length=1.0, width=.95, hump=.08, headLength=1.0, headWidth=1.02, ear='back', earLength=1.30, earWidth=.22,
              earYaw=9, earBend=5, earTip=.14, footLength=1.02, footWidth=1.0, footOut=.06, legThickness=1.0,
              eyeScale=1.05, incisors=1.0, crest=True, veins=True, tail='cotton'),
}
# Fur value plans. dark/light/rim drive the authored saddle -> flank -> pale fur edge; `saddle`
# darkens the dorsal stripe, `earTip` colours the ear ends, `skin` is bare (mangy) hide, `eye`
# the iris rings (core, bright, mid, dark) and `glow` the void vein colour (None: no veins).
PALETTES = {
    'wild': dict(dark='#261e17', light='#957c5f', rim='#d6c9ad', saddle=.55, ticking=.38, earTip='#0f0c0a', earBack='#a8977c',
                 earRim='#d6c9ae', tail='#2a211a', skin='#8a6f69', scab='#3a2120', claw='#16120f', nose='#3a2a28',
                 eye=('#c8f0b8', '#7fb872', '#2c4529', '#070c07'), eyeGlow=1.2, glow='#b347ff', blood=False),
    'white': dict(dark='#6f675b', light='#c8c0ae', rim='#e4dfd2', saddle=.22, ticking=.24, earTip='#6f655c', earBack='#ddd7cb',
                  earRim='#efeae0', tail='#e6e1d5', skin='#b39b93', scab='#5b3d3a', claw='#2a2420', nose='#4d3335',
                  eye=('#f4faff', '#c4daf2', '#62799a', '#141a26'), eyeGlow=1.4, glow='#b347ff', blood=True),
    'charcoal': dict(dark='#0d0b0f', light='#37323e', rim='#a093b8', saddle=.30, ticking=.20, earTip='#08070a', earBack='#4a4452',
                     earRim='#a493bd', tail='#4a4352', skin='#5d4f5c', scab='#1f1420', claw='#0b090c', nose='#2a2030',
                     eye=('#f6e2ff', '#c070ff', '#5d1aa6', '#14041f'), eyeGlow=2.2, glow='#b347ff', blood=False),
    'ash': dict(dark='#2c302a', light='#7c8372', rim='#bcc2ad', saddle=.30, ticking=.26, earTip='#141612', earBack='#959b8b',
                earRim='#c7ccb8', tail='#c3c7b6', skin='#7a7466', scab='#2c2a22', claw='#141512', nose='#38362f',
                eye=('#d6f2dc', '#8cc49c', '#334d3b', '#080e0a'), eyeGlow=1.2, glow='#b347ff', blood=False),
}
# Ear carriage overrides (`draft.earPose`): yaw from straight back, extra outward bend along the
# ear and how far the held-out ear may sag below its root. `back` lies on the neck (form default),
# `wide` spreads a V past the shoulders, `side` holds the ears out sideways ("airplane" ears), so
# they break the body outline from above.
EAR_POSES = {'wide': dict(earYaw=30, earBend=10, droop=.24), 'mid': dict(earYaw=46, earBend=6, droop=.27),
             'side': dict(earYaw=66, earBend=4, droop=.30)}
# Void marking on any form (`draft.void`): `eyes` turns the irises violet, `veins` also lights the ears.
VOID_EYES = dict(eye=('#f6e2ff', '#c070ff', '#5d1aa6', '#14041f'), eyeGlow=2.2)
# Hind paw carriage (`draft.feet`): `visible` lets the long feet reach out beside the chest,
# `splayed` plants them wide with the toes turned out, `flank` shows the paws further back beside
# the haunches, clear of the ears; all get pale paw tops and fuller toes.
FEET = {'visible': dict(footOut=.22, footLength=1.18, footWidth=1.25, footSplay=0, pawLight=.60, toeScale=1.35, hockIn=.48),
        'splayed': dict(footOut=.24, footLength=1.04, footWidth=1.25, footSplay=.16, pawLight=.60, toeScale=1.35, hockIn=.46),
        'flank': dict(footOut=.26, footLength=.92, footWidth=1.25, footSplay=.10, pawLight=.60, toeScale=1.35, hockIn=.50)}
BLOOD = linear('#4f0a0e')
IVORY = linear('#ddd5c6')


def form_settings(spec):
    draft, model = spec.get('draft') or {}, spec.get('model') or {}
    variant = draft.get('formVariant', model.get('formVariant', 'a'))
    palette = draft.get('palette', model.get('palette', 'wild'))
    if variant not in FORMS:
        raise ValueError('rabid-rabbit formVariant must be a, b, c or d')
    if palette not in PALETTES:
        raise ValueError('rabid-rabbit palette must be wild, white, charcoal or ash')
    form, colours = dict(FORMS[variant]), dict(PALETTES[palette])
    option = lambda name: draft.get(name, model.get(name))
    pose = option('earPose')
    if pose:
        if pose not in EAR_POSES:
            raise ValueError('rabid-rabbit earPose must be wide, mid or side')
        form.update(EAR_POSES[pose], ear=pose)
    if option('earYaw') is not None:
        form['earYaw'] = float(option('earYaw'))
    void = option('void')
    if void:
        if void not in ('eyes', 'veins'):
            raise ValueError('rabid-rabbit void must be eyes or veins')
        colours.update(VOID_EYES)
        form['veins'] = form.get('veins') or void == 'veins'
    feet = option('feet')
    if feet:
        if feet not in FEET:
            raise ValueError('rabid-rabbit feet must be visible, splayed or flank')
        form.update(FEET[feet])
    return variant, form, palette, colours, draft


def torso_rows(form):
    rows = []
    for y, w, z, h in TORSO:
        hump = form['hump'] * math.exp(-((y + .30) / .55) ** 2)  # the berserker hunches over the loin
        rows.append((y * form['length'], w * form['width'], z, h + hump))
    points, heights = smooth_path([(w, y, z) for y, w, z, _ in rows], [h for *_, h in rows], steps=6)
    return [(p[1], p[0], p[2], h) for p, h in zip(points, heights)]


def section_of(rows):
    def section(y):
        if y >= rows[0][0]:
            return rows[0][1:]
        for (ya, *a), (yb, *b) in zip(rows, rows[1:]):
            if yb <= y <= ya:
                t = (ya - y) / ((ya - yb) or 1)
                return tuple(u + (v - u) * t for u, v in zip(a, b))
        return rows[-1][1:]
    return section


def torso_shell(c, rows, material, exponent=.95):
    """Closed lofted torso: domed back, a belly that rounds under towards the legs."""
    vertices, faces, sides = [], [], 64
    for y, w, z, h in rows:
        for j in range(sides):
            a = math.tau * j / sides
            s = math.sin(a)
            lift = h * s ** exponent if s > 0 else z * .80 * s
            vertices.append((w * math.cos(a), y, z + lift))
    for i in range(len(rows) - 1):
        for j in range(sides):
            faces.append((i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j))
    faces.extend([tuple(range(sides - 1, -1, -1)), tuple((len(rows) - 1) * sides + j for j in range(sides))])
    mesh = bpy.data.meshes.new('Rabid Rabbit crouched torso')
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(mesh.name, mesh)
    c.scene.collection.objects.link(ob)
    return ob


def head_frame(form):
    neck = NECK * form['length']
    hl, hw = form['headLength'], form['headWidth']
    drop = .06 + .06 * form['hump'] / .16  # the head sits below the arched hips; the berserker's lower still

    def at(y, x=0, z=0):
        return (x * hw, neck + (y - NECK) * hl, z - drop)
    return at, neck, hl, hw, drop


def head_parts(c, form, material):
    """Skull, muzzle, cheeks and a heavy frowning brow, fused with the torso."""
    at, neck, hl, hw, _ = head_frame(form)
    parts = [
        ell(c, 'Rabbit skull', at(1.10, 0, .78), (.33 * hw, .42 * hl, .27), material, taper=.35),
        ell(c, 'Rabbit nape', at(.88, 0, .70), (.30 * hw, .24 * hl, .28), material),
        ell(c, 'Rabbit muzzle', at(1.42, 0, .64), (.24 * hw, .21 * hl, .19), material, taper=.22),
    ]
    for side in (-1, 1):
        parts.append(ell(c, 'Rabbit cheek', at(1.06, side * .26, .66), (.20 * hw, .25 * hl, .20), material))
        parts.append(ell(c, 'Rabbit whisker pad', at(1.47, side * .12, .58), (.13 * hw, .11 * hl, .11), material))
        # The brow ridges angle in towards the nose: a frown from above.
        parts.append(ell(c, 'Rabbit frowning brow', at(1.17, side * .20, .93), (.10 * hw, .16 * hl, .06), material,
                         angle=-side * .45))
    return parts


def spine_ridge(c, form, rows, material):
    section = section_of(rows)
    out = []
    y = .60 * form['length']
    while y > -1.15 * form['length']:
        w, z, h = section(y)
        size = .85 + .15 * math.sin(y * 7)
        out.append(ell(c, 'Rabbit visible spine knuckle', (0, y, z + h - .015), (.085 * size, .055, .075 * size), material))
        y -= .135
    for side in (-1, 1):  # starved hip bones
        w, z, h = section(-.78 * form['length'])
        out.append(ell(c, 'Rabbit jutting hip bone', (side * .20, -.78 * form['length'], z + h - .05), (.08, .11, .06), material))
    return out


def fur(c, name, palette, density, softness=.8, roughness=(.74, .90), dark=None, rim=None):
    """Matte rabbit fur: the dermis plan retuned to short ticked fur on the painted fur-lock texture."""
    material = skin(c, name, linear(dark or palette['dark']), linear(palette['light']), rim=linear(rim or palette['rim']),
                    softness=softness, roughness=roughness)
    nodes = material.node_tree.nodes
    bs = nodes['Principled BSDF']
    bs.inputs['Subsurface Weight'].default_value = .02
    nodes['Dermis density on rest pose'].inputs['Scale'].default_value = density
    tint = nodes['MS blue violet plum tint']
    tint.inputs[1].default_value = (.98, .98, 1.02, 1)
    tint.inputs[2].default_value = (1.04, .99, .95, 1)
    nodes['MS pigment tint strength'].inputs[1].default_value = .22
    nodes['MS cell strength'].inputs[1].default_value = palette['ticking']  # agouti ticking
    nodes['MS deep pigment cells'].inputs[2].default_value = (.42, .40, .38, 1)
    nodes['Iridescent violet-teal sheen'].inputs[7].default_value = (*linear(palette['rim']), 1)
    nodes['MS cool recessed flesh'].inputs[2].default_value = (.80, .80, .84, 1)
    nodes['MS warm convex flesh'].inputs[2].default_value = (1.12, 1.10, 1.06, 1)
    material['FD_SurfaceKind'] = 'rabbit-fur'
    return material


def vein_glow(material, colour, strength):
    """Void veins inside the ears: meandering noise isolines masked by FD_Glow; strength is a socket."""
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bs = nodes['Principled BSDF']
    rest = nodes['Rest-pose skin coordinates'].outputs['Vector']

    def node(kind, label):
        out = nodes.new(kind)
        out.name = out.label = label
        return out
    stretch = node('ShaderNodeVectorMath', 'Veins run along the ear')
    stretch.operation = 'MULTIPLY'
    stretch.inputs[1].default_value = (2.6, 1.0, 2.6)
    links.new(rest, stretch.inputs[0])
    field = node('ShaderNodeTexNoise', 'Ear vein field')
    field.inputs['Scale'].default_value = 3.4
    field.inputs['Detail'].default_value = 2.5
    field.inputs['Distortion'].default_value = .35
    links.new(stretch.outputs[0], field.inputs['Vector'])
    centred = node('ShaderNodeMath', 'Vein contour')
    centred.operation = 'SUBTRACT'
    links.new(field.outputs['Fac'], centred.inputs[0])
    centred.inputs[1].default_value = .5
    distance = node('ShaderNodeMath', 'Vein distance')
    distance.operation = 'ABSOLUTE'
    links.new(centred.outputs[0], distance.inputs[0])
    line = node('ShaderNodeMapRange', 'Vein line')
    line.interpolation_type = 'SMOOTHSTEP'
    line.clamp = True
    line.inputs['From Min'].default_value = 0
    line.inputs['From Max'].default_value = .045
    line.inputs['To Min'].default_value = 1
    line.inputs['To Max'].default_value = 0
    links.new(distance.outputs[0], line.inputs['Value'])
    mask = node('ShaderNodeVertexColor', 'Ear vein mask')
    mask.layer_name = 'FD_Glow'
    split = node('ShaderNodeSeparateColor', 'Ear vein mask channels')
    links.new(mask.outputs['Color'], split.inputs[0])
    glow = node('ShaderNodeMath', 'Masked ear veins')
    glow.operation = 'MULTIPLY'
    links.new(line.outputs[0], glow.inputs[0])
    links.new(split.outputs[0], glow.inputs[1])
    emission = node('ShaderNodeMix', 'Ear vein emission colour')
    emission.data_type = 'RGBA'
    emission.inputs[6].default_value = (0, 0, 0, 1)
    emission.inputs[7].default_value = (*colour, 1)
    links.new(glow.outputs[0], emission.inputs[0])
    links.new(emission.outputs[2], bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value = strength
    # The skin around the veins takes on the void colour even where it does not glow.
    base = bs.inputs['Base Color'].links[0].from_socket
    tinted = node('ShaderNodeMix', 'Vein-tinted ear skin')
    tinted.data_type = 'RGBA'
    factor = node('ShaderNodeMath', 'Vein tint')
    factor.operation = 'MULTIPLY'
    links.new(glow.outputs[0], factor.inputs[0])
    factor.inputs[1].default_value = .45
    links.new(factor.outputs[0], tinted.inputs[0])
    links.new(base, tinted.inputs[6])
    tinted.inputs[7].default_value = (*linear('#3c1660'), 1)
    links.new(tinted.outputs[2], bs.inputs['Base Color'])
    return bs.inputs['Emission Strength']


def ring_iris(c, name, tones, strength):
    """Glowing iris rings around a dark round pupil."""
    core, bright, mid, dark = (linear(t) for t in tones)
    material = c.material(name, bright)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bs = nodes.get('Principled BSDF')
    uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'FD_Iris'
    centred = nodes.new('ShaderNodeVectorMath'); centred.operation = 'SUBTRACT'
    centred.inputs[1].default_value = (.5, .5, 0)
    links.new(uv.outputs['UV'], centred.inputs[0])
    radius = nodes.new('ShaderNodeVectorMath'); radius.operation = 'LENGTH'
    links.new(centred.outputs[0], radius.inputs[0])
    rings = nodes.new('ShaderNodeValToRGB'); rings.color_ramp.interpolation = 'EASE'
    stops = [(0, (.004, .003, .004)), (.16, (.004, .003, .004)), (.21, bright), (.27, core), (.34, mid), (.44, dark),
             (.50, tuple(v * .3 for v in dark))]
    elements = rings.color_ramp.elements
    for i, (pos, color) in enumerate(stops):
        e = elements[i] if i < 2 else elements.new(pos)
        e.position, e.color = pos, (*color, 1)
    links.new(radius.outputs['Value'], rings.inputs[0])
    links.new(rings.outputs[0], bs.inputs['Base Color'])
    links.new(rings.outputs[0], bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value = strength
    bs.inputs['Roughness'].default_value = .18
    bs.inputs['Specular IOR Level'].default_value = .5
    material['FD_SurfaceKind'] = 'rabbit-ring-iris'
    return material


def rabbit_eye(c, form, side, mats, palette):
    """A bulging eye set into the side of the skull under a heavy furred lid: a hooded, hostile stare."""
    at, *_ = head_frame(form)
    r = .115 * form['eyeScale']  # large: the eyes carry the runtime eye glow that marks enemies at night
    centre = Vector(at(1.17, side * .265, .83))
    centre.x += side * r * .12
    yaw, pitch = math.radians(60), math.radians(38)
    look = Vector((side * math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    f, right, up = frame(look)
    name = ('Left' if side < 0 else 'Right') + ' rabbit eye'
    ball = c.ell(name + ' glossy ball', tuple(centre), (r, r * 1.10, r), mats['eyeball'])
    iris = cap(c, name + ' ringed iris', centre, r * 1.015, f, right, up, math.radians(42), mats['iris'], uv=True)
    lid = lid_shell(c, name + ' heavy furred lid', centre, r, f, right, up, math.radians(-150), math.radians(34),
                    math.radians(80), mats['lid'], thickness=.022)
    for ob in (ball, iris, lid):
        write_rest(ob)
    register_eye(c, side, iris)
    return dict(ball=ball, iris=iris, lid=lid, centre=centre)


def leaf(c, name, path, widths_out, widths_in, thickness, cup, material, side):
    """Closed, cupped ear blade along `path`; the flat face looks up, the edges curl down.

    `widths_out`/`widths_in` are the half widths towards the outer and inner edge per station.
    FD_Pattern: R = 1 except the dark ear tip, G = pale edge rim; FD_Glow marks the vein field.
    """
    n = 20
    vertices, plan, glow = [], [], []
    count = len(path)
    for i, p in enumerate(path):
        t = i / (count - 1)
        tangent = (path[min(i + 1, count - 1)] - path[max(i - 1, 0)]).normalized()
        lateral = Vector((-tangent.y, tangent.x, 0))
        lateral = lateral.normalized() if lateral.length > 1e-6 else Vector((1, 0, 0))
        if lateral.x * side < 0:
            lateral = -lateral  # + lateral points to the outer edge
        up = lateral.cross(tangent).normalized()
        if up.z < 0:
            up = -up
        for j in range(n):
            a = math.tau * j / n
            ca, sa = math.cos(a), math.sin(a)
            half = widths_out[i] if ca > 0 else widths_in[i]
            offset = lateral * (half * ca) + up * (thickness[i] * sa - cup * half * ca * ca)
            vertices.append(tuple(p + offset))
            plan.append((t, abs(ca), sa))
            glow.append(max(0, sa) * (1 - abs(ca)) ** 1.5 * smoothstep(.05, .22, t) * smoothstep(.98, .70, t))
    faces = []
    for i in range(count - 1):
        for j in range(n):
            faces.append((i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j))
    for k, p in ((0, path[0]), (count - 1, path[-1])):
        centre = len(vertices)
        vertices.append(tuple(p))
        plan.append((k / (count - 1), 0, 0))
        glow.append(0)
        ring = [k * n + j for j in range(n)]
        faces += [(centre, ring[(j + 1) % n], ring[j]) for j in range(n)]
    ob = mesh_object(c, name, vertices, faces, [material])
    outward_normals(ob.data)
    return ob, plan, glow


def ear(c, form, side, hull, material, palette, torn=False):
    """A long ear laid flat back over the neck (or, for the berserker, short and pointing forward)."""
    at, neck, hl, hw, drop = head_frame(form)
    length = form['earLength'] * (.74 if torn else 1)
    width = form['earWidth']
    stations = 26
    root = Vector(at(.90, side * .11, .95))
    path = []
    if form['ear'] == 'forward':
        yaw, pitch = math.radians(form['earYaw']), math.radians(form['earPitch'])
        root = Vector(at(.96, side * .10, .95))
        for k in range(stations):
            t = k / (stations - 1)
            bend = math.radians(form['earBend']) * t
            d = Vector((side * math.sin(yaw + bend) * math.cos(pitch - .5 * bend), math.cos(yaw + bend) * math.cos(pitch - .5 * bend),
                        math.sin(pitch - .5 * bend)))
            path.append(root + d * length * t)
    else:
        yaw0, bend = math.radians(form['earYaw']), math.radians(form['earBend'])
        q = root.copy()
        step = length / (stations - 1)
        for k in range(stations):
            t = k / (stations - 1)
            if k:
                yaw = yaw0 + bend * t
                q = q + Vector((side * math.sin(yaw), -math.cos(yaw), 0)) * step
            surface = hull.height(q.x, q.y)
            if form['ear'] == 'back':
                lie = (surface if surface is not None else root.z - .25) + .07 + .04 * math.sin(math.pi * t)
                z = root.z + (lie - root.z) * smoothstep(0, .30, t)
            else:
                # Held out over (and past) the body outline, sagging towards the tip, never into the fur.
                held = root.z + .03 - form['droop'] * t ** 1.5
                z = max(held, surface + .07 if surface is not None else held)
            path.append(Vector((q.x, q.y, z)))
    profile = [(0, .52), (.12, .82), (.38, 1.0), (.66, .90), (.86, .62), (.96, .34), (1, .10)]
    if torn:
        profile = [(0, .52), (.12, .82), (.38, 1.0), (.66, .92), (.86, .86), (1, .78)]  # blunt torn end

    def width_at(t):
        for (ta, a), (tb, b) in zip(profile, profile[1:]):
            if ta <= t <= tb:
                return a + (b - a) * smoothstep(ta, tb, t)
        return profile[-1][1]
    rng = random.Random(41 + side)
    outer, inner, thick = [], [], []
    for k in range(stations):
        t = k / (stations - 1)
        w = width * width_at(t)
        notch = 1
        if torn:
            notch -= .62 * math.exp(-((t - .52) / .07) ** 2)  # a bite out of the outer edge
            if t > .9:
                w *= 1 + rng.uniform(-.35, .1)  # ragged torn end
        outer.append(w * notch)
        inner.append(w * (1 if not torn or t < .9 else 1 + rng.uniform(-.3, .05)))
        thick.append(.040 - .018 * t)
    ob, plan, glow = leaf(c, f'Rabbit {"left" if side < 0 else "right"} ear', path, outer, inner, thick, .42, material, side)
    tip = form['earTip'] * (0 if torn else 1)
    mesh = ob.data
    pattern = mesh.color_attributes.new(name='FD_Pattern', type='FLOAT_COLOR', domain='POINT')
    mask = mesh.color_attributes.new(name='FD_Glow', type='FLOAT_COLOR', domain='POINT')
    for value, (t, edge, top) in zip(pattern.data, plan):
        dark_tip = smoothstep(1 - tip * 1.25, 1 - tip * .35, t) if tip else 0
        root_shade = .80 + .20 * smoothstep(0, .25, t)
        value.color = (root_shade * (1 - dark_tip), .85 * smoothstep(.55, .98, edge) * (1 - dark_tip), .15, 1)
    for value, g in zip(mask.data, glow):
        value.color = (g, g, g, 1)
    write_rest(ob)
    c.paint_form_mask(ob, lambda p: .72)
    return ob, path


def leg_points(joints, side):
    return [Vector((side * x, y, z)) for x, y, z in joints]


def join(parts, name):
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for ob in parts:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.convert(target='MESH')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        ob.select_set(False)
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    out.name = name
    return out


def paw(c, leg, ankle, end, width, material, claw, toes=4, hind=False, toe_scale=1):
    """Furred paw from ankle to toe tips with short dark claws, one authored contact mesh."""
    d = (end - ankle)
    heading = math.atan2(d.y, d.x)
    length = Vector((d.x, d.y)).length
    mid = (ankle + end) / 2
    parts = [ell(c, f'{leg} furred sole', (mid.x, mid.y, .06 if hind else .05), (width, length / 2 + .04, .06 if hind else .05),
                 material, angle=heading - math.pi / 2, taper=-.25 if hind else 0)]
    if hind and toe_scale > 1:  # a full, rounded paw at the end of the long foot
        ball = end - (end - ankle).normalized() * .16
        parts.append(ell(c, f'{leg} furred paw ball', (ball.x, ball.y, .07), (width * 1.15, .20, .075), material, angle=heading - math.pi / 2))
    u = Vector((math.cos(heading), math.sin(heading), 0))
    lat = Vector((-u.y, u.x, 0))
    for k in range(toes):
        offset = (k - (toes - 1) / 2) / max(1, toes - 1)
        base = end - u * .05 + lat * offset * width * 1.5
        parts.append(ell(c, f'{leg} toe', (base.x, base.y, .045 * toe_scale), (width * .36 * toe_scale, .085 * toe_scale, .045 * toe_scale),
                         material, angle=heading - math.pi / 2))
        tip = base + u * .10 + lat * offset * .02
        parts.append(horn(c, f'{leg} claw', [tuple(base + u * .05 + Vector((0, 0, .04))), tuple(tip + Vector((0, 0, .018)))],
                          [.013, .003], claw, sides=8))
    out = join(parts, f'{leg} broad paw ({"long hind foot" if hind else "forepaw"})')
    return out


def paint_limb(ob, palette, top_light=.62, paw=0):
    """Banded leg fur with pale undersides; `paw` lightens the top of a foot so it reads from above."""
    def sampler(p, n):
        rim = max(.80 * smoothstep(.35, -.25, n.z), paw * smoothstep(-.1, .6, n.z))
        return top_light - .18 * smoothstep(.15, .0, p.z), rim, .2
    paint_pattern(ob, sampler)


def build_leg(c, leg, form, rows, materials, palette):
    side = -1 if leg.endswith('left') else 1
    section = section_of(rows)
    L, W, th = form['length'], form['width'], form['legThickness']
    fur_mat, claw = materials['limb'], materials['claw']
    if leg.startswith('front'):
        # Shoulder, elbow, wrist, toe tips: braced under the chest, the paws just outside the cheeks.
        joints = leg_points([(.30 * W, .48 * L, .55), (.38 * W, .38 * L, .24), (.36 * W, .64 * L, .07)], side)
        tip = Vector((side * .34 * W, .86 * L + .02, .03))
        upper = horn(c, f'{leg} shoulder', joints[:2], [.12 * th, .075 * th], fur_mat, sides=14)
        elbow = ell(c, f'{leg} elbow', tuple(joints[1]), (.075 * th,) * 3, fur_mat)
        lower = horn(c, f'{leg} foreleg', joints[1:], [.07 * th, .05 * th], fur_mat, sides=14)
        foot = paw(c, leg, joints[2], tip, .065 * th, fur_mat, claw, toes=4)
        segments = dict(upper=[upper], lower=[elbow, lower], foot=[foot])
        names = FRONT_SEGMENTS
    else:
        # Hip, knee, hock and toe tips: the long foot lies flat along the flank, toes forwards.
        w_hock = section(-1.10 * L)[0]
        hip = (.40 * W, -.80 * L, .55)
        knee = (.58 * W, -.50 * L, .30)
        # The hock sits at the rear flank, or tucked under the haunch when the paws are to show.
        hock = ((form['hockIn'] * W) if 'hockIn' in form else max(.56 * W, w_hock + .02), -1.12 * L, .12)
        joints = leg_points([hip, knee, hock], side)
        toe_y = hock[1] + form['footLength']
        w_toe = section(toe_y)[0]
        tip = Vector((side * (w_toe + form['footOut']), toe_y, .03))
        splay = form.get('footSplay', 0)
        if splay:  # turn the toes outwards about the hock
            hock_v = joints[2]
            d = (tip - hock_v).to_2d()
            a = -side * splay
            d = Vector((d.x * math.cos(a) - d.y * math.sin(a), d.x * math.sin(a) + d.y * math.cos(a)))
            tip = Vector((hock_v.x + d.x, hock_v.y + d.y, .03))
        thigh = horn(c, f'{leg} thigh', joints[:2], [.19 * th, .11 * th], fur_mat, sides=16)
        knee_ball = ell(c, f'{leg} knee', tuple(joints[1]), (.10 * th,) * 3, fur_mat)
        shin = horn(c, f'{leg} shin', joints[1:], [.09 * th, .065 * th], fur_mat, sides=14)
        foot = paw(c, leg, joints[2], tip, .095 * form['footWidth'], fur_mat, claw, toes=4, hind=True, toe_scale=form.get('toeScale', 1))
        segments = dict(thigh=[thigh], shin=[knee_ball, shin], foot=[foot])
        names = REAR_SEGMENTS
    for segment, objects in segments.items():
        for ob in objects:
            paint_limb(ob, palette, paw=form.get('pawLight', 0) if segment == 'foot' and leg.startswith('rear') else 0)
            write_rest(ob)
            c.paint_form_mask(ob, lambda p: .62 + .38 * max(0, min(1, p.z / .4)))
    return dict(joints=joints, tip=tip, segments=segments, names=names, side=side)


def paint_body(ob, form, rows, palette, eyes):
    section = section_of(rows)
    at, neck, *_ = head_frame(form)
    saddle = palette['saddle']

    def sampler(p, n):
        if p.y > neck:
            w = .36 * form['headWidth']
        else:
            w = section(p.y)[0]
        across = min(1, abs(p.x) / max(w, .05))
        flank = 1 - saddle * (1 - smoothstep(.10, .85, across))
        if p.y > neck + .10:  # darker crown between the eyes, lighter muzzle
            flank *= .88 + .12 * smoothstep(neck + .55, neck + .80, p.y)
        rim = .90 * smoothstep(.30, -.20, n.z)  # pale belly fur turning under: the light outline edge
        for centre in eyes:
            d = math.hypot(p.x - centre.x, (p.y - centre.y) * .85)
            flank *= 1 - .45 * math.exp(-(d / .16) ** 2)  # sunken dark eye sockets
            rim *= 1 - .8 * math.exp(-(d / .14) ** 2)
        muzzle = smoothstep(neck + .60, neck + .80, p.y) * smoothstep(.55, .10, n.z)
        rim = max(rim, .55 * muzzle)  # pale chin and lip under the muzzle
        return flank, rim, .18 + .25 * across
    paint_pattern(ob, sampler)


def crest(c, form, rows, hull, material, palette):
    """Raised hackles: stiff spiky fur tufts along the nape and spine, leaning back."""
    rng = random.Random(7)
    neck = NECK * form['length']
    spikes = []
    y = neck - .10
    k = 0
    while y > -.70 * form['length']:
        t = (neck - .10 - y) / (neck - .10 + .70 * form['length'])
        size = (.62 + .38 * math.sin(math.pi * min(1, t * 1.25))) * rng.uniform(.85, 1.1)
        for x in ((-.045, .045) if k % 2 else (0,)):
            z = hull.height(x, y)
            if z is None:
                continue
            base = Vector((x, y, z - .03))
            tip = base + Vector((x * 2.2, -.17 * size, .19 * size))
            spikes.append(horn(c, 'Rabbit raised hackle tuft', [tuple(base), tuple(base.lerp(tip, .5) + Vector((0, 0, .015))), tuple(tip)],
                               [.065 * size, .040 * size, .006], material, sides=10))
        y -= .10
        k += 1
    out = join(spikes, 'Rabbit raised hackle crest')

    def sampler(p, n):
        z = hull.height(p.x, p.y) or 0
        return .35, .95 * smoothstep(.04, .17, p.z - z), .2
    paint_pattern(out, sampler)
    write_rest(out)
    c.paint_form_mask(out, lambda p: .80)
    return out


def mange(c, hull, form, mats):
    """Bald mangy patches with dark scabs on flank, haunch, shoulder and face."""
    L = form['length']
    at, *_ = head_frame(form)
    spots = [(-.34, -.16 * L, .17, .12, .5, 3), (.30, -.86 * L, .15, .19, -.3, 5), (.16, .30 * L, .11, .09, .9, 8),
             (-.24, -.98 * L, .10, .08, .2, 11), (.06, -.42 * L, .07, .10, 0, 13)]
    face = at(1.30, .14, 0)
    spots.append((face[0], face[1], .065, .055, .4, 17))
    body, head = [], []
    for x, y, rx, ry, angle, seed in spots:
        bald = on_skin(c, 'Rabbit mangy bald patch', hull, oval(x, y, rx, ry, angle, .12, seed), mats['bald'], lift=.010, crown=.012)
        # Bare grey-pink hide, darker and blotched towards the middle, a pale scurf rim at the fur edge.
        cx_, cy_ = x, y
        paint_pattern(bald, lambda q, n, cx_=cx_, cy_=cy_, rx=rx, ry=ry: (
            .98 - .25 * math.exp(-(((q.x - cx_) / rx) ** 2 + ((q.y - cy_) / ry) ** 2) * 2.2),
            .55 * smoothstep(.55, 1.0, math.hypot((q.x - cx_) / rx, (q.y - cy_) / ry)), .1))
        write_rest(bald)
        scab = on_skin(c, 'Rabbit mange scab', hull, oval(x + rx * .2, y - ry * .15, rx * .24, ry * .20, angle, .3, seed + 1),
                     mats['scab'], lift=.016, crown=.010)
        target = head if y > NECK * L + .05 else body
        target += [bald, scab]
    return body, head


def on_skin(c, name, hull, outline, material, lift=.010, crown=.008):
    """A surface patch whose outline is pulled towards its centre until it lies wholly on the skin."""
    cx, cy = sum(x for x, _ in outline) / len(outline), sum(y for _, y in outline) / len(outline)
    for scale in (1, .85, .7, .55):
        points = [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in outline]
        if all(hull.height(x, y) is not None for x, y in points):
            return patch(c, name, hull, points, material, lift=lift, crown=crown)
    raise ValueError(f'{name} leaves the skin at {cx:.3f}, {cy:.3f}')


def blood(c, hull, form, mats):
    """Fresh blood soaked into the muzzle, chin and forepaws: the only red on the animal."""
    at, *_ = head_frame(form)
    mx, my, _ = at(1.47, 0, 0)
    head = [on_skin(c, 'Rabbit bloodied muzzle', hull, oval(mx, my, .15 * form['headWidth'], .08 * form['headLength'], 0, .25, 3),
                    mats['blood'])]
    for side in (-1, 1):  # blood soaked into the whisker pads, running back along the lips
        cx, cy, _ = at(1.40, side * .15, 0)
        head.append(on_skin(c, 'Rabbit blood soaked lip', hull, oval(cx, cy, .055, .09, side * .5, .35, 5 + side), mats['blood']))
    return head


def build(c, spec):
    variant, form, palette_name, palette, draft = form_settings(spec)
    voxel = .014 * draft.get('voxelScale', 1)
    hide = fur(c, 'Rabid Rabbit dense fur', palette, 1.55)
    limb_fur = fur(c, 'Rabid Rabbit leg fur', palette, 1.8, softness=.7)
    ear_fur = fur(c, 'Rabid Rabbit ear fur', dict(palette, light=palette['earBack']), 2.1, softness=.6, dark=palette['earTip'],
                  rim=palette['earRim'])
    tail_fur = fur(c, 'Rabid Rabbit tail tuft', dict(palette, light=palette['tail']), 1.6, softness=.5)
    crest_fur = fur(c, 'Rabid Rabbit hackle fur', palette, 1.8, softness=.5)
    bald = skin(c, 'Rabid Rabbit mangy bare hide', linear(palette['scab']), linear(palette['skin']), rim=linear(palette['skin']),
                softness=.8, roughness=(.50, .64))
    mats = {
        'eyeball': glossy_material(c, 'Rabid Rabbit wet eyeball', linear('#0b090a'), roughness=.14),
        'iris': ring_iris(c, 'Rabid Rabbit ringed iris', palette['eye'], palette['eyeGlow']),
        'claw': glossy_material(c, 'Rabid Rabbit dark claws', linear(palette['claw']), roughness=.38),
        'tooth': glossy_material(c, 'Rabid Rabbit long incisors', IVORY, roughness=.34),
        'nose': c.material('Rabid Rabbit nose leather', linear(palette['nose'])),
        'mouth': c.material('Rabid Rabbit dark gum and mouth', linear('#24100f')),
        'bald': bald,
        'scab': c.material('Rabid Rabbit dark scab', linear(palette['scab']), 'organic'),
        'blood': glossy_material(c, 'Rabid Rabbit soaked blood', BLOOD, roughness=.36),
        'limb': limb_fur,
        'lid': hide,
    }

    root = control(c.scene, 'Rabid Rabbit fixed export pivot')
    carriage = control(c.scene, 'Rabid Rabbit carriage (leap height)', parent=root)

    rows = torso_rows(form)
    section = section_of(rows)
    torso = torso_shell(c, rows, hide)
    pieces = [torso, *head_parts(c, form, hide)]
    if form.get('spine'):
        pieces += spine_ridge(c, form, rows, hide)
    body = fuse(c, pieces, hide, voxel=voxel)
    body.name = 'Rabid Rabbit continuous fur body'
    eyes = {side: rabbit_eye(c, form, side, mats, palette) for side in (-1, 1)}
    paint_body(body, form, rows, palette, [e['centre'] for e in eyes.values()])
    write_rest(body)
    c.paint_form_mask(body, lambda p: .55 + .45 * max(0, min(1, p.z / .78)))
    hull = Surface([body])

    at, neck, hl, hw, drop = head_frame(form)
    nose = Vector(at(1.60, 0, .64))
    nose_pad = ell(c, 'Rabid Rabbit nose leather', tuple(nose + Vector((0, -.01, .04))), (.055 * hw, .035, .03), mats['nose'])
    incisor_size = form['incisors']
    teeth = []
    for side in (-1, 1):
        # Upper incisors hang from under the lip; the berserker's long ones jut forwards past the nose.
        base = nose + Vector((side * .027, -.05, -.07))
        reach = .05 * incisor_size ** 1.6
        drop = .06 + .025 * incisor_size
        teeth.append(horn(c, 'Rabid Rabbit long upper incisor', [tuple(base), tuple(base + Vector((0, reach * .6, -drop * .55))),
                                                                  tuple(base + Vector((0, reach, -drop)))],
                          [.026 * incisor_size ** .5, .024 * incisor_size ** .5, .016], mats['tooth'], sides=10))
    lower_jaw = ell(c, 'Rabid Rabbit lower jaw', tuple(nose + Vector((0, -.14, -.12))), (.12 * hw, .14, .055), hide)
    mouth = ell(c, 'Rabid Rabbit dark mouth', tuple(nose + Vector((0, -.07, -.075))), (.085 * hw, .085, .03), mats['mouth'])
    paint_pattern(lower_jaw, lambda p, n: (.9, .85, .2))
    write_rest(lower_jaw)
    c.paint_form_mask(lower_jaw, lambda p: .7)
    head_extra = [nose_pad]
    if form.get('snarl'):
        # A pulled-back upper lip bares the gum line above the incisors.
        for side in (-1, 1):
            head_extra.append(ell(c, 'Rabid Rabbit bared gum', tuple(nose + Vector((side * .05, -.05, -.035))), (.05, .045, .028),
                                  mats['mouth'], angle=side * .5))

    ears, ear_paths = {}, {}
    for side in (-1, 1):
        ears[side], ear_paths[side] = ear(c, form, side, hull, ear_fur, palette, torn=bool(form.get('tornEar')) and side < 0)
    vein_strength = form.get('veinStrength', 2.4)
    ear_glow = vein_glow(ear_fur, linear(palette['glow']), vein_strength) if form.get('veins') else None

    tail_y = rows[-1][0] + .04
    tail = ell(c, 'Rabid Rabbit tail tuft', (0, tail_y, .58), (.14, .13, .14), tail_fur)
    if form['tail'] == 'hare':
        paint_pattern(tail, lambda p, n: (.15 + .75 * smoothstep(.2, -.3, n.z), .9 * smoothstep(.1, -.4, n.z), .2))
    else:
        paint_pattern(tail, lambda p, n: (.85, .7 + .3 * smoothstep(.2, -.3, n.z), .2))
    write_rest(tail)
    c.paint_form_mask(tail, lambda p: .8)

    crest_ob = crest(c, form, rows, hull, crest_fur, palette) if form.get('crest') else None
    body_spots, head_spots = mange(c, hull, form, mats) if form.get('mange') else ([], [])
    head_spots += blood(c, hull, form, mats) if palette['blood'] else []

    legs = {leg: build_leg(c, leg, form, rows, mats, palette) for leg in LEGS}

    # Armature: every bone rolls its Z axis up, so Euler Z is a yaw seen from the camera.
    data = bpy.data.armatures.new('Rabid Rabbit rig')
    rig = bpy.data.objects.new('Rabid Rabbit rig', data)
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
    L = form['length']
    mid = -.28 * L
    bone('root', (0, 0, 0), (0, .2, 0))
    bone('body', (0, mid, .62), (0, neck - .05, .70), 'root')
    bone('hips', (0, mid, .62), (0, -1.15 * L, .60), 'body')
    bone('head', (0, neck - .04, .74 - drop), (0, nose.y, .70 - drop), 'body')
    bone('jaw', tuple(nose + Vector((0, -.30, -.10))), tuple(nose + Vector((0, .02, -.10))), 'head')
    for side, key in ((-1, 'l'), (1, 'r')):
        path = ear_paths[side]
        bone(f'ear_{key}', tuple(path[0]), tuple(path[0] + (path[6] - path[0]).normalized() * .35), 'head')
    bone('tail', (0, tail_y + .16, .58), (0, tail_y - .14, .64), 'hips')
    for leg, parts in legs.items():
        joints, tip = parts['joints'], parts['tip']
        a, b, f = parts['names']
        parent = 'body' if leg.startswith('front') else 'hips'
        bone(f'{leg}_{a}', tuple(joints[0]), tuple(joints[1]), parent)
        bone(f'{leg}_{b}', tuple(joints[1]), tuple(joints[2]), f'{leg}_{a}', connect=True)
        bone(f'{leg}_{f}', tuple(joints[2]), tuple(tip), f'{leg}_{b}', connect=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    for b in rig.pose.bones:
        b.rotation_mode = 'XYZ'

    def rigid(ob, name, group=None):
        ob.parent = carriage
        bind(ob, rig, [[(name, 1)]] * len(ob.data.vertices))
        if group:
            ob['meshUnionGroup'] = group

    # Fur skin: head at the front, hips behind mid-back; the haunches follow the thighs and the
    # shoulders the upper forelegs, so the fused coat moves with the legs instead of tearing.
    weights = []
    for vertex in body.data.vertices:
        p = body.matrix_world @ vertex.co
        head_w = smoothstep(neck - .12, neck + .14, p.y)
        hips_w = (1 - head_w) * smoothstep(-.10 * L, -.52 * L, p.y)
        body_w = 1 - head_w - hips_w
        side = 'left' if p.x < 0 else 'right'
        haunch = smoothstep(.16, .44, abs(p.x)) * smoothstep(-.40 * L, -.66 * L, p.y) * smoothstep(-1.32 * L, -1.02 * L, p.y)
        haunch *= smoothstep(.70, .30, p.z)
        shoulder = smoothstep(.18, .40, abs(p.x)) * math.exp(-((p.y - .44 * L) / .20) ** 2) * smoothstep(.55, .20, p.z)
        thigh_w, upper_w = .75 * haunch * hips_w, .55 * shoulder * body_w
        weights.append([('head', head_w), ('hips', hips_w - thigh_w), ('body', body_w - upper_w),
                        (f'rear_{side}_thigh', thigh_w), (f'front_{side}_upper', upper_w)])
    body.parent = carriage
    bind(body, rig, weights)
    for side, eye in eyes.items():
        rigid(eye['ball'], 'head'); rigid(eye['iris'], 'head'); rigid(eye['lid'], 'head')
    for ob in head_extra + head_spots:
        rigid(ob, 'head')
    for ob in body_spots:
        y = ob.matrix_world.translation.y
        rigid(ob, 'hips' if y < mid else 'body')
    for ob in teeth:
        rigid(ob, 'head', 'incisors')
    rigid(lower_jaw, 'jaw', 'jaw'); rigid(mouth, 'jaw', 'jaw')
    rigid(ears[-1], 'ear_l', 'ear-l'); rigid(ears[1], 'ear_r', 'ear-r')
    rigid(tail, 'tail', 'tail')
    if crest_ob:
        # Stiff hackles bend with the back: front tufts on the body, rear ones on the hips.
        crest_ob.parent = carriage
        bind(crest_ob, rig, [[('hips', smoothstep(-.10 * L, -.52 * L, (crest_ob.matrix_world @ v.co).y)),
                              ('body', 1 - smoothstep(-.10 * L, -.52 * L, (crest_ob.matrix_world @ v.co).y))]
                             for v in crest_ob.data.vertices])
        crest_ob['meshShadowDetail'] = True
    for leg, parts in legs.items():
        for segment, objects in parts['segments'].items():
            for ob in objects:
                rigid(ob, f'{leg}_{segment}', f'{leg}-{segment}')

    bpy.context.view_layer.update()
    sockets = {}
    rest = rig.data.bones['jaw']
    mouth_socket = control(c.scene, 'Rabid Rabbit mouth socket')
    mouth_socket.parent, mouth_socket.parent_type, mouth_socket.parent_bone = rig, 'BONE', 'jaw'
    mouth_socket.matrix_parent_inverse = (rest.matrix_local @ Matrix.Translation((0, rest.length, 0))).inverted()
    mouth_socket.location = tuple(nose + Vector((0, .08, -.06)))
    sockets['mouth'] = mouth_socket
    parts = {'carriage': carriage, 'rabbit_legs': list(LEGS)}
    if ear_glow is not None:
        parts.update(ear_glow=ear_glow, ear_glow_rest=vein_strength)
    root['formVariant'] = variant
    root['palette'] = palette_name
    return {'root': root, 'parts': parts, 'rig': rig, 'sockets': sockets}
