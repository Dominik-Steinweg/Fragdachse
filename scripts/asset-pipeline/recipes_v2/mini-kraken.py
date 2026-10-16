"""Mini-Kraken: the Abyssal Kraken's brood at regular-enemy scale (display 24, canvas ~58 px).

Baby proportions: a big soft mantle sac behind a short head, eight short thick webbed arms
with curled tips, four oversized forward-looking ember eyes and violet glowing cup rows.
The skin is the boss's V8 dermis with more translucency and a dark ink sac in the mantle.

z = 0 is the ground; the arms lie on it. Parts for kraken_brood_motion_v2: `carriage`
(whole animal), `body` (head/mantle breathing), lid pivots, `tentacle_chains`, and the
`mantle`/`head` bones that pump the sac without moving the eyes.
"""
import math
import bpy
from mathutils import Vector
from rigs_v2 import control, attach
from eye_anchors import register_eye
from recipes_v2.enemy_parts_a import smooth_path, outward_normals
from kraken_skin_v8 import PALETTE, linear, skin, paint_pattern, write_rest
from kraken_eye_parts import eye, eye_sculpt, eye_materials
from kraken_dorsal_parts import fuse
from kraken_arm_parts import arm, arm_curve, web, bind, chain_weights, creases, smoothstep

CHAIN = 8
DOME = .80
# Front to rear: y, half width, underside z, dome height. A short head, a slight neck,
# then a plump soft sac swelling wider and higher than the head: the boss's spear
# mantle before it stretches, tapering into a rounded point.
PROFILE = [
    (1.36, .04, .27, .03),
    (1.26, .30, .21, .21),
    (1.10, .52, .17, .35),
    (0.90, .64, .16, .42),
    (0.66, .64, .16, .43),
    (0.42, .62, .15, .45),
    (0.12, .76, .13, .57),
    (-0.22, .80, .13, .63),
    (-0.58, .72, .14, .61),
    (-0.92, .54, .16, .52),
    (-1.22, .34, .19, .39),
    (-1.44, .16, .22, .24),
    (-1.56, .04, .25, .08),
]
# (x, y, radius) on the right side; mirrored. Oversized against the boss's head.
MAIN_EYE = (.25, 1.02, .22)
SECOND_EYE = (.52, .72, .18)
# Right-side arms (mirrored left): a radial crown rooted under the head rim around
# CROWN, short and thick, tapering into hooked tips. The tips roll their ventral cups
# towards the curl so the glowing rows show from above.
CROWN = (0, .70)
ARMS = [
    dict(angle=70, heading=68, length=1.50, bend=-14, turns=.46, curl=.56, width=.32, z=(.17, .12, .15), twist=(20, 80)),
    dict(angle=30, heading=36, length=1.65, bend=-22, turns=.50, curl=.60, width=.34, z=(.17, .09, .12), twist=(20, 80)),
    dict(angle=-12, heading=-6, length=1.65, bend=-20, turns=.48, curl=.60, width=.34, z=(.17, .07, .11), twist=(18, 78)),
    dict(angle=-54, heading=-48, length=1.50, bend=-12, turns=.44, curl=.56, width=.32, z=(.17, .06, .11), twist=(18, 78)),
]
VOID_VIOLET = linear('#b347ff')
VOID_BRIGHT = linear('#d98cff')


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


def mantle(c, material):
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
            lift = h * s ** DOME if s > 0 else h * .30 * s  # flattened belly on the ground
            vertices.append((w * math.cos(a), y, z + lift))
    for i in range(len(rows) - 1):
        for j in range(sides):
            faces.append((i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j))
    faces.extend([tuple(range(sides - 1, -1, -1)), tuple((len(rows) - 1) * sides + j for j in range(sides))])
    mesh = bpy.data.meshes.new('Mini-kraken soft mantle sac and head')
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(mesh.name, mesh)
    c.scene.collection.objects.link(ob)
    return ob, surface, section


def fins(c, material):
    """Small rounded juvenile fins on the rear sac, the boss's fins before they grow spines."""
    pieces = []
    for side in (-1, 1):
        # Near the tip, through the sac's flank, swept back like the boss's fins.
        lobe = c.ell('Mini-kraken juvenile fin', (side * .34, -1.18, .27), (.34, .11, .045), material)
        lobe.rotation_euler.z = side * math.radians(-38)
        pieces.append(lobe)
    return pieces


