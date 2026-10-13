"""PORTAL_v02: spherical hand grenade with target-grid lens and safety hardware."""
import math
from rigs_v2 import model, control
from enemy_parts_b import tube
from turret_parts import annulus
from fire_control_parts import surfaces, lens, finish
from fire_control_surface import fastener, scuff, contact_dust


def build(c, spec):
    p = surfaces(c)
    shell = c.ell('Spherical steel grenade casing', (0, 0, .26), (.43, .46, .31), p['armor'])
    contact_dust(c, shell, lambda point: (.04-point.y)/.50 + max(0, .20-point.z))
    for i in range(8):
        a = math.tau*i/8
        panel = annulus(c, 'Segmented spherical shoulder armor', (0, 0, .42), .426, .29, .16,
                p['armor'], a+.027, a+math.tau/8-.027, 6)
        contact_dust(c, panel, lambda point: (-.08-point.y)/.48)
    lens(c, p, .275, .52, crosshair=True)
    c.box('Striker neck', (0, .45, .28), (.19, .19, .19), p['steel'], .025)
    c.box('Striker cap', (0, .54, .36), (.27, .13, .08), p['armor'], .02)
    fastener(c, p, 0, .54, .402, .027)
    for x in (-.25, .25):
        fastener(c, p, x, -.25, .505, .023)
    for a in (.58, 2.0, 3.6, 5.3):
        scuff(c, p, .385*math.cos(a), .385*math.sin(a), .502, .07, a+math.pi/2)
    scuff(c, p, -.065, .57, .402, .065, .12)
    tube(c, 'Bent right side safety spoon', [(.14,.55,.41),(.29,.48,.48),(.46,.20,.43),(.49,-.19,.26)], .045, p['edge'], 10)
    if spec['model']['part'] == 'held':
        annulus(c, 'Steel pull ring', (-.28, .54, .38), .17, .14, .025, p['edge'])
        tube(c, 'Safety cotter pin', [(-.025,.46,.37),(-.21,.46,.38)], .02, p['edge'], 8)
    for x,y in [(0,-.365),(-.36,0),(.36,0)]:
        ob = c.box('Small luminous witness mark', (x,y,.523), (.065,.105,.018), p['light'], .006)
        if x: ob.rotation_euler.z = math.pi/2
    finish(c, p)
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
