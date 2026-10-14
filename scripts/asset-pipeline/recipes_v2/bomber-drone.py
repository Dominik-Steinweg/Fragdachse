"""B3 twin-duct VTOL bomber and its shared north-facing P1 ordnance."""
import math
import bpy
from enemy_parts_b import plate
from turret_parts import annulus, grille, finish
from weapon_surface_parts import material, paint_depth


def surfaces(c):
    colors = {
        'shell': ((.26, .275, .26), 'steel'),
        'panel': ((.085, .105, .11), 'steel'),
        'edge': ((.43, .44, .40), 'edge'),
        'frame': ((.055, .068, .073), 'steel'),
        'blade': ((.19, .205, .19), 'composite'),
        'ochre': ((.52, .32, .095), 'coat'),
        'bomb': ((.18, .20, .13), 'coat'),
    }
    palette = {key: material(c, 'Bomber '+key, color, .12, kind)
               for key, (color, kind) in colors.items()}
    for mat in palette.values():
        mat.node_tree.nodes['Uneven material finish'].inputs[0].default_value = .32
        mat.node_tree.nodes['Tactile grain and machining'].inputs['Strength'].default_value = .12
    return palette


def loft(c, name, sections, bottom, mat):
    vertices = []
    for y, width, shoulder, crown in sections:
        vertices += [(-width,y,bottom), (width,y,bottom), (width,y,shoulder),
                     (width*.58,y,crown), (-width*.58,y,crown), (-width,y,shoulder)]
    faces = [tuple(reversed(range(6))), tuple((len(sections)-1)*6+i for i in range(6))]
    for j in range(len(sections)-1):
        for i in range(6):
            a, b = j*6+i, j*6+(i+1)%6
            faces.append((a,b,b+6,a+6))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(mat)
    ob = bpy.data.objects.new(name, mesh)
    c.scene.collection.objects.link(ob)
    bevel = ob.modifiers.new('Soft machined corners', 'BEVEL')
    bevel.width, bevel.segments = .012, 3
    ob.modifiers.new('Hull normals', 'WEIGHTED_NORMAL')
    return ob


def bomb(c, p, x=0, y=0, z=0, scale=1):
    """Revolved long casing, nose band and actual tail fins, axis +Y."""
    profile = [(-.52,.043),(-.32,.064),(-.19,.093),(.13,.096),
               (.29,.081),(.40,.053),(.49,.012)]
    vertices = [(x+scale*r*math.cos(a*math.tau/32), y+scale*t,
                 z+scale*r*math.sin(a*math.tau/32)) for t,r in profile for a in range(32)]
    faces = [tuple(reversed(range(32))),tuple((len(profile)-1)*32+i for i in range(32))]
    faces += [(j*32+i,j*32+(i+1)%32,(j+1)*32+(i+1)%32,(j+1)*32+i)
              for j in range(len(profile)-1) for i in range(32)]
    mesh = bpy.data.meshes.new('Long bomb casing')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(p['bomb'])
    ob = bpy.data.objects.new('P1 long north-facing bomb', mesh)
    c.scene.collection.objects.link(ob)
    for poly in mesh.polygons:
        poly.use_smooth = True
    collar = c.cylinder('Faded nose identification band', (x,y+.30*scale,z), .080*scale, .040*scale, p['ochre'], 32)
    collar.rotation_euler.x = math.pi/2
    for side in (-1,1):
        outline = [(side*a*scale,b*scale) for a,b in [(0,-.27),(.15,-.43),(.15,-.56),(.04,-.50),(0,-.50)]]
        plate(c,'Bomb tail stabilizer',(x,y,z),outline,.022*scale,p['bomb'],.005*scale)
    c.box('Vertical bomb tail fin',(x,y-.43*scale,z+.035*scale),(.018*scale,.26*scale,.18*scale),p['panel'],.004*scale)


