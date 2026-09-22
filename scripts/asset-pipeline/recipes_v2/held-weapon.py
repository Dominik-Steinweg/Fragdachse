"""North-facing weapons with centered grip/barrel axes and reference-derived palettes."""
from rigs_v2 import model, control, attach
from weapon_parts_v2 import WeaponParts


def pistol(w):
    x,L=w.x,w.length
    w.plate('Polymer dust cover',[(x-1.25,-.6),(x+1.25,-.6),(x+1.45,2),(x+1.3,L-1),(x-1.3,L-1)],w.body,z=1.25,h=1.3,bevel=.28)
    w.box('Bevelled steel slide',x,L*.48,2.6,L-.35,w.trim,z=2.25,h=1.55,bevel=.34)
    w.box('Slide flat crown',x,L*.49,1.7,L-.9,w.edge,z=3.05,h=.14,bevel=.12)
    w.barrel('Barrel inside slide',x,L-2,L,.64,w.edge,z=2.2,hollow=True)
    w.box('Ejection port',x+.37,L*.57,1.05,1.9,w.black,z=3.14,h=.08,bevel=.15)
    w.box('Chamber visible in port',x+.43,L*.61,.75,1.28,w.edge,z=3.19,h=.11,bevel=.09)
    w.box('Chamber seam',x+.43,L*.55,.77,.08,w.dark,z=3.26,h=.03,bevel=.01)
    for t in (1,1.45,1.9,2.35,L-2,L-1.55):
        for side in (-1,1): w.box('Slide grasping serration',x+side*1.06,t,.27,.12,w.black,z=2.98,h=.12,bevel=.03)
    w.box('Rear sight dovetail',x,.62,1.95,.52,w.dark,z=3.22,h=.35,bevel=.08)
    w.box('Rear sight notch',x,.62,.37,.55,w.black,z=3.4,h=.06,bevel=.01)
    w.box('Front sight blade',x,L-.65,.34,.54,w.dark,z=3.22,h=.34,bevel=.06)
    w.disk('Front sight insert',x,L-.65,.10,w.edge,z=3.405,h=.015)
    w.box('Slide lock lever',x+1.47,2.5,.4,1.25,w.edge,z=1.8,h=.3,bevel=.1)
    w.screw(x-1.18,.25,1.9,.13)


def rifle(w):
    x,L=w.x,w.length
    w.round_body('Walnut buttstock shoulder',x,[(-1.45,2.9),(-.8,3.2),(1.8,2.4),(3,1.7)],w.wood,z=1.8,height=1.8)
    w.box('Butt pad',x,-1.28,2.95,.4,w.dark,z=1.8,h=1.65,bevel=.18)
    w.box('Stamped receiver',x,5.8,2.85,8.4,w.steel,z=1.95,h=1.7,bevel=.25)
    w.round_body('Ribbed receiver dust cover',x,[(1.9,2.3),(2.2,2.5),(9,2.3),(9.5,1.85)],w.steel,z=2.65,height=1.3)
    for dx in (-.7,.7): w.path('Stamped cover stiffening ridge',[(x+dx,2.7,3.16),(x+dx,8.4,3.16)],.07,w.edge)
    w.box('Ejection side recess',x+1.25,6.7,.3,2.5,w.black,z=2.85,h=.2,bevel=.05)
    w.path('Bolt handle',[(x+1.1,6.7,2.8),(x+1.9,6.7,2.8),(x+2.05,6.3,2.8)],.18,w.edge)
    w.round_body('Walnut lower handguard',x,[(9.2,2.3),(9.6,3.1),(13.8,2.65),(14.1,1.7)],w.wood,z=2.0,height=1.8)
    w.round_body('Walnut upper gas cover',x,[(10.2,1.1),(10.5,1.8),(13.5,1.55),(13.9,1)],w.wood,z=2.85,height=1.15)
    for t in (9.6,13.85): w.box('Handguard retaining band',x,t,2.75,.4,w.steel,z=2.15,h=1.65,bevel=.15)
    w.barrel('Exposed rifle barrel',x,13.6,L,.41,w.steel,z=2.15,hollow=True)
    w.barrel('Upper gas piston tube',x,13.3,16.5,.39,w.edge,z=2.8)
    w.box('Gas block',x,16.5,1.4,.65,w.steel,z=2.6,h=1.3,bevel=.13)
    w.box('Front sight block',x,L-1.1,1.15,.65,w.steel,z=2.65,h=1.4,bevel=.13)
    w.box('Protected sight post',x,L-1.1,.24,.38,w.edge,z=3.43,h=.2,bevel=.04)
    w.barrel('Muzzle brake collar',x,L-1,L,.55,w.edge,z=2.15,hollow=True)
    w.box('Rear ladder sight',x,9.3,1.1,1.4,w.dark,z=3.2,h=.38,bevel=.06)
    w.box('Sight notch',x,8.8,.68,.2,w.edge,z=3.43,h=.1,bevel=.02)
    w.plate('Curved steel magazine',[(x-.8,3),(x+1,3),(x+1.6,1),(x+1.45,-1),(x+.7,-1.65),(x-.4,.2)],w.steel,z=.4,h=1.1)
    for t in (3.4,8.1):
        for dx in (-1.3,1.3): w.screw(x+dx,t,2.7,.13)


