"""North-facing upright biped. Head, mantle/arms, hands and legs remain distinct groups."""
import math
import bpy
from mathutils import Vector


def build(c, style=None):
    style = style or {}
    parts = {'left_leg': [], 'right_leg': [], 'upper': [], 'head': [], 'arms': [], 'hands': []}
    fur = c.material('Cool grey grouped fur', style.get('furBase', (.19, .23, .24)), 'organic', form_shading=True)
    # Badger-specific value range calibrated against the original at 32 pixels.
    # Shared material defaults (including the turret) remain unchanged.
    tones = fur.node_tree.nodes['Broad muscle values'].color_ramp.elements
    def linear_byte(value):
        value /= 255
        return value / 12.92 if value <= .04045 else ((value + .055) / 1.055)**2.4
    for tone, rgb in zip(tones, style.get('furTones', [(5, 9, 13), (14, 23, 31), (39, 55, 67), (109, 127, 139)])):
        tone.color = (*[linear_byte(v) for v in rgb], 1)
    dark = c.material('Dark mask and ears', (.009, .012, .014), 'organic')
    ivory = c.material('Pale head fur', style.get('headColor', (.98, .99, .96)), 'organic')
    # Keep the same texture and frequency, but remap broad fur values into off-white.
    # The tail and facial bands have independent materials/value ranges.
    for node in ivory.node_tree.nodes:
        if node.type == 'MAP_RANGE' and node.inputs['Value'].is_linked:
            if node.inputs['Value'].links[0].from_node.type == 'TEX_NOISE':
                node.inputs['To Min'].default_value = .99
                node.inputs['To Max'].default_value = 1.10
    tail_fur = c.material('Independent pale tail fur', style.get('tailColor', (.70, .73, .68)), 'organic')
    black = c.material('Near-black eyes and nose', (.002, .003, .004))
    if style.get('paintedFur'):
        satin = black.node_tree.nodes['Principled BSDF']
        satin.inputs['Roughness'].default_value = .46
        satin.inputs['Specular IOR Level'].default_value = .22
    glint = c.material('Warm eye reflection', (.89, .9, .78))
    feet = c.material('Soft grey foot fur', style['footColor'], 'organic') if 'footColor' in style else dark
    # Feet point north under the vertical body; no south-facing shoe shapes.
    for side in [-1, 1]:
        limb = parts['left_leg' if side == -1 else 'right_leg']
        limb.append(c.ell('Forward foot', (side * .21, -.03, .12), (.14, .22, .11), feet))
        limb.append(c.ell('Upright hind leg', (side * .20, -.20, .48), (.15, .16, .39), fur))
    c.ell('Pelvis', (0, -.26, .87), (.47, .29, .26), fur)
    c.ell('Standing torso', (0, -.17, 1.22), (.54, .39, .45), fur)
    c.ell('Small pale south tail', (0, -.60, .95), (.0855, .1496, .115), tail_fur)
    arms = [c.ell('Shoulder mantle', (0, -.215, 1.5), (.68, .403, .22), fur)]
    for side in [-1, 1]:
        arms.append(c.ell('Broad rear torso muscle', (side*.22, -.41, 1.51), (.31, .18, .17), fur))
    for side in [-1, 1]:
        end_y = .76 if side == 1 else .85
        arms.append(c.ell('Deltoid', (side * .49, -.21, 1.44), (.23, .25, .20), fur))
        # Explicit elbow separates a longer upper arm from the shorter forearm.
        # Tangents agree at the elbow; hand locations and the root stay fixed.
        pts = [Vector((side * .49, -.25, 1.47)), Vector((side * .72, -.16, 1.45)),
               Vector((side * .79, .15, 1.47)), Vector((side * .66, .35, 1.49)),
               Vector((side * .53, .55, 1.51)), Vector((side * .29, .66, 1.52)),
               Vector((side * .13, end_y, 1.54))]
        vs, fs = [], []
        rings = 80
        for i in range(rings):
            along = i / (rings - 1)
            upper = along <= .52
            t = along / .52 if upper else (along - .52) / .48
            u = 1 - t
            segment = pts[:4] if upper else pts[3:]
            center = u**3 * segment[0] + 3*u*u*t*segment[1] + 3*u*t*t*segment[2] + t**3*segment[3]
            tangent = (3*u*u*(segment[1]-segment[0])+6*u*t*(segment[2]-segment[1])+3*t*t*(segment[3]-segment[2])).normalized()
            normal = tangent.cross(Vector((0, 0, 1))).normalized()
            binormal = tangent.cross(normal).normalized()
            radius = (.175 + .034*math.sin(math.pi*t)) if upper else (.175*u + .073*t + .037*math.sin(math.pi*t))
            if not upper:
                # Slim only the forearm belly, preserving elbow and wrist joins.
                radius *= 1 - .06*math.sin(math.pi*t)**2
            for j in range(24):
                angle = j * math.tau / 24
                v = center + radius * (math.cos(angle)*normal + math.sin(angle)*binormal)
                vs.append(tuple(v))
        for i in range(rings - 1):
            for j in range(24):
                a, b = i*24+j, i*24+(j+1)%24
                fs.append((a, b, b+24, a+24))
        fs.extend([tuple(reversed(range(24))), tuple((rings-1)*24+j for j in range(24))])
        mesh = bpy.data.meshes.new('Anatomical arm sweep')
        mesh.from_pydata(vs, [], fs)
        mesh.update()
        ob = bpy.data.objects.new('Arm', mesh)
        c.scene.collection.objects.link(ob)
        mesh.materials.append(fur)
        arms.append(ob)
        hand = c.box('Weapon-ready grip', (side*.13, end_y+.035, 1.55), (.17, .18, .13), dark, .048)
        hand.rotation_euler.z = side*.20
        hands = [hand, c.ell('Folded thumb', (side*.065, end_y+.01, 1.585), (.037, .07, .035), fur)]
        parts['arms'].extend(hands)
        parts['hands'].extend(hands)
    parts['arms'].append(c.union('Continuous mantle and arms', arms))
    before_head = set(c.scene.objects)
    # Grow around the fixed north tip; rear rounding changes only on the south half.
    head = c.ell('Broad cheeked compact skull', (0, .1056, 1.85), (.42525, .4944, .23), ivory)
    for v in head.data.vertices:
        x, y, z = v.co
        v.co.x = math.copysign(abs(x)**.87, x)*(1-.29*max(0, y))
        v.co.y = math.copysign(abs(y)**.92, y)
        if y < -.2:
            blend = min(1, (-y-.2)/.6)
            blend = blend*blend*(3-2*blend)
            v.co.y = (1-blend)*v.co.y - blend*abs(y)**.64
    # Curved face bands remain authored and independent of generated fur imagery.
    m = ivory.copy()
    m.name = 'Authored curved badger mask over fur'
    head.data.materials[0] = m
    n, l = m.node_tree.nodes, m.node_tree.links
    bs = n.get('Principled BSDF')
    pale = bs.inputs['Base Color'].links[0].from_socket
    tex = n.new('ShaderNodeTexCoord')
    sep = n.new('ShaderNodeSeparateXYZ')
    l.new(tex.outputs['Generated'], sep.inputs[0])
    def math_node(op, socket, second=None):
        node = n.new('ShaderNodeMath'); node.operation = op
        l.new(socket, node.inputs[0])
        if second is not None:
            if isinstance(second, (int, float)):
                node.inputs[1].default_value = second
            else:
                l.new(second, node.inputs[1])
        return node.outputs[0]
    x = math_node('ABSOLUTE', math_node('SUBTRACT', sep.outputs['X'], .5))
    width = math_node('ADD', math_node('MULTIPLY', math_node('SINE', math_node('MULTIPLY', sep.outputs['Y'], math.pi)), .62), .38)
    coord = math_node('DIVIDE', x, width)
    mask = n.new('ShaderNodeValToRGB')
    mask.color_ramp.elements.remove(mask.color_ramp.elements[1])
    for i, (pos, value) in enumerate([(0, 0), (.13, 0), (.18, 1), (.33, 1), (.40, 0)]):
        e = mask.color_ramp.elements[0] if i == 0 else mask.color_ramp.elements.new(pos)
        e.position, e.color = pos, (value, value, value, 1)
    l.new(coord, mask.inputs[0])
    mix = n.new('ShaderNodeMixRGB')
    mix.name = 'Authored facial band mix'
    l.new(mask.outputs[0], mix.inputs[0]); l.new(pale, mix.inputs[1])
    mix.inputs[2].default_value = (.008, .012, .015, 1)
    l.new(mix.outputs[0], bs.inputs['Base Color'])
    c.strengths.append(n['Surface detail strength'].inputs[0])
    c.box('Flat nose', (0, .601, 1.93), (.205, .095, .060), black, .029)
    for side in [-1, 1]:
        fierce = style.get('fierceEyes', False)
        eye = c.ell('Eye', (side*.175, .345, 2.064), (.096, .050, .027) if fierce else (.075, .049, .027), black)
        eye.rotation_euler.z = side*(-.18 if fierce else .27)
        c.ell('Eye reflection', (side*.175-.008, .354 if fierce else .345, 2.09), (.022, .011, .007) if fierce else (.027, .016, .007), glint)
        brow = c.ell('Forehead-side brow', (side*.175, .298 if fierce else .282, 2.105), (.103, .022, .014) if fierce else (.080, .020, .014), dark)
        brow.rotation_euler.z = side*(-.38 if fierce else .27)
        ear_y = style.get('earSouthOffset', 0)
        ear = c.ell('Laid-back dark ear', (side*.29925, .025-ear_y, 2.044), (.060, .094, .030), dark)
        ear.rotation_euler.z = side*.30
        crease = c.ell('Ear crease', (side*.30425, .035-ear_y, 2.071), (.020, .048, .007), black)
        crease.rotation_euler.z = side*.30
    parts['head'] = [ob for ob in c.scene.objects if ob not in before_head and ob.type == 'MESH']
    for ob in parts['head']:
        ob.location.y -= style.get('headSouthOffset', 0)
    def mask(p):
        x, y = abs(p.x), p.y
        # Painted recess at the elbow and behind the skull, with broad irregular
        # shoulder highlights. Surface normals supply the outer muscle falloff.
        elbow = math.exp(-((x-.66)/.14)**2 - ((y-.35)/.12)**2)
        neck = math.exp(-((x-.34)/.14)**2 - ((y+.27)/.14)**2)
        shoulder = math.exp(-((x-.60)/.19)**2 - ((y+.16)/.20)**2)
        return .93 - .25*elbow - .13*neck + .07*shoulder
    for ob in c.scene.objects:
        if ob.type == 'MESH' and any(slot.material == fur for slot in ob.material_slots):
            c.paint_form_mask(ob, mask)
    # Authored pose centred around its stable root, not export-time cropping.
    for ob in c.scene.objects:
        if ob.type == 'MESH':
            ob.location.y -= .10
            if ob not in parts['left_leg'] and ob not in parts['right_leg']:
                parts['upper'].append(ob)
    if style.get('paintedFur'):
        from badger_material_parts import painted_coat
        painted_coat(c, parts, {'body': fur, 'dark': dark, 'head': m, 'tail': tail_fur, 'feet': feet}, style)
    return parts
