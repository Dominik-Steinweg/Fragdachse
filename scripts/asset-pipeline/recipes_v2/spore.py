"""Rooted living spore launcher with a layered cap, unequal scales and an eastern pore."""
import math
from turret_parts import finish


def build(c,spec):
    stem=c.material('Fibrous mushroom roots',(.29,.21,.105),'organic')
    under=c.material('Ochre cap underside',(.38,.235,.105),'organic')
    skin=c.material('Russet fungal cap',(.40,.065,.035),'organic')
    blush=c.material('Soft red cap folds',(.52,.11,.050),'organic')
    pale=c.material('Old ivory cap scales',(.75,.60,.35),'organic')
    dark=c.material('Deep spore pore',(.029,.019,.009),'organic')
    base=[c.ell('Compact living root cushion',(0,0,.13),(.70,.70,.15),stem)]
    for i in range(9):
        a=i*math.tau/9
        root=c.ell('Unequal root toe',(.66*math.cos(a),.66*math.sin(a),.14),(.28,.12,.115),stem)
        root.rotation_euler.z=a;base.append(root)
        ridge=c.ell('Raised fibrous root ridge',(.65*math.cos(a),.65*math.sin(a),.24),(.22,.028,.025),under)
        ridge.rotation_euler.z=a;base.append(ridge)
    base.append(c.ell('Short powerful stalk',(-.055,0,.42),(.43,.43,.38),stem))
    cap=[c.ell('Rolled cap underside',(-.06,0,.67),(.88,.84,.21),under),c.ell('Heavy asymmetric russet cap',(-.10,0,.84),(.89,.83,.33),skin)]
    for i in range(10):
        a=math.tau*i/10+.15
        ob=c.ell('Soft overlapping cap lobe',(-.10+.76*math.cos(a),.70*math.sin(a),.75),(.18,.095,.085),blush if i%3==0 else skin)
        ob.rotation_euler.z=a;cap.append(ob)
    for x,y,r in [(-.58,.29,.09),(-.33,.51,.12),(.09,.46,.10),(.38,.20,.105),(.10,-.30,.13),(-.27,-.52,.095),(-.60,-.19,.105),(-.27,.06,.16),(.18,.13,.075)]:
        z=.87+.275*math.sqrt(max(0,1-((x+.1)/.89)**2-(y/.83)**2))
        cap.append(c.ell('Uneven ivory cap scale',(x,y,z),(r,r*.70,.037),pale))
    mouth=[c.ell('Thick eastern outlet lip',(.73,0,.73),(.35,.24,.21),under),c.ell('Dark visible spore pore',(.83,0,.852),(.24,.142,.073),dark)]
    for side in (-1,1):
        for i in range(4):
            ob=c.ell('Radial underside gill',(.23+i*.1,side*(.54-i*.055),.69),(.26,.024,.022),dark);ob.rotation_euler.z=side*.63;mouth.append(ob)
    return finish(c,base,{'cap':cap,'gills':mouth},pivots={'cap':(-.06,0,.65),'gills':(.64,0,.69)},sockets={'muzzle':(1.12,0,.81)})
