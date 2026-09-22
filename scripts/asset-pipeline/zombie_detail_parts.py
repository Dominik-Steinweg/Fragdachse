"""Authored damaged hide, old cloth wraps and the zombie's cloudy-eyed badger face."""
import math
from recipes_v2.enemy_parts_a import horn, ell
from zombie_surface_parts import Surface, patch, oval, locks, torn_rim


def wound(c,surface,x,y,rx,ry,palette,angle=0,seed=1):
    rim=oval(x,y,rx,ry,angle,.15,seed)
    inner=[(x+(px-x)*.86,y+(py-y)*.89) for px,py in rim]
    parts=[torn_rim(c,surface,rim,inner,palette['skin']),
           patch(c,'Deep irregular wound cavity',surface,inner,palette['wound'],.023)]
    for j in range(6):
        a=-.66+j*.25
        if j<5:
            ox=x+.07*rx*math.sin(j*3+seed);oy=y+ry*(a+.035)
            parts.append(patch(c,'Flattened exposed muscle layers',surface,oval(ox,oy,rx*(.52+.07*math.sin(j)),ry*.15,angle,.11,seed+j),palette['muscle'],.026,.012))
        points=[surface.point(x+rx*t,y+ry*(a+.10*math.sin(t*5)),.030) for t in (-.45,-.2,0,.2,.4)]
        parts.append(horn(c,'Old exposed tissue fold',points,[.003,.007,.007,.005,.002],palette['skin'],10))
    return parts


def scar(c,surface,start,end,palette,count=4,width=.055):
    dx,dy=end[0]-start[0],end[1]-start[1];length=math.hypot(dx,dy);nx,ny=-dy/length,dx/length
    line=[surface.point(start[0]+dx*t,start[1]+dy*t,.025) for t in (0,.25,.5,.75,1)]
    result=[horn(c,'Sunken stitched scar',line,[.005,.010,.012,.009,.003],palette['wound'],10)]
    for i in range(count):
        t=(i+.5)/count;x=start[0]+dx*t;y=start[1]+dy*t
        points=[surface.point(x+nx*s,y+ny*s,.030+.020*(1-abs(s)/width)) for s in (-width,0,width)]
        result.append(horn(c,'Curved aged copper suture',points,[.006,.008,.006],palette['rust'],10))
        for sign in (-1,1):
            p=surface.point(x+nx*width*sign,y+ny*width*sign,.023)
            result.append(ell(c,'Small recessed stitch puncture',p,(.014,.014,.006),palette['wound']))
    return result


def bandage(c,surface,x,y,width,length,angle,palette,seed=1):
    def xy(a,b):return (x+a*math.cos(angle)-b*math.sin(angle),y+a*math.sin(angle)+b*math.cos(angle))
    outline=[xy(a*width,b*length) for a,b in [(-.5,-.5),(-.22,-.48),(-.13,-.51),(.08,-.475),(.25,-.50),(.5,-.49),(.48,.46),(.28,.48),(.14,.45),(-.04,.50),(-.19,.48),(-.46,.5)]]
    result=[patch(c,'Dirty woven wrap over the rounded anatomy',surface,outline,palette['cloth'],.027)]
    for a in (-.34,.26):
        pts=[surface.point(*xy(width*a+t*.008,b),.035) for t,b in enumerate([-length*.47,-length*.23,0,length*.23,length*.46])]
        result.append(horn(c,'Raised cloth fold',pts,[.003,.006,.006,.005,.002],palette['ivory'],8))
    for i in range(3):
        px,py=xy(width*(.19 if i%2 else -.16),length*(-.27+i*.23))
        result.append(patch(c,'Dry irregular stain on bandage',surface,oval(px,py,width*.13,length*.08,angle,.3,seed+i),palette['stain'],.038))
    return result


def head(c,p):
    before=set(c.scene.objects)
    skull=ell(c,'Broad tapering zombie skull',(0,.665,.965),(.38,.51,.255),p['face'])
    for v in skull.data.vertices:
        x,y,z=v.co
        v.co.x=math.copysign(abs(x)**.91,x)*(1-.53*max(0,y))
        if y<0:v.co.y=-abs(y)**.76
    skull.data.update()
    cheeks=[ell(c,'Matted rear cheek ruff',(side*.235,.405,.94),(.205,.23,.18),p['face'],taper=.23,angle=side*.15) for side in (-1,1)]
    surface=Surface([skull,*cheeks])
    def clear_eyes(x,y):return any(((x-side*.178)/.083)**2+((y-.80)/.125)**2<1.25 for side in (-1,1))
    locks(c,'Layered ivory and charcoal facial fur',surface,(-.46,.19,.46,1.16),[p['face']],23,.041,.065,clear_eyes)
    for side in (-1,1):
        x,y=side*.178,.80
        patch(c,'Ragged inflamed eye socket',surface,oval(x,y,.077,.112,side*-.13,.09,3 if side<0 else 7),p['skin'],.024)
        patch(c,'Deep eye socket recess',surface,oval(x,y,.059,.091,side*-.13),p['wound'],.031)
        z=surface.height(x,y)
        ell(c,'Milky blind zombie eye',(x,y,z+.052),(.045,.071,.029),p['eye'],angle=side*-.13)
        ell(c,'Tiny quiet wet-eye highlight',(x-.012,y+.031,z+.09),(.010,.015,.003),p['glint'])
        for edge in (-1,1):
            points=[]
            for i in range(9):
                a=math.pi*(.08+.84*i/8);xx=x+edge*.071*math.sin(a);yy=y+.102*math.cos(a)
                points.append(surface.point(xx,yy,.040))
            horn(c,'Sculpted torn eyelid fold',points,[.007,.011,.012,.012,.013,.012,.011,.009,.004],p['skin'],10)
    ell(c,'Rounded leathery corpse nose',(0,1.15,.994),(.102,.070,.045),p['nose'],taper=.12)
    for side in (-1,1):ell(c,'Nostril cleft',(side*.055,1.17,1.019),(.020,.012,.007),p['wound'])
    scar(c,surface,(-.19,.61),(-.105,.40),p,4,.044)
    return [o for o in c.scene.objects if o not in before and o.type=='MESH']