def shotgun(w):
    x,L=w.x,w.length
    w.round_body('Walnut stock shoulder',x,[(-1.5,3.1),(-1,3.2),(2,2.05),(3.2,1.6)],w.wood,z=1.8,height=1.7)
    w.box('Rubber recoil pad',x,-1.35,2.9,.34,w.dark,z=1.8,h=1.6,bevel=.15)
    w.box('Rounded pump receiver',x,5.4,3.0,6.5,w.body,z=2,h=1.8,bevel=.42)
    w.box('Ejection port',x+.72,6.0,.85,2.3,w.black,z=2.85,h=.10,bevel=.16)
    w.box('Bolt face',x+.74,6.4,.65,1.25,w.edge,z=2.92,h=.08,bevel=.12)
    w.barrel('Shotgun barrel',x,7.6,L,.64,w.steel,z=2.3,hollow=True)
    w.barrel('Lower magazine tube',x,7,14.9,.63,w.dark,z=1.0)
    w.round_body('Ribbed walnut pump',x,[(8.1,2),(8.4,3.25),(12,3.05),(12.35,1.65)],w.wood,z=1.7,height=2.2)
    for t in (8.7,9.3,9.9,10.5,11.1,11.7):
        for dx in (-1.30,1.30): w.box('Pump grip groove',x+dx,t,.22,.15,w.dark,z=2.24,h=.5,bevel=.05)
    for t in (12.8,14.2,15.6,16.6): w.box('Ventilated rib support',x,t,.3,.28,w.steel,z=3.03,h=.28,bevel=.035)
    w.box('Raised sighting rib',x,12.7,.32,8.8,w.edge,z=3.2,h=.10,bevel=.025)
    w.disk('Brass front bead',x,L-.4,.15,w.brass,z=3.26,h=.14)
    for t in (3.6,7.5): w.screw(x-1.32,t,2.62,.13)


