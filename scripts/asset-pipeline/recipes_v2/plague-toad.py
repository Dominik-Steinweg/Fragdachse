"""Quacksalber (plague-toad): a broad, flat, decaying zombie toad seen from above (display 30).

A short wide head without a neck merges into a pear-shaped body; huge bulging eyes sit on top
of the head and glow through concentric iris rings around a horizontal toad pupil (an homage,
not a copy). A raised bone-and-bandage cross is stitched onto the back and glows faintly mint.
The rear legs fold in a Z beside the haunches, the short front arms turn their hands inwards.

z = 0 is the ground. Parts for plague_toad_motion_v2: `carriage` (whole animal, real hop
height), the `cross_glow` emission socket and the rig: `body`, `head`, `jaw`, `throat`,
`tongue`/`tongue_tip` (tip ignores the stem's stretch), `cross`, `lid_l`/`lid_r` (rotate about
their own Y = the eye's lateral axis) and per leg `<leg>_upper`, `<leg>_lower`, `<leg>_foot`.
Feet are the authored paw meshes `<leg> broad paw ...` used by the enemy mesh contacts.
Sockets: eyeLeft/eyeRight (irises), `mouth` (snout front, on the jaw) and `cross` (centre).
"""
import math
import bpy
from mathutils import Matrix, Vector
from rigs_v2 import control
from eye_anchors import register_eye
from recipes_v2.enemy_parts_a import smooth_path, outward_normals, horn, ell
from kraken_skin_v8 import linear, skin, paint_pattern, write_rest
from kraken_eye_parts import cap, lid_shell, glossy_material, frame
from kraken_dorsal_parts import fuse
from kraken_arm_parts import bind, creases, smoothstep
from zombie_surface_parts import Surface, patch, oval, mesh_object, weather
from zombie_detail_parts import wound, scar

LEGS = ('front_left', 'front_right', 'rear_left', 'rear_right')
DOME = .9
# Front to rear: y, half width, underside z, dome height. A short broad head merges into
# the body without a neck; the body is widest behind the middle, then rounds off.
PROFILE = [
    (1.40, .06, .15, .05),
    (1.32, .40, .11, .19),
    (1.16, .64, .09, .29),
    (0.92, .79, .08, .35),
    (0.62, .86, .08, .40),
    (0.30, .93, .08, .47),
    (0.00, 1.00, .08, .55),
    (-0.34, 1.03, .08, .60),
    (-0.68, .96, .09, .60),
    (-0.98, .79, .11, .53),
    (-1.20, .54, .14, .40),
    (-1.34, .26, .17, .23),
    (-1.40, .05, .20, .06),
]
EYE = (.49, .76, .29)  # right eye x, y, radius; the eyes sit on top of the head
EYE_LOOK = (34, 50)  # yaw outwards, pitch upwards (degrees): the iris faces the sky
CROSS = (0, -.40)
CROSS_ARMS = (.60, .56, .20)  # vertical half length, horizontal half length, pad half width
# Right side joints (mirrored): the rear legs fold in a Z beside the haunches.
FRONT = dict(joints=[(.60, .40, .30), (1.04, .40, .19), (.98, .76, .08)], radii=[.17, .15, .11],
             heading=112, reach=.12, digits=[(-44, .15), (-14, .22), (15, .21), (44, .14)])
REAR = dict(joints=[(.58, -.80, .30), (1.32, -.32, .23), (.94, -1.16, .11)], radii=[.25, .20, .11],
            heading=16, reach=.38, digits=[(-50, .23), (-24, .34), (0, .44), (22, .38), (44, .25)])
# Dark moss blotches on the back (x, y, radius) for the authored value plan.
BLOTCHES = [(.36, -.10, .20), (-.44, -.02, .18), (.16, -.98, .19), (-.30, -.90, .16), (.66, -.58, .15),
            (-.68, -.50, .14), (.04, .36, .15), (.44, .98, .10), (-.40, 1.02, .10), (.80, .10, .12), (-.82, .18, .12)]
WARTS = [(.30, .32, .07), (-.28, .26, .06), (.52, -.18, .08), (-.56, -.14, .07), (.74, -.30, .06), (-.76, -.34, .06),
         (.38, -.70, .07), (-.40, -.72, .08), (.62, -.86, .06), (-.62, -.90, .06), (.20, -1.16, .06), (-.18, -1.18, .06),
         (.86, -.62, .05), (-.88, -.64, .05), (.12, .12, .05), (-.10, .08, .05), (.70, .52, .05), (-.72, .50, .05)]
