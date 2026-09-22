"""Distinct deployable instruments, construction packs and contact taser."""
import math
from utility_throwables_v2 import ring


def time_bubble(w):
    # An elongated instrument with open lobes, distinct from the flat translocator disk.
    w.round_body('Chronometer elongated chassis',0,[(-1.1,1.6),(-.5,3.3),(2.2,4.3),(4.8,3.3),(5.6,1.6)],w.body,z=1.2,height=1.5)
    w.ell('Ceramic chronometer core',0,2.2,3.55,3.8,w.energy,z=2.35,h=2.3)
    ring(w,'Core suspension bezel',0,2.2,1.95,w.edge,z=2.7,thickness=.16)
    for i in range(4):
        a=i*math.tau/4
        pts=[(r*math.cos(a),2.2+r*math.sin(a),z) for r,z in ((.9,3.35),(1.6,3.3),(2.1,2.85),(2.7,2.2))]
        w.path('Protective meridian rib',pts,.18,w.trim)
        w.ell('Peripheral timing resonator',2.5*math.cos(a),2.2+2.5*math.sin(a),.55,.75,w.accent,z=2.5,h=.4)
    for t in (-.65,5.1):
        w.box('Capped timing regulator',0,t,1.65,1.3,w.trim,z=1.9,h=.85,bevel=.3)
        w.box('Regulator luminous insert',0,t,.65,.63,w.accent,z=2.35,h=.1,bevel=.18)
        for x in (-.56,.56): w.screw(x,t,2.36,.1)
    for side in (-1,1):
        w.path('External chronometer cage',[(side*1.3,-.1,1.9),(side*2.8,1,2.1),(side*2.8,3.5,2.1),(side*1.3,4.5,1.9)],.16,w.edge)
    w.box('Mechanical arming slide',0,-.2,1.1,.7,w.edge,z=2.65,h=.25,bevel=.13)
    for dx in (-.3,0,.3): w.box('Arming slide grip',dx,-.2,.08,.52,w.dark,z=2.79,h=.04,bevel=.015)


def decoy(w):
    w.plate('Rectangular projector chassis',[(-2.1,-.9),(2.1,-.9),(2.7,-.2),(2.7,3.8),(1.8,4.6),(-1.8,4.6),(-2.7,3.8),(-2.7,-.2)],w.body,z=1.3,h=1.8,bevel=.3)
    w.box('Recessed optical deck',0,2,3.7,4.3,w.steel,z=2.3,h=.3,bevel=.24)
    w.disk('Projector lens well',0,2,1.7,w.black,z=2.35,h=.6)
    w.disk('Blue holographic lens',0,2,1.3,w.energy,z=2.68,h=.14)
    ring(w,'Concentric optical focus ring',0,2,.8,w.trim,z=2.78,thickness=.08)
    w.disk('Optical iris',0,2,.38,w.accent,z=2.78,h=.08)
    for side in (-1,1):
        w.box('Protective projector spar',side*2.15,2,.65,3.75,w.trim,z=2.3,h=.65,bevel=.25)
        for t in (.8,1.5,2.2,2.9): w.vent(side*2.15,t,.43,z=2.66)
        for t in (-.35,3.8): w.screw(side*2.15,t,2.66,.13)
    w.barrel('Retracted telescopic antenna',1.3,4,6.3,.16,w.edge,z=1.7)
    w.barrel('Rubber antenna tip',1.3,5.6,6.4,.22,w.dark,z=1.7)
    w.box('Illuminated status panel',0,-.1,1.3,.48,w.accent,z=2.25,h=.14,bevel=.09)
    w.path('Projector carry bail',[(-1.35,-.7,1.35),(-1.35,-1.6,1.3),(1.35,-1.6,1.3),(1.35,-.7,1.35)],.18,w.dark)


