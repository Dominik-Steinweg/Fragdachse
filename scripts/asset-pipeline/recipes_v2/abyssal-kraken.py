"""Abyssal Kraken V8: domed spear mantle, forward-looking ember eyes, segmented keel,
muscle plates, webbed crown of eight long arms.

z = 0 is the waterline used by the elevation pass. The mantle and eyes ride above it;
the arms arc in and out of the water with their tips curling clear of the surface.
"""
import math
import bpy
from mathutils import Vector
from rigs_v2 import control, attach
from eye_anchors import register_eye
from kraken_skin_v8 import PALETTE, linear, skin, cup_material, well_material, paint_pattern, write_rest
from kraken_eye_parts import eye, eye_sculpt, eye_materials
from kraken_dorsal_parts import MAIN_EYE, SECOND_EYE, mantle, dorsal, face_ridges, fuse, paint_mantle, fins, oral_crown, colour_beard
from kraken_arm_parts import CHAIN, arm, arm_curve, web, bind, chain_weights, creases
from kraken_part_assets import strike_tentacle, egg

# Right-side arm specs (mirrored left): broad muscular sweeps with relaxed distal hooks.
# Front arms ride higher so they overlap the ones behind them.
ARM_SPECS = [
    dict(base=(.64, 1.30), heading=76, length=3.95, bend=-64, turns=.24, curl=1.55, width=.40, z=(.36, .16, .38), twist=(18, 58)),
    dict(base=(.74, 1.02), heading=26, length=4.10, bend=-66, turns=.30, curl=1.70, width=.40, z=(.35, .06, .35), twist=(22, 64)),
    dict(base=(.74, .70), heading=-14, length=4.15, bend=-57, turns=.22, curl=1.65, width=.38, z=(.34, -.02, .29), twist=(20, 56)),
    dict(base=(.76, .38), heading=-48, length=4.30, bend=-30, turns=.28, curl=1.80, width=.38, z=(.32, -.06, .30), twist=(18, 62)),
]
# On land the crown flattens onto the ground and spreads a little wider.
LAND_SPECS = [dict(spec, z=(spec['z'][0] - .06, .10, .30), bend=spec['bend'] * .85, length=spec['length'] * 1.03) for spec in ARM_SPECS]


def arm_points(source=ARM_SPECS):
    out = []
    for side in (-1, 1):
        for j, spec in enumerate(source):
            pts = arm_curve(spec['base'], spec['heading'], spec['length'], spec['bend'], spec['turns'], spec['curl'], side, spec['z'])
            if side < 0:  # a little asymmetry keeps the crown organic
                pts = [(x, y + .05 * math.sin(k * .4 + j), z) for k, (x, y, z) in enumerate(pts)]
            out.append((pts, spec, side))
    return out


