"""Authored mesh details for the second enemy family; gameplay identity stays in each recipe."""
import math
import bpy
from mathutils import Vector
from rigs_v2 import model, control, attach, limb_rig


def plate(c, name, center, outline, thickness, material, bevel=.025):
    """A bevelled silhouette, not a rectangular proxy; outline is local XY."""
    x, y, z = center
    n = len(outline)
    if sum(outline[i][0]*outline[(i+1)%n][1]-outline[(i+1)%n][0]*outline[i][1] for i in range(n)) < 0:
        outline=list(reversed(outline))
    vertices = [(x + px, y + py, z + height) for height in (-thickness / 2, thickness / 2)
                for px, py in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mesh = bpy.data.meshes.new(name + ' mesh')
    mesh.from_pydata(vertices, [], faces); mesh.update()
    ob = bpy.data.objects.new(name, mesh); c.scene.collection.objects.link(ob)
    mesh.materials.append(material)
    if bevel:
        edge = ob.modifiers.new('Soft armor edge', 'BEVEL')
        edge.width, edge.segments = bevel, 3
        ob.modifiers.new('Broad face normals', 'WEIGHTED_NORMAL')
    return ob


def scute(c, name, center, width, length, material, thickness=.09):
    return plate(c, name, center, [(0, length*.54), (width*.43, length*.23),
        (width*.5, -length*.22), (width*.26, -length*.46), (0, -length*.57),
        (-width*.26, -length*.46), (-width*.5, -length*.22), (-width*.43, length*.23)],
        thickness, material, min(.035, thickness*.28))


def tube(c, name, points, radius, material, sides=8):
    """Small authored seams/hoses as evaluated meshes, so clipping checks include them."""
    points = [Vector(p) for p in points]
    vertices = []
    for i, point in enumerate(points):
        tangent = (points[min(i+1, len(points)-1)] - points[max(0, i-1)]).normalized()
        axis = Vector((0, 0, 1)) if abs(tangent.z) < .9 else Vector((0, 1, 0))
        normal = tangent.cross(axis).normalized(); binormal = tangent.cross(normal).normalized()
        for j in range(sides):
            a = math.tau*j/sides
            vertices.append(tuple(point + radius*(math.cos(a)*normal + math.sin(a)*binormal)))
    faces = [tuple(reversed(range(sides))), tuple((len(points)-1)*sides+j for j in range(sides))]
    for i in range(len(points)-1):
        for j in range(sides):
            a=i*sides+j; b=i*sides+(j+1)%sides
            faces.append((a,b,b+sides,a+sides))
    mesh=bpy.data.meshes.new(name+' mesh'); mesh.from_pydata(vertices,[],faces); mesh.update()
    mesh.materials.append(material)
    ob=bpy.data.objects.new(name,mesh); c.scene.collection.objects.link(ob)
    for face in mesh.polygons: face.use_smooth=True
    return ob


def head(c, center, width, length, pale, dark, nose, eye=None, crest=None):
    """A long north-pointing skull with paired badger masks, not a round human face."""
    x,y,z=center; parts=[]
    skull=c.ell('Tapered badger skull',center,(width,length,.19),pale)
    for v in skull.data.vertices:
        v.co.x *= 1-.38*max(0,v.co.y)
    parts.append(skull)
    for side in (-1,1):
        mask=c.ell('Swept dark badger mask',(x+side*width*.54,y-.015,z+.15),
                   (width*.20,length*.71,.035),dark)
        mask.rotation_euler.z=-side*.17; parts.append(mask)
        parts.append(c.ell('Folded badger ear',(x+side*width*.88,y-length*.60,z+.055),
                           (width*.25,length*.23,.065),dark))
        if eye:
            parts.append(c.ell('Small recessed eye',(x+side*width*.42,y+length*.49,z+.163),
                               (width*.060,length*.052,.012),eye))
    parts.append(c.ell('North-pointing nose',(x,y+length*.90,z+.015),(width*.24,length*.16,.055),nose))
    if crest:
        parts.append(scute(c,'Protective forehead crest',(x,y-length*.37,z+.185),width*.5,length*.50,crest,.065))
    return parts


def paw(c, name, hip, foot, width, fur, dark, claw, armor=None):
    x,y,z=foot; hx,hy,hz=hip
    upper=c.ell(name+' upper leg',((hx+x)/2,(hy+y)/2,(hz+z)/2),
                (width*.9,abs(hy-y)*.45+.16,.19),fur)
    objects=[upper,c.ell(name+' broad paw',foot,(width,.235,.13),dark)]
    if armor:
        objects.append(scute(c,name+' ankle plate',(x,y-.035,z+.115),width*1.70,.31,armor,.065))
    for dx in (-.52,0,.52):
        objects.append(c.ell(name+' north claw',(x+dx*width,y+.205,z+.02),(.025,.08,.022),claw))
    return hip,objects


def finish(c, limbs, body_parts, head_parts=None, head_pivot=(0,.35,.75), extras=None):
    """Explicit group references are retained for subsequent authored motion controls."""
    asset=model(c.scene)
    body=control(c.scene,'Body weight and balance',parent=asset['root'])
    attach(body_parts,body); asset['parts']['body']=body
    if head_parts:
        skull=control(c.scene,'Head aim and balance',head_pivot,body)
        attach(head_parts,skull); asset['parts']['head']=skull
    for name,(pivot,objects) in (extras or {}).items():
        part=control(c.scene,name.replace('_',' ').title(),pivot,body)
        attach(objects,part); asset['parts'][name]=part
    limb_rig(c.scene,asset,limbs)
    # A stepping foot may translate, but its upper leg must remain joined to the hip.
    # paw() deliberately returns the proximal muscle first and the distal paw second.
    # Blend only that connecting muscle to the fixed root; toes/guards retain rigid motion.
    bpy.context.view_layer.update()
    for name,(hip,objects) in limbs.items():
        upper,foot=objects[:2]
        anchor=Vector(hip)
        axis=foot.matrix_world.translation-anchor
        denominator=max(axis.length_squared,1e-8)
        moving=upper.vertex_groups.get(name)
        fixed=upper.vertex_groups.get('root') or upper.vertex_groups.new(name='root')
        for vertex in upper.data.vertices:
            t=(upper.matrix_world@vertex.co-anchor).dot(axis)/denominator
            weight=max(0,min(1,(t-.12)/.76))
            weight=weight*weight*(3-2*weight)
            moving.add([vertex.index],weight,'REPLACE')
            fixed.add([vertex.index],1-weight,'REPLACE')
    return asset
