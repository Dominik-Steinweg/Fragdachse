"""Heavy, matted corpse badger: cloudy eyes, stitched hide and aged cloth, in true top view."""
from mathutils import Vector
from recipes_v2.enemy_parts_a import ell, horn, paw, finish
from zombie_surface_parts import Surface, patch, locks, coat_finish, face_bands, weather
from zombie_detail_parts import head, wound, scar, bandage


def build(c,spec):
    p={name:c.material(label,color,'organic' if name in ('coat','light','shade','face','darkfur','ivory') else None)
       for name,label,color in [
        ('coat','Matted grey green corpse fur',(.17,.19,.135)),('light','Pale sage fur locks',(.26,.275,.205)),
        ('shade','Deep sage fur roots',(.10,.12,.09)),('face','Old warm ivory face fur',(.72,.66,.48)),
        ('darkfur','Charcoal paw fur',(.025,.027,.022)),('ivory','Stained old bone',(.58,.49,.32)),
        ('skin','Dry warm torn hide',(.19,.048,.034)),('wound','Deep maroon recess',(.034,.008,.006)),
        ('muscle','Weathered dark red exposed muscle',(.10,.020,.015)),
        ('nose','Matte charcoal nose',(.011,.012,.011)),('eye','Cloudy dead olive eye',(.47,.49,.28)),
        ('cornea','Milky opaque cornea',(.60,.61,.36)),('glint','Restrained corneal highlight',(.85,.85,.64)),
        ('cloth','Aged flax bandage',(.40,.35,.25)),('stain','Dry brown red cloth stain',(.14,.040,.024)),
        ('rust','Dull rusty copper sutures',(.27,.12,.049)),('leather','Worn patched leather',(.145,.063,.030)),
        ('pad','Cracked calloused paw pads',(.14,.12,.088))]}
    limbs={}
    for name,x,y,w in [('front_left',-.91,.35,.205),('front_right',.91,.32,.215),
                       ('rear_left',-.71,-.66,.195),('rear_right',.72,-.64,.195)]:
        joint,parts=paw(c,name,x,y,p['coat'],p['darkfur'],p['ivory'],width=w,length=.27,toe_length=.13)
        upper=locks(c,name+' blended upper limb fur',Surface(parts[:1]),(x*.83-w*1.2,y-.39,x*.83+w*1.2,y+.21),[p['coat'],p['light']],len(name)+37,.038,.065)
        upper['FD_ZombieProximal']=True;parts.append(upper)
        foot=Surface([parts[1]])
        parts.append(locks(c,name+' short paw fur',foot,(x-w,y-.20,x+w,y+.18),[p['darkfur'],p['shade']],len(name),.039,.055))
        for j in range(3):
            parts.append(ell(c,name+' rough toe pad',(x+(j-1)*w*.57,y+.065,.303),(.040,.053,.019),p['pad']))
        if name in ('rear_left','front_right'):
            cover=Surface(parts[:2])
            parts.extend(bandage(c,cover,x,y-.080,w*1.4,.100,-.30 if x<0 else .26,p,4))
        limbs[name]=(joint,parts)
    torso=ell(c,'Continuous heavy hunched torso',(0,-.19,.52),(.735,.79,.355),p['coat'])
    shoulders=[ell(c,'Connected sloping shoulder',(side*.47,.15,.62),(.32,.40,.26),p['coat'],angle=side*.25) for side in (-1,1)]
    body=[torso,*shoulders]
    surface=Surface(body)
    def clear_damage(x,y):
        return ((x+.31)/.235)**2+((y+.21)/.31)**2<.86 or ((x-.48)/.095)**2+((y-.04)/.23)**2<.85
    body.append(locks(c,'Layered long sage body coat',surface,(-.81,-.92,.81,.53),[p['coat'],p['light'],p['shade']],19,.054,.093,clear_damage))
    body.extend(wound(c,surface,-.31,-.21,.223,.29,p,-.14,9))
    for j in range(int(spec.get('model',{}).get('exposedRibs',3))):
        y=-.035-j*.145
        points=[surface.point(x,y+dy,.061) for x,dy in [(-.48,-.035),(-.40,.017),(-.29,.048),(-.20,-.014)]]
        body.append(horn(c,'Uneven exposed curved rib',points,[.021,.033,.035,.013],p['ivory'],14))
        body.append(horn(c,'Rib surface age crack',[surface.point(-.38,y+.017,.096),surface.point(-.35,y+.023,.100)],[.0025,.001],p['stain'],8))
    body.extend(wound(c,surface,.48,.04,.081,.22,p,.30,11))
    body.extend(wound(c,surface,-.54,.24,.055,.080,p,-.2,15))
    body.extend(scar(c,surface,(-.54,-.03),(-.41,.20),p,3,.040))
    body.extend(scar(c,surface,(-.17,-.71),(-.09,-.50),p,4,.037))
    body.extend(bandage(c,surface,.24,-.64,.15,.38,.29,p,20))
    body.extend(bandage(c,surface,.355,-.59,.085,.35,.32,p,21))
    leather=[(.355,-.50),(.535,-.415),(.60,-.61),(.425,-.68)]
    body.append(patch(c,'Conforming stitched leather repair',surface,leather,p['leather'],.041))
    body.extend(scar(c,surface,(.37,-.51),(.432,-.64),p,3,.026))
    body.extend(scar(c,surface,(.54,-.45),(.575,-.585),p,3,.026))
    skull=head(c,p)
    tail=[horn(c,'Curved ragged pale tail',[(0,-.84,.38),(.04,-1.04,.29),(.15,-1.17,.24)],[.14,.092,.009],p['face'],16)]
    tail.append(locks(c,'Ragged tail fur',Surface(tail),(-.13,-1.17,.16,-.85),[p['face']],77,.035,.063))
    asset=finish(c,body,skull,limbs,tail)
    # Proximal fur follows the same skin weights as its supporting upper limb.
    for name,(joint,objects) in limbs.items():
        origin=Vector(joint);reach=objects[1].matrix_world.translation-origin
        for ob in [o for o in objects if o.get('FD_ZombieProximal')]:
            fixed=ob.vertex_groups.new(name='root');moving=ob.vertex_groups[name]
            for v in ob.data.vertices:
                t=max(0,min(1,(ob.matrix_world@v.co-origin).dot(reach)/reach.length_squared));weight=t*t*(3-2*t)
                moving.add([v.index],weight,'REPLACE');fixed.add([v.index],1-weight,'REPLACE')
    coat_finish(c,{p[k] for k in ('coat','light','shade','face','darkfur','ivory')})
    for key in ('skin','wound','muscle','leather','rust','pad','nose','eye'):weather(p[key])
    weather(p['cloth'],cloth=True)
    p['eye'].node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.36
    face_material=p['face'].copy();face_material.name='Textured broken badger face stripes'
    face_bands(face_material)
    for ob in skull:
        for slot in ob.material_slots:
            if slot.material==p['face']:slot.material=face_material
    c.strengths.append(face_material.node_tree.nodes['Surface detail strength'].inputs[0])
    return asset