def zeus(w):
    w.grip()
    w.round_body('Zeus contoured electrical housing',0,[(-.85,2.5),(-.4,3.5),(2.8,3.8),(6,3.5),(7.6,2.9)],w.body,z=1.95,height=2.35)
    for side in (-1,1):
        w.plate('Worn yellow insulated shoulder',[(side*.8,-.5),(side*1.55,0),(side*1.7,3.6),(side*1.6,6.4),(side*.95,6.7)],w.trim,z=2.85,h=.62,bevel=.18)
        for t in (.2,.75,1.3): w.box('Rubber grip rib',side*1.2,t,.55,.2,w.dark,z=3.15,h=.2,bevel=.06)
        w.screw(side*1.3,2.4,3.22,.12)
        w.box('Front insulated electrode shoe',side*1.05,7.1,.95,2.3,w.dark,z=2.25,h=1.2,bevel=.2)
        w.barrel('Exposed twin contact terminal',side*1.05,7.8,9,.25,w.edge,z=2.25,hollow=False)
        for t in (8,8.25,8.5): w.barrel('Terminal machined ring',side*1.05,t,t+.10,.30,w.edge,z=2.25)
    w.box('Recessed top service panel',0,3.85,1.45,3.3,w.steel,z=3.16,h=.23,bevel=.17)
    w.plate('Lightning safety marking',[(-.13,4.75),(-.48,3.8),(-.05,3.86),(-.25,3.05),(.53,4.15),(.1,4.10),(.36,4.75)],w.accent,z=3.30,h=.025,bevel=.02)
    w.box('Battery status bezel',0,1.65,1.5,.68,w.black,z=3.29,h=.15,bevel=.1)
    for x in (-.4,0,.4): w.box('Battery charge indicator',x,1.65,.22,.29,w.energy,z=3.38,h=.03,bevel=.03)
    w.box('Replaceable cartridge latch',0,6.2,1.55,.6,w.edge,z=3.14,h=.27,bevel=.1)


def rock(w):
    # A compact deployable masonry pack. This is not the world-sized barrier.
    w.box('Construction pack base',0,2,4.9,5.5,w.dark,z=.8,h=.65,bevel=.5)
    stone=w.material('Weathered construction stone',(.25,.27,.25),kind='composite')
    for x,t,width,length,z in [(-1.05,.25,2.2,2.1,1.8),(1.1,.4,2,2.5,2),(-1.2,2.6,2.4,2.6,2),(1.1,2.7,2.3,2.4,2.2),(0,4.2,2.2,1.5,1.9)]:
        w.plate('Chipped stone block',[(x-width*.4,t-length*.5),(x+width*.28,t-length*.46),(x+width*.5,t-.2),(x+width*.39,t+length*.39),(x-width*.26,t+length*.5),(x-width*.5,t)],stone,z=z,h=1.6,bevel=.3)
    for x in (-1.85,1.85):
        w.path('Brass retaining strap',[(x,-.8,1.3),(x,-.4,2.8),(x,2,3.25),(x,4.3,2.7),(x,4.8,1.3)],.19,w.trim)
        w.screw(x,2,3.45,.13)
    w.box('Clamping crossbar',0,2,4.5,.53,w.trim,z=3.35,h=.35,bevel=.1)
    w.box('Construction latch',0,2,1,.95,w.steel,z=3.58,h=.2,bevel=.14)
    w.path('Pack carry loop',[(-1,-.55,1.6),(-1,-1.5,1.4),(1,-1.5,1.4),(1,-.55,1.6)],.18,w.dark)


def spore(w):
    stem=w.material('Ivory fibrous mushroom stalk',(.45,.36,.20),kind='composite')
    cap=w.material('Mature russet mushroom cap',(.37,.035,.016),kind='composite')
    w.round_body('Thick cultivated stalk',0,[(-1,1.3),(-.4,1.9),(2.3,2.3),(3.1,1.3)],stem,z=1.4,height=2.4)
    for x in (-.55,0,.55): w.path('Stem fibrous ridge',[(x,-.5,2.35),(x+.08,1,2.65),(x-.1,2.4,2.25)],.055,w.trim)
    w.ell('Underside mushroom gills',0,3.15,5.8,4.5,stem,z=1.8,h=1.1)
    w.ell('Rounded red mushroom canopy',0,3.3,6.15,4.6,cap,z=2.25,h=2.3)
    for x,t,r in [(-1.8,3.1,.39),(-1,4.45,.37),(.35,4.75,.35),(1.7,3.9,.44),(1.35,2.6,.39),(-.4,2.9,.52),(-1,1.8,.26),(.45,1.85,.3)]:
        z=2.25+1.15*math.sqrt(max(0,1-(x/3.075)**2-((t-3.3)/2.3)**2))
        w.ell('Ivory cap scale',x,t,r*2,r*1.6,stem,z=z,h=.13)
    w.barrel('Protective spore nozzle',1.05,.5,1.7,.43,w.body,z=1.5,hollow=True)
