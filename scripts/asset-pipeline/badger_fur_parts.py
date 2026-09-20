"""Authored swept fur masses and folded ears for the cursor-inspired skull."""
import math
import bpy
from mathutils import Vector


def folded_ear(ctx, side, ivory, head):
    """A low folded pinna follows the skull and blends its root into cheek fur."""
    bpy.context.view_layer.update()
    transform, inverse = head.matrix_world.copy(), head.matrix_world.inverted()
    direction = (inverse.to_3x3() @ Vector((0, 0, -1))).normalized()

    def surface(px, py, r, local_y):
        # Keep the outer fold on the actual cheek, including its falling flank.
        # The old fixed-height ear plane floated above this curved surface.
        for _ in range(30):
            hit, point, _, _ = head.ray_cast(inverse @ Vector((side*px, py, 3)), direction)
            if hit:
                root = max(0, local_y)*r
                lift = .001 + .004*r*r*(1-root)
                return (side*px, py, (transform @ point).z + lift)
            px -= .003
        raise ValueError('Folded ear must remain attached to the skull')
    vertices, faces = [], []
    ear_uv = [(0, 0, 0)]
    rings, steps = 12, 72
    vertices.append(surface(.300, -.104, 0, 0))
    for ring in range(1, rings+1):
        r = ring/rings
        for i in range(steps):
            angle = 2*math.pi*i/steps
            # Broad rounded rear fold, swept along the cheek rather than a
            # pointed upright pinna. The north root disappears into the skull.
            x, y = math.cos(angle), math.sin(angle)
            feather = .035*math.sin(17*angle + .7)**3*r**5
            px = .300 + .081*(1-.12*y)*(r+feather)*x + .035*r*y
            py = -.104 + .153*(r+feather)*math.copysign(abs(y)**.78, y)
            vertices.append(surface(px, py, r, y))
            ear_uv.append((r*x, r*y, 0))
    for i in range(steps):
        faces.append((0, 1+i, 1+(i+1)%steps))
    for ring in range(rings-1):
        for i in range(steps):
            a = 1+ring*steps+i; b = 1+ring*steps+(i+1)%steps
            faces.append((a, a+steps, b+steps, b))
    mesh = bpy.data.meshes.new('Swept folded ear fur')
    mesh.from_pydata(vertices, [], [f if side > 0 else tuple(reversed(f)) for f in faces])
    material = head.data.materials[0].copy()
    material.name = 'Painted folded ear with swept ivory fringe'
    nodes, links = material.node_tree.nodes, material.node_tree.links
    ctx.strengths.append(nodes['Surface detail strength'].inputs[0])
    if 'Form shadow strength' in nodes:
        ctx.form_strengths.append(nodes['Form shadow strength'].inputs[0])
    bs = nodes.get('Principled BSDF')
    skull = bs.inputs['Base Color'].links[0].from_socket
    pale = nodes['Authored facial band mix'].inputs[1].links[0].from_socket
    # Evaluate the copied skull shader in the skull's original coordinate frame,
    # so the cheek stripes and fur match exactly at the attachment boundary.
    generated = nodes.new('ShaderNodeAttribute'); generated.attribute_name = 'FD_HeadGenerated'
    for node in list(nodes):
        if node.type == 'TEX_COORD':
            for link in list(node.outputs['Generated'].links):
                links.new(generated.outputs['Vector'], link.to_socket)
    bounds = [Vector(corner) for corner in head.bound_box]
    minimum = Vector(tuple(min(p[axis] for p in bounds) for axis in range(3)))
    span = Vector(tuple(max(p[axis] for p in bounds)-minimum[axis] for axis in range(3)))
    coordinates = mesh.attributes.new('FD_HeadGenerated', 'FLOAT_VECTOR', 'POINT')
    eye_rest = mesh.attributes.new('FD_EyeRestPosition', 'FLOAT_VECTOR', 'POINT')
    for vertex, coordinate, rest in zip(mesh.vertices, coordinates.data, eye_rest.data):
        local = inverse @ vertex.co
        coordinate.vector = tuple((local[axis]-minimum[axis])/span[axis] for axis in range(3))
        rest.vector = vertex.co
    uv = nodes.new('ShaderNodeAttribute'); uv.attribute_name = 'FD_EarUV'
    distance = nodes.new('ShaderNodeVectorMath'); distance.operation = 'LENGTH'
    links.new(uv.outputs['Vector'], distance.inputs[0])
    axes = nodes.new('ShaderNodeSeparateXYZ'); links.new(uv.outputs['Vector'], axes.inputs[0])
    fold = nodes.new('ShaderNodeMath'); fold.operation = 'MULTIPLY_ADD'
    links.new(axes.outputs['Y'], fold.inputs[0]); fold.inputs[1].default_value = -.35
    links.new(distance.outputs['Value'], fold.inputs[2])
    noise = nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 12
    links.new(uv.outputs['Vector'], noise.inputs['Vector'])
    variance = nodes.new('ShaderNodeMath'); variance.operation = 'MULTIPLY_ADD'
    links.new(noise.outputs['Fac'], variance.inputs[0]); variance.inputs[1].default_value = .22
    links.new(fold.outputs[0], variance.inputs[2])
    fringe = nodes.new('ShaderNodeValToRGB')
    fringe.color_ramp.elements[0].position = .65
    fringe.color_ramp.elements[0].color = (.065, .067, .070, 1)
    fringe.color_ramp.elements[1].position = .98
    fringe.color_ramp.elements[1].color = (.76, .73, .66, 1)
    links.new(variance.outputs[0], fringe.inputs[0])
    # The upper half inherits the pale cheek value instead of ending in a
    # contrasting rim. Only the low rear fold has an exposed dark interior.
    root_fade = nodes.new('ShaderNodeMapRange')
    root_fade.inputs['From Min'].default_value = -.10
    root_fade.inputs['From Max'].default_value = .70
    links.new(axes.outputs['Y'], root_fade.inputs['Value'])
    root_color = nodes.new('ShaderNodeMixRGB')
    links.new(root_fade.outputs['Result'], root_color.inputs[0])
    links.new(fringe.outputs[0], root_color.inputs[1])
    root_color.inputs[2].default_value = (.85, .83, .78, 1)
    coat = nodes.new('ShaderNodeMixRGB'); coat.blend_type = 'MULTIPLY'; coat.inputs[0].default_value = 1
    links.new(pale, coat.inputs[1]); links.new(root_color.outputs[0], coat.inputs[2])
    edge_fade = nodes.new('ShaderNodeMapRange')
    edge_fade.inputs['From Min'].default_value = .78
    edge_fade.inputs['From Max'].default_value = 1
    edge_fade.inputs['To Min'].default_value = 1
    edge_fade.inputs['To Max'].default_value = 0
    links.new(distance.outputs['Value'], edge_fade.inputs['Value'])
    root_weight = nodes.new('ShaderNodeMath'); root_weight.operation = 'SUBTRACT'
    root_weight.inputs[0].default_value = 1
    links.new(root_fade.outputs['Result'], root_weight.inputs[1])
    weight = nodes.new('ShaderNodeMath'); weight.operation = 'MULTIPLY'
    links.new(root_weight.outputs[0], weight.inputs[0]); links.new(edge_fade.outputs['Result'], weight.inputs[1])
    attached = nodes.new('ShaderNodeMixRGB'); attached.name = 'Continuous cheek-to-ear fur transition'
    links.new(weight.outputs[0], attached.inputs[0]); links.new(skull, attached.inputs[1])
    links.new(coat.outputs[0], attached.inputs[2]); links.new(attached.outputs[0], bs.inputs['Base Color'])
    attr = mesh.attributes.new('FD_EarUV', 'FLOAT_VECTOR', 'POINT')
    for item, coordinate in zip(attr.data, ear_uv): item.vector = coordinate
    mesh.materials.append(material)
    for face in mesh.polygons:
        face.material_index = 0; face.use_smooth = True
    ob = bpy.data.objects.new('Broad laid-back fur ear', mesh)
    # The ear is a continuous shallow fold; it must not cast a contact outline
    # onto the almost coincident cheek surface beneath its blended boundary.
    ob.visible_shadow = False
    ctx.scene.collection.objects.link(ob)
    return ob