def paint_body(ob, section, sockets):
    """Dark dorsal saddle, translucent pale margins, the ink sac showing through the sac."""
    def sampler(p, n):
        w, _, _ = section(p.y)
        across = abs(p.x) / max(w, .05)
        saddle = min(1, max(0, (across - .18) / .55)) ** 1.1
        # Behind the head the thin sac is evenly translucent; only the head keeps the saddle.
        thin = smoothstep(.45, .05, p.y)
        flank = saddle + (.58 + .42 * across - saddle) * thin
        # The ink sac: a dark, defined mass seen through the translucent sac.
        sac = smoothstep(1.0, .35, math.hypot(p.x / .38, (p.y + .48) / .56)) * thin
        flank *= 1 - .78 * sac
        # Membrane-thin margins turn pale where the skin faces away from the light/camera,
        # and the fin lobes beyond the sac are thin, pale, translucent membrane.
        edge = max(0, min(1, (.62 - n.z) / .55))
        fin = smoothstep(1.05, 1.60, across) * smoothstep(-.95, -1.10, p.y)
        flank += (.40 - flank) * fin
        rim = max(.50 * edge * (1 - sac) * max(0, min(1, (p.y + 1.6) / .5)) * (1 - fin), .22 * fin)
        for sx, sy, sr in sockets:
            d = math.hypot(p.x - sx, p.y - sy) / (sr * 1.6)
            flank *= 1 - .70 * math.exp(-d * d * 2)
            rim *= 1 - math.exp(-d * d * 2)
        return flank, rim, .35 + .65 * across
    paint_pattern(ob, sampler)


def translucent(material, weight=.34, scale=.09):
    """Thin, wet juvenile skin: more subsurface scattered into violet, moister roughness."""
    nodes = material.node_tree.nodes
    dry = nodes.get('MS broad matte roughness')
    if dry:
        dry.inputs['To Min'].default_value -= .10
        dry.inputs['To Max'].default_value -= .12
    bs = nodes.get('Principled BSDF')
    bs.inputs['Subsurface Weight'].default_value = weight
    bs.inputs['Subsurface Radius'].default_value = (.85, .30, 1.0)
    bs.inputs['Subsurface Scale'].default_value = scale
    return material


def glowing_cups(c):
    """Violet bioluminescent cups baked into the sprite: saturated lips, lighter wells."""
    lips = skin(c, 'Mini-kraken violet glowing cup lips', linear('#2a1440'), linear('#7a3fb0'), softness=.45, roughness=(.34, .46))
    lips['ventralSuckerSurface'] = True
    nodes = lips.node_tree.nodes
    bs = nodes['Principled BSDF']
    bs.inputs['Emission Color'].default_value = (*VOID_VIOLET, 1)
    bs.inputs['Emission Strength'].default_value = .55
    nodes['MS pigment tint strength'].inputs[1].default_value = .10
    nodes['MS cell strength'].inputs[1].default_value = .12
    well = c.material('Mini-kraken glowing cup wells', linear('#3a1258'))
    bw = well.node_tree.nodes.get('Principled BSDF')
    bw.inputs['Roughness'].default_value = .55
    bw.inputs['Emission Color'].default_value = (*VOID_BRIGHT, 1)
    bw.inputs['Emission Strength'].default_value = 1.3
    well['ventralSuckerSurface'] = True
    return lips, well


def arm_paths(reach):
    out = []
    for side in (-1, 1):
        for j, spec in enumerate(ARMS):
            a = math.radians(spec['angle'])
            base = (CROWN[0] + .42 * math.cos(a), CROWN[1] + .36 * math.sin(a))
            pts = arm_curve(base, spec['heading'], spec['length'] * reach, spec['bend'], spec['turns'],
                            spec['curl'] * reach, side, spec['z'], samples=32, sink=.22)
            if side < 0:  # slight asymmetry keeps the brood organic
                pts = [(x, y + .025 * math.sin(k * .5 + j), z) for k, (x, y, z) in enumerate(pts)]
            out.append((pts, spec, side))
    return out


