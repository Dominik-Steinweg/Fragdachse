"""Eight continuously skinned arms, recessed suckers and a sculpted abyssal mantle."""
import math
import random
import bpy
from mathutils import Vector, noise
from rigs_v2 import control, attach
from recipes_v2.enemy_parts_a import horn, smooth_path, outward_normals
from kraken_parts import skin_material, mantle, face, fuse_mantle


def arm(c, index, points, width, materials):
    """One mesh per arm includes its cup rims/wells; all share smooth chain weights."""
    centers, radii = smooth_path(points, [width*(1-i/(len(points)-1))**.59+.018 for i in range(len(points))], steps=16)
    vertices, faces, slots, weights = [], [], [], []
    sides = 48
    def vertex(p, t):
        vertices.append(tuple(p)); weights.append(t)
    def face(indices, slot):
        faces.append(indices); slots.append(slot)
    for i, point in enumerate(centers):
        tangent = (Vector(centers[min(i+1,len(centers)-1)])-Vector(centers[max(0,i-1)])).normalized()
        cross = Vector((-tangent.y,tangent.x,0)).normalized()
        normal = tangent.cross(cross).normalized()
        for j in range(sides):
            angle=math.tau*j/sides
            # Uneven longitudinal muscle bundles and interrupted dermal relief.
            # Ventral cross-section remains intact so resting cups stay occluded.
            top=max(0,math.sin(angle))
            relief=top*(.073*math.sin(angle*5+i*.11)+.065*noise.noise(Vector((i*.23,math.cos(angle)*3,math.sin(angle)*3+index))))
            radial=radii[i]*(1+relief)
            vertex(Vector(point)+radial*(math.cos(angle)*cross+math.sin(angle)*normal), i/(len(centers)-1))
    for i in range(len(centers)-1):
        for j in range(sides):
            face((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j),0)
    face(tuple(range(sides-1,-1,-1)),0)
    face(tuple((len(centers)-1)*sides+j for j in range(sides)),0)
    # Embedded fleshy papillae are part of this same weighted mesh. Their broad
    # skirt disappears into the arm, rather than looking like glued-on beads.
    rng=random.Random(400+index)
    for i in range(9,len(centers)-10,3):
        tangent=(Vector(centers[i+1])-Vector(centers[i-1])).normalized()
        cross=Vector((-tangent.y,tangent.x,0)).normalized()
        up=tangent.cross(cross).normalized()
        for row in (-1,1):
            if rng.random()<.20: continue
            angle=math.pi*.5+row*rng.uniform(.40,1.02)
            normal=math.cos(angle)*cross+math.sin(angle)*up
            across=tangent.cross(normal).normalized()
            radius=radii[i]
            center=Vector(centers[i])+normal*radius*.99
            r=radius*rng.uniform(.095,.21)
            start=len(vertices); segments=12; slot=1 if rng.random()<.28 else 0
            for scale,height in [(1.45,-.012),(1,.008),(.66,r*.58),(.05,r*.74)]:
                for j in range(segments):
                    a=math.tau*j/segments
                    p=center+normal*height+r*scale*(math.cos(a)*tangent*1.25+math.sin(a)*across)
                    # Longitudinal weights vary over the nodule as over its skin.
                    vertex(p,(i+math.cos(a)*r*scale/.06)/(len(centers)-1))
            for k in range(3):
                for j in range(segments):
                    face((start+k*segments+j,start+k*segments+(j+1)%segments,start+(k+1)*segments+(j+1)%segments,start+(k+1)*segments+j),slot)
            face(tuple(start+3*segments+j for j in range(segments)),slot)
    # Soft flanged funnels, with a dark recessed aperture rather than painted dots.
    for i in range(8,len(centers)-6,5):
        tangent=(Vector(centers[i+1])-Vector(centers[i-1])).normalized()
        cross=Vector((-tangent.y,tangent.x,0)).normalized()
        up=tangent.cross(cross).normalized()
        radius=radii[i]
        before=(Vector(centers[i])-Vector(centers[i-1])).normalized()
        after=(Vector(centers[i+1])-Vector(centers[i])).normalized()
        inner=1 if before.cross(after).z>0 else -1
        for row in (-1,1):
            # Suckers remain ventral. A few distal resting hooks roll enough to
            # reveal their edge; the dorsal arm skin itself has no cups.
            ventral=.68 if row==inner else .86
            normal=-up*ventral+cross*row*math.sqrt(1-ventral*ventral)
            across=tangent.cross(normal).normalized()
            center=Vector(centers[i])+normal*radius*.96
            r=radius*.37
            start=len(vertices); segments=18
            for scale,height in [(1.08,0),(1,.038),( .66,.054),(.46,.015),(.30,.009)]:
                for j in range(segments):
                    a=math.tau*j/segments
                    vertex(center+normal*height*(radius/.22)+r*scale*(math.cos(a)*tangent+math.sin(a)*across),i/(len(centers)-1))
            for k in range(4):
                for j in range(segments):
                    face((start+k*segments+j,start+k*segments+(j+1)%segments,start+(k+1)*segments+(j+1)%segments,start+(k+1)*segments+j),2 if k<2 else 3)
            face(tuple(start+4*segments+j for j in range(segments)),3)
    mesh=bpy.data.meshes.new(f'Tentacle {index+1} continuous skin and cups')
    mesh.from_pydata(vertices,[],faces); outward_normals(mesh)
    for material in materials: mesh.materials.append(material)
    for polygon,slot in zip(mesh.polygons,slots):
        polygon.material_index=slot; polygon.use_smooth=True
    ob=bpy.data.objects.new(mesh.name,mesh); c.scene.collection.objects.link(ob)
    ob['motionRole']='tentacle'; ob['tentacleIndex']=index
    c.paint_form_mask(ob,lambda p:.75+.25*max(0,min(1,p.z)))
    return ob,centers,weights


