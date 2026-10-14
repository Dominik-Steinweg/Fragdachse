"""Actual loose scrap components. No collectible badge, pedestal or symbol disk."""
import math
import bpy
from dawn_parts import surface, root, finish, bolt, plate, beam, annulus


def build(c,spec):
    # One-pixel reconstruction support keeps soft native-24px edges from
    # bleeding into the safety border; geometry/camera/pivot remain unchanged.
    c.scene.cycles.filter_width = 1.0
    tier=int(spec['model']['tier']); pivot=root(c)
    rust=surface(c,'Rust oxide',(185,97,43),.65)
    steel=surface(c,'Matte salvaged steel',(211,218,205),.27)
    dark=surface(c,'Dark machined edges',(59,67,65),.10)
    copper=surface(c,'Copper windings',(227,146,76),.25)
    gear=surface(c,'Bright tempered gear steel',(165,180,180),.24)
    if tier==1:
        plate(c,'Torn folded sheet',(0,0,.07),[(-.74,-.55),(.42,-.78),(.65,-.38),(.53,-.15),(.76,.38),(.19,.77),(-.60,.53),(-.50,.20),(-.75,.07)],.12,rust,.025)
        annulus(c,'Large hexagonal nut',(-.16,.06,.23),.48,.25,.24,steel,steps=6)
        ob=c.cylinder('Discarded screw head',(.44,-.31,.19),.16,.11,steel,24)
        beam(c,'Screw drive slot',(.36,-.34),(.52,-.28),.024,.251,dark)
    elif tier==2:
        annulus(c,'Toothed gear body',(0,0,.15),.63,.40,.20,gear,steps=48)
        for i in range(6):
            a=i*math.tau/6
            tooth=c.box('Gear tooth',(.63*math.cos(a),.63*math.sin(a),.15),(.28,.28,.20),gear,.045)
            tooth.rotation_euler.z=a
        for r in (.30,.43):
            bpy.ops.mesh.primitive_torus_add(major_radius=r,minor_radius=.057,major_segments=48,minor_segments=12,location=(0,0,.29))
            ob=bpy.context.object;ob.name='Rounded copper winding';ob.data.materials.append(copper)
            for face in ob.data.polygons:face.use_smooth=True
        for x in (-.43,.43): c.box('Coil retaining tab',(x,0,.32),(.20,.14,.07),steel,.02)
    else:
        outline=[(0,.84),(.82,-.73),(-.82,-.73)]
        plate(c,'Triangular component housing',(0,0,.12),outline,.20,dark,.05)
        plate(c,'Triangular alloy armor',(0,-.015,.25),[(x*.92,y*.92) for x,y in outline],.10,steel,.04)
        annulus(c,'Core isolating collar',(0,-.10,.335),.34,.255,.08,dark)
        charge=surface(c,'Separate cyan core',(33,187,213),0,.25)
        c.cylinder('Cyan energy cell',(0,-.10,.373),.247,.065,charge,40)
        for x,y in [(0,.59),(-.54,-.57),(.54,-.57)]:
            c.cylinder('Brass corner connector',(x,y,.32),.085,.05,copper,6)
    if tier in (1, 2):
        # Match the narrow axis to the other tiers without changing the pivot.
        for ob in c.scene.objects:
            if ob.type == 'MESH':
                if tier == 1:
                    ob.location.x *= 1.027; ob.scale.x *= 1.027
                else:
                    ob.location.y *= 1.14; ob.scale.y *= 1.14
    return finish(c,pivot)
