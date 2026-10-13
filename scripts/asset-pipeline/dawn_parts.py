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
