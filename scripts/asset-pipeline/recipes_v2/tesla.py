"""Open fork electrodes with ribbed ceramic induction spines and a copper wound rotor."""
import math
from turret_parts import palette, support, annulus, grille, finish


def build(c, spec):
    p = palette(c, armor=(.075,.13,.18), accent=(.24,.42,.46), charge=(.04,.56,.78))
    base = support(c,p,radius=.85,facets=8)
    c.box('Fork machinery saddle', (-.14,0,.47), (1.00,.94,.28), p['armor'], .12)
    grille(c,'Rear capacitor cooling',(-.50,0,.65),.27,.39,p['steel'],p['dark'],4)
    rotor=[]
    c.cylinder('Rotor ceramic well',(-.13,0,.72),.31,.20,p['dark'],32)
    rotor.append(annulus(c,'Continuous copper induction ring',(-.13,0,.84),.28,.21,.065,p['copper']))
    for i in range(8):
        a=i*math.tau/8
        fin=c.box('Angled copper rotor shoe',(-.13+.27*math.cos(a),.27*math.sin(a),.88),(.14,.060,.055),p['copper'],.014)
        fin.rotation_euler.z=a+.22;rotor.append(fin)
    core=[c.ell('Confined cyan rotor core',(-.13,0,.91),(.17,.17,.14),p['charge'])]
    for side in (-1,1):
        yy=side*.47
        c.box('Fork insulated carrier',(.38,yy,.63),(1.49,.25,.26),p['dark'],.067)
        c.box('Blue steel electrode spine',(.37,yy,.76),(1.38,.20,.19),p['edge'],.045)
        for xx in [-.20,-.015,.17,.355,.54,.725]:
            c.box('Ceramic coil separator',(xx,yy,.848),(.10,.28,.095),p['armor'],.022)
            c.box('Cyan induction winding',(xx+.048,yy,.863),(.033,.25,.082),p['charge'],.009)
        c.box('Exposed fork terminal',(1.105,yy,.785),(.25,.21,.22),p['ivory'],.050)
        c.box('Cyan contact strip',(1.17,yy,.91),(.13,.12,.023),p['charge'],.016)
        c.box('Side mechanical clamp',(.12,side*.66,.64),(.25,.12,.20),p['steel'],.032)
    return finish(c,base,{'rotor':rotor,'core':core},pivots={'rotor':(-.13,0,.82),'core':(-.13,0,.89)},emission=p['charge'],sockets={'muzzle':(1.25,0,.82)})