def cheek_locks(ctx, head, ivory, dark):
    """Tapered overlapping locks articulate the skull edge and broad fur planes."""
    bpy.context.view_layer.update()
    transform, inverse = head.matrix_world.copy(), head.matrix_world.inverted()
    direction = (inverse.to_3x3() @ Vector((0, 0, -1))).normalized()
    vertices, faces, indices = [], [], []

    def height(x, y):
        hit, point, _, _ = head.ray_cast(inverse @ Vector((x, y, 3)), direction)
        return (transform @ point).z if hit else None

    def lock(x, y, width, length, sweep, material):
        z = height(x, y)
        if z is None: return
        base = len(vertices)
        points = [(-width, .012, 0), (0, .024, .001), (width, .012, 0),
                  (width*.65+sweep*.5, -length*.45, .001),
                  (sweep, -length, -.003), (-width*.65+sweep*.5, -length*.45, .001),
                  (sweep*.28, -length*.32, .002)]
        for dx, dy, dz in points:
            h = height(x+dx, y+dy)
            vertices.append((x+dx, y+dy, (h if h is not None else z-.012)-.006+dz))
        for a,b in [(0,1),(1,2),(2,3),(3,4),(4,5),(5,0)]:
            faces.append((base+b,base+a,base+6)); indices.append(material)

    # The surface uses painted fur; geometry only breaks the silhouette.
    for side in (-1, 1):
        for i in range(22):
            y = -.30 + i*.035
            # Find the edge explicitly on the skull, then root each tuft inside it.
            hits = [x*.005 for x in range(5, 90) if height(side*x*.005, y) is not None]
            if not hits: continue
            x = side*(max(hits)-.018)
            lock(x,y,.009,.041,side*.026,0)
    mesh = bpy.data.meshes.new('Layered tapered cheek and crown locks')
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(ivory); mesh.materials.append(dark)
    for polygon,index in zip(mesh.polygons,indices):
        polygon.material_index=index; polygon.use_smooth=True
    ob=bpy.data.objects.new('Swept skull fur locks',mesh)
    ctx.scene.collection.objects.link(ob)
