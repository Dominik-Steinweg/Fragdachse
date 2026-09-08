"""Compact armed biped with fireproof shoulder armor, a caged amber reactor and independent boots."""
from enemy_parts_b import plate, scute, tube, head, paw, finish


def build(c, spec):
    cloth=c.material('Pyro dark aubergine fireproof cloth',(.045,.027,.044),'organic')
    armor=c.material('Pyro soot-brown armor',(.095,.052,.043),'technical')
    edge=c.material('Pyro restrained ochre guards',(.235,.135,.045),'technical')
    dark=c.material('Pyro black gunmetal and mask',(.010,.016,.018))
    pale=c.material('Pyro smoke stained head stripe',(.45,.44,.33),'organic')
    heat=c.material('Pyro amber reactor ceramic',(.61,.13,.015),emission=.28)
    steel=c.material('Pyro grey boot toe guards',(.20,.22,.20),'technical')
    limbs={}
    for side,name in [(-1,'left_leg'),(1,'right_leg')]:
        limbs[name]=paw(c,name,(side*.31,-.35,.48),(side*.51,-.76,.17),.19,cloth,dark,steel,armor)
        limbs[name][1].append(c.box('Broad boot front guard',(side*.51,-.625,.255),(.30,.16,.085),steel,.03))
    body=[c.ell('Narrow protected waist',(0,-.43,.69),(.39,.38,.31),cloth),
          c.ell('Broad fireproof shoulder vest',(0,.05,.95),(.58,.45,.40),cloth)]
    body.append(plate(c,'Tapered armored back vest',(0,-.16,1.29),
        [(-.44,.28),(.44,.28),(.37,-.19),(.24,-.42),(-.24,-.42),(-.37,-.19)],.10,armor,.045))
    body.append(c.cylinder('Reactor dark ceramic recess',(0,-.16,1.36),.29,.07,dark,12))
    body.append(c.cylinder('Large contained amber reactor',(0,-.16,1.415),.20,.06,heat,12))
    for y in (-.29,-.16,-.03):
        body.append(c.box('Reactor protective grille',(0,y,1.468),(.41,.032,.035),dark,.006))
    for side in (-1,1):
        body.append(scute(c,'Large angular shoulder guard',(side*.51,.15,1.20),.48,.57,armor,.17))
        body.append(scute(c,'Ochre shoulder insert',(side*.54,.20,1.31),.31,.20,edge,.045))
        for y in (.085,.15):
            body.append(c.box('Recessed shoulder cooling slot',(side*.57,y,1.345),(.16,.020,.012),dark,.004))
        body.append(c.ell('Low rear armored fuel pod',(side*.32,-.51,.91),(.14,.26,.16),armor))
    arms={}
    for side,name in [(-1,'left_arm'),(1,'right_arm')]:
        objects=[c.ell('Bent fireproof upper arm',(side*.70,.17,.81),(.15,.23,.17),cloth),
            scute(c,'Protected bent forearm',(side*.69,.43,.88),.27,.43,armor,.115),
            c.ell('Small closed trigger glove',(side*.52,.62,.91),(.13,.14,.10),dark)]
        arms[name]=((side*.48,.13,1.05),objects)
    # The north-pointing compact pistol is a stable part of the aiming grip during walking.
    arms['right_arm'][1].extend([c.box('Compact pistol slide',(.44,.80,.95),(.13,.39,.12),dark,.025),
        c.box('Small pistol barrel port',(.44,.995,.97),(.075,.04,.055),steel,.009)])
    arms['left_arm'][1].append(tube(c,'Armoured glove hose',[(-.39,.05,1.14),(-.72,.18,1.03),(-.65,.48,.98)],.035,edge))
    skull=head(c,(0,.66,1.27),.245,.34,pale,dark,dark,heat)
    skull.append(scute(c,'Fireproof crown guard',(0,.40,1.45),.28,.24,armor,.055))
    for side in (-1,1):
        skull.append(c.ell('Small attached smoke respirator',(side*.145,.83,1.405),(.048,.061,.025),armor))
    return finish(c,limbs,body,skull,(0,.38,1.10),arms)
