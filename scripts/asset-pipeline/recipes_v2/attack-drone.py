"""Heavy quadcopter, independent north-facing cannon and armored service pad."""
import math
from turret_parts import palette, annulus, grille, finish


def build(c, spec):
    p = palette(c, armor=(.12, .23, .25), accent=(.74, .32, .075))
    kind = spec['model']['part']
    if kind == 'station':
        c.box('Chamfered ground chassis', (0, 0, .14), (2.30, 2.30, .28), p['base'], .19)
        c.box('Armored docking deck', (0, 0, .31), (2.12, 2.12, .18), p['armor'], .18)
        c.box('Recessed docking bed', (0, 0, .414), (1.43, 1.58, .05), p['dark'], .15)
        for side in (-1, 1):
            c.box('Raised charging rail', (side * .61, 0, .49), (.16, 1.43, .14), p['edge'], .035)
            for y in (-.45, .45):
                c.box('Warm contact block', (side * .59, y, .575), (.18, .26, .065), p['accent'], .026)
            grille(c, 'Cooling bank', (side * .91, 0, .435), .23, .91, p['steel'], p['dark'], 5, 'y')
        c.box('Service terminal', (0, -.93, .49), (.62, .25, .17), p['steel'], .045)
        c.box('Inset status window', (0, -.96, .59), (.32, .10, .025), p['charge'], .02)
        for x in (-.88, .88):
            for y in (-.87, .87):
                c.box('Corner safety marking', (x, y, .43), (.25, .14, .04), p['accent'], .025)
        return finish(c, [], sockets={'dock': (0, 0, .5)})
    if kind == 'gun':
        c.cylinder('Independent gimbal bearing', (0, 0, .18), .32, .3, p['dark'], 24)
        c.box('Cannon receiver', (0, .12, .38), (.35, .67, .26), p['steel'], .065)
        c.box('Warm receiver cap', (0, .07, .53), (.26, .34, .05), p['accent'], .025)
        c.box('Barrel shroud', (0, .64, .39), (.19, .51, .20), p['base'], .03)
        c.box('Long cannon barrel', (0, 1.10, .38), (.095, .53, .095), p['edge'], .015)
        c.box('Muzzle brake', (0, 1.39, .38), (.20, .14, .17), p['steel'], .025)
        c.box('Dark muzzle vent', (0, 1.42, .474), (.105, .06, .012), p['dark'], .005)
        return finish(c, [], sockets={'muzzle': (0, 1.44, .38)})
    c.box('Armored belly', (0, 0, .29), (.86, 1.37, .34), p['base'], .19)
    c.box('Sloped main fuselage', (0, .02, .53), (.78, 1.19, .34), p['armor'], .20)
    c.box('Dorsal technical spine', (0, -.21, .74), (.39, .60, .09), p['steel'], .06)
    grille(c, 'Rear engine radiator', (0, -.40, .80), .32, .29, p['edge'], p['dark'], 4)
    c.box('Warm nose recognition panel', (0, .46, .71), (.40, .23, .05), p['accent'], .055)
    c.box('Front sensor window', (0, .61, .59), (.37, .08, .08), p['dark'], .025)
    groups, pivots = {}, {}
    for i, (x, y) in enumerate([(-.91, -.90), (.91, -.90), (-.91, .90), (.91, .90)]):
        arm = c.box('Diagonal load bearing arm', (x * .49, y * .49, .30), (math.hypot(x, y), .17, .18), p['steel'], .04)
        arm.rotation_euler.z = math.atan2(y, x)
        annulus(c, 'Rotor protective ring', (x, y, .36), .49, .43, .11, p['base'], steps=40)
        c.cylinder('Rotor motor', (x, y, .41), .13, .23, p['steel'], 16)
        blades = []
        for a in (0, math.pi / 2):
            blade = c.box('Broad matte rotor blade', (x, y, .56), (.82, .105, .028), p['edge'], .035)
            blade.rotation_euler.z = a + i * .3
            blades.append(blade)
        c.cylinder('Rotor safety cap', (x, y, .59), .09, .045, p['accent'], 16)
        groups[f'rotor{i}'] = blades; pivots[f'rotor{i}'] = (x, y, .56)
    return finish(c, [], groups, pivots, sockets={'gun': (0, 0, .8)})
