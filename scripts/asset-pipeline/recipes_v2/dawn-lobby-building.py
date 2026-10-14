"""Three open lobby workspaces, authored as real geometry for the fixed -Z camera."""
import math
import bpy
from dawn_parts import material_factory, root, finish, plate, beam, tube, annulus, crown
from dawn_lobby_details import rock, endgrain, barrel, rope, sack, lantern, crate, hammer, tongs, scraps, upgrade_chest


def palette(c, spec):
    m = material_factory(c, spec)
    return dict(wood=m('Old oak', (110, 88, 62), .3),
                cut=m('Exposed timber', (145, 122, 87), .3),
                dark=m('Soot iron', (43, 44, 39), .18),
                iron=m('Forged iron', (133, 139, 135), .24),
                stone=m('Fieldstone', (116, 119, 107), .42),
                cloth=m('Weathered canvas', (166, 156, 127), .25),
                paper=m('Plan parchment', (185, 177, 147), .1),
                rust=m('Rust seams', (108, 73, 49), .35),
                coal=m('Forge coal', (30, 29, 25), .1),
                ember=m('Separate forge ember', (222, 85, 19), .05, .7),
                brass=m('Worn brass fittings',(158,119,61),.3),
                rope=m('Hemp cord',(142,128,94),.3),
                moss=m('Masonry moss',(66,78,41),.5),
                water=m('Quenching water',(48,63,61),.05),
                lamp=m('Separate lantern emission',(244,153,53),.01,.7))


def post(c, x, y, p, h=1.1):
    c.cylinder('Rough timber upright', (x, y, h/2), .075, h, p['wood'], 10)
    c.cylinder('End grain cap', (x, y, h+.012), .071, .025, p['cut'], 10)
    annulus(c, 'Iron post collar', (x, y, h-.07), .079, .069, .055, p['dark'], steps=12)
    endgrain(c,x,y,h+.026,.067,p)


def deck(c, rows, p):
    # Structural planks only, never an environment ground plane.
    for j, (y, x, width) in enumerate(rows):
        c.box('Recessed structural timber underlap',(x,y,.025),(width,.218,.045),p['wood'],.008)
        # Unequal staggered joints, broader bevel and one lifted edge catch form light.
        split=x+width*(.10*math.sin(j*7))
        for k,(lo,hi) in enumerate([(x-width/2,split-.012),(split+.012,x+width/2)]):
            ob=c.box('Jointed weathered floorboard', ((lo+hi)/2, y, .08+.008*math.sin(j*4+k)), (hi-lo, .199, .13), p['wood'] if (j+k)%3 else p['cut'], .026)
            ob.rotation_euler.x=.015*math.sin(j*3)
        for dx in (-width/2+.08, width/2-.08):
            c.cylinder('Recessed floor nail', (x+dx, y, .15), .014, .008, p['dark'], 8)
        if j % 2 == 0:
            tube(c, 'Split in old floorboard', [(x-width*.28,y+.028,.15), (x,y+.035,.15), (x+width*.18,y+.021,.15)], .005, p['dark'], 6)


def canopy(c, pts, p, material=None):
    # Barycentric fabric with slack between three tied corners.
    n=32; vertices=[]; index={}; faces=[]
    for i in range(n+1):
        for j in range(n+1-i):
            a=i/n; b=j/n; d=1-a-b
            v=[a*pts[0][k]+b*pts[1][k]+d*pts[2][k] for k in range(3)]
            v[2]-=.25*27*a*b*d
            # Unequal folds converge at tied corners, without a corrugated rhythm.
            v[2]+=.022*math.sin((a-b)*math.pi*4+d*d*9)*math.sin(math.pi*d)
            v[2]+=.032*math.exp(-((a-.18-.3*d)/.06)**2)*math.sin(math.pi*d)
            v[2]-=.018*math.exp(-((b-.12-.18*d)/.07)**2)*math.sin(math.pi*a)
            index[i,j]=len(vertices); vertices.append(v)
    for i in range(n):
        for j in range(n-i):
            faces.append((index[i,j], index[i+1,j], index[i,j+1]))
            if i+j<n-1: faces.append((index[i+1,j], index[i+1,j+1], index[i,j+1]))
    mesh=bpy.data.meshes.new('Slack triangular cloth'); mesh.from_pydata(vertices,[],faces); mesh.update()
    ob=bpy.data.objects.new('Open partial weather shelter',mesh); c.scene.collection.objects.link(ob)
    mesh.materials.append(material or p['cloth'])
    ob.modifiers.new('Woven cloth thickness','SOLIDIFY').thickness=.014
    for face in mesh.polygons: face.use_smooth=True
    for a,b in zip(pts,pts[1:]+pts[:1]): tube(c,'Rope sewn canvas hem',[a,b],.018,p['cut'],8)
    for a in pts:
        # Guylines stay inside the fixed canvas and meet an actual peg.
        target=(a[0]*1.035,a[1]*.98,.22)
        tube(c,'Taut canopy guy rope',[a,target],.013,p['rope'],8)
        c.cylinder('Guyline wooden peg',target,.035,.30,p['cut'],8)
    return ob


