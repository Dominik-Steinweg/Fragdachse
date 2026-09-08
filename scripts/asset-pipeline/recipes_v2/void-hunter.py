"""Long predatory four-legged void hunter with tapered armor and twin body-mounted gauss rails."""
from enemy_parts_b import plate, scute, tube, head, paw, finish


def build(c, spec):
    hide=c.material('Hunter deep violet flexible hide',(.023,.017,.043),'organic')
    armor=c.material('Hunter charcoal violet armor',(.045,.038,.065),'technical')
    edge=c.material('Hunter muted mauve armor edge',(.17,.135,.205),'technical')
    dark=c.material('Hunter black mechanical joints',(.008,.011,.017))
    bone=c.material('Hunter smoky ivory face crest',(.37,.31,.43),'organic')
    violet=c.material('Hunter narrow violet inlays',(.25,.025,.53),emission=.40)
    claw=c.material('Hunter long cold talons',(.30,.29,.34),'technical')
    limbs={}
    for name,x,y in [('front_left',-.80,.52),('front_right',.80,.52),('rear_left',-.75,-.71),('rear_right',.75,-.71)]:
        limbs[name]=paw(c,name,(x*.62,y-.15,.39),(x,y,.16),.16,hide,dark,claw,armor)
        limbs[name][1].append(scute(c,'Blade-shaped hunter shin',(x*.88,y-.12,.45),.28,.62,edge,.11))
        limbs[name][1].append(tube(c,'Inset limb rune',[(x,y-.32,.50),(x*1.02,y-.12,.52),
            (x,y+.02,.40)],.018,violet))
    body=[c.ell('Long lean predator thorax',(0,-.13,.64),(.45,.99,.40),hide)]
    # A pointed uninterrupted outline remains long and narrow, unlike the broad colossus.
    body.append(plate(c,'Long angular mantle',(0,-.13,.97),
        [(0,1.02),(.34,.70),(.52,.24),(.40,-.50),(.18,-1.02),(0,-1.14),(-.18,-1.02),(-.40,-.50),(-.52,.24),(-.34,.70)],.12,armor,.035))
    for i,(y,w) in enumerate([(.58,.57),(.26,.73),(-.07,.68),(-.40,.57),(-.71,.38)]):
        body.append(scute(c,'Overlapping faceted hunter plate',(0,y,1.075),w,.44,edge if i in (0,3) else armor,.09))
        body.append(tube(c,'Narrow violet chevron seam',[(-w*.34,y+.08,1.14),(0,y-.13,1.15),
            (w*.34,y+.08,1.14)],.016,violet))
    body.append(plate(c,'Central black gauss channel',(0,-.05,1.175),
        [(-.075,.74),(.075,.74),(.055,-.81),(0,-.91),(-.055,-.81)],.025,dark,.009))
    body.append(tube(c,'Broken central power filament',[(0,.56,1.20),(0,.24,1.20),(.035,.13,1.20)],.019,violet))
    for side in (-1,1):
        for y,width in [(.38,.27),(-.10,.30),(-.57,.24)]:
            body.append(plate(c,'Separated pointed side armor',(side*.50,y,.86),
                [(side*x,py) for x,py in [(-.07,.21),(width*.60,.24),(width,.065),
                 (width*.62,-.17),(.02,-.30),(-.10,-.14)]],.13,armor,.028))
        body.append(c.box('Body mounted gauss rail',(side*.61,.37,.77),(.14,.80,.17),dark,.025))
        body.append(tube(c,'Narrow weapon charge strip',[(side*.66,.04,.895),(side*.66,.65,.895)],.018,violet))
        body.append(scute(c,'Rear pointed hunter fin',(side*.32,-.98,.62),.24,.74,edge,.08))
    skull=head(c,(0,1.01,1.08),.195,.39,bone,armor,dark,violet)
    skull.append(scute(c,'Elongated north forehead blade',(0,.76,1.265),.12,.49,edge,.07))
    tail=[scute(c,'Long tapering hunter tail',(0,-1.24,.41),.28,.70,armor,.11),
        tube(c,'Attached tail inlay',[(0,-1.06,.48),(0,-1.43,.49)],.018,violet)]
    return finish(c,limbs,body,skull,(0,.65,.93),{'tail':((0,-.96,.40),tail)})
