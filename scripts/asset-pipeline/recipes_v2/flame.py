"""Twin lacquered fuel tanks, copper plumbing, pump rotor and a broad heat-baffled nozzle."""
import math
from turret_parts import palette,support,cylinder_x,tube,grille,finish


def build(c,spec):
    p=palette(c,armor=(.24,.12,.055),accent=(.74,.25,.025),charge=(.70,.19,.025))
    base=support(c,p,radius=.87,facets=8,accent_lugs=True)
    c.box('Fuel pump central housing',(-.13,0,.51),(1.01,.51,.34),p['steel'],.095)
    for side in (-1,1):
        y=side*.47
        cylinder_x(c,'Burnt-orange armored fuel tank',(-.17,y,.64),.22,.83,p['armor'])
        c.ell('Rounded fuel tank rear',(-.59,y,.64),(.105,.22,.22),p['armor'])
        c.ell('Rounded fuel tank front',(.245,y,.64),(.105,.22,.22),p['armor'])
        for x in (-.43,.12):
            cylinder_x(c,'Tank retaining steel strap',(x,y,.64),.230,.048,p['steel'])
        c.box('Tank ochre pressure label',(-.17,y,.876),(.26,.115,.025),p['accent'],.014)
        c.cylinder('Fuel filler cap',(-.41,y,.866),.066,.065,p['edge'],12)
        c.box('Tank feed coupling',(.28,side*.36,.64),(.20,.15,.14),p['copper'],.028)
        c.box('Visible copper fuel line',(.385,side*.23,.66),(.11,.29,.10),p['copper'],.035)
    c.box('Central armored pump hood',(-.17,0,.72),(.68,.38,.25),p['armor'],.08)
    grille(c,'Pump pressure cooling',(-.40,0,.869),.20,.24,p['dark'],p['steel'],3)
    tube(c,'Open broad flamethrower nozzle',(.82,0,.69),.165,.034,.80,p['steel'])
    for xx in (.51,.68,.85,1.02):
        cylinder_x(c,'Copper nozzle heat baffle',(xx,0,.69),.197,.055,p['copper'])
    tube(c,'Heavy orange nozzle lip',(1.20,0,.69),.19,.045,.10,p['accent'])
    c.box('Pilot heat window',(1.035,0,.90),(.14,.09,.022),p['charge'],.016)
    rotor=[]
    c.cylinder('Pump pressure valve hub',(-.04,0,.915),.14,.06,p['dark'],24)
    for i in range(6):
        a=i*math.tau/6
        ob=c.box('Brass pressure valve spoke',(-.04+.11*math.cos(a),.11*math.sin(a),.96),(.15,.044,.040),p['copper'],.009)
        ob.rotation_euler.z=a;rotor.append(ob)
    core=[c.cylinder('Orange diaphragm pressure indicator',(-.04,0,.985),.073,.045,p['charge'],24)]
    return finish(c,base,{'rotor':rotor,'core':core},pivots={'rotor':(-.04,0,.95),'core':(-.04,0,.97)},emission=p['charge'],sockets={'muzzle':(1.28,0,.69)})
