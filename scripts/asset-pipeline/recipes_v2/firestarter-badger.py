"""B1 lance-arm badger. Gate 2 B selects form 3; Actions use the motion adapter.

Select draft.formVariant (1..3) in assets:shape --model-settings. The catalog
model.formVariant is the default, not an approved production selection.
North is +Y, character-right is +X. Muzzle sits between the brass fork tips;
the small rest flame extends beyond it and is not a separate world effect.
"""
import math
import bpy
from mathutils import Matrix, Vector
from recipes_v2.enemy_parts_a import ell, loft, horn, ribbon, outward_normals
from enemy_parts_b import paw, scute
from enemy_craft_parts import head_b, refine, finish_b
from enemy_craft_surfaces import technical
from weapon_surface_parts import paint_depth
from rigs_v2 import control, attach


FORMS = {
    1: dict(base=(.78, -.12, 1.05), yaw=0, length=1.40, shoulder=False, tank=False),
    2: dict(base=(.82, -.17, 1.09), yaw=-12, length=1.46, shoulder=True, tank=False),
    3: dict(base=(.78, -.18, 1.09), yaw=0, length=1.68, shoulder=False, tank=True),
}


def build(c, spec):
    variant = (spec.get('draft') or {}).get('formVariant', spec.get('model', {}).get('formVariant', 1))
    if variant not in FORMS:
        raise ValueError('firestarter-badger formVariant must be 1, 2 or 3')
    form = FORMS[variant]
    fur = c.material('Firestarter graphite coat', (.105, .115, .125), 'organic', form_shading=True)
    dark = c.material('Firestarter charcoal paws and mask', (.012, .016, .021), 'organic')
    pale = c.material('Firestarter warm ivory crown', (.66, .62, .51), 'organic')
    tips = c.material('Firestarter silver flank fur', (.20, .205, .21), 'organic', form_shading=True)
    claw = c.material('Firestarter horn claws', (.43, .34, .23), 'organic')
    leather = c.material('Firestarter oxblood leather', (.25, .047, .021), 'organic')
    seams = c.material('Firestarter warm leather seams', (.36, .12, .045), 'organic')
    brass = technical(c, 'Firestarter matte aged brass', (.48, .30, .105), 'brass')
    edge = technical(c, 'Firestarter rubbed brass rims', (.67, .48, .22), 'brass')
    recess = c.material('Firestarter dark bore and joints', (.012, .009, .007))
    steel = technical(c, 'Firestarter dark iron fittings', (.10, .115, .12), 'steel')

    def emission(name, rgb):
        linear = tuple(v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb)
        mat = c.material(name, linear, emission=1)
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.009, .003, .015, 1)
        return mat
    violet = emission('Void b347ff', (179/255, 71/255, 1))
    lilac = emission('Void d98cff', (217/255, 140/255, 1))
    hot = emission('Void f9e8ff', (249/255, 232/255, 1))
    deep = emission('Void 6f16a8', (111/255, 22/255, 168/255))

    # Raised shoulder girdle over low hips: 1.64 / 1.26 = 1.30 torso outline.
    torso = loft(c, 'Upright inclined hips waist shoulder anatomy', [
        (-.86, .055, .65, .08), (-.72, .40, .71, .28),
        (-.52, .55, .78, .34), (-.25, .51, .88, .36),
        (.02, .55, 1.00, .38), (.30, .63, 1.10, .35),
        (.53, .53, 1.17, .30), (.70, .30, 1.23, .22),
        (.78, .06, 1.24, .08)], fur)
    torso['measurementRole'] = 'torso'
    body = [torso, ell(c, 'Raised neck', (0, .63, 1.25), (.25, .28, .24), fur)]
    for side in (-1, 1):
        for i, (x, y, z) in enumerate(((.51, .43, 1.35), (.54, .12, 1.23), (.49, -.23, 1.11), (.49, -.51, .97))):
            body.append(horn(c, 'Swept charcoal flank locks',
                             [(side*x, y+.06, z), (side*(x+.07), y-.04, z-.09),
                              (side*(x+.08), y-.20, z-.19)], [.047, .043, .002], tips if i == 0 else fur, 10))
    skull = head_b(c, (0, .85, 1.43), .285, .355, pale, dark, dark)
    tail = [ell(c, 'Short rear badger tail', (0, -.91, .44), (.14, .23, .13), fur, taper=-.35),
            ell(c, 'Muted ivory tail tip', (0, -1.045, .47), (.087, .105, .06), pale, taper=-.28)]
    legs = {name: paw(c, name, (side*.36, -.43, .64), (side*.51, -.66, .18), .20, fur, dark, claw)
            for name, side in [('left', -1), ('right', 1)]}
    left = [horn(c, 'Left shoulder to flexed elbow', [(-.47, .38, 1.21), (-.76, .18, .96), (-.78, -.02, .89)], [.21, .19, .15], fur),
            ell(c, 'Raised free claw hand', (-.86, .18, .98), (.17, .235, .13), dark)]
    for dx in (-.10, 0, .10):
        left.append(horn(c, 'Free hand hooked claws', [(-.86+dx, .31, 1.02), (-.86+dx, .43, 1.04), (-.86+dx, .47, .99)], [.024, .020, .002], claw))
    right = [horn(c, 'Right shoulder elbow forearm', [(.47, .36, 1.22), (.75, -.18, .95), (.79, .28, 1.07)], [.21, .18, .15], fur),
             ell(c, 'Right hand under lance brace', (.79, .34, 1.02), (.16, .22, .14), dark)]

    gear = []
    # Flat broad leather straps follow the actual curved back, leaving most fur exposed.
    for side in (-1, 1):
        gear.append(ribbon(c, 'Oxblood shoulder harness', [(side*.39, .48, 1.43), (side*.37, .13, 1.43),
                                                         (side*.29, -.24, 1.25), (side*.36, -.53, 1.06)], [.095]*4, leather))
    gear.append(ribbon(c, 'Curved rear waist belt', [(-.50, -.43, 1.00), (-.30, -.49, 1.105),
                                                   (0, -.51, 1.13), (.30, -.49, 1.105), (.50, -.43, 1.00)], [.12]*5, leather))
    gear += [c.box('Brass belt clasp', (.28, -.48, 1.14), (.17, .14, .045), edge, .022),
             c.box('Leather inside clasp', (.28, -.48, 1.168), (.104, .072, .012), leather, .008)]
    if form['shoulder']:
        left.append(scute(c, 'Wide oxblood left shoulder pauldron', (-.61, .30, 1.40), .52, .59, leather, .12))
        left.append(horn(c, 'Pauldron brass rolled edge', [(-.86, .34, 1.44), (-.79, .07, 1.44), (-.60, -.03, 1.45), (-.40, .09, 1.44)], [.020]*4, edge))
    else:
        left.append(scute(c, 'Small leather shoulder guard', (-.59, .32, 1.40), .33, .39, leather, .07))

    base = Vector(form['base'])
    angle = math.radians(form['yaw'])
    axis = Vector((math.sin(angle), math.cos(angle), 0))
    cross = Vector((math.cos(angle), -math.sin(angle), 0))
    def point(t, x=0, z=0):
        return base + axis*t + cross*x + Vector((0, 0, z))
    weapon = []
    def turned(name, profile, materials, assignments=None):
        count = 40
        verts = [point(t, r*math.cos(j*math.tau/count), r*math.sin(j*math.tau/count))
                 for r, t in profile for j in range(count)]
        faces = [(i*count+j, i*count+(j+1)%count, ((i+1)%len(profile))*count+(j+1)%count,
                  ((i+1)%len(profile))*count+j) for i in range(len(profile)) for j in range(count)]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        outward_normals(mesh)
        for mat in materials:
            mesh.materials.append(mat)
        for poly in mesh.polygons:
            k = poly.index // count
            poly.material_index = assignments[k] if assignments else 0
            poly.use_smooth = abs(profile[k][1]-profile[(k+1) % len(profile)][1]) > .005
        ob = bpy.data.objects.new(name, mesh)
        c.scene.collection.objects.link(ob)
        weapon.append(ob)
        return ob
    length = form['length']
    turned('Long hollow brass forearm lance', [(.15, 0), (.15, length-.29), (.17, length-.27),
            (.17, length-.17), (.107, length-.17), (.102, length-.39), (.10, .01)],
            [brass, edge, recess], [0, 0, 1, 1, 2, 2, 0])
    for t in (.13, .52, length-.33):
        turned('Readable brass reinforcing cuff', [(.153, t-.047), (.188, t-.033), (.188, t+.033), (.153, t+.047)], [edge])
    for side in (-1, 1):
        weapon.append(horn(c, 'Tapered brass muzzle fork', [point(length-.28, side*.137), point(length-.10, side*.15),
                                                         point(length+.13, side*.072)], [.047, .034, .007], brass))
    for t in (.12, .48):
        weapon.append(ell(c, 'Leather arm mounting strap', tuple(point(t, 0, -.11)), (.21, .075, .12), leather, angle=-angle))
    # Small longitudinal rest flame; the muzzle socket stays fixed at the fork-tip plane.
    weapon.append(horn(c, 'Contained deep violet flame', [point(length-.20, 0, .015), point(length-.01, .012, .025),
                                                         point(length+.21, -.02, .055), point(length+.32, .018, .075)], [.072, .083, .044, .001], deep))
    weapon.append(horn(c, 'Violet lance ember', [point(length-.14, 0, .075), point(length+.02, .012, .09),
                                               point(length+.21, -.02, .09)], [.056, .054, .001], violet))
    weapon.append(horn(c, 'Lilac inner flame', [point(length-.12, 0, .119), point(length+.05, .003, .129),
                                              point(length+.15, -.01, .12)], [.028, .034, .001], lilac))
    weapon.append(horn(c, 'Small white hot core', [point(length-.10, 0, .145), point(length+.05, .002, .152)], [.014, .001], hot))
    if form['tank']:
        gear += [ell(c, 'Rear brass pressure flask', (-.24, -.13, 1.41), (.23, .43, .19), brass),
                 c.box('Dark flask end fitting', (-.24, .28, 1.42), (.17, .14, .12), steel, .035)]
        for y in (-.35, .08):
            gear.append(ribbon(c, 'Leather flask retaining strap', [(-.47, y, 1.43), (-.38, y, 1.59),
                                                                     (-.24, y, 1.62), (-.10, y, 1.59), (-.01, y, 1.43)], [.07]*5, leather))
        gear.append(horn(c, 'Dark pressure hose to forearm', [(-.24, .30, 1.43), (.08, .48, 1.39),
                                                             (.48, .27, 1.30), tuple(point(.12, -.12, .04))], [.035]*4, recess))

    refine(c, body, skull, legs, (fur, tips, pale),
           {leather: ('leather', seams), brass: ('metal', recess), edge: ('metal', brass),
            steel: ('metal', recess), claw: ('horn', dark)}, extra=(tail, left, right, gear, weapon))
    # Soot pigment retains shared texture strength and directed fur locks.
    for material in (fur, tips):
        nodes, links = material.node_tree.nodes, material.node_tree.links
        color = nodes['Principled BSDF'].inputs['Base Color']
        source = color.links[0].from_socket
        soot = nodes.new('ShaderNodeMixRGB')
        soot.name = 'Authored soot coat pigment'
        soot.blend_type = 'MULTIPLY'
        soot.inputs[0].default_value = 1
        soot.inputs[2].default_value = (.32, .29, .27, 1)
        links.new(source, soot.inputs[1])
        links.new(soot.outputs[0], color)
    anatomy = body+skull+tail+left+right+[ob for _, objects in legs.values() for ob in objects]
    for ob in anatomy:
        ob['firestarterPart'] = 'anatomy'
        if any(mat in (fur, tips) for mat in ob.data.materials):
            paint_depth(c, ob)
    for ob in weapon:
        ob['firestarterPart'] = 'lance'
    asset = finish_b(c, legs, body+gear, skull, (0, .61, 1.26),
                     {'tail': ((0, -.76, .48), tail), 'left_arm': ((-.48, .35, 1.22), left),
                      'right_arm': ((.48, .35, 1.22), right)})
    # Preserve arm control ownership and use an explicit geometry-derived socket.
    attach(weapon, asset['parts']['right_arm'])
    muzzle = control(c.scene, 'Firestarter fork tip muzzle', parent=asset['parts']['right_arm'])
    bpy.context.view_layer.update()
    muzzle.matrix_world = Matrix.Translation(point(length+.13))
    muzzle['socketRole'] = 'muzzle'
    muzzle['referenceSize'] = 32
    muzzle['referencePoint'] = [16+32*point(length+.13).x/spec['orthoScale'],
                                 16-32*point(length+.13).y/spec['orthoScale']]
    muzzle['referenceYDown'] = True
    asset['sockets']['muzzle'] = muzzle
    asset['parts']['cast_tip_offset'] = list(point(length+.13)-Vector((.48, .35, 1.22)))
    asset['root']['formVariant'] = variant
    asset['root']['authoringStage'] = 'Production: approved B1-v3 move/claw/cast'
    return asset
