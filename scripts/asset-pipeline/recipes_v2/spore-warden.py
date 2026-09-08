"""Asymmetric fungal guardian with shoulder chambers and a scalloped living carapace."""
import math
from recipes_v2.enemy_parts_a import ell, loft, plate, horn, ribbon, paw, head, finish


def build(c,spec):
    hide=c.material('Warm olive guardian hide',(.17,.19,.075),'organic')
    shell=c.material('Brown green grown armor',(.27,.26,.115),'organic')
    rim=c.material('Ochre grown armor edges',(.40,.34,.12),'organic')
    dark=c.material('Dark gills and paw clefts',(.035,.041,.017),'organic')
    moss=c.material('Moss green fungal caps',(.245,.35,.085),'organic')
    spot=c.material('Pale cap pore rims',(.59,.52,.24),'organic')
    ivory=c.material('Warm pale badger face',(.64,.58,.38),'organic')
    eyes=c.material('Yellow spore eyes',(.59,.60,.13),emission=.12)
    limbs={}
    for name,x,y in [('front_left',-.88,.40),('front_right',.88,.40),('rear_left',-.76,-.64),('rear_right',.76,-.64)]:
        limbs[name]=paw(c,name,x,y,hide,dark,spot,width=.20,length=.26,toe_length=.10)
    body=[loft(c,'Broad fungal host body',[(-1.02,.13,.34,.09),(-.79,.54,.43,.26),(-.43,.68,.52,.32),
          (-.07,.73,.58,.35),(.30,.60,.63,.34),(.55,.30,.64,.22),(.64,.11,.61,.09)],hide)]
    for row,y in enumerate([.10,-.19,-.48,-.75]):
        width=.51-row*.055
        body.append(plate(c,'Overlapping scalloped dorsal scale',[(-width,y+.14),(-.18,y+.21),
                  (.17,y+.19),(width,y+.11),(width*.77,y-.13),(0,y-.26),(-width*.78,y-.13)],.92-row*.085,.105,shell,rim))
    cap_radius=float(spec.get('model',{}).get('capRadius',.31))
    for side,x,y,scale in [(-1,-.64,.21,1.10),(1,.60,.27,.91)]:
        r=cap_radius*scale
        body.append(ell(c,'Rooted fungal shoulder chamber',(x,y,.84),(r*1.03,r*.98,.23),rim))
        body.append(ell(c,'Moss green mushroom crown',(x,y,.97),(r,r*.90,.16),moss))
        for a,rad,spread in [(.25,.065,.58),(1.45,.050,.43),(2.8,.069,.55),(4.13,.045,.61),(5.24,.055,.31)]:
            a+=side*.17
            xx,yy=x+math.cos(a)*r*spread,y+math.sin(a)*r*spread
            body.append(ell(c,'Broad pale pore collar',(xx,yy,1.098),(rad,rad*.80,.020),spot))
            body.append(ell(c,'Inset dark spore pore',(xx,yy+.004,1.118),(rad*.49,rad*.36,.012),dark))
    for side in (-1,1):
        for y,z in [(-.33,.69),(-.64,.60)]:
            body.append(ell(c,'Small flank shelf fungus',(side*.61,y,z),(.20,.18,.075),rim,angle=side*.55))
    skull=head(c,ivory,dark,hide,eyes,y=.75,z=.97,width=.30,length=.39)
    tail=[horn(c,'Segmented living root tail',[(0,-.85,.36),(.015,-1.04,.27),(.095,-1.13,.19)], [.15,.10,.026],rim)]
    return finish(c,body,skull,limbs,tail)