def build(c,spec):
    hide=skin_material(c,'Kraken abyssal chromatophore hide',(.37,.118,.405))
    ridge=skin_material(c,'Kraken aged raised dermal folds',(.44,.17,.44),.80)
    lip=skin_material(c,'Kraken bruised fleshy lids and oral tissue',(.36,.078,.22),.65)
    dark=c.material('Kraken lightless organic cavities',(.005,.0018,.012))
    beak=skin_material(c,'Kraken dark striated horn beak',(.072,.043,.076),.55)
    cups=skin_material(c,'Kraken rose ventral sucker lips',(.51,.22,.32),.50)
    well=c.material('Kraken recessed sucker wells',(.048,.010,.062),'organic')
    cups['ventralSuckerSurface']=True
    well['ventralSuckerSurface']=True
    root=control(c.scene,'Kraken fixed export pivot')
    body=control(c.scene,'Kraken breathing mantle',parent=root)
    emergence=control(c.scene,'Kraken surfacing control',parent=root)
    body.parent=emergence
    shell,surface=mantle(c,hide)
    head=[shell]
    # Irregular tissue follows the continuous surface, with broad muscular folds.
    def contour(name,xy,radii,material=hide,lift=0):
        core=[(x,y,surface(x,y)-r*.30+lift) for (x,y),r in zip(xy,radii)]
        skirt=[(x,y,surface(x,y)-r*1.25) for (x,y),r in zip(xy,radii)]
        head.append(horn(c,name,core,radii,material,sides=24))
        head.append(horn(c,name+' broad tissue root',skirt,[r*1.75 for r in radii],hide,sides=24))
    contour('Raised spear-shaped median mantle crest',[(0,-1.72),(-.025,-1.27),(.016,-.76),(-.018,-.22),(0,.31)], [.006,.115,.180,.125,.004],ridge,lift=.035)
    for side in (-1,1):
        for i,(y,w) in enumerate([(-1.35,.20),(-1.06,.34),(-.72,.48),(-.33,.54)]):
            y+=side*.035*math.sin(i*1.7)
            contour('Grown branching mantle fold',[(side*.11,y),(side*w*.65,y+.055),(side*w,y+.20),(side*(w+.035),y+.32)], [.004,.086,.074,.002],ridge,lift=.024)
        for y in (-1.03,-.66,-.28):
            head.append(horn(c,'Swept fleshy mantle fin',[(side*.40,y+.06,.65),(side*.65,y,.76),(side*.89,y-.13,.69),(side*1.01,y-.34,.48)], [.23,.21,.10,.002],hide,sides=32))
    # Sparse low papillae are embedded in the skin; clustering avoids a manufactured pattern.
    rng=random.Random(103)
    for i in range(104):
        y=rng.uniform(-1.46,.12); x=rng.uniform(-.66,.66)
        z=surface(x,y)
        if z<.85 or abs(x)<.09: continue
        radius=rng.uniform(.018,.046)
        ob=c.ell('Embedded dermal papilla',(x,y,z-.005),(radius,radius*rng.uniform(1.1,1.8),radius*.70),ridge if i%4==0 else hide)
        head.append(ob)
    head=[fuse_mantle(c,head,hide)]
    head.extend(face(c,surface,hide,ridge,lip,dark,beak))
    # Enlarge the entire crown consistently, including sockets and oral tendrils.
    for ob in head:
        ob.location.x *= 1.22
        ob.scale.x *= 1.22
    attach(head,body)
    # Four arms each side: separated hooks of different lengths and heights.
    paths=[
        [(.40,.63,.36),(.84,1.07,.28),(1.30,1.94,.40),(1.67,2.43,.75),(2.15,2.42,.96),(2.35,2.07,.88),(2.09,1.83,.79)],
        [(.64,.23,.33),(1.20,.49,.24),(2.01,1.10,.36),(2.72,1.15,.72),(3.04,.76,.91),(2.88,.32,.91),(2.55,.31,.77)],
        [(.70,-.30,.29),(1.21,-.56,.18),(2.13,-.63,.26),(2.71,-1.12,.58),(2.65,-1.63,.84),(2.23,-1.83,.88),(2.02,-1.54,.71)],
        [(.44,-.87,.24),(.80,-1.44,.15),(1.19,-2.17,.26),(1.04,-2.72,.52),(.55,-2.87,.77),(.24,-2.52,.85),(.46,-2.29,.76)],
    ]
    arm_data=[]
    for side in (-1,1):
        for j,path in enumerate(paths):
            points=[(side*x,y+( .10*math.sin(k*1.6+j) if side<0 and k>0 else 0),z) for k,(x,y,z) in enumerate(path)]
            arm_data.append(arm(c,len(arm_data),points,.405 if j<2 else .36,(hide,ridge,cups,well)))
    data=bpy.data.armatures.new('Kraken eight flexible chains')
    rig=bpy.data.objects.new('Kraken tentacle rig',data); c.scene.collection.objects.link(rig)
    rig.parent=emergence
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    base=data.edit_bones.new('root'); base.head=(0,0,0); base.tail=(0,.2,0)
    chains=[]; count=16
    for i,(_,centers,_) in enumerate(arm_data):
        chain=[]; previous=base
        for j in range(count):
            bone=data.edit_bones.new(f'arm_{i+1:02d}_{j+1:02d}')
            bone.head=centers[round(j*(len(centers)-1)/count)]
            bone.tail=centers[round((j+1)*(len(centers)-1)/count)]
            bone.parent=previous; bone.use_connect=j>0
            bone.align_roll(Vector((0,0,1)))
            previous=bone; chain.append(bone.name)
        chains.append(chain)
    bpy.ops.object.mode_set(mode='OBJECT')
    for i,(ob,_,weights) in enumerate(arm_data):
        ob.parent=emergence
        groups=[ob.vertex_groups.new(name=name) for name in chains[i]]
        for v,t in enumerate(weights):
            position=max(0,min(count-1,t*count-.5)); a=int(position); b=min(count-1,a+1); blend=position-a
            groups[a].add([v],1-blend,'REPLACE')
            if b!=a and blend>0: groups[b].add([v],blend,'REPLACE')
        modifier=ob.modifiers.new('Smooth muscular tentacle skin','ARMATURE'); modifier.object=rig
        modifier.use_deform_preserve_volume=True
    for bone in rig.pose.bones: bone.rotation_mode='XYZ'
    for ob in head:
        if ob.type=='MESH': c.paint_form_mask(ob,lambda p:.65+.35*max(0,min(1,p.z)))
    return {'root':root,'parts':{'body':body,'surfacing':emergence,'tentacle_chains':chains},'rig':rig,'sockets':{}}