EYE_TONES = {
    'violet': ('#f2dcff', '#b450ff', '#5d1aa6', '#1b0631'),
    'amber': ('#ffe7b5', '#ff9a2c', '#a64b0e', '#2a1004'),
}
MINT = linear('#8fe6c2')


def sections():
    points, heights = smooth_path([(w, y, z) for y, w, z, _ in PROFILE], [h for *_, h in PROFILE], steps=6)
    rows = [(p[1], p[0], p[2], h) for p, h in zip(points, heights)]

    def section(y):
        if y >= rows[0][0]:
            return rows[0][1:]
        for (ya, *a), (yb, *b) in zip(rows, rows[1:]):
            if yb <= y <= ya:
                t = (ya - y) / ((ya - yb) or 1)
                return tuple(u + (v - u) * t for u, v in zip(a, b))
        return rows[-1][1:]
    return rows, section


def body_shell(c, material):
    rows, section = sections()

    def surface(x, y):
        w, z, h = section(y)
        crown = math.sqrt(max(0, 1 - (x / max(w, .01)) ** 2))
        return z + h * crown ** DOME

    vertices, faces, sides = [], [], 72
    for y, w, z, h in rows:
        for j in range(sides):
            a = math.tau * j / sides
            s = math.sin(a)
            lift = h * s ** DOME if s > 0 else z * .9 * s  # flat belly resting on the ground
            vertices.append((w * math.cos(a), y, z + lift))
    for i in range(len(rows) - 1):
        for j in range(sides):
            faces.append((i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j))
    faces.extend([tuple(range(sides - 1, -1, -1)), tuple((len(rows) - 1) * sides + j for j in range(sides))])
    mesh = bpy.data.meshes.new('Quacksalber broad toad body')
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(mesh.name, mesh)
    c.scene.collection.objects.link(ob)
    return ob, surface, section


def anatomy(c, surface, material):
    """Eye turrets, parotoid glands, a bony cranial crest, an upper lip and warts, all fused later."""
    parts = []
    ex, ey, er = EYE
    for side in (-1, 1):
        parts.append(ell(c, 'Raised eye turret', (side * ex, ey - .02, surface(ex, ey) - .10), (er * 1.22, er * 1.30, er * .95), material))
        gland = ell(c, 'Swollen parotoid gland', (side * .60, .22, surface(.60, .22) - .06), (.21, .38, .14), material,
                    taper=.12, angle=side * .22)
        parts.append(gland)
        crest = [(side * .24, 1.02, surface(.24, 1.02) - .015), (side * .27, .78, surface(.27, .78) + .005),
                 (side * .31, .50, surface(.31, .50) - .02)]
        parts.append(horn(c, 'Bony cranial crest', crest, [.035, .055, .03], material, sides=10))
        lip = [(side * (w - .04), y, z + .035) for y in (.78, .95, 1.10, 1.22, 1.31) for w, z, _ in [sections()[1](y)]]
        parts.append(horn(c, 'Heavy upper lip', lip + [(side * .02, 1.39, .17)], [.05, .05, .05, .045, .04, .035], material, sides=10))
    for x, y, r in WARTS:
        parts.append(ell(c, 'Raised dorsal wart', (x, y, surface(x, y) - r * .35), (r, r, r * .75), material))
    return parts


def paint_body(ob, section, eye_centres):
    """Dead olive flanks, a dark mottled saddle, a pale belly rim and pale eye turret rims."""
    def sampler(p, n):
        w, _, _ = section(p.y)
        across = abs(p.x) / max(w, .05)
        flank = .34 + .58 * smoothstep(.15, .90, across)
        blot = max(math.exp(-((p.x - x) ** 2 + (p.y - y) ** 2) / (r * r)) for x, y, r in BLOTCHES)
        flank *= 1 - .68 * blot
        belly = smoothstep(.55, .0, n.z)
        rim = .95 * belly
        for x, y in eye_centres:
            d = math.hypot(p.x - x, p.y - y)
            flank += .35 * math.exp(-((d - .30) / .08) ** 2)
        return flank, rim, .25 + .55 * across
    paint_pattern(ob, sampler)


