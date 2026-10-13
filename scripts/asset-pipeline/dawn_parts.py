"""Matte Dawn draft surfaces and explicit mesh attachment; no scene/light changes."""
import math
import bpy
from enemy_parts_b import plate, tube
from turret_parts import annulus


def linear(rgb):
    return tuple((v / 255 / 12.92 if v / 255 <= .04045 else ((v / 255 + .055) / 1.055) ** 2.4) for v in rgb)


def surface(c, name, rgb, wear=.3, emission=0):
    """Pigment wear, interrupted abrasion and broad normal/mask shading.

    All texture is evaluated on geometry, in physical coordinates. No light,
    ground, outline or baked external shadow is introduced.
    """
    color = linear(rgb)
    mat = c.material(name, color, emission=emission)
    n,l = mat.node_tree.nodes,mat.node_tree.links
    bs=n['Principled BSDF']
    def connect(v,s):
        if isinstance(v,(tuple,list,float,int)): s.default_value=v
        else: l.new(v,s)
    def calc(op,a,b):
        ob=n.new('ShaderNodeMath');ob.operation=op
        connect(a,ob.inputs[0]);connect(b,ob.inputs[1]);return ob.outputs[0]
    def mix(a,b,f=1,mode='MIX'):
        ob=n.new('ShaderNodeMixRGB');ob.blend_type=mode
        for v,s in zip((f,a,b),ob.inputs):connect(v,s)
        return ob.outputs[0]
    def ramp(source,points):
        ob=n.new('ShaderNodeValToRGB');ob.color_ramp.interpolation='EASE'
        for i,(pos,val) in enumerate(points):
            e=ob.color_ramp.elements[i] if i<2 else ob.color_ramp.elements.new(pos)
            e.position=pos;e.color=(*val,1) if isinstance(val,tuple) else (val,val,val,1)
        l.new(source,ob.inputs[0]);return ob.outputs[0]
    geo=n.new('ShaderNodeNewGeometry');coords=n.new('ShaderNodeTexCoord')
    def noise(scale,stretch=(1,1,1)):
        vec=n.new('ShaderNodeVectorMath');vec.operation='MULTIPLY';vec.inputs[1].default_value=stretch
        l.new(geo.outputs['Position'],vec.inputs[0])
        ob=n.new('ShaderNodeTexNoise');ob.inputs['Scale'].default_value=scale;ob.inputs['Detail'].default_value=3
        l.new(vec.outputs[0],ob.inputs['Vector']);return ob.outputs['Fac']
    patches=noise(13)
    tones=ramp(patches,[(.25,.42),(.45,.78),(.65,1.25),(.82,1.5)])
    pigment=mix((*color,1),tones,min(.85,wear+ .25),'MULTIPLY')
    # Broad irregular chips and fine scores, not a uniform white edge.
    chips=ramp(noise(30),[(.50,0),(.65,.18),(.77,1)])
    local=n.new('ShaderNodeSeparateXYZ');l.new(coords.outputs['Generated'],local.inputs[0])
    distance=calc('MINIMUM',calc('MINIMUM',local.outputs['X'],calc('SUBTRACT',1,local.outputs['X'])),calc('MINIMUM',local.outputs['Y'],calc('SUBTRACT',1,local.outputs['Y'])))
    edges=ramp(distance,[(0,.8),(.06,.45),(.16,0)])
    exposed=linear((184,176,148))
    pigment=mix(pigment,(*exposed,1),calc('MULTIPLY',calc('ADD',chips,edges),wear*.65))
    score=ramp(noise(95,(.12,1,2)),[(.50,0),(.64,.10),(.76,.7)])
    pigment=mix(pigment,(*linear((196,184,151)),1),calc('MULTIPLY',score,wear*.48))
    # Corrosion drips are irregular and strongly directional on the actual panels.
    streak=ramp(noise(23,(4,.24,1)),[(.4,0),(.61,0),(.75,.7)])
    pigment=mix(pigment,(*linear((78,51,30)),1),calc('MULTIPLY',streak,wear*.42))
    dot=n.new('ShaderNodeVectorMath');dot.operation='DOT_PRODUCT';dot.inputs[1].default_value=(-.58,.38,.72)
    l.new(geo.outputs['Normal'],dot.inputs[0])
    normal=ramp(dot.outputs['Value'],[(0,.20),(.4,.45),(.72,1.08),(.95,1.72)])
    attr=n.new('ShaderNodeVertexColor');attr.layer_name='FD_FormMask'
    form=mix(normal,attr.outputs['Color'],.55,'MULTIPLY')
    ao=n.new('ShaderNodeAmbientOcclusion');ao.inputs['Distance'].default_value=.24;ao.samples=16
    cavity=ramp(ao.outputs['AO'],[(0,.08),(.45,.32),(.8,.75),(1,1)])
    shaded=mix(mix(pigment,form,1,'MULTIPLY'),cavity,.85,'MULTIPLY')
    strength=n.new('ShaderNodeMixRGB');strength.name='Form shadow strength'
    l.new(pigment,strength.inputs[1]);l.new(shaded,strength.inputs[2]);c.form_strengths.append(strength.inputs[0])
    l.new(strength.outputs[0],bs.inputs['Base Color'])
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.22;bump.inputs['Distance'].default_value=.005
    l.new(noise(120),bump.inputs['Height']);l.new(bump.outputs[0],bs.inputs['Normal'])
    return mat


