"""Hand-built lobby joinery, loose equipment and uneven masonry; no lighting changes."""
import math
import random
import bpy
from dawn_parts import tube, annulus, plate, beam, crown, bolt


def endgrain(c,x,y,z,r,p):
    for j in range(1,5):
        points=[]
        for i in range(33):
            a=i*math.tau/32;rr=r*j/5*(1+.05*math.sin(a*3+j))
            points.append((x+rr*math.cos(a),y+rr*.91*math.sin(a),z+.001*j))
        tube(c,'Irregular end grain annual ring',points,.004,p['wood'],6)
    tube(c,'Radial seasoning crack',[(x-r*.8,y+.02,z+.01),(x-r*.25,y-.015,z+.01),(x+.03,y,z+.01)],.006,p['dark'],6)


def rock(c,name,pos,size,p,seed):
    rng=random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=pos)
    ob=bpy.context.object;ob.name=name
    for v in ob.data.vertices:
        f=rng.uniform(.89,1.1)
        v.co.x*=size[0]*f;v.co.y*=size[1]*f;v.co.z*=size[2]*f
    ob.data.materials.append(p['stone'])
    bevel=ob.modifiers.new('Rounded weather broken stone','BEVEL');bevel.width=.018;bevel.segments=2
    ob.modifiers.new('Broad chipped stone normals','WEIGHTED_NORMAL')
    for i in range(3 if seed%3 else 6):
        a=rng.uniform(0,math.tau);r=rng.uniform(.15,.75)
        c.ell('Clinging moss in fieldstone pits',(pos[0]+size[0]*r*math.cos(a),pos[1]+size[1]*r*math.sin(a),pos[2]+size[2]*.82),(.035+r*.035,.025+r*.03,.018),p['moss'])
    return ob


def barrel(c,x,y,z,r,p,open_top=False):
    for i in range(14):
        a=math.tau*i/14
        ob=c.box('Separate barrel oak stave',(x+math.cos(a)*r*.85,y+math.sin(a)*r*.85,z+r*.6),(r*.37,r*.19,r*1.5),p['cut'] if i%3==0 else p['wood'],.024)
        ob.rotation_euler.z=a+math.pi/2
    for h in (.12,.95,1.35):annulus(c,'Forged barrel hoop',(x,y,z+r*h),r*1.02,r*.91,.035,p['iron'],steps=32)
    c.cylinder('Recessed barrel opening',(x,y,z+r*1.29),r*.86,.045,p['dark'],32)
    if not open_top:
        for i in range(5):
            yy=(i-2)*r*.31;half=math.sqrt(max(.01,(r*.83)**2-yy**2))
            c.box('Barrel lid plank',(x,y+yy,z+r*1.38),(half*2,r*.28,.035),p['cut'] if i%2 else p['wood'],.009)
        bolt(c,x+r*.33,y-r*.23,z+r*1.43,p['brass'],r*.13)


def rope(c,x,y,z,r,p):
    points=[]
    for i in range(150):
        t=i/149;a=t*math.tau*4.5;rr=r*(.32+.66*t)
        points.append((x+rr*math.cos(a),y+rr*.83*math.sin(a),z+.009*math.sin(a*3)))
    tube(c,'Coiled hemp rope',points,.017,p['rope'],8)
    tube(c,'Loose rope tail',[points[-1],(x+r*1.1,y-.1,z),(x+r*1.25,y+.08,z)],.016,p['rope'],8)


def sack(c,x,y,z,p,coal=False):
    c.ell('Slumped canvas sack',(x,y,z+.15),(.19,.23,.18),p['cloth'])
    for side in (-1,1):tube(c,'Sack gathered fold',[(x+side*.14,y-.08,z+.20),(x+side*.09,y+.08,z+.28),(x+side*.07,y+.13,z+.32)],.018,p['cut'],8)
    annulus(c,'Rolled sack mouth',(x,y+.09,z+.30),.11,.077,.045,p['cloth'],steps=24)
    c.cylinder('Dark sack contents',(x,y+.09,z+.29),.078,.028,p['coal'] if coal else p['wood'],20)
    if coal:
        for i in range(7):c.ell('Coal in open sack',(x+.05*math.cos(i*2.4),y+.09+.05*math.sin(i*2.4),z+.31),(.035,.031,.025),p['coal'])


