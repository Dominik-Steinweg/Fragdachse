"""Traveling plague support: fitted kit, restrained green vials and a readable back cross."""
from recipes_v2.enemy_parts_a import ell, loft, plate, horn, ribbon, paw, head, finish


def build(c,spec):
    hide=c.material('Muted brown medic fur',(.18,.15,.087),'organic')
    leather=c.material('Worn ochre leather kit',(.27,.22,.105),'technical')
    dark=c.material('Dark leather piping',(.040,.039,.021),'organic')
    ivory=c.material('Pale clean face markings',(.64,.61,.44),'organic')
    metal=c.material('Matte dull brass fittings',(.32,.30,.18),'technical')
    green=c.material('Sage green medical inset',(.18,.34,.12),'technical')
    light=c.material('Pale green medical cross',(.60,.75,.39),emission=.08)
    vial=c.material('Bounded medicinal green',(.18,.52,.12),emission=.12)
    eyes=c.material('Amber calm eyes',(.54,.48,.10),emission=.10)
    limbs={}
    for name,x,y in [('front_left',-.83,.37),('front_right',.83,.37),('rear_left',-.72,-.61),('rear_right',.72,-.61)]:
        joint,objects=paw(c,name,x,y,hide,dark,ivory,width=.19,length=.25,toe_length=.10)
        objects.append(ribbon(c,name+' broad field bandage',[(x-.16,y-.015,.263),(x,y+.015,.305),(x+.16,y-.015,.263)],[.095,.10,.095],ivory))
        limbs[name]=(joint,objects)
    body=[loft(c,'Compact load-bearing medic torso',[(-.96,.13,.31,.08),(-.78,.48,.42,.22),
          (-.43,.62,.53,.31),(-.08,.64,.59,.32),(.27,.52,.61,.31),(.55,.27,.63,.20),(.65,.07,.58,.05)],hide)]
    kit_width=float(spec.get('model',{}).get('kitWidth',.83))
    body.append(c.box('Rounded strapped medical satchel',(0,-.29,.88),(kit_width,.74,.25),dark,bevel=.105))
    body.append(c.box('Broad ochre satchel lid',(0,-.28,1.006),(kit_width-.07,.67,.10),leather,bevel=.07))
    body.append(c.box('Sage medical symbol patch',(0,-.28,1.068),(.43,.43,.022),green,bevel=.04))
    body.append(c.box('Medical cross vertical',(0,-.28,1.083),(.105,.325,.025),light,bevel=.012))
    body.append(c.box('Medical cross horizontal',(0,-.28,1.084),(.325,.105,.025),light,bevel=.012))
    for side in (-1,1):
        body.append(ribbon(c,'Shoulder harness',[(side*.37,-.64,.91),(side*.38,-.19,1.072),
                  (side*.38,.19,.94),(side*.31,.43,.878)],[.09,.09,.085,.08],dark))
        body.append(c.box('Harness brass buckle',(side*.38,.14,.99),(.13,.14,.038),metal,bevel=.015))
        x=side*.63
        body.append(ell(c,'Field vial casing',(x,-.27,.77),(.13,.30,.12),dark))
        body.append(ell(c,'Medicinal green vial',(x,-.25,.837),(.086,.225,.075),vial))
        body.append(c.box('Vial securing strap',(x,-.25,.915),(.24,.071,.030),leather,bevel=.014))
        body.append(c.box('Vial matte cap',(x,-.035,.832),(.17,.11,.11),metal,bevel=.025))
    skull=head(c,ivory,dark,hide,eyes,y=.74,z=.95,width=.305,length=.41)
    skull.append(ribbon(c,'Small sage headband',[(-.22,.47,1.083),(0,.45,1.19),(.22,.47,1.083)],[.09,.09,.09],green))
    tail=[ell(c,'Short pale traveling tail',(0,-1.00,.30),(.115,.21,.09),ivory,angle=-.20)]
    return finish(c,body,skull,limbs,tail)
