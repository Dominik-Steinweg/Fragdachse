"""Small modeling tools, not an enemy template. Recipes own anatomy and silhouette."""
import math
import bpy
import bmesh
from mathutils import Vector
from rigs_v2 import model, control, attach, limb_rig


def outward_normals(mesh):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()


def smooth_path(points, values, steps=5):
    sampled, radii = [], []
    for i in range(len(points)-1):
        p0,p1,p2,p3=[Vector(points[max(0,min(len(points)-1,j))]) for j in (i-1,i,i+1,i+2)]
        for j in range(steps):
            t=j/steps
            position=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)
            sampled.append(tuple(position))
            radii.append(values[i]+(values[i+1]-values[i])*t)
    return sampled+[points[-1]], radii+[values[-1]]


def sculpt_shading(material):
    """Retain each authored hue while broad normals give matte forms readable depth."""
    if material.get('FD_SculptShading'):
        return
    nodes,links=material.node_tree.nodes,material.node_tree.links
    bs=nodes.get('Principled BSDF')
    if not bs or not bs.inputs['Base Color'].is_linked:
        return
    source=bs.inputs['Base Color'].links[0].from_socket
    geometry=nodes.new('ShaderNodeNewGeometry')
    facing=nodes.new('ShaderNodeVectorMath'); facing.operation='DOT_PRODUCT'
    links.new(geometry.outputs['Normal'],facing.inputs[0])
    facing.inputs[1].default_value=(0,0,1)
    ramp=nodes.new('ShaderNodeMapRange')
    ramp.interpolation_type='SMOOTHSTEP'
    ramp.inputs['From Min'].default_value=0
    ramp.inputs['From Max'].default_value=1
    ramp.inputs['To Min'].default_value=.34
    ramp.inputs['To Max'].default_value=1.12
    links.new(facing.outputs['Value'],ramp.inputs['Value'])
    multiply=nodes.new('ShaderNodeMixRGB'); multiply.name='Broad hue-preserving sculpt shade'
    multiply.blend_type='MULTIPLY'; multiply.inputs[0].default_value=.76
    links.new(source,multiply.inputs[1]); links.new(ramp.outputs[0],multiply.inputs[2])
    links.new(multiply.outputs[0],bs.inputs['Base Color'])
    material['FD_SculptShading']=True


def ell(c, name, loc, scale, material, taper=0, angle=0):
    ob = c.ell(name, loc, scale, material)
    if taper:
        for vertex in ob.data.vertices:
            vertex.co.x *= 1 - taper * max(0, vertex.co.y)
    ob.rotation_euler.z = angle
    return ob


def loft(c, name, sections, material, sides=32):
    """Continuous shoulder/waist anatomy from authored cross sections along Y."""
    vertices, faces = [], []
    for y, width, center_z, height in sections:
        for j in range(sides):
            angle = math.tau * j / sides
            vertices.append((width * math.cos(angle), y, center_z + height * math.sin(angle)))
    for i in range(len(sections) - 1):
        for j in range(sides):
            k = i * sides + j
            faces.append((k, i*sides + (j+1)%sides, (i+1)*sides + (j+1)%sides, k+sides))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple((len(sections)-1)*sides+j for j in range(sides)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh)
    c.scene.collection.objects.link(ob)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    sub = ob.modifiers.new('Sculpted continuous anatomy', 'SUBSURF')
    sub.levels = sub.render_levels = 2
    return ob


def plate(c, name, outline, z, rise, material, edge_material=None):
    """A beveled, crowned irregular plate with authored broad facets."""
    count = len(outline)
    cx, cy = sum(p[0] for p in outline)/count, sum(p[1] for p in outline)/count
    vertices = [(x, y, z) for x, y in outline]
    vertices += [(cx+(x-cx)*.945, cy+(y-cy)*.945, z+rise*.50) for x, y in outline]
    vertices += [(cx+(x-cx)*.46, cy+(y-cy)*.46, z+rise) for x, y in outline]
    faces = [tuple(range(count-1, -1, -1))]
    for ring in range(2):
        for i in range(count):
            faces.append((ring*count+i, ring*count+(i+1)%count, (ring+1)*count+(i+1)%count, (ring+1)*count+i))
    faces.append(tuple(2*count+i for i in range(count)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    mesh.materials.append(material)
    if edge_material:
        mesh.materials.append(edge_material)
        for face in mesh.polygons[1:count+1]:
            face.material_index = 1
    ob = bpy.data.objects.new(name, mesh)
    c.scene.collection.objects.link(ob)
    bevel = ob.modifiers.new('Soft plate arris', 'BEVEL')
    bevel.width, bevel.segments = .014, 2
    ob.modifiers.new('Plate face normals', 'WEIGHTED_NORMAL')
    return ob


def ribbon(c, name, points, widths, material):
    """Broad surface marking that follows authored surface height, not a floating oval."""
    points,widths=smooth_path(points,widths)
    vertices = []
    for i, point in enumerate(points):
        before, after = Vector(points[max(0,i-1)]), Vector(points[min(len(points)-1,i+1)])
        direction = after - before
        normal = Vector((-direction.y, direction.x, 0)).normalized()
        center = Vector(point)
        for side in (-1, 1):
            vertices.append(tuple(center + normal * widths[i] * side / 2))
    faces = [(i*2, i*2+2, i*2+3, i*2+1) for i in range(len(points)-1)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh)
    c.scene.collection.objects.link(ob)
    solid = ob.modifiers.new('Thin surface marking', 'SOLIDIFY')
    solid.thickness = .012
    return ob


def horn(c, name, points, radii, material, sides=12):
    points,radii=smooth_path(points,radii)
    vertices, faces = [], []
    for i, point in enumerate(points):
        direction = Vector(points[min(i+1,len(points)-1)]) - Vector(points[max(0,i-1)])
        rotation = direction.to_track_quat('Z', 'Y')
        for j in range(sides):
            a = math.tau*j/sides
            p = Vector(point) + rotation @ Vector((radii[i]*math.cos(a), radii[i]*math.sin(a),0))
            vertices.append(tuple(p))
    for i in range(len(points)-1):
        for j in range(sides):
            faces.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
    faces.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+j for j in range(sides))])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh)
    c.scene.collection.objects.link(ob)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return ob


