"""Lean violet pursuit beast with pinched waist, thrown-out claws and serrated spine."""
from recipes_v2.enemy_parts_a import ell, loft, plate, horn, ribbon, paw, head, finish


def build(c,spec):
    coat=c.material('Saturated violet hide',(.24,.030,.46),'organic')
    muscle=c.material('Bright violet muscle planes',(.42,.045,.65),'organic')
    dark=c.material('Black purple joints',(.024,.012,.039),'organic')
    ivory=c.material('Cold pale spine and teeth',(.62,.61,.69),'organic')
    eyes=c.material('Rabid yellow eyes',(.70,.55,.05),emission=.18)
    limbs={}
    for name,x,y,width in [('front_left',-.68,.43,.155),('front_right',.68,.43,.155),('rear_left',-.64,-.58,.18),('rear_right',.64,-.58,.18)]:
        limbs[name]=paw(c,name,x,y,muscle,dark,ivory,width=width,length=.245,toe_length=.18)
    body=[loft(c,'Lean pinched pursuit torso',[(-.99,.05,.29,.05),(-.77,.33,.37,.20),(-.48,.39,.44,.24),
          (-.20,.27,.48,.24),(.10,.39,.54,.28),(.38,.46,.58,.27),(.58,.22,.58,.16),(.64,.06,.54,.05)],coat)]
    for side in (-1,1):
        body.append(ell(c,'Long visible rear haunch',(side*.35,-.60,.50),(.24,.35,.22),muscle,angle=side*.33))
        body.append(ell(c,'Forward narrow shoulder',(side*.35,.24,.67),(.19,.30,.22),muscle,taper=.22,angle=-side*.30))
        for j in range(3):
            body.append(horn(c,'Swept coarse flank quill',[(side*.29,-.12-j*.20,.64-j*.06),
                        (side*.51,-.24-j*.20,.61-j*.06),(side*.56,-.36-j*.20,.54-j*.06)], [.092,.055,.008],muscle))
    length=float(spec.get('model',{}).get('spineLength',.84))
    body.append(ribbon(c,'Continuous ivory dorsal identity',[(0,-length,.60),(0,-.56,.72),(0,-.26,.735),(0,.05,.80),(0,.34,.875)], [.04,.085,.063,.081,.095],ivory))
    for j in range(5):
        y=.21-j*.20
        body.append(horn(c,'Short serrated spine barb',[(0,y,.85-j*.045),(0,y-.11,.94-j*.045),(0,y-.21,.86-j*.045)], [.08,.045,.003],ivory))
    skull=head(c,ivory,dark,coat,eyes,y=.71,z=.86,width=.235,length=.37)
    tail=[horn(c,'Long whip tail',[(0,-.77,.38),(-.06,-1.02,.27),(.015,-1.18,.24),(.16,-1.25,.22)], [.085,.06,.037,.003],coat)]
    return finish(c,body,skull,limbs,tail)
