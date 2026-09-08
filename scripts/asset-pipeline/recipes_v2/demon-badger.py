"""Horned muscular charger: swept red shoulders, narrow hot spine and hooked claws."""
from recipes_v2.enemy_parts_a import ell, loft, plate, horn, ribbon, paw, head, finish


def build(c,spec):
    coat=c.material('Oxide red demonic hide',(.34,.035,.021),'organic')
    red=c.material('Raised crimson scutes',(.53,.055,.025),'organic')
    dark=c.material('Obsidian horn and joints',(.020,.016,.019),'organic')
    pale=c.material('Hot worn horn tips',(.53,.29,.11),'organic')
    ember=c.material('Bounded ember fissures',(.69,.17,.028),emission=.30)
    eyes=c.material('Fierce molten eyes',(.90,.35,.055),emission=.32)
    limbs={}
    for name,x,y,width in [('front_left',-.88,.38,.22),('front_right',.88,.38,.22),('rear_left',-.61,-.66,.18),('rear_right',.61,-.66,.18)]:
        limbs[name]=paw(c,name,x,y,red,dark,pale,width=width,length=.28,toe_length=.15)
    body=[loft(c,'Forward heavy demonic anatomy',[(-1.01,.05,.31,.06),(-.79,.34,.38,.22),(-.48,.48,.51,.33),
          (-.08,.60,.58,.38),(.23,.65,.59,.34),(.52,.28,.55,.19),(.60,.09,.52,.05)],coat)]
    sweep=float(spec.get('model',{}).get('hornSweep',1.0))
    for side in (-1,1):
        body.append(plate(c,'Swept scapular armor',[(side*.28,.42),(side*.67,.57),(side*.90,.25),
                  (side*.72,-.13),(side*.31,.01)],.83,.20,red,dark))
        body.append(horn(c,'Swept shoulder horn',[(side*.67,.23,.93),(side*.88,.38,1.07),
                  (side*(.91+.05*sweep),.67,1.00),(side*.81,.84,.91)],[.13,.10,.057,.007],dark))
        body.append(ribbon(c,'Shoulder heat seam',[(side*.36,.32,1.023),(side*.58,.38,1.075),(side*.75,.21,.997)], [.035,.042,.022],ember))
        for j in range(3):
            body.append(plate(c,'Flank scale',[(side*.25,-.16-j*.22),(side*.57,-.10-j*.22),
                      (side*.48,-.41-j*.22),(side*.16,-.38-j*.22)],.79-j*.06,.105,red,dark))
    for j in range(5):
        y=.03-j*.195
        body.append(plate(c,'Spinal lava shield',[(-.11,y+.10),(.11,y+.10),(.13,y-.025),(0,y-.17),(-.13,y-.025)],.99-j*.071,.055,dark))
        body.append(ribbon(c,'Narrow glowing vertebra',[(0,y+.06,1.047-j*.071),(0,y-.055,1.047-j*.071)], [.044,.022],ember))
    skull=head(c,red,dark,coat,eyes,y=.64,z=.98,width=.27,length=.38,ears=False)
    for side in (-1,1):
        skull.append(horn(c,'Hooked cranial horn',[(side*.24,.46,1.11),(side*.40,.68,1.20),(side*.36,.95,1.13),(side*.22,1.13,1.04)], [.105,.080,.043,.006],dark))
    skull.append(ribbon(c,'Ember forehead line',[(0,.45,1.215),(0,.65,1.226),(0,.90,1.11)],[.05,.062,.026],ember))
    tail=[horn(c,'Armored tapering tail',[(0,-.82,.39),(0,-1.07,.29),(0,-1.20,.20)],[.13,.083,.009],dark)]
    return finish(c,body,skull,limbs,tail)
