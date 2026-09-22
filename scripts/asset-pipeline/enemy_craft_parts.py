"""Explicitly owned fur, stone fissures, grown pores and seams for authored enemies."""
import math
import random
from mathutils import Vector
from recipes_v2.enemy_parts_a import finish as original_a, horn, ell
from enemy_parts_b import finish as original_b
from enemy_surface_parts import finish_surfaces
from zombie_surface_parts import Surface, locks, coat_finish
from enemy_craft_heads import head_a, head_b, face_mask
from enemy_craft_surfaces import finish_material, sculpt_stone, attach_depth


def bounds(ob):
    points=[ob.matrix_world@Vector(p) for p in ob.bound_box]
    return min(p.x for p in points),min(p.y for p in points),max(p.x for p in points),max(p.y for p in points)


def decorate(c,ob,kind,accent,seed):
    surface=Surface([ob]);xmin,ymin,xmax,ymax=bounds(ob);w=xmax-xmin;h=ymax-ymin
    if min(w,h)<.16:return []
    x=(xmin+xmax)/2;y=(ymin+ymax)/2;rng=random.Random(seed);parts=[]
    def line(name,coords,radius,mat):
        hits=[surface.point(px,py,.009) for px,py in coords if surface.height(px,py) is not None]
        if len(hits)>1:parts.append(horn(c,name,hits,[radius*.4]+[radius]*(len(hits)-2)+[radius*.2],mat,8))
    if kind=='stone':
        angle=rng.uniform(-1.4,1.4)
        def crack(t,s):
            t+=rng.uniform(-.024,.024);s+=rng.uniform(-.026,.026)
            return x+w*(t*math.cos(angle)-s*math.sin(angle)),y+h*(s*math.cos(angle)+t*math.sin(angle))
        path=[crack(t,s) for t,s in [(-.22,.23),(-.10,.12),(-.14,.015),(.045,-.07),(.08,-.25)]]
        line('Fine weathered stone fracture',path,.008,accent)
        line('Branching recessed mineral seam',[path[2],crack(-.29,-.04),crack(-.35,-.14)],.005,accent)
        for i in range(10):
            px=x+rng.uniform(-.30,.30)*w;py=y+rng.uniform(-.32,.32)*h;z=surface.height(px,py)
            if z is not None:parts.append(ell(c,'Small eroded stone pore',(px,py,z+.003),(.009,.012,.003),accent))
    elif kind=='chitin':
        # Grown keratin has tapered growth striae, never mechanical bolts.
        for side in (-1,1):
            for j in range(5):
                yy=y+h*(.27-j*.105)
                line('Tapered organic growth crease',[(x+side*w*.39,yy),(x+side*w*.32,yy-h*.025),(x+side*w*(.22+.018*(j%2)),yy-h*.065)],.0035,accent)
    elif kind=='metal':
        for side in (-1,1):
            line('Recessed fitted armor seam',[(x+side*w*.27,y+h*.26),(x+side*w*.33,y+h*.10),(x+side*w*.22,y-h*.22)],.006,accent)
            for dy in (-.20,.22):
                px=x+side*w*.28;py=y+h*dy;z=surface.height(px,py)
                if z is not None:parts.append(ell(c,'Small recessed armor fastener',(px,py,z+.007),(.014,.014,.005),accent))
    elif kind=='sac':
        for side in (-1,1):
            main=[(x+side*w*.28,y+h*.25),(x+side*w*.19,y+h*.11),(x+side*w*.25,y-h*.03),(x+side*w*.15,y-h*.28)]
            line('Thin embedded chamber vein',main,.0045,accent)
            line('Branching chamber capillary',[main[1],(x+side*w*.06,y+h*.04),(x,y-h*.02)],.003,accent)
    elif kind=='fungus':
        for i in range(24):
            a=i*2.399;r=rng.uniform(.12,.39);px=x+math.cos(a)*w*r;py=y+math.sin(a)*h*r
            z=surface.height(px,py)
            if z is not None:parts.append(ell(c,'Tiny grown mushroom pore',(px,py,z+.005),(.009,.012,.005),accent))
    elif kind in ('leather','cloth'):
        for side in (-1,1):
            for i in range(9):
                px=x+side*w*.36;py=y+h*(-.34+i*.085)
                line('Short hand-stitched seam',[(px-.010,py-.012),(px+.010,py+.012)],.004,accent)
    return parts


def refine(c,body,skull,limbs,fur,materials,extra=()):
    """The recipe supplies material roles and group references; all details inherit their owner's motion."""
    fur=set(fur);groups=[body,*extra]
    for material in fur:material['FD_CraftFur']=True
    # Sculpt surfaces before projecting details onto them.
    for group in groups+[objects for joint,objects in limbs.values()]:
        for ob in list(group):
            roles=[materials[m] for m in ob.data.materials if m in materials][:1]
            if any(role[0]=='stone' for role in roles):sculpt_stone(ob)
            for kind,accent in roles:
                group.extend(decorate(c,ob,kind,accent,len(group)))
    for index,group in enumerate(groups):
        bases=[ob for ob in group if any(m in fur for m in ob.data.materials)]
        if not bases:continue
        surface=Surface(bases);boxes=[bounds(ob) for ob in bases]
        rect=(min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes))
        group.append(locks(c,'Flowing body coat attached to its control',surface,rect,[bases[0].data.materials[0]],51+index,.047,.082))
    for index,(name,(joint,objects)) in enumerate(limbs.items()):
        upper=objects[0]
        if any(m in fur for m in upper.data.materials):
            ob=locks(c,'Blended proximal limb fur',Surface([upper]),bounds(upper),[upper.data.materials[0]],71+index,.034,.058)
            ob['FD_CraftProximal']=True;objects.append(ob)
    meshes=[ob for ob in c.scene.objects if ob.type=='MESH']
    attach_depth(c,meshes)
    finish_surfaces(c.scene)
    fur.update(m for ob in meshes for m in ob.data.materials if m and m.get('FD_CraftFur'))
    coat_finish(c,fur)
    for m in fur:
        if m.get('FD_CraftMask'):face_mask(m)
    for mat,(kind,accent) in materials.items():finish_material(mat,kind)


def limb_fur_weights(limbs,family):
    for name,(joint,objects) in limbs.items():
        origin=Vector(joint);reach=objects[1].matrix_world.translation-origin
        for ob in [o for o in objects if o.get('FD_CraftProximal')]:
            fixed=ob.vertex_groups.new(name='root');moving=ob.vertex_groups[name]
            for vertex in ob.data.vertices:
                t=(ob.matrix_world@vertex.co-origin).dot(reach)/max(reach.length_squared,1e-8)
                if family=='b':t=(t-.12)/.76
                t=max(0,min(1,t));weight=t*t*(3-2*t)
                moving.add([vertex.index],weight,'REPLACE');fixed.add([vertex.index],1-weight,'REPLACE')


def finish_a(c,body,skull,limbs,tail=None):
    asset=original_a(c,body,skull,limbs,tail);limb_fur_weights(limbs,'a');return asset


def finish_b(c,limbs,body,head=None,head_pivot=(0,.35,.75),extras=None):
    asset=original_b(c,limbs,body,head,head_pivot,extras);limb_fur_weights(limbs,'b');return asset
