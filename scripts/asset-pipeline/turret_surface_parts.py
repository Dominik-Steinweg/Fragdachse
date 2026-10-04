"""Outdoor turret finishes, evaluated in part space so wear follows firing motion.

Only shader detail: no displacement, geometry, light, socket or animation changes.
Keep the authored color groups; material-scale wear must survive the 40px view.
"""


def finish(material, kind='paint'):
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bs = nodes['Principled BSDF']
    color = tuple(material.diffuse_color)
    original = bs.inputs['Base Color'].links[0].from_socket if bs.inputs['Base Color'].is_linked else color

    def node(type_name, name):
        item = nodes.new(type_name)
        item.name = item.label = name
        return item

    def connect(value, socket):
        if isinstance(value, (int, float, tuple, list)):
            socket.default_value = value
        else:
            links.new(value, socket)

    def math(operation, a, b):
        out = node('ShaderNodeMath', operation)
        out.operation = operation
        connect(a, out.inputs[0]); connect(b, out.inputs[1])
        return out.outputs[0]

    def ramp(value, stops, name):
        out = node('ShaderNodeValToRGB', name)
        out.color_ramp.interpolation = 'EASE'
        for i, (position, tone) in enumerate(stops):
            e = out.color_ramp.elements[i] if i < 2 else out.color_ramp.elements.new(position)
            e.position = position
            e.color = (tone, tone, tone, 1) if isinstance(tone, (int, float)) else (*tone, 1)
        connect(value, out.inputs[0])
        return out.outputs[0]

    def mix(a, b, strength, name, mode='MIX'):
        out = node('ShaderNodeMixRGB', name)
        out.blend_type = mode
        connect(strength, out.inputs[0]); connect(a, out.inputs[1]); connect(b, out.inputs[2])
        return out.outputs[0]

    coordinates = node('ShaderNodeTexCoord', 'Wear follows each mechanical part')
    def noise(scale, stretch, name):
        vector = node('ShaderNodeVectorMath', name + ' direction')
        vector.operation = 'MULTIPLY'; vector.inputs[1].default_value = stretch
        links.new(coordinates.outputs['Generated'], vector.inputs[0])
        out = node('ShaderNodeTexNoise', name)
        out.inputs['Scale'].default_value = scale
        out.inputs['Detail'].default_value = 3
        out.inputs['Roughness'].default_value = .7
        links.new(vector.outputs[0], out.inputs['Vector'])
        return out.outputs['Fac']

    organic = kind in ('cuticle', 'veil', 'fibre')
    recess = kind == 'recess'
    ceramic = kind in ('ceramic', 'frost')
    patches = noise(4.5, (1, 1, 1), 'Broad outdoor weathering')
    grain = noise(22, (.12, 1, 1), 'Readable brushed striations')
    values = ramp(patches, [(.24, .35), (.42, .63), (.59, 1.12), (.76, 1.48)], 'Uneven aged finish')
    surface = mix(original, values, .78 if organic else .60 if ceramic else .90,
                  'Material variation at game scale', 'MULTIPLY')
    if organic:
        freckles = noise(13, (1, 1, 1), 'Dry cuticle granulation')
        dry = ramp(freckles, [(.25, .45), (.45, .78), (.60, 1.06), (.78, 1.28)], 'Fine fungal fibres')
        surface = mix(surface, dry, .60 if kind == 'cuticle' else .40, 'Dry organic skin', 'MULTIPLY')
    if not organic and not recess and not ceramic:
        fine = ramp(grain, [(.24, .42), (.48, .85), (.68, 1.28), (.81, 1.45)], 'Machining texture')
        surface = mix(surface, fine, .48, 'Rubbed casting and brushing', 'MULTIPLY')
        xyz = node('ShaderNodeSeparateXYZ', 'Local panel boundaries')
        links.new(coordinates.outputs['Generated'], xyz.inputs[0])
        dx = math('MINIMUM', xyz.outputs['X'], math('SUBTRACT', 1, xyz.outputs['X']))
        dy = math('MINIMUM', xyz.outputs['Y'], math('SUBTRACT', 1, xyz.outputs['Y']))
        edges = ramp(math('MINIMUM', dx, dy), [(0, 1), (.055, .9), (.19, .12), (.5, 0)], 'Handled edge zone')
        chips = ramp(noise(10, (1, 1, 1), 'Broken paint islands'), [(.39, 0), (.48, .12), (.56, 1)], 'Broad abrasion')
        abrasion = math('MULTIPLY', math('MAXIMUM', edges, .32), chips)
        exposed = (.32, .30, .235) if kind not in ('copper', 'base') else (.34, .19, .07) if kind == 'copper' else (.15, .145, .085)
        surface = mix(surface, (*exposed, 1), math('MULTIPLY', abrasion, .85), 'Exposed warm metal beneath enamel')
        oxidation = ramp(patches, [(.25, .9), (.39, .55), (.49, 0), (1, 0)], 'Oxidation islands')
        oxidation = math('MULTIPLY', oxidation, .80 if kind == 'base' else .45)
        patina = (.042, .15, .10) if kind == 'copper' else (.13, .060, .020)
        surface = mix(surface, (*patina, 1), oxidation, 'Copper patina or iron oxide')
        if kind == 'base':
            # Only the structural foot: broad soil stains and moss in protected seams.
            moss = ramp(noise(6, (1, 1, .4), 'Moss colonies on foot'), [(.40, 0), (.52, .25), (.65, .85)], 'Broken moss coverage')
            surface = mix(surface, (.10, .14, .036, 1), moss, 'Earth and moss contact')

    # Short-range material AO grounds intersecting assemblies, without a baked ground plane.
    ao = node('ShaderNodeAmbientOcclusion', 'Dirt in mechanical contact seams')
    ao.inputs['Distance'].default_value = .15 if organic else .22
    ao.samples = 16
    occlusion = ramp(ao.outputs['AO'], [(0, (.09, .075, .045)), (.5, (.37, .33, .25)), (1, (1, 1, 1))], 'Warm contact dirt')
    surface = mix(surface, occlusion, .55 if organic else .88, 'Deep assembly seams', 'MULTIPLY')
    links.new(surface, bs.inputs['Base Color'])
    roughness = ramp(patches, [(0, .78), (1, .98)], 'Dry versus handled roughness')
    links.new(roughness, bs.inputs['Roughness'])
    bs.inputs['Metallic'].default_value = .10 if kind in ('steel', 'copper') else 0
    bs.inputs['Specular IOR Level'].default_value = .045 if kind in ('steel', 'copper') else .025
    bump = node('ShaderNodeBump', 'Microscopic surface relief')
    bump.inputs['Strength'].default_value = .25 if organic or ceramic else .32
    bump.inputs['Distance'].default_value = .007 if organic else .008
    links.new(patches if organic or ceramic else grain, bump.inputs['Height'])
    if bs.inputs['Normal'].is_linked:
        links.new(bs.inputs['Normal'].links[0].from_socket, bump.inputs['Normal'])
    links.new(bump.outputs['Normal'], bs.inputs['Normal'])
    material['FD_SurfaceKind'] = kind
    return material


def material(c, name, color, kind='paint'):
    return finish(c.material(name, color, 'technical'), kind)
