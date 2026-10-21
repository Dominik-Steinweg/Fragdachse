"""Straw bee skep on a weathered wooden stand, seen straight from above.

The skep is coiled from thick straw ropes: from above the stacked coils read as
concentric rings, crossed by dark split-cane bindings. A low arched entrance and
a small landing board face south. The square plank stand frames the round skep,
so the prop stays readable against grass and forest floor. `shake` rocks the
skep for the anticipation; `release` jolts it once when the swarm pours out.
"""
import math
import random
import bpy
from dawn_parts import linear
from rigs_v2 import attach, control, model

SKEP_RADIUS = .39
SKEP_HEIGHT = .46
COIL_THICKNESS = .034


def profile(u):
    """Bell-shaped skep wall: steep lower wall rounding into a small crown."""
    return SKEP_RADIUS * math.cos(u * math.pi / 2 * .95), .1 + SKEP_HEIGHT * math.sin(u * math.pi / 2) ** 1.1


def coil_stations():
    """Coils sit at equal arc-length steps, so neighbouring ropes touch everywhere."""
    samples = [profile(i / 400) for i in range(401)]
    lengths = [0.0]
    for (r0, z0), (r1, z1) in zip(samples, samples[1:]):
        lengths.append(lengths[-1] + math.hypot(r1 - r0, z1 - z0))
    step = COIL_THICKNESS * 2.05
    stations, target, i = [], step / 2, 0
    while target < lengths[-1] - step * .8:
        while lengths[i + 1] < target: i += 1
        f = (target - lengths[i]) / (lengths[i + 1] - lengths[i])
        r = samples[i][0] + (samples[i + 1][0] - samples[i][0]) * f
        z = samples[i][1] + (samples[i + 1][1] - samples[i][1]) * f
        stations.append((r, z, target / lengths[-1]))
        target += step
    return stations


