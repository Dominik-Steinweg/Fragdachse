"""Kraken V8 eyes: real eyeballs that look forward (north), seen from above.

From the 90-degree camera an eye that looks forward shows its glossy dark dome and,
at the front edge, the upper half of a glowing ember iris with a vertical slit.
A heavy hooded upper lid covers the top/back of the ball; it pivots about the
eye's lateral axis so clips can blink or open the eyes during the surfacing.
"""
import math
import bpy
from mathutils import Matrix, Vector
from rigs_v2 import control
from recipes_v2.enemy_parts_a import horn, outward_normals
from kraken_skin_v8 import linear, paint_pattern, write_rest


def frame(look):
    f = Vector(look).normalized()
    r = f.cross(Vector((0, 0, 1))).normalized()
    u = r.cross(f).normalized()
    return f, r, u


def iris_material(c, name, core, outer, strength):
    """Emissive iris: hot core around the slit, radial fibres, dark limbal ring."""
    material = c.material(name, outer)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bs = nodes.get('Principled BSDF')
    uv = nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'FD_Iris'
    centred = nodes.new('ShaderNodeVectorMath'); centred.operation = 'SUBTRACT'
    centred.inputs[1].default_value = (.5, .5, 0)
    links.new(uv.outputs['UV'], centred.inputs[0])
    xyz = nodes.new('ShaderNodeSeparateXYZ'); links.new(centred.outputs[0], xyz.inputs[0])
    radius = nodes.new('ShaderNodeVectorMath'); radius.operation = 'LENGTH'
    links.new(centred.outputs[0], radius.inputs[0])
    # Radial fibres: noise over the polar angle, stretched along the radius.
    angle = nodes.new('ShaderNodeMath'); angle.operation = 'ARCTAN2'
    links.new(xyz.outputs['Y'], angle.inputs[0]); links.new(xyz.outputs['X'], angle.inputs[1])
    polar = nodes.new('ShaderNodeCombineXYZ')
    links.new(angle.outputs[0], polar.inputs['X'])
    stretch = nodes.new('ShaderNodeMath'); stretch.operation = 'MULTIPLY'; stretch.inputs[1].default_value = .35
    links.new(radius.outputs[0], stretch.inputs[0]); links.new(stretch.outputs[0], polar.inputs['Y'])
    fibres = nodes.new('ShaderNodeTexNoise')
    fibres.inputs['Scale'].default_value = 9; fibres.inputs['Detail'].default_value = 4
    links.new(polar.outputs[0], fibres.inputs['Vector'])
    fibre_value = nodes.new('ShaderNodeMapRange')
    fibre_value.inputs['From Min'].default_value = .3; fibre_value.inputs['From Max'].default_value = .7
    fibre_value.inputs['To Min'].default_value = .55; fibre_value.inputs['To Max'].default_value = 1.15
    links.new(fibres.outputs['Fac'], fibre_value.inputs['Value'])
    tones = nodes.new('ShaderNodeValToRGB'); tones.color_ramp.interpolation = 'EASE'
    stops = [(0, core), (.12, core), (.30, outer), (.43, tuple(v * .45 for v in outer)), (.50, tuple(v * .12 for v in outer))]
    elements = tones.color_ramp.elements
    for i, (pos, color) in enumerate(stops):
        e = elements[i] if i < 2 else elements.new(pos)
        e.position, e.color = pos, (*color, 1)
    links.new(radius.outputs[0], tones.inputs[0])
    fibred = nodes.new('ShaderNodeMix'); fibred.data_type = 'RGBA'; fibred.blend_type = 'MULTIPLY'
    fibred.inputs[0].default_value = 1
    links.new(tones.outputs[0], fibred.inputs[6]); links.new(fibre_value.outputs[0], fibred.inputs[7])
    # Vertical predator slit: narrow across, tapering top and bottom.
    across = nodes.new('ShaderNodeMath'); across.operation = 'ABSOLUTE'
    links.new(xyz.outputs['X'], across.inputs[0])
    along = nodes.new('ShaderNodeMath'); along.operation = 'MULTIPLY'
    links.new(xyz.outputs['Y'], along.inputs[0]); links.new(xyz.outputs['Y'], along.inputs[1])
    taper = nodes.new('ShaderNodeMapRange')
    taper.inputs['From Min'].default_value = 0; taper.inputs['From Max'].default_value = .19
    taper.inputs['To Min'].default_value = .075; taper.inputs['To Max'].default_value = 0
    links.new(along.outputs[0], taper.inputs['Value'])
    slit = nodes.new('ShaderNodeMath'); slit.operation = 'LESS_THAN'
    links.new(across.outputs[0], slit.inputs[0]); links.new(taper.outputs[0], slit.inputs[1])
    pupil = nodes.new('ShaderNodeMix'); pupil.data_type = 'RGBA'
    links.new(slit.outputs[0], pupil.inputs[0])
    links.new(fibred.outputs[2], pupil.inputs[6]); pupil.inputs[7].default_value = (.004, .001, .002, 1)
    links.new(pupil.outputs[2], bs.inputs['Base Color'])
    links.new(pupil.outputs[2], bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value = strength
    bs.inputs['Roughness'].default_value = .18
    bs.inputs['Specular IOR Level'].default_value = .5
    material['FD_SurfaceKind'] = 'kraken-iris-v8'
    return material


def glossy_material(c, name, color, roughness=.16):
    material = c.material(name, color)
    bs = material.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Specular IOR Level'].default_value = .62
    return material


def mesh(c, name, vertices, faces, material, uvs=None, pattern=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    outward_normals(data)
    data.materials.append(material)
    for polygon in data.polygons:
        polygon.use_smooth = True
    if pattern:
        attr = data.color_attributes.new(name='FD_Pattern', type='FLOAT_COLOR', domain='POINT')
        for value, plan in zip(attr.data, pattern):
            value.color = (*plan, 1)
    if uvs:
        layer = data.uv_layers.new(name='FD_Iris')
        for polygon in data.polygons:
            for loop in polygon.loop_indices:
                layer.data[loop].uv = uvs[data.loops[loop].vertex_index]
    ob = bpy.data.objects.new(name, data)
    c.scene.collection.objects.link(ob)
    return ob


def cap(c, name, center, radius, axis, right, up, limit, material, rings=10, segments=48, uv=False):
    """Spherical cap around `axis` up to polar angle `limit` (radians)."""
    vertices, faces, uvs = [], [], []
    for k in range(rings + 1):
        theta = limit * k / rings
        for j in range(segments):
            phi = math.tau * j / segments
            direction = math.cos(theta) * axis + math.sin(theta) * (math.cos(phi) * right + math.sin(phi) * up)
            vertices.append(tuple(center + radius * direction))
            rho = .5 * k / rings
            uvs.append((.5 + rho * math.cos(phi), .5 + rho * math.sin(phi)))
    for k in range(rings):
        for j in range(segments):
            a, b = k * segments + j, k * segments + (j + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    return mesh(c, name, vertices, faces, material, uvs if uv else None)


def lid_shell(c, name, center, radius, f, r, u, start, end, width, material, thickness=.035):
    """Hood over the eyeball: angles measured in the (u, f) plane from `up` towards `forward`."""
    vertices, faces, pattern = [], [], []
    rows, cols = 14, 22
    for layer, scale in enumerate((1, 1 + thickness / radius)):
        for i in range(rows + 1):
            alpha = start + (end - start) * i / rows
            for j in range(cols + 1):
                beta = width * (2 * j / cols - 1)
                # Rounded lid edge: the front margin recedes at the sides.
                edge = 1 - .35 * (abs(beta) / width) ** 2 if i == rows else 1
                a = start + (alpha - start) * edge
                d = (math.cos(a) * u + math.sin(a) * f) * math.cos(beta) + math.sin(beta) * r
                vertices.append(tuple(center + radius * scale * 1.06 * d.normalized()))
                # Body-coloured hood with a pale, wet margin above the glowing iris.
                pattern.append((.18 + .14 * i / rows, .12 * max(0, (i / rows - .85) / .15), .3))
    stride = (rows + 1) * (cols + 1)
    for layer in (0, 1):
        for i in range(rows):
            for j in range(cols):
                a = layer * stride + i * (cols + 1) + j
                quad = (a, a + 1, a + cols + 2, a + cols + 1)
                faces.append(quad if layer else quad[::-1])
    for i in range(rows):  # side walls
        for j in (0, cols):
            a, b = i * (cols + 1) + j, (i + 1) * (cols + 1) + j
            faces.append((a, b, b + stride, a + stride))
    for j in range(cols):  # front and back margins
        for i in (0, rows):
            a, b = i * (cols + 1) + j, i * (cols + 1) + j + 1
            faces.append((a, b, b + stride, a + stride))
    return mesh(c, name, vertices, faces, material, pattern=pattern)


def eye_sculpt(c, name, center, radius, look, surface, material):
    """Skull tissue around one eye, fused into the mantle: socket collar and frowning brow.

    Returns (objects, brow polyline in XY) so the value plan can light the brow crest.
    """
    center = Vector(center)
    f, r, u = frame(look)
    outward = 1 if r.x * center.x > 0 else -1
    ring = []
    for j in range(40):
        phi = math.tau * j / 40
        d = math.cos(phi) * r + math.sin(phi) * f
        p = center + radius * 1.04 * d.normalized()
        p.z = min(p.z, surface(p.x, p.y) + radius * .04)
        ring.append(tuple(p))
    ring.append(ring[0])
    radii = [radius * (.16 + .12 * max(0, -math.sin(math.tau * j / 40))) for j in range(41)]
    collar = horn(c, name + ' fleshy socket collar', ring, radii, material, sides=14)
    # Heavy brow over the back/top of the ball, lower towards the midline: the frown.
    brow = []
    for t in (-1, -.6, -.2, .2, .6, 1):
        a = math.radians(-30 + 36 * (1 - abs(t)))
        d = (math.cos(a) * u + math.sin(a) * f) * math.cos(t * 1.2) + math.sin(t * 1.2) * r
        p = center + radius * 1.16 * d.normalized()
        p.z += radius * (.10 + .18 * t * outward)
        brow.append(tuple(p))
    ridge = horn(c, name + ' heavy brow ridge', brow,
                 [radius * .08, radius * .30, radius * .44, radius * .42, radius * .26, radius * .06], material, sides=18)
    return [collar, ridge], [(p[0], p[1]) for p in brow]


def eye(c, name, center, radius, look, mats, parent):
    """Build one eye. Returns (objects, lid_control, iris)."""
    center = Vector(center)
    f, r, u = frame(look)
    objects = []
    ball = c.ell(name + ' glossy eyeball', tuple(center), (radius, radius, radius), mats['ball'])
    objects.append(ball)
    iris = cap(c, name + ' ember iris', center, radius * 1.012, f, r, u, math.radians(50), mats['iris'], uv=True)
    objects.append(iris)
    # Hooded upper lid on its own pivot; open pose keeps the iris front visible.
    pivot = control(c.scene, name + ' lid pivot', tuple(center), parent)
    pivot.rotation_mode = 'XYZ'
    pivot.matrix_world = Matrix.Translation(center) @ Matrix((r, f, u)).transposed().to_4x4()
    lid = lid_shell(c, name + ' hooded upper lid', center, radius, f, r, u,
                    math.radians(-150), math.radians(20), math.radians(70), mats['lid'], thickness=.014)
    world = lid.matrix_world.copy()
    lid.parent = pivot
    lid.matrix_world = world
    objects.append(lid)
    for ob in objects:
        write_rest(ob)
    return objects, pivot, iris


def eye_materials(c):
    from kraken_skin_v8 import PALETTE, skin
    return {
        'ball': glossy_material(c, 'Kraken V8 wet black-crimson eyeball', linear('#14060c')),
        'iris': iris_material(c, 'Kraken V8 ember slit iris', linear('#ffd27a'), linear('#ff3a14'), 4.5),
        'lid': skin(c, 'Kraken V8 heavy hooded lids', PALETTE['dorsal'], PALETTE['flank'], rim=PALETTE['rim'], softness=.7),
    }
