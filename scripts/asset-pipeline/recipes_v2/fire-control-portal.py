"""PORTAL_v02: spherical hand grenade with target-grid lens and safety hardware."""
import math
from rigs_v2 import model, control
from enemy_parts_b import tube
from turret_parts import annulus
from fire_control_parts import surfaces, lens, finish


def build(c, spec):
    p = surfaces(c)
    c.ell('Spherical steel grenade casing', (0, 0, .26), (.43, .46, .31), p['steel'])
    for i in range(8):
        a = math.tau*i/8
        annulus(c, 'Segmented spherical shoulder armor', (0, 0, .42), .426, .29, .16,
                p['armor'], a+.027, a+math.tau/8-.027, 6)
    lens(c, p, .275, .52, crosshair=True)
    c.box('Striker neck', (0, .45, .28), (.19, .19, .19), p['edge'], .025)
    c.box('Striker cap', (0, .54, .36), (.27, .13, .08), p['steel'], .02)
    tube(c, 'Bent right side safety spoon', [(.14,.55,.41),(.29,.48,.48),(.46,.20,.43),(.49,-.19,.26)], .045, p['edge'], 10)
    if spec['model']['part'] == 'held':
        annulus(c, 'Steel pull ring', (-.28, .54, .38), .17, .14, .025, p['edge'])
        tube(c, 'Safety cotter pin', [(-.025,.46,.37),(-.21,.46,.38)], .02, p['edge'], 8)
    for x,y in [(0,-.365),(-.36,0),(.36,0)]:
        ob = c.box('Small luminous witness mark', (x,y,.523), (.065,.105,.018), p['light'], .006)
        if x: ob.rotation_euler.z = math.pi/2
    finish(c)
    asset = model(c.scene)
    if spec['model']['part'] == 'held':
        # Same 32px plane and grip/muzzle as HE; body occupies approximately 6px.
        for ob in list(asset['root'].children):
            ob.location *= .64
            ob.scale *= .64
            ob.location.y -= .54
        for name in ('grip', 'muzzle'):
            x,y = spec['heldItem'][name]
            asset['sockets'][name] = control(c.scene, name, ((x-16)*.1,(16-y)*.1,.2), asset['root'])
    return asset
