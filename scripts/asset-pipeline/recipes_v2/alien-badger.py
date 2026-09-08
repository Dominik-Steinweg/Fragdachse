"""Armored alien biped: tapered thorax, articulated plasma arms and exposed digitigrade feet."""
from enemy_parts_b import plate, scute, tube, head, paw, finish


def build(c, spec):
    hide=c.material('Alien midnight violet joints',(.018,.020,.055),'organic')
    blue=c.material('Alien blue violet carapace',(.050,.075,.24),'technical')
    edge=c.material('Alien muted periwinkle plates',(.115,.15,.31),'technical')
    pale=c.material('Alien cool bone crest',(.50,.60,.66),'organic')
    black=c.material('Alien graphite dorsal recess',(.008,.013,.022))
    cyan=c.material('Alien inset cyan conduits',(.008,.34,.52),emission=.22)
    claw=c.material('Alien weathered talons',(.26,.38,.43),'technical')
    limbs={}
    for side,name in [(-1,'left_leg'),(1,'right_leg')]:
        limbs[name]=paw(c,name,(side*.39,-.37,.50),(side*.59,-.72,.18),.175,hide,blue,claw,edge)
        limbs[name][1].append(scute(c,'Tapered alien shin',(side*.51,-.51,.39),.28,.39,blue,.10))
    body=[c.ell('Narrow alien waist',(0,-.42,.71),(.40,.40,.33),hide),
          c.ell('High insectile ribcage',(0,-.07,.91),(.53,.51,.39),blue)]
    body.append(plate(c,'Recessed dorsal reactor',(0,-.14,1.275),
        [(-.22,.31),(.22,.31),(.30,.10),(.21,-.35),(0,-.43),(-.21,-.35),(-.30,.10)],.035,black))
    for y,w in [(.12,.43),(-.12,.48),(-.36,.34)]:
        body.append(scute(c,'Overlapping central chitin',(0,y,1.325),w,.26,edge,.075))
        body.append(tube(c,'Inset carapace joint',[(-w*.28,y+.01,1.367),(0,y-.055,1.37),
            (w*.28,y+.01,1.367)],.013,black))
    body.append(c.ell('Small recessed cyan dorsal core',(0,-.13,1.386),(.060,.065,.016),cyan))
    for side in (-1,1):
        body.append(tube(c,'Broken cyan dorsal trace',[(side*.25,.18,1.30),(side*.30,-.05,1.315),
            (side*.22,-.38,1.17)],.025,cyan))
        body.append(scute(c,'Swept shoulder shield',(side*.48,.10,1.11),.48,.67,blue,.15))
        body.append(scute(c,'Raised shoulder edge',(side*.49,.17,1.20),.34,.43,edge,.045))
    arms={}
    for side,name in [(-1,'left_arm'),(1,'right_arm')]:
        objects=[c.ell('Sloping alien upper arm',(side*.68,.015,.79),(.16,.25,.17),hide),
            scute(c,'Angular elbow shell',(side*.81,.09,.90),.32,.36,blue,.14),
            scute(c,'Long plasma forearm',(side*.80,.29,.85),.27,.44,edge,.12),
            c.ell('Closed three finger grip',(side*.75,.49,.81),(.11,.115,.075),black)]
        objects.append(tube(c,'Arm-local plasma channel',[(side*.86,.13,.99),(side*.89,.28,.96),
            (side*.82,.43,.925)],.020,cyan))
        for offset in (-.06,.06):
            objects.append(c.ell('Restrained alien claw',(side*.75+offset,.58,.85),(.020,.060,.017),claw))
        arms[name]=((side*.52,.11,.90),objects)
    skull=head(c,(0,.62,1.28),.245,.39,pale,blue,black,cyan)
    skull.append(scute(c,'Split alien occipital crest',(0,.28,1.435),.19,.32,edge,.07))
    tail=[scute(c,'Tapered alien tail base',(0,-.77,.48),.28,.34,blue,.12),
          scute(c,'Alien tail tip',(0,-.98,.34),.16,.28,edge,.06)]
    arms['tail']=((0,-.60,.47),tail)
    return finish(c,limbs,body,skull,(0,.27,1.10),arms)
