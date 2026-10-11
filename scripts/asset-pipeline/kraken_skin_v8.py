"""Kraken V8 surfaces: one authored value plan instead of stacked noise.

Values are decided by persisted masks, not by texture noise:
- FD_Rest (point vector): build-time position, so texture never swims under the rig.
- FD_Pattern (point colour): R = flank brightness (0 dark dorsal saddle, 1 lit flank/rim),
  G = translucent membrane rim, B = iridescent sheen exposure.
The dermis texture only contributes mid-frequency folds; pores stay a faint relief.
"""
from array import array
import bpy


def linear(hex_color):
    """sRGB hex to linear RGB, so the palette can be read as authored."""
    value = hex_color.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(value[i:i+2], 16) / 255
        out.append(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4)
    return tuple(out)


# Menacing violet (C4 colouring on the C1 build): deep indigo saddle, violet flanks,
# pale cold lavender membrane rims, crimson ventral cups, glowing ember eyes.
PALETTE = {
    'saddle': linear('#170e1d'),
    'dorsal': linear('#2b1a33'),
    'flank': linear('#4e3259'),
    'rim': linear('#a77f93'),
    'sheen': linear('#56607e'),
    'cup': linear('#b8687a'),
    'cup_rim': linear('#dda0ad'),
    'well': linear('#2a0c14'),
    'bone': linear('#c9b3a3'),
    'socket': linear('#0b0509'),
    'oral': linear('#6a2236'),
}


def write_rest(ob):
    """Persist rest positions; armature deformation leaves this attribute untouched."""
    mesh = ob.data
    if 'FD_Rest' in mesh.attributes:
        mesh.attributes.remove(mesh.attributes['FD_Rest'])
    attr = mesh.attributes.new('FD_Rest', 'FLOAT_VECTOR', 'POINT')
    matrix = ob.matrix_world
    positions = array('f')
    for vertex in mesh.vertices:
        positions.extend(matrix @ vertex.co)
    attr.data.foreach_set('vector', positions)


def paint_pattern(ob, sampler):
    """sampler(world_position, vertex_normal) -> (flank, rim, sheen) in 0..1."""
    mesh = ob.data
    if 'FD_Pattern' in mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes['FD_Pattern'])
    attr = mesh.color_attributes.new(name='FD_Pattern', type='FLOAT_COLOR', domain='POINT')
    matrix = ob.matrix_world
    rotation = matrix.to_3x3()
    # Attribute writes invalidate Blender's mesh caches. Read normals before
    # writing colours so a dense fused skin does not recalculate them per vertex.
    positions = [matrix @ vertex.co for vertex in mesh.vertices]
    normals = [(rotation @ vertex.normal).normalized() for vertex in mesh.vertices]
    colours = array('f')
    for position, normal in zip(positions, normals):
        r, g, b = sampler(position, normal)
        colours.extend((max(0, min(1, r)), max(0, min(1, g)), max(0, min(1, b)), 1))
    attr.data.foreach_set('color', colours)


