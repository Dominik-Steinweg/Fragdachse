"""Weathered tracked extractor, copper vessels and a large articulated cutter head."""
import math
import bpy
from mathutils import Vector
from dawn_parts import surface,root,finish,bolt,plate,tube,annulus,crown,hazards


def build(c,spec):
    pivot=root(c)
    yellow=surface(c,'Chipped industrial yellow',(227,171,37),.48)
    brass=surface(c,'Aged copper brass tanks',(170,111,48),.45)
    steel=surface(c,'Rubbed matte steel',(188,198,188),.28)
    dark=surface(c,'Dark structural steel',(43,53,55),.18)
    rubber=surface(c,'Rubber tread and hose',(41,47,43),.09)
    rib=surface(c,'Worn rubber rib crowns',(82,88,76),.16)
    recess=surface(c,'Deep oiled recess',(18,25,27),0)
    lamp=surface(c,'Amber safety beacon',(240,95,9),0,.02)
    cx=-.23
    c.box('Heavy dark chassis',(cx,.16,.20),(2.0,2.13,.32),dark,.12)
    for side in (-1,1):
        x=cx+side*.94
        c.box('Armored track bed',(x,.20,.20),(.36,2.26,.33),rubber,.13)
        for i in range(12):
            y=-.78+i*.18
            for s in (-1,1):
                ob=c.box('Angled tread shoe',(x+s*.070,y,.38),(.19,.055,.06),rib,.015);ob.rotation_euler.z=s*.30
        c.box('Short yellow fender',(x,1.06,.31),(.39,.23,.20),yellow,.035)
    for side in (-1,1):
        x=cx+side*.46
        c.cylinder('Tank foot gasket',(x,.76,.38),.422,.17,dark,48)
        c.cylinder('Copper pressure vessel',(x,.76,.48),.40,.29,brass,48)
        c.ell('Domed copper tank cap',(x,.76,.59),(.39,.39,.23),brass)
        annulus(c,'Tank shoulder retaining band',(x,.76,.60),.399,.361,.046,steel)
        c.cylinder('Tank filler gasket',(x,.90,.795),.098,.04,dark,24)
        cap=c.cylinder('Large tank filler cap',(x,.90,.829),.075,.043,steel,6)
        c.box('Level gauge channel',(x,.64,.813),(.071,.26,.03),dark,.02)
        for j in range(3):c.box('Gauge fluid segments',(x,.56+j*.064,.834),(.037,.045,.018),yellow,.005)
        for a in (0,2.1,4.2):bolt(c,x+.26*math.cos(a),.76+.26*math.sin(a),.755,steel,.024)
        tube(c,'Tank supply pipe',[(x,.39,.50),(x,.22,.46),(cx+side*.27,.12,.43)],.052,dark)
        tube(c,'Tank guard handle',[(x-.19,1.07,.48),(x-.19,1.27,.52),(x+.19,1.27,.52),(x+.19,1.07,.48)],.041,yellow)
    crown(c,'Sloped main motor hood',(cx,-.31,.34),.87,1.08,.24,yellow)
    crown(c,'Top motor cowl',(cx,1.02,.48),.32,.55,.18,yellow)
    c.box('Recessed hood hatch',(cx,-.25,.586),(.51,.37,.036),dark,.036)
    c.box('Hatch face',(cx,-.23,.613),(.41,.28,.030),yellow,.022)
    for y in (-.49,-.57,-.65):c.box('Deep hood louvers',(cx,y,.58),(.51,.043,.045),recess,.01)
    hazards(c,(cx,-.76,.495),.64,.12,yellow,recess)
    c.cylinder('Beacon seat',(cx,.12,.60),.164,.07,dark,32)
    c.cylinder('Beacon brass collar',(cx,.12,.65),.135,.06,brass,32)
    c.ell('Large amber safety beacon',(cx,.12,.72),(.115,.115,.092),lamp)
    for x in (cx-.30,cx+.30):
        for y in (-.36,-.06):bolt(c,x,y,.602,steel,.031)
    c.box('Recovered scrap tray',(cx-.66,-.35,.38),(.35,.76,.20),dark,.032)
    for i in range(3):
        ob=c.box('Recovered metal offcut',(cx-.66+(i%2)*.045,-.10-i*.18,.50),(.18,.23,.07),steel,.016);ob.rotation_euler.z=.35+i*.6
    c.box('Side pump casing',(cx+.67,-.31,.37),(.39,.78,.21),yellow,.05)
    c.cylinder('Pressure gauge bezel',(cx+.67,-.12,.49),.109,.05,dark,24)
    c.cylinder('Pressure gauge face',(cx+.67,-.12,.52),.074,.025,steel,24)
    c.box('Pressure needle',(cx+.69,-.10,.54),(.06,.015,.016),recess,.003)
    for y in (-.40,-.49,-.58):c.box('Pump air vent',(cx+.67,y,.488),(.25,.035,.027),recess,.006)
    # Enlarge the actual machine, not its export canvas or the moving tool.
    for ob in c.scene.objects:
        if ob.type == 'MESH':
            ob.location.x *= 1.10; ob.location.y *= 1.10
            ob.scale.x *= 1.10; ob.scale.y *= 1.10
    # The long ribbed hose bends out to the right, away from the chassis.
    hose=bpy.data.objects.new('Vacuum hose compression',None);c.scene.collection.objects.link(hose)
    hose.parent=pivot;hose.location=(-.88,-.51,0)
    points=[]
    for i in range(29):
        t=i/28
        points.append((-.88+1.96*t,-.51-.51*t-.26*math.sin(math.pi*t),.30))
    before=set(c.scene.objects)
    tube(c,'Heavy flexible vacuum hose',points,.132,rubber,20)
    for i in range(1,28):
        a,b=points[i-1],points[i+1]
        ob=annulus(c,'Reinforced hose rib',(0,0,0),.147,.119,.031,rib,steps=24)
        ob.location=points[i];ob.rotation_euler=Vector((b[0]-a[0],b[1]-a[1],0)).to_track_quat('Z','Y').to_euler()
    for ob in set(c.scene.objects)-before:ob.parent=hose;ob.location-=hose.location
    nozzle=bpy.data.objects.new('Vacuum head stroke',None);c.scene.collection.objects.link(nozzle);nozzle.parent=pivot
    nozzle.location=(1.08,-1.00,0)
    for r,z,h,mat in [(.42,.12,.18,dark),(.36,.24,.12,brass),(.285,.33,.11,steel)]:
        ob=c.cylinder('Suction head concentric housing',(0,0,z),r,h,mat,48);ob.parent=nozzle
    drill=bpy.data.objects.new('Rotating cutter crown',None);c.scene.collection.objects.link(drill);drill.parent=nozzle
    for i in range(3):
        a=math.tau*i/3
        pts=[(.11,-.05),(.35,-.13),(.40,-.02),(.29,.10),(.13,.05)]
        pts=[(u*math.cos(a)-v*math.sin(a),u*math.sin(a)+v*math.cos(a)) for u,v in pts]
        ob=plate(c,'Broad rotating cutter tooth',(0,0,.40),pts,.09,yellow if i==0 else steel,.018);ob.parent=drill
    ob=c.cylinder('Off-center visible cutter hub',(0,0,.44),.105,.06,dark,6);ob.parent=drill
    return finish(c,pivot,{'hose':hose,'nozzle':nozzle,'drill':drill,'warning_emission':lamp.node_tree.nodes['Principled BSDF'].inputs['Emission Strength']})
