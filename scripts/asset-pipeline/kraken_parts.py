"""Organic Kraken surfaces and facial anatomy, authored in actual model space."""
import math
import bpy
import bmesh
from mathutils import Vector, noise
from recipes_v2.enemy_parts_a import horn, loft, smooth_path, outward_normals
from eye_anchors import register_eye


def skin_material(c, name, color, softness=1):
    material = c.material(name, color, 'organic')
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bs = nodes.get('Principled BSDF')
    source = bs.inputs['Base Color'].links[0].from_socket
    def node(kind, label):
        out = nodes.new(kind); out.name = out.label = label
        return out
    def connect(value, socket):
        if isinstance(value, (float, int, tuple)): socket.default_value = value
        else: links.new(value, socket)
    def mix(a, b, factor=1, mode='MULTIPLY', label='Organic color layer'):
        out = node('ShaderNodeMixRGB', label); out.blend_type = mode
        connect(factor, out.inputs[0]); connect(a, out.inputs[1]); connect(b, out.inputs[2])
        return out.outputs[0]
    def ramp(source, entries, label):
        out = node('ShaderNodeValToRGB', label); out.color_ramp.interpolation = 'EASE'
        for i, (pos, color) in enumerate(entries):
            e = out.color_ramp.elements[i] if i < 2 else out.color_ramp.elements.new(pos)
            e.position = pos
            e.color = (color, color, color, 1) if isinstance(color, (int, float)) else (*color, 1)
        links.new(source, out.inputs[0])
        return out.outputs[0]
    coord = node('ShaderNodeTexCoord', 'Rest-local skin coordinates')
    def grain(scale, stretch, label, detail=3):
        vector = node('ShaderNodeVectorMath', label+' direction'); vector.operation = 'MULTIPLY'
        links.new(coord.outputs['Generated'], vector.inputs[0]); vector.inputs[1].default_value = stretch
        out = node('ShaderNodeTexNoise', label)
        out.inputs['Scale'].default_value = scale; out.inputs['Detail'].default_value = detail
        out.inputs['Roughness'].default_value = .72
        links.new(vector.outputs[0], out.inputs['Vector'])
        return out.outputs['Fac']
    # Preserve the actual authored dermis pixels; the generic fur remap clips
    # this dark-purple albedo before its fine wrinkles can reach the shader.
    dermis=node('ShaderNodeTexImage','Original authored cephalopod dermis')
    dermis.image=c.images['organic']; dermis.extension='REPEAT'
    dermis.projection='BOX'; dermis.projection_blend=.28
    dermal_scale=node('ShaderNodeVectorMath','Broad dermal folds at creature scale'); dermal_scale.operation='SCALE'
    links.new(coord.outputs['Generated'],dermal_scale.inputs[0]); dermal_scale.inputs['Scale'].default_value=.54
    links.new(dermal_scale.outputs[0],dermis.inputs['Vector'])
    grey=node('ShaderNodeRGBToBW','Dermal pigment values'); links.new(dermis.outputs['Color'],grey.inputs[0])
    albedo=ramp(grey.outputs[0],[(.014,.17),(.038,.40),(.076,1.03),(.14,1.75),(.25,2.10)],'Resolved wrinkles and raised papillae')
    detailed=node('ShaderNodeMixRGB','Authored dermis strength'); detailed.blend_type='MULTIPLY'
    detailed.inputs[1].default_value=(*color,1); links.new(albedo,detailed.inputs[2]); c.strengths.append(detailed.inputs[0])
    source=detailed.outputs[0]
    patches = grain(6, (1.2, 1, 1.1), 'Deep irregular chromatophore patches', 4)
    pigments = ramp(patches, [(.20, (.12,.16,.25)),(.40,(.34,.29,.43)),(.57,(.91,.68,.82)),(.72,(1.35,1.12,1.15)),(.88,(.51,.37,.52))], 'Aubergine bruising and desaturated lilac crowns')
    source = mix(source, pigments, .26)
    cells = node('ShaderNodeTexVoronoi', 'Raised irregular dermal papillae')
    cells.inputs['Scale'].default_value = 78
    links.new(coord.outputs['Generated'], cells.inputs['Vector'])
    freckles = ramp(cells.outputs['Distance'], [(0,.24),(.12,.35),(.25,.77),(.43,1.10),(.7,1)], 'Small ink-dark pigment pores')
    source = mix(source, freckles, .10)
    fibres = grain(36, (2,.18,1), 'Longitudinal muscular skin folds', 3)
    creases = ramp(fibres, [(.25,.32),(.4,.6),(.56,1.05),(.72,1.12)], 'Broken folds in stretched flesh')
    source = mix(source, creases, .24)
    geom = node('ShaderNodeNewGeometry', 'Real sculpted surface')
    facing = node('ShaderNodeVectorMath', 'Broad directional muscle volume'); facing.operation='DOT_PRODUCT'
    links.new(geom.outputs['Normal'], facing.inputs[0]); facing.inputs[1].default_value=(-.48,.40,.78)
    values = ramp(facing.outputs['Value'], [(0,.10),(.34,.26),(.62,.61),(.84,1.27),(.96,2.65),(1,2.85)], 'Deep cool flanks and lit organic ridge edges')
    painted = node('ShaderNodeVertexColor','Authored dorsal depth'); painted.layer_name='FD_FormMask'
    values = mix(values, painted.outputs['Color'], .32)
    shaded = mix(source, values)
    ao = node('ShaderNodeAmbientOcclusion', 'Contact depth under lids and folds')
    ao.inputs['Distance'].default_value=.23; ao.samples=16
    cavity = ramp(ao.outputs['AO'], [(0,.08),(.35,.24),(.75,.72),(1,1)], 'Organic cavity shadows')
    shaded = mix(shaded, cavity, .8)
    strength = node('ShaderNodeMixRGB', 'Form shadow strength')
    links.new(source,strength.inputs[1]); links.new(shaded,strength.inputs[2])
    c.form_strengths.append(strength.inputs[0]); links.new(strength.outputs[0],bs.inputs['Base Color'])
    bumps = node('ShaderNodeBump','Fleshy folds with actual normal relief')
    bumps.inputs['Strength'].default_value=.52*softness; bumps.inputs['Distance'].default_value=.045
    # The albedo is very dark. Normalize its relief range so the authored folds
    # produce actual normals instead of becoming imperceptible surface noise.
    relief=ramp(grey.outputs[0],[(.015,0),(.06,.34),(.15,1)],'Normalized sculpted wrinkle height')
    links.new(relief,bumps.inputs['Height'])
    pores = node('ShaderNodeBump','Fine pebbled skin relief')
    pores.inputs['Strength'].default_value=.18*softness; pores.inputs['Distance'].default_value=.008
    links.new(cells.outputs['Distance'],pores.inputs['Height']); links.new(bumps.outputs[0],pores.inputs['Normal'])
    links.new(pores.outputs[0],bs.inputs['Normal'])
    broad_normal=mix(geom.outputs['Normal'],pores.outputs[0],.20,'MIX','Sculpt form with restrained wrinkle lighting')
    unit_normal=node('ShaderNodeVectorMath','Normalized organic form'); unit_normal.operation='NORMALIZE'
    links.new(broad_normal,unit_normal.inputs[0]); links.new(unit_normal.outputs[0],facing.inputs[0])
    rough = ramp(patches, [(0,.29),(1,.57)], 'Broken moist highlights over muscular skin')
    links.new(rough,bs.inputs['Roughness'])
    bs.inputs['Specular IOR Level'].default_value=.43
    material['FD_SurfaceKind']='kraken-dermis'
    return material


