"""Compact combat face, authored for the unchanged vertical export camera."""
import bpy
import math
from mathutils import Vector


def sculpt_crown(head):
    """Cut broad cheek/crown planes in height only, preserving the XY envelope."""
    for vertex in head.data.vertices:
        x, y, z = vertex.co
        if z > 0:
            crown = .91 - .23 * abs(x) - .06 * max(0, y)
            vertex.co.z = min(z, crown)


def eye_sockets(head, south_offset=0):
    """Blend soft dark hollows directly into the existing facial material."""
    bpy.context.view_layer.update()
    coordinates = head.data.attributes.new('FD_EyeRestPosition', 'FLOAT_VECTOR', 'POINT')
    for vertex, value in zip(head.data.vertices, coordinates.data):
        value.vector = head.matrix_world @ vertex.co
    material = head.data.materials[0]
    nodes, links = material.node_tree.nodes, material.node_tree.links
    position = nodes.new('ShaderNodeAttribute')
    position.attribute_name = 'FD_EyeRestPosition'
    components = nodes.new('ShaderNodeSeparateXYZ')
    links.new(position.outputs['Vector'], components.inputs[0])

    def scalar(operation, value, other=None):
        node = nodes.new('ShaderNodeMath')
        node.operation = operation
        links.new(value, node.inputs[0])
        if other is not None:
            if isinstance(other, (int, float)):
                node.inputs[1].default_value = other
            else:
                links.new(other, node.inputs[1])
        return node.outputs[0]

    absolute_x = scalar('ABSOLUTE', components.outputs['X'])
    authored_y = scalar('ADD', components.outputs['Y'], south_offset)
    x = scalar('SUBTRACT', absolute_x, .168)
    y = scalar('SUBTRACT', scalar('SUBTRACT', authored_y, .369), scalar('MULTIPLY', x, -.44))
    orbital_y = scalar('ADD', authored_y, scalar('MULTIPLY', x, .65))

    # Locally reshape both boundaries of the existing bands into a connected
    # brow/orbit/cheek flow, rather than placing dark circles on straight bands.
    region_y = nodes.new('ShaderNodeMapRange')
    region_y.inputs['From Min'].default_value = .14
    region_y.inputs['From Max'].default_value = .52
    links.new(orbital_y, region_y.inputs['Value'])
    outline = nodes.new('ShaderNodeValToRGB')
    outline.name = 'Organic inner and outer orbital band boundaries'
    outline.color_ramp.interpolation = 'B_SPLINE'
    outline.color_ramp.elements.remove(outline.color_ramp.elements[1])
    for i, (position, inner, outer) in enumerate([
            (0, .110, .290), (.25, .087, .326), (.48, .045, .344),
            (.70, .080, .327), (1, .115, .225)]):
        element = outline.color_ramp.elements[0] if i == 0 else outline.color_ramp.elements.new(position)
        element.position, element.color = position, (inner, outer, 0, 1)
    links.new(region_y.outputs['Result'], outline.inputs[0])
    boundaries = nodes.new('ShaderNodeSeparateXYZ')
    links.new(outline.outputs[0], boundaries.inputs[0])
    width = scalar('SUBTRACT', boundaries.outputs['Y'], boundaries.outputs['X'])
    coordinate = scalar('DIVIDE', scalar('SUBTRACT', absolute_x, boundaries.outputs['X']), width)
    orbital_coordinate = scalar('ADD', scalar('MULTIPLY', coordinate, .290), .115)
    transition = nodes.new('ShaderNodeValToRGB')
    transition.name = 'Return orbital mask smoothly to original long bands'
    transition.color_ramp.interpolation = 'EASE'
    transition.color_ramp.elements.remove(transition.color_ramp.elements[1])
    for i, (position, value) in enumerate([(0, 0), (.5, 1), (1, 0)]):
        element = transition.color_ramp.elements[0] if i == 0 else transition.color_ramp.elements.new(position)
        element.position, element.color = position, (value, value, value, 1)
    links.new(region_y.outputs['Result'], transition.inputs[0])
    bands = nodes['Authored facial band mix']
    original_mask = bands.inputs[0].links[0].from_node
    original_coordinate = original_mask.inputs[0].links[0].from_socket
    merged = nodes.new('ShaderNodeMixRGB')
    merged.name = 'Continuous orbital deformation of facial bands'
    links.new(transition.outputs[0], merged.inputs[0])
    links.new(original_coordinate, merged.inputs[1])
    links.new(orbital_coordinate, merged.inputs[2])
    # Warp coordinates before thresholding: blending two already-thresholded
    # masks would leave doubled edges at the return into the long cheek bands.
    # Interlocking, swept tufts break the color boundary into tapered fur groups.
    # Rest-space coordinates keep this material detail attached during the run.
    # Two uneven scales avoid both cloudy noise and a regular serrated border.
    sweep = scalar('ADD', authored_y, scalar('MULTIPLY', absolute_x, .62))
    bend = scalar('MULTIPLY', scalar('SINE', scalar('MULTIPLY', authored_y, 19)), .17)
    phase = scalar('ADD', scalar('MULTIPLY', sweep, 19), bend)

    def tuft(value):
        fraction = scalar('FRACT', value)
        rise = scalar('DIVIDE', fraction, .80)
        fall = scalar('DIVIDE', scalar('SUBTRACT', scalar('MULTIPLY', fraction, -1), -1), .20)
        return scalar('SUBTRACT', scalar('MINIMUM', rise, fall), .5)

    coarse = scalar('MULTIPLY', tuft(phase), .012)
    fine_phase = scalar('ADD', scalar('MULTIPLY', sweep, 43), scalar('MULTIPLY', absolute_x, 11))
    fine = scalar('MULTIPLY', tuft(fine_phase), .007)
    grain_coordinates = nodes.new('ShaderNodeCombineXYZ')
    links.new(scalar('ADD', scalar('MULTIPLY', absolute_x, 115), scalar('MULTIPLY', authored_y, 32)), grain_coordinates.inputs['X'])
    links.new(scalar('MULTIPLY', sweep, 18), grain_coordinates.inputs['Y'])
    grain = nodes.new('ShaderNodeTexNoise')
    grain.name = 'Swept fiber boundary variation, never coat color noise'
    grain.inputs['Scale'].default_value = 1
    grain.inputs['Detail'].default_value = 2
    grain.inputs['Roughness'].default_value = .65
    links.new(grain_coordinates.outputs[0], grain.inputs['Vector'])
    fibers = scalar('MULTIPLY', scalar('SUBTRACT', grain.outputs['Fac'], .5), .105)
    fur_coordinate = scalar('ADD', merged.outputs[0], scalar('ADD', fibers, scalar('ADD', coarse, fine)))
    links.new(fur_coordinate, original_mask.inputs[0])
    for element, position in zip(original_mask.color_ramp.elements, [0, .121, .143, .370, .396]):
        element.position = position
    original_mask.color_ramp.interpolation = 'EASE'
    radius = scalar('ADD', scalar('POWER', scalar('DIVIDE', x, .162), 2),
                    scalar('POWER', scalar('DIVIDE', y, .128), 2))
    radius = scalar('ADD', radius, scalar('MULTIPLY', fibers, 4))
    falloff = nodes.new('ShaderNodeValToRGB')
    falloff.name = 'Soft integrated eye hollows'
    falloff.color_ramp.interpolation = 'EASE'
    falloff.color_ramp.elements[0].position = .62
    falloff.color_ramp.elements[0].color = (1, 1, 1, 1)
    falloff.color_ramp.elements[1].position = 1
    falloff.color_ramp.elements[1].color = (0, 0, 0, 1)
    links.new(radius, falloff.inputs[0])
    bs = nodes.get('Principled BSDF')
    original = bs.inputs['Base Color'].links[0].from_socket
    socket = nodes.new('ShaderNodeMixRGB')
    socket.name = 'Painted black eye recesses'
    links.new(falloff.outputs[0], socket.inputs[0])
    links.new(original, socket.inputs[1])
    socket.inputs[2].default_value = (.0008, .0010, .0013, 1)
    links.new(socket.outputs[0], bs.inputs['Base Color'])


