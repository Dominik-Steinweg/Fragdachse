"""Giant puffball (Riesenbovist) cluster seen straight from above.

One large puffball with an areolate, cracked skin and two small companions on a
thin moss collar. The upper dome of the large puffball is split along irregular
tear lines into hinged lobes: the `burst` clip folds them outward while the body
sags and the olive spore mass (gleba) shows; `refill` closes them again.
`meadow` is cream with warm brown cracks; `void` is pale lilac with faintly
glowing violet cracks and a dark violet gleba.
"""
import math
import random
import bpy
from dawn_parts import linear
from rigs_v2 import attach, control, model

PALETTES = {
    'meadow': dict(skin=(236, 229, 210), crack=(178, 150, 110), inner=(198, 178, 138), gleba=(96, 82, 44),
                   speck=(140, 122, 70), moss=(70, 92, 44), litter=(104, 82, 52), crack_emission=0, speck_emission=0),
    'void': dict(skin=(206, 197, 218), crack=(138, 76, 206), inner=(132, 112, 150), gleba=(44, 28, 58),
                 speck=(170, 96, 255), moss=(46, 40, 60), litter=(58, 48, 70), crack_emission=1.1, speck_emission=1.6),
}

# Large puffball: centre, horizontal radius, vertical radius, centre height.
CX, CY, RXY, RZ, ZC = -.03, .025, .335, .27, .24
OPEN_THETA = math.radians(58)
LOBES = 7


def mesh(c, name, vertices, faces, material):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    ob = bpy.data.objects.new(name, data)
    c.scene.collection.objects.link(ob)
    data.materials.append(material)
    for face in data.polygons:
        face.use_smooth = True
    return ob


def skin_material(c, name, base, crack, emission=0.0, cells=7.0):
    """Areolate cream skin: Voronoi plates with recessed brown cracks, grouped value variation."""
    m = c.material(name, linear(base))
    n, l = m.node_tree.nodes, m.node_tree.links
    bs = n['Principled BSDF']
    bs.inputs['Roughness'].default_value = .95
    coords = n.new('ShaderNodeTexCoord')
    plates = n.new('ShaderNodeTexVoronoi'); plates.feature = 'DISTANCE_TO_EDGE'
    plates.inputs['Scale'].default_value = cells
    plates.inputs['Randomness'].default_value = .85
    l.new(coords.outputs['Object'], plates.inputs['Vector'])
    edge = n.new('ShaderNodeValToRGB'); edge.color_ramp.interpolation = 'EASE'
    edge.color_ramp.elements[0].position, edge.color_ramp.elements[0].color = .0, (1, 1, 1, 1)
    edge.color_ramp.elements[1].position, edge.color_ramp.elements[1].color = .045, (0, 0, 0, 1)
    l.new(plates.outputs['Distance'], edge.inputs[0])
    broad = n.new('ShaderNodeTexNoise'); broad.inputs['Scale'].default_value = 3.2; broad.inputs['Detail'].default_value = 2
    l.new(coords.outputs['Object'], broad.inputs['Vector'])
    tones = n.new('ShaderNodeMapRange')
    tones.inputs['To Min'].default_value, tones.inputs['To Max'].default_value = .80, 1.08
    l.new(broad.outputs['Fac'], tones.inputs['Value'])
    shaded = n.new('ShaderNodeMixRGB'); shaded.blend_type = 'MULTIPLY'; shaded.inputs[0].default_value = 1
    shaded.inputs[1].default_value = (*linear(base), 1)
    l.new(tones.outputs['Result'], shaded.inputs[2])
    cracked = n.new('ShaderNodeMixRGB')
    l.new(edge.outputs['Color'], cracked.inputs[0])
    l.new(shaded.outputs[0], cracked.inputs[1])
    cracked.inputs[2].default_value = (*linear(crack), 1)
    l.new(cracked.outputs[0], bs.inputs['Base Color'])
    relief = n.new('ShaderNodeBump'); relief.inputs['Strength'].default_value = .55; relief.inputs['Distance'].default_value = .02
    l.new(plates.outputs['Distance'], relief.inputs['Height'])
    l.new(relief.outputs['Normal'], bs.inputs['Normal'])
    if emission > 0:
        bs.inputs['Emission Color'].default_value = (*linear(crack), 1)
        strength = n.new('ShaderNodeMath'); strength.operation = 'MULTIPLY'; strength.inputs[1].default_value = emission
        grey = n.new('ShaderNodeRGBToBW'); l.new(edge.outputs['Color'], grey.inputs[0])
        l.new(grey.outputs[0], strength.inputs[0])
        l.new(strength.outputs[0], bs.inputs['Emission Strength'])
    return m


