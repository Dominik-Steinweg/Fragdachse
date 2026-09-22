"""Worn weapon finishes: authored color identity, directional grain and broad relief.

All detail is evaluated on the actual model with the shared camera and lights. World
coordinates keep wear at a consistent physical scale across large and small parts.
"""
def material(c, name, color, metal=0, kind='coat'):
    m = c.material(name, color, 'technical')
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes.get('Principled BSDF')
    original = bs.inputs['Base Color'].links[0].from_socket

    def node(type_name, label):
        out = nodes.new(type_name); out.label = out.name = label
        return out

    def connect(value, socket):
        if isinstance(value, (int, float, tuple, list)):
            socket.default_value = value
        else:
            links.new(value, socket)

    def math_node(operation, a, b=0, label='Surface math'):
        out = node('ShaderNodeMath', label); out.operation = operation
        connect(a, out.inputs[0]); connect(b, out.inputs[1])
        return out.outputs[0]

    def mix(a, b, factor=1, mode='MIX', label='Surface blend'):
        out = node('ShaderNodeMixRGB', label); out.blend_type = mode
        connect(factor, out.inputs[0]); connect(a, out.inputs[1]); connect(b, out.inputs[2])
        return out.outputs[0]

    def ramp(source, entries, label):
        out = node('ShaderNodeValToRGB', label)
        out.color_ramp.interpolation = 'EASE'
        for i, (position, value) in enumerate(entries):
            e = out.color_ramp.elements[i] if i < 2 else out.color_ramp.elements.new(position)
            e.position = position
            e.color = (value, value, value, 1) if isinstance(value, (int, float)) else (*value, 1)
        links.new(source, out.inputs[0])
        return out.outputs['Color']

    coords = node('ShaderNodeTexCoord', 'Local part coordinates')
    geometry = node('ShaderNodeNewGeometry', 'True surface normals')

    def noise(scale, stretch=(1, 1, 1), detail=3, local=False, label='Surface grain'):
        vector = node('ShaderNodeVectorMath', label+' direction'); vector.operation = 'MULTIPLY'
        vector.inputs[1].default_value = stretch
        links.new(coords.outputs['Generated'] if local else geometry.outputs['Position'], vector.inputs[0])
        out = node('ShaderNodeTexNoise', label)
        out.inputs['Scale'].default_value = scale
        out.inputs['Detail'].default_value = detail
        out.inputs['Roughness'].default_value = .72
        links.new(vector.outputs[0], out.inputs['Vector'])
        return out.outputs['Fac']

    is_wood, is_rubber, is_recess = kind == 'wood', kind == 'rubber', kind == 'recess'
    ceramic = kind == 'ceramic'
    steel = kind in ('steel', 'edge', 'brass', 'heat')
    grain = noise(5.5, (17, .65, 6), local=True, detail=4, label='Longitudinal walnut fibres') if is_wood else noise(145, (1, .17, 1), label='Machining and handling streaks')
    patches = noise(12, (1, .65, 1), label='Uneven finish and rubbed areas')
    pores = noise(270 if steel else 160, label='Fine material pores')

    if is_wood:
        tones = ramp(grain, [(.2, .23), (.39, .42), (.54, .90), (.69, 1.22), (.82, .5)], 'Dark fibres and worn oiled wood')
    else:
        tones = ramp(patches, [(.2, .35), (.38, .58), (.55, .90), (.72, 1.27), (.85, 1.38)], 'Broad rubbed finish values')
    textured = mix(original, tones, .32 if ceramic else .82, 'MULTIPLY', 'Uneven material finish')

    # Sparse elongated marks read as use, instead of evenly distributed grain.
    scratches = ramp(grain, [(.55, 0), (.66, .08), (.76, .6), (.86, 1)], 'Sparse handling scratches')
    scratches = math_node('MULTIPLY', scratches, .10 if ceramic or is_rubber else .30, 'Restrained exposed grain')
    worn_color = tuple(min(.85, v*.5+(.15 if steel else .09)) for v in color)
    if is_wood:
        worn_color = (.34, .18, .068)
    textured = mix(textured, (*worn_color, 1), scratches, label='Scraped and polished streaks')

    # A second scale supplies actual interrupted score lines, separate from mottling.
    score_vector = node('ShaderNodeVectorMath', 'Longitudinal score direction'); score_vector.operation = 'MULTIPLY'
    score_vector.inputs[1].default_value = (1, .10, 1)
    links.new(geometry.outputs['Position'], score_vector.inputs[0])
    scores = node('ShaderNodeTexVoronoi', 'Fine irregular machining scores')
    scores.feature = 'DISTANCE_TO_EDGE'; scores.inputs['Scale'].default_value = 82
    links.new(score_vector.outputs[0], scores.inputs['Vector'])
    fine_lines = ramp(scores.outputs['Distance'], [(0, 1), (.018, .9), (.06, 0), (1, 0)], 'Narrow etched score lines')
    interruptions = ramp(patches, [(.42, 0), (.54, .12), (.7, 1)], 'Sparse handling zones')
    fine_lines = math_node('MULTIPLY', fine_lines, interruptions)
    fine_lines = math_node('MULTIPLY', fine_lines, .025 if ceramic or is_rubber or is_recess else .32, 'Surface-specific scoring')
    score_color = (.21, .235, .25) if steel else tuple(min(.8, v*.65+.16) for v in color)
    if is_wood: score_color = (.39, .23, .10)
    textured = mix(textured, (*score_color, 1), fine_lines, label='Worn grain and machining detail')

    # Edge abrasion is broken up by low-frequency wear. Do not paint every edge white.
    local = node('ShaderNodeSeparateXYZ', 'Part edge distances')
    links.new(coords.outputs['Generated'], local.inputs[0])
    dx = math_node('MINIMUM', local.outputs['X'], math_node('SUBTRACT', 1, local.outputs['X']))
    dy = math_node('MINIMUM', local.outputs['Y'], math_node('SUBTRACT', 1, local.outputs['Y']))
    edge_distance = math_node('MINIMUM', dx, dy)
    edge = ramp(edge_distance, [(0, 1), (.027, .65), (.075, 0), (1, 0)], 'Worn exposed panel edges')
    broken = ramp(noise(57, detail=2, label='Broken edge wear'), [(.34, 0), (.55, .4), (.72, 1)], 'Interrupted chips')
    wear = math_node('MULTIPLY', edge, broken)
    wear = math_node('MULTIPLY', wear, .03 if is_recess else .10 if ceramic or is_rubber else .68, 'Material edge abrasion')
    exposed = (.28, .30, .29) if kind in ('coat', 'steel', 'edge') else tuple(min(.7, v*.65+.07) for v in color)
    if is_wood: exposed = (.36, .19, .075)
    if kind == 'brass': exposed = (.50, .30, .115)
    textured = mix(textured, (*exposed, 1), wear, label='Underlying worn material')
    if kind == 'heat':
        heat = ramp(local.outputs['Y'], [(0, (.14, .115, .07)), (.45, (.13, .075, .035)), (.72, (.09, .075, .11)), (1, (.019, .021, .024))], 'Heat tint through bronze and violet into soot')
        textured = mix(textured, heat, .53, label='Heat-cycled nozzle patina')

    facing = node('ShaderNodeVectorMath', 'Directional form shading'); facing.operation = 'DOT_PRODUCT'
    facing.inputs[1].default_value = (-.68, .26, .685)
    links.new(geometry.outputs['Normal'], facing.inputs[0])
    form_values = ramp(facing.outputs['Value'], [(.0, .16), (.36, .39), (.64, .93), (.88, 1.48), (1, 1.64)], 'Deep flanks and raised crowns')
    mask = node('ShaderNodeVertexColor', 'Authored material depth'); mask.layer_name = 'FD_FormMask'
    form_values = mix(form_values, mask.outputs['Color'], .55, 'MULTIPLY', 'Persisted part depth')
    forms = mix(textured, form_values, 1, 'MULTIPLY', 'Sculpted metal values')

    ao = node('ShaderNodeAmbientOcclusion', 'Contact dirt in seams')
    ao.inputs['Distance'].default_value = .18; ao.samples = 24
    cavity = ramp(ao.outputs['AO'], [(0, (.045, .038, .03)), (.3, (.18, .16, .135)), (.7, (.63, .62, .57)), (1, (1, 1, 1))], 'Oiled cavities and clean raised faces')
    forms = mix(forms, cavity, .88, 'MULTIPLY', 'Contact depth')
    strength = node('ShaderNodeMixRGB', 'Form shadow strength')
    links.new(textured, strength.inputs[1]); links.new(forms, strength.inputs[2])
    c.form_strengths.append(strength.inputs[0])
    links.new(strength.outputs[0], bs.inputs['Base Color'])

    # Fine roughness variation complements the broad values without glossy toy plastic.
    low, high = (.43, .69) if steel else (.65, .88)
    if is_wood: low, high = .51, .76
    if ceramic: low, high = .46, .66
    roughness = ramp(patches, [(0, low), (1, high)], 'Rubbed versus rough finish')
    links.new(roughness, bs.inputs['Roughness'])
    bs.inputs['Metallic'].default_value = min(.68, metal+.16) if steel else metal
    bs.inputs['Specular IOR Level'].default_value = .26 if steel else .18
    bump = node('ShaderNodeBump', 'Tactile grain and machining')
    bump.inputs['Strength'].default_value = .24 if steel else .30
    bump.inputs['Distance'].default_value = .0011 if steel else .0018
    height = mix(pores, grain, .72 if is_wood else .32, label='Material micro relief')
    links.new(height, bump.inputs['Height']); links.new(bump.outputs['Normal'], bs.inputs['Normal'])
    if is_recess:
        # Openings remain dark; tiny light dots would read as extraneous hardware.
        bs.inputs['Metallic'].default_value = 0
        bump.inputs['Strength'].default_value = .05
    m['FD_SurfaceKind'] = kind
    return m


def paint_depth(c, ob):
    if ob.type != 'MESH' or not ob.data.vertices:
        return
    c.scene.view_layers[0].update()
    zs = [(ob.matrix_world @ vertex.co).z for vertex in ob.data.vertices]
    low, extent = min(zs), max(zs)-min(zs)
    c.paint_form_mask(ob, lambda point: .64+.36*(point.z-low)/max(extent, .00001))
