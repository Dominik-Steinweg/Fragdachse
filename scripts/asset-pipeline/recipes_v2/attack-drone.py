"""Weathered alloy ducted quadrotor, independent cannon and field service dock.

All relief is geometry under the shared top-down camera. Swept impellers and
hub witness marks belong to explicit counter-rotating mechanical controls.
"""
import math
import bpy
from enemy_parts_b import plate, tube
from turret_parts import annulus, grille, finish
from weapon_surface_parts import material, paint_depth


def surfaces(c):
    palette = {
        'shell': material(c, 'Bead-blasted warm titanium armor', (.40, .425, .43), .28, 'steel'),
        'panel': material(c, 'Cool phosphate service panels', (.18, .215, .23), .23, 'steel'),
        'edge': material(c, 'Rubbed satin alloy edges', (.48, .50, .48), .38, 'edge'),
        'frame': material(c, 'Oil-dark structural gunmetal', (.065, .080, .089), .3, 'steel'),
        'black': material(c, 'Deep intake and panel gaskets', (.012, .018, .023), 0, 'recess'),
        'blade': material(c, 'Worn graphite rotor laminate', (.115, .14, .153), .12, 'composite'),
        'orange': material(c, 'Faded ochre safety paint', (.68, .31, .072), .03, 'coat'),
        'ivory': material(c, 'Aged warm stencil paint', (.69, .68, .55), 0, 'coat'),
        'copper': material(c, 'Oxidized charging contacts', (.36, .20, .074), .40, 'brass'),
        'rubber': material(c, 'Textured rubber bump stops', (.022, .03, .032), 0, 'rubber'),
        'lamp': c.material('Recessed amber signal glass', (1, .29, .033), emission=.65),
        'lens': c.material('Dark smoked optical glass', (.023, .069, .081)),
    }
    # At this physical scale, large rubbed patches must remain subordinate to
    # machining marks and panel relief; the shared weapon finish is too mottled.
    for mat in palette.values():
        nodes = mat.node_tree.nodes
        finish_node = nodes.get('Uneven material finish')
        if finish_node:
            finish_node.inputs[0].default_value = .30
        bump = nodes.get('Tactile grain and machining')
        if bump:
            bump.inputs['Strength'].default_value = .16
    return palette


def mesh(c, name, vertices, faces, mat, bevel=.008):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    data.materials.append(mat)
    ob = bpy.data.objects.new(name, data)
    c.scene.collection.objects.link(ob)
    if bevel:
        mod = ob.modifiers.new('Machined edge radius', 'BEVEL')
        mod.width, mod.segments = bevel, 3
        ob.modifiers.new('Weighted planar normals', 'WEIGHTED_NORMAL')
    return ob


def hull(c, name, sections, bottom, mat):
    """Faceted shell with a vertical belly, sloped shoulders and raised crown."""
    vertices = []
    for y, width, shoulder, crown in sections:
        vertices += [(-width, y, bottom), (width, y, bottom),
                     (width, y, shoulder), (width*.66, y, crown),
                     (-width*.66, y, crown), (-width, y, shoulder)]
    faces = [tuple(range(6)), tuple((len(sections)-1)*6+i for i in reversed(range(6)))]
    for j in range(len(sections)-1):
        for i in range(6):
            a, b = j*6+i, j*6+(i+1)%6
            faces.append((a, a+6, b+6, b))
    return mesh(c, name, vertices, faces, mat, .018)


def screw(c, p, x, y, z, radius=.023):
    c.cylinder('Recessed fastener seat', (x, y, z), radius*1.45, .010, p['black'], 16)
    c.cylinder('Captive hex fastener', (x, y, z+.008), radius, .014, p['edge'], 6)
    c.box('Fastener drive slot', (x, y, z+.016), (radius*.95, .006, .004), p['black'], .001)


def scratches(c,p,x,y,z,scale=1):
    """A few interrupted maintenance scuffs, subordinate to the broad material."""
    for dx,dy,length in [(-.025,0,.074),(.008,.012,.046),(.036,-.017,.034)]:
        points=[(x+dx*scale,y+dy*scale,z),
                (x+(dx+.004)*scale,y+(dy+.006)*scale,z),
                (x+(dx+.018)*scale,y+(dy+length)*scale,z)]
        mesh(c,'Sparse maintenance abrasion',points,[(0,1,2)],p['edge'],0)


def stencil(c, text, location, size, mat, rotation=0):
    data = bpy.data.curves.new('Maintenance stencil '+text, 'FONT')
    data.body, data.size, data.align_x = text, size, 'CENTER'
    data.extrude = .0006
    data.materials.append(mat)
    ob = bpy.data.objects.new(data.name, data)
    c.scene.collection.objects.link(ob)
    ob.location = location
    ob.rotation_euler.z = rotation
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object


