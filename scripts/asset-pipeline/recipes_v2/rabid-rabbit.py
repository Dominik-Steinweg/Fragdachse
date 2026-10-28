"""Rabid Rabbit (rabid-rabbit): a small, fast, void-touched hare that hunts players, seen from above (display 22).

GA1 choice (R3-5 "nightshade tips"): a lean field hare in a crouch, egg-shaped and widest at the
haunches, with a lean head whose long ears are held out to the sides and back (46 degrees from
straight back). From above they make an arrow silhouette, the key recognition feature; their
tips glow void violet. The long hind feet lie under the haunches and show their pale paws beside
them. Large violet eyes sit under heavy lids and carry the runtime eye glow that marks enemies at
night. The fur is blue-black (nightshade) over the painted fur-lock texture: a dark dorsal
saddle, lit flanks and a pale violet fur edge that keeps the outline readable on dark ground,
softened by fur locks along the outline. Red stays with the telegraphs; no yellow.

z = 0 is the ground. Parts for rabid_rabbit_motion_v2: `carriage` (whole animal, real leap
height), the `ear_glow` emission socket (rest strength `ear_glow_rest`) and the rig: `body`
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
from zombie_surface_parts import Surface, mesh_object

LEGS = ('front_left', 'front_right', 'rear_left', 'rear_right')
FRONT_SEGMENTS = ('upper', 'lower', 'foot')
REAR_SEGMENTS = ('thigh', 'shin', 'foot')
# Torso front to rear: y, half width, equator z, dome height (scaled by LENGTH/WIDTH). A crouched
# hare is a round pear: narrow shoulders, the back arching highest over loin and haunches.
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
LENGTH, WIDTH, LEG_THICKNESS = 1.04, .88, .92
HEAD_DROP = .06  # the head sits below the arched hips
# Ears held out to the sides and back: yaw from straight back, extra outward bend along the ear,
# sag of the tip below the root, length, half width and the share of the ear that glows.
EAR = dict(yaw=46, bend=6, droop=.27, length=1.50, width=.22, tip=.24)
# Hind paws under the haunches: toes turned slightly out, the pale paw beside the haunch.
FOOT = dict(out=.26, length=.92, width=1.25, splay=.10, light=.60, toes=1.35, hock=.50)
# Nightshade fur: dark/light/rim drive the authored saddle -> flank -> pale violet fur edge.
PALETTE = dict(dark='#07080f', light='#252a3e', rim='#a48ed0', saddle=.30, ticking=.18, earTip='#040409', earBack='#343852',
               earRim='#b39be0', tail='#3a3e5a', claw='#08080c', nose='#221e30')
EYE_TONES = ('#f6e2ff', '#c070ff', '#5d1aa6', '#14041f')  # iris rings: core, bright, mid, dark
EYE_GLOW = 2.2
VOID = linear('#b347ff')
VOID_HOT = linear('#e2a8ff')
TIP_GLOW = 2.4
IVORY = linear('#ddd5c6')


def torso_rows():
    rows = [(y * LENGTH, w * WIDTH, z, h) for y, w, z, h in TORSO]
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


def at(y, x=0, z=0):
    """Head-local authoring coordinates (relative to the NECK row) to world."""
    return (x, NECK * LENGTH + (y - NECK), z - HEAD_DROP)


def head_parts(c, material):
    """Skull, nape, muzzle, cheeks, whisker pads and a heavy frowning brow, fused with the torso."""
    parts = [
        ell(c, 'Rabbit skull', at(1.10, 0, .78), (.33, .42, .27), material, taper=.35),
        ell(c, 'Rabbit nape', at(.88, 0, .70), (.30, .24, .28), material),
        ell(c, 'Rabbit muzzle', at(1.42, 0, .64), (.24, .21, .19), material, taper=.22),
    ]
    for side in (-1, 1):
        parts.append(ell(c, 'Rabbit cheek', at(1.06, side * .26, .66), (.20, .25, .20), material))
        parts.append(ell(c, 'Rabbit whisker pad', at(1.47, side * .12, .58), (.13, .11, .11), material))
        # The brow ridges angle in towards the nose: a frown from above.
        parts.append(ell(c, 'Rabbit frowning brow', at(1.17, side * .20, .93), (.10, .16, .06), material, angle=-side * .45))
    return parts


def fur(c, name, density, softness=.8, roughness=(.74, .90), dark=None, light=None, rim=None):
    """Matte hare fur: the dermis plan retuned to short ticked fur on the painted fur-lock texture."""
    material = skin(c, name, linear(dark or PALETTE['dark']), linear(light or PALETTE['light']), rim=linear(rim or PALETTE['rim']),
                    softness=softness, roughness=roughness)
    nodes = material.node_tree.nodes
    bs = nodes['Principled BSDF']
    bs.inputs['Subsurface Weight'].default_value = .02
    nodes['Dermis density on rest pose'].inputs['Scale'].default_value = density
    tint = nodes['MS blue violet plum tint']
    tint.inputs[1].default_value = (.98, .98, 1.02, 1)
    tint.inputs[2].default_value = (1.04, .99, .95, 1)
    nodes['MS pigment tint strength'].inputs[1].default_value = .22
    nodes['MS cell strength'].inputs[1].default_value = PALETTE['ticking']  # agouti ticking
    nodes['MS deep pigment cells'].inputs[2].default_value = (.42, .40, .38, 1)
    nodes['Iridescent violet-teal sheen'].inputs[7].default_value = (*linear(rim or PALETTE['rim']), 1)
    nodes['MS cool recessed flesh'].inputs[2].default_value = (.80, .80, .84, 1)
    nodes['MS warm convex flesh'].inputs[2].default_value = (1.12, 1.10, 1.06, 1)
    # Dark fur shows its locks through light, not value: a stronger lock relief than the skin default.
    nodes['Fleshy fold relief'].inputs['Strength'].default_value = .55 * softness
    nodes['Fleshy fold relief'].inputs['Distance'].default_value = .03
    material['FD_SurfaceKind'] = 'rabbit-fur'
    return material


def tip_glow(material, strength):
    """Void glow from the FD_Glow mask (G = how strongly a point glows), broken up by a slow
    flicker so it reads as living light, hottest where the mask is full. Strength is a socket."""
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bs = nodes['Principled BSDF']
    rest = nodes['Rest-pose skin coordinates'].outputs['Vector']

    def node(kind, label):
        out = nodes.new(kind)
        out.name = out.label = label
        return out

    def math_node(op, a, b, label):
        out = node('ShaderNodeMath', label)
        out.operation = op
        for socket, value in zip(out.inputs, (a, b)):
            if isinstance(value, (int, float)):
                socket.default_value = value
            else:
                links.new(value, socket)
        return out.outputs[0]
    mask = node('ShaderNodeVertexColor', 'Void glow mask')
    mask.layer_name = 'FD_Glow'
    split = node('ShaderNodeSeparateColor', 'Void glow mask channels')
    links.new(mask.outputs['Color'], split.inputs[0])
    flicker = node('ShaderNodeTexNoise', 'Void glow breakup')
    flicker.inputs['Scale'].default_value = 7
    flicker.inputs['Detail'].default_value = 2
    links.new(rest, flicker.inputs['Vector'])
    breakup = node('ShaderNodeMapRange', 'Glow breakup value')
    breakup.interpolation_type = 'SMOOTHSTEP'
    breakup.clamp = True
    for name, v in (('From Min', .30), ('From Max', .70), ('To Min', .55), ('To Max', 1.1)):
        breakup.inputs[name].default_value = v
    links.new(flicker.outputs['Fac'], breakup.inputs['Value'])
    glow = math_node('MINIMUM', math_node('MULTIPLY', split.outputs[1], breakup.outputs[0], 'Void glow'), 1, 'Clamped void glow')
    hot = node('ShaderNodeMix', 'Void glow colour')
    hot.data_type = 'RGBA'
    hot.inputs[6].default_value = (*VOID, 1)
    hot.inputs[7].default_value = (*VOID_HOT, 1)
    links.new(math_node('MULTIPLY', glow, glow, 'Hot glow cores'), hot.inputs[0])
    emission = node('ShaderNodeMix', 'Void emission colour')
    emission.data_type = 'RGBA'
    emission.inputs[6].default_value = (0, 0, 0, 1)
    links.new(glow, emission.inputs[0])
    links.new(hot.outputs[2], emission.inputs[7])
    links.new(emission.outputs[2], bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value = strength
    # The fur around the glow takes on the void colour even where it does not glow.
    base = bs.inputs['Base Color'].links[0].from_socket
    tinted = node('ShaderNodeMix', 'Void-tinted fur')
    tinted.data_type = 'RGBA'
    links.new(math_node('MULTIPLY', glow, .45, 'Void tint'), tinted.inputs[0])
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


def rabbit_eye(c, side, mats, eye_scale):
    """A large bulging eye set into the side of the skull under a heavy furred lid: a hooded stare.
    Large on purpose: the eyes carry the runtime eye glow that marks enemies at night."""
    r = .115 * eye_scale
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


def leaf(c, name, path, widths, thickness, cup, material, side):
    """Closed, cupped ear blade along `path`; the flat face looks up, the edges curl down.

    Returns the object and per vertex (t along the ear, |cos| across = 1 at the edge, sin = top side).
    """
    n = 20
    vertices, plan = [], []
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
            half = widths[i]
            # A shallow groove runs down the middle of the ear's back.
            groove = .010 * math.exp(-(ca / .35) ** 2) * max(0, sa) * math.sin(math.pi * t)
            offset = lateral * (half * ca) + up * (thickness[i] * sa - cup * half * ca * ca - groove)
            vertices.append(tuple(p + offset))
            plan.append((t, abs(ca), sa))
    faces = []
    for i in range(count - 1):
        for j in range(n):
            faces.append((i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j))
    for k, p in ((0, path[0]), (count - 1, path[-1])):
        centre = len(vertices)
        vertices.append(tuple(p))
        plan.append((k / (count - 1), 0, 0))
        ring = [k * n + j for j in range(n)]
        faces += [(centre, ring[(j + 1) % n], ring[j]) for j in range(n)]
    ob = mesh_object(c, name, vertices, faces, [material])
    outward_normals(ob.data)
    return ob, plan


def ear(c, side, hull, material, ear_yaw):
    """A long ear held out to the side and back, sagging towards its glowing void tip."""
    length, width, stations = EAR['length'], EAR['width'], 26
    root = Vector(at(.90, side * .11, .95))
    yaw0, bend = math.radians(ear_yaw), math.radians(EAR['bend'])
    q = root.copy()
    step = length / (stations - 1)
    path = []
    for k in range(stations):
        t = k / (stations - 1)
        if k:
            yaw = yaw0 + bend * t
            q = q + Vector((side * math.sin(yaw), -math.cos(yaw), 0)) * step
        # Held out over (and past) the body outline, sagging towards the tip, never into the fur.
        surface = hull.height(q.x, q.y)
        held = root.z + .03 - EAR['droop'] * t ** 1.5
        path.append(Vector((q.x, q.y, max(held, surface + .07 if surface is not None else held))))
    profile = [(0, .52), (.12, .82), (.38, 1.0), (.66, .90), (.86, .62), (.96, .34), (1, .10)]

    def width_at(t):
        for (ta, a), (tb, b) in zip(profile, profile[1:]):
            if ta <= t <= tb:
                return a + (b - a) * smoothstep(ta, tb, t)
        return profile[-1][1]
    widths = [width * width_at(k / (stations - 1)) for k in range(stations)]
    thick = [.040 - .018 * k / (stations - 1) for k in range(stations)]
    ob, plan = leaf(c, f'Rabbit {"left" if side < 0 else "right"} ear', path, widths, thick, .42, material, side)
    # FD_Pattern: dark tip and pale violet edge rim, a darker groove; FD_Glow G: the glowing tip,
    # brightest at the very end and fading back over the dark tip.
    tip = EAR['tip']
    mesh = ob.data
    pattern = mesh.color_attributes.new(name='FD_Pattern', type='FLOAT_COLOR', domain='POINT')
    mask = mesh.color_attributes.new(name='FD_Glow', type='FLOAT_COLOR', domain='POINT')
    colours, glow = [], []
    for t, edge, top in plan:
        dark_tip = smoothstep(1 - tip * 1.25, 1 - tip * .35, t)
        root_shade = (.80 + .20 * smoothstep(0, .25, t)) * (1 - .18 * math.exp(-(edge / .25) ** 2) * max(0, top))
        colours.extend((root_shade * (1 - dark_tip), .85 * smoothstep(.55, .98, edge) * (1 - dark_tip), .15, 1))
        lit = smoothstep(1 - tip * 1.4, 1 - tip * .3, t) * (.75 + .25 * smoothstep(.90, 1, t))
        glow.extend((0, lit, 0, 1))
    pattern.data.foreach_set('color', colours)
    mask.data.foreach_set('color', glow)
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
    if hind:  # a full, rounded paw at the end of the long foot
        ball = end - (end - ankle).normalized() * .16
        parts.append(ell(c, f'{leg} furred paw ball', (ball.x, ball.y, .07), (width * 1.15, .20, .075), material,
                         angle=heading - math.pi / 2))
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
    return join(parts, f'{leg} broad paw ({"long hind foot" if hind else "forepaw"})')


def paint_limb(ob, top_light=.62, paw_light=0):
    """Leg fur with pale undersides; `paw_light` lightens the top of a foot so it reads from above."""
    def sampler(p, n):
        rim = max(.80 * smoothstep(.35, -.25, n.z), paw_light * smoothstep(-.1, .6, n.z))
        return top_light - .18 * smoothstep(.15, .0, p.z), rim, .2
    paint_pattern(ob, sampler)


def build_leg(c, leg, rows, materials):
    side = -1 if leg.endswith('left') else 1
    section = section_of(rows)
    L, W, th = LENGTH, WIDTH, LEG_THICKNESS
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
        # Hip, knee, hock tucked under the haunch, and the long foot whose paw shows beside it.
        hock = (FOOT['hock'] * W, -1.12 * L, .12)
        joints = leg_points([(.40 * W, -.80 * L, .55), (.58 * W, -.50 * L, .30), hock], side)
        toe_y = hock[1] + FOOT['length']
        tip = Vector((side * (section(toe_y)[0] + FOOT['out']), toe_y, .03))
        d = (tip - joints[2]).to_2d()
        a = -side * FOOT['splay']  # turn the toes outwards about the hock
        d = Vector((d.x * math.cos(a) - d.y * math.sin(a), d.x * math.sin(a) + d.y * math.cos(a)))
        tip = Vector((joints[2].x + d.x, joints[2].y + d.y, .03))
        thigh = horn(c, f'{leg} thigh', joints[:2], [.19 * th, .11 * th], fur_mat, sides=16)
        knee_ball = ell(c, f'{leg} knee', tuple(joints[1]), (.10 * th,) * 3, fur_mat)
        shin = horn(c, f'{leg} shin', joints[1:], [.09 * th, .065 * th], fur_mat, sides=14)
        foot = paw(c, leg, joints[2], tip, .095 * FOOT['width'], fur_mat, claw, toes=4, hind=True, toe_scale=FOOT['toes'])
        segments = dict(thigh=[thigh], shin=[knee_ball, shin], foot=[foot])
        names = REAR_SEGMENTS
    for segment, objects in segments.items():
        for ob in objects:
            paint_limb(ob, paw_light=FOOT['light'] if segment == 'foot' and leg.startswith('rear') else 0)
            write_rest(ob)
            c.paint_form_mask(ob, lambda p: .62 + .38 * max(0, min(1, p.z / .4)))
    return dict(joints=joints, tip=tip, segments=segments, names=names, side=side)


def paint_body(ob, rows, eyes):
    section = section_of(rows)
    neck = NECK * LENGTH

    def sampler(p, n):
        w = .36 if p.y > neck else section(p.y)[0]
        across = min(1, abs(p.x) / max(w, .05))
        flank = 1 - PALETTE['saddle'] * (1 - smoothstep(.10, .85, across))
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


def fringe(c, name, source, material, keep, lean, length, weights, spacing=.065, seed=5):
    """Soft fur locks over the side-facing coat of `source`: seen from above they break the smooth
    shell into fur along the outline. Each lock is a slightly folded tapering card; its tip is
    painted with the pale violet rim. Render-only detail: the shadow proxy keeps the volume.

    keep(p, n) selects root points, lean(p, n) gives the lock direction, length(rng) its length
    and weights(p) the bone weights every vertex of that lock receives.
    """
    rng = random.Random(seed)
    matrix, rotation = source.matrix_world, source.matrix_world.to_3x3()
    candidates = [(matrix @ v.co, (rotation @ v.normal).normalized()) for v in source.data.vertices]
    candidates = [(p, n) for p, n in candidates if keep(p, n)]
    rng.shuffle(candidates)
    cells, roots = {}, []
    for p, n in candidates:
        key = tuple(int(math.floor(v / spacing)) for v in p)
        near = [q for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)
                for q in cells.get((key[0] + dx, key[1] + dy, key[2] + dz), ())]
        if all((q - p).length >= spacing for q in near):
            cells.setdefault(key, []).append(p)
            roots.append((p, n))
    vertices, faces, plan, binding = [], [], [], []
    for p, n in roots:
        d = lean(p, n).normalized()
        side = d.cross(n)
        side = side.normalized() if side.length > 1e-6 else Vector((1, 0, 0))
        out = side.cross(d).normalized()
        if out.dot(n) < 0:
            out = -out
        size = length(rng)
        width = size * rng.uniform(.16, .24)
        base = p - n * .010
        start = len(vertices)
        for k, t in enumerate((0, .3, .6, 1)):
            centre = base + d * size * t + out * (.008 * math.sin(math.pi * t) + .004)
            w = width * (1 - .88 * t)
            for u in (-1, 0, 1):
                vertices.append(tuple(centre + side * w * u + out * (.006 * (1 - abs(u)))))
                plan.append(t)
                binding.append(weights(p))
            if k:
                row, prev = start + k * 3, start + (k - 1) * 3
                faces += [(prev, prev + 1, row + 1, row), (prev + 1, prev + 2, row + 2, row + 1)]
    ob = mesh_object(c, name, vertices, faces, [material])
    colours = []
    for t in plan:
        colours.extend((.85, .30 + .40 * t, .25, 1))
    attr = ob.data.color_attributes.new(name='FD_Pattern', type='FLOAT_COLOR', domain='POINT')
    attr.data.foreach_set('color', colours)
    write_rest(ob)
    c.paint_form_mask(ob, lambda p: .78)
    ob['meshShadowDetail'] = True
    return ob, binding


def build(c, spec):
    draft, model = spec.get('draft') or {}, spec.get('model') or {}
    option = lambda name, default: draft.get(name, model.get(name, default))
    ear_yaw, eye_scale = float(option('earYaw', EAR['yaw'])), float(option('eyeScale', 1))
    voxel = .014 * draft.get('voxelScale', 1)
    hide = fur(c, 'Rabid Rabbit dense nightshade fur', 1.55)
    limb_fur = fur(c, 'Rabid Rabbit leg fur', 1.8, softness=.7)
    ear_fur = fur(c, 'Rabid Rabbit ear fur', 2.1, softness=.6, dark=PALETTE['earTip'], light=PALETTE['earBack'], rim=PALETTE['earRim'])
    tail_fur = fur(c, 'Rabid Rabbit tail tuft', 1.6, softness=.5, light=PALETTE['tail'])
    lock_fur = fur(c, 'Rabid Rabbit outline fur locks', 2.2, softness=.4)
    mats = {
        'eyeball': glossy_material(c, 'Rabid Rabbit wet eyeball', linear('#0b090a'), roughness=.14),
        'iris': ring_iris(c, 'Rabid Rabbit violet ring iris', EYE_TONES, EYE_GLOW),
        'claw': glossy_material(c, 'Rabid Rabbit dark claws', linear(PALETTE['claw']), roughness=.38),
        'tooth': glossy_material(c, 'Rabid Rabbit long incisors', IVORY, roughness=.34),
        'nose': c.material('Rabid Rabbit nose leather', linear(PALETTE['nose'])),
        'mouth': c.material('Rabid Rabbit dark gum and mouth', linear('#24100f')),
        'limb': limb_fur,
        'lid': hide,
    }

    root = control(c.scene, 'Rabid Rabbit fixed export pivot')
    carriage = control(c.scene, 'Rabid Rabbit carriage (leap height)', parent=root)

    rows = torso_rows()
    body = fuse(c, [torso_shell(c, rows, hide), *head_parts(c, hide)], hide, voxel=voxel)
    body.name = 'Rabid Rabbit continuous fur body'
    eyes = {side: rabbit_eye(c, side, mats, eye_scale) for side in (-1, 1)}
    paint_body(body, rows, [e['centre'] for e in eyes.values()])
    write_rest(body)
    c.paint_form_mask(body, lambda p: .55 + .45 * max(0, min(1, p.z / .78)))
    hull = Surface([body])

    neck = NECK * LENGTH
    nose = Vector(at(1.60, 0, .64))
    head_extra = [ell(c, 'Rabid Rabbit nose leather', tuple(nose + Vector((0, -.01, .04))), (.055, .035, .03), mats['nose'])]
    # The hare's split upper lip runs from the nose leather down the front of the muzzle.
    head_extra.append(horn(c, 'Rabid Rabbit cleft lip', [tuple(nose + Vector((0, -.03, .025))), tuple(nose + Vector((0, .005, -.02))),
                                                         tuple(nose + Vector((0, .01, -.07)))], [.012, .010, .008], mats['nose'], sides=8))
    teeth = []
    for side in (-1, 1):
        # Upper incisors hang from under the split lip.
        base = nose + Vector((side * .027, -.05, -.07))
        teeth.append(horn(c, 'Rabid Rabbit long upper incisor', [tuple(base), tuple(base + Vector((0, .023, -.04))),
                                                                  tuple(base + Vector((0, .035, -.08)))],
                          [.023, .021, .016], mats['tooth'], sides=10))
    lower_jaw = ell(c, 'Rabid Rabbit lower jaw', tuple(nose + Vector((0, -.14, -.12))), (.12, .14, .055), hide)
    mouth = ell(c, 'Rabid Rabbit dark mouth', tuple(nose + Vector((0, -.07, -.075))), (.085, .085, .03), mats['mouth'])
    paint_pattern(lower_jaw, lambda p, n: (.9, .85, .2))
    write_rest(lower_jaw)
    c.paint_form_mask(lower_jaw, lambda p: .7)

    ears, ear_paths = {}, {}
    for side in (-1, 1):
        ears[side], ear_paths[side] = ear(c, side, hull, ear_fur, ear_yaw)
    ear_glow = tip_glow(ear_fur, TIP_GLOW)

    tail_y = rows[-1][0] + .04
    tail = ell(c, 'Rabid Rabbit tail tuft', (0, tail_y, .58), (.14, .13, .14), tail_fur)
    paint_pattern(tail, lambda p, n: (.15 + .75 * smoothstep(.2, -.3, n.z), .9 * smoothstep(.1, -.4, n.z), .2))
    write_rest(tail)
    c.paint_form_mask(tail, lambda p: .8)

    legs = {leg: build_leg(c, leg, rows, mats) for leg in LEGS}

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
    L = LENGTH
    mid = -.28 * L
    bone('root', (0, 0, 0), (0, .2, 0))
    bone('body', (0, mid, .62), (0, neck - .05, .70), 'root')
    bone('hips', (0, mid, .62), (0, -1.15 * L, .60), 'body')
    bone('head', (0, neck - .04, .74 - HEAD_DROP), (0, nose.y, .70 - HEAD_DROP), 'body')
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

    def coat(p):
        """Fur skin: head at the front, hips behind mid-back; the haunches follow the thighs and the
        shoulders the upper forelegs, so the fused coat moves with the legs instead of tearing."""
        head_w = smoothstep(neck - .12, neck + .14, p.y)
        hips_w = (1 - head_w) * smoothstep(-.10 * L, -.52 * L, p.y)
        body_w = 1 - head_w - hips_w
        side = 'left' if p.x < 0 else 'right'
        haunch = smoothstep(.16, .44, abs(p.x)) * smoothstep(-.40 * L, -.66 * L, p.y) * smoothstep(-1.32 * L, -1.02 * L, p.y)
        haunch *= smoothstep(.70, .30, p.z)
        shoulder = smoothstep(.18, .40, abs(p.x)) * math.exp(-((p.y - .44 * L) / .20) ** 2) * smoothstep(.55, .20, p.z)
        thigh_w, upper_w = .75 * haunch * hips_w, .55 * shoulder * body_w
        return [('head', head_w), ('hips', hips_w - thigh_w), ('body', body_w - upper_w),
                (f'rear_{side}_thigh', thigh_w), (f'front_{side}_upper', upper_w)]
    body.parent = carriage
    bind(body, rig, [coat(body.matrix_world @ v.co) for v in body.data.vertices])

    # Fur locks along the outline: flanks, haunches, chest ruff and cheeks sweep back and out;
    # the muzzle front, the eyes and the belly stay clean.
    eye_centres = [e['centre'] for e in eyes.values()]

    def keep(p, n):
        return (abs(n.z) < .30 and p.z > .18 and p.y < nose.y - .22
                and all((p - e).length > .20 for e in eye_centres))

    def lean(p, n):
        # Lie back along the coat, only slightly lifted off it.
        back = Vector((0, -1, -.15))
        along = back - n * back.dot(n)
        return along.normalized() + n * .22
    locks, binding = fringe(c, 'Rabid Rabbit outline fur locks', body, lock_fur, keep, lean,
                            lambda rng: rng.uniform(.06, .10), coat, spacing=.042)
    locks.parent = carriage
    bind(locks, rig, binding)
    tail_locks, tail_binding = fringe(c, 'Rabid Rabbit tail fur locks', tail, tail_fur, lambda p, n: n.z > -.30,
                                      lambda p, n: n + Vector((0, -.5, .1)), lambda rng: rng.uniform(.06, .10),
                                      lambda p: [('tail', 1)], spacing=.045, seed=9)
    tail_locks.parent = carriage
    bind(tail_locks, rig, tail_binding)

    for side, eye in eyes.items():
        rigid(eye['ball'], 'head'); rigid(eye['iris'], 'head'); rigid(eye['lid'], 'head')
    for ob in head_extra:
        rigid(ob, 'head')
    for ob in teeth:
        rigid(ob, 'head', 'incisors')
    rigid(lower_jaw, 'jaw', 'jaw'); rigid(mouth, 'jaw', 'jaw')
    rigid(ears[-1], 'ear_l', 'ear-l'); rigid(ears[1], 'ear_r', 'ear-r')
    rigid(tail, 'tail', 'tail')
    for leg, parts in legs.items():
        for segment, objects in parts['segments'].items():
            for ob in objects:
                rigid(ob, f'{leg}_{segment}', f'{leg}-{segment}')

    bpy.context.view_layer.update()
    rest = rig.data.bones['jaw']
    mouth_socket = control(c.scene, 'Rabid Rabbit mouth socket')
    mouth_socket.parent, mouth_socket.parent_type, mouth_socket.parent_bone = rig, 'BONE', 'jaw'
    mouth_socket.matrix_parent_inverse = (rest.matrix_local @ Matrix.Translation((0, rest.length, 0))).inverted()
    mouth_socket.location = tuple(nose + Vector((0, .08, -.06)))
    parts = {'carriage': carriage, 'rabbit_legs': list(LEGS), 'ear_glow': ear_glow, 'ear_glow_rest': TIP_GLOW}
    return {'root': root, 'parts': parts, 'rig': rig, 'sockets': {'mouth': mouth_socket}}