def fuse_mantle(c, parts, material):
    """Unite the authored tissue volumes into one continuous, softened skin."""
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts: part.select_set(True)
    skin=parts[0]; bpy.context.view_layer.objects.active=skin
    bpy.ops.object.join()
    skin.name='Continuous mantle with grown dorsal ridges and lateral fins'
    union=skin.modifiers.new('Fuse overlapping organic tissue','REMESH')
    union.mode='VOXEL'; union.voxel_size=.018; union.adaptivity=0
    union.use_smooth_shade=True
    bpy.ops.object.modifier_apply(modifier=union.name)
    # Very sharp fin tips can leave isolated single-voxel remnants. Remove only
    # sub-cell dust; a detached anatomical volume is an authoring error.
    bm=bmesh.new(); bm.from_mesh(skin.data)
    pending=set(bm.verts); islands=[]
    while pending:
        stack=[pending.pop()]; group=[]
        while stack:
            vertex=stack.pop(); group.append(vertex)
            for edge in vertex.link_edges:
                other=edge.other_vert(vertex)
                if other in pending: pending.remove(other); stack.append(other)
        islands.append(group)
    for group in sorted(islands,key=len,reverse=True)[1:]:
        extent=max(max(v.co[i] for v in group)-min(v.co[i] for v in group) for i in range(3))
        if len(group)>32 or extent>.04: raise ValueError('Detached mantle tissue after fusion')
        bmesh.ops.delete(bm,geom=group,context='VERTS')
    bm.to_mesh(skin.data); bm.free()
    # Fair the broad attachment zones, retaining the precise facial sockets.
    blend=skin.vertex_groups.new(name='Mantle attachment transitions')
    for v in skin.data.vertices:
        weight=max(0,min(1,(.24-v.co.y)/.40))
        if weight: blend.add([v.index],weight,'REPLACE')
    smooth=skin.modifiers.new('Soft tissue transitions','SMOOTH')
    smooth.vertex_group=blend.name; smooth.factor=1; smooth.iterations=4
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    skin.data.materials.clear(); skin.data.materials.append(material)
    for polygon in skin.data.polygons:
        polygon.material_index=0; polygon.use_smooth=True
    skin['anatomyRole']='mantle'
    return skin


