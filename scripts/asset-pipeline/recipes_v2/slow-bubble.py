"""A frosted round pressure cell in an open cradle, feeding a narrow cryogenic nozzle."""
import math
from turret_parts import palette,support,annulus,cylinder_x,tube,grille,new_meshes,finish


def build(c,spec):
    p=palette(c,armor=(.075,.19,.22),accent=(.22,.50,.54),charge=(.20,.67,.74))
    ice=c.material('Matte frosted pressure reservoir',(.44,.69,.71),'technical')
    frost=c.material('Pale frost bands',(.69,.81,.77),'technical')
    base=support(c,p,radius=.83,facets=12)
    c.cylinder('Pressure cell ceramic socket',(-.14,0,.44),.51,.28,p['dark'],36)
    annulus(c,'Reservoir lower cradle',(-.14,0,.595),.51,.445,.08,p['steel'])
    core=[c.ell('Large rounded frost reservoir',(-.14,0,.78),(.43,.45,.37),ice),
          c.ell('Constrained cyan pressure meniscus',(-.15,0,1.137),(.17,.17,.038),p['charge'])]
    for i in range(3):
        a=math.pi/2+i*math.tau/3
        x=-.14+.42*math.cos(a);y=.42*math.sin(a)
        ob=c.box('Three-point reservoir retaining arm',(x,y,.85),(.34,.12,.19),p['steel'],.035)
        ob.rotation_euler.z=a
        c.cylinder('Large reservoir retaining screw',(-.14+.54*math.cos(a),.54*math.sin(a),.955),.040,.025,p['edge'],6)
    for i in range(3):
        a=.20+i*.48
        core.append(annulus(c,'Fine authored frost crescent',(-.14,0,1.095),.25+i*.045,.238+i*.045,.016,frost,a,a+.90,12))
    c.box('Eastern pressure manifold',(.51,0,.61),(.43,.40,.24),p['armor'],.065)
    before=set(c.scene.objects)
    tube(c,'Slender cryogenic nozzle',(.91,0,.67),.114,.029,.68,p['steel'])
    cylinder_x(c,'Cold ceramic nozzle collar',(1.10,0,.67),.151,.09,frost)
    tube(c,'Cyan nozzle tip',(1.234,0,.67),.123,.030,.070,p['accent'])
    left=new_meshes(c,before)
    before=set(c.scene.objects)
    c.box('Reciprocating valve cover',(.40,0,.82),(.31,.28,.085),p['edge'],.030)
    for xx in (.31,.40,.49):
        c.box('Valve pressure rib',(xx,0,.875),(.032,.22,.028),p['dark'],.006)
    right=new_meshes(c,before)
    return finish(c,base,{'left_pod':left,'right_pod':right,'core':core},pivots={'core':(-.14,0,.78)},emission=p['charge'],sockets={'muzzle':(1.28,0,.67)})
