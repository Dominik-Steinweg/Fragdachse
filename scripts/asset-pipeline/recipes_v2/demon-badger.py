"""Horned muscular charger with heat seams: swept red shoulders, armored spine and hooked claws.

Heat regions use materials tagged `FD_EmissionChannel = 'heat'` (sheet-emission.mjs --channel heat):
the upper ridge of every shoulder and cranial horn from mid to tip, the shoulder seams and scapular
plate rims, the five vertebra seams, a back-edge seam on every flank scale, the tail ridge and its
spade tip, the forehead fissure and a throat seam on the lower jaw that only shows when the jaw
opens. In Beauty they are a dark ember crust with a faint dormant glow; the runtime fades and tints
the separate heat emission sheet with the charge. Every seam is at least ~1.5 world px wide where
the anatomy allows it, so it reads at 1x. The eyes keep their own untagged material.

Controls for demon_badger_motion_v2: body, head and tail (object controls at the origin; the motion
module turns head and tail about `neck_pivot` / `tail_pivot`), flare_l / flare_r (scapular plate,
shoulder horn and their seams, pivot at the inner plate edge), spine_flare (spinal shield and
vertebra seams), jaw (lower jaw and throat seam, pivot at the hinge) and `throat_glow`, the throat
seam's flare factor (gain and void shift on its emission colour; the emission strength stays
constant, as the enemy material passes require). Socket `mouth` marks the flame muzzle.
"""
import math
from mathutils import Vector
from recipes_v2.enemy_parts_a import loft, plate, horn, paw, ell, smooth_path
from enemy_craft_parts import head_a as head, finish_a as finish, refine
from rigs_v2 import control, attach
from zombie_surface_parts import Surface, mesh_object

# Linear colours. Cold seams are a dark crust with a deep red core; the heat itself is the sheet.
CRUST = (.030, .008, .008)
DORMANT = (.42, .028, .016)
VOID = (.34, .06, 1.0)
DORMANT_STRENGTH = .30
THROAT_GAIN = 4.0
NECK_PIVOT = (0, .40, .93)
TAIL_PIVOT = (0, -.78, .40)


def heat_material(c, name):
    """Ember crust with only a faint dormant glow in Beauty."""
    m = c.material(name, CRUST)
    bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Emission Color'].default_value = (*DORMANT, 1)
    bs.inputs['Emission Strength'].default_value = DORMANT_STRENGTH
    bs.inputs['Roughness'].default_value = .70
    m['FD_EmissionChannel'] = 'heat'
    return m


def throat_material(c):
    """Heat seam whose keyed flare scales and shifts the emission colour towards void violet."""
    m = heat_material(c, 'Throat heat seam')
    n, l = m.node_tree.nodes, m.node_tree.links
    bs = n['Principled BSDF']
    flare = n.new('ShaderNodeValue')
    flare.name = flare.label = 'Throat flare'
    flare.outputs[0].default_value = 0
    hue = n.new('ShaderNodeMix')
    hue.data_type = 'RGBA'
    hue.name = 'Throat shifts to void'
    hue.inputs[6].default_value = (*DORMANT, 1)
    hue.inputs[7].default_value = (*VOID, 1)
    l.new(flare.outputs[0], hue.inputs[0])
    gain = n.new('ShaderNodeMath')
    gain.operation = 'MULTIPLY_ADD'
    gain.name = 'Throat flare gain'
    l.new(flare.outputs[0], gain.inputs[0])
    gain.inputs[1].default_value = THROAT_GAIN
    gain.inputs[2].default_value = 1
    scaled = n.new('ShaderNodeVectorMath')
    scaled.operation = 'SCALE'
    l.new(hue.outputs[2], scaled.inputs[0])
    l.new(gain.outputs[0], scaled.inputs['Scale'])
    l.new(scaled.outputs[0], bs.inputs['Emission Color'])
    return m, flare.outputs[0]


def seam(c, name, surface, path, widths, material, lift=.010):
    """Surface-conforming heat seam: every vertex is projected onto the plate or skin it lies on.
    An edge vertex beyond the plate is drawn back towards the centre line until it lands."""
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