def root(c):
    ob = bpy.data.objects.new('Dawn fixed center pivot', None)
    c.scene.collection.objects.link(ob)
    return ob


def finish(c, pivot, parts=None):
    meshes = [ob for ob in c.scene.objects if ob.type == 'MESH']
    for ob in meshes:
        if ob.parent is None: ob.parent = pivot
        from weapon_surface_parts import paint_depth
        paint_depth(c,ob)
    return dict(root=pivot, parts={'meshes': meshes, **(parts or {})}, rig=None, sockets={})


def beam(c, name, a, b, width, z, mat):
    ob = c.box(name, ((a[0]+b[0])/2, (a[1]+b[1])/2, z),
               (math.dist(a,b), width, .09), mat, .018)
    ob.rotation_euler.z = math.atan2(b[1]-a[1], b[0]-a[0])
    return ob


def bolt(c, x, y, z, mat, radius=.025):
    return c.cylinder('Captive hex fastener', (x,y,z), radius, .018, mat, 6)


def crown(c,name,center,width,length,height,mat):
    """Sloped machined shoulders: broad relief visible to the locked -Z camera."""
    x,y,z=center
    vs=[(x+sx*width*f/2,y+sy*length*f/2,z+h) for f,h in [(1,0),(.78,height)] for sx,sy in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    faces=[(0,3,2,1),(4,5,6,7),*( (i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4))]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],faces);mesh.materials.append(mat);mesh.update()
    ob=bpy.data.objects.new(name,mesh);c.scene.collection.objects.link(ob)
    bevel=ob.modifiers.new('Soft shoulder radius','BEVEL');bevel.width=.035;bevel.segments=3
    ob.modifiers.new('Weighted shoulder normals','WEIGHTED_NORMAL')
    return ob


def hazards(c,center,width,height,yellow,dark):
    x,y,z=center
    c.box('Worn hazard strip',(x,y,z),(width,height,.018),yellow,.006)
    count=max(2,round(width/.15))
    for i in range(count):
        px=x-width/2+(i+.25)*width/count
        plate(c,'Black warning diagonal',(px,y,z+.012),[(0,-height/2),(.055,-height/2),(.115,height/2),(.06,height/2)],.006,dark,.002)


