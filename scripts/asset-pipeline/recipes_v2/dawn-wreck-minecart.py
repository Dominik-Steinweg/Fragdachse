"""Two separately derailed tubs straddling a short broken rail segment."""
import math
import random
from dawn_parts import material_factory,surface,root,finish,beam,bolt,plate,tube,annulus,crown,hazards,salvage_palette,vegetation,group


def build(c,spec):
    material=material_factory(c,spec)
    tier=int(spec['model']['tier']);p=salvage_palette(c,tier,spec);pivot=root(c);rng=random.Random(830)
    timber=material('Weathered railway sleeper',(92,73,48),.6)
    ore=material('Dark angular ore',(74,80,77),.38)
    for i in range(7):
        y=-1.35+i*.44
        ob=c.box('Splintered sleeper',(.07,y,.06),(1.04,.16,.13),timber,.025);ob.rotation_euler.z=.05*math.sin(i*2)
    for x in (-.24,.33):
        tube(c,'Bent railway rail',[(x,-1.53,.15),(x,-.50,.17),(x+.08,.20,.18),(x,1.51,.16)],.047,p['edge'],10)
        for y in (-1.31,-.89,.87,1.31):bolt(c,x+.10,y,.155,p['dark'],.035)
    for index,(cx,cy,angle) in enumerate([(-.67,.29,-.30),(.65,-.35,.39)]):
        before=set(c.scene.objects)
        c.box('Deep open ore tub',(0,0,.23),(1.09,1.02,.30),p['dark'],.10)
        # Splayed real walls and an irregular torn lip leave the dark cavity open.
        for side in (-1,1):
            crown(c,'Heavy battered tub wall',(side*.53,0,.34),.16,1.14,.23,p['paint'])
            c.box('Rubbed tub rail',(side*.54,0,.595),(.066,1.15,.058),p['edge'],.016)
            for y in (-.36,.32):bolt(c,side*.54,y,.635,p['dark'],.030)
        crown(c,'Rear tub end',(0,.52,.34),1.10,.18,.22,p['paint'])
        plate(c,'Jagged broken front lip',(0,0,.48),[(-.56,-.57),(.56,-.57),(.56,-.40),(.29,-.41),(.21,-.50),(.10,-.40),(-.03,-.50),(-.18,-.40),(-.31,-.50),(-.56,-.40)],.17,p['paint'],.019)
        for side in (-1,1):
            c.cylinder('Exposed derailed rail wheel',(side*.66,-.29,.24),.23,.14,p['dark'],32)
            annulus(c,'Rail wheel flange',(side*.66,-.29,.32),.232,.164,.044,p['trim'],steps=32)
            bolt(c,side*.66,-.29,.36,p['edge'],.066)
        for k in range(10):
            x=rng.uniform(-.35,.35);y=rng.uniform(-.30,.31)
            ob=c.box('Angular spilled ore',(x,y,.39),(.24+rng.random()*.08,.23,.18),ore,.055)
            ob.rotation_euler=(rng.uniform(-.2,.2),rng.uniform(-.2,.2),rng.random()*3)
        for x,y,a in [(-.21,.08,.4),(.23,-.16,-.6)]:
            ob=c.box('Heavy salvage inside tub',(x,y,.51),(.21,.37,.065),p['edge'],.018);ob.rotation_euler.z=a
        annulus(c,'Loose recovered bearing',(.15,.22,.56),.135,.075,.055,p['trim'],steps=24)
        tube(c,'Bent end grab handle',[(-.24,.60,.43),(-.24,.72,.43),(.24,.72,.43),(.24,.60,.43)],.035,p['trim'],10)
        if tier==2:hazards(c,(0,.52,.59),.70,.10,p['warning'],p['dark'])
        if tier==3:c.box('Cyan service seam on end',(0,.51,.59),(.53,.024,.025),p['cyan'],.006)
        if tier==1:vegetation(c,-.39,.29,.61,p,.65)
        group(c,'Derailed tub assembly',set(c.scene.objects)-before,(cx,cy,0),(.06 if index else -.09,.10 if index else -.12,angle)).parent=pivot
    for cx,cy,a in [(-.95,1.09,.42),(.79,-1.19,-.35)]:
        before=set(c.scene.objects)
        beam(c,'Detached axle',(-.25,0),(.25,0),.09,.17,p['edge'])
        for x in (-.28,.28):
            c.cylinder('Loose railway wheel',(x,0,.17),.19,.10,p['dark'],32)
            annulus(c,'Worn loose wheel flange',(x,0,.235),.19,.13,.027,p['trim'],steps=32)
            bolt(c,x,0,.26,p['edge'],.061)
        group(c,'Scattered wheelset',set(c.scene.objects)-before,(cx,cy,0),(0,0,a)).parent=pivot
    for i,(x,y) in enumerate([(-1.24,-.69),(-.73,-.96),(.90,.78),(1.29,.57),(.60,1.22),(-.49,1.43)]):
        ob=plate(c,'Spilled jagged salvage plate',(x,y,.10),[(-.10,-.13),(.10,-.12),(.12,.05),(.02,.08),(-.03,.14),(-.12,.07)],.10,p['trim'] if i%2 else p['edge'],.016);ob.rotation_euler.z=i*.74
    if tier==1:
        for x,y in [(.32,1.08),(-.34,-1.12),(1.10,.49)]:vegetation(c,x,y,.20,p,.60)
    return finish(c,pivot)