def heat_ridge(ob, heat, start, facing, sides=12):
    """The upper ridge of a horn tube from `start` (0 root .. 1 tip) as its second material."""
    mesh = ob.data
    mesh.materials.append(heat)
    rings = len(mesh.vertices) // sides
    for polygon in mesh.polygons:
        if len(polygon.vertices) == 4 and min(polygon.vertices) // sides / (rings - 1) >= start and polygon.normal.z >= facing:
            polygon.material_index = len(mesh.materials) - 1
    return ob


def heat_crown(ob, heat, first_ring=5, rings=9):
    """The crown of a shell plate (rings from `first_ring` inwards and the centre fan) as heat."""
    mesh = ob.data
    mesh.materials.append(heat)
    count = (len(mesh.polygons) - 1) // rings
    for index, polygon in enumerate(mesh.polygons):
        if index and (index - 1) // count >= first_ring:
            polygon.material_index = len(mesh.materials) - 1
    return ob


def rounded(outline):
    """The shell's own corner cutting, so rims follow the plate that is actually built."""
    outline = list(outline)
    if sum(outline[i][0] * outline[(i + 1) % len(outline)][1] - outline[(i + 1) % len(outline)][0] * outline[i][1] for i in range(len(outline))) < 0:
        outline.reverse()
    for _ in range(2):
        cut = []
        for i, a in enumerate(outline):
            b = outline[(i + 1) % len(outline)]
            cut.extend([(a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25), (a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75)])
        outline = cut
    return outline


def rim(outline, side, low, high, inset):
    """Outline points between two bearings (degrees, mirrored per side), drawn towards the centre."""
    points = rounded(outline)
    cx, cy = sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)
    arc = []
    for x, y in points:
        bearing = math.degrees(math.atan2(y - cy, side * (x - cx)))
        if low <= bearing <= high:
            arc.append((bearing, (cx + (x - cx) * inset, cy + (y - cy) * inset)))
    return [p for _, p in sorted(arc, reverse=True)]