def salvage_palette(c, tier):
    """Shared M3 tier pigments, kept independent of the accepted V1 recipes."""
    return dict(
        paint=surface(c,'Salvage tier enamel',[(183,88,37),(72,80,42),(211,221,213)][tier-1],.62),
        trim=surface(c,'Salvage secondary panels',[(110,64,35),(166,155,105),(65,76,79)][tier-1],.43),
        edge=surface(c,'Salvage exposed alloy',[(171,158,126),(201,199,170),(225,233,226)][tier-1],.3),
        dark=surface(c,'Salvage oily structural steel',(39,48,50),.18),
        rubber=surface(c,'Split tire rubber',(41,46,41),.16),
        tread=surface(c,'Worn rubber tread crowns',(91,95,79),.23),
        warning=surface(c,'Salvage warning ochre',(228,179,55),.32),
        cyan=surface(c,'Sparse service seam',(31,177,204),0,.32),
        moss=surface(c,'Clinging forest moss',(79,103,31),.40),
        leaf=surface(c,'Young fern leaf',(132,150,54),.22))


def group(c, name, objects, center=(0,0,0), rotation=(0,0,0)):
    """Local geometry becomes an explicit reusable assembly, without name lookup."""
    ob=bpy.data.objects.new(name,None);c.scene.collection.objects.link(ob)
    for child in objects: child.parent=ob
    ob.location=center;ob.rotation_euler=rotation
    return ob


def vegetation(c, x, y, z, p, size=1):
    for i in range(5):
        a=i*2.4
        c.ell('Irregular clinging moss',(x+.10*size*math.cos(a),y+.10*size*math.sin(a),z),(.12*size,.085*size,.045*size),p['moss'])
    for j in range(3):
        a=j*2.1+.2
        for k in range(1,5):
            t=k/5;u=.34*size*t
            for side in (-1,1):
                v=.12*size*(1-t*.7)*side
                pts=[(u-.07*size,0),(u+.01*size,v),(u+.06*size,0)]
                pts=[(x+xx*math.cos(a)-yy*math.sin(a),y+xx*math.sin(a)+yy*math.cos(a)) for xx,yy in pts]
                plate(c,'Fern leaflet',(0,0,z+.05),pts,.012,p['leaf'],.004)


def tire(c, center, radius, width, p, rotation=(0,0,0)):
    before=set(c.scene.objects)
    annulus(c,'Thick torn rubber tire',(0,0,0),radius,radius*.47,width,p['rubber'],steps=48)
    c.cylinder('Recessed painted wheel dish',(0,0,width*.30),radius*.46,width*.30,p['paint'],40)
    annulus(c,'Raised abraded wheel lip',(0,0,width*.45),radius*.46,radius*.37,.045,p['edge'],steps=40)
    c.cylinder('Axle hub',(0,0,width*.57),radius*.16,.09,p['trim'],12)
    for i in range(18):
        a=i*math.tau/18
        for side in (-1,1):
            ob=c.box('Chevron agricultural tread',(radius*.92*math.cos(a),radius*.92*math.sin(a),side*width*.25),(.11,radius*.30,width*.49),p['tread'],.02)
            ob.rotation_euler=(0,side*.34,a)
    for i in range(5):
        a=i*math.tau/5
        bolt(c,radius*.27*math.cos(a),radius*.27*math.sin(a),width*.49,p['dark'],.025)
    return group(c,'Wheel assembly',set(c.scene.objects)-before,center,rotation)


def tapered_tube(c,name,points,radii,mat,sides=12):
    from mathutils import Vector
    pts=[Vector(p) for p in points];vs=[]
    for i,p in enumerate(pts):
        tangent=(pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)]).normalized()
        n=tangent.cross(Vector((0,0,1))).normalized();b=tangent.cross(n).normalized()
        for j in range(sides):
            a=j*math.tau/sides;vs.append(tuple(p+radii[i]*(n*math.cos(a)+b*math.sin(a))))
    faces=[tuple(reversed(range(sides))),tuple((len(pts)-1)*sides+j for j in range(sides))]
    for i in range(len(pts)-1):
        for j in range(sides):
            a=i*sides+j;b=i*sides+(j+1)%sides;faces.append((a,b,b+sides,a+sides))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],faces);mesh.materials.append(mat);mesh.update()
    ob=bpy.data.objects.new(name,mesh);c.scene.collection.objects.link(ob)
    for face in mesh.polygons:face.use_smooth=True
    return ob