def blade(c, p, x, y, z, angle):
    """Swept airfoil with a tapered satin leading edge; no crossed bars."""
    outline = [(.105,-.035),(.20,-.067),(.35,-.076),(.421,-.038),
               (.438,.008),(.40,.072),(.33,.102),(.19,.045),(.107,.031)]
    points = [(x+r*math.cos(angle)-t*math.sin(angle),
               y+r*math.sin(angle)+t*math.cos(angle)) for r,t in outline]
    ob = plate(c, 'Swept five-blade impeller airfoil', (0,0,z), points, .021, p['blade'], .009)
    edge = [(.19,.037),(.331,.092),(.398,.063),(.414,.042),
            (.387,.052),(.33,.076),(.21,.024)]
    points = [(x+r*math.cos(angle)-t*math.sin(angle),
               y+r*math.sin(angle)+t*math.cos(angle),z+.013) for r,t in edge]
    return [ob,mesh(c,'Rubbed impeller leading edge',points,[tuple(range(len(points)))],p['panel'],0)]


def rotor(c, p, index, x, y):
    a = math.atan2(y, x)
    beam = c.box('Diagonal cast magnesium spar',(x*.53,y*.53,.29),
                 (math.hypot(x,y)*.88,.18,.17),p['frame'],.025)
    beam.rotation_euler.z = a
    rib = c.box('Inset spar reinforcement',(x*.58,y*.58,.384),
                (math.hypot(x,y)*.64,.072,.032),p['panel'],.012)
    rib.rotation_euler.z = a
    tube(c,'Armored motor power conduit',[(x*.38,y*.38,.365),(x*.69,y*.63,.39),(x*.91,y*.91,.36)],.022,p['rubber'],8)
    annulus(c,'Deep open fan duct',(x,y,.34),.527,.441,.19,p['frame'],steps=64)
    annulus(c,'Inner intake bevel',(x,y,.435),.494,.443,.034,p['panel'],steps=64)
    annulus(c,'Continuous worn rim lip',(x,y,.463),.531,.497,.037,p['edge'],steps=64)
    for j in range(8):
        start=j*math.tau/8+.020
        annulus(c,'Replaceable duct armor segment',(x,y,.452),.528,.471,.032,
                p['shell'],start=start,end=start+math.tau/8-.040,steps=8)
    for j in range(3):
        a=j*math.tau/3+.2
        spoke=c.box('Motor stator support',(x+.27*math.cos(a),y+.27*math.sin(a),.276),
                    (.37,.04,.042),p['frame'],.008)
        spoke.rotation_euler.z=a
    c.cylinder('Suspended motor housing',(x,y,.365),.117,.21,p['frame'],32)
    annulus(c,'Motor winding collar',(x,y,.437),.115,.094,.021,p['copper'],steps=32)
    for j in range(3):
        a=j*math.tau/3+.48
        screw(c,p,x+.506*math.cos(a),y+.506*math.sin(a),.476,.015)
    outside=1 if x>0 else -1
    c.box('Fan navigation lamp socket',(x+outside*.49,y,.457),(.096,.16,.05),p['frame'],.014)
    c.box('Fan amber navigation slit',(x+outside*.498,y,.488),(.036,.102,.012),p['lamp'],.008)
    animated=[]
    for j in range(5):
        animated += blade(c,p,x,y,.412,index*.19+j*math.tau/5)
    animated.append(c.cylinder('Rotating brushed hub',(x,y,.454),.095,.072,p['panel'],32))
    animated.append(annulus(c,'Machined impeller hub collar',(x,y,.494),.080,.061,.015,p['edge'],steps=32))
    animated.append(c.cylinder('Impeller spindle',(x,y,.507),.033,.033,p['frame'],12))
    animated.append(c.box('Impeller balancing witness mark',(x+.062,y,.505),(.020,.028,.007),p['orange'],.003))
    return animated,(x,y,.412)


