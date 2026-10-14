"""Damp hostile ossuary: thin brood membranes, hooked spurs and engulfed scrap."""
import math
import random
import bpy
from dawn_parts import material_factory,surface,linear,root,finish,tube,annulus,tapered_tube,group,plate,bolt


def damp(mat, roughness=.52):
    """Broken damp sheen under the shared soft lights, never hard plastic glints."""
    if mat.get('dawnLibrary'): return mat
    n,l=mat.node_tree.nodes,mat.node_tree.links;bs=n['Principled BSDF']
    bs.inputs['Specular IOR Level'].default_value=.24
    bs.inputs['Coat Weight'].default_value=.12
    bs.inputs['Coat Roughness'].default_value=.38
    noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=17
    ramp=n.new('ShaderNodeMapRange');ramp.inputs['From Min'].default_value=.2;ramp.inputs['From Max'].default_value=.8
    ramp.inputs['To Min'].default_value=roughness-.12;ramp.inputs['To Max'].default_value=roughness+.14
    l.new(noise.outputs['Fac'],ramp.inputs['Value']);l.new(ramp.outputs['Result'],bs.inputs['Roughness'])
    return mat


def embryo_membrane(mat):
    # A soft depth silhouette on the shell survives both the albedo pass and beauty;
    # enclosed larval geometry supplies volume without making the asset alpha see-through.
    n,l=mat.node_tree.nodes,mat.node_tree.links;bs=n['Principled BSDF']
    attr=n.new('ShaderNodeVertexColor');attr.layer_name='FD_EmbryoShadow'
    mix=n.new('ShaderNodeMixRGB');mix.inputs[2].default_value=(*linear((29,43,15)),1)
    l.new(bs.inputs['Base Color'].links[0].from_socket,mix.inputs[1]);l.new(attr.outputs['Color'],mix.inputs[0]);l.new(mix.outputs[0],bs.inputs['Base Color'])
    bs.inputs['Subsurface Weight'].default_value=.075
    bs.inputs['Subsurface Radius'].default_value=(.10,.17,.045)
    return mat


