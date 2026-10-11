"""A3a palette on an anatomical carrier with a rigid, north-inclined mortar.

Texture sources and material strengths belong to the catalog. The bore and its
socket are actual tilted geometry; no painted anatomy or lighting exceptions.
"""
import math
import bpy
from mathutils import Matrix, Vector
from recipes_v2.enemy_parts_a import ell, loft, horn, outward_normals
from enemy_parts_b import paw
from enemy_craft_parts import head_b, refine, finish_b
from enemy_craft_surfaces import technical
from weapon_surface_parts import paint_depth
from rigs_v2 import control, attach


TUBE_ANGLE = math.radians(45)
TUBE_LENGTH = 1.26
TUBE_RADIUS_SCALE = 1.35
TUBE_BASE = Vector((0, -.48, 1.10))
TUBE_ROTATION = Matrix.Rotation(-TUBE_ANGLE, 4, 'X')


def tube_point(x, y, z):
    return TUBE_BASE + TUBE_ROTATION.to_3x3() @ Vector((x, y, z))


def turned(c, name, profile, materials, assignments=None):
    """Closed lathed wall in barrel space; the inner profile leaves a true bore."""
    count = 64
    vertices = [tube_point(TUBE_RADIUS_SCALE*r*math.cos(i*math.tau/count), TUBE_RADIUS_SCALE*r*math.sin(i*math.tau/count), z)
                for r, z in profile for i in range(count)]
    faces = []
    for level in range(len(profile)):
        for i in range(count):
            j = (i+1) % count
            following = (level+1) % len(profile)
            faces.append((level*count+i, level*count+j, following*count+j, following*count+i))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    for material in materials:
        mesh.materials.append(material)
    for polygon in mesh.polygons:
        segment = polygon.index // count
        polygon.material_index = assignments[segment] if assignments else 0
        polygon.use_smooth = abs(profile[segment][1]-profile[(segment+1) % len(profile)][1]) > .005
    obj = bpy.data.objects.new(name, mesh)
    c.scene.collection.objects.link(obj)
    return obj


