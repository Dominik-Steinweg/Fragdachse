"""Grave Titan: a colossal quadruped whose back is a sealed crypt.

Top-down identity: a pale sarcophagus lid in the middle of the back, carved with a border and split
by a glowing cross fissure; three leaning headstones per flank; rough shoulder and hip monoliths;
an ivory skull mask with a forward V of stone brows, deep green eyes and two broken tusks; four
broad stone-shod paws and a short tail of stacked vertebra stones. Moss cushions, pale lichen and
dark hanging roots soften every stone edge.

Grave light regions use materials tagged `FD_EmissionChannel = 'grave'` (sheet-emission.mjs
--channel grave): the lid's cross fissure, the gaps between lid and headstones and five small
lantern holes on the flanks where the fireflies nest. In Beauty they are a dark crust with a faint
dormant glow; the runtime fades and tints the separate grave emission sheet with the gather phase.
The eyes keep their own untagged material.

Controls for grave_titan_motion_v2: body, head and tail (the motion module turns head and tail
about `neck_pivot` / `tail_pivot`), `lid` (sarcophagus lid with its fissure), `stones_l` /
`stones_r` (headstone rows, pivot at their inner base line), `grave_flare` (gain on the fissure
emission colour; the emission strength stays constant) and `ground_cut` (world height below which
every material is transparent; the emerge clip lowers it from above the lid to below the paws).
Socket `crown` marks the lid centre where the fireflies gather.
"""
import math
import random
import bpy
from mathutils import Vector
from recipes_v2.enemy_parts_a import loft, horn, paw, ell, smooth_path
from enemy_craft_parts import finish_a as finish, refine, decorate
from rigs_v2 import control, attach
from zombie_surface_parts import Surface, mesh_object
from eye_anchors import register_eye

CRUST = (.012, .030, .016)
DORMANT = (.20, .78, .30)
DORMANT_STRENGTH = .20
FLARE_GAIN = 3.0
NECK_PIVOT = (0, .74, .94)
TAIL_PIVOT = (0, -.96, .46)
CUT_REST = -10.0
CUT_SOFTNESS = .035


def grave_material(c, name):
    """Dark crust with a faint dormant glow whose keyed flare scales the emission colour."""
    m = c.material(name, CRUST)
    n, l = m.node_tree.nodes, m.node_tree.links
    bs = n['Principled BSDF']
    bs.inputs['Roughness'].default_value = .74
    bs.inputs['Emission Strength'].default_value = DORMANT_STRENGTH
    flare = n.new('ShaderNodeValue')
    flare.name = flare.label = 'Grave flare'
    flare.outputs[0].default_value = 0
    gain = n.new('ShaderNodeMath')
    gain.operation = 'MULTIPLY_ADD'
    l.new(flare.outputs[0], gain.inputs[0])
    gain.inputs[1].default_value = FLARE_GAIN
    gain.inputs[2].default_value = 1
    scaled = n.new('ShaderNodeVectorMath')
    scaled.operation = 'SCALE'
    scaled.inputs[0].default_value = DORMANT
    l.new(gain.outputs[0], scaled.inputs['Scale'])
    l.new(scaled.outputs[0], bs.inputs['Emission Color'])
    m['FD_EmissionChannel'] = 'grave'
    return m, flare.outputs[0]


def ground_cut(material):
    """Every surface below the keyed cut height turns transparent with a soft edge."""
    n, l = material.node_tree.nodes, material.node_tree.links
    output = next(node for node in n if node.type == 'OUTPUT_MATERIAL' and node.is_active_output)
    source = output.inputs['Surface'].links[0].from_socket
    level = n.new('ShaderNodeValue')
    level.name = level.label = 'Ground cut level'
    level.outputs[0].default_value = CUT_REST
    position = n.new('ShaderNodeNewGeometry')
    z = n.new('ShaderNodeSeparateXYZ')
    l.new(position.outputs['Position'], z.inputs[0])
    above = n.new('ShaderNodeMath')
    above.operation = 'SUBTRACT'
    l.new(z.outputs['Z'], above.inputs[0])
    l.new(level.outputs[0], above.inputs[1])
    fade = n.new('ShaderNodeMapRange')
    fade.inputs['From Min'].default_value = -CUT_SOFTNESS
    fade.inputs['From Max'].default_value = CUT_SOFTNESS
    fade.clamp = True
    l.new(above.outputs[0], fade.inputs['Value'])
    hole = n.new('ShaderNodeBsdfTransparent')
    mix = n.new('ShaderNodeMixShader')
    mix.name = 'Ground cut'
    l.new(fade.outputs[0], mix.inputs[0])
    l.new(hole.outputs[0], mix.inputs[1])
    l.new(source, mix.inputs[2])
    l.new(mix.outputs[0], output.inputs['Surface'])
    return level.outputs[0]


