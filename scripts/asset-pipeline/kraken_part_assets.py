"""Separate Kraken V8 boss parts: the giant strike tentacle and the brood egg.

Strike tentacle: one long arm laid along +Y; its root lies deep below the waterline
(z = 0) so the cut to the body is never visible. Runtime anchors it at the
`waterEntry` socket on the shore and rotates it towards the attack lane.
Egg: a pulsing membrane egg whose four shell petals open on their own bones.
"""
import math
import bpy
import bmesh
from mathutils import Vector
from rigs_v2 import attach, control, limb_rig
from recipes_v2.enemy_parts_a import horn, outward_normals
from kraken_skin_v8 import PALETTE, linear, skin, cup_material, well_material, paint_pattern, write_rest
from kraken_arm_parts import arm, bind, chain_weights, creases

STRIKE_CHAIN = 24
# Laid-out reference path: root rises out of the water, then runs flat along the lane.
STRIKE_PATH = [(0, -4.70, -1.10), (0, -4.10, -.55), (0, -3.30, .05), (.18, -2.00, .32), (-.22, -.40, .36),
               (.20, 1.20, .34), (-.14, 2.70, .32), (.06, 3.90, .32), (0, 4.75, .34)]
WATER_ENTRY = (0, -3.45, 0)


def strike_tentacle(c, spec):
    arm_hide = skin(c, 'Kraken V8 strike tentacle hide', PALETTE['saddle'], PALETTE['flank'], rim=PALETTE['rim'])
    cups = cup_material(c, 'Kraken V8 strike tentacle cups')
    well = well_material(c, 'Kraken V8 strike tentacle wells')
    root = control(c.scene, 'Strike tentacle fixed export pivot')
    body = control(c.scene, 'Strike tentacle surge control', parent=root)
    # Rolled like the body arms: the pale cup-lined underside shows along one edge.
    ob, centers, radii, weights = arm(c, 0, STRIKE_PATH, .58, (arm_hide, cups, well), flare_amount=0, twist=(34, 46))
    ob.name = 'Kraken V8 giant strike tentacle'
    ob['motionRole'] = 'strike-tentacle'
    creases(ob, .24, .014, subdivide=1)
    data = bpy.data.armatures.new('Strike tentacle chain')
    rig = bpy.data.objects.new('Strike tentacle rig', data)
    c.scene.collection.objects.link(rig)
    rig.parent = body
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    base = data.edit_bones.new('root'); base.head = (0, -4.9, -1.2); base.tail = (0, -4.7, -1.2)
    chain, previous = [], base
    for j in range(STRIKE_CHAIN):
        b = data.edit_bones.new(f'strike_{j + 1:02d}')
        b.head = centers[round(j * (len(centers) - 1) / STRIKE_CHAIN)]
        b.tail = centers[round((j + 1) * (len(centers) - 1) / STRIKE_CHAIN)]
        b.parent = previous; b.use_connect = j > 0
        b.align_roll(Vector((0, 0, 1)))
        previous = b; chain.append(b.name)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.parent = body
    bind(ob, rig, [chain_weights(chain, t) for t in weights])
    for b in rig.pose.bones: b.rotation_mode = 'XYZ'
    entry = control(c.scene, 'Strike tentacle water entry socket', WATER_ENTRY, root)
    return {'root': root, 'parts': {'body': body, 'tentacle_chains': [chain]}, 'rig': rig,
            'sockets': {'waterEntry': entry}}