def rotor(c,p,index,x,y):
    annulus(c,'Open structural fan duct',(x,y,.30),.60,.465,.18,p['frame'],steps=64)
    annulus(c,'Intake inner chamfer',(x,y,.405),.58,.460,.03,p['panel'],steps=64)
    for j in range(8):
        a=j*math.tau/8
        annulus(c,'Segmented titanium duct rim',(x,y,.425),.603,.485,.045,p['shell'],start=a+.008,end=a+math.tau/8-.008,steps=8)
    for j in range(3):
        a=j*math.tau/3
        spar=c.box('Stationary motor support',(x+.27*math.cos(a),y+.27*math.sin(a),.27),(.49,.031,.04),p['frame'],.008)
        spar.rotation_euler.z=a
    animated=[]
    # Five blades avoid a visually identical sample at each 30-degree step.
    for j in range(5):
        a=j*math.tau/5+index*.15
        outline=[(.07,-.035),(.20,-.075),(.43,-.025),(.455,.045),(.37,.115),(.16,.055)]
        points=[(r*math.cos(a)-t*math.sin(a),r*math.sin(a)+t*math.cos(a)) for r,t in outline]
        animated.append(plate(c,'Swept rotor blade',(x,y,.36),points,.025,p['blade'],.012))
    animated.append(c.cylinder('Rotor hub',(x,y,.40),.104,.11,p['panel'],32))
    animated.append(c.box('Hub balance witness',(x+.05,y,.46),(.035,.06,.008),p['ochre'],.003))
    c.box('Outer duct safety tab',(x+(-.57 if x<0 else .57),y,.456),(.052,.16,.012),p['ochre'],.008)
    return animated,(x,y,.36)


def body(c,p):
    sections=[(-1.73,.075,.30,.37),(-1.25,.13,.33,.43),(-.67,.24,.37,.55),
              (.10,.29,.40,.59),(.73,.26,.38,.57),(1.27,.19,.32,.47),(1.75,.015,.22,.25)]
    loft(c,'Slender armored VTOL fuselage',sections,.18,p['shell'])
    plate(c,'Dorsal equipment panel',(0,-.12,.607),[(-.16,-.41),(.16,-.41),(.17,.32),(.10,.47),(-.10,.47),(-.17,.32)],.023,p['panel'],.018)
    grille(c,'Aft heat exchanger',(0,-.38,.63),.23,.22,p['edge'],p['frame'],5,'y')
    loft(c,'Forward avionics armor',[(.50,.15,.56,.60),(.82,.14,.55,.58),(1.22,.09,.47,.50),(1.34,.04,.43,.45)],.40,p['panel'])
    loft(c,'Aft service armor',[(-1.19,.075,.42,.46),(-.76,.14,.53,.57),(-.64,.14,.55,.58)],.35,p['panel'])
    plate(c,'Faded north recognition mark',(0,1.40,.40),[(-.07,-.05),(.07,-.05),(0,.12)],.012,p['ochre'],.005)
    groups,pivots,sockets={},{},{}
    for side in (-1,1):
        wing=[(side*x,y) for x,y in [(.20,.025),(.90,-.02),(.95,-.30),(.22,-.34)]]
        plate(c,'Stub wing structural fairing',(0,0,.32),wing,.10,p['shell'],.025)
        tail=[(side*x,y) for x,y in [(.07,-1.18),(.59,-1.48),(.60,-1.70),(.11,-1.61)]]
        plate(c,'Swept horizontal tailplane',(0,0,.32),tail,.065,p['shell'],.016)
        c.box('Tailplane warning tab',(side*.55,-1.59,.365),(.045,.14,.012),p['ochre'],.005)
        for j in range(3):
            x,y=side*(.40+j*.18),-.16
            bomb(c,p,x,y,.16,1.0)
            for offset in (-.13,.10):
                c.box('Bomb rack retaining clip',(x,y+offset,.255),(.12,.037,.11),p['frame'],.008)
            sockets[f'bomb{len(sockets)}']=(x,y,.16)
        index=0 if side<0 else 1
        groups[f'rotor{index}'],pivots[f'rotor{index}']=rotor(c,p,index,side*1.23,-.16)
    loft(c,'Vertical tail rudder',[(-1.77,.025,.35,.39),(-1.37,.025,.39,.70),(-1.16,.025,.39,.47)],.30,p['panel'])
    sockets['nose']=(0,1.75,.25)
    return groups,pivots,sockets


def build(c,spec):
    p=surfaces(c)
    if spec['model']['part']=='body':
        groups,pivots,sockets=body(c,p)
    else:
        bomb(c,p)
        for ob in list(c.scene.objects):
            if ob.type=='MESH':
                ob.scale.x *= spec['model']['widthScale']
        groups,pivots,sockets={},{},{'release':(0,0,0)}
    for ob in list(c.scene.objects):
        if ob.type=='MESH':
            paint_depth(c,ob)
    return finish(c,[],groups,pivots,sockets=sockets)