def seam(c, name, surface, path, widths, material, lift=.010):
    """Surface-conforming strip: every vertex lands on the stone or hide it crosses."""
    points, radii = smooth_path([tuple(p) for p in path], widths)
    columns = (-1, -.5, 0, .5, 1)
    vertices, faces = [], []
    for i, p in enumerate(points):
        direction = Vector(points[min(len(points) - 1, i + 1)]) - Vector(points[max(0, i - 1)])
        side = Vector((-direction.y, direction.x)).normalized()
        for k in columns:
            for shrink in (1, .8, .6, .4, .2, 0):
                x, y = p[0] + side.x * radii[i] * k * shrink / 2, p[1] + side.y * radii[i] * k * shrink / 2
                if surface.height(x, y) is not None:
                    break
            vertices.append(surface.point(x, y, lift))
    m = len(columns)
    for i in range(len(points) - 1):
        for k in range(m - 1):
            faces.append((i * m + k, (i + 1) * m + k, (i + 1) * m + k + 1, i * m + k + 1))
    ob = mesh_object(c, name, vertices, faces, [material])
    ob['meshShadowDetail'] = True
    return ob


def jagged(rng, a, b, steps, amplitude):
    """A fracture line from a to b with small alternating kinks."""
    (ax, ay), (bx, by) = a, b
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy) or 1
    nx, ny = -dy / length, dx / length
    points = []
    for i in range(steps + 1):
        t = i / steps
        k = 0 if i in (0, steps) else rng.uniform(.4, 1) * amplitude * (1 if i % 2 else -1)
        points.append((ax + dx * t + nx * k, ay + dy * t + ny * k))
    return points


def slab(c, name, outline, thickness, material, edge, location=(0, 0, 0), rotation=(0, 0, 0), bevel=.018, chips=0., seed=0):
    """Crisp cut stone: a flat authored outline extruded to its thickness with chamfered edges."""
    rng = random.Random(seed)
    ring = [(x + rng.uniform(-chips, chips), y + rng.uniform(-chips, chips)) for x, y in outline]
    if sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) < 0:
        ring.reverse()
    n = len(ring)
    vertices = [(x, y, 0) for x, y in ring] + [(x, y, thickness) for x, y in ring]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    ob = mesh_object(c, name, vertices, faces, [material, edge], indices=[0, 0] + [1] * n)
    for polygon in ob.data.polygons:
        polygon.use_smooth = False
    chamfer = ob.modifiers.new('Chamfered cut edge', 'BEVEL')
    chamfer.width, chamfer.segments, chamfer.limit_method = bevel, 2, 'ANGLE'
    ob.location, ob.rotation_euler = location, rotation
    bpy.context.view_layer.update()
    return ob


def cut_stone(c, name, outline, thickness, material, edge, details, seed, location=(0, 0, 0), rotation=(0, 0, 0), chips=.008):
    ob = slab(c, name, outline, thickness, material, edge, location, rotation, chips=chips, seed=seed)
    details.extend(decorate(c, ob, 'stone', edge, seed))
    return ob


def arch_outline(height, width, side=1):
    """Headstone face: straight base edge, straight sides and a round arch, pointing along +x (side)."""
    shoulder = height - width * .5
    arc = [(shoulder + width * .5 * math.sin(a), width * .5 * math.cos(a)) for a in [math.pi * k / 12 for k in range(13)]]
    return [(side * u, v) for u, v in [(0, width * .5)] + arc + [(0, -width * .5)]]


