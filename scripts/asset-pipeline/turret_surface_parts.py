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
    patches = noise(7, (1, 1, 1), 'Weathering at readable scale')
    grain = noise(95, (.16, 1, 1), 'Brushed grain')
    pores = noise(145, (1, 1, 1), 'Fine dry surface pores')
    values = ramp(patches, [(.22, .53), (.43, .80), (.59, 1.06), (.78, 1.32)], 'Uneven aged finish')
    surface = mix(original, values, .55 if organic else .37 if ceramic else .72,
                  'Restrained albedo variation', 'MULTIPLY')
    if organic:
        freckles = noise(34, (1, 1, 1), 'Dry cuticle granulation')
        dry = ramp(freckles, [(.25, .45), (.45, .78), (.60, 1.06), (.78, 1.28)], 'Fine fungal fibres')
        surface = mix(surface, dry, .38 if kind == 'cuticle' else .26, 'Dry organic skin', 'MULTIPLY')
    if not organic and not recess and not ceramic:
        fine = ramp(grain, [(.24, .62), (.48, .91), (.68, 1.16), (.81, 1.30)], 'Machining texture')
        surface = mix(surface, fine, .28, 'Fine rubbed grain', 'MULTIPLY')
        xyz = node('ShaderNodeSeparateXYZ', 'Local panel boundaries')
        links.new(coordinates.outputs['Generated'], xyz.inputs[0])
        dx = math('MINIMUM', xyz.outputs['X'], math('SUBTRACT', 1, xyz.outputs['X']))
        dy = math('MINIMUM', xyz.outputs['Y'], math('SUBTRACT', 1, xyz.outputs['Y']))
        edges = ramp(math('MINIMUM', dx, dy), [(0, 1), (.025, .8), (.10, 0), (1, 0)], 'Handled edge zone')
        chips = ramp(noise(42, (1, 1, 1), 'Interrupted edge nicks'), [(.4, 0), (.60, .22), (.75, 1)], 'Sparse abrasion')
        abrasion = math('MULTIPLY', math('MULTIPLY', edges, chips), .46)
        exposed = (.22, .235, .215) if kind != 'copper' else (.42, .24, .10)
        surface = mix(surface, (*exposed, 1), abrasion, 'Broken exposed material')
        oxidation = ramp(patches, [(.26, .6), (.36, .28), (.46, 0), (1, 0)], 'Sparse oxidation islands')
        oxidation = math('MULTIPLY', oxidation, .45 if kind == 'base' else .30)
        patina = (.064, .135, .105) if kind == 'copper' else (.18, .073, .028)
        surface = mix(surface, (*patina, 1), oxidation, 'Copper patina or iron oxide')

    # Short-range material AO grounds intersecting assemblies, without a baked ground plane.
    ao = node('ShaderNodeAmbientOcclusion', 'Dirt in mechanical contact seams')
    ao.inputs['Distance'].default_value = .10 if organic else .15
    ao.samples = 16
    occlusion = ramp(ao.outputs['AO'], [(0, (.23, .20, .16)), (.5, (.60, .58, .52)), (1, (1, 1, 1))], 'Warm contact dirt')
    surface = mix(surface, occlusion, .22 if organic else .52, 'Soft contact depth', 'MULTIPLY')
    links.new(surface, bs.inputs['Base Color'])
    roughness = ramp(patches, [(0, .78), (1, .98)], 'Dry versus handled roughness')
    links.new(roughness, bs.inputs['Roughness'])
    bs.inputs['Metallic'].default_value = .18 if kind in ('steel', 'copper') else 0
    bs.inputs['Specular IOR Level'].default_value = .10 if kind in ('steel', 'copper') else .055
    bump = node('ShaderNodeBump', 'Microscopic surface relief')
    bump.inputs['Strength'].default_value = .18 if organic or ceramic else .24
    bump.inputs['Distance'].default_value = .002 if organic else .003
    links.new(pores, bump.inputs['Height'])
    if bs.inputs['Normal'].is_linked:
        links.new(bs.inputs['Normal'].links[0].from_socket, bump.inputs['Normal'])
    links.new(bump.outputs['Normal'], bs.inputs['Normal'])
    material['FD_SurfaceKind'] = kind
    return material


def material(c, name, color, kind='paint'):
    return finish(c.material(name, color, 'technical'), kind)