def gleba_material(c, name, base, speck, emission=0.0):
    """Powdery spore mass: soft olive-brown with fine darker pores and pale dusty specks."""
    m = c.material(name, linear(base))
    n, l = m.node_tree.nodes, m.node_tree.links
    bs = n['Principled BSDF']
    coords = n.new('ShaderNodeTexCoord')
    pores = n.new('ShaderNodeTexNoise'); pores.inputs['Scale'].default_value = 38; pores.inputs['Detail'].default_value = 4
    l.new(coords.outputs['Object'], pores.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'EASE'
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = .35, (*[v * .55 for v in linear(base)], 1)
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = .72, (*linear(speck), 1)
    l.new(pores.outputs['Fac'], ramp.inputs[0])
    l.new(ramp.outputs['Color'], bs.inputs['Base Color'])
    if emission > 0:
        bs.inputs['Emission Color'].default_value = (*linear(speck), 1)
        glow = n.new('ShaderNodeValToRGB')
        glow.color_ramp.elements[0].position, glow.color_ramp.elements[0].color = .66, (0, 0, 0, 1)
        glow.color_ramp.elements[1].position, glow.color_ramp.elements[1].color = .8, (emission, emission, emission, 1)
        l.new(pores.outputs['Fac'], glow.inputs[0])
        grey = n.new('ShaderNodeRGBToBW'); l.new(glow.outputs['Color'], grey.inputs[0])
        l.new(grey.outputs[0], bs.inputs['Emission Strength'])
    return m


def ellipsoid_point(theta, phi, wobble=0.0):
    r = 1 + wobble
    return (CX + RXY * r * math.sin(theta) * math.cos(phi),
            CY + RXY * r * math.sin(theta) * math.sin(phi),
            ZC + RZ * math.cos(theta))


def surface_wobble(theta, phi):
    return .025 * math.sin(3 * phi + .4) + .016 * math.sin(7 * phi - 1.1) * math.sin(theta * 2)


def tear_offset(boundary, theta):
    """Irregular tear line between two lobes; shared, so closed lobes meet seamlessly."""
    rng = random.Random(500 + boundary)
    a, b, c = rng.uniform(-.09, .09), rng.uniform(-.07, .07), rng.uniform(0, math.tau)
    t = theta / OPEN_THETA
    return t * (a + b * math.sin(9 * t + c))


def lobe(c, index, material, inner):
    width = math.tau / LOBES
    start = -math.pi / 2 + index * width + .21
    rings, columns = 10, 12
    vertices, faces = [], []
    for ring in range(rings + 1):
        theta = OPEN_THETA * ring / rings
        left = start + tear_offset(index, theta)
        right = start + width + tear_offset((index + 1) % LOBES, theta)
        # The rim of the lobe tears unevenly as well.
        for column in range(columns + 1):
            phi = left + (right - left) * column / columns
            th = theta if ring < rings else theta + .045 * math.sin(phi * 11 + index)
            vertices.append(ellipsoid_point(th, phi, surface_wobble(th, phi)))
    for ring in range(rings):
        for column in range(columns):
            a = ring * (columns + 1) + column
            # Outward normals: the skin faces up, the solidified inner side faces the gleba.
            faces.append((a, a + columns + 1, a + columns + 2, a + 1))
    ob = mesh(c, f'Puffball lobe {index}', vertices, faces, material)
    ob.data.materials.append(inner)
    solid = ob.modifiers.new('Skin thickness', 'SOLIDIFY')
    solid.thickness, solid.offset, solid.material_offset = .018, -1, 1
    centre = start + width / 2
    hinge = ellipsoid_point(OPEN_THETA, centre)
    return ob, hinge, centre


def body(c, material):
    rings, columns = 14, 72
    vertices, faces = [], []
    for ring in range(rings + 1):
        theta = OPEN_THETA - .02 + (math.radians(118) - OPEN_THETA) * ring / rings
        for column in range(columns):
            phi = math.tau * column / columns
            vertices.append(ellipsoid_point(theta, phi, surface_wobble(theta, phi)))
    for ring in range(rings):
        for column in range(columns):
            a, b = ring * columns + column, ring * columns + (column + 1) % columns
            faces.append((a, b, b + columns, a + columns))
    return mesh(c, 'Puffball lower body', vertices, faces, material)


def build(c, spec):
    c.scene.cycles.filter_width = 1.0
    variant = spec['model']['variant']
    p = PALETTES[variant]
    skin = skin_material(c, 'Areolate puffball skin', p['skin'], p['crack'], p['crack_emission'])
    small_skin = skin_material(c, 'Young puffball skin', p['skin'], p['crack'], p['crack_emission'] * .6, cells=14)
    inner = c.material('Torn lobe underside', linear(p['inner']))
    gleba = gleba_material(c, 'Powdery spore mass', p['gleba'], p['speck'], p['speck_emission'])
    moss = c.material('Moss collar', linear(p['moss']))
    litter = c.material('Leaf litter flakes', linear(p['litter']))

    rng = random.Random(23)
    collar = []
    for i in range(16):
        a = i * math.tau / 16 + rng.uniform(-.15, .15)
        r = RXY * rng.uniform(.92, 1.06)
        collar.append(c.ell(f'Moss tuft {i}', (CX + r * math.cos(a), CY + r * math.sin(a), .03),
                            (rng.uniform(.045, .065), rng.uniform(.03, .045), .025), moss))
        collar[-1].rotation_euler.z = a
    for i, (x, y, a) in enumerate([(.36, .18, .5), (-.2, .38, 2.2), (-.42, -.02, 3.6)]):
        collar.append(c.ell(f'Litter flake {i}', (x, y, .02), (.07, .035, .01), litter))
        collar[-1].rotation_euler.z = a

    lower = body(c, skin)
    # Wider than the dome opening: after the burst no gap shows between spore mass and skin.
    spore_mass = c.ell('Gleba spore mass', (CX, CY, ZC + .02), (RXY * .88, RXY * .88, RZ * .74), gleba)
    lobes = [lobe(c, i, skin, inner) for i in range(LOBES)]
    small = [c.ell('Small puffball east', (.255, -.235, .1), (.135, .13, .105), small_skin),
             c.ell('Small puffball west', (-.305, -.215, .075), (.095, .09, .08), small_skin)]

    asset = model(c.scene)
    root = asset['root']
    sack = control(c.scene, 'puffball body control', (CX, CY, 0), root)
    attach([lower, spore_mass], sack)
    asset['parts']['body'] = sack
    for index, (ob, hinge, centre) in enumerate(lobes):
        # Local X points outward, local Y along the hinge: opening is a +Y rotation.
        hinge_control = control(c.scene, f'puffball lobe {index} hinge', (hinge[0] - CX, hinge[1] - CY, hinge[2]), sack)
        hinge_control.rotation_euler.z = centre
        attach([ob], hinge_control)
        asset['parts'][f'lobe{index}'] = hinge_control
    companions = control(c.scene, 'small puffballs control', (0, 0, 0), root)
    attach(small, companions)
    asset['parts']['small'] = companions
    asset['parts']['base_meshes'] = collar
    return asset