def body(c,p):
    sections=[(-.87,.24,.36,.47),(-.64,.40,.44,.65),(-.28,.46,.45,.71),
              (.35,.39,.42,.70),(.77,.25,.35,.53),(.89,.16,.31,.41)]
    hull(c,'Sealed dark lower fuselage',[(y,w*1.04,s-.08,t-.13) for y,w,s,t in sections],.19,p['frame'])
    hull(c,'Faceted titanium flight fuselage',sections,.31,p['shell'])
    # Two real conforming nose panels leave a central seam and a broken shoulder
    # seam. Crown heights follow the loft, so the top view does not fake relief.
    def crown(y):
        for a,b in zip(sections,sections[1:]):
            if a[0] <= y <= b[0]:
                return a[3]+(b[3]-a[3])*(y-a[0])/(b[0]-a[0])
        raise ValueError('Panel extends beyond the fuselage')
    for side in (-1,1):
        outline=[(.013,.245),(.205,.245),(.218,.365),(.145,.686),(.064,.793),(.013,.758)]
        points=[(side*x,y) for x,y in outline]
        panel=plate(c,'Split conforming nose armor',(0,0,0),points,.023,p['panel'],.007)
        for vertex in panel.data.vertices:
            vertex.co.z += crown(vertex.co.y)+.022
        tube(c,'Exposed shoulder panel seam',[(side*.228,.267,crown(.267)+.012),
                   (side*.243,.35,crown(.35)+.012),(side*.166,.69,crown(.69)+.012)],.010,p['black'],6)
    plate(c,'Recessed dorsal service gasket',(0,-.17,.715),
          [(-.25,-.34),(.25,-.34),(.285,.21),(.17,.39),(-.17,.39),(-.285,.21)],.023,p['black'],.02)
    plate(c,'Tapered upper equipment hatch',(0,-.17,.735),
          [(-.226,-.315),(.226,-.315),(.26,.20),(.155,.366),(-.155,.366),(-.26,.20)],.025,p['panel'],.022)
    grille(c,'Dorsal recessed heat exchanger',(0,-.40,.755),.33,.20,p['edge'],p['black'],6,'y')
    c.box('Hatch central stiffening rib',(0,-.07,.759),(.052,.30,.020),p['shell'],.01)
    for x in (-.185,.185):
        screw(c,p,x,-.61,.668,.020)
        screw(c,p,x,.07,.754,.018)
    for side in (-1,1):
        cheek=plate(c,'Separate chamfered shoulder armor',(side*.305,.03,.627),
                    [(-.067,-.30),(.067,-.27),(.075,.16),(.035,.30),(-.050,.23)],.045,p['shell'],.012)
        # The plate vertices are in world space; slope its mesh around its own center.
        for vertex in cheek.data.vertices:
            vertex.co.z -= side*(vertex.co.x-side*.305)*.20
        grille(c,'Shoulder ventilation',(side*.34,-.22,.652),.113,.25,p['panel'],p['black'],4,'y')
        lamp=c.box('Nose amber lamp bezel',(side*.22,.565,.582),(.073,.20,.039),p['frame'],.012)
        lamp.rotation_euler.z=-side*.33
        light=c.box('Nose amber recognition slit',(side*.22,.565,.605),(.027,.14,.009),p['lamp'],.008)
        light.rotation_euler.z=-side*.33
        hull(c,'Rear stabilizer fin',[(-.91,.035,.47,.57),(-.60,.035,.47,.69)],.42,p['frame']).location.x=side*.30
        plate(c,'Faded stabilizer warning tab',(side*.30,-.77,.622),[(-.026,-.09),(.026,-.09),(.026,.10),(-.026,.10)],.008,p['orange'],.004)
    c.box('Forward sensor protective hood',(0,.812,.422),(.245,.19,.14),p['frame'],.038)
    c.box('Smoked forward optical window',(0,.889,.44),(.177,.044,.069),p['lens'],.018)
    c.box('Sensor hood alloy eyebrow',(0,.847,.505),(.213,.114,.022),p['shell'],.014)
    stencil(c,'04',(0,-.26,.754),.095,p['ivory'])
    scratches(c,p,-.15,-.26,.750,.65)
    scratches(c,p,.18,-.43,.750,.45)
    groups,pivots={},{}
    for i,(x,y) in enumerate([(-.91,-.82),(.91,-.82),(-.91,.82),(.91,.82)]):
        groups[f'rotor{i}'],pivots[f'rotor{i}']=rotor(c,p,i,x,y)
    return groups,pivots,{'gun':(0,0,.8)}