def build(c, spec):
    fur = c.material('Mortar graphite directed coat', (.105, .115, .125), 'organic', form_shading=True)
    dark = c.material('Mortar charcoal facial stripes and paws', (.012, .016, .021), 'organic')
    pale = c.material('Mortar ivory crown and tail tip', (.66, .62, .51), 'organic')
    tips = c.material('Mortar silver flank locks', (.20, .205, .21), 'organic', form_shading=True)
    claw = c.material('Mortar muted horn claws', (.43, .34, .23), 'organic')
    wood = technical(c, 'Mortar scorched longitudinal timber', (.070, .044, .027), 'wood')
    copper = technical(c, 'Mortar worn warm copper bands', (.60, .215, .080), 'brass')
    copper_edge = technical(c, 'Mortar rubbed copper corners and rivets', (.79, .40, .18), 'brass')
    steel = technical(c, 'Mortar scratched blue grey forged tube', (.23, .27, .30), 'steel')
    lip = technical(c, 'Mortar pale worn muzzle lip', (.66, .68, .65), 'edge')
    bore = c.material('Mortar recessed unlit bore', (.004, .005, .009))
    patina = technical(c, 'Mortar restrained oxidised copper recess', (.065, .115, .10), 'brass')

    def linear(rgb):
        return tuple(v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb)
    violet = c.material('Mortar local void core b347ff', linear((179/255, 71/255, 1)), emission=1)
    hot = c.material('Mortar contained core d98cff', linear((217/255, 140/255, 1)), emission=1)
    ember = c.material('Mortar quiet violet tube fractures', linear((179/255, 71/255, 1)), emission=.75)
    for mat in (violet, hot, ember):
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.009, .003, .015, 1)

    # Longitudinal sections describe hips, waist, ribcage, shoulders and neck.
    # This is not a stretched sphere: the pinched waist survives beneath the rig.
    torso = loft(c, 'Stocky badger hips waist and shoulders', [
        (-1.02, .04, .49, .06), (-.91, .38, .51, .22),
        (-.68, .68, .54, .35), (-.46, .70, .56, .38),
        (-.17, .565, .56, .33), (.08, .58, .57, .36),
        (.33, .68, .60, .41), (.55, .64, .63, .37),
        (.76, .39, .64, .26), (.86, .07, .65, .07)], fur)
    torso['measurementRole'] = 'torso'
    body = [torso, ell(c, 'Exposed muscular neck', (0, .73, .70), (.255, .31, .25), fur)]
    for side in (-1, 1):
        for i, (x, y, z) in enumerate(((.57, .48, .82), (.65, .27, .73), (.57, -.05, .74),
                                      (.61, -.44, .76), (.59, -.65, .68))):
            body.append(horn(c, 'Swept silver charcoal flank lock',
                             [(side*x*.91, y+.065, z), (side*(x+.055), y-.025, z-.05),
                              (side*(x+.09), y-.17, z-.15)], [.045, .041, .002],
                             tips if i in (0, 3) else fur, 10))
    skull = head_b(c, (0, .99, .94), .29, .345, pale, dark, dark)
    for side in (-1, 1):
        skull.append(ell(c, 'Exposed rounded charcoal ear', (side*.298, .787, 1.09),
                         (.066, .088, .045), dark, taper=-.18, angle=side*-.28))
        skull.append(ell(c, 'Quiet grey ear fold', (side*.300, .789, 1.128),
                         (.023, .040, .008), fur, angle=side*-.28))
    tail = [ell(c, 'Short low badger tail', (0, -1.075, .41), (.12, .20, .10), fur, taper=-.40),
            ell(c, 'Small warm ivory tail tip', (0, -1.20, .445), (.073, .09, .055), pale, taper=-.35)]
    limbs = {}
    for name, x, y in [('front_left', -.86, .49), ('front_right', .86, .49),
                       ('rear_left', -.87, -.64), ('rear_right', .87, -.64)]:
        limbs[name] = paw(c, name, (x*.68, y-.08, .46), (x, y, .22), .20, fur, dark, claw)

    harness = []
    for x in (-.43, .43):
        harness.append(c.box('Black timber side rail', (x, -.14, .99), (.12, 1.28, .14), wood, .023))
        for y in (-.64, .34):
            harness.append(c.box('Broad copper rail saddle', (x, y, 1.079), (.20, .16, .055), copper, .018))
            harness.append(c.ell('Raised copper saddle rivet', (x, y, 1.114), (.032, .032, .014), copper_edge))
    for y in (-.66, .33):
        harness.append(c.box('Crosswise copper bound timber', (0, y, .98), (.97, .125, .105), wood, .021))
        harness.append(c.box('Readable warm copper cross band', (0, y, 1.05), (.98, .08, .035), copper, .012))
    # Rear baseplate, breech ball and forward two-legged trunnion cradle.
    harness += [c.cylinder('Rear octagonal mortar baseplate', (0, -.49, 1.065), .43, .12, steel, 8),
                c.cylinder('Copper edged baseplate seat', (0, -.49, 1.14), .37, .045, copper, 32),
                c.ell('Rounded rear breech heel', tuple(TUBE_BASE), (.30, .31, .25), steel)]
    harness.append(turned(c, 'Inclined hollow mortar barrel',
                          [(.198, .02), (.228, .95), (.247, 1.18), (.242, TUBE_LENGTH),
                           (.158, TUBE_LENGTH), (.150, 1.20), (.145, .45)],
                          [steel, lip, bore], [0, 0, 1, 1, 2, 2, 0]))
    floor = c.cylinder('Deep bore floor', tuple(tube_point(0, 0, .55)), .16*TUBE_RADIUS_SCALE, .012, bore, 48)
    floor.rotation_euler.x = -TUBE_ANGLE
    harness.append(floor)
    for z in (.17, .74):
        harness.append(turned(c, 'Heavy copper barrel reinforcing collar',
                              [(.252, z-.060), (.272, z-.037), (.272, z+.037), (.252, z+.060),
                               (.213, z+.060), (.213, z-.060)], [copper]))
        harness.append(turned(c, 'Rubbed collar edge',
                              [(.269, z+.034), (.274, z+.041), (.274, z+.062), (.245, z+.062)], [copper_edge]))
    for side in (-1, 1):
        hinge = tube_point(side*.245*TUBE_RADIUS_SCALE, 0, .72)
        harness.append(horn(c, 'Visible splayed bipod support',
                            [(side*.46, .16, 1.08), (side*.36, .16, 1.38), tuple(hinge)],
                            [.035, .033, .042], copper_edge, 12))
        harness.append(c.ell('Bipod locking pin', tuple(hinge), (.047, .045, .045), copper))
    # Small fractures run down the visible rear-facing cylinder surface.
    for side in (-1, 1):
        points = [tube_point(side*x*TUBE_RADIUS_SCALE, (-math.sqrt(max(.001, .229**2-x*x))-.006)*TUBE_RADIUS_SCALE, z)
                  for x, z in ((.09, .98), (.105, .90), (.085, .83), (.11, .78))]
        harness.append(horn(c, 'Fine violet longitudinal barrel fracture', points, [.006, .008, .008, .004], ember, 8))

    for side in (-1, 1):
        x, y = side*.57, -.23
        harness += [c.ell('Dark grenade shell', (x, y, 1.015), (.14, .28, .14), steel),
                    c.ell('Exposed purple grenade core', (x, y, 1.125), (.095, .227, .056), violet),
                    c.ell('Contained lilac hot center', (x, y, 1.172), (.025, .184, .014), hot)]
        for dy in (-.23, 0, .23):
            harness.append(c.box('Copper cage transverse band', (x, y+dy, 1.19 if dy == 0 else 1.09),
                                 (.255 if dy == 0 else .20, .041, .035), copper, .011))
        for dx in (-.108, .108):
            harness.append(horn(c, 'Swept copper canister cage',
                                [(x+dx*.7, y-.245, 1.05), (x+dx, y-.14, 1.155),
                                 (x+dx, y+.14, 1.155), (x+dx*.7, y+.245, 1.05)], [.015]*4, copper_edge, 10))
        harness.append(c.box('Copper grenade end cap', (x, y+.269, 1.07), (.12, .066, .055), copper, .014))
        harness.append(c.ell('Quiet cage patina fleck', (x+.074, y, 1.21), (.024, .012, .007), patina))

    refine(c, body, skull, limbs, (fur, tips, pale),
           {wood: ('wood', dark), copper: ('metal', patina), copper_edge: ('metal', dark),
            steel: ('metal', bore), lip: ('metal', steel), claw: ('horn', dark)}, extra=(tail, harness))
    # Persist authored depth masks, including coat locks. The shared normal/form
    # shader provides shape modelling; the scene's key/fill setup stays intact.
    for ob in body+skull+tail+[o for _, objects in limbs.values() for o in objects]:
        if any(mat in (fur, tips) for mat in ob.data.materials):
            paint_depth(c, ob)
    for category, objects in [('body', body), ('head', skull), ('tail', tail), ('equipment', harness)]:
        for ob in objects:
            ob['mortarPart'] = category
    for name, (_, objects) in limbs.items():
        for ob in objects:
            ob['mortarPart'] = name
    # Equipment is rigid with the torso, not the secondary animated 'load' part.
    asset = finish_b(c, limbs, body, skull, (0, .73, .82), {'tail': ((0, -.95, .42), tail)})
    # Follow the carrier's pose, but keep the metal assembly rigid while the
    # shared claw Action squashes/stretches the animal during its pounce.
    mount = control(c.scene, 'Rigid mortar assembly', parent=asset['parts']['body'])
    rigid_pose = mount.constraints.new('COPY_TRANSFORMS')
    rigid_pose.name = 'Follow carrier without inherited shear'
    rigid_pose.target = asset['parts']['body']
    rigid_pose.owner_space = 'WORLD'
    rigid_pose.target_space = 'WORLD'
    rigid_pose.remove_target_shear = True
    rigid_scale = mount.constraints.new('COPY_SCALE')
    rigid_scale.name = 'Keep authored equipment dimensions during claw'
    rigid_scale.target = asset['root']
    rigid_scale.owner_space = 'WORLD'
    rigid_scale.target_space = 'WORLD'
    attach(harness, mount)
    point = tube_point(0, 0, TUBE_LENGTH)
    muzzle = control(c.scene, 'Mortar muzzle socket', point, mount)
    muzzle['socketRole'] = 'muzzle'
    muzzle['referenceSize'] = 32
    muzzle['referencePoint'] = [16+32*point.x/spec['orthoScale'], 16-32*point.y/spec['orthoScale']]
    muzzle['referenceYDown'] = True
    muzzle['tubeAngleFromVerticalDegrees'] = 45
    muzzle['tubeProjectedLength'] = TUBE_LENGTH*math.sin(TUBE_ANGLE)
    asset['sockets']['muzzle'] = muzzle
    return asset
