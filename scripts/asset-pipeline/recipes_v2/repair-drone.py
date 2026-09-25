"""Twin-duct field mechanic: enamel panels, service tools and exposed mechanics.

North-facing, weaponless and stationless. Only the two impellers rotate; the
machined ducts, tool arms and chassis remain a stable silhouette in flight.
"""
import math
import bpy
from enemy_parts_b import plate, tube
from turret_parts import annulus, grille, finish
from weapon_surface_parts import material, paint_depth


def surfaces(c):
    p = {
        'ivory': material(c, 'Weathered warm porcelain enamel', (.69, .65, .52), .10, 'coat'),
        'teal': material(c, 'Worn petrol green equipment paint', (.063, .24, .205), .14, 'coat'),
        'edge': material(c, 'Satin exposed aluminum', (.44, .48, .46), .38, 'edge'),
        'frame': material(c, 'Phosphate treated tool steel', (.07, .10, .105), .26, 'steel'),
        'black': material(c, 'Deep panel seams', (.014, .025, .027), 0, 'recess'),
        'blade': material(c, 'Graphite impeller laminate', (.12, .16, .16), .12, 'composite'),
        'rubber': material(c, 'Ribbed charcoal hose jacket', (.024, .035, .036), 0, 'rubber'),
        'copper': material(c, 'Tarnished copper service fittings', (.39, .23, .09), .43, 'brass'),
        'yellow': material(c, 'Faded ochre tool warnings', (.61, .39, .085), .02, 'coat'),
        'lamp': c.material('Recessed mint service indicators', (.18, .95, .57), emission=.50),
        'glass': c.material('Smoked diagnostic optics', (.02, .068, .064)),
    }
    for mat in p.values():
        nodes = mat.node_tree.nodes
        uneven = nodes.get('Uneven material finish')
        if uneven:
            uneven.inputs[0].default_value = .28
        bump = nodes.get('Tactile grain and machining')
        if bump:
            bump.inputs['Strength'].default_value = .15
    return p


def screw(c, p, x, y, z, radius=.018):
    c.cylinder('Recessed screw pocket', (x, y, z), radius*1.6, .008, p['black'], 16)
    c.cylinder('Captive hex screw', (x, y, z+.008), radius, .014, p['edge'], 6)
    c.box('Screw driver slot', (x, y, z+.016), (radius, .006, .005), p['black'], .001)


def stencil(c, text, location, size, mat):
    data = bpy.data.curves.new('Service stencil '+text, 'FONT')
    data.body, data.size, data.align_x = text, size, 'CENTER'
    data.extrude = .0004
    data.materials.append(mat)
    ob = bpy.data.objects.new(data.name, data)
    c.scene.collection.objects.link(ob)
    ob.location = location
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')


