"""Shared biped stance with distinct enemy skulls, equipment and stable held weapons."""
import bpy
from recipes_v2 import badger
from enemy_parts_b import scute, tube
from enemy_surface_parts import finish_surfaces
from rigs_v2 import attach
from biped_enemy_heads import alien_head, pyro_head
from biped_enemy_weapons import equip


def build(c,spec,kind):
    asset=badger.build(c,spec)
    # Replace only the freshly generated head group. The player's recipe and other scenes stay intact.
    for ob in tuple(asset['parts']['head'].children):
        bpy.data.objects.remove(ob,do_unlink=True)
    before={m for ob in c.scene.objects if ob.type=='MESH' for m in ob.data.materials}
    alien=kind=='alien'
    head=alien_head(c) if alien else pyro_head(c)
    attach(head,asset['parts']['head'])
    for ob in head:ob['motionRole']='head'
    shell=c.material('Indigo alien carapace' if alien else 'Fire red protective armor',
                     (.074,.09,.23) if alien else (.44,.021,.013),'technical')
    rim=c.material('Cold mint chitin inlays' if alien else 'Dark red ceramic armor edges',
                   (.18,.41,.36) if alien else (.25,.021,.016),'technical')
    dark=c.material('Graphite equipment recess',(.018,.031,.038))
    energy=c.material('Contained turquoise organ' if alien else 'Amber furnace ceramic',
                      (.045,.47,.38) if alien else (.70,.085,.012),emission=.15)
    body=[]
    for side in (-1,1):
        body.append(scute(c,'Rounded grown shoulder guard',(side*.57,-.27,1.68),.43,.44,shell,.18))
        body.append(scute(c,'Inset shoulder identity field',(side*.58,-.25,1.78),.29,.24,rim,.04))
        body.append(scute(c,'Rounded dorsal hip shield',(side*.32,-.51,1.44),.32,.37,shell,.16))
        body.append(tube(c,'Short inset equipment seam',[(side*.47,-.36,1.78),(side*.59,-.34,1.80),(side*.67,-.24,1.77)],.012,dark,16))
        for y in (-.31,-.23): body.append(c.ell('Recessed shoulder attachment',(side*.65,y,1.79),(.018,.018,.008),dark))
    if alien:
        for x,y,r in [(-.26,-.48,.11),(0,-.57,.14),(.26,-.48,.11)]:
            body.append(c.ell('Smooth alien neural organ',(x,y,1.66),(r,r*1.25,.09),energy))
            body.append(scute(c,'Pearl organ collar',(x,y-.015,1.59),r*2.6,r*3,shell,.09))
        for side in (-1,1):
            body.append(scute(c,'Swept alien forearm armor',(side*.61,.38,1.60),.25,.40,shell,.14))
            body.append(c.ell('Small cyan forearm inset',(side*.60,.38,1.677),(.035,.11,.015),energy))
    else:
        body.append(c.ell('Oval recessed furnace carrier',(0,-.54,1.58),(.27,.17,.11),dark))
        body.append(c.ell('Warm oval furnace',(0,-.55,1.69),(.19,.115,.055),energy))
        for x in (-.10,0,.10): body.append(c.box('Curved furnace protective rib',(x,-.55,1.73),(.027,.20,.028),dark,.012))
        for side in (-1,1):
            body.append(c.ell('Charcoal breathing air canister',(side*.45,-.48,1.42),(.11,.25,.10),dark))
            for y in (-.63,-.40):body.append(scute(c,'Red canister securing band',(side*.45,y,1.51),.18,.055,shell,.035))
    attach(body,asset['parts']['body'])
    after={m for ob in c.scene.objects if ob.type=='MESH' for m in ob.data.materials}
    finish_surfaces(c.scene,{m for m in after-before if not m.get('FD_SurfaceKind') and not m.get('FD_AlienEye')})
    equip(c,asset,kind)
    return asset
