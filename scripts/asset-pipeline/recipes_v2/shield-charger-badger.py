"""Schild-Anstürmer: sturdy upright badger behind a separate frontal shield prop.

Select draft.formVariant (1..3) in assets:shape --model-settings; the catalog
model.formVariant is only the default. North is +Y, character-right is +X.
The shield owns its own control ('shield', pivot at the grip between both
hands, parented to the body) so windup/charge/recover can lower or swing it
without touching the anatomy. Arms are separate 'left_arm'/'right_arm' parts.
Clips (shield_charger_motion_v2): move, claw (shield bash), windup (shield
swung to the left flank, body crouched), charge (run, shield aside), recover
(exhausted, shield lifted back from marker 'raise').

Texture provenance (catalog keys -> art/poc/pipeline-v2/textures/shield-charger/,
512 px downscales of Astra/Codex image-generation candidates; prompts and source
paths in that session's candidates/prompts.json, archived copies in
D:/Fragdachse-render/texture-archive/shield-charger/):
  organic       charger-fur-01.png      <- fur_01      sooty brown coat (detail value)
  shieldFront   shield-front-02.png     <- shield_02   red planks, two iron struts (shield_06 with
                the claw emblem was tried: top-down it only reads as pale specks)
  shieldRim     shield-rim-02.png       <- rim_02      riveted iron band, repeats along X; partly
                desaturated so the top edge keeps its iron contrast against the red face
  shieldLeather charger-leather-01.png  <- leather_01  oxblood leather straps
Picks by the lead session for the draft review; the user may still swap them.
"""
import json
import math
import bpy
from mathutils import Vector
from recipes_v2.enemy_parts_a import ell, loft, horn, ribbon, outward_normals
from enemy_parts_b import paw
from enemy_craft_parts import head_b, refine, finish_b
from enemy_craft_surfaces import technical
from weapon_surface_parts import paint_depth
from rigs_v2 import control, attach


ARC = math.radians(60)  # Half of the 120 degree gameplay block arc, measured from the pivot.

FORMS = {
    # Tall curved tower shield: a broad crescent band at the hitbox edge.
    1: dict(kind='tower', hand=(.36, .90, 1.02), grip=(0, .96, 1.02)),
    # Compact dished round boss shield with radial rim spikes, tilted slightly up.
    2: dict(kind='round', hand=(.30, .92, .90), grip=(0, .99, .90)),
    # Wedge ram: two plank panels meeting in an iron-shod forward ridge.
    3: dict(kind='wedge', hand=(.30, .74, .96), grip=(0, .80, .96)),
}


