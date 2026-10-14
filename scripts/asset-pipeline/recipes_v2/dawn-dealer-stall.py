"""Oval salvage shop: real overhead wagon, separate wares and a partial canvas roof."""
import math
import bpy
from dawn_parts import material_factory,surface, root, finish, plate, beam, bolt, annulus, tube


def gear(c, x, y, z, r, metal):
    annulus(c, 'Salvaged gear rim', (x,y,z), r*.78, r*.34, .065, metal, steps=32)
    for i in range(9):
        a=i*math.tau/9
        ob=c.box('Blunt gear tooth',(x+r*.79*math.cos(a),y+r*.79*math.sin(a),z),(r*.40,r*.34,.068),metal,.013)
        ob.rotation_euler.z=a


def build(c, spec):
    material=material_factory(c,spec)
    pivot=root(c)
    petrol=material('Weathered petrol enamel',(43,132,137),.43)
    rust=material('Rolled rusty lip',(163,89,53),.58)
    steel=material('Worn silver iron',(171,181,176),.23)
    dark=material('Recessed iron chassis',(44,53,54),.20)
    copper=material('Warm copper wire',(205,132,76),.22)
    wood=[material('Oak plank '+str(i),rgb,.28) for i,rgb in enumerate([(149,103,63),(184,134,81),(124,85,52)])]
    canvas=material('Faded ochre sailcloth',(204,186,137),.12)
    cloth=material('Petrol canvas stripe',(50,106,108),.20)
    amber=material('Separate warm lantern emission',(255,164,55),.02,2.5)
    # Broad rounded ends, with the long axis east/west and no support ground.
    outline=[(1.20*math.cos(i*math.tau/64)-.13,.65*math.sin(i*math.tau/64)) for i in range(64)]
    plate(c,'Oval riveted wagon tub',(0,0,.33),outline,.39,petrol,.055)
    for y in (-.70,.70):
        for x in (-.84,.65):
            beam(c,'Visible wheel axle',(x,0),(x,y),.09,.16,dark)
            c.box('Iron wheel tread',(x,y,.17),(.40,.15,.29),dark,.05)
            c.box('Wheel worn flange',(x,y,.33),(.43,.105,.045),steel,.018)
    # Continuous raised rolled edge with real negative space inside.
    rim=annulus(c,'Painted rolled oval rim',(0,0,.56),1,.88,.10,petrol,steps=64)
    rim.scale=(1.2,.65,1);rim.location.x=-.13
    inner=annulus(c,'Exposed inner petrol rail',(0,0,.60),1,.964,.035,petrol,steps=64)
    inner.scale=(1.13,.586,1);inner.location.x=-.13
    for i in range(16):
        a=i*math.tau/16
        bolt(c,-.13+1.155*math.cos(a),.608*math.sin(a),.63,steel,.021)
    for i in range(23):
        a=i*math.tau/23+.08
        x,y=-.13+1.15*math.cos(a),.625*math.sin(a)
        chip=plate(c,'Broken enamel edge chip',(x,y,.62),[(-.052,-.016),(.037,-.021),(.055,.008),(.003,.026),(-.042,.010)],.012,rust if i%3 else steel,.004)
        # Irregular large chips break the continuous rust band at native size.
        for v in chip.data.vertices:
            dx,dy=v.co.x-x,v.co.y-y
            v.co.x=x+dx*math.cos(a)-dy*math.sin(a)
            v.co.y=y+dx*math.sin(a)+dy*math.cos(a)
    # Counter planks remain visible between sorted components.
    for j in range(6):
        x=-.96+j*.32
        half=.54*math.sqrt(max(.1,1-((x+.13)/1.15)**2))
        c.box('Worn oak counter plank',(x,0,.575),(.302,half*2,.075),wood[j%3],.017)
        for y in (-half+.05,half-.05): bolt(c,x-.10,y,.622,dark,.012)
        for offset in (-.075,.04):
            tube(c,'Raised oak grain',[(x+offset,-half+.10,.620),(x+offset+.02,0,.623),(x+offset-.01,half-.08,.620)],.006,wood[(j+1)%3])
    # Drawbar extends from the short end, not across the serving side.
    plate(c,'Petrol front wagon lip',(-.16,-.54,.66),[(-.78,0),(.73,0),(.68,-.075),(-.70,-.075)],.065,petrol,.020)
    for y in (-.19,.19):beam(c,'Forged drawbar',(1.0,y),(1.42,0),.095,.29,dark)
    annulus(c,'Tow eye',(1.40,0,.30),.11,.060,.085,rust,steps=24)
    # Two shallow, partitioned display boxes on the open south half.
    for x in (-.62,.24):
        c.box('Crate dark interior',(x,-.24,.63),(.70,.44,.07),dark,.018)
        for yy in (-.48,-.01):c.box('Crate long rim',(x,yy,.70),(.76,.055,.15),wood[1],.011)
        for xx in (x-.35,x+.35):c.box('Crate short rim',(xx,-.24,.70),(.055,.47,.15),wood[0],.011)
    gear(c,-.77,-.25,.76,.18,steel)
    gear(c,-.45,-.28,.77,.13,copper)
    gear(c,-.56,-.09,.76,.09,steel)
    beam(c,'Loose spanner in gear crate',(-.86,-.37),(-.48,-.13),.046,.84,steel)
    for x,y,r in [(.08,-.25,.14),(.39,-.26,.16)]:
        c.cylinder('Spool core',(x,y,.72),r,.10,dark,24)
        for i in range(3):
            annulus(c,'Sorted copper winding',(x,y,.80+i*.022),r*.85,r*.46,.027,copper,steps=32)
        beam(c,'Spool retaining clip',(x-r,y),(x+r,y),.034,.881,steel)
    # Two barrel lids, a packing case and a warm lantern at the curved end.
    for x,y,r in [(.63,.26,.22),(.91,-.09,.16)]:
        c.cylinder('Petrol salvage barrel',(x,y,.69),r,.30,petrol,32)
        annulus(c,'Barrel steel hoop',(x,y,.85),r*.96,r*.80,.045,steel,steps=32)
        c.cylinder('Barrel recessed lid',(x,y,.86),r*.77,.025,petrol,32)
        bolt(c,x+.055,y,.89,copper,.037)
    c.box('Square packing case',(.25,.25,.73),(.31,.33,.23),wood[1],.018)
    for xx in (.15,.35):c.box('Packing case strap',(xx,.25,.86),(.031,.34,.025),dark,.007)
    # A visible glazed top aperture keeps the warm emission readable from -Z.
    annulus(c,'Lantern metal crown',(1.00,.29,.93),.105,.073,.045,copper,steps=12)
    c.cylinder('Lantern amber chamber',(1.00,.29,.90),.073,.12,amber,12)
    for dx in (-.077,.077):c.box('Lantern cage',(1+dx,.29,.87),(.022,.15,.20),dark,.008)
    # A small folded awning covers only the northwest quarter, leaving goods exposed.
    for x in (-1.02,-.10):
        for y in (.02,.54): c.cylinder('Canopy support',(x,y,.81),.025,.66,rust,12)
    for strip in range(6):
        x0=-1.08+strip*.18
        vertices=[]
        for x in (x0,x0+.183):
            for j in range(9):
                y=-.01+j*.075
                z=1.04+.12*math.sin(j*math.pi/8)+.018*math.cos(strip*2+j)
                vertices.append((x,y,z))
        faces=[(j,j+1,j+10,j+9) for j in range(8)]
        mesh=bpy.data.meshes.new('Soft bowed sailcloth');mesh.from_pydata(vertices,[],faces);mesh.update()
        ob=bpy.data.objects.new('Canvas awning panel',mesh);c.scene.collection.objects.link(ob)
        mesh.materials.append(canvas if strip%3 else cloth)
        solid=ob.modifiers.new('Cloth thickness','SOLIDIFY');solid.thickness=.018
        for face in mesh.polygons:face.use_smooth=True
    tube(c,'Awning front rolled hem',[(-1.09,-.02,1.04),(-.8,-.02,1.02),(-.50,-.02,1.04),(0,-.02,1.04)],.031,canvas)
    plate(c,'Sewn canvas repair',(-.76,.30,1.177),[(-.095,-.07),(.11,-.06),(.08,.075),(-.11,.06)],.008,cloth,.008)
    for x in (-.835,-.685):
        for y in (.26,.31,.35):beam(c,'Patch stitch',(x-.011,y),(x+.011,y),.009,1.188,canvas)
    # The 3 x 2-cell footprint includes the wheels; preserve fixed center and camera.
    for ob in c.scene.objects:
        if ob.type=='MESH':
            ob.location.y*=1.28
            ob.scale.y*=1.28
    return finish(c,pivot)
