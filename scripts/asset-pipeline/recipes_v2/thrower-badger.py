"""Four-legged carrier with an asymmetric organic launch cradle and visible curled cargo."""
from enemy_parts_b import scute, tube, head, paw, finish


def build(c, spec):
    fur=c.material('Thrower cool brown coarse hide',(.12,.10,.065),'organic')
    dark=c.material('Thrower deep carrier folds',(.018,.023,.012),'organic')
    tan=c.material('Thrower horn shoulder mantle',(.32,.27,.14),'organic')
    pale=c.material('Thrower broad bone face stripe',(.57,.51,.31),'organic')
    olive=c.material('Thrower tough olive sling',(.21,.24,.045),'organic')
    ochre=c.material('Thrower taut ochre launch tendon',(.39,.32,.065),'organic')
    cargo=c.material('Thrower curled dark offspring',(.12,.12,.055),'organic')
    limbs={}
    for name,x,y in [('front_left',-.74,.48),('front_right',.74,.48),('rear_left',-.68,-.63),('rear_right',.68,-.63)]:
        limbs[name]=paw(c,name,(x*.67,y-.07,.40),(x,y,.15),.205,fur,dark,pale,tan)
    body=[c.ell('Wide carrier shoulders',(0,.20,.61),(.64,.48,.42),fur),
          c.ell('Compact supporting ribcage',(0,-.27,.56),(.58,.67,.36),fur)]
    for y,w in [(.24,.70),(-.01,.68),(-.27,.57),(-.55,.42)]:
        body.append(scute(c,'Layered thrower vertebral shield',(0,y,1.01-abs(y)*.12),w,.35,tan,.12))
    sling=[c.ell('Large right shoulder carrying pouch',(.60,-.21,.76),(.34,.47,.32),olive),
        c.ell('Recessed open launch cradle',(.59,-.14,1.015),(.255,.35,.07),dark),
        c.ell('Curled offspring back',(.59,-.12,1.04),(.20,.27,.14),cargo),
        c.ell('Offspring tucked pale head',(.56,.04,1.16),(.105,.13,.06),pale)]
    for side in (-1,1):
        sling.append(c.ell('Offspring folded dark ear',(.56+side*.085,-.015,1.17),(.035,.048,.022),dark))
        sling.append(c.ell('Offspring dark face stripe',(.56+side*.037,.044,1.208),(.017,.078,.012),dark))
    sling.append(tube(c,'Raised sling lip',[(.37,-.40,1.06),(.70,-.49,1.08),(.89,-.20,1.07),
        (.84,.11,1.09),(.65,.24,1.10)],.048,ochre))
    sling.append(tube(c,'Visible taut launch tendon',[(-.37,-.62,.79),(-.42,-.28,1.0),
        (.01,.10,1.13),(.36,.18,1.12)],.050,ochre))
    sling.append(tube(c,'Dark crease on taut tendon',[(-.405,-.28,1.05),(.015,.10,1.183),(.34,.17,1.17)],.011,dark))
    sling.append(scute(c,'Left counterweight horn plate',(-.49,-.33,.93),.43,.57,olive,.14))
    for y in (-.25,-.43):
        sling.append(c.ell('Small counterweight chamber',(-.64,y,.83),(.18,.16,.14),ochre))
    skull=head(c,(0,.72,1.00),.27,.34,pale,dark,dark)
    tail=[scute(c,'Short carrying tail',(0,-.88,.37),.30,.32,fur,.14)]
    return finish(c,limbs,body,skull,(0,.39,.86),{'load':((0,-.23,.76),sling),'tail':((0,-.72,.39),tail)})