def fan(c, p, index, x):
    y = -.035
    c.box('Cast lateral motor yoke', (x*.51, y, .28), (.65, .27, .19), p['frame'], .04)
    c.box('Yoke inset painted cap', (x*.54, y, .385), (.52, .14, .026), p['teal'], .015)
    tube(c, 'Motor cable in protective sleeve', [(x*.42, -.15, .31), (x*.65, -.18, .32), (x, -.15, .33)], .023, p['rubber'], 8)
    annulus(c, 'Deep open impeller duct', (x,y,.345), .535, .447, .20, p['frame'], steps=64)
    annulus(c, 'Recessed satin intake bevel', (x,y,.435), .495, .447, .036, p['edge'], steps=64)
    annulus(c, 'Petrol green cast duct shell', (x,y,.443), .543, .494, .045, p['teal'], steps=64)
    for j in range(4):
        start = j*math.tau/4+.027
        annulus(c, 'Replaceable ivory duct guard', (x,y,.474), .546, .503, .035,
                p['ivory'], start=start, end=start+math.tau/4-.054, steps=16)
        a = start+.08
        screw(c,p,x+.524*math.cos(a),y+.524*math.sin(a),.496,.012)
    for j in range(3):
        a = j*math.tau/3+.35
        bar = c.box('Stationary motor support', (x+.27*math.cos(a),y+.27*math.sin(a),.278),
                    (.39,.035,.034),p['frame'],.009)
        bar.rotation_euler.z = a
    c.cylinder('Motor casing', (x,y,.345), .112,.20,p['frame'],32)
    annulus(c,'Copper motor winding collar',(x,y,.434),.110,.090,.023,p['copper'],steps=32)
    side = -1 if x<0 else 1
    c.box('Outer navigation lamp recess',(x+side*.521,y,.49),(.08,.17,.032),p['frame'],.013)
    c.box('Mint navigation strip',(x+side*.525,y,.51),(.025,.112,.012),p['lamp'],.006)
    animated = []
    # Three broad swept blades leave enough negative space to read motion at 32 px.
    shape = [(.09,-.034),(.22,-.080),(.365,-.074),(.43,-.025),(.436,.030),
             (.385,.113),(.31,.145),(.19,.07),(.092,.035)]
    for j in range(3):
        a = j*math.tau/3+index*.27
        points = [(x+r*math.cos(a)-t*math.sin(a),y+r*math.sin(a)+t*math.cos(a)) for r,t in shape]
        animated.append(plate(c,'Swept service impeller blade',(0,0,.403),points,.026,p['blade'],.010))
        lip = [(.21,.068),(.311,.130),(.382,.10),(.421,.04),(.373,.086),(.312,.111)]
        points = [(x+r*math.cos(a)-t*math.sin(a),y+r*math.sin(a)+t*math.cos(a)) for r,t in lip]
        animated.append(plate(c,'Satin blade leading edge',(0,0,.42),points,.006,p['edge'],.002))
    animated.append(c.cylinder('Rotating impeller hub',(x,y,.447),.097,.076,p['frame'],32))
    animated.append(annulus(c,'Brushed hub bearing ring',(x,y,.494),.080,.058,.018,p['edge'],steps=32))
    animated.append(c.cylinder('Hub axle cap',(x,y,.505),.043,.032,p['teal'],12))
    animated.append(c.box('Hub balance witness mark',(x+.065,y,.509),(.024,.021,.008),p['yellow'],.003))
    return animated,(x,y,.403)


def service_arm(c,p,side):
    c.cylinder('Manipulator shoulder joint',(side*.25,.54,.33),.100,.15,p['frame'],24)
    c.cylinder('Shoulder bearing cap',(side*.25,.54,.415),.063,.035,p['edge'],16)
    outline=[(-.055,-.19),(.055,-.19),(.063,.12),(.038,.23),(-.04,.23),(-.063,.12)]
    plate(c,'Exposed service manipulator',(side*.25,.80,.325),outline,.10,p['frame'],.018)
    c.box('Tool arm enamel insert',(side*.25,.77,.383),(.073,.245,.023),p['ivory'],.012)
    tube(c,'Copper hydraulic hardline',[(side*.33,.51,.39),(side*.34,.68,.40),(side*.32,.87,.40)],.013,p['copper'],8)
    c.cylinder('Tool wrist bearing',(side*.25,.995,.34),.062,.09,p['edge'],20)
    # Open gripping jaws unmistakably distinguish these hands from gun barrels.
    for finger in (-1,1):
        jaw=[(side*.25+finger*.035,1.00,.35),(side*.25+finger*.092,1.075,.35),
             (side*.25+finger*.084,1.155,.35),(side*.25+finger*.045,1.175,.35)]
        tube(c,'Open articulated gripper finger',jaw,.025,p['frame'],8)
        c.box('Replaceable gripping pad',(side*.25+finger*.046,1.16,.365),(.035,.058,.03),p['copper'],.006)
    c.box('Wrist ochre service stripe',(side*.25,.953,.395),(.081,.039,.015),p['yellow'],.005)


