"""Hunched corpse badger with tapered neck, exposed ribs and ragged load-bearing paws."""
from recipes_v2.enemy_parts_a import ell, loft, plate, horn, ribbon, paw, head, finish


def build(c, spec):
    coat=c.material('Sallow charcoal corpse fur',(.115,.133,.103),'organic')
    shoulder=c.material('Raised coarse shoulder fur',(.21,.225,.165),'organic')
    dark=c.material('Deep warm skin creases',(.018,.022,.017),'organic')
    ivory=c.material('Weathered warm ivory',(.58,.54,.38),'organic')
    skin=c.material('Muted old torn hide',(.24,.105,.067),'organic')
    wound=c.material('Dry maroon wound recess',(.065,.016,.013))
    eyes=c.material('Small sick amber eyes',(.46,.48,.065),emission=.10)
    limbs={}
    for name,x,y,w in [('front_left',-.86,.35,.205),('front_right',.86,.31,.215),
                        ('rear_left',-.66,-.64,.18),('rear_right',.68,-.62,.185)]:
        limbs[name]=paw(c,name,x,y,coat,dark,ivory,width=w,length=.26,toe_length=.10)
    body=[loft(c,'Uneven hunched ribcage',[(-.96,.10,.33,.08),(-.76,.45,.40,.22),
          (-.43,.62,.48,.34),(-.10,.68,.54,.38),(.24,.65,.56,.39),(.49,.39,.55,.23),(.58,.12,.51,.08)],coat)]
    for side in (-1,1):
        body.append(ell(c,'Loaded shoulder haunch',(side*.50,.17,.71),(.28,.40,.24),shoulder,taper=.25,angle=side*.20))
        for j in range(3):
            body.append(plate(c,'Ragged flank fur',[(side*.47,-.14-j*.18),(side*.71,-.28-j*.18),
                       (side*.56,-.45-j*.18),(side*.41,-.37-j*.18)],.63-j*.045,.065,shoulder,dark))
    body.append(ell(c,'Old exposed rib wound',(-.32,-.13,.853),(.22,.32,.025),wound,angle=.23))
    for j in range(int(spec.get('model',{}).get('exposedRibs',3))):
        body.append(horn(c,'Curved exposed ivory rib',[(-.47,-.30+j*.12,.84),(-.33,-.25+j*.12,.89),(-.21,-.31+j*.12,.872)], [.033,.041,.025],ivory))
    body.append(plate(c,'Raised healing hide flap',[(.14,-.42),(.26,-.37),(.39,-.27),(.46,-.31),
               (.58,-.52),(.42,-.59),(.30,-.67),(.23,-.54)],.755,.045,skin))
    body.append(ribbon(c,'Frayed broken dorsal stripe',[(.03,-.73,.64),(-.02,-.48,.79),(.035,-.31,.87)], [.10,.115,.085],ivory))
    body.append(ribbon(c,'Dark old shoulder tear',[(.37,.10,.963),(.43,-.04,.925),(.48,-.15,.872)],[.037,.048,.017],wound))
    skull=head(c,ivory,dark,coat,eyes,y=.64,z=.87,width=.31,length=.42)
    skull.append(plate(c,'Missing ear edge',[(-.32,.39),(-.43,.29),(-.30,.21)],.98,.025,skin))
    tail=[horn(c,'Thin crooked corpse tail',[(0,-.79,.36),(.04,-1.01,.27),(.13,-1.12,.24)],[.13,.10,.02],ivory)]
    return finish(c,body,skull,limbs,tail)
