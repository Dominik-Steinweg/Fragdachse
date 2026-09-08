"""An open concentrically wound magnetic cage with a dark center and short three-prong emitter."""
import math
from turret_parts import palette,support,annulus,finish


def build(c,spec):
    p=palette(c,armor=(.11,.095,.15),accent=(.30,.13,.39),charge=(.40,.095,.64))
    base=support(c,p,radius=.87,facets=12)
    c.cylinder('Concentric gravity mechanism bed',(-.055,0,.48),.62,.28,p['dark'],40)
    annulus(c,'Fixed graphite outer containment ring',(-.055,0,.66),.645,.535,.16,p['armor'])
    rotor=[]
    for i in range(6):
        a=i*math.tau/6+.07
        rotor.append(annulus(c,'Articulated magnet sector',(-.055,0,.80),.565,.408,.13,p['steel'],a,a+.72,12))
        rotor.append(annulus(c,'Violet magnet winding',(-.055,0,.879),.52,.475,.025,p['charge'],a+.055,a+.665,10))
    for i in range(4):
        a=math.pi/4+i*math.pi/2
        ob=c.box('Large magnetic ring anchor',(-.055+.61*math.cos(a),.61*math.sin(a),.77),(.22,.13,.14),p['edge'],.035)
        ob.rotation_euler.z=a
        c.cylinder('Ring anchor bolt',(-.055+.62*math.cos(a),.62*math.sin(a),.855),.043,.028,p['accent'],6)
    core=[c.ell('Matte dense gravity seed',(-.055,0,.785),(.28,.28,.23),p['dark']),
          annulus(c,'Purple inner seed boundary',(-.055,0,.910),.248,.215,.027,p['accent']),
          c.ell('Focused violet singularity pupil',(-.055,0,1.018),(.093,.093,.025),p['charge'])]
    c.box('Eastern magnetic projection neck',(.80,0,.59),(.50,.30,.24),p['armor'],.045)
    for side in (-1,1):
        ob=c.box('Short emitter side prong',(1.06,side*.17,.70),(.34,.09,.15),p['steel'],.025)
        ob.rotation_euler.z=side*.10
        c.box('Violet prong contact',(1.175,side*.18,.79),(.095,.060,.021),p['charge'],.009)
    c.box('Central magnetic tongue',(1.04,0,.66),(.37,.09,.10),p['accent'],.020)
    return finish(c,base,{'rotor':rotor,'core':core},pivots={'rotor':(-.055,0,.80),'core':(-.055,0,.78)},emission=p['charge'],sockets={'muzzle':(1.27,0,.71)})