def body(c,p):
    outline=[(-.23,-.76),(.23,-.76),(.38,-.51),(.38,.23),(.29,.50),(.16,.61),
             (-.16,.61),(-.29,.50),(-.38,.23),(-.38,-.51)]
    plate(c,'Sealed dark magnesium belly',(0,0,.26),outline,.22,p['frame'],.055)
    plate(c,'Petrol green equipment chassis',(0,0,.42),[(x*.98,y*.98) for x,y in outline],.20,p['teal'],.065)
    plate(c,'Ivory service hood gasket',(0,.05,.544),[(-.28,-.38),(.28,-.38),(.29,.20),(.16,.44),(-.16,.44),(-.29,.20)],.038,p['black'],.025)
    plate(c,'Beveled enamel service hood',(0,.05,.580),[(-.254,-.355),(.254,-.355),(.261,.19),(.145,.415),(-.145,.415),(-.261,.19)],.060,p['ivory'],.037)
    # Inlaid spanner mark, authored geometry rather than a generated texture decal.
    # Slight relief separates the overlapping paint shapes without coplanar faces.
    c.box('Petrol wrench marking stem',(0,.10,.616),(.048,.21,.006),p['teal'],.008)
    annulus(c,'Wrench marking open jaw',(0,.24,.614),.088,.049,.006,p['teal'],start=math.pi*.80,end=math.pi*2.20,steps=24)
    annulus(c,'Wrench marking ring end',(0,-.035,.614),.053,.025,.006,p['teal'],steps=24)
    for x,y in [(-.205,-.24),(.205,-.24),(-.156,.30),(.156,.30)]:
        screw(c,p,x,y,.617,.015)
    stencil(c,'S-02',(0,-.222,.615),.069,p['teal'])
    # Separate rear battery cassette, grille and worn grab rail.
    c.box('Rear removable battery cassette',(0,-.56,.546),(.49,.26,.15),p['frame'],.030)
    grille(c,'Battery cooling fins',(0,-.55,.63),.34,.16,p['edge'],p['black'],6,'y')
    tube(c,'Rear tubular lifting handle',[(-.23,-.70,.57),(-.23,-.775,.61),(.23,-.775,.61),(.23,-.70,.57)],.023,p['edge'],10)
    for side in (-1,1):
        c.box('Battery release latch',(side*.244,-.54,.627),(.053,.085,.028),p['yellow'],.008)
        c.box('Side bumper pad',(side*.37,-.22,.512),(.067,.29,.057),p['rubber'],.02)
        for y in (-.31,-.23,-.15):
            c.box('Bumper grip rib',(side*.378,y,.546),(.06,.018,.015),p['frame'],.005)
        service_arm(c,p,side)
        # Restrained interrupted enamel edge chips with exposed primer beneath.
        for x,y,length in [(.20,-.245,.043),(.233,.07,.027),(.15,.345,.031)]:
            c.box('Sparse enamel edge abrasion',(side*x,y,.615),(.009,length,.005),p['edge'],.002)
    c.box('Forward recessed stereo optics',(0,.514,.444),(.23,.14,.095),p['black'],.029)
    for x in (-.062,.062):
        c.cylinder('Diagnostic lens rim',(x,.535,.50),.041,.022,p['edge'],24)
        c.cylinder('Smoked diagnostic lens',(x,.535,.514),.029,.012,p['glass'],24)
        c.cylinder('Mint optical glint',(x-.008,.544,.522),.009,.005,p['lamp'],16)
    for x in (-.19,.19):
        c.box('Front worklight housing',(x,.43,.574),(.073,.092,.045),p['frame'],.013)
        c.box('Recessed mint worklight',(x,.435,.600),(.025,.06,.012),p['lamp'],.005)
    groups,pivots={},{}
    for i,x in enumerate((-.89,.89)):
        groups[f'rotor{i}'],pivots[f'rotor{i}']=fan(c,p,i,x)
    return groups,pivots


def build(c,spec):
    p=surfaces(c)
    groups,pivots=body(c,p)
    for ob in list(c.scene.objects):
        if ob.type=='MESH':
            paint_depth(c,ob)
    return finish(c,[],groups,pivots,sockets={'repair':(0,1.16,.35)})