def sheet(c, name, surface, columns, rows, thickness, material, bevel=.014):
    """Closed thick panel from an outer surface F(u, v) -> (point, outward normal)."""
    outer, inner = [], []
    for j in range(rows+1):
        for i in range(columns+1):
            point, normal = surface(i/columns, j/rows)
            outer.append(point)
            inner.append(point-normal*thickness)
    count = len(outer)
    index = lambda i, j: j*(columns+1)+i
    faces = []
    for j in range(rows):
        for i in range(columns):
            quad = (index(i, j), index(i+1, j), index(i+1, j+1), index(i, j+1))
            faces.append(quad)
            faces.append(tuple(count+k for k in reversed(quad)))
    border = ([index(i, 0) for i in range(columns)]+[index(columns, j) for j in range(rows)]
              +[index(i, rows) for i in range(columns, 0, -1)]+[index(0, j) for j in range(rows, 0, -1)])
    for a, b in zip(border, border[1:]+border[:1]):
        faces.append((b, a, count+a, count+b))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(p) for p in outer+inner], [], faces)
    outward_normals(mesh)
    # Grid UVs (outer and inner share them) for authored image materials.
    layer = mesh.uv_layers.new(name='ShieldUV')
    for loop in mesh.loops:
        k = loop.vertex_index % count
        layer.data[loop.index].uv = ((k % (columns+1))/columns, (k//(columns+1))/rows)
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    ob = bpy.data.objects.new(name, mesh)
    c.scene.collection.objects.link(ob)
    if bevel:
        edge = ob.modifiers.new('Worn plank edge', 'BEVEL')
        edge.width, edge.segments = bevel, 2
    return ob


def tube_uv(ob, sides, radius):
    """Length-wise UVs for a horn() tube so a horizontally repeating trim texture runs along it."""
    mesh = ob.data
    rings = len(mesh.vertices)//sides
    points = [mesh.vertices[i*sides].co for i in range(rings)]
    lengths = [0]
    for a, b in zip(points, points[1:]):
        lengths.append(lengths[-1]+(b-a).length)
    repeat = math.tau*radius
    layer = mesh.uv_layers.new(name='ShieldUV')
    for polygon in mesh.polygons:
        ids = [mesh.loops[i].vertex_index for i in polygon.loop_indices]
        wrap = any(k % sides == 0 for k in ids) and any(k % sides == sides-1 for k in ids)
        for i, k in zip(polygon.loop_indices, ids):
            j = k % sides
            if wrap and j == 0 and len(ids) == 4:
                j = sides
            layer.data[i].uv = (lengths[k//sides]/repeat, j/sides) if len(ids) == 4 else (0, 0)
    return ob


def image_material(c, name, key, color, gamma=1.0, saturation=1.0, density=None):
    """Painted albedo from an authored image; the procedural colour is the fallback.

    Mapped on ShieldUV, or repeated in object space at `density` tiles per BU for
    parts without authored UVs (straps). Gamma < 1 lifts a scanned swatch so the
    shield still separates from the coat at 30 px.
    """
    mat = c.material(name, color)
    image = c.images.get(key)
    if image:
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = image
        texture.interpolation = 'Linear'
        if density:
            coords = nodes.new('ShaderNodeTexCoord')
            scale = nodes.new('ShaderNodeVectorMath')
            scale.operation = 'SCALE'
            scale.inputs['Scale'].default_value = density
            links.new(coords.outputs['Object'], scale.inputs[0])
            links.new(scale.outputs['Vector'], texture.inputs['Vector'])
        else:
            coords = nodes.new('ShaderNodeUVMap')
            coords.uv_map = 'ShieldUV'
            links.new(coords.outputs['UV'], texture.inputs['Vector'])
        lift = nodes.new('ShaderNodeGamma')
        lift.inputs['Gamma'].default_value = gamma
        links.new(texture.outputs['Color'], lift.inputs['Color'])
        tone = nodes.new('ShaderNodeHueSaturation')
        tone.inputs['Saturation'].default_value = saturation
        links.new(lift.outputs['Color'], tone.inputs['Color'])
        links.new(tone.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
    mat['FD_ShieldImage'] = key
    return mat


def along(surface, points, lift):
    """Surface-following path for bands, seams and rims."""
    result = []
    for u, v in points:
        point, normal = surface(u, v)
        result.append(tuple(point+normal*lift))
    return result


def tower_shield(c, mats):
    iron, edge, recess, leather = mats['iron'], mats['edge'], mats['recess'], mats['leather']
    red = image_material(c, 'Charger tower front red planks iron struts', 'shieldFront', (.36, .065, .035), .68, 1.2)
    trim = image_material(c, 'Charger riveted iron trim', 'shieldRim', (.105, .105, .11), .5, .45)
    bottom, top, low, high = 1.25, .95, .12, 1.86
    def surface(u, v):
        a = (u*2-1)*ARC
        n = Vector((math.sin(a), math.cos(a), 0))
        # Rounded upper corners keep the tower readable as a shield, not a wall.
        corner = max(0, abs(u*2-1)-.72)/.28
        z = low+v*(high-low-.30*corner*corner)
        r = bottom-(bottom-top)*v
        normal = (n*(high-low)+Vector((0, 0, bottom-top))).normalized()
        return Vector((n.x*r, n.y*r, z)), normal
    parts = [sheet(c, 'Curved oxblood plank tower shield', surface, 40, 10, .085, red)]
    for u in (.2, .35, .5, .65, .8):
        parts.append(horn(c, 'Recessed vertical plank seam', along(surface, [(u, .03), (u, .5), (u, .97)], .004),
                          [.010, .010, .010], recess, 6))
    for v in (.24, .70):
        path = along(surface, [(i/12, v) for i in range(13)], .018)
        parts.append(tube_uv(horn(c, 'Forged iron cross band', path, [.034]*len(path), trim, 8), 8, .034))
        for u in (.08, .3, .5, .7, .92):
            point, normal = surface(u, v)
            parts.append(ell(c, 'Domed iron band rivet', tuple(point+normal*.05), (.045, .045, .045), edge))
    rim = along(surface, [(0, 0), (0, .5), (0, .92), (.04, 1), (.25, 1), (.5, 1), (.75, 1), (.96, 1), (1, .92), (1, .5), (1, 0)], .01)
    parts.append(tube_uv(horn(c, 'Forged iron rim and top cap', rim, [.05]*len(rim), trim, 10), 10, .05))
    base = along(surface, [(i/10, 0) for i in range(11)], .01)
    parts.append(tube_uv(horn(c, 'Iron bottom shoe', base, [.04]*len(base), trim, 8), 8, .04))
    boss, normal = surface(.5, .48)
    parts.append(ell(c, 'Low central iron boss', tuple(boss+normal*.05), (.17, .17, .17), iron))
    parts.append(ell(c, 'Rubbed boss crown', tuple(boss+normal*.14), (.075, .075, .075), edge))
    for x in (-.36, .36):
        parts.append(c.box('Leather inner grip strap', (x, .93, 1.02), (.10, .05, .30), leather, .01))
    return parts


def round_shield(c, mats):
    red, iron, edge, recess = mats['leather_red'], mats['iron'], mats['edge'], mats['recess']
    # Compact enough that the rim stays below the brow line and the snout peeks over it.
    radius, sphere, tilt = .82, 1.45, math.radians(16)
    center = Vector((0, 1.06, .90))
    up = Vector((0, -math.sin(tilt), math.cos(tilt)))
    side = Vector((1, 0, 0))
    face = Vector((0, math.cos(tilt), math.sin(tilt)))
    base = math.sqrt(sphere*sphere-radius*radius)
    def local(x, y):
        h = math.sqrt(max(0, sphere*sphere-x*x-y*y))
        point = center+side*x+up*y+face*(h-base)
        normal = (side*x+up*y+face*h).normalized()
        return point, normal
    def surface(u, v):
        a, b = u*2-1, v*2-1
        return local(radius*a*math.sqrt(max(0, 1-b*b/2)), radius*b*math.sqrt(max(0, 1-a*a/2)))
    parts = [sheet(c, 'Dished red hide round shield', surface, 24, 24, .075, red)]
    def polar(angle, r, lift=0):
        point, normal = local(r*math.sin(angle), r*math.cos(angle))
        return point+normal*lift, normal
    for k in range(4):
        angle = math.radians(45+90*k)
        path = [tuple(polar(angle, r, .016)[0]) for r in (.20, .45, .70, .93)]
        parts.append(horn(c, 'Diagonal forged iron strap', path, [.040]*4, iron, 8))
    for half in (0, 1):
        path = [tuple(polar(math.radians(180*half+a), radius, .0)[0]) for a in range(0, 181, 15)]
        parts.append(horn(c, 'Thick iron rolled rim', path, [.058]*len(path), edge, 10))
    hub, normal = polar(0, 0)
    parts.append(ell(c, 'Large domed iron boss', tuple(hub+normal*.03), (.23, .23, .21), iron))
    parts.append(ell(c, 'Rubbed boss collar', tuple(hub+normal*.08), (.17, .17, .14), edge))
    parts.append(horn(c, 'Short forward boss spike', [tuple(hub+normal*.17), tuple(hub+normal*.24),
                                                     tuple(hub+normal*.31)], [.075, .045, .006], edge, 10))
    for degrees in (-130, -86, -44, 44, 86, 130):
        angle = math.radians(degrees)
        root, normal = polar(angle, radius, .02)
        out = (side*math.sin(angle)+up*math.cos(angle)).normalized()
        parts.append(horn(c, 'Radial forged rim spike', [tuple(root), tuple(root+out*.10+normal*.03),
                                                        tuple(root+out*.21+normal*.05)], [.05, .03, .004], iron, 8))
    for x in (-.30, .30):
        parts.append(c.box('Leather inner arm strap', (x, .96, .90), (.09, .05, .26), mats['leather'], .01))
    return parts


def wedge_shield(c, mats):
    wood, red, iron, edge, recess = mats['wood'], mats['red'], mats['iron'], mats['edge'], mats['recess']
    # Panel ends sit just inside the 60 degree half arc; edge fittings close the remainder.
    end_angle = math.radians(57)
    apex, end = Vector((0, 1.27)), Vector((1.06*math.sin(end_angle), 1.06*math.cos(end_angle)))
    # Low and nearly upright: the head stays above it; from above the red top beam draws the V.
    low, high, inset = .14, 1.12, .14
    def surface(u, v, lift=0):
        s = u*2-1
        tip = Vector((math.copysign(end.x, s or 1), end.y))
        base = apex.lerp(tip, abs(s))
        direction = (tip-apex).normalized()
        n = Vector((-direction.y, direction.x)) if s >= 0 else Vector((direction.y, -direction.x))
        if abs(s) < 1e-6:
            n = Vector((0, 1))
        n = Vector((n.x, n.y, 0)).normalized()
        point = Vector((base.x, base.y, 0))-n*inset*v+Vector((0, 0, low+v*(high-low)))
        normal = (n*(high-low)+Vector((0, 0, inset))).normalized()
        return point+normal*lift, normal
    parts = [sheet(c, 'Wedge ram of horizontal timber', surface, 40, 10, .11, wood)]
    band = lambda u, v: surface(u, v, .012)
    parts.append(sheet(c, 'Painted warm red chevron band', lambda u, v: band(.04+u*.92, .36+v*.40), 40, 2, .012, red, 0))
    for v in (.20, .84):
        path = along(surface, [(i/20, v) for i in range(21)], .004)
        parts.append(horn(c, 'Recessed horizontal plank seam', path, [.010]*len(path), recess, 6))
    ridge = along(surface, [(.5, 0), (.5, .5), (.5, 1)], .02)
    parts.append(horn(c, 'Iron shod forward ridge', ridge, [.065, .065, .055], edge, 10))
    top = along(surface, [(i/20, 1) for i in range(21)], -.045)
    parts.append(horn(c, 'Red painted top beam', top, [.075]*len(top), red, 10))
    bottom = along(surface, [(i/20, 0) for i in range(21)], .0)
    parts.append(horn(c, 'Iron bottom shoe', bottom, [.034]*len(bottom), iron, 8))
    for u in (0, 1):
        side = along(surface, [(u, 0), (u, .5), (u, 1)], .0)
        parts.append(horn(c, 'Iron side edge', side, [.034]*3, iron, 8))
    nose, normal = surface(.5, .32)
    parts.append(horn(c, 'Forged ram beak', [tuple(nose), tuple(nose+Vector((0, .09, -.01))),
                                             tuple(nose+Vector((0, .18, -.03)))], [.13, .08, .012], edge, 10))
    for u in (.18, .32, .68, .82):
        for v in (.22, .78):
            point, normal = surface(u, v)
            parts.append(ell(c, 'Square headed iron nail', tuple(point+normal*.03), (.034, .034, .03), edge))
    for x in (-.30, .30):
        parts.append(c.box('Leather inner grip strap', (x, .78, .96), (.09, .05, .28), mats['leather'], .01))
    return parts


BUILDERS = {'tower': tower_shield, 'round': round_shield, 'wedge': wedge_shield}


def measure(objects):
    """Top-down extents of evaluated meshes relative to the export pivot."""
    deps = bpy.context.evaluated_depsgraph_get()
    radius, angles = 0, []
    for ob in objects:
        evaluated = ob.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        for vertex in mesh.vertices:
            p = evaluated.matrix_world @ vertex.co
            radius = max(radius, math.hypot(p.x, p.y))
            angles.append(math.degrees(math.atan2(p.x, p.y)))
        evaluated.to_mesh_clear()
    return radius, min(angles), max(angles)


def build(c, spec):
    variant = (spec.get('draft') or {}).get('formVariant', spec.get('model', {}).get('formVariant', 1))
    if variant not in FORMS:
        raise ValueError('shield-charger-badger formVariant must be 1, 2 or 3')
    form = FORMS[variant]
    fur = c.material('Charger warm umber coat', (.135, .102, .078), 'organic', form_shading=True)
    dark = c.material('Charger charcoal paws and mask', (.016, .013, .011), 'organic')
    pale = c.material('Charger warm ivory crown', (.66, .60, .48), 'organic')
    tips = c.material('Charger dusty flank fur', (.25, .205, .16), 'organic', form_shading=True)
    claw = c.material('Charger horn claws', (.43, .34, .23), 'organic')
    leather = image_material(c, 'Charger oxblood leather straps', 'shieldLeather', (.20, .06, .03), .85, density=1.6)
    seams = c.material('Charger pale leather seams', (.36, .20, .09), 'organic')
    mats = dict(
        leather=leather,
        red=technical(c, 'Charger oxblood painted planks', (.36, .065, .035), 'wood'),
        leather_red=technical(c, 'Charger red stretched hide', (.40, .085, .045), 'wood'),
        wood=technical(c, 'Charger oiled warm timber', (.36, .20, .095), 'wood'),
        iron=technical(c, 'Charger dark forged iron', (.105, .105, .11), 'steel'),
        edge=technical(c, 'Charger rubbed iron edges', (.40, .39, .37), 'edge'),
        recess=c.material('Charger dark plank recess', (.012, .008, .006)),
    )

    # Stocky hips, waist and raised shoulders: 1.50 / 1.16 = 1.29 torso outline.
    torso = loft(c, 'Braced upright hips waist and shoulders', [
        (-1.00, .05, .60, .07), (-.86, .38, .65, .26),
        (-.64, .53, .72, .33), (-.40, .50, .82, .35),
        (-.14, .55, .94, .37), (.10, .58, 1.03, .35),
        (.30, .52, 1.09, .30), (.44, .31, 1.13, .21),
        (.50, .06, 1.14, .07)], fur)
    torso['measurementRole'] = 'torso'
    body = [torso, ell(c, 'Thick lowered neck', (0, .50, 1.17), (.24, .26, .22), fur)]
    for side in (-1, 1):
        for i, (x, y, z) in enumerate(((.49, .30, 1.24), (.52, .02, 1.14), (.47, -.32, 1.00), (.47, -.60, .86))):
            body.append(horn(c, 'Swept dusty flank locks',
                             [(side*x, y+.06, z), (side*(x+.07), y-.04, z-.09),
                              (side*(x+.08), y-.20, z-.19)], [.047, .043, .002], tips if i == 0 else fur, 10))
    skull = head_b(c, (0, .66, 1.30), .27, .33, pale, dark, dark)
    for side in (-1, 1):
        skull.append(ell(c, 'Rounded charcoal ear', (side*.28, .46, 1.45), (.064, .085, .044), dark, taper=-.18, angle=side*-.28))
    tail = [ell(c, 'Short low badger tail', (0, -.98, .42), (.12, .18, .11), fur, taper=-.40),
            ell(c, 'Small ivory tail tip', (0, -1.10, .45), (.075, .085, .05), pale, taper=-.35)]
    legs = {name: paw(c, name, (side*.36, -.40, .60), (side*.54, -.70, .18), .20, fur, dark, claw)
            for name, side in [('left', -1), ('right', 1)]}
    hx, hy, hz = form['hand']
    arms = {}
    for name, side in (('left_arm', -1), ('right_arm', 1)):
        arm = [horn(c, 'Braced shoulder elbow forearm', [(side*.46, .28, 1.18), (side*.70, .42, .98),
                                                          (side*hx*1.12, hy-.12, hz)], [.21, .18, .15], fur),
               ell(c, 'Gripping hand behind shield', (side*hx, hy, hz), (.12, .14, .10), dark)]
        arms[name] = arm
    gear = []
    for side in (-1, 1):
        gear.append(ribbon(c, 'Saddle leather shoulder harness', [(side*.38, .40, 1.40), (side*.36, .08, 1.40),
                                                                  (side*.28, -.28, 1.22), (side*.35, -.56, 1.03)], [.095]*4, leather))
    gear.append(ribbon(c, 'Curved rear waist belt', [(-.48, -.46, .98), (-.29, -.52, 1.08),
                                                   (0, -.54, 1.10), (.29, -.52, 1.08), (.48, -.46, .98)], [.12]*5, leather))
    gear.append(c.box('Iron belt buckle', (.27, -.51, 1.11), (.16, .13, .045), mats['edge'], .02))

    shield = BUILDERS[form['kind']](c, mats)

    refine(c, body, skull, legs, (fur, tips, pale),
           {leather: ('leather', seams), mats['red']: ('wood', mats['recess']), mats['leather_red']: ('wood', mats['recess']),
            mats['wood']: ('wood', mats['recess']), mats['iron']: ('metal', mats['recess']),
            mats['edge']: ('metal', mats['iron']), claw: ('horn', dark)},
           extra=(tail, arms['left_arm'], arms['right_arm'], gear, shield))
    # The shared graphite coat texture would read cold; a warm umber pigment keeps it early-game.
    for material in (fur, tips):
        nodes, links = material.node_tree.nodes, material.node_tree.links
        color = nodes['Principled BSDF'].inputs['Base Color']
        source = color.links[0].from_socket
        warm = nodes.new('ShaderNodeMixRGB')
        warm.name = 'Authored warm umber coat pigment'
        warm.blend_type = 'MULTIPLY'
        warm.inputs[0].default_value = 1
        warm.inputs[2].default_value = (1.0, .66, .42, 1)
        links.new(source, warm.inputs[1])
        links.new(warm.outputs[0], color)
    anatomy = body+skull+tail+arms['left_arm']+arms['right_arm']+[ob for _, objects in legs.values() for ob in objects]
    for ob in anatomy:
        ob['chargerPart'] = 'anatomy'
        if any(mat in (fur, tips) for mat in ob.data.materials):
            paint_depth(c, ob)
    for ob in shield:
        ob['chargerPart'] = 'shield'
    asset = finish_b(c, legs, body+gear, skull, (0, .50, 1.20),
                     {'tail': ((0, -.86, .46), tail), 'left_arm': ((-.46, .28, 1.18), arms['left_arm']),
                      'right_arm': ((.46, .28, 1.18), arms['right_arm'])})
    # Separate prop control: clips lower or swing it around the grip, independent of the arms.
    carrier = control(c.scene, 'Frontal shield carry', form['grip'], asset['parts']['body'])
    attach(shield, carrier)
    carrier['grip'] = list(form['grip'])
    asset['parts']['shield'] = carrier
    bpy.context.view_layer.update()
    body_radius, _, _ = measure([ob for ob in anatomy if ob.name in bpy.data.objects])
    shield_radius, left, right = measure(shield)
    hitbox = spec['collisionDiameter']/2*spec['orthoScale']/(spec['targetSize']*spec.get('displayScale', 1))
    metrics = dict(variant=variant, kind=form['kind'], hitboxRadius=hitbox, bodyRadius=body_radius,
                   shieldRadius=shield_radius, shieldArcDegrees=right-left, shieldArcLeft=left, shieldArcRight=right)
    print('SHIELD_CHARGER_METRICS ' + json.dumps(metrics))
    asset['root']['formVariant'] = variant
    asset['root']['shieldArcDegrees'] = right-left
    asset['root']['authoringStage'] = 'Stage B: v1 tower draft'
    return asset