def mantle(c, material):
    sections=[(-1.80,.02,.48,.035),(-1.55,.31,.55,.22),(-1.18,.59,.61,.39),
              (-.68,.77,.63,.53),(-.10,.84,.65,.57),(.35,.69,.61,.48),
              (.68,.50,.55,.35),(.99,.32,.44,.25),(1.18,.035,.38,.035)]
    points, heights=smooth_path([(w,y,z) for y,w,z,h in sections],[h for y,w,z,h in sections],steps=9)
    def section(y):
        for i in range(len(points)-1):
            if points[i][1]<=y<=points[i+1][1]:
                t=(y-points[i][1])/(points[i+1][1]-points[i][1])
                a,b=points[i],points[i+1]
                return a[0]*(1-t)+b[0]*t,a[2]*(1-t)+b[2]*t,heights[i]*(1-t)+heights[i+1]*t
        return .03,.45,.04
    def relief(x,y):
        folds=.015*math.sin(y*24+abs(x)*13)+.018*noise.noise(Vector((x*10,y*10,2)))
        crown=.028*math.exp(-(x/.18)**2)*math.sin((y+1.8)*2.3)**2
        dents=0
        for side in (-1,1):
            for cx,cy,length,width,depth in [(.39,.50,.26,.13,.10),(.58,.09,.19,.10,.07)]:
                angle=-side*.55
                dx,dy=x-side*cx,y-cy
                u=dx*math.cos(angle)+dy*math.sin(angle)
                v=-dx*math.sin(angle)+dy*math.cos(angle)
                dents+=depth*math.exp(-((u/length)**2+(v/width)**2)*1.6)
        return folds+crown-dents
    def surface(x,y):
        w,z,h=section(y)
        crown=math.sqrt(max(0,1-(x/w)**2))
        return z+(h+relief(x,y))*crown
    vertices=[]; faces=[]; sides=64
    for (w,y,z),h in zip(points,heights):
        for j in range(sides):
            a=math.tau*j/sides; x=w*math.cos(a)
            vertices.append((x,y,z+h*math.sin(a)+relief(x,y)*max(0,math.sin(a))))
    for i in range(len(points)-1):
        for j in range(sides): faces.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
    faces.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+j for j in range(sides))])
    mesh=bpy.data.meshes.new('Continuous folded organic mantle'); mesh.from_pydata(vertices,[],faces)
    outward_normals(mesh); mesh.materials.append(material)
    for p in mesh.polygons: p.use_smooth=True
    ob=bpy.data.objects.new(mesh.name,mesh); c.scene.collection.objects.link(ob)
    return ob,surface