def petal_mesh(c, name, k, size, material):
    """Quarter of an ovoid shell between azimuths k*90 and (k+1)*90 degrees, slightly gapped."""
    rx, ry, rz = size
    vertices, faces = [], []
    rings, cols = 18, 10
    gap = math.radians(2.5)
    a0, a1 = math.radians(90 * k) + gap, math.radians(90 * (k + 1)) - gap
    # Ovoid standing on its base (z up), slightly lumpy so it reads as grown.
    for i in range(rings + 1):
        v = math.pi * i / rings
        for j in range(cols + 1):
            u = a0 + (a1 - a0) * j / cols
            bulge = 1 + .05 * math.sin(v * 4 + u * 3)
            r = math.sin(v) * bulge
            vertices.append((rx * r * math.cos(u), ry * r * math.sin(u), rz * (1 - math.cos(v))))
    for i in range(rings):
        for j in range(cols):
            a = i * (cols + 1) + j
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    outward_normals(data)
    data.materials.append(material)
    for p in data.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, data)
    c.scene.collection.objects.link(ob)
    solid = ob.modifiers.new('Leathery egg wall', 'SOLIDIFY')
    solid.thickness, solid.offset = .022, -1
    return ob


def ember_core(c):
    """Glowing yolk: hot centre fading to a dark crimson rim, so it never reads as a flat disc."""
    material = c.material('Kraken V8 brood ember core', linear('#e2361c'), emission=3)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bs = nodes.get('Principled BSDF')
    facing = nodes.new('ShaderNodeLayerWeight')
    facing.inputs['Blend'].default_value = .55
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'EASE'
    stops = [(0, linear('#ffb24a')), (.35, linear('#e8401a')), (.8, linear('#6a0712'))]
    for i, (pos, color) in enumerate(stops):
        e = ramp.color_ramp.elements[i] if i < 2 else ramp.color_ramp.elements.new(pos)
        e.position, e.color = pos, (*color, 1)
    links.new(facing.outputs['Facing'], ramp.inputs[0])
    links.new(ramp.outputs[0], bs.inputs['Emission Color'])
    links.new(ramp.outputs[0], bs.inputs['Base Color'])
    return material


def egg(c, spec):
    membrane = skin(c, 'Kraken V8 leathery brood membrane', PALETTE['saddle'], linear('#5b3f78'), rim=linear('#a8739a'), softness=.6)
    bs = membrane.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Subsurface Weight'].default_value = .28
    bs.inputs['Subsurface Scale'].default_value = .05
    core_mat = ember_core(c)
    embryo_mat = c.material('Kraken V8 curled embryo shadow', linear('#1a0710'))
    root = control(c.scene, 'Egg fixed export pivot')
    size = (.25, .25, .31)
    petals = [petal_mesh(c, f'Egg shell petal {k + 1}', k, size, membrane) for k in range(4)]
    for k, ob in enumerate(petals):
        paint_pattern(ob, lambda p, n: (.35 + .55 * max(0, min(1, p.z / .62)), .5 * max(0, n.z) ** 4, .6))
        write_rest(ob)
        c.paint_form_mask(ob, lambda p: .8)
    core = c.ell('Egg ember core', (0, 0, .30), (.15, .15, .2), core_mat)
    embryo = horn(c, 'Curled embryo', [(.05, -.04, .22), (.07, .05, .30), (0, .08, .38), (-.06, .02, .36), (-.03, -.03, .31)],
                  [.06, .055, .04, .025, .006], embryo_mat, sides=12)
    pulse = control(c.scene, 'Egg core pulse control', (0, 0, .30), root)
    bpy.context.view_layer.update()
    for ob in (core, embryo):
        world = ob.matrix_world.copy(); ob.parent = pulse; ob.matrix_world = world
    asset = {'root': root, 'parts': {'core': pulse, 'emission': core_mat.node_tree.nodes['Principled BSDF'].inputs['Emission Strength']},
             'rig': None, 'sockets': {}}
    limbs = {}
    for k, ob in enumerate(petals):
        u = math.radians(90 * k + 45)
        limbs[f'petal_{k + 1}'] = ((.22 * math.cos(u), .22 * math.sin(u), .02), [ob])
    attach(petals, root)  # one authored hierarchy root for the whole egg
    rig = limb_rig(c.scene, asset, limbs)
    asset['parts']['petals'] = [f'petal_{k + 1}' for k in range(4)]
    return asset
