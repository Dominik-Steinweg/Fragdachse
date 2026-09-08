"""A compact belt-fed rotary machine gun with a side drum and a distinct narrow barrel."""
import math
from turret_parts import palette, support, cylinder_x, tube, grille, new_meshes, finish


def build(c,spec):
    p=palette(c,armor=(.13,.16,.105),accent=(.53,.29,.060))
    base=support(c,p,radius=.85,facets=12)
    c.box('Heavy receiver undercarriage',(-.17,-.055,.48),(1.01,.66,.28),p['dark'],.095)
    c.box('Sloped olive receiver',(-.18,-.06,.67),(.93,.61,.30),p['armor'],.085)
    c.box('Rear receiver armored flange',(-.66,-.07,.68),(.15,.56,.22),p['steel'],.035)
    grille(c,'Receiver cooling',(-.40,-.12,.839),.28,.29,p['steel'],p['dark'],4)
    c.cylinder('Side ammunition drum',(-.20,.455,.59),.255,.35,p['steel'],24)
    c.cylinder('Olive ammo drum lid',(-.20,.455,.78),.224,.055,p['armor'],24)
    c.cylinder('Ammo drum spindle',(-.20,.455,.822),.070,.035,p['accent'],12)
    for i in range(5):
        a=math.pi*.13+i*math.pi*.20
        ob=c.box('Ammunition drum radial rib',(-.20+.16*math.cos(a),.455+.16*math.sin(a),.826),(.12,.033,.033),p['edge'],.005)
        ob.rotation_euler.z=a
    for i in range(5):
        c.box('Visible brass feed cartridge',(.08+i*.043,.34-i*.028,.80),(.055,.115,.070),p['accent'],.012)
    before=set(c.scene.objects)
    cylinder_x(c,'Rotary barrel trunnion',(.30,-.075,.704),.18,.29,p['steel'])
    for i in range(3):
        a=i*math.tau/3+math.pi/2
        yy=-.075+.081*math.cos(a);zz=.704+.081*math.sin(a)
        cylinder_x(c,'Long separate machine-gun barrel',(.86,yy,zz),.043,.79,p['dark'],20)
        tube(c,'Open individual muzzle',(1.247,yy,zz),.045,.013,.052,p['edge'])
    cylinder_x(c,'Rear rotary barrel band',(.55,-.075,.704),.144,.070,p['edge'])
    cylinder_x(c,'Forward barrel stabilizer',(1.10,-.075,.704),.133,.075,p['steel'])
    c.box('Barrel upper alignment rail',(.64,-.075,.854),(.57,.060,.047),p['steel'],.009)
    gun=new_meshes(c,before)
    before=set(c.scene.objects)
    c.box('Reciprocating receiver cover',(-.095,-.12,.877),(.53,.29,.085),p['steel'],.035)
    c.box('Warm bolt indicator',(.070,-.12,.928),(.10,.15,.024),p['accent'],.012)
    c.box('Offset bolt handle',(-.11,-.327,.79),(.18,.095,.075),p['edge'],.024)
    bolt=new_meshes(c,before)
    return finish(c,base,{'left_pod':gun,'right_pod':bolt},sockets={'muzzle':(1.29,-.075,.72)})