def chest(c,x,y,p):
    c.box('Storage chest carcass',(x,y,.32),(.62,.49,.36),p['wood'],.045)
    crown(c,'Sloped chest lid',(x,y,.49),.65,.51,.11,p['cut'])
    for xx in (x-.22,x+.22):
        c.box('Broad iron chest band',(xx,y,.604),(.055,.48,.025),p['dark'],.009)
    c.box('Iron chest clasp',(x,y-.19,.60),(.085,.14,.035),p['iron'],.009)
    tube(c,'Chest lid seam',[(x-.27,y,.607),(x+.27,y,.607)],.008,p['wood'],6)
    upgrade_chest(c,x,y,p)


def workshop(c,p,spec):
    # Wide round stone enclosure, with a genuine gap in the south entrance.
    rows=[]
    for j in range(12):
        y=-1.18+j*.215
        width=3.43*math.sqrt(max(.05,1-(y/1.37)**2))
        rows.append((y,0,width))
    deck(c,rows,p)
    for level in range(2):
        for i in range(26):
            a=math.tau*(i+.48*level)/26
            if math.sin(a)<-.88: continue
            x=1.70*math.cos(a);y=1.25*math.sin(a)
            stone=rock(c,'Irregular mossy fieldstone',(x,y,.19+level*.25+.025*math.sin(i*2)),(.205,.16,.15),p,i+level*37)
            stone.rotation_euler.z=a+math.pi/2+.09*math.sin(i*7)
    # A low hood covers the rear firebrick only; the coals remain exposed.
    c.box('Masonry forge plinth',(-1.12,.37,.36),(.72,.90,.43),p['stone'],.065)
    c.box('Recessed black forge hearth',(-1.12,.32,.59),(.51,.60,.06),p['coal'],.024)
    for x in (-1.43,-.81):c.box('Forge side curb',(x,.37,.65),(.12,.90,.22),p['stone'],.032)
    c.box('Forge front curb',(-1.12,-.06,.65),(.70,.12,.20),p['stone'],.025)
    for i in range(19):
        x=-1.31+(i%4)*.115+.024*math.sin(i*2);y=.12+(i//4)*.095
        c.ell('Individual charcoal lump',(x,y,.65),(.065,.055,.04),p['coal'])
        if i%3==0:c.ell('Small recessed living ember',(x+.025,y-.02,.677),(.031,.024,.012),p['ember'])
    annulus(c,'Open soot chimney',(-1.12,.73,.98),.17,.105,.50,p['dark'],steps=20)
    for x in (-1.52,-.72):post(c,x,.82,p,1.26)
    for i in range(10):
        x=-1.57+i*.10
        c.box('Corrugated rusty forge hood',(x,.99,1.29+.018*math.sin(i*math.pi/2)),(.104,.57,.045),p['rust'],.018)
        tube(c,'Rolled raised hood rib',[(x,.71,1.31),(x,1.0,1.36),(x,1.27,1.32)],.017,p['iron'],8)
    # Prominent broad horn and heel, true forged anvil profile.
    c.cylinder('Anvil oak stump',(.02,-.28,.32),.33,.42,p['cut'],20)
    endgrain(c,.02,-.28,.537,.31,p)
    annulus(c,'Stump binding iron hoop',(.02,-.28,.44),.338,.31,.055,p['rust'],steps=32)
    c.box('Anvil foot',(.02,-.28,.57),(.45,.34,.12),p['dark'],.03)
    c.box('Anvil waist',(.02,-.28,.70),(.28,.25,.24),p['iron'],.04)
    outline=[(-.43,-.17),(.20,-.17),(.30,-.09),(.63,0),(.30,.095),(.20,.17),(-.43,.17)]
    plate(c,'Recognizable anvil horn and heel',(.02,-.28,.87),outline,.13,p['iron'],.025)
    c.box('Square hardy socket',(-.29,-.28,.942),(.075,.075,.008),p['dark'],.005)
    # Grindstone edge, axle and timber trestle visible from above.
    for x in (-1.47,-1.04):c.box('Grinding wheel trestle',(x,-.74,.33),(.12,.56,.40),p['wood'],.02)
    wheel=c.cylinder('Upright sharpening stone',(-1.25,-.74,.55),.29,.13,p['stone'],40)
    wheel.rotation_euler.y=math.pi/2
    tube(c,'Grinding axle',[(-1.59,-.74,.55),(-.92,-.74,.55),(-.92,-.87,.55)],.035,p['iron'],10)
    # Tools laid against a shallow rear rack are legible in the strict overhead view.
    c.box('Tool bench top',(.54,.71,.58),(1.54,.49,.12),p['cut'],.025)
    c.box('Tool wall rail',(.54,1.03,.82),(1.64,.13,.46),p['wood'],.02)
    hammer(c,-.01,.48,.69,p,-.15);tongs(c,.37,.67,.69,p)
    hammer(c,.74,.48,.69,p,.19)
    crate(c,1.15,.64,.66,p,.62)
    # Dark horizontal slats and pegs give the back rack a real frame.
    for y in (.94,1.02):beam(c,'Tool wall cross rail',(-.26,y),(1.37,y),.08,.95,p['cut'])
    for x in (.1,.55,1.03):c.cylinder('Tool hanging peg',(x,.93,1.01),.022,.09,p['brass'],12)
    # Water trough with raised wooden rim and inset dark water, not a painted decal.
    c.box('Quenching trough body',(1.14,-.54,.31),(.57,.72,.38),p['wood'],.06)
    c.box('Visible dark quenching water',(1.14,-.54,.51),(.42,.55,.018),p['water'],.03)
    for x in (.89,1.39):c.box('Trough raised side',(x,-.54,.55),(.07,.75,.16),p['cut'],.015)
    for y in (-.89,-.19):c.box('Trough end rim',(1.14,y,.55),(.58,.07,.16),p['cut'],.015)
    for y in (-.78,-.30):c.box('Trough iron binding',(1.14,y,.64),(.59,.035,.02),p['rust'],.006)
    sack(c,-.53,.08,.17,p,True);barrel(c,1.36,.17,.15,.19,p)
    crate(c,.59,-.96,.16,p,.72);rope(c,-.47,-.94,.18,.16,p)
    lantern(c,.90,.77,.79,p)
    hammer(c,.51,-.15,.20,p,.75)
    scraps(c,[(-.58,-.60),(-.48,-.67),(.51,-.52),(.62,-.55),(.80,-1.12)],p)


def yard(c,p,spec):
    rows=[]
    for j in range(12):
        y=-1.13+j*.215
        left=-1.70+max(0,-y-.10)*.65
        right=1.67-max(0,y+.15)*1.28
        rows.append((y,(left+right)/2,right-left))
    deck(c,rows,p)
    # Dominant diagonal sail leaves both the plan and the timber fan uncovered.
    pts=[(-1.66,-.20,1.20),(-1.49,1.28,1.46),(.52,.76,1.24)]
    for x,y,z in pts:post(c,x,y,p,z)
    canopy(c,pts,p)
    # Broad sewn fold seams and a patch, in the same cloth rather than a flat triangle.
    tube(c,'Main sail seam',[(-1.50,1.24,1.49),(-1.15,.70,1.17),(-1.01,.31,1.10),(-1.61,-.16,1.22)],.012,p['rope'],8)
    plate(c,'Stitched sail patch',(-1.36,.89,1.32),[(-.10,-.08),(.09,-.07),(.10,.08),(-.10,.09)],.012,p['cloth'],.008)
    for a,b in [((-1.62,-.30),(-1.34,-1.18)),((.65,-1.18),(1.70,-.60))]:
        beam(c,'Low perimeter timber',a,b,.11,.23,p['wood'])
    # Open work table, cream plan with drawn construction lines, never lettering.
    for x in (-.85,.24):
        for y in (-.95,-.36):post(c,x,y,p,.47)
    c.box('Wide drafting table',(-.30,-.65,.56),(1.40,.87,.13),p['cut'],.025)
    plate(c,'Unlettered building plan',(-.32,-.65,.635),[(-.54,-.31),(.52,-.29),(.55,.26),(-.51,.30)],.012,p['paper'],.004)
    for a,b in [((-.70,-.80),(.05,-.80)),((-.66,-.80),(-.66,-.60)),((.0,-.80),(.0,-.60)),((-.73,-.61),(-.33,-.41)),((-.33,-.41),(.08,-.61)),((-.33,-.41),(-.33,-.80)),((-.68,-.60),(.03,-.60))]:
        tube(c,'Fine ink architectural plan rule',[(a[0],a[1],.649),(b[0],b[1],.649)],.005,p['dark'],6)
    for x in (-.58,-.45,-.20,-.08):
        tube(c,'Plan dimension tick',[(x,-.84,.65),(x,-.78,.65)],.003,p['dark'],6)
    for y in (-.56,-.49):tube(c,'Plan small side elevation',[(.14,y,.65),(.14,y+.035,.65),(.21,y+.035,.65)],.003,p['dark'],6)
    roll=c.cylinder('Rolled spare parchment',(-.85,-.64,.69),.055,.63,p['paper'],20);roll.rotation_euler.x=math.pi/2
    c.box('Plan paperweight',(.12,-.89,.68),(.12,.11,.06),p['iron'],.01)
    # Loose fanned beam ends have enough width to survive the 128 px display.
    for i in range(6):
        a=-.70+i*.16;x=1.02+i*.045;y=-.35+i*.065
        ob=c.box('Fanned construction timber',(x,y,.26+i*.06),(.18,1.54,.18),p['cut'] if i%2 else p['wood'],.027)
        ob.rotation_euler.z=a
        # Diagonal saw cuts expose growth rings on the upper end of each beam.
        xx=x-math.sin(a)*.68;yy=y+math.cos(a)*.68
        c.cylinder('Angled timber end grain',(xx,yy,.37+i*.06),.076,.016,p['cut'],16)
        endgrain(c,xx,yy,.383+i*.06,.073,p)
    for x,y in [(1.68,-.91),(1.71,.10),(.90,1.06)]:post(c,x,y,p,.52)
    # Small cantilever lifting crane with a readable spool and hooked chain.
    post(c,.85,.67,p,1.19)
    beam(c,'Crane heavy cantilever',(.61,.64),(1.80,.64),.16,1.22,p['cut'])
    tube(c,'Crane diagonal brace',[(.85,.67,.42),(1.66,.64,1.19)],.055,p['wood'],10)
    for x in (.91,1.28,1.72):c.box('Forged crane strap',(x,.64,1.28),(.07,.19,.045),p['dark'],.01)
    spool=c.cylinder('Crane rope drum',(1.20,.39,.54),.18,.32,p['wood'],24);spool.rotation_euler.y=math.pi/2
    for i in range(7):
        ring=annulus(c,'Wound hemp rope',(0,0,0),.19,.17,.026,p['paper'],steps=24)
        ring.rotation_euler.y=math.pi/2;ring.location=(1.07+i*.043,.39,.54)
    tube(c,'Hanging crane chain',[(1.74,.64,1.22),(1.74,.64,.42),(1.69,.59,.34),(1.61,.60,.38)],.021,p['iron'],10)
    tube(c,'Visible forged lifting hook',[(1.75,.50,.47),(1.80,.35,.43),(1.74,.28,.43),(1.65,.29,.43),(1.63,.37,.45)],.035,p['iron'],12)
    barrel(c,-1.15,.05,.15,.21,p);crate(c,-.63,.17,.16,p,.85)
    sack(c,-.14,.07,.16,p);rope(c,.47,-.14,.19,.19,p)
    lantern(c,.48,-1.01,.24,p)
    hammer(c,-.92,-1.01,.20,p,.8)
    scraps(c,[(.68,-.84),(.80,-.94),(.74,-1.05),(-.43,-1.17),(-.56,-1.10)],p)


def armory(c,p,spec):
    # U-shaped structural deck and side galleries with a transparent front gap.
    deck(c,[(.31+j*.215,0,3.65) for j in range(5)],p)
    deck(c,[(-.55+j*.215,0,1.68) for j in range(4)],p)
    for side in (-1,1):deck(c,[(-1.17+j*.215,side*1.32,.98) for j in range(7)],p)
    for x in (-1.78,1.78):
        c.box('Long side wall sill',(x,-.05,.42),(.16,2.62,.61),p['wood'],.025)
        for y in (-1.24,.10,1.22):post(c,x,y,p,1.18)
    c.box('Rear wall header',(0,1.23,.77),(3.62,.15,.40),p['wood'],.03)
    # Narrow rear awning; open front exposes helmet crowns and shoulders.
    for j in range(14):
        x=-1.72+j*.255
        ob=c.box('Separate overlapping shelter roof board',(x,1.12,1.28+.02*math.sin(j*4)),(.27,.46,.09),p['cut'] if j%4==0 else p['wood'],.028)
        ob.rotation_euler.x=.14
        for yy in (.96,1.25):c.cylinder('Roof nail',(x,yy,1.35),.016,.018,p['iron'],8)
    canopy(c,[(.60,1.36,1.43),(.52,.85,1.36),(1.82,1.32,1.45)],p)
    for idx,x in enumerate((-.62,0,.62)):
        post(c,x,.56,p,.65)
        c.box('Armor stand crossbar',(x,.56,.72),(.48,.12,.09),p['cut'],.018)
        # Matte breastplate shoulder shape below an unmistakable helmet crown.
        plate(c,'Armor shoulder silhouette',(x,.51,.78),[(-.24,-.12),(-.20,.12),(-.10,.17),(.10,.17),(.20,.12),(.24,-.12),(.10,-.18),(-.10,-.18)],.09,p['iron'],.022)
        helmet=c.ell('Distinct forged helmet crown',(x,.57,.91),(.165 if idx!=1 else .20,.18 if idx!=2 else .22,.15 if idx!=2 else .21),p['iron'] if idx!=1 else p['rust'])
        tube(c,'Helmet raised median rib',[(x,.39,.92),(x,.44,1.025),(x,.57,1.065),(x,.70,1.025),(x,.75,.92)],.018,p['iron'],8)
        plate(c,'Helmet projecting brow',(x,.38,.91),[(-.16,0),(.16,0),(.14,-.045),(-.14,-.045)],.035,p['dark'],.007)
        if idx==1:annulus(c,'Wide kettle helmet brim',(x,.57,.87),.235,.16,.032,p['iron'],steps=28)
        if idx==2:beam(c,'Helmet nasal guard',(x,.45),(x,.28),.043,.91,p['iron'])
        crown(c,'Raised breastplate central keel',(x,.27,.70),.34,.33,.14,p['iron'])
        for side in (-1,1):c.ell('Segmented armor shoulder',(x+side*.20,.40,.79),(.095,.14,.07),p['iron'])
        for yy in (.17,.26):beam(c,'Armor leather fastening',(x-.18,yy),(x+.18,yy),.027,.86,p['wood'])
    for side in (-1,1):
        chest(c,side*1.29,-.86,p)
        c.box('Side open equipment shelf',(side*1.30,-.08,.52),(.66,.66,.10),p['cut'],.022)
        for x in (side*1.30-.32,side*1.30+.32):c.box('Shelf raised rail',(x,-.08,.61),(.045,.71,.12),p['wood'],.008)
    # A shield and short blades on one side, folded armor straps on the other.
    plate(c,'Kite shield',(-1.30,-.06,.61),[(-.22,.20),(.22,.20),(.22,-.06),(0,-.30),(-.22,-.06)],.09,p['iron'],.03)
    tube(c,'Shield raised central ridge',[(-1.30,.11,.72),(-1.30,-.23,.72)],.024,p['dark'],8)
    for i in range(2):
        c.box('Folded gambeson',(1.24+i*.15,-.10+i*.12,.62+i*.06),(.31,.42,.10),p['cloth'],.035)
    for side in (-1,1):
        for i in range(2):
            x=side*(1.22+i*.20)
            beam(c,'Racked short sword',(x,.38),(x,.79),.046,.68,p['iron'])
            beam(c,'Sword crossguard',(x-.08,.41),(x+.08,.41),.035,.71,p['dark'])
        beam(c,'Weapon rack crossbar',(side*1.02,.30),(side*1.61,.30),.08,.57,p['wood'])
    # Shelf inventory and small wall-side supplies keep the center entrance open.
    annulus(c,'Shield raised edge',(-1.30,-.06,.72),.15,.13,.025,p['brass'],steps=24)
    for i in range(2):
        c.cylinder('Shelf tin pot',(1.19+i*.21,.13,.70),.085,.13,p['iron'],20)
        annulus(c,'Pot rolled lip',(1.19+i*.21,.13,.77),.086,.067,.02,p['brass'],steps=20)
    rope(c,-1.30,-.40,.59,.15,p)
    lantern(c,1.47,.70,.76,p)
    sack(c,-1.55,.72,.20,p)
    scraps(c,[(-1.18,-1.19),(-1.08,-1.12),(1.56,-.42),(1.49,-.51)],p)


def build(c,spec):
    pivot=root(c);p=palette(c,spec)
    {'workshop':workshop,'yard':yard,'armory':armory}[spec['model']['building']](c,p,spec)
    # Authored 4 x 3-cell occupancy, leaving the centered 4 x 4 canvas intact.
    for ob in c.scene.objects:
        if ob.type=='MESH':
            ob.location.y*=1.13
            ob.scale.y*=1.13
    return finish(c,pivot)
