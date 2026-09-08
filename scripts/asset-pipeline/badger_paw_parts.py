"""Compact north-facing paws with short claws, bound as one rigid leg group."""
import math
import bpy


def clawed_paw(ctx, side, fur):
    paw = ctx.ell('Compact fur paw', (side*.21, -.03, .12), (.135, .178, .102), fur)
    # Softly scallop the front into three toe groups, not a flat shoe toe.
    for vertex in paw.data.vertices:
        x, y, z = vertex.co
        if y > 0:
            vertex.co.y *= 1 + .045*math.cos(x*math.pi*3)
    paw['pawPart'] = 'fur'
    horn = ctx.material('Matte muted horn claws', (.24, .25, .235))
    bs = horn.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Roughness'].default_value = 1
    bs.inputs['Specular IOR Level'].default_value = 0
    result = [paw]
    for toe in (-1, 0, 1):
        # At rest all tips stay south of the previous .19 northward foot bound.
        start_y = .102 if toe == 0 else .088
        length = .078 if toe == 0 else .071
        vertices, faces = [], []
        for ring in range(9):
            t = ring/8
            width = .021*(1-t)**.8 + .0015
            for j in range(12):
                angle = math.tau*j/12
                vertices.append((width*math.cos(angle), start_y+length*t,
                                 .16-.018*t+.016*(1-t)*math.sin(angle)))
        for ring in range(8):
            for j in range(12):
                a=ring*12+j; b=ring*12+(j+1)%12
                faces.append((a,b,b+12,a+12))
        faces.extend([tuple(reversed(range(12))), tuple(8*12+j for j in range(12))])
        mesh=bpy.data.meshes.new('Tapered claw'); mesh.from_pydata(vertices,[],faces); mesh.update()
        claw=bpy.data.objects.new('Short north claw',mesh); ctx.scene.collection.objects.link(claw)
        # Centers are scaled by the legacy stance pass, like the paw itself.
        claw.location.x=side*.21+toe*.048
        mesh.materials.append(horn)
        for polygon in mesh.polygons: polygon.use_smooth=True
        claw['pawPart']='claw'
        result.append(claw)
    return result