def build(c,spec):
    material=material_factory(c,spec)
    pivot=root(c);rng=random.Random(291)
    purple=damp(material('Deep saturated bruised violet',(69,22,76),.19),.53)
    fold=damp(material('Wet purple sinew',(113,38,94),.17),.49)
    dark=material('Opaque brood throat',(20,11,27),.04)
    bone=material('Splintered aged bone',(176,170,119),.37)
    scar=material('Sinew binding on bone',(71,29,53),.20)
    egg=embryo_membrane(damp(material('Thin translucent green membrane',(138,163,58),.16),.49))
    vein=damp(material('Blood-filled branching veins',(68,64,31),.12),.53)
    slime=damp(material('Stretched pale green mucus',(155,170,96),.08),.40)
    embryo=material('Curled larva inside sac',(30,44,18),.05)
    steel=material('Engulfed corroded metal',(103,91,71),.55)
    rust=material('Old rust trapped in flesh',(137,67,33),.60)
    # Real irregular organic mass with open dark central throat, never a ground disc.
    for i in range(15):
        a=i*math.tau/15;r=1.01+rng.uniform(-.08,.08)
        ob=c.ell('Creased basal mantle',(r*math.cos(a),r*math.sin(a),.15),(.34,.27,.13),purple)
        ob.rotation_euler.z=a+.50
        for v in ob.data.vertices:v.co.z*=1+.15*math.sin(v.co.x*10+v.co.y*6)
    annulus(c,'Deep central brood throat',(0,0,.10),.65,.22,.15,dark,steps=48)
    c.ell('Opaque recessed brood throat',(0,0,.065),(.34,.34,.055),dark)
    for i in range(12):
        a=i*math.tau/12
        pts=[(r*math.cos(a+.16*t),r*math.sin(a+.16*t),.24+.07*math.sin(t*math.pi)) for t,r in [(0,.24),(.4,.48),(.7,.80),(1,1.13)]]
        tapered_tube(c,'Tense radial flesh fold',pts,[.015,.045,.079,.026],fold)
    # Segmental rib bones, interrupted by dark joints, curved rather than a perfect ring.
    for i in range(11):
        a=i*math.tau/11+.04;rr=1.27+rng.uniform(-.05,.05)
        pts=[(rr*math.cos(a+t),rr*math.sin(a+t),.24+.045*math.sin(t*7)) for t in (0,.09,.23,.37)]
        tapered_tube(c,'Fractured thin ossuary rib',pts,[.062,.078,.061,.016],bone,9)
        reach=1.46+rng.uniform(-.07,.04)
        pts=[(1.12*math.cos(a),1.12*math.sin(a),.24),(1.28*math.cos(a+.035),1.28*math.sin(a+.035),.41),
             (reach*math.cos(a+.07),reach*math.sin(a+.07),.48),(min(1.53,reach+.035)*math.cos(a+.20),min(1.53,reach+.035)*math.sin(a+.20),.51)]
        tapered_tube(c,'Razor hooked bone spur',pts,[.098,.070,.033,.0015],bone,7)
        tube(c,'Sinew lash on bone',[(1.18*math.cos(a-.045),1.18*math.sin(a-.045),.35),(1.28*math.cos(a),1.28*math.sin(a),.42),(1.30*math.cos(a+.07),1.30*math.sin(a+.07),.36)],.026,scar)
    parts={}
    for i,(x,y,sx,sy,a) in enumerate([(-.58,.48,.39,.47,.25),(.59,.24,.42,.48,-.38),(-.12,-.68,.39,.45,-.12)]):
        before=set(c.scene.objects)
        c.ell('Egg sac shadow socket',(0,0,.07),(sx*1.20,sy*1.17,.12),dark)
        sac=c.ell('Asymmetric thin egg sac',(0,0,.17),(sx,sy,.31),egg)
        attr=sac.data.color_attributes.new(name='FD_EmbryoShadow',type='FLOAT_COLOR',domain='POINT')
        for v in sac.data.vertices:
            u,w=v.co.x,v.co.y
            head=math.exp(-2.2*((u+.16)**2/.21**2+(w-.20)**2/.23**2))
            tail=max(math.exp(-2.5*((u-(.21*math.cos(t)-.04))**2/.105**2+(w-(.37*math.sin(t)-.04))**2/.13**2)) for t in [j*.22+.20 for j in range(24)])
            shadow=max(head,tail)*(.90 if v.co.z>0 else .3)
            attr.data[v.index].color=(shadow,shadow,shadow,1)
            membrane_angle=math.atan2(v.co.y,v.co.x)
            v.co.x*=1+.028*math.sin(membrane_angle*7+v.co.z*5)
            v.co.y*=1+.035*math.sin(membrane_angle*5+v.co.z*4)
        c.ell('Embryo head enclosed by membrane',(-.06,.08,.27),(.07,.095,.065),embryo)
        pts=[(.09*math.cos(t)-.01,.16*math.sin(t)-.02,.26) for t in [j*.23 for j in range(24)]]
        tapered_tube(c,'Enclosed curled embryonic body',pts,[.038*(1-j/26)+.007 for j in range(24)],embryo)
        def shell(u,v,offset=.009):return (sx*u,sy*v,.17+.31*math.sqrt(max(.018,1-u*u-v*v))+offset)
        for j in range(3):
            uv=[(-.77+j*.22+.13*math.sin(k*.78+j),-.76+k*.17) for k in range(9)]
            uv=[(u,v) for u,v in uv if u*u+v*v<.96]
            tapered_tube(c,'Branching membrane vein',[shell(u,v) for u,v in uv],[.012+.008*math.sin(k*.6)**2 for k in range(len(uv))],vein,7)
            for k in (2,5):
                if k>=len(uv):continue
                u,v=uv[k];side=1 if j%2 else -1
                branch=[(u,v),(u+side*.11,v+.04),(u+side*.23,v+.16)]
                branch=[(uu,vv) for uu,vv in branch if uu*uu+vv*vv<.97]
                if len(branch)>1:tapered_tube(c,'Fine blood vessel fork',[shell(uu,vv,.013) for uu,vv in branch],[.012]+[.005]*(len(branch)-1),vein,6)
        for j in range(3):
            aa=j*2.1
            pts=[(sx*r*math.cos(aa+.22*r),sy*r*math.sin(aa+.22*r),.13+.19*(1-r)) for r in (.62,.82,1.05,1.25)]
            tapered_tube(c,'Egg supporting tendon',pts,[.022,.041,.068,.025],fold)
        parts[f'egg{i}']=group(c,'Egg pulse control',set(c.scene.objects)-before,(x,y,.22),(0,0,a))
        parts[f'egg{i}'].parent=pivot
    for pts in [[(-.34,.32,.56),(-.10,.21,.38),(.16,.23,.38),(.34,.27,.56)],
                [(-.37,.08,.48),(-.44,-.19,.31),(-.30,-.43,.46)],
                [(.43,-.12,.52),(.19,-.22,.31),(.04,-.42,.51)],
                [(-.23,.83,.44),(.10,.90,.24),(.42,.66,.48)]]:
        tapered_tube(c,'Sagging mucus filament',pts,[.017,.009,.009,.017] if len(pts)==4 else [.015,.008,.018],slime,7)
    for x,y,a in [(-.96,-.39,-.35),(.78,.83,.45),(.40,-1.14,-.22)]:
        before=set(c.scene.objects)
        plate(c,'Jagged salvaged iron strap',(0,0,.32),[(-.16,-.24),(.12,-.23),(.18,.14),(.07,.23),(-.02,.17),(-.15,.22)],.06,rust,.012)
        for v in (-.15,.13):bolt(c,0,v,.366,steel,.042)
        tube(c,'Flesh engulfing scrap',[(-.19,-.09,.34),(0,-.02,.405),(.18,.10,.34)],.028,fold)
        group(c,'Embedded scrap strap',set(c.scene.objects)-before,(x,y,0),(0,0,a)).parent=pivot
    annulus(c,'Rusted bearing consumed by nest',(.82,-.70,.23),.23,.145,.095,steel,start=.3,end=5.9,steps=28)
    for a in (.15,2.6,4.4):
        pts=[(r*math.cos(a+.07*i),r*math.sin(a+.07*i),z) for i,(r,z) in enumerate([(1.13,.28),(.90,.42),(.67,.44),(.49,.36)])]
        tapered_tube(c,'Inward hooked brood fang',pts,[.063,.05,.026,.0015],bone,7)
    return finish(c,pivot,parts)
