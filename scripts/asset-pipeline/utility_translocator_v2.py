"""Loaded disc launcher: maroon receiver above a seated silver puck, facing +Y."""
import math
from utility_throwables_v2 import ring


def arc(w, name, radius, center, start, end, z, thickness, material):
    w.path(name, [(radius*math.cos(a), center+radius*math.sin(a), z)
                  for a in [start+(end-start)*i/48 for i in range(49)]], thickness, material)


def translocator(w):
    w.grip()
    # The rear grip and receiver belong to the launcher, not to the removable disc.
    w.round_body('Maroon rear receiver',0,[(-1.3,1.65),(-.6,2.6),(2.2,3.1),(3.4,2.5)],w.body,z=1.8,height=2.35)
    w.box('Rear grip heel',0,-1.1,1.9,.42,w.dark,z=1.6,h=1.8,bevel=.2)
    for side in (-1,1):
        w.plate('Receiver cheek armor',[(side*.8,-.4),(side*1.45,.35),(side*1.6,2.35),(side*.9,3.1)],w.trim,z=2.65,h=.42,bevel=.18)
        w.screw(side*1.1,1.4,2.93,.15)
    w.box('Rear charging latch',0,.2,1.5,.7,w.steel,z=3.07,h=.36,bevel=.14)
    for x in (-.48,0,.48): w.box('Charging latch fluting',x,.2,.11,.5,w.dark,z=3.27,h=.06,bevel=.02)

    # Open front cradle, with a circular puck visibly seated below the long upper spine.
    cy=7.6
    arc(w,'Lower disc cradle',4.86,cy,math.pi*.04,math.pi*.96,1.0,.25,w.steel)
    arc(w,'Rear disc cradle',4.86,cy,math.pi,math.tau,1.0,.25,w.body)
    for side in (-1,1):
        w.plate('Forked red launch rail',[(side*1.2,2.4),(side*2.15,2.7),(side*4.25,6.2),(side*4.4,10.8),
            (side*3.55,13.45),(side*2.75,13.55),(side*3.5,10.6),(side*3.5,6.55)],w.body,z=1.4,h=1.1,bevel=.27)
        w.path('Silver rail edge',[(side*2,3.1,2.02),(side*3.9,6.3,2.02),(side*4.02,10.55,2.02)],.10,w.edge)
        w.round_body('Front launch stabilizer',side*3.35,[(10.9,1.25),(11.2,1.75),(13.3,1.35),(13.65,.75)],w.trim,z=1.6,height=1.6)
        w.barrel('Stabilizer dark muzzle',side*3.35,12.7,13.65,.48,w.dark,z=1.7,hollow=True)
        w.box('Amber stabilizer telltale',side*3.35,12.7,.57,.8,w.energy,z=2.46,h=.11,bevel=.15)
        for t in (11.35,11.75): w.vent(side*3.35,t,.8,z=2.39)

    puck_start=len(w.objects)
    silver=w.material('Worn pale machined disc alloy',(.62,.65,.65),.12,kind='edge')
    w.disk('Loaded puck lower bevel',0,cy,4.70,w.steel,z=1.64,h=.45)
    w.disk('Loaded puck machined silver rim',0,cy,4.62,silver,z=1.99,h=.25)
    w.disk('Loaded puck recessed top',0,cy,3.82,w.steel,z=2.10,h=.15)
    ring(w,'Puck outer rolled lip',0,cy,4.53,silver,z=2.17,thickness=.09)
    ring(w,'Puck perimeter machining groove',0,cy,4.24,w.steel,z=2.15,thickness=.04)
    ring(w,'Puck raised inner ring',0,cy,3.89,silver,z=2.20,thickness=.07)
    w.ell('Puck shallow copper crown',0,cy,5.7,5.7,w.body,z=2.09,h=.9)
    ring(w,'Orange puck induction channel',0,cy,2.5,w.energy,z=2.4,thickness=.15)
    for i in range(10):
        a=i*math.tau/10
        x,t=3.18*math.cos(a),cy+3.18*math.sin(a)
        ob=w.box('Radial puck service panel',x,t,.65,1.02,w.dark,z=2.35,h=.10,bevel=.1)
        ob.rotation_euler.z=a-math.pi/2
        ob=w.box('Amber puck induction inset',2.61*math.cos(a),cy+2.61*math.sin(a),.40,.48,w.energy,z=2.55,h=.08,bevel=.08)
        ob.rotation_euler.z=a-math.pi/2
        x,t=4.09*math.cos(a),cy+4.09*math.sin(a)
        w.disk('Copper puck rim insert',x,t,.23,w.trim,z=2.21,h=.07)
        w.disk('Puck rim fastener',x,t,.10,w.edge,z=2.26,h=.045)
    for ob in w.objects[puck_start:]: ob['utilityPart']='loaded-puck'

    # Raised upper receiver overlaps the disc's center; both silver crescent sides stay visible.
    receiver_start=len(w.objects)
    w.round_body('Long maroon launcher spine',0,[(1.5,1.8),(2.2,2.6),(5.7,2.6),(6.3,3.35),(10.8,3.55),(12.75,2.9)],w.body,z=3.05,height=1.7)
    w.plate('Rounded red dorsal armor',[(-1.08,3),(-1.05,5.7),(-1.5,6.4),(-1.45,10.7),(-.85,11.9),(.9,11.9),
        (1.5,10.7),(1.4,6.4),(.95,5.6),(.95,3)],w.trim,z=3.71,h=.43,bevel=.23)
    w.path('Armor plate silver border',[(-1.01,3,3.95),(-1.01,5.8,3.96),(-1.34,6.5,3.96),(-1.33,10.6,3.96),(-.8,11.6,3.96)],.065,w.edge)
    w.path('Long exposed pneumatic pipe',[(1.32,2.0,2.9),(1.58,3.8,3.1),(1.58,5.5,3.1),(1.85,6.5,3.0)],.18,w.steel)
    for t in (2.7,4.65): w.box('Pneumatic pipe clip',1.55,t,.55,.3,w.edge,z=3.17,h=.16,bevel=.05)
    w.plate('Inset triangular vent plate',[(-.98,6.45),(.94,6.45),(.72,8.12),(-.65,8.12)],w.steel,z=3.965,h=.10,bevel=.16)
    for x,t in [(-.52,6.9),(.45,6.9),(0,7.65)]: w.disk('Recessed vent aperture',x,t,.18,w.black,z=4.027,h=.025)
    for side in (-1,1):
        for t in (3.5,9.9,11.05): w.screw(side*(1.05 if t>8 else .8),t,3.96,.13)
    for t in (4.25,4.85):
        w.path('Worn silver receiver chevron',[(-.56,t+.25,3.955),(0,t,3.96),(.56,t+.25,3.955)],.11,w.edge)
    w.box('Armored forward shroud',0,12.35,3.1,1.6,w.steel,z=3.0,h=1.8,bevel=.38)
    w.box('Shroud center seam',0,12.35,.075,1.45,w.dark,z=3.93,h=.04,bevel=.02)
    w.box('Launcher muzzle undercut',0,13.35,2.15,.85,w.black,z=2.65,h=.6,bevel=.22)
    w.box('Amber upper muzzle inset',0,13.04,1.45,.5,w.energy,z=3.1,h=.15,bevel=.15)
    for ob in w.objects[receiver_start:]: ob['utilityPart']='launcher-receiver'
    w.path('Rear looped power cable',[(-1.25,.1,2),(-2.1,.8,2),(-2.35,2.4,1.85),(-2.0,3.3,1.8)],.24,w.dark)
    for t in (1.05,1.4,1.75,2.1): w.ell('Cable armored ferrule',-2.28,t,.66,.24,w.edge,z=1.99,h=.45)