def ring(c, name, loc, radius, tube, material, scale=(1,1,1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=tube,
                                   major_segments=40, minor_segments=10, location=loc)
    ob = bpy.context.object
    ob.name, ob.scale = name, scale
    ob.data.materials.append(material)
    for polygon in ob.data.polygons:
        polygon.use_smooth = True
    return ob


def paw(c, name, x, y, coat, dark, claw, width=.19, length=.27, toe_length=.12, toes=3):
    upper = ell(c, name+' tapered foreleg', (x*.83,y-.09,.29), (width*1.05,length,.23), coat,
                taper=.20, angle=-math.copysign(.14,x))
    foot = ell(c, name+' broad articulated paw', (x,y,.17), (width,length*.78,.12), dark, taper=.08)
    objects = [upper, foot]
    for j in range(toes):
        dx = (j-(toes-1)/2)*width*.57
        objects.append(horn(c, name+' ivory claw', [(x+dx,y+length*.44,.21),
                            (x+dx,y+length*.78,.17),(x+dx,y+length*.78+toe_length,.115)],
                            [width*.17,width*.12,.005],claw))
    return ((x*.74,y-.16,.35),objects)


def head(c, pale, dark, coat, eye, y=.57, z=.87, width=.30, length=.43, ears=True):
    """Species identity: tapered skull, curved masks, recessed small eyes and muzzle."""
    result = [ell(c,'Tapered badger skull',(0,y,z),(width,length,.235),pale,taper=.36)]
    def surface(x,dy):
        local_y=dy/length
        local_x=x/(width*(1-.36*max(0,local_y)))
        return z+.235*math.sqrt(max(0,1-local_x*local_x-local_y*local_y))+.012
    for side in (-1,1):
        result.append(ell(c,'Cheek fur',(side*width*.72,y-.13,z-.06),(width*.45,length*.63,.17),coat,taper=.35))
        marks=[(side*width*.66,-.25),(side*width*.62,-.06),(side*width*.44,.16),(side*width*.23,.34)]
        mask=ribbon(c,'Curved facial mask',[(x,y+dy,surface(x,dy)) for x,dy in marks],
                    [width*.33,width*.35,width*.26,width*.12],dark)
        # A strip with only two vertices across its width forms a chord through
        # the convex skull. Subdivide the actual faces before projecting every
        # vertex so the marking stays above the skull between both edges too.
        bm=bmesh.new()
        bm.from_mesh(mask.data)
        bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=4,use_grid_fill=True)
        bm.to_mesh(mask.data)
        bm.free()
        for vertex in mask.data.vertices:
            vertex.co.z=surface(vertex.co.x,vertex.co.y-y)
        result.append(mask)
        eye_x=side*width*.50; eye_z=surface(eye_x,.135)
        result.append(ell(c,'Inset eye surround',(eye_x,y+.135,eye_z),(.044,.036,.017),dark))
        result.append(ell(c,'Focused small eye',(eye_x,y+.146,eye_z+.014),(.025,.019,.011),eye))
        if ears:
            result.append(ell(c,'Backward swept ear',(side*width*.89,y-.29,z+.015),(.113,.145,.071),dark,taper=-.2,angle=side*.23))
            result.append(ell(c,'Quiet inner ear',(side*width*.9,y-.28,z+.067),(.055,.080,.018),coat,angle=side*.23))
    result.append(ell(c,'North muzzle',(0,y+length*.75,z-.055),(width*.47,.15,.105),pale,taper=.30))
    result.append(ell(c,'Matte nose',(0,y+length*.95,z-.015),(.092,.077,.058),dark,taper=.22))
    return result


def finish(c, body_parts, head_parts, limbs, tail_parts=None):
    materials={material for ob in c.scene.objects if ob.type=='MESH' for material in ob.data.materials}
    for material in materials:
        sculpt_shading(material)
    asset = model(c.scene)
    body = control(c.scene,'Body weight transfer',parent=asset['root'])
    attach(body_parts,body)
    head_control = control(c.scene,'Counter-moving head',parent=body)
    attach(head_parts,head_control)
    asset['parts'].update(body=body,head=head_control)
    if tail_parts:
        tail = control(c.scene,'Tail counterbalance',parent=body)
        attach(tail_parts,tail)
        asset['parts']['tail'] = tail
    limb_rig(c.scene,asset,limbs)
    # Distal paws retain rigid authored articulation. Proximal flesh blends back
    # into the fixed root instead of translating clear of its shoulder at reach.
    bpy.context.view_layer.update()
    for name,(joint,objects) in limbs.items():
        upper,foot=objects[:2]
        origin=Vector(joint)
        reach=foot.matrix_world.translation-origin
        reach_length=reach.length_squared
        root_weights=upper.vertex_groups.new(name='root')
        limb_weights=upper.vertex_groups[name]
        for vertex in upper.data.vertices:
            p=upper.matrix_world @ vertex.co
            factor=max(0,min(1,(p-origin).dot(reach)/reach_length))
            factor=factor*factor*(3-2*factor)
            limb_weights.add([vertex.index],factor,'REPLACE')
            root_weights.add([vertex.index],1-factor,'REPLACE')
    return asset
