"""Player badger sculpt and rig, dressed as a north-facing salvage merchant."""
from recipes_v2 import badger as player
from rigs_v2 import attach
from dawn_parts import surface, plate, beam, bolt, annulus, tube
from weapon_surface_parts import paint_depth


def build(c,spec):
    asset=player.build(c,spec)
    before=set(c.scene.objects)
    leather=surface(c,'Supple brown leather apron',(140,87,45),.22)
    leather_light=surface(c,'Apron rolled seams',(181,130,75),.16)
    red=surface(c,'Vermilion neckerchief',(192,59,35),.09)
    iron=surface(c,'Worn wrench steel',(174,185,177),.18)
    brass=surface(c,'Old brass fittings',(207,168,94),.14)
    glass=surface(c,'Muted welding glass',(99,148,150),.05)
    # Clothing overlays the unchanged back and shoulders; broad head mask stays exposed.
    plate(c,'Leather apron body',(0,0,1.74),[(-.28,-.37),(.28,-.37),(.34,-.64),(.25,-.70),(-.25,-.70),(-.34,-.64)],.045,leather,.025)
    for side in (-1,1):
        beam(c,'Apron shoulder strap',(side*.38,-.29),(side*.40,-.55),.042,1.76,leather_light)
        bolt(c,side*.39,-.48,1.81,brass,.020)
    c.box('Apron patch pocket',(0,-.61,1.79),(.30,.13,.035),leather_light,.020)
    beam(c,'Pocket folded lip',(-.15,-.555),(.15,-.555),.019,1.82,leather)
    tube(c,'Narrow red neck scarf',[(-.36,-.29,1.89),(-.32,-.43,1.87),(0,-.52,1.84),(.32,-.43,1.87),(.36,-.29,1.89)],.034,red)
    plate(c,'Small tied scarf end',(.35,-.44,1.88),[(0,.025),(.060,-.02),(.045,-.13),(-.025,-.07)],.023,red,.014)
    body_accessories=[o for o in c.scene.objects if o not in before and o.type=='MESH']
    attach(body_accessories,asset['parts']['body'])
    before=set(c.scene.objects)
    # No cap: the player's ivory crown and three long face stripes stay exposed.
    # Small lenses sit over the dark rear bands, leaving the white center open.
    for x in (-.19,.19):
        annulus(c,'Small welding goggle rim',(x,-.22,2.13),.067,.046,.033,brass,steps=24)
        c.cylinder('Muted welding goggle lens',(x,-.22,2.145),.045,.016,glass,24)
        beam(c,'Short goggle temple',(x,-.22),(x*1.48,-.245),.024,2.125,leather)
    beam(c,'Fine goggle bridge',(-.12,-.22),(.12,-.22),.015,2.13,brass)
    head_accessories=[o for o in c.scene.objects if o not in before and o.type=='MESH']
    attach(head_accessories,asset['parts']['head'])
    # Existing offset grips hold a small workshop spanner, without changing the arms.
    beam(c,'Held workshop spanner',(-.27,.75),(.27,.66),.078,1.665,iron)
    annulus(c,'Spanner jaw',(-.28,.752,1.667),.107,.062,.055,iron,start=.40,end=5.25,steps=24)
    attach([o for o in c.scene.objects if o.type=='MESH' and o.parent is None],asset['root'])
    for ob in body_accessories+head_accessories:paint_depth(c,ob)
    return asset
