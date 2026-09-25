"""Furred, surface-projected skulls with recessed eyes for the quadruped enemy family."""
import math
from recipes_v2.enemy_parts_a import ell, horn
from enemy_parts_b import scute
from zombie_surface_parts import Surface, locks, patch, oval
from eye_anchors import register_eye


def head_a(c,pale,dark,coat,eye,y=.57,z=.87,width=.30,length=.43,ears=True,nose=None):
    before=set(c.scene.objects);width*=1.12
    face=pale.copy();face.name='Authored furred enemy face'
    face['FD_CraftFur']=True;face['FD_CraftMask']=[y,width,length]
    c.strengths.append(face.node_tree.nodes['Surface detail strength'].inputs[0])
    skull=ell(c,'Sculpted swept badger cranium',(0,y,z),(width,length,.215),face)
    for v in skull.data.vertices:
        x,yy,zz=v.co
        v.co.x=math.copysign(abs(x)**.90,x)*(1-.40*max(0,yy))
        if yy<0:v.co.y=-abs(yy)**.80
    skull.data.update()
    bases=[skull]
    for side in (-1,1):
        bases.append(ell(c,'Organic rear cheek ruff',(side*width*.63,y-length*.42,z-.035),(width*.46,length*.44,.15),face,taper=.20))
        if ears:
            bases.append(ell(c,'Rounded backward ear fold',(side*width*.84,y-length*.59,z+.03),(width*.28,length*.25,.065),coat,angle=side*.28))
            ell(c,'Recessed warm ear interior',(side*width*.87,y-length*.63,z+.091),(width*.13,length*.13,.008),dark,angle=side*.28)
    surface=Surface(bases);ex=width*.51;ey=y+length*.27
    def eye_area(x,yy):return any(((x-side*ex)/(.070*width/.34))**2+((yy-ey)/(.058*length/.43))**2<1.25 for side in (-1,1))
    locks(c,'Layered fine cheek and crown fur',surface,(-width*1.14,y-length*.87,width*1.14,y+length*.94),[face],37,max(.025,width*.11),length*.16,eye_area)
    for side in (-1,1):
        x=side*ex;scale=width/.34
        patch(c,'Soft inset eye socket',surface,oval(x,ey,.061*scale,.044*scale,side*-.24),dark,.012)
        height=surface.height(x,ey)
        register_eye(c,side,ell(c,'Living narrow enemy eye',(x,ey+.002,height+.029),(.036*scale,.023*scale,.013),eye,angle=side*-.24))
        pupil=c.material('Dark vertical enemy pupil',(.004,.006,.005))
        ell(c,'Focused pupil',(x,ey+.004,height+.041),(.008*scale,.020*scale,.003),pupil)
        glint=c.material('Restrained ivory eye reflection',(.74,.76,.64))
        ell(c,'Small eye glint',(x-.011*scale,ey+.010*scale,height+.044),(.0055*scale,.0055*scale,.002),glint)
        points=[surface.point(x+dx*scale,ey+dy*scale,.027) for dx,dy in [(-.060,-.009),(-.025,-.026),(.026,-.022),(.058,-.003)]]
        horn(c,'Tapered protective eyelid',points,[.005,.011,.012,.004],coat,10)
    ell(c,'Rounded leathery north nose',(0,y+length*.94,z-.005),(width*.27,length*.155,.047),nose or dark,taper=.18)
    return [o for o in c.scene.objects if o not in before and o.type=='MESH']


def head_b(c,center,width,length,pale,dark,nose,eye=None,crest=None):
    x,y,z=center
    eye=eye or c.material('Warm restrained amber eyes',(.63,.44,.10),emission=.08)
    result=head_a(c,pale,dark,dark,eye,y,z,width,length,nose=nose)
    if x:
        for ob in result:ob.location.x+=x
    if crest:result.append(scute(c,'Worn protective forehead crest',(x,y-length*.37,z+.202),width*.5,length*.50,crest,.058))
    return result


def face_mask(material):
    cy,width,length=material['FD_CraftMask'];n,l=material.node_tree.nodes,material.node_tree.links
    bs=n.get('Principled BSDF');pale=bs.inputs['Base Color'].links[0].from_socket
    attr=n.new('ShaderNodeAttribute');attr.attribute_name='FD_ZombieRest'
    xyz=n.new('ShaderNodeSeparateXYZ');l.new(attr.outputs['Vector'],xyz.inputs[0])
    def op(kind,a,b):
        node=n.new('ShaderNodeMath');node.operation=kind
        for v,s in [(a,node.inputs[0]),(b,node.inputs[1])]:
            if isinstance(v,(int,float)):s.default_value=v
            else:l.new(v,s)
        return node.outputs[0]
    front=op('MAXIMUM',op('DIVIDE',op('SUBTRACT',xyz.outputs['Y'],cy),length),0)
    span=op('MULTIPLY',width,op('SUBTRACT',1,op('MULTIPLY',front,.47)))
    distance=op('DIVIDE',op('ABSOLUTE',xyz.outputs['X'],0),span)
    noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=90
    l.new(attr.outputs['Vector'],noise.inputs['Vector'])
    distance=op('ADD',distance,op('MULTIPLY',op('SUBTRACT',noise.outputs['Fac'],.5),.075))
    ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.interpolation='EASE';ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
    for i,(pos,val) in enumerate([(0,0),(.23,0),(.35,1),(.73,1),(.86,0)]):
        e=ramp.color_ramp.elements[0] if i==0 else ramp.color_ramp.elements.new(pos);e.position=pos;e.color=(val,val,val,1)
    l.new(distance,ramp.inputs[0])
    charcoal=n.new('ShaderNodeMixRGB');charcoal.blend_type='MULTIPLY';charcoal.inputs[0].default_value=1
    l.new(pale,charcoal.inputs[1]);charcoal.inputs[2].default_value=(.060,.072,.080,1)
    mix=n.new('ShaderNodeMixRGB');l.new(ramp.outputs[0],mix.inputs[0]);l.new(pale,mix.inputs[1]);l.new(charcoal.outputs[0],mix.inputs[2]);l.new(mix.outputs[0],bs.inputs['Base Color'])
