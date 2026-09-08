"""Crouched four-legged void predator with layered indigo armor and recessed dorsal well."""
import math
from recipes_v2.enemy_parts_a import ell, loft, plate, horn, ribbon, ring, paw, head, finish


def build(c,spec):
    hide=c.material('Indigo living undersuit',(.032,.050,.105),'organic')
    armor=c.material('Blue black chitin crowns',(.055,.105,.235),'technical')
    edge=c.material('Dark blue armor bevels',(.023,.042,.081),'technical')
    violet=c.material('Dark violet dorsal well',(.064,.022,.14),'organic')
    dark=c.material('Near black articulated joints',(.008,.016,.035),'organic')
    pale=c.material('Cool pale badger stripe',(.47,.57,.64),'organic')
    cyan=c.material('Controlled cyan neural seams',(.019,.37,.54),emission=.30)
    core=c.material('Violet well inner facets',(.20,.048,.41),emission=.13)
    eyes=c.material('Small cyan predator eyes',(.035,.58,.70),emission=.23)
    limbs={}
    for name,x,y in [('front_left',-.88,.39),('front_right',.88,.39),('rear_left',-.79,-.67),('rear_right',.79,-.67)]:
        joint,objects=paw(c,name,x,y,hide,dark,pale,width=.195,length=.265,toe_length=.14)
        objects.append(plate(c,name+' curved armored shin',[(x-.16,y+.01),(x-.19,y-.25),
                       (x+.08,y-.34),(x+.20,y-.09),(x+.13,y+.06)],.43,.115,armor,edge))
        objects.append(ell(c,name+' cyan ankle island',(x,y-.09,.569),(.075,.055,.018),cyan))
        limbs[name]=(joint,objects)
    body=[loft(c,'Low wide predator thorax',[(-1.05,.12,.32,.08),(-.83,.51,.43,.25),(-.49,.68,.49,.29),
          (-.13,.73,.55,.32),(.27,.65,.56,.32),(.56,.28,.57,.21),(.66,.08,.53,.06)],hide)]
    for side in (-1,1):
        body.append(plate(c,'Angular heavy front shoulder',[(side*.22,.45),(side*.57,.59),
                  (side*.87,.38),(side*.77,.01),(side*.44,-.04),(side*.26,.11)],.82,.17,armor,edge))
        for j,y in enumerate([-.19,-.50,-.77]):
            body.append(plate(c,'Rear overlapping scute',[(side*.30,y+.13),(side*.69,y+.17),
                      (side*.80,y-.01),(side*.57,y-.22),(side*.24,y-.12)],.81-j*.09,.125,armor,edge))
        body.append(ribbon(c,'Integrated cyan flank segment',[(side*.72,.29,.967),(side*.77,.17,.95),
                  (side*.72,.06,.921)],[.038,.045,.028],cyan))
        body.append(ribbon(c,'Integrated cyan rear segment',[(side*.69,-.41,.89),(side*.74,-.51,.862),
                  (side*.65,-.64,.837)],[.038,.042,.025],cyan))
    radius=float(spec.get('model',{}).get('coreRadius',.24))
    body.append(c.cylinder('Dark recessed circular dorsal well',(0,-.25,.925),radius+.105,.12,dark))
    body.append(ring(c,'Substantial violet armor well rim',(0,-.25,.986),radius+.045,.054,violet))
    body.append(c.cylinder('Deep central well disk',(0,-.25,.988),radius,.025,core,vertices=12))
    body.append(c.cylinder('Black empty well center',(0,-.25,1.009),radius*.58,.028,dark,vertices=12))
    for i in range(4):
        a=math.tau*i/4+.36
        body.append(ell(c,'Cyan well contact',(math.cos(a)*(radius+.05),-.25+math.sin(a)*(radius+.05),1.027),(.044,.044,.018),cyan))
    skull=head(c,pale,dark,hide,eyes,y=.73,z=.99,width=.28,length=.40)
    tail=[plate(c,'Short armored tail',[(-.14,-.92),(0,-1.21),(.14,-.94),(0,-.83)],.30,.13,armor,edge)]
    return finish(c,body,skull,limbs,tail)