def smg(w):
    x,L=w.x,w.length
    # Broad rounded rear stock, narrowed waist and an integrated forward optic.
    # The magazine ends underneath the sight bridge; its feed mechanism is covered.
    w.round_body('P90 sculpted bullpup chassis',x,[(-1.4,3.5),(-1,4.25),(1.2,4.45),(4.8,3.65),(6.3,3.7),(7.8,4.1),(9.5,3.25),(10,2.0)],w.body,z=1.55,height=2.6)
    w.box('P90 contoured recoil pad',x,-1.25,3.7,.42,w.dark,z=1.55,h=2.15,bevel=.30)
    for side in (-1,1):
        w.plate('Moulded upper receiver shoulder',[(x+side*1.25,-.7),(x+side*1.94,-.45),(x+side*1.92,2.6),(x+side*1.65,5.6),(x+side*1.23,6.3)],w.trim,z=2.25,h=.55,bevel=.2)
        w.path('Recessed stock assembly seam',[(x+side*1.7,-.6,2.4),(x+side*1.7,2,2.5),(x+side*1.45,4.8,2.5)],.045,w.dark)
        w.screw(x+side*1.66,.2,2.58,.12)
    smoked=w.material('Smoked amber magazine polymer',(.115,.065,.027),.06,kind='composite')
    cartridge=w.material('Muted brass behind smoked polymer',(.22,.14,.057),.2,kind='brass')
    w.box('Low translucent magazine shell',x,2.5,2.55,6.3,smoked,z=2.78,h=.44,bevel=.35)
    w.box('Magazine cartridge window',x,2.6,1.75,4.7,smoked,z=3.025,h=.07,bevel=.2)
    for i in range(8):
        ob=w.box('Subdued transverse cartridge',x,.75+i*.5,1.55,.21,cartridge,z=3.07,h=.055,bevel=.08)
        ob.rotation_euler.z=.10
    for dx in (-1.02,1.02): w.box('Magazine longitudinal rib',x+dx,2.5,.14,5.4,smoked,z=3.04,h=.12,bevel=.05)
    w.box('Magazine rounded feed cover',x,5.2,2.5,1.55,smoked,z=2.95,h=.5,bevel=.5)
    w.box('Magazine rear release catch',x,-.25,1.15,.45,w.dark,z=3.08,h=.2,bevel=.10)
    w.barrel('P90 short barrel',x,8.7,L,.43,w.steel,z=2.0,hollow=True)
    w.barrel('P90 flash suppressor',x,L-.9,L,.55,w.steel,z=2.0,hollow=True)
    for side in (-1,1):
        w.box('Integral optic bridge pillar',x+side*1.12,7.9,.46,3.75,w.steel,z=2.9,h=1.5,bevel=.22)
        w.box('Bridge side opening',x+side*.86,8,.35,2.4,w.black,z=3.62,h=.055,bevel=.12)
        w.box('Ambidextrous charging handle',x+side*1.98,8.35,.45,1.45,w.dark,z=2.0,h=.5,bevel=.18)
        w.screw(x+side*1.12,6.7,3.64,.13)
    w.round_body('P90 integrated longitudinal optic',x,[(6.5,.85),(6.8,1.45),(9.7,1.45),(10.05,.92)],w.trim,z=3.65,height=1.15)
    w.box('Optic sight crown',x,8.2,.73,2.9,w.dark,z=4.25,h=.12,bevel=.15)
    w.box('Rear backup sight notch',x,6.9,1.12,.35,w.steel,z=4.35,h=.18,bevel=.07)
    w.box('Front backup sight blade',x,9.55,.20,.40,w.edge,z=4.37,h=.2,bevel=.04)


def sniper(w):
    x,L=w.x,w.length
    w.round_body('AWP green chassis',x,[(-1.3,3.9),(-.8,4.2),(2,3.2),(4,3),(10,3.8),(15,3.0),(16.2,1.65)],w.olive,z=1.55,height=1.8)
    w.box('Stock rubber pad',x,-1.17,3.7,.35,w.dark,z=1.5,h=1.55,bevel=.15)
    w.round_body('Raised cheek piece',x,[(-.6,2.4),(-.1,2.7),(2.2,2.5),(2.6,1.5)],w.olive,z=2.55,height=.65)
    w.barrel('Bolt action receiver',x,3.7,12.3,.77,w.steel,z=2.35)
    w.barrel('Heavy match barrel',x,11.5,L,.49,w.steel,z=2.25,hollow=True)
    w.barrel('Threaded muzzle cap',x,L-.8,L,.61,w.edge,z=2.25,hollow=True)
    w.rail(x,7.7,7.7,z=3,width=1.55); w.scope(x,8.1,8.8,z=4.3)
    w.path('Bolt action handle',[(x+.5,4.7,2.5),(x+1.65,4.4,2.5),(x+2.2,3.7,2.1)],.18,w.edge)
    w.ell('Bolt handle knob',x+2.2,3.7,.8,.9,w.dark,z=2.1,h=.8)
    for side in (-1,1):
        w.path('Folded bipod leg',[(x+side*1.15,13.5,1.4),(x+side*1.9,18.6,1.4)],.19,w.steel)
        w.box('Bipod rubber foot',x+side*1.9,18.6,.55,.9,w.dark,z=1.4,h=.6,bevel=.16)
        w.screw(x+side*1.3,13.3,2.4,.16)


