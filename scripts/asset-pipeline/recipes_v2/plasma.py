"""Split accelerator rails around a ceramic charge chamber, with independent sliding emitter jaws."""
import math
from turret_parts import palette,support,annulus,grille,new_meshes,finish


def build(c,spec):
    p=palette(c,armor=(.035,.13,.235),accent=(.075,.36,.57),charge=(.035,.61,.82))
    base=support(c,p,radius=.85,facets=10)
    c.box('Blue accelerator saddle',(-.21,0,.49),(.98,.92,.30),p['armor'],.14)
    c.box('Rear accelerator shield',(-.60,0,.69),(.21,.67,.31),p['steel'],.060)
    grille(c,'Accelerator rear heat exchanger',(-.62,0,.87),.12,.43,p['dark'],p['edge'],4,along='y')
    c.cylinder('Central ceramic charge well',(-.16,0,.72),.31,.26,p['ivory'],32)
    c.cylinder('Dark inset plasma aperture',(-.16,0,.873),.251,.040,p['dark'],32)
    core=[c.ell('Dense cyan plasma charge',(-.16,0,.919),(.187,.187,.15),p['charge'])]
    groups={'core':core}
    for side in (-1,1):
        before=set(c.scene.objects);y=side*.255
        c.box('Split accelerator jaw',(.65,y,.67),(1.12,.20,.28),p['steel'],.050)
        c.box('Blue jaw upper armor',(.61,y,.836),(1.08,.17,.095),p['armor'],.027)
        c.box('Cyan accelerator interior rail',(.68,side*.148,.783),(.97,.040,.08),p['charge'],.008)
        for xx in (.27,.53,.79):
            c.box('Ceramic field separator',(xx,y,.911),(.095,.23,.042),p['ivory'],.012)
        c.box('Broad emitter jaw tip',(1.175,y,.78),(.18,.26,.29),p['edge'],.040)
        c.box('Cyan emitter tip panel',(1.178,y,.942),(.10,.15,.026),p['charge'],.013)
        groups['left_pod' if side<0 else 'right_pod']=new_meshes(c,before)
    c.box('Narrow black inter-rail bed',(.49,0,.61),(.80,.20,.07),p['dark'],.020)
    for side in (-1,1):
        c.box('Side charge safety contact',(-.24,side*.38,.81),(.29,.10,.12),p['accent'],.027)
    return finish(c,base,groups,pivots={'core':(-.16,0,.91)},emission=p['charge'],sockets={'muzzle':(1.29,0,.78)})