def world_path(ob, points, lift):
    """Local slab-top points to world XY (for grooves projected on the slab's real top)."""
    top = max(v.co.z for v in ob.data.vertices)
    return [tuple((ob.matrix_world @ Vector((x, y, top + lift)))[:2]) for x, y in points]


def cushions(c, surface, rng, centre, spread, count, size, moss, lichen=None, lichen_share=0, name='Deep moss cushion'):
    """Irregular cushions (lumped from overlapping domes) and sparse lichen on the real surface."""
    out = []
    for i in range(count):
        a = rng.uniform(0, math.tau)
        r = math.sqrt(rng.random())
        x, y = centre[0] + math.cos(a) * spread[0] * r, centre[1] + math.sin(a) * spread[1] * r
        z = surface.height(x, y)
        if z is None:
            continue
        s = size * rng.uniform(.6, 1.15)
        if lichen and rng.random() < lichen_share:
            out.append(ell(c, 'Pale lichen rosette', (x, y, z + .004), (s * .45, s * .35, .005), lichen, angle=a))
            continue
        for k in range(3):
            b = a + k * 2.1
            dx, dy = math.cos(b) * s * .55 * (k > 0), math.sin(b) * s * .45 * (k > 0)
            h = surface.height(x + dx, y + dy)
            if h is None:
                continue
            w = s * (1 - .28 * k)
            out.append(ell(c, name, (x + dx, y + dy, h + w * .16), (w, w * rng.uniform(.62, .9), w * .30), moss, angle=b))
    return out


def collar(c, name, ob, outline, z, material, radius=.034, outset=1.0, seed=0):
    """Flesh rolling over a stone's edge: an uneven soft swell along the outline at local height `z`."""
    rng = random.Random(seed)
    cx = sum(x for x, y in outline) / len(outline)
    cy = sum(y for x, y in outline) / len(outline)
    points = [tuple(ob.matrix_world @ Vector((cx + (x - cx) * outset, cy + (y - cy) * outset, z))) for x, y in outline]
    radii = [radius * rng.uniform(.55, 1.45) for _ in points]
    points, radii = points + points[:2], radii + radii[:2]
    tube = horn(c, name, points, radii, material, 10)
    tube['meshShadowDetail'] = True
    return tube


def embedded(c, name, outline, thickness, material, edge, skin, details, seed, location, rotation=(0, 0, 0), chips=.008, rim=.034):
    """A cut stone grown into the body: sunk in, with a skin collar along its sides."""
    ob = cut_stone(c, name, outline, thickness, material, edge, details, seed, location, rotation, chips)
    details.append(collar(c, name + ' skin collar', ob, outline, thickness * .62, skin, rim, .99, seed))
    return ob