def toad_skin(c, name, rim=linear('#c4c4b8'), dark=linear('#34352e'), light=linear('#8d8e7e'), softness=1):
    """Kraken V8 dermis retuned to dead toad hide: olive pigment, bruise mottling, no violet sheen."""
    material = skin(c, name, dark, light, rim=rim, softness=softness, roughness=(.50, .66))
    nodes = material.node_tree.nodes
    nodes['Iridescent violet-teal sheen'].inputs[7].default_value = (*linear('#5f6558'), 1)
    tint = nodes['MS blue violet plum tint']
    tint.inputs[1].default_value = (.94, 1.05, .90, 1)
    tint.inputs[2].default_value = (1.08, .88, 1.06, 1)
    nodes['MS pigment tint strength'].inputs[1].default_value = .45
    nodes['MS deep pigment cells'].inputs[2].default_value = (.40, .40, .36, 1)
    nodes['MS cell strength'].inputs[1].default_value = .38
    nodes['MS cool recessed flesh'].inputs[2].default_value = (.80, .82, .88, 1)
    nodes['MS warm convex flesh'].inputs[2].default_value = (1.16, 1.14, 1.10, 1)
    return material


def ring_iris(c, name, tones, strength):
    """Concentric glowing rings around a horizontal toad pupil, with faint radial fibres."""
    core, bright, mid, dark = (linear(t) for t in tones)
    material = c.material(name, bright)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bs = nodes.get('Principled BSDF')
    uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'FD_Iris'
    centred = nodes.new('ShaderNodeVectorMath'); centred.operation = 'SUBTRACT'
    centred.inputs[1].default_value = (.5, .5, 0)
    links.new(uv.outputs['UV'], centred.inputs[0])
    xyz = nodes.new('ShaderNodeSeparateXYZ'); links.new(centred.outputs[0], xyz.inputs[0])
    radius = nodes.new('ShaderNodeVectorMath'); radius.operation = 'LENGTH'
    links.new(centred.outputs[0], radius.inputs[0])
    rings = nodes.new('ShaderNodeValToRGB'); rings.color_ramp.interpolation = 'EASE'
    stops = [(0, core), (.07, bright), (.12, dark), (.18, bright), (.24, dark), (.30, bright), (.37, mid), (.43, dark),
             (.50, tuple(v * .25 for v in dark))]
    elements = rings.color_ramp.elements
    for i, (pos, color) in enumerate(stops):
        e = elements[i] if i < 2 else elements.new(pos)
        e.position, e.color = pos, (*color, 1)
    links.new(radius.outputs['Value'], rings.inputs[0])
    angle = nodes.new('ShaderNodeMath'); angle.operation = 'ARCTAN2'
    links.new(xyz.outputs['Y'], angle.inputs[0]); links.new(xyz.outputs['X'], angle.inputs[1])
    polar = nodes.new('ShaderNodeCombineXYZ'); links.new(angle.outputs[0], polar.inputs['X'])
    fibres = nodes.new('ShaderNodeTexNoise')
    fibres.inputs['Scale'].default_value = 7; fibres.inputs['Detail'].default_value = 3
    links.new(polar.outputs[0], fibres.inputs['Vector'])
    fibre = nodes.new('ShaderNodeMapRange')
    fibre.inputs['From Min'].default_value = .3; fibre.inputs['From Max'].default_value = .7
    fibre.inputs['To Min'].default_value = .70; fibre.inputs['To Max'].default_value = 1.10
    links.new(fibres.outputs['Fac'], fibre.inputs['Value'])
    fibred = nodes.new('ShaderNodeMix'); fibred.data_type = 'RGBA'; fibred.blend_type = 'MULTIPLY'
    fibred.inputs[0].default_value = 1
    links.new(rings.outputs[0], fibred.inputs[6]); links.new(fibre.outputs[0], fibred.inputs[7])
    # Horizontal toad pupil: wide across the eye, tapering at both ends.
    along = nodes.new('ShaderNodeMath'); along.operation = 'ABSOLUTE'
    links.new(xyz.outputs['Y'], along.inputs[0])
    across = nodes.new('ShaderNodeMath'); across.operation = 'MULTIPLY'
    links.new(xyz.outputs['X'], across.inputs[0]); links.new(xyz.outputs['X'], across.inputs[1])
    taper = nodes.new('ShaderNodeMapRange')
    taper.inputs['From Min'].default_value = 0; taper.inputs['From Max'].default_value = .026
    taper.inputs['To Min'].default_value = .045; taper.inputs['To Max'].default_value = 0
    links.new(across.outputs[0], taper.inputs['Value'])
    slit = nodes.new('ShaderNodeMath'); slit.operation = 'LESS_THAN'
    links.new(along.outputs[0], slit.inputs[0]); links.new(taper.outputs[0], slit.inputs[1])
    pupil = nodes.new('ShaderNodeMix'); pupil.data_type = 'RGBA'
    links.new(slit.outputs[0], pupil.inputs[0])
    links.new(fibred.outputs[2], pupil.inputs[6]); pupil.inputs[7].default_value = (.005, .002, .006, 1)
    links.new(pupil.outputs[2], bs.inputs['Base Color'])
    links.new(pupil.outputs[2], bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value = strength
    bs.inputs['Roughness'].default_value = .2
    bs.inputs['Specular IOR Level'].default_value = .45
    material['FD_SurfaceKind'] = 'toad-ring-iris'
    return material


def toad_eye(c, side, mats, surface, eye_scale):
    ex, ey, er = EYE
    er *= eye_scale
    x = side * ex
    centre = Vector((x, ey, surface(x, ey) + er * .30))
    yaw, pitch = (math.radians(v) for v in EYE_LOOK)
    look = Vector((side * math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    f, r, u = frame(look)
    name = ('Left' if side < 0 else 'Right') + ' bulging eye'
    ball = c.ell(name + ' wet eyeball', tuple(centre), (er, er, er), mats['ball'])
    iris = cap(c, name + ' ringed iris', centre, er * 1.012, f, r, u, math.radians(47), mats['iris'], uv=True)
    lid = lid_shell(c, name + ' heavy upper lid', centre, er, f, r, u, math.radians(-150), math.radians(10),
                    math.radians(74), mats['lid'], thickness=.02)
    for ob in (ball, iris, lid):
        write_rest(ob)
    register_eye(c, side, iris)
    return dict(ball=ball, iris=iris, lid=lid, centre=centre, axis=r, up=u)


def cross_outline(cx, cy):
    v, h, w = CROSS_ARMS
    corners = [(w, v), (-w, v), (-w, w), (-h, w), (-h, -w), (-w, -w), (-w, -v), (w, -v), (w, -w), (h, -w), (h, w), (w, w)]
    points = []
    for k, (a, b) in enumerate(corners):
        a2, b2 = corners[(k + 1) % len(corners)]
        steps = max(2, round(math.hypot(a2 - a, b2 - b) / .07))
        for i in range(steps):
            t = i / steps
            wobble = .018 * math.sin(len(points) * 2.3) + .010 * math.sin(len(points) * 5.1)
            px, py = a + (a2 - a) * t, b + (b2 - b) * t
            length = math.hypot(px, py) or 1
            points.append((cx + px * (1 + wobble / length), cy + py * (1 + wobble / length)))
    return points


def stitched_cross(c, surface, mats):
    """Bandage pad stitched onto the back, two bleached bone splints lashed across it."""
    cx, cy = CROSS
    v, h, w = CROSS_ARMS
    outline = cross_outline(cx, cy)
    parts = [patch(c, 'Stitched bandage cross pad', surface, outline, mats['bandage'], lift=.035, crown=.035)]
    pad = .07

    def on_skin(x, y, lift):
        return surface.point(x, y, lift)
    shaft = [on_skin(cx, cy + v * t, pad + .085) for t in (.82, .45, 0, -.45, -.82)]
    parts.append(horn(c, 'Bleached vertical bone splint', shaft, [.085, .07, .075, .07, .085], mats['bone'], sides=14))
    across = [on_skin(cx + h * t, cy, pad + .085 + .09 * math.exp(-(t / .28) ** 2)) for t in (-.84, -.45, 0, .45, .84)]
    parts.append(horn(c, 'Bleached cross bone splint', across, [.08, .065, .07, .065, .08], mats['bone'], sides=14))
    for t in (-1, 1):
        x, y, z = on_skin(cx, cy + v * .86 * t, pad + .085)
        parts.append(ell(c, 'Knobbed bone end', (x, y, z), (.13, .085, .085), mats['bone']))
        x, y, z = on_skin(cx + h * .88 * t, cy, pad + .085)
        parts.append(ell(c, 'Knobbed bone end', (x, y, z), (.085, .13, .085), mats['bone']))
    # Lashing over the crossing and at each splint end.
    for a in (-.62, .62):
        band = [on_skin(cx + .17 * s, cy + .17 * s * math.tan(a * 1.1), pad + .20 - .05 * abs(s)) for s in (-1, -.5, 0, .5, 1)]
        parts.append(horn(c, 'Dirty bandage lashing', band, [.025, .035, .04, .035, .025], mats['bandage'], sides=10))
    for t in (-1, 1):
        band = [on_skin(cx + s * .15, cy + v * .55 * t, pad + .02 + .15 * (1 - s * s)) for s in (-1, -.5, 0, .5, 1)]
        parts.append(horn(c, 'Bandage wrap on splint', band, [.02, .035, .04, .035, .02], mats['bandage'], sides=10))
        band = [on_skin(cx + h * .55 * t, cy + s * .15, pad + .02 + .15 * (1 - s * s)) for s in (-1, -.5, 0, .5, 1)]
        parts.append(horn(c, 'Bandage wrap on splint', band, [.02, .035, .04, .035, .02], mats['bandage'], sides=10))
    # Coarse sutures across the pad edge pin the cross into the hide.
    for k, (x, y) in enumerate(outline[::3]):
        dx, dy = x - cx, y - cy
        length = math.hypot(dx, dy) or 1
        nx, ny = dx / length, dy / length
        points = [on_skin(x + nx * .06, y + ny * .06, .02), on_skin(x, y, .075), on_skin(x - nx * .06, y - ny * .06, .055)]
        parts.append(horn(c, 'Coarse dark suture', points, [.012, .016, .012], mats['thread'], sides=8))
    return parts


def leg_points(spec, side):
    return [(side * x, y, z) for x, y, z in spec['joints']]


def paw(c, name, spec, side, material, webbed, stump=None):
    """A webbed rear foot or a grasping front hand, joined into one authored paw mesh."""
    ankle = Vector(leg_points(spec, side)[-1])
    heading = math.radians(spec['heading'] if side > 0 else 180 - spec['heading'])
    d = Vector((math.cos(heading), math.sin(heading), 0))
    end = ankle + d * spec['reach']
    end.z = .045
    parts = [ell(c, name + ' sole', tuple((ankle + end) / 2 + Vector((0, 0, .02))),
                 (.075 if webbed else .085, (spec['reach'] / 2 + .06), .05), material, angle=heading - math.pi / 2)]
    tips = []
    for k, (offset, length) in enumerate(spec['digits']):
        a = heading + math.radians(offset if side > 0 else -offset)
        u = Vector((math.cos(a), math.sin(a), 0))
        if stump == k:
            length *= .35
        tip = end + u * length
        tip.z = .035
        tips.append((end + u * length * .78, tip))
        parts.append(horn(c, name + ' toe', [tuple(end), tuple(end + u * length * .55 + Vector((0, 0, .015))), tuple(tip)],
                          [.062, .05, .038 if stump != k else .045], material, sides=10))
        if stump != k:
            parts.append(ell(c, name + ' toe pad', tuple(tip), (.052, .052, .036), material))
    if webbed:
        rim = []
        for k, (inner, tip) in enumerate(tips):
            rim.append(tuple(inner))
            if k + 1 < len(tips):
                rim.append(tuple(end + (tips[k][0] - end + tips[k + 1][0] - end) * .32))
        vertices = [tuple(end)] + [(x, y, .03) for x, y, _ in rim]
        faces = [(0, i, i + 1) for i in range(1, len(vertices) - 1)]
        web = mesh_object(c, name + ' webbing', vertices, faces, [material])
        solid = web.modifiers.new('Thin webbing', 'SOLIDIFY')
        solid.thickness = .018
        parts.append(web)
    bpy.context.view_layer.update()
    for ob in parts:
        ob.select_set(False)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    out.name = f'{name} broad paw ({"webbed foot" if webbed else "grasping hand"})'
    return out, tuple(end)


def paint_limb(ob, joints, tip=None):
    """Banded upper sides, pale undersides, darker toe tips."""
    def along(p):
        best, run, total = 9, 0, 0
        for a, b in zip(joints, joints[1:]):
            a, b = Vector(a), Vector(b)
            seg = b - a
            t = max(0, min(1, (p - a).dot(seg) / max(seg.length_squared, 1e-8)))
            d = (a + seg * t - p).length
            if d < best:
                best, total = d, run + t * seg.length
            run += seg.length
        return total

    def sampler(p, n):
        s = along(p)
        band = .5 + .5 * math.sin(s * 15)
        flank = .42 + .30 * band
        if tip is not None:
            flank *= 1 - .45 * smoothstep(.15, .38, (p - Vector(tip)).length)
        return flank, .85 * smoothstep(.55, .0, n.z), .3
    paint_pattern(ob, sampler)


def ring_weights(points, cuts, names, blend):
    """Partition of unity along a polyline (arc length); `cuts` are joint arc positions."""
    arc, s = [0], 0
    for a, b in zip(points, points[1:]):
        s += (Vector(b) - Vector(a)).length
        arc.append(s)
    out = []
    for value in arc:
        t = [smoothstep(cut - width, cut + width, value) for cut, width in zip(cuts, blend)] + [0]
        previous = 1
        weights = []
        for name, current in zip(names, t):
            weights.append((name, previous - current))
            previous = current
        out.append(weights)
    return out, arc


def build_leg(c, leg, spec, side, material, rest=None):
    joints = leg_points(spec, side)
    tube = horn(c, f'{leg} warty limb', joints, spec['radii'], material, sides=14)
    sampled, _ = smooth_path(joints, spec['radii'])
    paw_mesh, end = paw(c, leg, spec, side, material, webbed=leg.startswith('rear'), stump=rest)
    for ob in (tube, paw_mesh):
        paint_limb(ob, joints + [end], tip=end if ob is paw_mesh else None)
        write_rest(ob)
        c.paint_form_mask(ob, lambda p: .62 + .38 * max(0, min(1, p.z / .3)))
    return tube, sampled, paw_mesh, joints, end


def details(c, surface, mats):
    """Restrained decay: a torn flank wound with ribs, a burst gland and a sutured scar."""
    palette = dict(skin=mats['wound_rim'], wound=mats['wound'], muscle=mats['flesh'], rust=mats['thread'])
    body, head = [], []
    body += wound(c, surface, -.78, -.28, .16, .24, palette, angle=.35, seed=7)
    for k in range(3):
        y = -.40 + k * .11
        rib = [surface.point(-.66 - .02 * k, y, .035), surface.point(-.78, y + .015, .05), surface.point(-.90 + .02 * k, y, .035)]
        body.append(horn(c, 'Exposed rotten rib', rib, [.018, .026, .018], mats['bone'], sides=8))
    body.append(patch(c, 'Burst parotoid crust', surface, oval(.60, .18, .11, .17, .2, .25, 3), mats['wound'], lift=.02))
    body.append(patch(c, 'Oozing gland flesh', surface, oval(.60, .20, .06, .09, .2, .3, 5), mats['flesh'], lift=.03))
    body += scar(c, surface, (.52, -.95), (.86, -.52), palette, count=4, width=.05)
    return body, head


def build(c, spec):
    draft = spec.get('draft') or {}
    model = spec.get('model') or {}
    eye_scale = model.get('eyeScale', 1)
    tones = EYE_TONES[model.get('eyeGlow', 'violet')]
    hide = toad_skin(c, 'Quacksalber warty dead hide')
    limb_hide = toad_skin(c, 'Quacksalber banded limb hide', softness=.8)
    throat_hide = toad_skin(c, 'Quacksalber translucent throat sac', rim=linear('#d3cdd0'), dark=linear('#5a565b'),
                            light=linear('#b2acb0'), softness=.5)
    bsdf = throat_hide.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Subsurface Weight'].default_value = .38
    bsdf.inputs['Subsurface Radius'].default_value = (.9, .45, .8)
    mats = {
        'ball': glossy_material(c, 'Quacksalber wet violet-black eyeball', linear('#130a17'), roughness=.2),
        'iris': ring_iris(c, 'Quacksalber hypnotic ring iris', tones, 3.6),
        'lid': toad_skin(c, 'Quacksalber heavy eyelids', softness=.7),
        'bandage': c.material('Quacksalber soaked bandage', linear('#c3c8bb'), 'organic'),
        'bone': c.material('Quacksalber bleached splint bone', linear('#d0cfc5'), 'organic'),
        'thread': c.material('Quacksalber dark suture thread', linear('#2a1d25')),
        'wound': c.material('Quacksalber deep rot', linear('#22090f'), 'organic'),
        'flesh': c.material('Quacksalber plum rotten flesh', linear('#552033'), 'organic'),
        'wound_rim': c.material('Quacksalber torn hide lip', linear('#3d4234'), 'organic'),
        'tongue': c.material('Quacksalber sticky mauve tongue', linear('#b8738f'), 'organic'),
        'mouth': c.material('Quacksalber dark mouth floor', linear('#3a1426'), 'organic'),
        'lip': c.material('Quacksalber pale jaw lip', linear('#8e9383'), 'organic'),
    }
    weather(mats['bandage'], cloth=True)
    for name in ('bone', 'flesh', 'wound'):
        weather(mats[name])
    pad = mats['bandage'].node_tree.nodes['Principled BSDF']
    pad.inputs['Emission Color'].default_value = (*MINT, 1)
    pad.inputs['Emission Strength'].default_value = .35
    mats['tongue'].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .42

    root = control(c.scene, 'Quacksalber fixed export pivot')
    carriage = control(c.scene, 'Quacksalber carriage (hop height)', parent=root)

    shell, surface, section = body_shell(c, hide)
    body = fuse(c, [shell, *anatomy(c, surface, hide)], hide, voxel=.014 * draft.get('voxelScale', 1))
    body.name = 'Quacksalber continuous toad body'
    eye_centres = [(side * EYE[0], EYE[1]) for side in (-1, 1)]
    paint_body(body, section, eye_centres)
    write_rest(body)
    c.paint_form_mask(body, lambda p: .55 + .45 * max(0, min(1, p.z / .72)))
    creases(body, .10, .022, subdivide=draft.get('creaseSubdivisions', 0))
    hull = Surface([body])

    top = lambda x, y: hull.height(x, y) or surface(x, y)
    eyes = {side: toad_eye(c, side, mats, top, eye_scale) for side in (-1, 1)}
    cross_parts = stitched_cross(c, hull, mats)
    wounds, _ = details(c, hull, mats)

    throat = ell(c, 'Quacksalber pale throat sac', (0, 1.08, .09), (.46, .36, .11), throat_hide)
    paint_pattern(throat, lambda p, n: (.9, .55 + .4 * smoothstep(.6, .0, n.z), .2))
    write_rest(throat)
    c.paint_form_mask(throat, lambda p: .8)
    lip_line = []
    for y in (.80, .96, 1.12, 1.24, 1.33):
        w, z, _ = section(y)
        lip_line.append((w - .09, y, .07))
    lip_line = [(-x, y, z) for x, y, z in lip_line] + [(0, 1.36, .07)] + [(x, y, z) for x, y, z in reversed(lip_line)]
    lower_lip = horn(c, 'Quacksalber lower jaw lip', lip_line, [.045] * len(lip_line), mats['lip'], sides=10)
    floor_outline = [(x * .92, y - .02, .055) for x, y, _ in lip_line]
    floor = mesh_object(c, 'Quacksalber mouth floor', [(0, .98, .05)] + floor_outline + [(.0, .70, .05)],
                        [(0, i, i + 1) for i in range(1, len(floor_outline))] + [(0, len(floor_outline), len(floor_outline) + 1),
                                                                                (0, len(floor_outline) + 1, 1)], [mats['mouth']])
    tongue = horn(c, 'Quacksalber sticky tongue', [(0, .80, .17), (0, .95, .17), (0, 1.08, .17)], [.11, .10, .09], mats['tongue'], sides=14)
    tongue_tip = ell(c, 'Quacksalber sticky tongue tip', (0, 1.15, .17), (.13, .10, .075), mats['tongue'])

    legs = {}
    for leg in LEGS:
        side = -1 if leg.endswith('left') else 1
        legs[leg] = build_leg(c, leg, FRONT if leg.startswith('front') else REAR, side, limb_hide,
                              rest=3 if leg == 'rear_left' else None)

    # Armature: every bone rolls its Z axis up, so Euler Z is a yaw seen from the camera.
    data = bpy.data.armatures.new('Quacksalber toad rig')
    rig = bpy.data.objects.new('Quacksalber rig', data)
    c.scene.collection.objects.link(rig)
    rig.parent = carriage
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    edit = data.edit_bones

    def bone(name, head, tail, parent=None, connect=False, up=Vector((0, 0, 1))):
        b = edit.new(name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = edit[parent]
            b.use_connect = connect
        b.align_roll(up)
        return b
    bone('root', (0, 0, 0), (0, .2, 0))
    bone('body', (0, -.25, .32), (0, .35, .32), 'root')
    bone('head', (0, .40, .36), (0, 1.0, .36), 'body')
    bone('jaw', (0, .62, .10), (0, 1.20, .10), 'head')
    bone('tongue', (0, .78, .17), (0, 1.08, .17), 'jaw')
    bone('tongue_tip', (0, 1.08, .17), (0, 1.22, .17), 'tongue', connect=True)
    bone('throat', (0, .78, .08), (0, 1.18, .08), 'head')
    cz = surface(*CROSS) + .10
    bone('cross', (CROSS[0], CROSS[1], cz), (CROSS[0], CROSS[1] + .5, cz), 'body')
    for side, eye in eyes.items():
        bone('lid_l' if side < 0 else 'lid_r', eye['centre'], eye['centre'] + eye['axis'] * .2, 'head', up=eye['up'])
    for leg, (_, _, _, joints, end) in legs.items():
        bone(f'{leg}_upper', joints[0], joints[1], 'body')
        bone(f'{leg}_lower', joints[1], joints[2], f'{leg}_upper', connect=True)
        bone(f'{leg}_foot', joints[2], end, f'{leg}_lower', connect=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.pose.bones['tongue_tip'].bone.inherit_scale = 'NONE'
    for b in rig.pose.bones:
        b.rotation_mode = 'XYZ'

    def rigid(ob, name):
        ob.parent = carriage
        bind(ob, rig, [[(name, 1)]] * len(ob.data.vertices))

    # Body skin: head weights at the front, the skin under the cross swells with it.
    v, h, w = CROSS_ARMS
    weights = []
    for vertex in body.data.vertices:
        p = body.matrix_world @ vertex.co
        d = min(max(abs(p.x - CROSS[0]) - w, abs(p.y - CROSS[1]) - v), max(abs(p.y - CROSS[1]) - w, abs(p.x - CROSS[0]) - h))
        lifted = smoothstep(.12, -.02, d) * smoothstep(.40, .56, p.z)
        front = smoothstep(.42, .86, p.y)
        weights.append([('cross', lifted), ('head', (1 - lifted) * front), ('body', (1 - lifted) * (1 - front))])
    body.parent = carriage
    bind(body, rig, weights)
    for ob in cross_parts:
        rigid(ob, 'cross')
    for ob in wounds:
        rigid(ob, 'head' if ob.matrix_world.translation.y > .6 else 'body')
    for side, eye in eyes.items():
        rigid(eye['ball'], 'head'); rigid(eye['iris'], 'head')
        rigid(eye['lid'], 'lid_l' if side < 0 else 'lid_r')
    rigid(throat, 'throat')
    rigid(lower_lip, 'jaw'); rigid(floor, 'jaw')
    rigid(tongue, 'tongue'); rigid(tongue_tip, 'tongue_tip')
    for leg, (tube, sampled, paw_mesh, joints, end) in legs.items():
        arc = [0]
        for a, b in zip(sampled, sampled[1:]):
            arc.append(arc[-1] + (Vector(b) - Vector(a)).length)
        steps = (len(sampled) - 1) // (len(joints) - 1)
        knee, last = arc[steps], arc[-1]
        ring, _ = ring_weights(sampled, [.16, knee, last], ['body', f'{leg}_upper', f'{leg}_lower', f'{leg}_foot'], [.10, .08, .06])
        sides = len(tube.data.vertices) // len(sampled)
        tube.parent = carriage
        bind(tube, rig, [ring[i // sides] for i in range(len(tube.data.vertices))])
        rigid(paw_mesh, f'{leg}_foot')

    # Sockets ride on their bones (object origins are sampled per frame).
    bpy.context.view_layer.update()
    sockets = {}
    for name, bone_name, location in (('mouth', 'jaw', (0, 1.38, .14)), ('cross', 'cross', (CROSS[0], CROSS[1], cz))):
        # A bone child hangs from the bone's tail; cancel the rest transform explicitly.
        empty = control(c.scene, f'Quacksalber {name} socket')
        rest = rig.data.bones[bone_name]
        empty.parent, empty.parent_type, empty.parent_bone = rig, 'BONE', bone_name
        empty.matrix_parent_inverse = (rest.matrix_local @ Matrix.Translation((0, rest.length, 0))).inverted()
        empty.location = location
        sockets[name] = empty
    return {'root': root, 'parts': {'carriage': carriage, 'cross_glow': pad.inputs['Emission Strength'], 'toad_legs': list(LEGS)},
            'rig': rig, 'sockets': sockets}
