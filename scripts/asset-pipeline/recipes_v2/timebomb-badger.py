"""Small fast quadruped whose attached bomb harness reads as one clear central hazard."""
import math
from organic_shell_parts import centered_shell as plate
from enemy_parts_b import scute, tube, head, paw, finish

from enemy_craft_parts import head_b as head, finish_b as finish, refine
from enemy_craft_surfaces import technical

def build(c, spec):
    fur=c.material('Timebomb cool grey brown fur',(.095,.105,.090),'organic')
    dark=c.material('Timebomb charcoal fur and webbing',(.014,.020,.022),'organic')
    pale=c.material('Timebomb pale badger crown',(.50,.52,.40),'organic')
    armor=technical(c,'Timebomb weathered ochre charge casing',(.54,.36,.032),kind='coat')
    edge=technical(c,'Timebomb aged yellow flank guards',(.72,.49,.045),kind='coat')
    brass=technical(c,'Timebomb weathered brass clamps',(.92,.69,.14),kind='brass')
    red=c.material('Timebomb tiny steady red timer',(.53,.026,.015),emission=.30)
    limbs={}
    for name,x,y in [('front_left',-.62,.38),('front_right',.62,.38),('rear_left',-.59,-.47),('rear_right',.59,-.47)]:
        limbs[name]=paw(c,name,(x*.63,y-.07,.29),(x,y,.13),.16,fur,dark,pale)
    body=[c.ell('Compact sprinting badger body',(0,-.16,.52),(.56,.67,.35),fur)]
    for side in (-1,1):
        body.append(scute(c,'Attached yellow side guard',(side*.40,-.14,.73),.28,.66,edge,.09))
    harness=[plate(c,'Broad harness saddle',(0,-.16,.86),
        [(-.33,.33),(.33,.33),(.40,.19),(.36,-.29),(.20,-.36),(-.20,-.36),(-.36,-.29),(-.40,.19)],.06,dark,.035),
        c.cylinder('Round armored charge casing',(0,-.18,.935),.32,.13,armor,48),
        c.cylinder('Recessed charge top',(0,-.18,1.015),.245,.045,dark,48)]
    for side in (-1,1):
        harness.append(c.box('Brass charge retaining clamp',(side*.25,-.18,1.055),(.13,.49,.055),brass,.015))
        harness.append(c.ell('Recessed harness rivet',(side*.25,-.31,1.087),(.025,.025,.010),dark))
    harness.append(c.box('Single red timer window',(0,-.04,1.07),(.24,.13,.035),red,.012))
    for x in (-.065,.055):
        harness.append(c.box('Dark timer digit division',(x,-.04,1.095),(.024,.095,.009),dark,.002))
    harness.append(tube(c,'Short attached detonator lead',[(-.19,-.38,1.02),(-.05,-.45,1.05),(.19,-.38,1.02)],.019,brass))
    for i in range(8):
        a=math.tau*i/8
        x,y=.287*math.cos(a),-.18+.287*math.sin(a)
        harness.append(c.cylinder('Flush charge casing screw',(x,y,1.007),.015,.010,dark,16))
        harness.append(c.box('Screw slot',(x,y,1.014),(.020,.003,.003),brass,.001))
    for x in (-.067,.067):
        harness.append(c.box('Recessed fuse cartridge',(x,-.30,1.052),(.077,.17,.023),armor,.01))
        for yy in (-.35,-.25):harness.append(c.box('Fuse brass contact',(x,yy,1.071),(.080,.018,.013),brass,.003))
    skull=head(c,(0,.56,.79),.225,.29,pale,dark,dark)
    tail=[c.ell('Short fleeing badger tail',(0,-.83,.30),(.105,.14,.08),fur)]
    refine(c,body,skull,limbs,(fur,),{armor:("metal",dark),edge:("metal",dark),brass:("metal",dark)},extra=(harness,tail))
    return finish(c,limbs,body,skull,(0,.33,.69),{'load':((0,-.16,.84),harness),'tail':((0,-.72,.29),tail)})