def straw_material(c, name, rgb, dark):
    """Golden straw: fibres run along the coil, grouped value variation, darker gaps."""
    m = c.material(name, linear(rgb))
    n, l = m.node_tree.nodes, m.node_tree.links
    bs = n['Principled BSDF']
    bs.inputs['Roughness'].default_value = .9
    coords = n.new('ShaderNodeTexCoord')
    stretch = n.new('ShaderNodeMapping'); stretch.inputs['Scale'].default_value = (1, 1, 26)
    l.new(coords.outputs['UV'], stretch.inputs['Vector'])
    fibres = n.new('ShaderNodeTexNoise'); fibres.inputs['Scale'].default_value = 34; fibres.inputs['Detail'].default_value = 5
    l.new(stretch.outputs['Vector'], fibres.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'EASE'
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = .32, (*linear(dark), 1)
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = .70, (*linear(rgb), 1)
    l.new(fibres.outputs['Fac'], ramp.inputs[0])
    broad = n.new('ShaderNodeTexNoise'); broad.inputs['Scale'].default_value = 3.5
    l.new(coords.outputs['Object'], broad.inputs['Vector'])
    tones = n.new('ShaderNodeMapRange')
    tones.inputs['To Min'].default_value, tones.inputs['To Max'].default_value = .78, 1.12
    l.new(broad.outputs['Fac'], tones.inputs['Value'])
    shaded = n.new('ShaderNodeMixRGB'); shaded.blend_type = 'MULTIPLY'; shaded.inputs[0].default_value = 1
    l.new(ramp.outputs['Color'], shaded.inputs[1]); l.new(tones.outputs['Result'], shaded.inputs[2])
    l.new(shaded.outputs[0], bs.inputs['Base Color'])
    relief = n.new('ShaderNodeBump'); relief.inputs['Strength'].default_value = .45; relief.inputs['Distance'].default_value = .01
    l.new(fibres.outputs['Fac'], relief.inputs['Height'])
    l.new(relief.outputs['Normal'], bs.inputs['Normal'])
    return m


def wood_material(c, name, rgb, seam):
    m = c.material(name, linear(rgb))
    n, l = m.node_tree.nodes, m.node_tree.links
    bs = n['Principled BSDF']
    coords = n.new('ShaderNodeTexCoord')
    stretch = n.new('ShaderNodeMapping'); stretch.inputs['Scale'].default_value = (1, 14, 1)
    l.new(coords.outputs['Object'], stretch.inputs['Vector'])
    grain = n.new('ShaderNodeTexNoise'); grain.inputs['Scale'].default_value = 9; grain.inputs['Detail'].default_value = 6
    l.new(stretch.outputs['Vector'], grain.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'EASE'
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = .3, (*linear(seam), 1)
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = .68, (*linear(rgb), 1)
    l.new(grain.outputs['Fac'], ramp.inputs[0])
    l.new(ramp.outputs['Color'], bs.inputs['Base Color'])
    return m


def coil(c, name, radius, z, thickness, material, seed):
    """One straw rope ring, slightly irregular so the rings never look machined."""
    rng = random.Random(seed)
    steps, sides = 96, 10
    phase, wobble = rng.uniform(0, math.tau), rng.uniform(.006, .012)
    vertices, faces = [], []
    for i in range(steps):
        a = math.tau * i / steps
        r = radius * (1 + wobble * math.sin(3 * a + phase)) + .004 * math.sin(17 * a)
        t = thickness * (1 + .08 * math.sin(11 * a + phase))
        for j in range(sides):
            b = math.tau * j / sides
            rr = r + t * math.cos(b)
            vertices.append((rr * math.cos(a), rr * math.sin(a), z + t * .8 * math.sin(b)))
    for i in range(steps):
        for j in range(sides):
            a = i * sides + j
            b = i * sides + (j + 1) % sides
            c2 = ((i + 1) % steps) * sides + (j + 1) % sides
            d = ((i + 1) % steps) * sides + j
            faces.append((a, b, c2, d))
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    uv = data.uv_layers.new(name='UVMap')
    for poly in data.polygons:
        for loop in poly.loop_indices:
            index = data.loops[loop].vertex_index
            uv.data[loop].uv = ((index // sides) / steps, (index % sides) / sides)
    data.update()
    ob = bpy.data.objects.new(name, data)
    c.scene.collection.objects.link(ob)
    data.materials.append(material)
    for face in data.polygons:
        face.use_smooth = True
    return ob


def build(c, spec):
    c.scene.cycles.filter_width = 1.0
    straw = straw_material(c, 'Coiled golden straw', (212, 168, 86), (120, 86, 40))
    sun = straw_material(c, 'Sun-bleached crown straw', (226, 196, 128), (140, 108, 60))
    cane = c.material('Split cane binding', linear((92, 64, 34)))
    entrance = c.material('Dark hive entrance', linear((22, 16, 10)))
    wood = wood_material(c, 'Weathered stand planks', (122, 102, 80), (62, 50, 40))
    board = wood_material(c, 'Landing board', (140, 116, 86), (72, 58, 44))

    stand = []
    # Two planks across, two beneath: the square frame around the round skep.
    for i, y in enumerate((-.23, .23)):
        stand.append(c.box(f'Stand top plank {i}', (0, y, .05), (.94, .44, .05), wood, .012))
        stand[-1].rotation_euler.z = math.radians(.8 if i else -.6)
    for i, x in enumerate((-.4, .4)):
        stand.append(c.box(f'Stand bearer {i}', (x, 0, .015), (.1, .96, .04), wood, .01))
    stand.append(c.box('Landing board', (0, -.46, .085), (.2, .12, .02), board, .006))

    skep = []
    stations = coil_stations()
    for k, (radius, z, t) in enumerate(stations):
        crown = t > .78
        skep.append(coil(c, f'Straw coil {k}', radius, z, COIL_THICKNESS * (1.12 if crown else 1), sun if crown else straw, 40 + k))
    top_r, top_z, _ = stations[-1]
    skep.append(c.ell('Straw crown knot', (0, 0, top_z + .012), (top_r * .82, top_r * .82, .045), sun))
    # Dark inner shell just under the ropes: the grooves between coils read as thin rings.
    shell = []
    for i in range(41):
        r, z = profile(i / 40)
        inset = COIL_THICKNESS * .7
        shell.append((max(0.0, r - inset), z - inset * .4))
    vertices, faces, columns = [], [], 64
    for r, z in shell:
        for j in range(columns):
            a = math.tau * j / columns
            vertices.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(len(shell) - 1):
        for j in range(columns):
            a0, a1 = i * columns + j, i * columns + (j + 1) % columns
            faces.append((a0, a1, a1 + columns, a0 + columns))
    data = bpy.data.meshes.new('Skep groove shell')
    data.from_pydata(vertices, [], faces); data.update()
    groove = bpy.data.objects.new('Skep groove shell', data)
    c.scene.collection.objects.link(groove)
    data.materials.append(c.material('Shadowed straw groove', linear((84, 58, 26))))
    skep.append(groove)
    # Split-cane bindings stitch neighbouring coils: short dark ties along eight radial lines,
    # offset per row like real skep stitching.
    for k in range(len(stations) - 1):
        (r0, z0, t0), (r1, z1, _) = stations[k], stations[k + 1]
        for spoke in range(8):
            a = spoke * math.tau / 8 + .2 + (k % 2) * math.tau / 16
            tie = c.box(f'Cane tie {spoke}-{k}', ((r0 + r1) / 2 * math.cos(a), (r0 + r1) / 2 * math.sin(a), (z0 + z1) / 2 + .025),
                        (.045, .014, .012), cane, .004)
            tie.rotation_euler = (0, -math.atan2(z1 - z0, r0 - r1 + 1e-6), a)
    skep.append(c.ell('Low arched entrance', (0, -SKEP_RADIUS + .015, .13), (.085, .05, .05), entrance))

    asset = model(c.scene)
    shaker = control(c.scene, 'skep control', (0, 0, .08), asset['root'])
    attach(skep, shaker)
    asset['parts']['skep'] = shaker
    asset['parts']['base_meshes'] = stand
    return asset
