"""Crooked two-cell scavenger shelter, handcart and increasing stolen salvage."""
import math
import bpy
from dawn_parts import (root, finish, material_factory, salvage_palette, salvage_gear,
                        plate, tube, beam, bolt, group, annulus)


def cloth_mesh(c, name, nx, ny, point, material):
    vertices=[point(i/nx,j/ny) for j in range(ny+1) for i in range(nx+1)]
    faces=[]
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i
            faces.append((a,a+1,a+nx+2,a+nx+1))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.materials.append(material);mesh.update()
    ob=bpy.data.objects.new(name,mesh);c.scene.collection.objects.link(ob)
    for face in mesh.polygons:face.use_smooth=True
    ob.modifiers.new('Heavy cloth thickness','SOLIDIFY').thickness=.014
    return ob


def build(c,spec):
    pivot=root(c);tier=int(spec['model']['tier']);p=salvage_palette(c,tier,spec)
    material=material_factory(c,spec)
    timber=material('Camp split timber',(102,84,60),.55)
    cloth=material('Camp stained sackcloth',(128,116,87),.28)
    violet=material('Camp faded violet repairs',(83,60,77),.3)
    cord=material('Camp frayed hemp',(146,132,102),.35)
    rust=material('Camp corroded fasteners',(94,62,43),.65)
    # A leaning shelter with a real peaked, sagging roof. Its open south edge
    # leaves the sacks visible, and guy ropes end at separate stakes, not a base.
    for a,b in [((-1.05,-.05,.06),(-1.13,.05,.97)),((.25,-.03,.06),(.35,.06,1.03)),
                ((-1.03,1.00,.06),(-1.15,1.11,.90)),((.29,1.01,.06),(.35,1.15,.96))]:
        tube(c,'Crooked shelter pole',[a,b],.044,timber,10)
    tube(c,'Splintered roof ridge',[(-.52,-.02,1.22),(-.48,.68,1.25),(-.56,1.25,1.15)],.043,timber,10)
    def roof(u,v):
        x=-1.19+1.60*u+.055*math.sin(v*7)*math.sin(math.pi*u)
        # Two torn bites in the loose front edge, broad enough to survive 68 px.
        tears=.14*math.exp(-((u-.27)/.055)**2)+.10*math.exp(-((u-.77)/.045)**2)
        y=.02+1.10*v+(.055*math.sin(u*16+.4)+tears)*(1-v)**3
        z=.91+.30*(1-abs(2*u-1))-.055*math.sin(v*math.pi)+.030*math.sin(u*18+v*6)
        return x,y,z
    cloth_mesh(c,'Sagging patched scavenger tarp',32,20,roof,cloth)
    for u0,v0,du,dv in [(.12,.17,.24,.29),(.63,.58,.28,.30)]:
        def patch(u,v,u0=u0,v0=v0,du=du,dv=dv):
            x,y,z=roof(u0+u*du+.011*math.sin(v*9),v0+v*dv+.013*math.sin(u*8));return x,y,z+.022
        cloth_mesh(c,'Irregular violet repair patch',7,7,patch,violet)
        for v in (.12,.48,.82):
            for u in (0,1):
                a=patch(u-.035,v);b=patch(u+.045,v+.035)
                tube(c,'Large uneven patch stitches',[a,b],.008,cord,6)
    for edge in (0,1):
        tube(c,'Sagging roof hem',[roof(i/16,edge) for i in range(17)],.019,cloth,8)
    for a,b in [((-1.15,.12,.96),(-1.35,-.25,.07)),((.35,1.11,.96),(.63,1.30,.07)),
                ((-1.10,1.08,.90),(-1.27,1.33,.05))]:
        tube(c,'Loose guy rope',[a,((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2-.08),b],.015,cord,8)
        beam(c,'Offcut ground stake',(b[0]-.05,b[1]-.05),(b[0]+.06,b[1]+.06),.055,.065,timber)
    # Broad folded bedroll and tied sacks under the roof; no cute round bundles.
    for x,y,s in [(-.97,-.08,.87),(-.48,-.09,1.0)]:
        ob=c.box('Collapsed rectangular burlap sack',(x,y,.19),(.35*s,.46*s,.25),cloth,.09);ob.rotation_euler.z=.22 if x<-.7 else -.15
        tube(c,'Sack tied neck',[(x-.12,y-.22,.21),(x,y-.26,.27),(x+.09,y-.20,.23)],.023,cord,8)
    # A rickety narrow handcart. Mismatched wheels and repaired rails are common
    # to all tiers; the silhouette grows through loot rather than decorative trim.
    before=set(c.scene.objects)
    for i in range(4):
        ob=c.box('Mismatched cart bed plank',(-.30+i*.20,0,.19),(.18,.98,.10),timber,.018)
        ob.rotation_euler.z=.018*math.sin(i*4)
    for x in (-.41,.41):
        beam(c,'Cart battered side rail',(x,-.53),(x,.52),.065,.38,timber)
        for y in (-.40,.42):tube(c,'Crooked cart upright',[(x,y,.12),(x+.025,y-.02,.47)],.032,timber,10)
        tube(c,'Long cart handle',[(x,-.35,.17),(x*1.08,-.78,.22),(x*1.05,-.97,.28)],.039,timber,10)
    beam(c,'Cart end rail',(-.43,.50),(.43,.50),.07,.39,timber)
    beam(c,'Bare cart axle',(-.62,.08),(.64,.08),.075,.12,rust)
    for x,angle in [(-.54,.08),(.55,-.13)]:
        wheel=c.box('Battered narrow cart wheel',(x,.08,.18),(.115,.49,.29),p['dark'],.065);wheel.rotation_euler.z=angle
        lip=c.box('Worn wheel iron band',(x,.08,.33),(.12,.44,.035),rust,.016);lip.rotation_euler.z=angle
    for k in range(1+tier):
        x=(-.19,.18,-.12,.15)[k];y=(-.20,.19,.14,-.11)[k]
        z=.30+k*.055
        ob=plate(c,'Stolen tier plate in cart',(x,y,z),[(-.21,-.19),(.19,-.20),(.23,.13),(.07,.21),(-.18,.16)],.055,p['paint'],.014)
        ob.rotation_euler.z=(-.31,.18,.45,-.21)[k]
        if tier==3 and k==3:
            tube(c,'Single cyan trace on stolen technology',[(x-.12,y-.10,z+.06),(x-.10,y+.10,z+.06),(x+.08,y+.10,z+.06)],.013,p['cyan'],8)
    if tier>=2:salvage_gear(c,(.12,.17,.54 if tier==2 else .61),.23,p,10)
    if tier==3:
        for x in (-.17,-.03):tube(c,'Overhanging recovered pipe',[(x,-.58,.51),(x+.04,.18,.62),(x+.13,.43,.62)],.048,p['edge'],10)
    group(c,'Crooked loaded handcart',set(c.scene.objects)-before,(.68,-.28,0),(0,0,-.21)).parent=pivot
    # A separate, clearly tiered loot pile beside the entrance.
    for i in range(tier):
        x=-.71+i*.16;y=-.70-i*.12;z=.09+i*.05
        ob=plate(c,'Unsorted stolen metal sheet',(x,y,z),[(-.30,-.20),(.25,-.24),(.31,.13),(.02,.22),(-.29,.12)],.07,p['paint'],.017)
        ob.rotation_euler.z=.20-i*.37
    salvage_gear(c,(-.83,-.56,.25),.23 if tier<3 else .27,p,10)
    if tier>=2:
        tube(c,'Recovered bent boiler pipe',[(-.43,-.78,.25),(-.22,-.75,.29),(-.18,-.47,.30)],.055,p['trim'],10)
        annulus(c,'Stolen bearing',(-.35,-1.05,.12),.14,.07,.065,p['edge'],steps=24)
    if tier==3:
        plate(c,'Overflow pale alloy panel',(-1.00,-1.03,.18),[(-.19,-.17),(.20,-.15),(.17,.16),(-.14,.20)],.09,p['paint'],.018)
        bolt(c,-1.07,-1.05,.29,p['dark'],.045)
        c.box('Torn sack of metal offcuts',(-.02,.32,.20),(.37,.42,.24),cloth,.08)
    if tier>=2:
        # T2 starts using the empty north-east corner; T3 fills it completely.
        ob=c.box('Recovered equipment casing',(.78,.64,.22),(.49,.51,.30),p['paint'],.045)
        ob.rotation_euler.z=-.16
        for x in (.63,.87):beam(c,'Battered casing strap',(x,.42),(x+.035,.87),.045,.39,p['trim'])
    if tier==3:
        ob=plate(c,'Overflow hull sheet',(.87,1.04,.12),[(-.27,-.20),(.27,-.18),(.30,.14),(.07,.23),(-.28,.16)],.09,p['paint'],.024)
        ob.rotation_euler.z=.22
        salvage_gear(c,(.80,.65,.46),.23,p,10)
        tube(c,'Exposed cyan service trace',[(.63,.44,.40),(.92,.44,.40),(.95,.52,.40)],.023,p['cyan'],8)
        tube(c,'Heavy overflow elbow',[(1.17,.62,.23),(1.29,.72,.28),(1.26,1.01,.25)],.062,p['trim'],10)
    return finish(c,pivot)