def machine_gun(w):
    x,L=w.x,w.length
    w.round_body('Composite buttstock',x,[(-1.4,3.3),(-1,3.5),(2.2,2.2),(3,1.8)],w.olive,z=1.7,height=1.9)
    w.box('Heavy stamped receiver',x,6.1,3.8,9.4,w.body,z=1.85,h=2,bevel=.3)
    w.box('Hinged ammunition feed cover',x,6.6,3.4,6.4,w.olive,z=3,h=.8,bevel=.3)
    w.rail(x,6.8,4.3,z=3.52,width=1.4)
    w.box('Side ammunition box',x+3.05,5.4,3.45,5,w.olive,z=1.3,h=2.4,bevel=.5)
    w.box('Ammunition box lid',x+3.05,5.4,3.6,5.1,w.dark,z=2.5,h=.35,bevel=.3)
    for t in (3.8,5,6.2): w.box('Ammunition box pressed rib',x+3.5,t,1.6,.35,w.olive,z=2.72,h=.14,bevel=.07)
    for i in range(5):
        dx=1.3+i*.5
        w.barrel('Belted brass cartridge',x+dx,6.6,8.35,.16,w.brass,z=3.2-i*.07,front=.07)
        w.box('Dark disintegrating belt link',x+dx,7.1,.44,.35,w.dark,z=3.38-i*.07,h=.1,bevel=.04)
    w.round_body('Vented fore-end',x,[(10,2.1),(10.4,3.1),(15.5,2.8),(16,1.4)],w.olive,z=1.85,height=2.1)
    for t in (11,12,13,14,15):
        for dx in (-.7,.7): w.vent(x+dx,t,.65,z=2.87)
    w.barrel('Machine gun barrel',x,14,L,.5,w.steel,z=2.15,hollow=True)
    w.barrel('Gas regulator',x,14,18.1,.34,w.edge,z=1.25)
    w.barrel('Slotted flash hider',x,L-1.4,L,.66,w.steel,z=2.15,hollow=True)
    for dx in (-.3,.3): w.box('Flash hider port',x+dx,L-.7,.18,.8,w.black,z=2.73,h=.07,bevel=.04)
    w.box('Front sight',x,18.3,1.35,.65,w.steel,z=2.9,h=.65,bevel=.12)
    for side in (-1,1): w.path('Folded steel bipod',[(x+side*1.0,14.8,1.1),(x+side*2.15,18.1,1.1)],.19,w.steel)
    w.path('Folding carry handle',[(x-1.55,7.8,2.5),(x-2.35,8.6,2.8),(x-2.35,10.6,2.8),(x-1.4,11,2.5)],.22,w.dark)


