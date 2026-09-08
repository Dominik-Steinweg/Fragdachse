"""Low pear-shaped mother with a plated spine, heavy olive brood sacs and four burdened paws."""
from enemy_parts_b import scute, tube, head, paw, finish


def build(c, spec):
    hide=c.material('Broodmother warm umber hide',(.12,.082,.045),'organic')
    dark=c.material('Broodmother dark folds',(.018,.022,.012),'organic')
    scab=c.material('Broodmother dry back plates',(.19,.17,.085),'organic')
    pale=c.material('Broodmother aged ivory stripe',(.56,.48,.28),'organic')
    olive=c.material('Broodmother muted olive chambers',(.22,.255,.045),'organic')
    spot=c.material('Broodmother chamber nodules',(.46,.44,.10),'organic')
    eye=c.material('Broodmother recessed yellow eyes',(.42,.39,.035),emission=.08)
    limbs={}
    for name,x,y in [('front_left',-.75,.42),('front_right',.75,.42),('rear_left',-.78,-.69),('rear_right',.78,-.69)]:
        limbs[name]=paw(c,name,(x*.73,y-.07,.30),(x,y,.13),.19,hide,dark,pale)
    body=[c.ell('Heavy low shoulder hump',(0,.27,.61),(.57,.49,.39),hide)]
    abdomen=[c.ell('Pear shaped brood abdomen',(0,-.39,.48),(.72,.79,.44),hide)]
    for y,width in [(.13,.61),(-.12,.78),(-.39,.85),(-.64,.69),(-.85,.41)]:
        z=1.09-abs(y+.12)*.20
        abdomen.append(scute(c,'Overlapping gravid spine plate',(0,y,z),width,.35,scab,.105))
        abdomen.append(tube(c,'Grouped curved spine crease',[(-width*.29,y+.025,z+.058),
            (0,y-.055,z+.060),(width*.29,y+.025,z+.058)],.016,dark))
    for side in (-1,1):
        for i,(y,radius) in enumerate([(-.03,.27),(-.39,.32),(-.75,.21)]):
            x=side*(.64 if i<2 else .53)
            abdomen.append(c.ell('Bulging attached olive brood sac',(x,y,.55),(radius*.94,radius,.24),olive))
            for dx,dy,r in [(-.07,.06,.065),(.065,-.07,.045),(.05,.115,.04)]:
                abdomen.append(c.ell('Grouped brood nodule',(x+dx,y+dy,.775),(r,r*.8,.035),spot))
            abdomen.append(tube(c,'Dark attaching brood fold',[(x-side*.14,y-.18,.59),
                (x-side*.20,y,.70),(x-side*.13,y+.18,.61)],.026,dark))
    skull=head(c,(0,.70,.98),.28,.36,pale,dark,dark,eye)
    body.append(scute(c,'Broad throat mantle',(0,.35,1.06),.79,.32,scab,.11))
    tail=[c.ell('Short blunt broodmother tail',(0,-1.055,.27),(.14,.20,.10),hide)]
    return finish(c,limbs,body,skull,(0,.37,.78),{'brood':((0,-.30,.45),abdomen),'tail':((0,-.94,.25),tail)})
