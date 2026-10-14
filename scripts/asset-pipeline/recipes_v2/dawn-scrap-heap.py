"""Tiered scrap heap: half-buried ribbed panel, gear, pipes and leafy pockets."""
import math
from dawn_parts import root,finish,salvage_palette,salvage_gear,vegetation,plate,tube,crown,hazards,bolt


def build(c,spec):
    pivot=root(c);tier=int(spec['model']['tier']);p=salvage_palette(c,tier,spec)
    plate(c,'Broken hull panel',(-.23,.12,.15),[(-.69,-.44),(.32,-.55),(.71,-.15),(.46,.54),(.05,.48),(-.12,.68),(-.61,.49)],.12,p['paint'],.035)
    for i in range(4):
        ob=crown(c,'Bent stamped panel rib',(-.56+i*.22,.17,.28),.10,.70,.08,p['trim']);ob.rotation_euler.z=-.18
    plate(c,'Buried lower metal sheet',(.34,-.52,.055),[(-.61,-.12),(.12,-.40),(.57,-.12),(.62,.33),(.10,.36)],.085,p['trim'],.024)
    salvage_gear(c,(.41,.22,.43),.37,p)
    for i,(x,y,a) in enumerate([(-.50,-.51,-.48),(.23,-.48,.39),(.72,-.22,.75)]):
        tube(c,'Split curved hydraulic line',[(x-.17,y-.21,.18),(x-.17,y+.02,.26),(x,y+.18,.28),(x+.16,y+.16,.25)],.056,p['edge'],12)
    crown(c,'Crushed equipment casing',(-.54,.63,.23),.52,.39,.19,p['paint'])
    for x in (-.70,-.39):bolt(c,x,.63,.44,p['dark'],.045)
    if tier==2:hazards(c,(-.29,-.12,.37),.68,.14,p['warning'],p['dark'])
    if tier==3:tube(c,'Sparse cyan panel join',[(-.78,-.20,.32),(-.68,-.37,.32),(-.14,-.43,.32)],.017,p['cyan'],8)
    # Vegetation overlaps metal lips so the objects read as partly buried.
    for x,y,z,s in [(-.82,-.32,.26,.85),(.75,.62,.12,.78),(.24,-.78,.17,.80),(-.61,.84,.18,.58),(.17,-.10,.31,.57)]:
        vegetation(c,x,y,z,p,s if tier==1 else s*.72)
    for i in range(5):
        x=math.sin(i*4.2)*.85;y=math.cos(i*3.1)*.75
        ob=plate(c,'Dead fallen leaf',(x,y,.075),[(-.07,0),(0,.13),(.08,.02),(0,-.10)],.012,p['moss'] if i%2 else p['trim'],.003);ob.rotation_euler.z=i
    return finish(c,pivot)