def crossbow(w):
    x,L=w.x,w.length; bow=L-3.1
    w.round_body('Sculpted composite crossbow stock',x,[(-1.4,2.9),(-.8,3.3),(2,2.0),(4,2.6),(8.4,2.1)],w.body,z=1.45,height=1.8)
    w.box('Extruded bolt track',x,L*.46,1.7,L-.25,w.trim,z=2.45,h=.7,bevel=.17)
    w.box('Central arrow channel',x,L*.5,.38,L-.65,w.black,z=2.85,h=.08,bevel=.04)
    w.plate('Machined bow riser',[(x-3.2,bow-.7),(x-3.3,bow+.3),(x-1.2,bow+1.1),(x+1.2,bow+1.1),(x+3.3,bow+.3),(x+3.2,bow-.7),(x+1,bow),(x-1,bow)],w.edge,z=2.3,h=.7)
    for side in (-1,1):
        for offset in (-.26,.26): w.path('Split laminated bow limb',[(x+side*2.6,bow,2.25+offset),(x+side*4.4,bow+.9,2.15+offset),(x+side*6,bow-.4,2+offset)],.21,w.dark)
        w.disk('Compound cam wheel',x+side*6,bow-.4,.74,w.steel,z=2.1,h=.3)
        w.disk('Cam inner ring',x+side*6,bow-.4,.49,w.black,z=2.29,h=.05)
        w.screw(x+side*6,bow-.4,2.38,.16)
        w.path('Tensioned bowstring',[(x+side*6,bow-.8,2.6),(x,3.1,2.91)],.075,w.edge)
        w.path('Return cable',[(x+side*6,bow+.1,1.8),(x-side*2.5,bow-.8,1.8)],.065,w.dark)
        w.screw(x+side*2.55,bow+.05,2.74,.19)
    w.barrel('Loaded carbon bolt',x,2.2,L,.105,w.brass,z=2.99,front=.02)
    for side in (-1,1): w.plate('Bolt fletching',[(x,2),(x+side*.43,2.4),(x+side*.40,3.6),(x,3.35)],w.edge,z=3.02,h=.07,bevel=.015)
    w.scope(x,4.5,3.5,z=3.65)


def rocket(w):
    x,L=w.x,w.length
    w.barrel('Launcher fibreglass tube',x,-.8,L,1.68,w.olive,z=2.25,hollow=True)
    w.barrel('Rear expansion sleeve',x,-1.35,2.3,2.06,w.body,z=2.25,front=1.7)
    w.barrel('Forward reinforcement sleeve',x,L-3.7,L,1.83,w.olive,z=2.25,hollow=True)
    w.barrel('Bronze launcher muzzle ferrule',x,L-.6,L,1.88,w.brass,z=2.25,hollow=True)
    for t in (2.6,9.8,L-1.2):
        w.barrel('Steel clamp band',x,t-.26,t+.26,1.86,w.edge,z=2.25)
        w.screw(x+1.1,t,3.82,.16)
    w.round_body('Textured shoulder rest',x,[(1.3,3.5),(2,4.5),(6.5,4.2),(7.3,3.1)],w.dark,z=1.0,height=1.5)
    w.box('Side sight mounting bracket',x+2.0,9.5,1.0,6.3,w.steel,z=2.3,h=1.1,bevel=.16)
    w.scope(x+2.25,10.2,4.4,z=3.0)
    w.box('Launcher top technical plate',x,6.5,1.45,3.3,w.dark,z=3.96,h=.1,bevel=.12)
    for t in (5.7,6.15,6.6): w.box('Stamped instruction line',x,t,.95,.11,w.edge,z=4.03,h=.025,bevel=.015)
    w.box('Arming switch cover',x,7.7,.8,.6,w.brass,z=4.09,h=.25,bevel=.13)
    w.path('Sling attachment',[(x-1.5,4.5,2.5),(x-2.25,4.5,2.5),(x-2.25,5.4,2.5),(x-1.5,5.4,2.5)],.13,w.dark)


