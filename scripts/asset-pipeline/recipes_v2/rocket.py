"""Two compact exposed rocket magazines on a load-bearing circular gimbal."""
import math
import bpy
from turret_parts import palette, support, cylinder_x, grille, new_meshes, finish


def build(c, spec):
    p = palette(c, armor=(.065, .15, .15), accent=(.70, .29, .045))
    red = c.material('Terracotta warheads', (.48, .065, .038), 'technical')
    base = support(c, p, radius=.87, facets=12, accent_lugs=True)
    c.box('Central recoil cradle', (-.04, 0, .47), (1.30, .36, .29), p['dark'], .085)
    c.box('Cast gimbal spine', (-.20, 0, .63), (.96, .32, .23), p['armor'], .070)
    grille(c, 'Rear drive cooling', (-.49, 0, .77), .30, .21, p['edge'], p['dark'], bars=3)
    c.box('Forward rangefinder cradle', (.57, 0, .57), (.35, .27, .22), p['steel'], .045)
    c.box('Rangefinder turquoise glass', (.63, 0, .695), (.17, .15, .027), p['charge'], .022)
    groups = {}
    for side in (-1, 1):
        before = set(c.scene.objects); y = side*.49
        c.box('Pod sliding underframe', (.18, y, .48), (1.69, .46, .16), p['dark'], .065)
        c.box('Pod petrol armor', (.17, y, .63), (1.60, .45, .25), p['armor'], .080)
        c.box('Open magazine recess', (.12, y, .766), (1.04, .34, .045), p['dark'], .025)
        c.box('Rear magazine armored cap', (-.60, y, .69), (.19, .48, .24), p['steel'], .045)
        c.box('Ochre launch throat', (.94, y, .65), (.20, .46, .27), p['accent'], .038)
        c.box('Dark twin launch apertures', (1.06, y, .69), (.15, .34, .14), p['dark'], .020)
        for dy in (-.093, .093):
            yy=y+dy
            cylinder_x(c, 'Ivory loaded missile', (.03, yy, .822), .064, .64, p['ivory'], 20)
            cylinder_x(c, 'Rocket caution collar', (.32, yy, .822), .065, .07, p['accent'], 20)
            bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=.064, radius2=.005, depth=.22, location=(.465, yy, .822), rotation=(0, math.pi/2, 0))
            ob=bpy.context.object; ob.name='East pointed red warhead'; ob.data.materials.append(red)
            c.box('Visible launch rail', (.87, yy, .798), (.64, .043, .035), p['edge'], .006)
            c.box('Rocket tail stabilizer', (-.29, yy, .842), (.12, .13, .025), p['steel'], .006)
        c.box('Magazine retaining strap', (-.13, y, .891), (.072, .37, .028), p['steel'], .008)
        c.box('Pod identification stripe', (.94, y, .80), (.064, .29, .019), p['ivory'], .005)
        for xx in (-.57, -.48):
            c.box('Rear magazine vent', (xx, y, .822), (.035, .27, .025), p['dark'], .005)
        groups['left_pod' if side < 0 else 'right_pod'] = new_meshes(c, before)
    return finish(c, base, groups, sockets={'muzzle':(1.22,0,.78),'muzzle_left':(1.22,-.49,.78),'muzzle_right':(1.22,.49,.78)})
