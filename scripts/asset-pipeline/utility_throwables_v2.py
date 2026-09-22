"""Hand-sized throwables; details wrap around solid shells in the +Y hold plane."""
import math


def ring(w, name, x, t, radius, mat, z=3, thickness=.10):
    w.path(name, [(x+radius*math.cos(i*math.tau/48), t+radius*math.sin(i*math.tau/48), z)
                  for i in range(49)], thickness, mat)


def fuse(w, top):
    w.barrel('Threaded fuse collar',0,top-.6,top+.25,.65,w.steel,z=2.1)
    w.box('Fuze striker head',0,top+.15,1.35,.95,w.edge,z=2.55,h=.8,bevel=.2)
    w.path('Bent safety spoon',[(.2,top+.5,3.03),(.8,top+.2,3.05),(1.3,top-1,2.95),(1.8,top-2.9,2.15)],.16,w.steel)
    w.path('Cotter safety pin',[(-.15,top,2.8),(-1.5,top,2.8)],.09,w.brass)
    ring(w,'Safety pull ring',-1.65,top-.42,.57,w.edge,2.9,.105)
    w.screw(0,top+.22,3.0,.15)


def grenade(w):
    w.ell('Cast steel grenade body',0,2.25,4.7,5.6,w.body,z=2,h=3.9)
    # Incised grid follows the curved casing instead of a pile of square blocks.
    for t in (.55,1.7,2.85,3.95):
        dy=(t-2.25)/2.8; half=2.35*math.sqrt(1-dy*dy)
        w.path('Cast transverse fragmentation groove',[(half*f,t,2+1.95*math.sqrt(max(0,1-dy*dy-(half*f/2.35)**2))+.025)
            for f in [-.93+i*1.86/20 for i in range(21)]],.045,w.dark)
    for dx in (-1.15,0,1.15):
        w.path('Longitudinal casing groove',[(dx,t,2+1.95*math.sqrt(max(0,1-(dx/2.35)**2-((t-2.25)/2.8)**2))+.025)
            for t in [.25+i*4/24 for i in range(25)]],.04,w.dark)
    w.box('Faded yellow identification mark',-.52,2.25,.65,.8,w.accent,z=3.94,h=.04,bevel=.03)
    fuse(w,5.0)


def smoke(w):
    w.round_body('Pressed smoke canister',0,[(-.65,2.8),(-.35,3.9),(.2,4.1),(4.5,4.1),(5.05,3.2),(5.2,2.7)],w.body,z=2,height=3.5)
    for t in (-.2,4.6): w.barrel('Rolled canister seam',0,t-.13,t+.13,2.1,w.edge,z=2)
    w.barrel('Olive smoke identification band',0,2.1,3.7,2.07,w.accent,z=2)
    for t in (.4,1.15):
        for x in (-1.1,0,1.1): w.ell('Recessed smoke exhaust',x,t,.45,.58,w.black,z=3.73-.25*abs(x),h=.10)
    w.box('Batch plate',0,2.9,1.25,.75,w.trim,z=4.1,h=.055,bevel=.04)
    for dx in (-.4,0,.4): w.box('Stamped plate marking',dx,2.9,.15,.38,w.edge,z=4.14,h=.025,bevel=.01)
    fuse(w,5.5)


def molotov(w):
    glass=w.material('Weathered blue green bottle glass',(.065,.20,.20),kind='composite')
    bsdf=glass.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Transmission Weight'].default_value=.8
    bsdf.inputs['IOR'].default_value=1.46
    w.round_body('Heavy glass bottle',0,[(-1,2.6),(-.75,3.4),(-.35,3.8),(3.25,3.8),(4.1,2.25),(4.8,1.2),(7.0,1.2),(7.1,.95)],glass,z=2,height=3.2)
    w.round_body('Amber fuel inside bottle',0,[(-.5,2.6),(0,3.05),(2.4,3.05),(3.2,2.1)],w.trim,z=2.1,height=2.85)
    # A warm stained broad face survives reduction while the perimeter retains blue glass.
    w.round_body('Fuel colored broad glass face',0,[(-.45,2.1),(0,2.8),(2.65,2.8),(3.1,1.8)],w.trim,z=3.63,height=.45)
    w.barrel('Bottle neck lip',0,6.6,7.05,.75,glass,z=2)
    paper=w.material('Stained paper label',(.34,.25,.11),kind='composite')
    w.plate('Torn kraft bottle label',[(-1,0),(.9,0),(1,.5),(.85,.75),(-.4,.85),(-1,.55)],paper,z=3.88,h=.055,bevel=.07)
    for x in (-.6,-.35,0,.4,.65): w.box('Worn print on bottle label',x,.4,.12,.35,w.body,z=3.92,h=.025,bevel=.01)
    w.path('Longitudinal worn glass highlight',[(-1.45,-.4,2.7),(-1.58,1.2,2.7),(-1.45,3,2.7),(-.65,4.2,2.7)],.045,w.edge)
    cloth=w.material('Charred woven wick',(.23,.15,.073),kind='rubber')
    w.path('Twisted cloth wick',[(0,6.65,2.1),(.15,7.4,2.25),(-.35,8.1,2.45),(-.1,8.75,2.6)],.3,cloth)
    w.path('Wick seam',[(-.17,6.8,2.3),(-.03,7.4,2.5),(-.55,8.1,2.58)],.05,w.edge)
    w.ell('Sooted wick tip',-.1,8.72,.6,.6,w.black,z=2.6,h=.55)


def stink(w):
    w.round_body('Violet central atomizer',0,[(-1,2.1),(-.7,2.7),(3.6,2.7),(4.3,1.6)],w.body,z=2,height=2.3)
    for side in (-1,1):
        x=side*1.65
        w.tank('Sealed bile cartridge',x,-.25,3.8,1.05,w.accent,z=1.75)
        w.path('Cartridge restraint',[(x,-.0,2.6),(x,1.5,2.94),(x,3,2.6)],.15,w.trim)
        w.box('Cartridge inspection slit',x-side*.48,1.7,.32,1.4,w.energy,z=2.66,h=.1,bevel=.12)
        w.screw(x,1.6,3.1,.12)
    w.barrel('Atomizer neck',0,3.7,5.4,.55,w.steel,z=2.1)
    w.barrel('Protected dispersal nozzle',0,4.6,5.4,.8,w.trim,z=2.1,hollow=True)
    w.box('Safety latch',0,.5,1,1.15,w.trim,z=3.25,h=.3,bevel=.14)
    w.box('Warning inlay',0,.5,.5,.65,w.accent,z=3.43,h=.035,bevel=.06)
    for t in (2,2.6,3.2): w.vent(0,t,.9,z=3.2)