def lantern(c,x,y,z,p):
    c.cylinder('Lantern brass foot',(x,y,z),.11,.045,p['brass'],12)
    c.cylinder('Small warm lantern glass',(x,y,z+.10),.067,.17,p['lamp'],12)
    annulus(c,'Open lantern top',(x,y,z+.19),.104,.068,.045,p['brass'],steps=12)
    for i in range(4):
        a=i*math.pi/2
        tube(c,'Lantern protective cage',[(x+.085*math.cos(a),y+.085*math.sin(a),z),(x+.085*math.cos(a),y+.085*math.sin(a),z+.20)],.012,p['dark'],8)


def crate(c,x,y,z,p,scale=1):
    s=scale
    c.box('Crate recessed interior',(x,y,z+.10*s),(.43*s,.39*s,.20*s),p['dark'],.015)
    for xx in (-.23,.23):c.box('Crate end board',(x+xx*s,y,z+.15*s),(.055*s,.46*s,.30*s),p['wood'],.012)
    for yy in (-.22,.22):c.box('Crate side board',(x,y+yy*s,z+.15*s),(.46*s,.05*s,.30*s),p['cut'],.012)
    for i in range(3):c.box('Loose crate contents',(x+(i-1)*.10*s,y+.015*i,z+.15*s),(.07*s,.31*s,.16*s),p['rust'],.014)


def hammer(c,x,y,z,p,angle=0):
    dx,dy=.34*math.sin(angle),.34*math.cos(angle)
    beam(c,'Hammer oak haft',(x,y),(x+dx,y+dy),.042,z,p['cut'])
    ob=c.box('Hammer forged cheeks',(x+dx,y+dy,z+.04),(.22,.095,.085),p['iron'],.022);ob.rotation_euler.z=-angle
    c.box('Hammer haft wedge',(x+dx,y+dy,z+.087),(.035,.05,.01),p['wood'],.004)


def tongs(c,x,y,z,p):
    for side in (-1,1):
            tube(c,'Curved forge tong arm',[(x+side*.085,y-.19,z),(x+side*.035,y-.02,z+.01),(x-side*.03,y+.07,z+.01),(x-side*.07,y+.16,z+.01),(x-side*.035,y+.20,z)],.024,p['iron'],8)
    bolt(c,x,y,z+.04,p['brass'],.025)


def scraps(c,points,p):
    for i,(x,y) in enumerate(points):
        ob=plate(c,'Scattered curled offcut',(0,0,0),[(-.05,-.025),(.08,-.018),(.06,.023),(-.025,.035)],.025,p['cut'] if i%3 else p['rust'],.008)
        ob.location=(x,y,.18)
        ob.rotation_euler.z=i*1.7


def upgrade_chest(c,x,y,p):
    # Four crowned lid slats and iron corner straps build real relief.
    for j in range(4):
        yy=y+(j-1.5)*.112;h=.65+.035*math.cos((j-1.5)*.75)
        c.box('Chest separate rounded lid slat',(x,yy,h),(.60,.105,.07),p['cut'] if j%2 else p['wood'],.018)
    for xx in (x-.22,x+.22):
        tube(c,'Arched riveted chest band',[(xx,y-.23,.63),(xx,y-.12,.70),(xx,y+.12,.70),(xx,y+.23,.63)],.027,p['iron'],10)
        for yy in (y-.18,y+.18):bolt(c,xx,yy,.715,p['brass'],.019)
    c.box('Chest broad lock plate',(x,y-.18,.71),(.115,.14,.035),p['brass'],.012)
    c.cylinder('Lock keyhole',(x,y-.19,.734),.016,.005,p['dark'],12)