def multi_launcher(w,hydra):
    x,L=w.x,w.length
    w.round_body('Rounded breech assembly',x,[(-1.1,2.6),(-.5,3.5),(2.6,6.3),(4.6,6.5),(6,5.3)],w.body,z=1.8,height=2.5)
    if hydra:
        for dx in (-2.2,0,2.2):
            w.barrel('Hydra discharge jacket',x+dx,4,L-.15,.79,w.steel,z=2.25,hollow=True)
            w.barrel('Copper induction winding',x+dx,6.3,9,.87,w.brass,z=2.25)
            for t in (6.6,7.2,7.8,8.4): w.barrel('Winding groove',x+dx,t,t+.13,.89,w.dark,z=2.25)
            w.barrel('Ceramic emitter collar',x+dx,L-2.6,L-.8,.9,w.accent,z=2.25,hollow=True)
            w.barrel('Emitter rim',x+dx,L-.85,L,.87,w.edge,z=2.25,hollow=True)
            w.box('Charge viewing slit',x+dx,5.25,.48,1.25,w.energy,z=3.02,h=.12,bevel=.11)
        w.box('Rear manifold bridge',x,3.6,6.2,.85,w.edge,z=2.4,h=1.8,bevel=.22)
        w.rail(x,2.1,2.1,z=3.1,width=1.3)
    else:
        w.box('Compact six rocket pod casing',x,7,6.65,7.9,w.body,z=2.0,h=3.65,bevel=.52)
        for dx in (-2.1,0,2.1):
            for z in (1.1,3):
                w.barrel('Separate rocket launch tube',x+dx,4.1,L,.88,w.dark,z=z,hollow=True)
                w.barrel('Exposed launch sleeve',x+dx,L-1.5,L,.94,w.edge,z=z,hollow=True)
            w.box('Top pod panel',x+dx,7,.95,4,w.trim,z=3.84,h=.25,bevel=.18)
            w.box('Pod firing indicator',x+dx,5.4,.38,.7,w.accent,z=4.01,h=.1,bevel=.1)
            w.barrel('Orange forward tube identifier',x+dx,L-1.55,L-.95,.95,w.accent,z=3)
        for side in (-1,1):
            w.box('Pod side latch',x+side*3.35,6.1,.65,2.2,w.accent,z=2.6,h=.6,bevel=.17)
            w.screw(x+side*2.8,3.75,3.85,.15)
    w.box('Rear safety lever',x,1.2,1.7,.5,w.brass,z=3.1,h=.24,bevel=.1)


def flame(w):
    x,L=w.x,w.length
    w.box('Fuel regulator body',x,3.9,3.5,6.1,w.body,z=1.7,h=2.2,bevel=.55)
    for side in (-1,1): w.tank('Fuel and propellant cylinder',x+side*2,1,7.5,.95,w.brass if side==1 else w.accent,z=1.8)
    w.barrel('Insulated flame lance',x,6.7,L-1.9,.67,w.steel,z=2.2)
    w.barrel('Perforated flame nozzle shield',x,L-4,L,1.07,w.heated,z=2.2,hollow=True)
    for t in (L-3.4,L-2.6,L-1.8):
        for dx in (-.5,.5): w.vent(x+dx,t,.43,z=3.15)
    w.barrel('Heat darkened nozzle rim',x,L-.5,L,1.11,w.brass,z=2.2,hollow=True)
    w.path('Pilot fuel pipe',[(x+1,6.4,1.6),(x+1.4,L-3,1.7),(x+.9,L-.4,1.9)],.14,w.brass)
    w.path('Reinforced fuel hose',[(2.2,1.2,1.4),(3.3,2.6,1.5),(3.2,5.6,1.5),(x+1.1,9,1.7)],.28,w.dark)
    w.disk('Pressure valve body',0,4.3,.82,w.steel,z=3,h=.35); w.gauge(0,4.3,3.24,.56)
    w.disk('Regulator knob',1.1,2.3,.39,w.accent,z=3.05,h=.3); w.screw(-1.05,2.1,2.9,.14)


def blower(w):
    x,L=w.x,w.length
    w.ell('Snail shaped fan housing',0,3.8,6.3,6.9,w.accent,z=1.6,h=3.2)
    w.disk('Fan intake rim',0,3.9,2.3,w.steel,z=2.91,h=.36)
    w.disk('Deep fan intake',0,3.9,1.96,w.black,z=3.14,h=.16)
    for i in range(-3,4):
        dx=i*.48; length=2*(1.75**2-dx**2)**.5
        w.box('Fan protective intake grille',dx,3.9,.19,length,w.edge,z=3.27,h=.19,bevel=.05)
    w.disk('Fan centre bearing',0,3.9,.43,w.dark,z=3.43,h=.2)
    for dx,t in ((-1.55,2.35),(1.55,2.35),(-1.55,5.45),(1.55,5.45)): w.screw(dx,t,3.17,.14)
    w.barrel('Tapered blower air duct',x,6,L-.6,1.32,w.steel,z=1.65,front=.72,hollow=True)
    for t in (7,7.55,8.1): w.barrel('Flexible duct corrugation',x,t,t+.3,1.15,w.dark,z=1.65)
    w.round_body('Flattened outlet nozzle',x,[(L-2,1.65),(L-.1,2.8),(L,2.8)],w.dark,z=1.65,height=1.1)
    w.box('Green nozzle stiffener',x,L-1,1.45,.6,w.accent,z=2.27,h=.12,bevel=.1)
    w.path('Carry handle',[(2.2,1.2,1.5),(3.6,1.8,1.5),(3.6,4.7,1.5),(2.65,5.5,1.5)],.28,w.dark)