def build(c, spec):
    part = (spec.get('model') or {}).get('part', 'water')
    if part == 'tentacle':
        return strike_tentacle(c, spec)
    if part == 'egg':
        return egg(c, spec)
    hide = skin(c, 'Kraken V8 abyssal dorsal hide', PALETTE['saddle'], PALETTE['flank'], rim=PALETTE['rim'])
    arm_hide = skin(c, 'Kraken V8 muscular arm hide', PALETTE['saddle'], PALETTE['flank'], rim=PALETTE['rim'])
    membrane = skin(c, 'Kraken V8 fin membranes', PALETTE['dorsal'], PALETTE['flank'], rim=PALETTE['rim'], softness=.5)
    bone = skin(c, 'Kraken V8 bony scutes and spines', linear('#211529'), linear('#65415e'), rim=linear('#947085'), softness=.4, roughness=(.48, .64))
    oral = skin(c, 'Kraken V8 crimson oral crown', PALETTE['saddle'], PALETTE['oral'], rim=PALETTE['rim'], softness=.7)
    cups = cup_material(c, 'Kraken V8 crimson ventral cups')
    well = well_material(c, 'Kraken V8 recessed cup wells')
    root = control(c.scene, 'Kraken fixed export pivot')
    emergence = control(c.scene, 'Kraken surfacing control', parent=root)
    body = control(c.scene, 'Kraken breathing mantle', parent=emergence)
    paths = arm_points(LAND_SPECS if part == 'land' else ARM_SPECS)

    # Skull, mantle, keel, muscle plates, arm shoulders and eye sockets become one skin.
    shell, surface, section = mantle(c, hide)
    eyes, sculpt, crests = [], [], []
    for side in (-1, 1):
        for key, (ex, ey, er), yaw, pitch in (('main', MAIN_EYE, 20, 30), ('second', SECOND_EYE, 38, 26)):
            look = Vector((side * math.sin(math.radians(yaw)), math.cos(math.radians(yaw)), math.tan(math.radians(pitch))))
            x, y = side * ex, ey
            center = (x, y, surface(x, y) - er * .28)
            name = f'{"Left" if side < 0 else "Right"} {key} eye'
            eyes.append((side, key, name, center, er, look))
            tissue, brow = eye_sculpt(c, name, center, er, look, surface, hide)
            sculpt.extend(tissue)
            crests.append(brow)
    tissue, spines, dorsal_crests = dorsal(c, surface, section, hide, bone, [(p[0][0], p[0][3]) for p in paths])
    ridges, ridge_crests = face_ridges(c, surface, hide)
    beard, beard_lines = oral_crown(c, surface, hide)
    head = [fuse(c, [shell, *tissue, *sculpt, *ridges, *beard], hide, voxel=.012)]
    sockets = [(side * ex, ey, er) for side in (-1, 1) for ex, ey, er in (MAIN_EYE, SECOND_EYE)]
    paint_mantle(head[0], section, dorsal_crests, sockets)
    colour_beard(head[0], beard_lines, oral)
    write_rest(head[0])
    c.paint_form_mask(head[0], lambda p: .60 + .40 * max(0, min(1, p.z)))
    creases(head[0], .30, .018)
    head.extend(spines)
    head.extend(fins(c, section, surface, membrane, bone))
    for ob in head[1:]:
        if 'FD_FormMask' not in ob.data.color_attributes:
            c.paint_form_mask(ob, lambda p: .70 + .30 * max(0, min(1, p.z)))
    attach(head, body)

    eye_mats = eye_materials(c)
    lids = {}
    for side, key, name, center, er, look in eyes:
        objects, pivot, iris = eye(c, name, center, er, look, eye_mats, body)
        attach([o for o in objects if o.parent is None], body)
        lids[f'lid_{key}_{"l" if side < 0 else "r"}'] = pivot
        if key == 'main':
            register_eye(c, side, iris)
        for ob in objects:
            if ob.active_material and ob.active_material.get('FD_SurfaceKind') == 'kraken-dermis-v8':
                c.paint_form_mask(ob, lambda p: .85)

    arm_data = []
    for points, spec, side in paths:
        ob, centers, radii, weights = arm(c, len(arm_data), points, spec['width'], (arm_hide, cups, well), flare_amount=.15,
                                          steps=2, twist=spec['twist'], side=side)
        creases(ob, .10, .022, subdivide=1, group='Dorsal scales')
        arm_data.append((ob, centers, radii, weights))

    data = bpy.data.armatures.new('Kraken eight flexible chains')
    rig = bpy.data.objects.new('Kraken tentacle rig', data)
    c.scene.collection.objects.link(rig)
    rig.parent = emergence
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    base = data.edit_bones.new('root'); base.head = (0, 0, 0); base.tail = (0, .2, 0)
    chains = []
    for i, (_, centers, _, _) in enumerate(arm_data):
        chain = []; previous = base
        for j in range(CHAIN):
            b = data.edit_bones.new(f'arm_{i + 1:02d}_{j + 1:02d}')
            b.head = centers[round(j * (len(centers) - 1) / CHAIN)]
            b.tail = centers[round((j + 1) * (len(centers) - 1) / CHAIN)]
            b.parent = previous; b.use_connect = j > 0
            b.align_roll(Vector((0, 0, 1)))
            previous = b; chain.append(b.name)
        chains.append(chain)
    bpy.ops.object.mode_set(mode='OBJECT')
    for i, (ob, _, _, weights) in enumerate(arm_data):
        ob.parent = emergence
        bind(ob, rig, [chain_weights(chains[i], t) for t in weights])
    # Webbing between neighbouring arms on each side follows both chains.
    for side in (0, 4):
        for a in range(3):
            i, k = side + a, side + a + 1
            ob, bones = web(c, f'Kraken V8 arm web {i + 1}-{k + 1}', arm_data[i][1:3], arm_data[k][1:3], chains[i], chains[k], arm_hide)
            ob.parent = emergence
            bind(ob, rig, bones)
    for b in rig.pose.bones: b.rotation_mode = 'XYZ'
    # Brood eggs ride on six arm tips; hidden (rest scale .001) until a throw scales them up.
    brood = skin(c, 'Kraken V8 carried brood eggs', PALETTE['dorsal'], linear('#8d5f9e'), rim=linear('#d79ab8'), softness=.6)
    carried = {}
    bpy.context.view_layer.update()
    for n, i in enumerate((0, 2, 3, 4, 6, 7)):
        centers, radii = arm_data[i][1], arm_data[i][2]
        k = int(len(centers) * .86)
        tip = Vector(centers[k]) + Vector((0, 0, radii[k] + .14))
        egg_ob = c.ell(f'Carried brood egg {n + 1}', tuple(tip), (.17, .17, .21), brood)
        paint_pattern(egg_ob, lambda p, nrm: (.7, .4 * max(0, nrm.z) ** 3, .5))
        write_rest(egg_ob)
        c.paint_form_mask(egg_ob, lambda p: .8)
        bpy.context.view_layer.update()
        world = egg_ob.matrix_world.copy()
        egg_ob.parent, egg_ob.parent_type, egg_ob.parent_bone = rig, 'BONE', chains[i][min(CHAIN - 1, int(CHAIN * .86))]
        egg_ob.matrix_world = world
        egg_ob.scale = tuple(v * .001 for v in egg_ob.scale)
        carried[f'egg_carry_{n + 1}'] = egg_ob
    return {'root': root, 'parts': {'body': body, 'surfacing': emergence, 'tentacle_chains': chains, **lids, **carried},
            'rig': rig, 'sockets': {}}