def build(c, spec):
    # While the emerge cut runs through the body a ray crosses many transparent layers (stones, hide,
    # mane); at the Cycles default of 8 the path ends opaque black instead of reaching the background.
    c.scene.cycles.transparent_max_bounces = 64
    fur = c.material('Dense black-olive hide and mane', (.052, .056, .045), 'organic')
    skin = c.material('Dead flesh grown over stone', (.050, .052, .042), 'organic')
    dark = c.material('Deep crypt joints', (.012, .014, .012), 'organic')
    granite = c.material('Dark weathered granite headstones', (.072, .080, .080), 'technical')
    lighter = c.material('Worn granite monoliths', (.095, .100, .094), 'technical')
    grave = c.material('Old blackened limestone grave', (.135, .128, .110), 'technical')
    edge = c.material('Broken black granite sides', (.040, .048, .052), 'technical')
    moss = c.material('Deep cushion moss', (.032, .078, .026), 'organic')
    soil = c.material('Dark grave soil', (.038, .028, .020), 'organic')
    lichen = c.material('Grey-green lichen', (.11, .125, .09))
    bone = c.material('Blackened ancient skull', (.085, .074, .056), 'organic')
    ivory = c.material('Dirty ivory tusks and teeth', (.27, .24, .17), 'organic')
    ribs = c.material('Exposed dark rib bone', (.11, .10, .078), 'organic')
    ridge = c.material('Heavy brow bone', (.15, .135, .10), 'organic')
    root = c.material('Dark hanging grave roots', (.036, .028, .020), 'organic')
    glow, grave_flare = grave_material(c, 'Grave light fissures')
    eyes = c.material('Grave-green burning eyes', (.48, 1.0, .34), emission=1.4)
    rng = random.Random(int(spec.get('model', {}).get('seed', 5)))
    moss_amount = float(spec.get('model', {}).get('mossSpread', 1))

    limbs = {}
    for name, x, y, width in [('front_left', -.99, .50, .32), ('front_right', .99, .50, .32), ('rear_left', -.82, -.72, .28), ('rear_right', .82, -.72, .28)]:
        joint, objects = paw(c, name, x, y, fur, dark, edge, width=width, length=.36, toe_length=.11)
        side = -1 if x < 0 else 1
        outline = [(side * u, v) for u, v in [(-.15, .05), (-.10, -.16), (.09, -.18), (.17, -.04), (.11, .12), (-.09, .13)]]
        objects.append(embedded(c, name + ' stone greave', outline, .07, granite, edge, skin, objects, 11 + len(limbs),
                                location=(x * .97, y - .10, .38), rotation=(.10, side * .25, 0), rim=.026))
        limbs[name] = (joint, objects)

    trunk = loft(c, 'Massive ancient ribcage', [(-1.12, .20, .50, .15), (-.95, .56, .60, .30), (-.62, .74, .68, .40), (-.20, .84, .74, .46),
                 (.22, .93, .79, .47), (.50, .90, .83, .42), (.72, .62, .85, .30), (.88, .34, .87, .17)], fur)
    body = [trunk]
    body_surface = Surface([trunk])

    # The great grave: an arched headstone grown into the back, its arch towards the neck, carved
    # with a border and split by the glowing cross fissure.
    lid_group = []
    grave_outline = arch_outline(1.00, .74)
    lid = embedded(c, 'Great grave headstone', grave_outline, .15, grave, edge, skin, lid_group, 3, location=(0, -.56, 1.10),
                   rotation=(0, -.10, math.pi / 2), chips=.006, rim=.045)
    lid_group.insert(0, lid)
    lid_surface = Surface([lid])
    border = [(.08, .30)] + [(u * .86 + .07, v * .80) for u, v in arch_outline(1.00, .74)[1:-1]] + [(.08, -.30)]
    lid_group.append(seam(c, 'Carved grave border groove', lid_surface, world_path(lid, border, 0), [.018] * len(border), edge, .002))
    lid_group.extend([seam(c, 'Grave cross fissure', lid_surface, jagged(rng, (0, .30), (-.01, -.44), 8, .016), [.020, .034, .044, .046, .042, .038, .032, .024, .016], glow, .004),
                      seam(c, 'Grave cross fissure', lid_surface, jagged(rng, (-.19, .12), (.19, .12), 6, .012), [.016, .030, .040, .042, .038, .028, .016], glow, .004)])
    for a, b in [((.02, -.12), (.17, -.30)), ((-.02, .20), (-.15, .27)), ((.10, .12), (.19, .24)), ((-.01, -.31), (-.18, -.42))]:
        lid_group.append(seam(c, 'Branching grave fracture', lid_surface, jagged(rng, a, b, 4, .012), [.013, .011, .009, .006, .004], edge, .003))
    lid_group.extend(cushions(c, lid_surface, rng, (-.30, -.48), (.06, .05), round(2 * moss_amount), .06, moss, lichen, .2))
    lid_group.extend(cushions(c, lid_surface, rng, (.26, .26), (.05, .05), round(2 * moss_amount), .05, moss, lichen, .2))
    lid_group.extend(cushions(c, lid_surface, rng, (0, -.08), (.24, .36), 6, .026, lichen, lichen, 1))

    # Grave light seeping out where the great grave meets the flesh, and lantern holes on the
    # flanks where the fireflies nest.
    for side in (-1, 1):
        for a, b in [((.40, .30), (.43, .08)), ((.44, -.02), (.44, -.24)), ((.43, -.34), (.40, -.54))]:
            body.append(seam(c, 'Grave light seam', body_surface, jagged(rng, (side * a[0], a[1]), (side * b[0], b[1]), 4, .010),
                             [.010, .022, .028, .020, .008], glow, .014))
    for x, y in [(-.70, .10), (.72, -.24), (-.66, -.52), (.62, .34), (.12, -.86)]:
        z = body_surface.height(x, y)
        if z is not None:
            body.append(ell(c, 'Lantern hole rim', (x, y, z - .002), (.052, .044, .016), skin, angle=x * 2))
            body.append(ell(c, 'Firefly lantern hole', (x, y, z + .010), (.030, .024, .010), glow, angle=x * 2))

    # Arched headstones half sunk into the flanks, leaning outwards; each row pivots at its inner base line.
    rows = {}
    for side in (-1, 1):
        row = []
        for j, (y0, height, width, tilt, yaw) in enumerate([(.24, .42, .30, .26, .10), (-.12, .46, .32, .20, -.03), (-.48, .40, .29, .30, -.13)]):
            base = (body_surface.height(side * .47, y0) or 1.0) - .03
            outline = arch_outline(height, width, side)
            piece = embedded(c, 'Leaning flank headstone', outline, .085, granite if j != 1 else lighter, edge, skin, row,
                             21 + j + (side > 0) * 7, location=(side * .46, y0, base), rotation=(0, side * tilt, side * yaw), chips=.006)
            row.insert(0, piece)
            inset = [(side * (height * .10 + u), v) for u, v in arch_outline(height * .76, width * .64)[1:-1]]
            row.append(seam(c, 'Carved headstone arch', Surface([piece]), world_path(piece, inset, 0), [.011] * len(inset), edge, .002))
        row_surface = Surface([ob for ob in row if ob.name.startswith('Leaning flank headstone') and 'collar' not in ob.name and 'arch' not in ob.name])
        for y0 in (.24, -.12, -.48):
            row.extend(cushions(c, row_surface, rng, (side * .44, y0 + rng.uniform(-.06, .06)), (.04, .07), round(1.4 * moss_amount), .05, moss, lichen, .35))
        rows[side] = row

    # Exposed ribs between the headstones and a ridge of bone spurs along the spine.
    for side in (-1, 1):
        for y in (.06, -.30, -.64):
            path = [(side * .42, y, 1.10), (side * .60, y - .02, 1.02), (side * .76, y - .05, .88), (side * .86, y - .08, .70)]
            body.append(horn(c, 'Exposed rib arc', path, [.026, .030, .024, .012], ribs, 10))
    for k, (y, h) in enumerate([(-.66, .16), (-.80, .13), (-.93, .10)]):
        z = body_surface.height(0, y) or .9
        body.append(horn(c, 'Spine bone spur', [(0, y + .04, z - .02), (0, y - .02, z + h * .6), (0, y - .08, z + h)], [.045, .026, .004], ribs, 10))

    # Two big angular shoulder monoliths, a stone collar behind the skull and rubble over the hips.
    for side in (-1, 1):
        outline = [(side * (.27 * math.cos(a) * rng.uniform(.85, 1.1)), .21 * math.sin(a) * rng.uniform(.85, 1.1)) for a in [math.tau * k / 6 + .25 for k in range(6)]]
        z = (body_surface.height(side * .62, .60) or .9) - .10
        body.insert(1, embedded(c, 'Shoulder monolith', outline, .17, lighter, edge, skin, body, 31 + (side > 0), location=(side * .62, .60, z),
                                rotation=(.08, side * .30, side * .2), chips=.012, rim=.042))
        body.extend(cushions(c, Surface([body[1]]), rng, (side * .55, .60), (.12, .10), round(2 * moss_amount), .065, moss, lichen, .3))
        for k, (x, y, s) in enumerate([(.24, .68, .11), (.56, -.86, .12), (.30, -.92, .09)]):
            outline = [(s * math.cos(a) * rng.uniform(.8, 1.15), s * .8 * math.sin(a) * rng.uniform(.8, 1.15)) for a in [math.tau * i / 5 for i in range(5)]]
            z = (body_surface.height(side * x, y) or .9) - .05
            body.append(embedded(c, 'Broken grave rubble', outline, .07, granite, edge, skin, body, 35 + k + (side > 0) * 3, location=(side * x, y, z),
                                 rotation=(rng.uniform(-.2, .2), side * .25, rng.uniform(0, 3)), chips=.01, rim=.024))

    # Grave soil clinging in the joints, moss and hanging roots.
    body.extend(cushions(c, body_surface, rng, (0, .62), (.32, .08), 3, .08, soil, name='Clinging grave soil'))
    body.extend(cushions(c, body_surface, rng, (0, -.80), (.30, .10), 4, .08, soil, name='Clinging grave soil'))
    for side in (-1, 1):
        body.extend(cushions(c, body_surface, rng, (side * .48, -.06), (.05, .50), 5, .055, soil, name='Clinging grave soil'))
        for y in (.18, -.46):
            start = (side * .40, y + rng.uniform(-.03, .03))
            path = [(start[0], start[1], 1.22), (side * .58, y - .02, 1.12), (side * .74, y + .02, .98), (side * .84, y - .01, .82)]
            body.append(horn(c, 'Dark hanging grave root', path, [.016, .013, .009, .004], root, 8))
    body.extend(cushions(c, body_surface, rng, (0, .58), (.28, .10), round(3 * moss_amount), .07, moss, lichen, .2))
    body.extend(cushions(c, body_surface, rng, (0, -.86), (.26, .08), round(3 * moss_amount), .065, moss, lichen, .2))

    # Heavy maned neck and a blackened wedge skull: brow ridges on the forehead behind the eyes,
    # sloping down towards the snout, small burning eyes, dirty fang tusks and a crown headstone.
    skull = [loft(c, 'Heavy maned neck', [(.60, .44, .86, .28), (.76, .42, .90, .27), (.92, .36, .92, .22)], fur)]
    cranium = ell(c, 'Blackened skull mask', (0, 1.08, 1.00), (.39, .38, .21), bone, taper=.42)
    jaw = ell(c, 'Heavy lower jaw', (0, 1.13, .86), (.35, .33, .12), bone, taper=.44)
    skull.extend([cranium, jaw])
    skull_surface = Surface([cranium])
    for side in (-1, 1):
        ex, ey = side * .16, 1.17
        ez = skull_surface.height(ex, ey) or 1.12
        skull.append(ell(c, 'Deep eye socket', (ex, ey, ez - .004), (.060, .036, .022), dark, angle=side * -.42))
        eye = ell(c, 'Burning grave eye', (ex, ey + .002, ez + .010), (.040, .019, .014), eyes, angle=side * -.42)
        register_eye(c, side, eye)
        skull.append(eye)
        # Brow ridge on the forehead (behind the eye), its inner end dropping towards the snout.
        skull.append(horn(c, 'Heavy brow ridge', [(side * .045, 1.13, ez + .036), (side * .17, 1.09, ez + .058), (side * .32, 1.02, ez + .036)], [.030, .046, .026], ridge, 10))
        skull.append(horn(c, 'Forward fang tusk', [(side * .20, 1.30, .86), (side * .24, 1.42, .87), (side * .18, 1.52, .91)], [.054, .036, .010], ivory, 10))
        skull.append(ell(c, 'Sunken temple hollow', (side * .25, .98, (skull_surface.height(side * .25, .98) or 1.0) - .006), (.075, .11, .02), dark, angle=side * .35))
        skull.append(seam(c, 'Skull suture fracture', skull_surface, jagged(rng, (side * .03, .80), (side * .12, 1.04), 4, .014), [.010, .012, .010, .008, .004], dark, .004))
        skull.append(horn(c, 'Raised cheekbone', [(side * .20, .98, 1.00), (side * .33, 1.06, 1.02), (side * .34, 1.18, .97)], [.030, .042, .024], bone, 10))
        skull.append(embedded(c, 'Stone cheek guard', [(side * .02, .10), (side * .16, .04), (side * .16, -.13), (side * .01, -.10)], .06, granite, edge, skin, skull, 41 + (side > 0),
                              location=(side * .30, .90, .97), rotation=(0, side * .35, 0), rim=.022))
    skull.append(ell(c, 'Nasal cavity', (0, 1.38, (skull_surface.height(0, 1.38) or 1.0) - .004), (.042, .030, .016), dark, taper=-.3))
    for k in range(5):
        x = (k - 2) * .05
        skull.append(horn(c, 'Worn grave tooth', [(x, 1.37 - abs(x) * .5, .87), (x, 1.42 - abs(x) * .5, .85)], [.018, .004], ivory, 6))
    # A small headstone grown into the crown, its arch rising backwards over the neck.
    skull.append(embedded(c, 'Crown headstone', arch_outline(.26, .22), .07, granite, edge, skin, skull, 51, location=(0, .86, 1.08), rotation=(0, -.6, -math.pi / 2), rim=.022))
    skull.extend(cushions(c, skull_surface, rng, (0, .88), (.10, .04), round(2 * moss_amount), .05, moss, lichen, .3))

    # Short tail of stacked vertebra stones.
    tail = [horn(c, 'Heavy hide tail', [(0, -.98, .50), (0, -1.14, .42), (0, -1.28, .33), (0, -1.38, .26)], [.20, .15, .10, .05], fur)]
    for k, (y, s) in enumerate([(-1.06, .16), (-1.20, .12), (-1.32, .085)]):
        tail.append(embedded(c, 'Vertebra stone', [(-s, s * .7), (s, s * .7), (s * 1.1, -s * .4), (0, -s), (-s * 1.1, -s * .4)], .07, granite, edge, skin, tail, 61 + k,
                             location=(0, y, .53 - k * .08), rotation=(-.2, 0, 0), rim=.022))

    refine(c, body, skull, limbs, (fur,), {ridge: ("horn", dark), granite: ("basalt", edge), lighter: ("basalt", edge), grave: ("basalt", edge), edge: ("basalt", dark),
                                                moss: ("fungus", fur), bone: ("horn", dark), ivory: ("horn", dark), ribs: ("horn", dark)},
           extra=(tail, lid_group, rows[-1], rows[1]))
    asset = finish(c, body, skull, limbs, tail)
    parts = asset['parts']
    parts['lid'] = control(c.scene, 'Great grave', location=(0, -.07, 1.14), parent=parts['body'])
    attach(lid_group, parts['lid'])
    for side, key in ((-1, 'stones_l'), (1, 'stones_r')):
        parts[key] = control(c.scene, f'Headstone row {key[-1]}', location=(side * .46, -.12, 1.00), parent=parts['body'])
        attach(rows[side], parts[key])
    crown = control(c.scene, 'Socket crown (firefly gathering point)', location=(0, -.07, 1.42), parent=parts['lid'])
    asset['sockets']['crown'] = crown
    materials = {m for ob in c.scene.objects if ob.type == 'MESH' for m in ob.data.materials if m}
    cuts = [ground_cut(m) for m in sorted(materials, key=lambda m: m.name)]
    parts.update(grave_flare=grave_flare, ground_cut=cuts, neck_pivot=NECK_PIVOT, tail_pivot=TAIL_PIVOT,
                 rest_controls=('lid', 'stones_l', 'stones_r'),
                 rest_sockets=[(grave_flare, 0.0)] + [(socket, CUT_REST) for socket in cuts])
    # Sub-pixel toes, claws, lichen, collars and carved grooves stay render-only for the shadow proxy.
    for ob in c.scene.objects:
        if ob.type == 'MESH' and any(detail in ob.name for detail in ('toe knuckle', 'ivory claw', 'lichen', 'groove', 'fracture', 'pore', 'tooth', 'root', 'arch', 'spur', 'soil', 'collar')):
            ob['meshShadowDetail'] = True
    return asset