def repair(w):
    x,L=w.x,w.length
    w.round_body('Compact welding power pack',x,[(-1,2.4),(-.4,3.7),(3.2,4.0),(5.3,3.4),(6.2,1.5)],w.body,z=1.65,height=2.4)
    w.box('Cobalt service cover',.8,2.8,1.1,4.1,w.trim,z=2.85,h=.35,bevel=.26)
    w.tank('Small shielding gas cartridge',-1.85,.6,5.4,.72,w.edge,z=1.65)
    w.barrel('Copper torch shank',x,4.8,L-1.4,.52,w.brass,z=2.1)
    for t in (6,6.5,7): w.barrel('Torch heat sink fin',x,t,t+.20,.94,w.edge,z=2.1)
    w.barrel('Ceramic torch cup',x,L-1.8,L-.15,.7,w.accent,z=2.1,front=.50,hollow=True)
    w.barrel('Central tungsten electrode',x,L-1,L,.15,w.edge,z=2.1)
    w.path('Insulated power cable',[(-1.8,.1,1.5),(-2.7,1.8,1.6),(-2.4,5.6,1.7),(x-.7,7.5,2.1)],.22,w.dark)
    for t in (1.4,2.1,2.8,3.5): w.vent(-.5,t,.75,z=2.84)
    w.gauge(.4,4.8,2.95,.38); w.screw(.8,1.1,3.07,.14)


