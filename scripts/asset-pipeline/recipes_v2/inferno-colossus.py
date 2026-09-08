"""Basalt siege beast: long segmented carapace, four enormous plated paws and inset furnace seams."""
import math
from enemy_parts_b import plate, scute, tube, head, paw, finish


def fissures(c, name, paths, z, width, dark, hot):
    """Flat, tapering fracture ribbons with charred rims; no raised glowing hoses."""
    parts=[]
    for layer,material,factor,height in [('charred recess',dark,1.9,z),('deep ember',hot,1,z+.002)]:
        for branch,points in enumerate(paths):
            left=[]; right=[]
            for i,(x,y) in enumerate(points):
                before=points[max(0,i-1)]; after=points[min(len(points)-1,i+1)]
                dx,dy=after[0]-before[0],after[1]-before[1]
                length=max(math.hypot(dx,dy),.0001)
                taper=([.12,.92,.64,1,.45,.06][i] if len(points)==6 else
                       .06 if i==len(points)-1 else .65 if i==0 else .48)
                radius=width*.5*factor*taper*(1 if branch==0 else .67)
                left.append((x-dy/length*radius,y+dx/length*radius))
                right.append((x+dy/length*radius,y-dx/length*radius))
            parts.append(plate(c,name+' '+layer,(0,0,height),left+list(reversed(right)),.001,material,0))
    return parts


def build(c, spec):
    hide=c.material('Colossus dark umber joint hide',(.035,.021,.014),'organic')
    basalt=c.material('Colossus matte basalt carapace',(.035,.030,.027),'technical')
    plate_mat=c.material('Colossus dry copper brown plates',(.105,.057,.029),'technical')
    edge=c.material('Colossus weathered horn edges',(.23,.145,.075),'organic')
    black=c.material('Colossus deep cooling recess',(.009,.012,.012))
    molten=c.material('Colossus recessed amber heat',(.56,.105,.008),emission=.32)
    pale=c.material('Colossus scorched bone crest',(.48,.34,.20),'organic')
    limbs={}
    for index,(name,x,y) in enumerate([('front_left',-1.00,.65),('front_right',1.00,.65),('rear_left',-.94,-.83),('rear_right',.94,-.83)]):
        hip=(x*.71,y-.09,.50)
        limbs[name]=paw(c,name,hip,(x,y,.20),.30,hide,basalt,edge,plate_mat)
        objects=limbs[name][1]
        objects.append(scute(c,'Massive overlapping foreleg shield',(x*.89,y-.16,.62),.55,.59,basalt,.15))
        sign=-1 if x<0 else 1
        bend=.015*(index-1.5)
        line=[(x*.89+sign*u,y+v) for u,v in
              [(-.17,-.18),(-.095,-.135+bend),(-.06,-.07),(.015,-.092+bend),(.055,-.025),(.13,.035)]]
        branch=[line[2],(x*.89+sign*(-.095),y+.006),(x*.89+sign*(-.10),y+.068)]
        objects.extend(fissures(c,'Fractured basalt paw',[line,branch],.696,.030,black,molten))
    body=[c.ell('Long basalt ribcage',(0,-.21,.75),(.78,1.16,.51),hide),
        c.ell('Huge front shoulder yoke',(0,.54,.85),(.91,.61,.48),basalt)]
    # Hand-authored fault paths vary their entry, direction and branching on every segment.
    cracks=[
        [(-.17,.11),(-.095,.077),(-.061,.001),(.004,-.018),(.047,-.10),(.13,-.14)],
        [(-.16,-.10),(-.095,-.07),(-.073,.018),(.013,.039),(.055,.098),(.145,.14)],
        [(-.155,.12),(-.072,.079),(-.025,.092),(.009,.014),(.088,-.011),(.13,-.105)],
        [(-.16,-.11),(-.11,-.045),(-.032,-.058),(.005,.006),(.059,.034),(.139,.127)],
        [(-.16,.09),(-.087,.027),(-.061,-.032),(.016,-.011),(.061,-.095),(.118,-.129)],
        [(-.14,-.09),(-.068,-.073),(-.044,.004),(.031,.040),(.071,.089),(.135,.106)],
    ]
    for i,(y,w) in enumerate([(.58,1.38),(.25,1.42),(-.08,1.40),(-.40,1.19),(-.72,.91),(-1.01,.61)]):
        z=1.25-abs(y)*.13
        body.append(scute(c,'Dark articulated segment backing',(0,y,z),w,.50,black,.09))
        body.append(scute(c,'Recessed furnace segment',(0,y,z+.045),w*.94,.45,molten,.035))
        for side in (-1,1):
            panel=plate(c,'Heavy divided carapace tile',(side*w*.25,y,z+.105),
                [(-w*.205,.19),(w*.205,.19),(w*.245,-.055),(w*.07,-.22),(-w*.19,-.15)],.15,
                plate_mat if i%2==0 else basalt,.035)
            body.append(panel)
            shape=cracks[(i+(2 if side==1 else 0))%len(cracks)]
            line=[(side*w*.25+u*w,y+v*(.88 if side==1 else 1)) for u,v in shape]
            fork=line[2 if i%2==0 else 3]
            branch=[fork,(fork[0]+(.035 if i%2 else -.035)*w,fork[1]+.058),
                    (fork[0]+(.062 if i%2 else -.058)*w,min(y+.14,fork[1]+.098))]
            paths=[line,branch]
            if i in (0,2,4):
                paths.append([line[4],(line[4][0]+.033*w,line[4][1]-.041),
                              (line[4][0]+.068*w,line[4][1]-.052)])
            body.extend(fissures(c,'Natural divided armor fracture',paths,z+.181,.035 if i<3 else .029,black,molten))
        body.append(scute(c,'Raised central scorched vertebra',(0,y,z+.23),.135,.36,edge,.075))
    for side in (-1,1):
        body.append(plate(c,'Jagged shoulder apron',(side*.75,.51,1.05),
            [(side*x,y) for x,y in [(-.25,.38),(.25,.38),(.39,.08),(.24,-.10),(.33,-.31),(0,-.43),(-.31,-.23)]],.21,basalt,.055))
        for j in range(3):
            body.append(scute(c,'Copper armor chevron',(side*.91,.67-j*.22,1.205),.37,.18,plate_mat,.05))
        # Housed weapons and ammunition stay attached to the beast; no baked firing effects.
        body.append(c.box('North-facing siege weapon casing',(side*.70,.89,.79),(.30,.77,.25),black,.06))
        body.append(c.box('Scorched weapon mantle',(side*.70,.83,.955),(.35,.49,.14),plate_mat,.035))
        for dx in (-.07,.07):
            body.append(c.ell('Recessed siege muzzle',(side*.70+dx,1.245,.86),(.045,.07,.036),molten))
    skull=head(c,(0,1.055,1.16),.28,.40,pale,basalt,black,molten,edge)
    for side in (-1,1):
        skull.append(scute(c,'Heavy pointed cheek horn',(side*.35,.96,1.28),.19,.60,basalt,.12))
    tail=[scute(c,'Armored tail root',(0,-1.28,.50),.44,.49,basalt,.18),
        scute(c,'Copper tail wedge',(0,-1.52,.38),.25,.37,plate_mat,.12)]
    return finish(c,limbs,body,skull,(0,.72,1.02),{'tail':((0,-1.02,.47),tail)})
