"""Restrained production finish for the fire-control family only.

Keep the approved optical colors and geometry independent of surface wear.
Shared weapon materials supply interrupted scores, edge masks and contact AO.
"""
from weapon_surface_parts import material


def steel(c, name, color, metal, kind='steel'):
    """Separate painted panels, dark structure and small bright steel accents."""
    mat = material(c, name, color, metal, 'coat' if kind == 'coat' else 'steel')
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    painted, bright = kind == 'coat', kind == 'edge'
    nodes['Uneven material finish'].inputs[0].default_value = .52
    nodes['Surface-specific scoring'].inputs[1].default_value = .12 if painted else .05
    nodes['Restrained exposed grain'].inputs[1].default_value = .08
    nodes['Material edge abrasion'].inputs[1].default_value = .78 if painted else .92 if kind == 'steel' else .10
    nodes['Underlying worn material'].inputs[2].default_value = (.42, .48, .49, 1)
    # Broad, broken chips survive reduction; the panel retains its petrol color.
    edge = nodes['Worn exposed panel edges'].color_ramp
    # On narrow structural legs the worn shoulder must survive subpixel reduction.
    # This is a surface mask on the unchanged mesh, not a widened silhouette.
    positions = (0, .10, .32, 1) if kind == 'steel' else (0, .035, .105, 1)
    for element, position in zip(edge.elements, positions):
        element.position = position
    nodes['Broken edge wear'].inputs['Scale'].default_value = 19
    chips = nodes['Interrupted chips'].color_ramp
    chip_values = (.3, .72, 1) if kind == 'steel' else (0, .18, 1)
    for element, value in zip(chips.elements, chip_values):
        element.color = (value, value, value, 1)
    cavity = nodes['Oiled cavities and clean raised faces'].color_ramp
    for element, value in zip(cavity.elements, (.025, .12, .58, 1)):
        element.color = (value, value, value, 1)
    roughness = nodes['Rubbed versus rough finish'].color_ramp
    low, high = (.58, .78) if bright else (.78, .96)
    roughness.elements[0].color = (low, low, low, 1)
    roughness.elements[-1].color = (high, high, high, 1)
    bs = nodes['Principled BSDF']
    bs.inputs['Specular IOR Level'].default_value = .20 if bright else .10
    bs.inputs['Metallic'].default_value = .42 if bright else .05 if painted else .28
    if bright:
        # Readable machined bevels retain a restrained matte value through flanks.
        nodes['Sculpted metal values'].inputs[0].default_value = .28
        nodes['Contact depth'].inputs[0].default_value = .5
    else:
        nodes['Sculpted metal values'].inputs[0].default_value = .55
        nodes['Contact depth'].inputs[0].default_value = .75
    # Persisted rest-pose mask travels with folded legs and held-item scaling.
    # Dust is cool neutral grey: no warm soil, brass or extra emission.
    mask = nodes.new('ShaderNodeVertexColor'); mask.layer_name = 'FD_ContactDust'
    mask.name = 'Authored ground-contact gradient'
    weight = nodes.new('ShaderNodeMath'); weight.operation = 'MULTIPLY'
    weight.name = 'Restrained contact dust coverage'
    links.new(mask.outputs['Color'], weight.inputs[0]); weight.inputs[1].default_value = .32
    dust = nodes.new('ShaderNodeMixRGB'); dust.name = 'Cool dust at ground contacts'
    links.new(weight.outputs[0], dust.inputs[0])
    links.new(bs.inputs['Base Color'].links[0].from_socket, dust.inputs[1])
    dust.inputs[2].default_value = (.065, .078, .081, 1)
    links.new(dust.outputs[0], bs.inputs['Base Color'])
    mat['FD_FinishRevision'] = 'fc-hq-4'
    mat['FD_ValueGroup'] = kind
    return mat


def contact_dust(c, ob, sampler):
    """Authored broad contact wear, evaluated once before parenting/animation."""
    c.scene.view_layers[0].update()
    attr = ob.data.color_attributes.new(name='FD_ContactDust', type='FLOAT_COLOR', domain='POINT')
    for vertex, color in zip(ob.data.vertices, attr.data):
        value = max(0, min(1, sampler(ob.matrix_world @ vertex.co)))
        color.color = (value, value, value, 1)


def fastener(c, p, x, y, z, radius=.035):
    """Flush, slotted screw. Keep hardware within the approved panel silhouette."""
    c.cylinder('Recessed fastener seat', (x, y, z), radius*1.22, .009, p['dark'], 16)
    c.cylinder('Worn steel screw head', (x, y, z+.005), radius, .008, p['edge'], 12)
    c.box('Screwdriver slot', (x, y, z+.010), (radius*1.25, radius*.23, .003), p['dark'], .001)


def scuff(c, p, x, y, z, length, angle=0):
    """A sparse tapered abrasion, authored on a raised face, never on optics.

    Its physical width remains below a nominal game pixel. The longer broken
    edge is readable at 4x without turning the surface into uniform noise.
    """
    import math
    from enemy_parts_b import plate
    outline = [(-length*.5, -.003), (-length*.28, -.008),
               (length*.13, -.004), (length*.5, .002),
               (length*.20, .006), (-length*.20, .003)]
    cs, sn = math.cos(angle), math.sin(angle)
    outline = [(px*cs-py*sn, px*sn+py*cs) for px, py in outline]
    plate(c, 'Interrupted handling abrasion', (x, y, z), outline, .0015, p['wear'], 0)
