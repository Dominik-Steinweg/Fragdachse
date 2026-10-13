"""Burst supply capsule, collapsed parachute and three matching portable crates."""
from dawn_parts import root,finish,supply_palette,supply_crate,draped_canvas,crown,plate,tube,bolt


def build(c,spec):
    pivot=root(c);p=supply_palette(c)
    c.box('Crushed capsule keel',(0,-.12,.17),(1.64,1.79,.29),p['dark'],.25)
    crown(c,'Capsule raised hull',(0,-.11,.27),1.57,1.69,.23,p['brass'])
    c.box('Burst dark cargo cavity',(0,-.12,.54),(1.18,1.27,.14),p['dark'],.16)
    for side in (-1,1):
        crown(c,'Thick yellow capsule side',(side*.66,-.13,.48),.26,1.62,.23,p['paint'])
        for y in (-.67,.41):
            c.box('Impact hoop',(side*.67,y,.71),(.33,.12,.065),p['edge'],.023)
            bolt(c,side*.67,y,.76,p['dark'],.037)
    crown(c,'Broken pod nose',(0,-.87,.35),1.15,.23,.20,p['paint'])
    supply_crate(c,(-.13,-.08,.49),.76,-.14,p).parent=pivot
    # Bent-open lid retains a hinge edge, exposing the central cargo cavity.
    plate(c,'Peeled ochre hatch',(.78,-.32,.54),[(0,-.55),(.54,-.49),(.78,-.15),(.68,.45),(.10,.53),(-.08,.22)],.085,p['paint'],.04).rotation_euler.y=.20
    for y in (-.63,.05):tube(c,'Hatch raised reinforcing rib',[(.86,y,.66),(1.10,y+.06,.65),(1.38,y+.13,.57)],.035,p['brass'],10)
    # Exposed impact ribs and a diagonal torn nose lip distinguish the crash site.
    for y in (-.60,.28):
        tube(c,'Exposed capsule floor rib',[(-.44,y,.615),(.20,y,.615),(.42,y+.10,.615)],.026,p['brass'],10)
    plate(c,'Torn dark nose notch',(.31,-.88,.58),[(-.10,-.08),(.13,-.08),(.04,.13)],.02,p['dark'],.006)
    draped_canvas(c,p)
    for side in (-1,1):
        tube(c,'Slack suspension cord',[(side*.61,.46,.66),(side*1.23,.73,.12),(side*1.40,.24,.09),(side*.84,-.62,.13)],.013,p['edge'],8)
    for x,y,a,s in [(-1.09,-.55,-.28,.71),(-.61,-1.30,.23,.65),(.53,-1.30,-.21,.67)]:
        supply_crate(c,(x,y,.06),s,a,p).parent=pivot
    return finish(c,pivot)
