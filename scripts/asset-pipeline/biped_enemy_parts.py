"""Player-derived muscular badger anatomy with independently authored enemy equipment."""
from recipes_v2 import badger
from enemy_parts_b import scute, tube
from enemy_surface_parts import finish_surfaces
from rigs_v2 import attach


def build(c,spec,kind):
    asset=badger.build(c,spec)
    before={m for ob in c.scene.objects if ob.type=='MESH' for m in ob.data.materials}
    alien=kind=='alien'
    shell=c.material('Jade alien carapace' if alien else 'Burnt orange fireproof shell',
                     (.055,.38,.32) if alien else (.52,.16,.035),'technical')
    rim=c.material('Pearl mint chitin' if alien else 'Warm ceramic armor edges',
                   (.36,.66,.52) if alien else (.78,.42,.075),'technical')
    dark=c.material('Graphite equipment recess',(.018,.031,.038))
    energy=c.material('Contained turquoise organ' if alien else 'Amber furnace ceramic',
                      (.06,.72,.69) if alien else (.95,.32,.028),emission=.15)
    body=[]
    for side in (-1,1):
        body.append(scute(c,'Rounded grown shoulder guard',(side*.57,-.27,1.68),.43,.44,shell,.18))
        body.append(scute(c,'Inset shoulder identity field',(side*.58,-.25,1.78),.29,.24,rim,.04))
        body.append(scute(c,'Rounded dorsal hip shield',(side*.32,-.51,1.44),.32,.37,shell,.16))
        body.append(tube(c,'Short inset equipment seam',[(side*.47,-.36,1.78),(side*.59,-.34,1.80),(side*.67,-.24,1.77)],.012,dark,16))
        for y in (-.31,-.23): body.append(c.ell('Recessed shoulder attachment',(side*.65,y,1.79),(.018,.018,.008),dark))
    if alien:
        for x,y,r in [(-.26,-.48,.11),(0,-.57,.14),(.26,-.48,.11)]:
            body.append(c.ell('Smooth alien neural organ',(x,y,1.66),(r,r*1.25,.09),energy))
            body.append(scute(c,'Pearl organ collar',(x,y-.015,1.59),r*2.6,r*3,shell,.09))
        for side in (-1,1):
            body.append(scute(c,'Swept alien forearm armor',(side*.61,.38,1.60),.25,.40,shell,.14))
            body.append(c.ell('Small cyan forearm inset',(side*.60,.38,1.677),(.035,.11,.015),energy))
    else:
        body.append(c.ell('Oval recessed furnace carrier',(0,-.54,1.58),(.27,.17,.11),dark))
        body.append(c.ell('Warm oval furnace',(0,-.55,1.69),(.19,.115,.055),energy))
        for x in (-.10,0,.10): body.append(c.box('Curved furnace protective rib',(x,-.55,1.73),(.027,.20,.028),dark,.012))
        for side in (-1,1): body.append(c.ell('Rounded fuel canister',(side*.45,-.48,1.42),(.11,.25,.10),rim))
        pistol=[c.box('North-facing compact flame pistol',(.13,.83,1.62),(.145,.45,.12),dark,.035),
                c.box('Warm pistol crown',(.13,.81,1.697),(.10,.27,.02),shell,.009),
                c.ell('Recessed flame nozzle',(.13,1.035,1.64),(.045,.05,.035),rim)]
        attach(pistol,asset['root'])
    attach(body,asset['parts']['body'])
    after={m for ob in c.scene.objects if ob.type=='MESH' for m in ob.data.materials}
    finish_surfaces(c.scene,after-before)
    return asset