def build(c, spec):
    coat = c.material('Oxide red demonic hide', (.34, .035, .021), 'organic')
    red = c.material('Raised crimson scutes', (.53, .055, .025), 'organic')
    dark = c.material('Obsidian horn and joints', (.020, .016, .019), 'organic')
    pale = c.material('Hot worn horn tips', (.53, .29, .11), 'organic')
    heat = heat_material(c, 'Dormant heat seams')
    throat, throat_glow = throat_material(c)
    eyes = c.material('Fierce molten eyes', (.92, .24, .045), emission=.32)
    limbs = {}
    for name, x, y, width in [('front_left', -.88, .38, .22), ('front_right', .88, .38, .22), ('rear_left', -.61, -.66, .18), ('rear_right', .61, -.66, .18)]:
        limbs[name] = paw(c, name, x, y, red, dark, pale, width=width, length=.28, toe_length=.15)
    trunk = loft(c, 'Forward heavy demonic anatomy', [(-1.01, .05, .31, .06), (-.79, .34, .38, .22), (-.48, .48, .51, .33),
                 (-.08, .60, .58, .38), (.23, .65, .59, .34), (.52, .28, .55, .19), (.60, .09, .52, .05)], coat)
    body = [trunk]
    sweep = float(spec.get('model', {}).get('hornSweep', 1.0))
    flares = {}
    for side, key in ((-1, 'l'), (1, 'r')):
        outline = [(side * .28, .42), (side * .67, .57), (side * .90, .25), (side * .72, -.13), (side * .31, .01)]
        scapula = plate(c, 'Swept scapular armor', outline, .83, .20, red, dark)
        shoulder_horn = horn(c, 'Swept shoulder horn', [(side * .67, .23, .93), (side * .88, .38, 1.08),
                             (side * (.91 + .05 * sweep), .67, 1.01), (side * .81, .84, .91)], [.14, .112, .066, .009], dark)
        # Seams near a plate edge settle onto the trunk below instead of leaving the skin.
        surface = Surface([scapula, trunk])
        arc = rim(outline, side, -150, 14, .76)
        flares[key] = [scapula, heat_ridge(shoulder_horn, heat, .42, .55),
                       seam(c, 'Shoulder heat seam', surface, [(side * .37, .33), (side * .57, .37), (side * .74, .22)], [.10, .16, .08], heat),
                       seam(c, 'Scapular rim heat', surface, arc, [.05 + .07 * math.sin(math.pi * i / (len(arc) - 1)) for i in range(len(arc))], heat)]
        for j in range(3):
            o = j * .22
            scale = plate(c, 'Flank scale', [(side * .25, -.16 - o), (side * .57, -.10 - o), (side * .48, -.41 - o), (side * .16, -.38 - o)], .79 - j * .06, .105, red, dark)
            body.append(scale)
            body.append(seam(c, 'Flank scale back seam', Surface([scale, trunk]), [(side * .44, -.36 - o), (side * .33, -.352 - o), (side * .22, -.343 - o)], [.06, .11, .06], heat))
    spine = []
    for j in range(5):
        y = .03 - j * .195
        shield = plate(c, 'Spinal lava shield', [(-.12, y + .10), (.12, y + .10), (.15, y - .03), (0, y - .18), (-.15, y - .03)], .99 - j * .071, .055, dark)
        spine.append(shield)
        spine.append(seam(c, 'Vertebra heat seam', Surface([shield, trunk]), [(0, y + .06), (0, y - .01), (0, y - .085)], [.09, .15, .07], heat))
    skull = head(c, red, dark, coat, eyes, y=.64, z=.98, width=.27, length=.38, ears=False)
    cranium = next(ob for ob in skull if ob.name.startswith('Sculpted swept badger cranium'))
    for side in (-1, 1):
        skull.append(heat_ridge(horn(c, 'Hooked cranial horn', [(side * .24, .46, 1.11), (side * .40, .68, 1.21), (side * .36, .95, 1.14), (side * .22, 1.13, 1.04)],
                                     [.115, .09, .052, .008], dark), heat, .40, .55))
    skull.append(seam(c, 'Forehead heat fissure', Surface([cranium]), [(0, .45), (-.012, .55), (.008, .65), (-.006, .75), (0, .86)], [.05, .09, .10, .08, .04], heat))
    # The lower jaw hides under the skull at rest; spitting drops and thrusts it so the throat seam shows.
    jaw_shell = ell(c, 'Hinged lower jaw', (0, .82, .865), (.135, .215, .065), red, taper=.42)
    jaw_parts = [jaw_shell, seam(c, 'Throat heat seam', Surface([jaw_shell]), [(0, .69), (0, .84), (0, .97)], [.07, .12, .07], throat)]
    tail = [heat_ridge(horn(c, 'Armored tapering tail', [(0, -.80, .40), (0, -1.00, .33), (0, -1.16, .25), (0, -1.27, .19)], [.14, .10, .06, .025], dark), heat, .30, .60),
            heat_crown(plate(c, 'Barbed tail spade', [(0, -1.20), (.10, -1.27), (.05, -1.33), (0, -1.43), (-.05, -1.33), (-.10, -1.27)], .14, .08, dark), heat)]
    refine(c, body, skull, limbs, (coat,), {red: ("chitin", dark), dark: ("horn", dark), pale: ("horn", dark)}, extra=(tail, flares['l'], flares['r'], spine))
    asset = finish(c, body, skull, limbs, tail)
    parts = asset['parts']
    for key, side in (('l', -1), ('r', 1)):
        parts['flare_' + key] = control(c.scene, f'Scapular flare {key}', location=(side * .30, .20, .92), parent=parts['body'])
        attach(flares[key], parts['flare_' + key])
    parts['spine_flare'] = control(c.scene, 'Spinal shield flare', location=(0, -.36, .80), parent=parts['body'])
    attach(spine, parts['spine_flare'])
    parts['jaw'] = control(c.scene, 'Lower jaw hinge', location=(0, .60, .86), parent=parts['head'])
    attach(jaw_parts, parts['jaw'])
    mouth = control(c.scene, 'Socket mouth (flame muzzle)', location=(0, 1.08, .90), parent=parts['head'])
    parts.update(throat_glow=throat_glow, throat_glow_rest=0, neck_pivot=NECK_PIVOT, tail_pivot=TAIL_PIVOT)
    asset['sockets']['mouth'] = mouth
    # Sub-pixel toes, claws and chitin creases stay render-only: the shadow proxy cannot follow them
    # through the claw pounce under a low sun (silhouette IoU gate).
    for ob in c.scene.objects:
        if ob.type == 'MESH' and any(detail in ob.name for detail in ('toe knuckle', 'ivory claw', 'organic growth crease')):
            ob['meshShadowDetail'] = True
    return asset