def energy(w,kind):
    x,L=w.x,w.length
    if kind=='injector':
        w.round_body('Medical injector chassis',x,[(-1.15,2.4),(-.4,3),(2.8,3.25),(5.8,2.4),(6.6,1)],w.body,z=1.8,height=1.9)
        w.barrel('Dose cartridge',x,.9,6.8,.72,w.accent,z=2.65)
        w.box('Dose inspection slit',x,3.8,.67,4.5,w.energy,z=3.39,h=.12,bevel=.22)
        for t in (2.1,2.8,3.5,4.2,4.9,5.6): w.box('Calibrated dose scale',x+.35,t,.33,.08,w.dark,z=3.5,h=.035,bevel=.01)
        for t in (.8,6.5): w.barrel('Cartridge steel retaining ferrule',x,t,t+.45,.84,w.steel,z=2.65)
        w.barrel('Needle mounting chuck',x,6.6,7.6,.43,w.steel,z=2.4,front=.26)
        w.barrel('Injection needle',x,7.4,L,.12,w.edge,z=2.4,front=.035)
        w.box('Trigger thumb paddle',1.7,1.25,1.1,1,w.dark,z=1.9,h=.5,bevel=.3)
        w.screw(-1.1,1.1,2.53,.14)
        return
    if kind=='core':
        w.round_body('Shielded core vessel',x,[(-1.2,2.5),(-.5,3.9),(2,5.8),(5.7,5.8),(8,3.5),(L,1.4)],w.body,z=1.85,height=2.8)
        w.barrel('Cylindrical charged core',x,1.9,7.5,1.28,w.energy,z=2.5)
        for side in (-1,1):
            w.path('Swept core cage rail',[(side*1.4,.8,2.6),(side*2.4,2.2,3),(side*2.4,6.5,3),(side*1.25,8.4,2.7)],.35,w.brass)
            for t in (2.3,6.5): w.screw(side*2.35,t,3.34,.18)
        for t in (1.4,4.8,7.7): w.barrel('Core shielding band',x,t-.22,t+.22,1.5,w.dark,z=2.5)
        w.barrel('Core coupling nose',x,7.9,L,.74,w.brass,z=2.35,front=.46,hollow=True)
        w.box('Containment status window',x,4.8,.85,.48,w.accent,z=4.1,h=.1,bevel=.12)
        return
    w.round_body('Cast energy receiver',x,[(-1.2,2.3),(-.5,3.5),(2.8,5.2),(5.4,4.5),(7.6,2.5)],w.body,z=1.85,height=2.5)
    for side in (-1,1):
        w.plate('Sculpted removable cheek panel',[(side*1.0,.3),(side*2.15,1.8),(side*2.3,4.7),(side*1.4,6.5),(side*.9,5.3)],w.trim,z=2.5,h=.5,bevel=.23)
        w.screw(side*1.55,2,2.89,.16)
        w.path('Copper power conduit',[(side*1.5,1.2,2.85),(side*1.3,3.3,3.3),(side*.9,6.2,2.9)],.14,w.brass)
    w.barrel('Protected power chamber',x,1.9,6.5,.94,w.dark,z=2.7)
    w.box('Narrow energy inspection window',x,4.1,1.1,3.4,w.energy,z=3.62,h=.18,bevel=.24)
    if kind=='asmd':
        # Both fire modes build this identical weapon. Only catalog colors differ.
        w.barrel('Shock induction barrel',x,6.1,L,.47,w.edge,z=2.35,hollow=True)
        for t in (7.3,8.3,9.3,10.3):
            w.barrel('Copper induction winding',x,t,t+.37,.87,w.brass,z=2.35)
            w.barrel('Ceramic coil separator',x,t+.40,t+.58,.96,w.accent,z=2.35)
        for side in (-1,1):
            w.barrel('Enclosed auxiliary capacitor',x+side*1.5,6.0,9.1,.39,w.steel,z=2.1)
            w.box('Capacitor inspection strip',x+side*1.5,7.45,.36,1.85,w.accent,z=2.5,h=.1,bevel=.12)
            w.box('Receiver color inlay',x+side*1.63,3.7,.48,2.1,w.accent,z=2.82,h=.1,bevel=.14)
        w.barrel('Shared focusing sleeve',x,10.9,L,.65,w.steel,z=2.35,hollow=True)
        w.rail(x,1.1,1.4,z=3.05,width=1.6)
    else:
        w.barrel('Plasma containment chamber',x,6,L-1.3,1.05,w.accent,z=2.4)
        for t in (6.7,8.2,9.7): w.barrel('Plasma chamber hoop',x,t,t+.34,1.2,w.steel,z=2.4)
        for side in (-1,1):
            w.plate('Tapered discharge fork',[(x+side*1.1,5.8),(x+side*2.5,7.4),(x+side*2.15,L-.1),(x+side*1.2,L),(x+side*1.55,8.3)],w.edge,z=2.25,h=1.1,bevel=.22)
            for t in (7.5,8.4,9.3): w.vent(x+side*1.9,t,.55,z=2.84)
            w.box('Fork ceramic terminal',x+side*1.6,L-.55,.52,.68,w.dark,z=2.94,h=.17,bevel=.1)


def build(c,spec):
    w=WeaponParts(c,spec); w.grip()
    kind=spec['model']['construction']
    builders={'pistol':pistol,'smg':smg,'rifle':rifle,'shotgun':shotgun,'sniper':sniper,
              'machine-gun':machine_gun,'crossbow':crossbow,'rocket':rocket,
              'flame':flame,'blower':blower,'repair':repair}
    if kind in builders: builders[kind](w)
    elif kind in ('hydra','mini-rockets'): multi_launcher(w,kind=='hydra')
    else: energy(w,kind)
    asset=model(c.scene); attach(w.objects,asset['root'])
    h=spec['heldItem']
    asset['sockets']={name:control(c.scene,name,(point[0]-16,16-point[1],1),asset['root'])
                      for name,point in [('grip',h['grip']),('muzzle',h['muzzle'])]}
    asset['root'].scale=(.1,.1,.1)
    return asset
