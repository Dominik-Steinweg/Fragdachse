"""Matte fly agaric with a continuous uneven cap and sparse broken veil scales."""
import math
import random
import bpy
from turret_parts import finish
from turret_surface_parts import finish as surface_finish


def surface(x, y):
    radius = min(1, math.hypot((x + .055) / 1.01, y / .96))
    angle = math.atan2(y, x + .055)
    return .70 + .43 * math.sqrt(max(0, 1 - radius * radius)) + .018 * math.sin(5 * angle + radius * 9) * radius


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


def fungal_material(c, name, color, low, high, relief):
    material = c.material(name, color, 'organic')
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes['Principled BSDF']
    original = shader.inputs['Base Color'].links[0].from_socket
    coordinates = nodes.new('ShaderNodeTexCoord')
    broad = nodes.new('ShaderNodeTexNoise')
    broad.inputs['Scale'].default_value = 5.8
    broad.inputs['Detail'].default_value = 3.2
    links.new(coordinates.outputs['Generated'], broad.inputs['Vector'])
    tones = nodes.new('ShaderNodeValToRGB')
    tones.color_ramp.elements[0].position = .23
    tones.color_ramp.elements[0].color = (*low, 1)
    tones.color_ramp.elements[1].position = .78
    tones.color_ramp.elements[1].color = (*high, 1)
    links.new(broad.outputs['Fac'], tones.inputs[0])
    blend = nodes.new('ShaderNodeMixRGB')
    blend.inputs[0].default_value = .58
    links.new(original, blend.inputs[1])
    links.new(tones.outputs[0], blend.inputs[2])
    links.new(blend.outputs[0], shader.inputs['Base Color'])
    grain = nodes.new('ShaderNodeTexNoise')
    grain.inputs['Scale'].default_value = 46
    grain.inputs['Detail'].default_value = 2.5
    links.new(coordinates.outputs['Generated'], grain.inputs['Vector'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .24
    bump.inputs['Distance'].default_value = relief
    links.new(grain.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    return surface_finish(material, 'cuticle' if relief < .02 else 'veil')


def build(c, spec):
    stem = surface_finish(c.material('Warm fibrous ivory stalk', (.53, .43, .29), 'organic'), 'fibre')
    under = surface_finish(c.material('Muted cream rolled rim', (.64, .49, .30), 'organic'), 'fibre')
    skin = fungal_material(c, 'Weathered vermilion cuticle', (.68, .035, .016),
                           (.34, .009, .008), (.88, .105, .035), .013)
    pale = fungal_material(c, 'Dry broken ivory veil', (.85, .77, .56),
                           (.57, .47, .31), (.94, .86, .67), .023)
    dark = c.material('Recessed eastern spore slit', (.08, .027, .014), 'organic')
    base = [c.ell('Compact mycelium cushion', (0, 0, .14), (.62, .60, .14), stem),
            c.ell('Short concealed stalk', (-.055, 0, .42), (.35, .33, .38), stem)]
    # One continuous surface avoids a manufactured ring of repeated lobes.
    segments, rings = 128, 24
    vertices = [(-.055, 0, surface(-.055, 0))]
    for ring in range(1, rings + 1):
        r = math.sin(ring / rings * math.pi / 2)
        for i in range(segments):
            a = math.tau * i / segments
            edge = 1 + .025 * math.sin(3*a+.7) + .019 * math.sin(7*a-1.2) + .008 * math.sin(17*a)
            x, y = -.055 + 1.01*r*edge*math.cos(a), .96*r*edge*math.sin(a)
            z = .70 + .43*math.cos(ring/rings*math.pi/2) + .018*math.sin(5*a+r*9)*r
            vertices.append((x, y, z))
    faces = [(0, 1+i, 1+(i+1)%segments) for i in range(segments)]
    for ring in range(rings-1):
        start, nxt = 1+ring*segments, 1+(ring+1)*segments
        faces.extend((start+i, nxt+i, nxt+(i+1)%segments, start+(i+1)%segments) for i in range(segments))
    cap = [c.ell('Narrow uneven underside', (-.055, 0, .675), (.99, .94, .10), under),
           mesh(c, 'Natural lobed fly agaric cap', vertices, faces, skin)]
    rng = random.Random(81)
    # Unequal torn patches conform to the dome with raised centers and chipped outlines.
    for index, (x, y, size) in enumerate([
        (-.44, .56, .135), (.02, .66, .11), (.47, .38, .15),
        (-.69, .13, .13), (-.18, .17, .18), (.27, -.05, .12),
        (-.53, -.40, .15), (-.08, -.57, .13), (.49, -.43, .145),
    ]):
        count = 13
        rotation = rng.uniform(0, math.tau)
        outline = []
        for i in range(count):
            a = rotation + i*math.tau/count
            r = size*rng.uniform(.70, 1.18)
            outline.append((x+r*math.cos(a), y+r*.83*math.sin(a)))
        vs = [(x, y, surface(x, y)+.065)]
        for scale, lift in ((.65, .054), (1, .014)):
            for px, py in outline:
                xx, yy = x+(px-x)*scale, y+(py-y)*scale
                vs.append((xx, yy, surface(xx, yy)+lift+rng.uniform(-.005, .005)))
        fs = [(0, 1+i, 1+(i+1)%count) for i in range(count)]
        fs.extend((1+i, 1+count+i, 1+count+(i+1)%count, 1+(i+1)%count) for i in range(count))
        cap.append(mesh(c, 'Torn veil scale %02d' % index, vs, fs, pale))
    # The east-facing firing cue stays subordinate to the mushroom silhouette.
    mouth = [c.ell('Folded eastern gill lip', (.88, 0, .67), (.23, .15, .09), under),
             c.ell('Inset spore slit', (.965, 0, .732), (.12, .065, .018), dark)]
    return finish(c, base, {'cap': cap, 'gills': mouth},
                  pivots={'cap': (-.055, 0, .65), 'gills': (.84, 0, .67)},
                  sockets={'muzzle': (1.12, 0, .81)})