def face(c, surface, hide, ridge, lip, dark, beak):
    objects=[]
    iris_mat=c.material('Luminous peach-rose iris fibres',(.86,.24,.32),emission=.28)
    nodes,links=iris_mat.node_tree.nodes,iris_mat.node_tree.links
    bs=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=27; tex.inputs['Detail'].default_value=3
    coords=nodes.new('ShaderNodeTexCoord'); links.new(coords.outputs['Generated'],tex.inputs['Vector'])
    tones=nodes.new('ShaderNodeValToRGB')
    tones.color_ramp.elements[0].color=(.31,.021,.11,1)
    tones.color_ramp.elements[1].color=(1,.49,.46,1)
    links.new(tex.outputs['Fac'],tones.inputs[0]); links.new(tones.outputs[0],bs.inputs['Base Color'])
    eyeball=c.material('Deep burgundy eye surface',(.017,.003,.027))
    pupil=c.material('Abyssal vertical pupil',(.002,.0008,.007))
    def mesh_part(name,vertices,faces,materials,slots=None):
        mesh=bpy.data.meshes.new(name); mesh.from_pydata(vertices,[],faces)
        outward_normals(mesh)
        for mat in materials: mesh.materials.append(mat)
        for polygon in mesh.polygons:
            polygon.use_smooth=True
            if slots: polygon.material_index=slots[polygon.index]
        ob=bpy.data.objects.new(name,mesh); c.scene.collection.objects.link(ob)
        objects.append(ob)
        return ob
    def rings_faces(count,segments):
        return [(k*segments+j,(k+1)*segments+j,(k+1)*segments+(j+1)%segments,k*segments+(j+1)%segments)
                for k in range(count-1) for j in range(segments)]
    for side in (-1,1):
        for eye_index,(x,y,length,width) in enumerate([(.39,.50,.193,.084),(.58,.09,.137,.058)]):
            angle=-side*.55
            def xy(u,v):
                return side*x+u*math.cos(angle)-v*math.sin(angle),y+u*math.sin(angle)+v*math.cos(angle)
            def patch(name,ru,rv,mat,offset=0,lift=.025,bulge=.012,forward=0,world_aligned=False):
                vertices=[]; segments=48
                for r in (.006,.22,.45,.70,1):
                    for j in range(segments):
                        a=math.tau*j/segments
                        u=ru*r*math.cos(a)
                        v=rv*r*math.sin(a)*abs(math.sin(a))**.25
                        if world_aligned:
                            cx,cy=xy(offset,0)
                            px,py=cx+u,cy+v+forward
                        else:
                            px,py=xy(offset+u,v)
                        vertices.append((px,py,surface(px,py)+lift+bulge*(1-r*r)))
                return mesh_part(name,vertices,rings_faces(5,segments),(mat,))
            # A curved eye membrane sits inside a depression in the actual skull.
            # It has no separate black oval surrounding the opening.
            patch('Curved orbital membrane',length,width,eyeball,lift=.028)
            # All four eyes look toward +Y, the mouth and attack direction.
            # Iris and slit axes share that direction instead of inheriting
            # the mirrored slant of their surrounding orbital openings.
            iris=patch('Forward-looking rose iris',width*.87,width*.88,iris_mat,
                       lift=.043,bulge=.025,forward=width*.37,world_aligned=True)
            if eye_index==0: register_eye(c,side,iris)
            patch('Forward-aligned predatory pupil',width*.13,width*.66,pupil,
                  lift=.073,bulge=.004,forward=width*.37,world_aligned=True)
            # One continuous soft orbital fold tapers from the aperture into the
            # underlying skull. Upper and lower halves have unequal fleshy volume.
            vertices=[]; segments=80
            profiles=[(1,.072),(1.14,.151),(1.36,.107),(1.64,.034),(1.90,-.004)]
            for radius,rise in profiles:
                for j in range(segments):
                    a=math.tau*j/segments; upper=max(0,math.sin(a))
                    irregular=1+.035*math.sin(3*a+side*.5)*((radius-1)/.9)
                    u=length*radius*math.cos(a)*irregular
                    closure=max(0,1-(radius-1)/.9)
                    cover=.52*upper+.12*max(0,-math.sin(a))
                    v=width*radius*math.sin(a)*abs(math.sin(a))**.32*irregular*(1-cover*closure)
                    px,py=xy(u,v)
                    z=surface(px,py)+rise*(.55+.70*upper)
                    vertices.append((px,py,z))
            slots=[1 if k==0 else 0 for k in range(4) for j in range(segments)]
            mesh_part('Continuous fleshy orbital fold',vertices,rings_faces(5,segments),(ridge,lip),slots)
            for fold in range(2):
                uv=[(side*length*.80,-width*.75-fold*.032),
                    (side*length*1.18,-width*1.06-fold*.04),
                    (side*length*1.45,-width*1.20-fold*.04)]
                pts=[]
                for u,v in uv:
                    px,py=xy(u,v); pts.append((px,py,surface(px,py)+.004))
                objects.append(horn(c,'Fine radiating orbital crease',pts,[.001,.009,.001],hide,sides=10))
    # Entirely new mouth: paired muscular hoods meet over a narrow curved cleft.
    # The beak is a small forward hook beneath the tissue, not a dorsal black disk.
    seam=skin_material(c,'Muted plum oral cleft',(.063,.017,.044),.25)
    for side in (-1,1):
        points=[(side*.28,.72,.66),(side*.19,.88,.79),(side*.12,1.06,.70),(side*.045,1.23,.53)]
        objects.append(horn(c,'Tapered muscular oral hood',points,[.055,.118,.095,.012],hide,sides=24))
        objects.append(horn(c,'Narrow curved mouth cleft',[(side*.22,1.02,.64),(side*.12,1.10,.655),(0,1.17,.575)], [.006,.017,.002],seam,sides=12))
        objects.append(horn(c,'Soft overlapping inner mouth fold',[(side*.24,.98,.65),(side*.19,1.12,.60),(side*.06,1.25,.49)], [.019,.044,.003],lip,sides=16))
    objects.append(loft(c,'Small hooked beak beneath oral hood',[(1.09,.055,.58,.025),(1.16,.068,.56,.046),(1.24,.038,.505,.036),(1.30,.004,.44,.008)],beak))
    for side in (-1,1):
        # Six independently curling short arms grow directly out of the oral hood.
        for j in range(3):
            shift=.045*math.sin(j*2+side)
            points=[(side*(.18+j*.090),.73-j*.035,.64),
                    (side*(.26+j*.15),1.05+j*.042,.72-j*.052),
                    (side*(.33+j*.18),1.37+j*.055+shift,.59-j*.055),
                    (side*(.19+j*.19),1.61-j*.032+shift,.52+j*.017),
                    (side*(.095+j*.19),1.47-j*.075+shift,.56+j*.025)]
            objects.append(horn(c,'Curled prehensile oral tentacle',points,[.13-j*.019,.105-j*.015,.062-j*.009,.028,.0025],hide,sides=20))
            objects.append(horn(c,'Oral tentacle dorsal tendon',[(x,y,z+r*.7) for (x,y,z),r in zip(points,[.13-j*.019,.105-j*.015,.062-j*.009,.028,.0025])],[.021,.017,.011,.005,.001],ridge,sides=10))
    return objects