def cannon(c,p):
    c.cylinder('Independent cannon yaw bearing',(0,0,.20),.238,.25,p['frame'],32)
    annulus(c,'Worn gimbal bearing lip',(0,0,.338),.211,.173,.035,p['edge'],steps=32)
    hull(c,'Cannon receiver',[(-.27,.126,.38,.43),(.20,.126,.38,.43),(.40,.085,.35,.405)],.25,p['panel'])
    c.box('Removable feed cover',(-.006,-.032,.457),(.192,.27,.041),p['shell'],.021)
    c.box('Feed cover latch',(.084,-.06,.486),(.035,.086,.025),p['frame'],.007)
    scratches(c,p,-.035,-.02,.479,.35)
    c.box('Side ammunition cassette',(.184,-.064,.316),(.137,.31,.16),p['frame'],.028)
    for y in (-.15,-.07,.01):
        c.box('Cassette stamped rib',(.185,y,.407),(.103,.021,.018),p['panel'],.005)
    shroud=c.cylinder('Perforated heat shroud',(0,.733,.341),.074,.71,p['frame'],32)
    shroud.rotation_euler.x=math.pi/2
    for y in (.48,.61,.74,.87,.99):
        ring=annulus(c,'Barrel cooling collar',(0,0,0),.077,.063,.028,p['panel'],steps=24)
        ring.rotation_euler.x=math.pi/2
        ring.location=(0,y,.341)
        c.box('Dark cooling slot',(0,y+.04,.413),(.061,.050,.006),p['black'],.016)
    barrel=c.cylinder('Exposed cannon barrel',(0,1.16,.341),.036,.29,p['edge'],24)
    barrel.rotation_euler.x=math.pi/2
    c.box('Ported muzzle brake',(0,1.365,.341),(.134,.15,.115),p['panel'],.020)
    for side in (-1,1):
        c.box('Muzzle gas port',(side*.038,1.367,.399),(.021,.074,.010),p['black'],.005)
    c.box('Muzzle witness stripe',(0,1.417,.406),(.095,.018,.007),p['edge'],.004)
    screw(c,p,-.051,-.115,.482,.012)
    return {},{},{'muzzle':(0,1.44,.341)}


def station(c,p):
    outline=[(-.88,-1.15),(.88,-1.15),(1.15,-.88),(1.15,.88),(.88,1.15),(-.88,1.15),(-1.15,.88),(-1.15,-.88)]
    plate(c,'Field dock cast chassis',(0,0,.135),outline,.27,p['frame'],.065)
    plate(c,'Worn alloy perimeter deck',(0,0,.30),[(x*.97,y*.97) for x,y in outline],.095,p['shell'],.04)
    plate(c,'Inset phosphate landing deck',(0,0,.357),[(x*.82,y*.82) for x,y in outline],.032,p['panel'],.024)
    for x in (-.34,.34):
        c.box('Faded landing guide stripe',(x,0,.380),(.065,.88,.007),p['orange'],.008)
    c.box('Faded landing crossbar',(0,0,.380),(.64,.065,.007),p['orange'],.008)
    for x,y in [(-.35,-.28),(.33,.21),(-.29,.37),(.31,-.37)]:
        scratches(c,p,x,y,.385,.8)
    for side in (-1,1):
        c.box('Dock rail gasket',(side*.64,0,.398),(.23,1.57,.065),p['black'],.04)
        c.box('Raised alignment rail',(side*.64,0,.458),(.154,1.48,.095),p['frame'],.035)
        c.box('Worn docking rail crown',(side*.64,0,.512),(.094,1.32,.026),p['edge'],.015)
        for y in (-.51,.51):
            c.box('Conductive charging shoe',(side*.62,y,.541),(.16,.20,.037),p['copper'],.012)
            for offset in (-.055,0,.055):
                c.box('Charging shoe contact groove',(side*.62,y+offset,.562),(.123,.012,.004),p['black'],.003)
        grille(c,'Side cooling grille',(side*.945,0,.371),.16,.86,p['frame'],p['black'],8,'y')
        for y in (-.88,.88):
            screw(c,p,side*.94,y,.357,.029)
        for y in (-.93,.93):
            c.box('Corner rubber bumper',(side*.78,y,.387),(.26,.15,.081),p['rubber'],.021)
            for dx in (-.074,0,.074):
                stripe=c.box('Corner ochre safety stripe',(side*.78+dx,y,.432),(.032,.127,.008),p['orange'],.003)
                stripe.rotation_euler.z=-.32
    c.box('Rear service electronics housing',(0,-.964,.415),(.90,.23,.13),p['frame'],.027)
    c.box('Service housing lid',(0,-.964,.491),(.78,.185,.026),p['shell'],.012)
    c.box('Inset station status panel',(-.20,-.967,.507),(.22,.095,.016),p['black'],.009)
    for x in (-.26,-.20,-.14):
        c.box('Station amber status tick',(x,-.967,.519),(.034,.05,.009),p['lamp'],.006)
    c.box('Cable connector cap',(.255,-.967,.522),(.102,.102,.04),p['rubber'],.020)
    stencil(c,'04 / DOCK',(0,.802,.383),.105,p['ivory'])
    for x in (-.25,.25):
        c.box('Rail approach arrow',(x,.65,.383),(.037,.18,.006),p['ivory'],.006)
    return {},{},{'dock':(0,0,.56)}


def build(c,spec):
    p=surfaces(c)
    kind=spec['model']['part']
    groups,pivots,sockets={'body':body,'gun':cannon,'station':station}[kind](c,p)
    for ob in list(c.scene.objects):
        if ob.type=='MESH':
            paint_depth(c,ob)
    return finish(c,[],groups,pivots,sockets=sockets)
