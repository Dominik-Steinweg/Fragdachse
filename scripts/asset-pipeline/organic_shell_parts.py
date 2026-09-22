"""Smooth crowned shells with authored outlines and unchanged attachment coordinates."""
import math
import bpy
import bmesh


def shell(c, name, outline, floor, rise, material, edge_material=None):
    # Two corner-cutting passes turn planar polygon silhouettes into organic arcs.
    outline = list(outline)
    if sum(outline[i][0]*outline[(i+1)%len(outline)][1]-outline[(i+1)%len(outline)][0]*outline[i][1] for i in range(len(outline))) < 0:
        outline.reverse()
    for _ in range(2):
        rounded=[]
        for i,a in enumerate(outline):
            b=outline[(i+1)%len(outline)]
            rounded.extend([(a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25),
                            (a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75)])
        outline=rounded
    cx=sum(p[0] for p in outline)/len(outline); cy=sum(p[1] for p in outline)/len(outline)
    rings=[(1,0),(.995,.18),(.965,.43),(.92,.66),(.86,.83),(.78,.94),(.64,.985),(.43,1),(.16,1.012)]
    vertices=[(cx+(x-cx)*r,cy+(y-cy)*r,floor+rise*h) for r,h in rings for x,y in outline]
    n=len(outline); faces=[tuple(reversed(range(n)))]
    for k in range(len(rings)-1):
        for j in range(n): faces.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
    vertices.append((cx,cy,floor+rise*1.015))
    for j in range(n): faces.append(((len(rings)-1)*n+j,(len(rings)-1)*n+(j+1)%n,len(vertices)-1))
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(vertices,[],faces)
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    mesh.materials.append(material)
    if edge_material:
        mesh.materials.append(edge_material)
        for p in list(mesh.polygons)[1:n+1]: p.material_index=1
    for p in mesh.polygons: p.use_smooth=True
    ob=bpy.data.objects.new(name,mesh);c.scene.collection.objects.link(ob)
    return ob


def centered_shell(c,name,center,outline,thickness,material,bevel=.025):
    x,y,z=center
    return shell(c,name,[(x+a,y+b) for a,b in outline],z-thickness*.5,thickness,material)