def skin(c, name, dark, light, rim=None, softness=1, roughness=(.40, .58), texture=True):
    """Organic skin: value plan from FD_Pattern, folds from the dermis, restrained wet sheen."""
    material = c.material(name, light)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bs = nodes.get('Principled BSDF')

    def node(kind, label):
        out = nodes.new(kind)
        out.name = out.label = label
        return out

    def mix(a, b, factor, mode='MIX', label='Skin layer'):
        out = node('ShaderNodeMix', label)
        out.data_type = 'RGBA'
        out.blend_type = mode
        for socket, value in ((out.inputs[0], factor), (out.inputs[6], a), (out.inputs[7], b)):
            if isinstance(value, (int, float)):
                socket.default_value = value
            elif isinstance(value, tuple):
                socket.default_value = (*value, 1) if len(value) == 3 else value
            else:
                links.new(value, socket)
        return out.outputs[2]

    rest = node('ShaderNodeAttribute', 'Rest-pose skin coordinates')
    rest.attribute_type = 'GEOMETRY'
    rest.attribute_name = 'FD_Rest'
    pattern = node('ShaderNodeVertexColor', 'Authored value plan')
    pattern.layer_name = 'FD_Pattern'
    split = node('ShaderNodeSeparateColor', 'Plan channels')
    links.new(pattern.outputs['Color'], split.inputs[0])

    # 1. Broad value plan: saddle -> flank, then cold membrane rims.
    plan = node('ShaderNodeMapRange', 'Saddle to flank easing')
    plan.interpolation_type = 'SMOOTHSTEP'
    links.new(split.outputs[0], plan.inputs['Value'])
    base = mix(dark, light, plan.outputs[0], label='Dorsal saddle to lit flank')
    if rim:
        base = mix(base, rim, split.outputs[1], label='Pale translucent rim')

    # 2. Iridescent cold sheen only where the surface turns away from the camera.
    weight = node('ShaderNodeLayerWeight', 'Grazing sheen')
    weight.inputs['Blend'].default_value = .5
    sheen_mask = node('ShaderNodeMath', 'Sheen exposure')
    sheen_mask.operation = 'MULTIPLY'
    links.new(weight.outputs['Facing'], sheen_mask.inputs[0])
    links.new(split.outputs[2], sheen_mask.inputs[1])
    base = mix(base, PALETTE['sheen'], sheen_mask.outputs[0], 'SCREEN', 'Iridescent violet-teal sheen')

    # 3. Mid-frequency folds from the authored dermis; strength is the variant control.
    source = base
    if texture and 'organic' in c.images:
        scale = node('ShaderNodeVectorMath', 'Dermis density on rest pose')
        scale.operation = 'SCALE'
        scale.inputs['Scale'].default_value = .45
        links.new(rest.outputs['Vector'], scale.inputs[0])
        dermis = node('ShaderNodeTexImage', 'Authored dermis folds')
        dermis.image = c.images['organic']
        dermis.extension = 'REPEAT'
        dermis.projection = 'BOX'
        dermis.projection_blend = .35
        links.new(scale.outputs[0], dermis.inputs['Vector'])
        grey = node('ShaderNodeRGBToBW', 'Dermis value')
        links.new(dermis.outputs['Color'], grey.inputs[0])
        level = node('ShaderNodeMapRange', 'Normalised fold value')
        level.inputs['From Min'].default_value = .02
        level.inputs['From Max'].default_value = .30
        level.inputs['To Min'].default_value = .72
        level.inputs['To Max'].default_value = 1.18
        links.new(grey.outputs[0], level.inputs['Value'])
        # Scales belong to the dark dorsal skin; the pale belly and webs stay smooth.
        smooth_belly = node('ShaderNodeMapRange', 'Scales fade on the belly')
        smooth_belly.inputs['To Min'].default_value = 1
        smooth_belly.inputs['To Max'].default_value = .25
        links.new(split.outputs[1], smooth_belly.inputs['Value'])
        calm = node('ShaderNodeMix', 'Belly-calmed scale value')
        calm.data_type = 'FLOAT'
        calm.inputs[2].default_value = 1  # A: flat skin
        links.new(level.outputs[0], calm.inputs[3])  # B: full scale relief
        links.new(smooth_belly.outputs[0], calm.inputs[0])
        folded = node('ShaderNodeMix', 'Dermis fold strength')
        folded.data_type = 'RGBA'
        folded.blend_type = 'MULTIPLY'
        links.new(base, folded.inputs[6])
        links.new(calm.outputs[0], folded.inputs[7])
        c.strengths.append(folded.inputs[0])
        source = folded.outputs[2]
        relief = node('ShaderNodeMapRange', 'Fold height')
        relief.inputs['From Min'].default_value = .02
        relief.inputs['From Max'].default_value = .30
        links.new(grey.outputs[0], relief.inputs['Value'])
        bump = node('ShaderNodeBump', 'Fleshy fold relief')
        bump.inputs['Strength'].default_value = .38 * softness
        bump.inputs['Distance'].default_value = .04
        links.new(relief.outputs[0], bump.inputs['Height'])
        pores = node('ShaderNodeTexVoronoi', 'Faint pores')
        pores.inputs['Scale'].default_value = 34
        links.new(rest.outputs['Vector'], pores.inputs['Vector'])
        fine = node('ShaderNodeBump', 'Faint pore relief')
        fine.inputs['Strength'].default_value = .07 * softness
        fine.inputs['Distance'].default_value = .006
        links.new(pores.outputs['Distance'], fine.inputs['Height'])
        links.new(bump.outputs[0], fine.inputs['Normal'])
        links.new(fine.outputs[0], bs.inputs['Normal'])

    # 4. Broad form shadow (variant formShadowStrength) and contact occlusion.
    geometry = node('ShaderNodeNewGeometry', 'Sculpted surface')
    facing = node('ShaderNodeVectorMath', 'Key-side muscle volume')
    facing.operation = 'DOT_PRODUCT'
    links.new(geometry.outputs['Normal'], facing.inputs[0])
    facing.inputs[1].default_value = (-.42, .46, .78)
    form = node('ShaderNodeMapRange', 'Broad form value')
    form.inputs['From Min'].default_value = -.15
    form.inputs['From Max'].default_value = 1
    form.inputs['To Min'].default_value = .40
    form.inputs['To Max'].default_value = 1.22
    links.new(facing.outputs['Value'], form.inputs['Value'])
    mask = node('ShaderNodeVertexColor', 'Authored form depth')
    mask.layer_name = 'FD_FormMask'
    depth = node('ShaderNodeMapRange', 'Form depth value')
    depth.inputs['To Min'].default_value = .55
    links.new(mask.outputs['Color'], depth.inputs['Value'])
    lit = node('ShaderNodeMath', 'Form value')
    lit.operation = 'MULTIPLY'
    links.new(form.outputs[0], lit.inputs[0])
    links.new(depth.outputs[0], lit.inputs[1])
    ao = node('ShaderNodeAmbientOcclusion', 'Contact depth')
    ao.inputs['Distance'].default_value = .20
    ao.samples = 12
    cavity = node('ShaderNodeMapRange', 'Cavity value')
    cavity.inputs['To Min'].default_value = .30
    links.new(ao.outputs['AO'], cavity.inputs['Value'])
    shade = node('ShaderNodeMath', 'Form and cavity')
    shade.operation = 'MULTIPLY'
    links.new(lit.outputs[0], shade.inputs[0])
    links.new(cavity.outputs[0], shade.inputs[1])
    shaded = mix(source, shade.outputs[0], 1, 'MULTIPLY', 'Form-shaded skin')
    strength = node('ShaderNodeMix', 'Form shadow strength')
    strength.data_type = 'RGBA'
    links.new(source, strength.inputs[6])
    links.new(shaded, strength.inputs[7])
    c.form_strengths.append(strength.inputs[0])
    links.new(strength.outputs[2], bs.inputs['Base Color'])

    # 5. Moist but matte: broken roughness, low specular, no clear coat.
    rough = node('ShaderNodeMapRange', 'Broken moist roughness')
    rough.inputs['To Min'].default_value = roughness[0]
    rough.inputs['To Max'].default_value = roughness[1]
    links.new(split.outputs[0], rough.inputs['Value'])
    links.new(rough.outputs[0], bs.inputs['Roughness'])
    bs.inputs['Specular IOR Level'].default_value = .34
    material['FD_SurfaceKind'] = 'kraken-dermis-v8'
    return _finish_skin(material, 'F', softness, roughness)


