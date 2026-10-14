"""The accepted delivery crate, gently tilted in top view with a loose carry sling."""
import math
from dawn_parts import root,finish,supply_palette,supply_crate,material_factory,annulus


def build(c,spec):
    pivot=root(c);p=supply_palette(c,spec);material=material_factory(c,spec)
    strap=material('Dirty woven carry sling',(112,102,77),.3)
    crate=supply_crate(c,(0,0,0),1,0,p)
    # Broad band across the far side leaves the familiar inset handle unobscured.
    points=[(-.39,.15,.31),(-.43,.30,.52),(-.32,.48,.64),(0,.53,.68),(.32,.46,.60),(.43,.28,.48),(.39,.12,.30)]
    import bpy
    vertices=[]
    for x,y,z in points:vertices.extend([(x,y-.050,z),(x,y+.050,z)])
    faces=[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(points)-1)]
    mesh=bpy.data.meshes.new('Woven flat carry strap');mesh.from_pydata(vertices,[],faces);mesh.materials.append(strap);mesh.update()
    ob=bpy.data.objects.new('Loose shoulder sling',mesh);c.scene.collection.objects.link(ob);ob.parent=crate
    ob.modifiers.new('Heavy woven strap thickness','SOLIDIFY').thickness=.016
    bevel=ob.modifiers.new('Soft worn strap edges','BEVEL');bevel.width=.008;bevel.segments=2
    for face in mesh.polygons:face.use_smooth=True
    for side in (-1,1):
        buckle=annulus(c,'Sling brass attachment',(side*.39,.16,.47),.054,.028,.03,p['brass'],steps=16);buckle.parent=crate
    crate.rotation_euler=(math.radians(6),math.radians(-4),math.radians(17))
    crate.location.y=-.04
    crate.parent=pivot
    return finish(c,pivot)
