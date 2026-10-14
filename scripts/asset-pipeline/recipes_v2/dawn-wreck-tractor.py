"""Overturned agricultural salvage: broken cowling, crushed seat and loose wheel."""
import math
from dawn_parts import surface,root,finish,beam,bolt,plate,tube,annulus,crown,hazards,salvage_palette,vegetation,tire,group


def build(c,spec):
    tier=int(spec['model']['tier']);p=salvage_palette(c,tier,spec);pivot=root(c)
    # The farm machine lies on its flank: rear axle face visible, one front wheel gone.
    c.box('Bent central chassis',(-.05,.10,.28),(2.20,.73,.28),p['dark'],.09)
    beam(c,'Exposed rear axle',(.76,-.80),(.76,.85),.17,.39,p['dark'])
    tire(c,(.72,.70,.37),.53,.31,p,(.32,0,0)).parent=pivot
    tire(c,(.78,-.53,.55),.51,.32,p,(1.23,0,0)).parent=pivot
    tire(c,(-.98,.66,.25),.32,.22,p,(1.16,0,.08)).parent=pivot
    tire(c,(-.85,-.99,.20),.37,.20,p,(.12,.23,-.30)).parent=pivot
    beam(c,'Sheared front axle',(-.96,-.58),(-.96,.58),.11,.20,p['edge'])
    crown(c,'Rolled engine hood',(-.68,.05,.40),1.03,.83,.23,p['paint'])
    crown(c,'Contrasting raised service hatch',(-.82,.04,.635),.48,.54,.055,p['trim'])
    plate(c,'Jagged torn bonnet edge',(0,0,.59),[(-.32,-.38),(-.02,-.38),(-.12,-.21),(.01,-.12),(-.18,-.02),(-.07,.12),(-.29,.29)],.09,p['paint'],.026)
    for x in (-.92,-.81,-.70,-.59):
        c.box('Deep engine cooling slit',(x,-.05,.704),(.037,.32,.021),p['dark'],.008)
    plate(c,'Exposed bright torn bonnet metal',(0,0,.65),[(-.28,-.36),(-.23,-.23),(-.12,-.20),(-.18,-.15),(-.08,-.09),(-.21,-.07),(-.20,.03),(-.29,.09)],.025,p['edge'],.008)
    c.cylinder('Fuel cap base',(-.71,.29,.655),.11,.04,p['dark'],24)
    c.cylinder('Rubbed fuel cap',(-.71,.29,.685),.082,.034,p['edge'],12)
    for i in range(3):
        c.box('Exposed engine block rib',(-.17+i*.12,.04,.38),(.057,.52,.19),p['edge'],.02)
    tube(c,'Bent exposed exhaust',[(-.40,.35,.63),(-.20,.53,.64),(.07,.59,.47),(.19,.78,.39)],.065,p['trim'],12)
    tube(c,'Crushed radiator guard',[(-1.27,-.34,.32),(-1.39,-.28,.38),(-1.40,.30,.38),(-1.26,.38,.32)],.047,p['edge'],12)
    # Crumpled driving station, recognisable steering ring and torn seat.
    c.box('Driver floor pan',(.40,.10,.34),(.67,.75,.15),p['trim'],.04)
    seat=c.box('Torn tractor seat cushion',(.66,.04,.53),(.43,.48,.14),p['rubber'],.08);seat.rotation_euler.z=-.18
    plate(c,'Torn seat stuffing',(.61,-.05,.607),[(-.09,-.035),(-.02,-.07),(.075,-.018),(.03,.024),(-.04,.009)],.012,p['trim'],.006)
    seat=c.box('Collapsed seat back',(.91,.12,.61),(.17,.51,.17),p['trim'],.06);seat.rotation_euler.z=-.25
    annulus(c,'Steering wheel',(.23,.18,.60),.20,.162,.045,p['dark'],steps=36)
    for a in (0,2.1,4.2):beam(c,'Steering spoke',(.23,.18),(.23+.17*math.cos(a),.18+.17*math.sin(a)),.026,.606,p['edge'])
    bolt(c,.23,.18,.635,p['trim'],.056)
    for y in (-.33,.44):
        f=crown(c,'Buckled rear mudguard',(.79,y,.62),.83,.20,.085,p['paint']);f.rotation_euler.z=-.14 if y<0 else .09
    tube(c,'Collapsed rollbar',[(.35,-.29,.43),(.40,-.48,.47),(.98,-.46,.56),(1.19,.08,.52),(1.01,.40,.43)],.049,p['trim'],12)
    for y in (-.18,.22):beam(c,'Rear drawbar',(.99,y),(1.44,y-.13),.08,.24,p['edge'])
    for x,y,a in [(1.23,-.80,.55),(.18,-1.10,-.40),(1.26,.48,.7),(-.24,-.62,.1)]:
        ob=plate(c,'Scattered torn sheet',(x,y,.09),[(-.14,-.10),(.09,-.13),(.15,.03),(.06,.12),(-.015,.045),(-.12,.09)],.075,p['paint'] if x<1 else p['edge'],.016);ob.rotation_euler.z=a
        bolt(c,x,y,.142,p['dark'],.034)
    tube(c,'Severed engine hose',[(-.10,-.17,.48),(.15,-.43,.30),(.02,-.68,.12),(.24,-.83,.10)],.038,p['dark'],12)
    if tier==2:hazards(c,(-.88,-.29,.625),.44,.09,p['warning'],p['dark'])
    if tier==3:
        for x in (-1.01,-.48):c.box('Sparse cyan bonnet seam',(x,.05,.648),(.023,.36,.018),p['cyan'],.005)
    if tier==1:
        for x,y,z,size in [(-.22,.36,.46,.8),(.57,-.25,.67,.7),(.92,.79,.57,.8),(-.92,-1.00,.35,.5),(-1.04,.54,.48,.65)]:vegetation(c,x,y,z,p,size)
    return finish(c,pivot)
