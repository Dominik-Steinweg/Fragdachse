"""A violet containment reactor feeding a long rectangular channel with separated cooling fins."""
import math
from turret_parts import palette,support,annulus,grille,finish


def build(c,spec):
    p=palette(c,armor=(.125,.085,.19),accent=(.35,.12,.45),charge=(.54,.08,.78))
    base=support(c,p,radius=.85,facets=12)
    c.box('Contained reactor carrier',(-.26,0,.50),(.97,1.03,.30),p['dark'],.13)
    c.box('Rear violet armored shield',(-.58,0,.67),(.28,.74,.25),p['armor'],.078)
    for side in (-1,1):
        plate=c.box('Angled containment shoulder',(-.19,side*.43,.64),(.69,.25,.24),p['armor'],.062)
        plate.rotation_euler.z=-side*.24
        c.box('Shoulder violet vent',(-.20,side*.45,.784),(.31,.060,.025),p['accent'],.014)
    c.cylinder('Dark reactor chamber',(-.28,0,.69),.40,.23,p['dark'],32)
    rotor=[]
    for i in range(4):
        a=i*math.pi/2+.10
        rotor.append(annulus(c,'Separated violet containment shoe',(-.28,0,.856),.405,.305,.095,p['steel'],a,a+.98,12))
        rotor.append(annulus(c,'Narrow purple containment conductor',(-.28,0,.917),.365,.329,.022,p['charge'],a+.08,a+.86,10))
    core=[c.ell('Suspended dense void core',(-.28,0,.89),(.245,.245,.21),p['accent']),c.ell('Small focused reactor highlight',(-.29,-.025,1.087),(.095,.09,.037),p['charge'])]
    c.box('Dark energy channel housing',(.61,0,.62),(1.24,.47,.27),p['dark'],.055)
    c.box('Violet upper channel armor',(.58,0,.81),(1.20,.39,.12),p['armor'],.040)
    for xx in (.15,.43,.71):
        c.box('Separated purple channel window',(xx,0,.888),(.17,.16,.025),p['charge'],.022)
    for side in (-1,1):
        for xx in (.20,.40,.60,.80):
            ob=c.box('Projecting channel cooling tooth',(xx,side*.26,.73),(.11,.16,.19),p['steel'],.018)
            ob.rotation_euler.z=side*.25
    c.box('Wide east containment nozzle',(1.14,0,.73),(.20,.51,.33),p['steel'],.045)
    c.box('Dark nozzle throat',(1.165,0,.918),(.12,.31,.025),p['dark'],.015)
    c.box('Violet nozzle contact',(1.182,0,.938),(.085,.18,.018),p['charge'],.010)
    return finish(c,base,{'rotor':rotor,'core':core},pivots={'rotor':(-.28,0,.87),'core':(-.28,0,.89)},emission=p['charge'],sockets={'muzzle':(1.26,0,.74)})