def combat_eye(ctx, side, dark, head, south_offset=0):
    """Organic white aperture and fur hood conform to the unchanged skull."""
    bpy.context.view_layer.update()
    transform = head.matrix_world.copy()
    inverse = transform.inverted()
    direction = (inverse.to_3x3() @ Vector((0, 0, -1))).normalized()

    def surface(x, y):
        hit, point, _, _ = head.ray_cast(inverse @ Vector((x, y, 3)), direction)
        if not hit:
            raise ValueError('Eye surface must remain inside the existing skull contour')
        return (transform @ point).z

    white = ctx.material('Neutral matte white eye', (.96, .96, .96))
    bs = white.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Roughness'].default_value = 1
    bs.inputs['Specular IOR Level'].default_value = 0
    # Pointed ends, a fuller curved north edge and a shallower asymmetric lower
    # edge. No eyeball sphere, pupil, reflection dot, frame, emission or bloom.
    vertices, faces = [], []
    columns, rows = 40, 8
    for i in range(columns+1):
        t = i/columns
        x = side*(.069 + .202*t)
        # +Y is north: the outer corner must fall south (down in the image).
        # Steeper around the same midpoint, with a modestly smaller aperture.
        center = .392 - .086*t
        fullness = math.sin(math.pi*t)**.85
        lower, upper = center+.023*fullness, center+.084*fullness
        for j in range(rows+1):
            y = lower + (upper-lower)*j/rows - south_offset
            vertices.append((x, y, surface(x, y)+.003))
    for i in range(columns):
        for j in range(rows):
            a = i*(rows+1)+j
            quad = (a, a+rows+1, a+rows+2, a+1)
            faces.append(quad if side > 0 else tuple(reversed(quad)))
    mesh = bpy.data.meshes.new('Curved white eye surface')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    eye = bpy.data.objects.new('Organic white eye aperture', mesh)
    ctx.scene.collection.objects.link(eye)
    mesh.materials.append(white)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    eye['facePart'] = 'eye-white'

    # The low, curved rear hood is rooted in the skull instead of floating on it.
    brow_material = dark.copy()
    brow_material.name = 'Black orbital fur brow'
    brow_bs = brow_material.node_tree.nodes.get('Principled BSDF')
    for link in list(brow_bs.inputs['Base Color'].links):
        brow_material.node_tree.links.remove(link)
    brow_bs.inputs['Base Color'].default_value = (.0008, .0010, .0013, 1)
    brow_bs.inputs['Roughness'].default_value = 1
    brow_bs.inputs['Specular IOR Level'].default_value = 0
    brow = ctx.ell('Curved heavy fur brow', (0, 0, 0), (1, 1, 1), brow_material)
    for vertex in brow.data.vertices:
        x, y, z = vertex.co
        t = (x+1)/2
        px = side*(.046 + .247*t)
        py = .401 - .098*t + .020*math.sin(math.pi*t) - .026 + .025*y - south_offset
        vertex.co = (px, py, surface(px, py)+.012*z-.008)
    brow['facePart'] = 'eye-brow'