def build(c, spec):
    draft = spec.get('draft') or {}
    model = spec.get('model') or {}
    reach, eye_scale = model.get('armReach', 1), model.get('eyeScale', 1)
    hide = translucent(skin(c, 'Mini-kraken translucent mantle hide', PALETTE['saddle'], linear('#5e3b6c'), rim=linear('#b592bd')), .40, .11)
    arm_hide = translucent(skin(c, 'Mini-kraken thick arm hide', PALETTE['saddle'], PALETTE['flank'], rim=linear('#9c7fa6')), .28)
    membrane = translucent(skin(c, 'Mini-kraken translucent arm webs', PALETTE['dorsal'], PALETTE['flank'],
                                rim=linear('#b394b8'), softness=.5), .45, .12)
    cups, wells = glowing_cups(c)

    root = control(c.scene, 'Mini-kraken fixed export pivot')
    carriage = control(c.scene, 'Mini-kraken carriage', parent=root)
    body = control(c.scene, 'Mini-kraken breathing head and mantle', parent=carriage)

    shell, surface, section = mantle(c, hide)
    eyes, sculpt, sockets = [], [], []
    for side in (-1, 1):
        for key, (ex, ey, er), yaw, pitch in (('main', MAIN_EYE, 20, 30), ('second', SECOND_EYE, 38, 26)):
            er *= eye_scale
            look = Vector((side * math.sin(math.radians(yaw)), math.cos(math.radians(yaw)), math.tan(math.radians(pitch))))
            x, y = side * ex, ey
            center = (x, y, surface(x, y) - er * .28)
            name = f'{"Left" if side < 0 else "Right"} {key} eye'
            eyes.append((side, key, name, center, er, look))
            tissue, _ = eye_sculpt(c, name, center, er, look, surface, hide)
            sculpt.extend(tissue)
            sockets.append((x, y, er))
    head = fuse(c, [shell, *fins(c, hide), *sculpt], hide, voxel=.010 * draft.get('voxelScale', 1))
    head.name = 'Mini-kraken continuous head, mantle and fins'
    paint_body(head, section, sockets)
    write_rest(head)
    c.paint_form_mask(head, lambda p: .58 + .42 * max(0, min(1, p.z / .75)))
    creases(head, .22, .010)
    attach([head], body)

    eye_mats = eye_materials(c)
    lids = {}
    for side, key, name, center, er, look in eyes:
        objects, pivot, iris = eye(c, name, center, er, look, eye_mats, body)
        attach([o for o in objects if o.parent is None], body)
        pivot.rotation_euler.x += .06  # a hair wider than the boss: the ember slit still reads at 58 px
        lids[f'lid_{key}_{"l" if side < 0 else "r"}'] = pivot
        register_eye(c, side, iris, pair=0 if key == 'main' else 1)
        for ob in objects:
            if ob.active_material and ob.active_material.get('FD_SurfaceKind') == 'kraken-dermis-v8':
                c.paint_form_mask(ob, lambda p: .85)

    arm_data = []
    for points, spec_arm, side in arm_paths(reach):
        ob, centers, radii, weights = arm(c, len(arm_data), points, spec_arm['width'], (arm_hide, cups, wells),
                                          flare_amount=.45, steps=2, taper=.70, twist=spec_arm['twist'], side=side,
                                          cup_step=3)
        ob.name = f'Mini-kraken arm {len(arm_data) + 1}'
        creases(ob, .08, .010, subdivide=draft.get('creaseSubdivisions', 1), group='Dorsal scales')
        arm_data.append((ob, centers, radii, weights))

    data = bpy.data.armatures.new('Mini-kraken arm chains and mantle')
    rig = bpy.data.objects.new('Mini-kraken rig', data)
    c.scene.collection.objects.link(rig)
    rig.parent = carriage
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    base = data.edit_bones.new('root'); base.head = (0, 0, 0); base.tail = (0, .2, 0)
    head_bone = data.edit_bones.new('head'); head_bone.head = (0, .45, .40); head_bone.tail = (0, 1.05, .40)
    head_bone.parent = base; head_bone.align_roll(Vector((0, 0, 1)))
    sac = data.edit_bones.new('mantle'); sac.head = (0, .40, .42); sac.tail = (0, -1.20, .42)
    sac.parent = base; sac.align_roll(Vector((0, 0, 1)))
    chains = []
    for i, (_, centers, _, _) in enumerate(arm_data):
        chain, previous = [], base
        for j in range(CHAIN):
            b = data.edit_bones.new(f'arm_{i + 1:02d}_{j + 1:02d}')
            b.head = centers[round(j * (len(centers) - 1) / CHAIN)]
            b.tail = centers[round((j + 1) * (len(centers) - 1) / CHAIN)]
            b.parent = previous; b.use_connect = j > 0
            b.align_roll(Vector((0, 0, 1)))
            previous = b; chain.append(b.name)
        chains.append(chain)
    bpy.ops.object.mode_set(mode='OBJECT')
    # The sac pumps on its own bone; the head (and the eyes riding on `body`) stays put.
    weights = []
    for v in head.data.vertices:
        w = smoothstep(.50, -.30, (head.matrix_world @ v.co).y)
        weights.append([('mantle', w), ('head', 1 - w)])
    bind(head, rig, weights)
    for i, (ob, _, _, arm_weights) in enumerate(arm_data):
        ob.parent = carriage
        bind(ob, rig, [chain_weights(chains[i], t) for t in arm_weights])
    for side in (0, 4):
        for a in range(3):
            i, k = side + a, side + a + 1
            ob, bones = web(c, f'Mini-kraken arm web {i + 1}-{k + 1}', arm_data[i][1:3], arm_data[k][1:3],
                            chains[i], chains[k], membrane, reach=.40, rows=20, cols=16)
            ob.parent = carriage
            bind(ob, rig, bones)
    for b in rig.pose.bones:
        b.rotation_mode = 'XYZ'
    return {'root': root, 'parts': {'carriage': carriage, 'body': body, 'tentacle_chains': chains, **lids},
            'rig': rig, 'sockets': {}}
