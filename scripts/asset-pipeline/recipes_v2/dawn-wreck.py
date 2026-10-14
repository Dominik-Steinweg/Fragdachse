"""Heavy crash site: torn diagonal hull, detached rotor, burst cargo and scrap fan."""
import math
import random
from dawn_parts import surface,root,finish,beam,bolt,plate,tube,annulus,crown,hazards


def build(c,spec):
    tier=int(spec['model']['tier']); pivot=root(c); rng=random.Random(711)
    paint=surface(c,'Chipped tier enamel',[(183,88,37),(72,80,42),(211,221,213)][tier-1],.62)
    trim=surface(c,'Secondary panel',[(101,60,33),(166,155,105),(65,76,79)][tier-1],.43)
    edge=surface(c,'Exposed alloy edges',[(171,158,126),(201,199,170),(225,233,226)][tier-1],.3)
    dark=surface(c,'Oily structural steel',(39,48,50),.15)
    blade=surface(c,'Damaged rotor composite',(70,83,82),.25)
    copper=surface(c,'Copper cable braid',(187,114,63),.28)
    cargo=surface(c,'Cargo paint',[(169,116,51),(165,153,91),(167,174,159)][tier-1],.56)
    warning=surface(c,'Worn warning ochre',(228,179,55),.32)
    charge=surface(c,'Local cyan contact',(31,177,204),0,.42)
    # Stout attached arms terminate under large cast ducts.
    for i,(x,y) in enumerate([(-.99,.95),(.91,1.00),(-1.0,-.96),(1.09,-1.08)]):
        broken=i==3
        if not broken:
            beam(c,'Load bearing cast spar',(x*.18,y*.19),(x*.92,y*.92),.29,.25,dark)
            beam(c,'Worn upper spar casing',(x*.29,y*.28),(x*.84,y*.85),.20,.32,paint)
        else:
            beam(c,'Sheared fuselage spar',(.29,-.43),(.51,-.61),.26,.25,dark)
            beam(c,'Detached rotor arm',(.91,-.87),(1.08,-1.07),.25,.16,paint)
            plate(c,'Exposed jagged arm fracture',(0,0,.24),[(.84,-.77),(.87,-.88),(.93,-.83),(.92,-.96),(1.03,-.91),(.98,-.72)],.08,edge,.007)
        start,end=(.42,5.15) if broken else (0,math.tau)
        ring=annulus(c,'Fractured rotor guard' if broken else 'Cast rotor guard',(x,y,.25),.52,.365,.23,paint,start=start,end=end)
        if broken:
            for v in ring.data.vertices:
                v.co.x=x+(v.co.x-x)*.83
                v.co.z+=.09*math.sin((v.co.y-y)*5)
        annulus(c,'Inner duct bevel',(x,y,.285),.390,.355,.065,dark,start=start,end=end)
        annulus(c,'Interrupted rubbed rim',(x,y,.365),.51,.467,.035,edge,start=start,end=end)
        for j in range(3 if broken else 4):
            a=j*math.pi/2+.37+i*.28
            outline=[(.085,-.04),(.29,-.10),(.365,-.027),(.31,.085),(.13,.066)]
            pts=[(x+u*math.cos(a)-v*math.sin(a),y+u*math.sin(a)+v*math.cos(a)) for u,v in outline]
            plate(c,'Swept stopped blade',(0,0,.31),pts,.055,blade,.014)
        c.cylinder('Motor hub gasket',(x,y,.347),.117,.055,dark,32)
        c.ell('Raised motor crown',(x,y,.375),(.09,.09,.042),edge)
        if tier==3 and i<2: c.cylinder('Small isolated hub emitter',(x,y,.418),.033,.01,charge,20)
    # A diagonal body is split into asymmetric plates, revealing a deep cavity.
    before=set(c.scene.objects)
    plate(c,'Crushed belly',(0,0,.25),[(-.48,-.85),(.36,-.80),(.50,-.22),(.45,.65),(.20,.91),(-.34,.83),(-.52,.30)],.29,dark,.07)
    crown(c,'Broad rear cargo spine',(-.03,-.42,.36),.91,.79,.18,paint)
    crown(c,'Broad forward armor',(-.04,.51,.36),.92,.71,.22,paint)
    plate(c,'Torn left deck seam',(0,0,.45),[(-.47,-.10),(-.35,-.27),(-.14,-.14),(-.23,-.04),(-.08,.08),(-.26,.16),(-.12,.22),(-.48,.20)],.12,paint,.025)
    lid=plate(c,'Peeling right armor flap',(0,0,.49),[(.20,-.25),(.49,-.28),(.67,.02),(.55,.27),(.28,.18),(.40,.07),(.23,.02)],.10,trim,.025)
    lid.rotation_euler.y=-.22
    c.box('Exposed inner battery',(0,.03,.32),(.30,.36,.11),trim,.025)
    for x in (-.18,0,.18): c.box('Exposed rib in rupture',(x,.025,.41),(.042,.30,.06),edge,.008)
    for y in (-.66,.66):
        c.box('Heavy cargo clamp',(0,y,.593),(.77,.086,.07),dark,.015)
        for x in (-.30,.30):bolt(c,x,y,.638,edge,.038)
    c.box('Contrasting access hatch',(-.04,.47,.588),(.48,.32,.035),trim,.033)
    for y in (.40,.48,.56):c.box('Recessed cooling louvre',(-.05,y,.612),(.33,.026,.015),dark,.004)
    for x,y in [(-.32,-.65),(.25,-.44),(-.27,.75)]:
        plate(c,'Broad chipped armor scar',(x,y,.549 if y<0 else .589),[(-.02,-.075),(.033,-.04),(.013,.065),(-.035,.015)],.006,edge,.002)
    if tier==3:
        for y in (-.48,.26):c.box('Cyan service seam',(.20,y,.555),(.04,.28,.025),charge,.008)
    for ob in set(c.scene.objects)-before:
        a=-.25;x,y=ob.location.x,ob.location.y
        ob.location.x=x*math.cos(a)-y*math.sin(a);ob.location.y=x*math.sin(a)+y*math.cos(a)
        ob.rotation_euler.z+=a
    # Open boxes have real high walls, detached lids and large exposed contents.
    for x,y in [(-1.08,.02),(.91,.05)]:
        c.box('Cargo cavity',(x,y,.17),(.62,.66,.19),dark,.06)
        for side in (-1,1):c.box('Bent cargo side',(x+side*.30,y,.28),(.07,.68,.22),cargo,.02)
        c.box('Broken rear cargo lip',(x,y+.31,.29),(.65,.06,.21),cargo,.014)
        lid=c.box('Burst hinged lid',(x,y+.27,.40),(.66,.28,.08),cargo,.03);lid.rotation_euler.z=.19 if x>0 else -.27
        hazards(c,(x,y+.28,.451),.49,.10,warning,dark)
        for k in range(2):
            ob=c.box('Heavy spilled battery',(x-.13+k*.27,y-.04,.29),(.20,.30,.16),edge,.032);ob.rotation_euler.z=.2+k*.35
    # Fan of substantial salvage, confined to the right side without ground/decal.
    for i,(x,y,w,h) in enumerate([(1.23,-.32,.23,.26),(1.43,-.49,.26,.15),(1.20,-.68,.22,.24),(.66,-.45,.22,.28),(.94,-.55,.20,.22),(1.48,-.10,.18,.30)]):
        ob=c.box('Scattered folded scrap plate',(x,y,.10+i%2*.03),(w,h,.09),edge if i%2 else trim,.018)
        ob.rotation_euler.z=rng.uniform(-1,1)
        if i%2==0:bolt(c,x,y,.17, dark,.035)
    for x,y in [(1.38,-.77),(.63,-1.42),(.37,-1.05)]:
        ob=c.cylinder('Loose salvage bolt',(x,y,.11),.065,.18,edge,6);ob.rotation_euler.x=math.pi/2
    tube(c,'Severed copper cable',[(.34,-.22,.36),(.57,-.33,.20),(.67,-.56,.16),(.83,-.68,.10)],.036,copper)
    tube(c,'Loose cable loop',[(1.04,-.31,.17),(1.30,-.20,.16),(1.40,-.29,.15),(1.29,-.42,.14),(1.14,-.40,.14)],.032,dark)
    if tier==1:
        moss=surface(c,'Old moss cushions',(84,106,36),.5)
        tips=surface(c,'Dry grass blades',(152,158,66),.28)
        for x,y in [(-1.30,.88),(-.63,.73),(-1.24,-.99),(-.36,-.69)]:
            for k in range(4):
                c.ell('Clinging moss tuft',(x+rng.uniform(-.08,.08),y+rng.uniform(-.08,.08),.38),(.095,.075,.047),moss)
            for k in range(3):
                a=k*2.1;dx,dy=.14*math.cos(a),.14*math.sin(a)
                plate(c,'Grass blade cluster',(x,y,.43),[(-.035,0),(dx,dy),(.035,.035)],.01,tips,.002)
    if tier==3:
        crystal=c.cylinder('Cyan crystal in open cargo',(.90,-.01,.36),.105,.21,charge,5)
        crystal.rotation_euler.y=.25
    return finish(c,pivot)