def supply_palette(c):
    return dict(paint=surface(c,'Player rescue ochre',(224,164,38),.38),
                brass=surface(c,'Warm worn brass fittings',(185,126,53),.30),
                dark=surface(c,'Recessed cargo gasket',(35,43,43),.14),
                canvas=surface(c,'Unbleached parachute canvas',(186,177,137),.28),
                edge=surface(c,'Cargo handle wear',(223,197,128),.23))


def supply_crate(c, center, size, angle, p):
    """The same carryable assembly occurs loose and beside the supply capsule."""
    before=set(c.scene.objects)
    c.box('Cargo dark gasket',(0,0,.18),(.82,.69,.32),p['dark'],.07)
    crown(c,'Embossed ochre cargo lid',(0,0,.31),.79,.66,.14,p['paint'])
    for x in (-.29,.29):
        c.box('Brass cargo reinforcement',(x,0,.465),(.10,.69,.045),p['brass'],.018)
        for y in (-.26,.26):bolt(c,x,y,.496,p['edge'],.026)
    c.box('Handle inset',(0,.035,.473),(.40,.27,.035),p['dark'],.035)
    tube(c,'Raised U carry handle',[(-.16,-.055,.49),(-.16,.11,.60),(.16,.11,.60),(.16,-.055,.49)],.040,p['edge'],12)
    c.box('Wide front cargo latch',(0,-.29,.48),(.16,.115,.052),p['brass'],.016)
    ob=group(c,'Portable supply crate',set(c.scene.objects)-before,center,(0,0,angle));ob.scale=(size,size,size)
    return ob


def salvage_gear(c, center, radius, p, teeth=12):
    x,y,z=center
    annulus(c,'Hollow salvage gear',center,radius*.84,radius*.40,.10,p['edge'],steps=48)
    for i in range(teeth):
        a=math.tau*i/teeth
        ob=c.box('Gear tooth',(x+radius*.86*math.cos(a),y+radius*.86*math.sin(a),z),
                 (radius*.31,radius*.25,.105),p['edge'],.012);ob.rotation_euler.z=a


def draped_canvas(c,p):
    """Authored folds over the north rim, gathering into an irregular silk fan."""
    vs=[];faces=[];nx=40;ny=24
    for j in range(ny+1):
        t=j/ny
        for i in range(nx+1):
            u=i/nx; x=(u-.5)*(1.0+1.60*t)+.05*t+.13*math.sin(t*5+u*4)*t
            y=.49+.94*t+.17*math.sin(u*10+1)*t+.10*math.sin(u*21)*t
            z=.09+.45*(1-t)**2+.09*(.3+.7*t)*(1+math.sin(u*math.tau*5+t*4))+.07*math.sin(u*11+t*5)**2
            vs.append((x,y,z))
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i;faces.append((a,a+1,a+nx+2,a+nx+1))
    mesh=bpy.data.meshes.new('Parachute folded woven mesh');mesh.from_pydata(vs,[],faces);mesh.materials.append(p['canvas']);mesh.update()
    ob=bpy.data.objects.new('Collapsed draped parachute',mesh);c.scene.collection.objects.link(ob)
    for face in mesh.polygons:face.use_smooth=True
    ob.modifiers.new('Canvas thickness','SOLIDIFY').thickness=.009
    for i in (0,8,16,24,32,40):
        points=[(vs[j*(nx+1)+i][0],vs[j*(nx+1)+i][1],vs[j*(nx+1)+i][2]+.008) for j in range(ny+1)]
        tube(c,'Sewn parachute gore',points,.012,p['edge'],8)
    return ob
