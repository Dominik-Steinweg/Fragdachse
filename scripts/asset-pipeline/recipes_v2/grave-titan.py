"""Massive terraced stone carapace carried by four broad, individually rigged paws."""
from recipes_v2.enemy_parts_a import ell, loft, plate, horn, ribbon, paw, head, finish


def build(c,spec):
    hide=c.material('Ancient grey hide',(.105,.12,.085),'organic')
    dark=c.material('Deep stone joints',(.027,.034,.025),'organic')
    stone=c.material('Weathered granite crowns',(.235,.255,.205),'technical')
    edge=c.material('Dark granite broken sides',(.095,.115,.08),'technical')
    lighter=c.material('Pale worn shoulder granite',(.34,.355,.275),'technical')
    moss=c.material('Quiet moss in recesses',(.16,.225,.063),'organic')
    ivory=c.material('Ancient ivory face stripe',(.59,.55,.41),'organic')
    eyes=c.material('Faint green buried eyes',(.37,.47,.11),emission=.09)
    limbs={}
    for name,x,y in [('front_left',-1.03,.40),('front_right',1.03,.40),('rear_left',-.93,-.76),('rear_right',.93,-.76)]:
        joint,objects=paw(c,name,x,y,hide,dark,ivory,width=.285,length=.33,toe_length=.12)
        objects.append(plate(c,name+' broken ankle shield',[(x-.24,y+.02),(x-.17,y-.30),
                       (x+.15,y-.33),(x+.28,y-.08),(x+.18,y+.15),(x-.15,y+.17)],.44,.17,stone,edge))
        limbs[name]=(joint,objects)
    body=[loft(c,'Massive ancient ribcage',[(-1.15,.18,.43,.14),(-.91,.66,.55,.32),
          (-.55,.86,.64,.42),(-.12,.94,.71,.46),(.32,.84,.74,.41),(.60,.47,.73,.27),(.77,.17,.71,.12)],hide)]
    stones=[('Great central grave slab',[(-.35,.42),(.24,.47),(.48,.14),(.29,-.21),(-.27,-.26),(-.49,.04)],1.05,.20,lighter),
            ('Left shoulder monolith',[(-.35,.47),(-.62,.66),(-.93,.42),(-.97,.08),(-.61,-.03),(-.46,.14)],.95,.22,stone),
            ('Right shoulder monolith',[(.33,.48),(.62,.65),(.96,.36),(.92,.02),(.56,-.06),(.45,.15)],.95,.23,lighter),
            ('Lower central shield',[(-.28,-.28),(.24,-.25),(.46,-.52),(.17,-.83),(-.20,-.86),(-.46,-.56)],.93,.20,stone),
            ('Left layered flank',[(-.50,-.08),(-.90,-.10),(-.91,-.52),(-.64,-.81),(-.45,-.59),(-.30,-.30)],.83,.18,lighter),
            ('Right layered flank',[(.51,-.11),(.87,-.09),(.92,-.55),(.61,-.87),(.43,-.60),(.30,-.31)],.83,.18,stone),
            ('Low broken tail shield',[(-.49,-.83),(-.16,-1.10),(.29,-1.04),(.54,-.85),(.22,-.77),(-.12,-.91)],.64,.18,stone)]
    for name,outline,z,rise,material in stones:
        body.append(plate(c,name,outline,z,rise,material,edge))
    moss_amount=float(spec.get('model',{}).get('mossSpread',1))
    for x,y,z,s in [(-.75,.29,1.157,.09),(.65,.39,1.188,.075),(-.63,-.47,1.006,.09),(.52,-.58,.99,.08),(.05,-.65,1.117,.075)]:
        body.append(ell(c,'Recessed moss island',(x,y,z),(s*moss_amount,s*.63,.018),moss,angle=.5))
    body.append(ribbon(c,'Weathered broken central crack',[(-.11,.32,1.252),(.025,.14,1.257),(-.06,-.06,1.247)], [.024,.037,.014],edge))
    body.append(ribbon(c,'Forked grave slab fissure',[(.018,.14,1.258),(.16,.20,1.253),(.31,.19,1.215)], [.027,.018,.006],edge))
    body.append(ribbon(c,'Lower buried stone fracture',[(-.15,-.42,1.136),(-.035,-.50,1.138),(-.105,-.64,1.124)], [.020,.026,.009],edge))
    skull=head(c,ivory,dark,hide,eyes,y=.78,z=1.02,width=.34,length=.43)
    for side in (-1,1):
        skull.append(plate(c,'Stone cheek guard',[(side*.25,.56),(side*.47,.50),(side*.56,.24),(side*.33,.23)],1.09,.13,stone,edge))
    tail=[ell(c,'Short heavy stone tail',(0,-1.10,.31),(.18,.20,.12),hide)]
    return finish(c,body,skull,limbs,tail)
