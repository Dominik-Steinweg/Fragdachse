"""Small fast quadruped whose attached bomb harness reads as one clear central hazard."""
from enemy_parts_b import plate, scute, tube, head, paw, finish


def build(c, spec):
    fur=c.material('Timebomb cool grey brown fur',(.095,.105,.090),'organic')
    dark=c.material('Timebomb charcoal fur and webbing',(.014,.020,.022),'organic')
    pale=c.material('Timebomb pale badger crown',(.50,.52,.40),'organic')
    armor=c.material('Timebomb dull dark steel casing',(.085,.11,.115),'technical')
    edge=c.material('Timebomb restrained turquoise flank guards',(.08,.20,.19),'technical')
    brass=c.material('Timebomb weathered brass clamps',(.38,.24,.065),'technical')
    red=c.material('Timebomb tiny steady red timer',(.53,.026,.015),emission=.30)
    limbs={}
    for name,x,y in [('front_left',-.62,.38),('front_right',.62,.38),('rear_left',-.59,-.47),('rear_right',.59,-.47)]:
        limbs[name]=paw(c,name,(x*.63,y-.07,.29),(x,y,.13),.16,fur,dark,pale)
    body=[c.ell('Compact sprinting badger body',(0,-.16,.52),(.56,.67,.35),fur)]
    for side in (-1,1):
        body.append(scute(c,'Attached teal side guard',(side*.40,-.14,.73),.28,.66,edge,.09))
    harness=[plate(c,'Broad harness saddle',(0,-.16,.86),
        [(-.33,.33),(.33,.33),(.40,.19),(.36,-.29),(.20,-.36),(-.20,-.36),(-.36,-.29),(-.40,.19)],.06,dark,.035),
        c.cylinder('Round armored charge casing',(0,-.18,.935),.32,.13,armor,12),
        c.cylinder('Recessed charge top',(0,-.18,1.015),.245,.045,dark,12)]
    for side in (-1,1):
        harness.append(c.box('Brass charge retaining clamp',(side*.25,-.18,1.055),(.095,.45,.055),brass,.015))
        harness.append(c.ell('Recessed harness rivet',(side*.25,-.31,1.087),(.025,.025,.010),dark))
    harness.append(c.box('Single red timer window',(0,-.04,1.07),(.24,.13,.035),red,.012))
    for x in (-.065,.055):
        harness.append(c.box('Dark timer digit division',(x,-.04,1.095),(.024,.095,.009),dark,.002))
    harness.append(tube(c,'Short attached detonator lead',[(-.19,-.38,1.02),(-.05,-.45,1.05),(.19,-.38,1.02)],.019,brass))
    skull=head(c,(0,.56,.79),.225,.29,pale,dark,dark)
    tail=[c.ell('Short fleeing badger tail',(0,-.86,.30),(.105,.17,.08),fur)]
    return finish(c,limbs,body,skull,(0,.33,.69),{'load':((0,-.16,.84),harness),'tail':((0,-.72,.29),tail)})