def cup_material(c, name):
    """Crimson ventral cups with a lighter lip; readable when an arm tip rolls over."""
    material = skin(c, name, PALETTE['cup'], PALETTE['cup_rim'], softness=.45, roughness=(.36, .48))
    material['ventralSuckerSurface'] = True
    nodes = material.node_tree.nodes
    nodes['Principled BSDF'].inputs['Subsurface Scale'].default_value = .055
    nodes['MS pigment tint strength'].inputs[1].default_value = .16
    nodes['MS cell strength'].inputs[1].default_value = .22
    return material


def well_material(c, name):
    material = c.material(name, PALETTE['well'])
    material.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = .6
    material['ventralSuckerSurface'] = True
    return material


# Material study F (art/poc/kraken-v8/material-study): subsurface flesh, broken matte roughness,
# curvature/cavity colour and clustered chromatophores against the plastic look.
def _finish_skin(material, variant='F', softness=1, roughness=(.40, .58)):
    if variant == 'A':
        return material
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bs = nodes.get('Principled BSDF')
    def node(kind, label):
        n = nodes.new(kind)
        n.name = n.label = label
        return n
    def put(s, value):
        if isinstance(value, (tuple, list, float, int)):
            s.default_value = value
        else:
            links.new(value, s)
    def math(op, a, b, label):
        n = node('ShaderNodeMath', label)
        n.operation = op
        put(n.inputs[0], a); put(n.inputs[1], b)
        return n.outputs[0]
    def remap(value, lo, hi, a, b, label):
        n = node('ShaderNodeMapRange', label)
        n.clamp = True
        n.interpolation_type = 'SMOOTHSTEP'
        for k,v in [('Value', value), ('From Min',lo),('From Max',hi),('To Min',a),('To Max',b)]:
            put(n.inputs[k],v)
        return n.outputs[0]
    def mix(a,b,f,mode,label):
        n = node('ShaderNodeMixRGB',label)
        n.blend_type = mode
        put(n.inputs[0],f); put(n.inputs[1],a); put(n.inputs[2],b)
        return n.outputs[0]
    def noise(vector,scale,detail,label):
        n = node('ShaderNodeTexNoise',label)
        links.new(vector,n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = .62
        return n

    best = variant == 'F'
    cup = bool(material.get('ventralSuckerSurface'))
    rest = nodes['Rest-pose skin coordinates'].outputs['Vector']
    bs.subsurface_method = 'RANDOM_WALK'
    bs.inputs['Subsurface Weight'].default_value = .16 if best else .22
    bs.inputs['Subsurface Radius'].default_value = (1.0,.32,.70)
    bs.inputs['Subsurface Scale'].default_value = (.055 if cup else .075) if best else .10
    if bs.inputs.get('Subsurface IOR'):
        bs.inputs['Subsurface IOR'].default_value = 1.35
    if variant == 'B': return material

    broad = noise(rest,2.1,2,'MS broad moisture islands')
    fine = noise(rest,11,2,'MS moisture breakup')
    field = math('ADD',math('MULTIPLY',broad.outputs['Fac'],.78,'MS broad weight'),
                 math('MULTIPLY',fine.outputs['Fac'],.22,'MS breakup weight'),'MS moisture field')
    # Retain the roughness argument as a material-specific offset from the skin default.
    delta = (sum(roughness)-.98)*.5
    dry = remap(field,.25,.75,.60+delta,.86+delta,'MS broad matte roughness')
    wet = remap(broad.outputs['Fac'],.66,.80,0,1,'MS sparse moist patches')
    rough = mix(dry,(.43+delta,)*3+(1,),wet,'MIX','MS localized moisture')
    links.new(rough,bs.inputs['Roughness'])
    bs.inputs['Specular IOR Level'].default_value = .17 if best else .19
    bs.inputs['Coat Weight'].default_value = 0
    if variant == 'C': return material

    source = bs.inputs['Base Color'].links[0].from_socket
    geom = nodes['Sculpted surface']
    convex = remap(geom.outputs['Pointiness'],.502,.54,0,1,'MS convex normalization')
    concave = remap(geom.outputs['Pointiness'],.498,.46,0,1,'MS concave normalization')
    # Local contact AO supplements pointiness on smoothly tessellated surfaces.
    ao = node('ShaderNodeAmbientOcclusion','MS local cavity')
    ao.samples = 12
    ao.inputs['Distance'].default_value = .085
    cavity = remap(ao.outputs['AO'],.95,.20,0,1,'MS cavity normalization')
    darkmask = math('MAXIMUM',concave,cavity,'MS cavity or concavity')
    source = mix(source,(.72,.77,.96,1),math('MULTIPLY',darkmask,.40 if best else .48,'MS cool cavity strength'),'MULTIPLY','MS cool recessed flesh')
    source = mix(source,(1.28,1.13,1.09,1),math('MULTIPLY',convex,.45,'MS warm edge strength'),'MULTIPLY','MS warm convex flesh')
    links.new(source,bs.inputs['Base Color'])
    if variant == 'D': return material

    # Distorted multi-scale fields: tissue-sized patches, not uniform pixel noise.
    warp = noise(rest,1.5,2,'MS tissue distortion')
    v = node('ShaderNodeVectorMath','MS centered distortion'); v.operation='SUBTRACT'
    links.new(warp.outputs['Color'],v.inputs[0]); v.inputs[1].default_value=(.5,.5,.5)
    w = node('ShaderNodeVectorMath','MS warp amplitude'); w.operation='SCALE'
    links.new(v.outputs[0],w.inputs[0]); w.inputs['Scale'].default_value=.38
    coords = node('ShaderNodeVectorMath','MS warped rest coordinates'); coords.operation='ADD'
    links.new(rest,coords.inputs[0]); links.new(w.outputs[0],coords.inputs[1])
    macro = noise(coords.outputs[0],1.7,2.5,'MS broad chromatophore colonies')
    marble = noise(coords.outputs[0],5.6,2,'MS dermal marbling')
    tone = remap(macro.outputs['Fac'],.25,.75,0,1,'MS pigment hue distribution')
    # Multiplicative tints preserve the existing saddle/flank/rim hierarchy.
    tint = mix((.68,.80,1.20,1),(1.28,.74,.99,1),tone,'MIX','MS blue violet plum tint')
    rim = nodes['Plan channels'].outputs[1]
    protection = remap(rim,0,1,1,.22,'MS protect lavender membrane')
    color_strength = math('MULTIPLY',protection,.72 if best else .80,'MS pigment tint strength')
    source = mix(source,tint,color_strength,'MULTIPLY','MS chromatophore hue')
    mottle = remap(marble.outputs['Fac'],.29,.71,.56 if best else .60,1.19,'MS marble value')
    source = mix(source,mottle,math('MULTIPLY',protection,.70,'MS marble strength'),'MULTIPLY','MS mottled tissue')
    cells = node('ShaderNodeTexVoronoi','MS pigment cells')
    links.new(coords.outputs[0],cells.inputs['Vector'])
    cells.inputs['Scale'].default_value = 19
    dots = remap(cells.outputs['Distance'],.12,.30,1,0,'MS soft edged pigment cells')
    colonies = remap(macro.outputs['Fac'],.38,.65,.12,1,'MS clustered cell density')
    dots = math('MULTIPLY',dots,colonies,'MS colony cells')
    dots = math('MULTIPLY',dots,protection,'MS rim cell protection')
    source = mix(source,(.29,.24,.39,1),math('MULTIPLY',dots,.58 if best else .60,'MS cell strength'),'MULTIPLY','MS deep pigment cells')
    links.new(source,bs.inputs['Base Color'])
    if best:
        # Remove the airbrushed SCREEN veil and sandy pore normals without
        # changing either public fold/form control or the authored value plan.
        sheen = nodes['Iridescent violet-teal sheen']
        old = sheen.inputs[0].links[0].from_socket
        links.new(math('MULTIPLY',old,.22,'MS restrained grazing color'),sheen.inputs[0])
        if nodes.get('Fleshy fold relief'):
            nodes['Fleshy fold relief'].inputs['Strength'].default_value=.24*softness
            nodes['Fleshy fold relief'].inputs['Distance'].default_value=.025
            nodes['Faint pore relief'].inputs['Strength'].default_value=.025*softness
            nodes['Faint pore relief'].inputs['Distance'].default_value=.004
        if cup:
            # Keep sucker lips crimson, with quieter pigment than the mantle.
            nodes['MS pigment tint strength'].inputs[1].default_value=.16
            nodes['MS cell strength'].inputs[1].default_value=.22
    return material
