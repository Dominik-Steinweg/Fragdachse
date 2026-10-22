"""Lobby base buildings at 1 BU = 1 m = 32 px: workshop, yard, armory and scrap stall.

Each structure fills a 5 x 4 m footprint (x -2.5..2.5, y -2..2) in a 6 m canvas, with its
working front facing south (-Y). `model.variant` (or the concept-only `draft.variant`) picks
one of two authored layouts. Sockets mark staff, plaque, smoke, sparks and lights.
"""
import math
import random
from dawn_parts import root, finish, plate, beam, tube, annulus, bolt, crown
from dawn_lobby_details import rock, barrel, rope, sack, lantern, crate, hammer, tongs, endgrain, scraps
from lobby_structure_parts import (palette, slab, gable_roof, shed_roof, hip_roof, plank_wall, stone_course, post,
                                   chimney, skylight, canvas_awning, counter, gas_bottle, timber_stack, stone_blocks,
                                   pallet, sack_stack, scrap_pile, lamp_post, socket, grid_surface, strut, lattice_jib,
                                   wheelbarrow, camo_net)


def flagstones(c, x0, y0, x1, y1, p, seed=0, size=.42):
    """Structural stone paving of a work bay; joints stay open so the ground reads through."""
    rng = random.Random(seed)
    y = y0
    while y < y1 - .05:
        h = min(size * rng.uniform(.6, 1.15), y1 - y)
        x = x0 + rng.uniform(-.15, 0)
        while x < x1 - .05:
            w = min(size * rng.uniform(.6, 1.6), x1 - x)
            if w > .1 and h > .1 and rng.random() > .04:
                # Irregular slabs: per-stone inset, lift and tone; open joints read as soil.
                inset = rng.uniform(.04, .08)
                hh = h - inset - rng.uniform(0, .05)
                s = c.box('Worn paving flagstone', (x + w / 2, y + rng.uniform(-.02, .02) + h / 2, .025 + rng.uniform(0, .02)),
                          (w - inset, hh, .05), p['paving'] if rng.random() > .25 else p['mortar'], .022)
                s.rotation_euler.z = rng.uniform(-.06, .06)
            x += w
        y += h


def duckboards(c, x0, y0, x1, y1, p, seed=0):
    rng = random.Random(seed)
    y = y0
    while y < y1 - .04:
        c.box('Yard duckboard slat', ((x0 + x1) / 2 + rng.uniform(-.03, .03), y + .06, .05), (x1 - x0 - rng.uniform(0, .1), .12, .04),
              p['timber'] if rng.random() > .4 else p['oak'], .01)
        y += .16
    for x in (x0 + .08, x1 - .08):
        c.box('Duckboard runner', (x, (y0 + y1) / 2, .02), (.07, y1 - y0, .04), p['tar'], .006)


def anvil(c, x, y, p, angle=0):
    c.cylinder('Anvil oak stump', (x, y, .3), .3, .6, p['cut'], 20)
    endgrain(c, x, y, .605, .28, p)
    annulus(c, 'Stump iron hoop', (x, y, .45), .31, .285, .05, p['rust'], steps=28)
    c.box('Anvil foot', (x, y, .66), (.40, .30, .12), p['dark'], .03)
    c.box('Anvil waist', (x, y, .78), (.24, .22, .16), p['iron'], .03)
    outline = [(-.40, -.15), (.18, -.15), (.27, -.08), (.56, 0), (.27, .085), (.18, .15), (-.40, .15)]
    ob = plate(c, 'Forged horn anvil face', (0, 0, 0), outline, .12, p['iron'], .022)
    ob.location = (x, y, .92)
    ob.rotation_euler.z = angle
    c.box('Hardy hole', (x - .28 * math.cos(angle), y - .28 * math.sin(angle), .985), (.06, .06, .008), p['dark'], .004)


def hearth(c, x, y, w, d, p, seed=0):
    """Open field forge: masonry block, recessed coal bed, live embers and leather bellows."""
    slab(c, 'Forge masonry block', x - w / 2, y - d / 2, x + w / 2, y + d / 2, 0, .72, p['stone'], .05)
    stone_course(c, (x - w / 2, y - d / 2), (x + w / 2, y - d / 2), .0, .72, p, seed, .2, .3)
    slab(c, 'Recessed black hearth', x - w * .32, y - d * .3, x + w * .32, y + d * .3, .7, .76, p['coal'], .02)
    rng = random.Random(seed)
    for i in range(22):
        px, py = x + rng.uniform(-w * .28, w * .28), y + rng.uniform(-d * .26, d * .26)
        c.ell('Charcoal lump', (px, py, .78), (.06, .05, .035), p['coal'])
        if i % 3 == 0: c.ell('Living forge ember', (px + .02, py, .8), (.035, .028, .014), p['ember'])
    for side in (-1, 1):
        slab(c, 'Forge curb', x + side * (w / 2 - .06) - .06, y - d / 2, x + side * (w / 2 - .06) + .06, y + d / 2, .72, .86, p['stone'], .02)
    # Bellows lie flat beside the hearth, readable as a leather wedge with a nozzle.
    bx = x + w / 2 + .32
    plate(c, 'Leather forge bellows', (bx, y + .05, .42), [(-.18, -.32), (.18, -.32), (.24, .22), (0, .36), (-.24, .22)], .16, p['tar'], .04)
    tube(c, 'Bellows nozzle', [(bx, y + .4, .45), (bx - .15, y + .55, .6), (x + w / 2 - .02, y + .1, .7)], .03, p['iron'], 8)


def workshop(c, p, variant):
    s = {}
    if variant == 'a':
        # Rear hall with corrugated gable roof, chimney through the north slope and a skylight.
        flagstones(c, -2.45, -1.95, 2.45, -.35, p, 3)
        for a, b in [((-2.45, -.4), (2.45, -.4)), ((-2.45, -.4), (-2.45, 1.95)), ((2.45, -.4), (2.45, 1.95)), ((-2.45, 1.95), (2.45, 1.95))]:
            plank_wall(c, a, b, .3, 2.15, p['oak'], p['tar'], seed=int(a[0] * 10 + b[1]))
            stone_course(c, a, b, 0, .32, p, int(abs(a[0] + b[1]) * 7))
        gable_roof(c, -2.4, -.4, 2.4, 1.95, 2.2, 3.15, [p['rust'], p['rust2'], p['rust'], p['rust2'], p['tin']], 'corrugated', 11)
        chimney(c, -1.65, 1.25, 1.6, 3.95, p, .66, .66, 5)
        skylight(c, .95, .25, 2.82, .7, .55, .55, p)
        hearth(c, -1.7, -1.15, 1.0, .8, p, 9)
        anvil(c, -.25, -1.2, p, .15)
        # Quench trough, grindstone and a stocked tool wall on the hall front.
        slab(c, 'Quench trough body', .75, -1.85, 1.45, -1.35, 0, .55, p['oak'], .05)
        slab(c, 'Quench water', .82, -1.78, 1.38, -1.42, .5, .56, p['water'], .02)
        for x in (.9, 1.3): slab(c, 'Trough iron band', x - .02, -1.87, x + .02, -1.33, .5, .58, p['rust'], .005)
        for y in (-1.25, -.75): slab(c, 'Grindstone trestle', 1.75, y - .05, 2.3, y + .05, 0, .5, p['oak'], .015)
        wheel = c.cylinder('Upright grindstone', (2.02, -1.0, .55), .3, .12, p['stone'], 40); wheel.rotation_euler.x = math.pi / 2
        tube(c, 'Grindstone crank', [(2.02, -1.32, .55), (2.02, -1.42, .55), (2.18, -1.42, .45)], .025, p['iron'], 8)
        slab(c, 'Tool wall board', .55, -.52, 2.3, -.4, .9, 1.8, p['tar'], .02)
        hammer(c, .8, -.6, 1.4, p, 1.57); tongs(c, 1.35, -.62, 1.35, p); hammer(c, 1.85, -.6, 1.45, p, 1.6)
        for k in range(6):
            beam(c, 'Racked bar stock', (-1.0 + k * .07, -.55), (-1.0 + k * .07 + .02, -1.35), .035, .3 + k * .01, p['iron'])
        sack(c, -2.15, -.75, 0, p, True); sack(c, -2.2, -1.75, 0, p, True); barrel(c, 2.2, -1.75, 0, .2, p)
        lamp_post(c, 2.38, -1.88, 2.1, p, (-.3, .0))
        scraps(c, [(.2, -1.7), (.35, -1.85), (-.75, -1.75), (.55, -1.0)], p)
        s.update(staff=(.38, -1.1, 0), staff_facing=(-.25, -1.2, 0), plaque=(0, -2.25, 0), forge=(-1.7, -1.15, .8),
                 chimney=(-1.65, 1.25, 4.0), spark_anvil=(-.25, -1.2, 1.0), spark_grind=(2.02, -1.0, .85),
                 lamp_front=(2.08, -1.88, 1.85), window_skylight=(.95, .25, 2.9))
    else:
        # Massive stone forge with tall stack under a shingled lean-to; small closed tool shed east.
        slab(c, 'Forge masonry mass', -2.45, .35, -1.15, 1.95, 0, 1.1, p['mortar'], .05)
        for a, b in [((-2.45, .35), (-1.15, .35)), ((-1.15, .35), (-1.15, 1.95)), ((-2.45, .35), (-2.45, 1.95))]:
            stone_course(c, a, b, 0, .55, p, 3); stone_course(c, a, b, .55, .55, p, 4)
        chimney(c, -1.85, 1.35, 1.1, 4.1, p, .8, .8, 7)
        slab(c, 'Forge mouth hearth', -2.2, .4, -1.4, .9, 1.05, 1.12, p['coal'], .02)
        for i in range(10):
            c.ell('Living forge ember', (-2.05 + (i % 5) * .15, .5 + (i // 5) * .18, 1.13), (.04, .03, .015), p['ember'])
        for x in (-1.05, .65, 2.4):
            for y in (.35, 1.95): post(c, x, y, 2.8 if y > 1 else 2.1, p)
        shed_roof(c, -1.15, .3, 2.45, 1.95, 2.75, 2.1, [p['shingle'], p['shingle'], p['shingle'], p['oak']], 'shingle', 4, .25, 'south')
        # Tool shed with its own rusty pitch.
        for a, b in [((1.45, -1.95), (2.45, -1.95)), ((1.45, -1.95), (1.45, -.15)), ((2.45, -1.95), (2.45, -.15)), ((1.45, -.15), (2.45, -.15))]:
            plank_wall(c, a, b, 0, 1.9, p['tar'], p['oak'], seed=17)
        shed_roof(c, 1.45, -1.95, 2.45, -.15, 2.25, 1.85, [p['rust2'], p['rust'], p['tin']], 'corrugated', 6, .15, 'south')
        flagstones(c, -2.45, -1.95, 1.4, .3, p, 8)
        anvil(c, -.55, -.95, p, -.2)
        barrel(c, -1.85, -1.45, 0, .26, p, open_top=True)
        c.cylinder('Quench water surface', (-1.85, -1.45, .5), .21, .02, p['water'], 24)
        for k in range(5):
            beam(c, 'Racked bar stock', (-.2 + k * .2, .1), (-.15 + k * .2, -.45), .04, .55 + k * .01, p['iron'])
        crate(c, .8, -1.6, 0, p, 1.3); sack(c, -2.2, -.55, 0, p, True); rope(c, .75, -.6, .02, .2, p)
        lamp_post(c, 1.3, -1.9, 2.0, p, (-.3, .1))
        scraps(c, [(-1.2, -1.7), (-.95, -1.8), (.2, -1.5), (.35, -1.3)], p)
        s.update(staff=(.05, -1.1, 0), staff_facing=(-.55, -.95, 0), plaque=(0, -2.25, 0), forge=(-1.8, .65, 1.15),
                 chimney=(-1.85, 1.35, 4.2), spark_anvil=(-.55, -.95, 1.0), lamp_front=(1.0, -1.8, 1.75))
    return s


def jib_crane(c, x, y, h, reach, p, angle=0):
    c.cylinder('Crane mast', (x, y, h / 2), .12, h, p['iron'], 16)
    for k in range(4):
        a = k * math.pi / 2 + .4
        tube(c, 'Crane mast stay', [(x, y, h * .45), (x + .55 * math.cos(a), y + .55 * math.sin(a), .02)], .03, p['dark'], 6)
    ex, ey = x + reach * math.cos(angle), y + reach * math.sin(angle)
    beam(c, 'Crane jib beam', (x - .35 * math.cos(angle), y - .35 * math.sin(angle)), (ex, ey), .16, h, p['ochre'])
    tube(c, 'Jib tie rod', [(x, y, h + .5), (ex, ey, h + .05)], .02, p['dark'], 6)
    c.cylinder('Mast top', (x, y, h + .25), .09, .5, p['iron'], 12)
    c.box('Counterweight', (x - .45 * math.cos(angle), y - .45 * math.sin(angle), h - .05), (.36, .36, .3), p['concrete'], .03)
    hx, hy = x + reach * .75 * math.cos(angle), y + reach * .75 * math.sin(angle)
    c.box('Trolley', (hx, hy, h - .1), (.22, .2, .1), p['dark'], .01)
    tube(c, 'Hoist chain', [(hx, hy, h - .1), (hx, hy, .9)], .018, p['iron'], 6)
    tube(c, 'Lifting hook', [(hx, hy, .9), (hx + .08, hy, .8), (hx + .04, hy - .06, .74), (hx - .04, hy - .02, .78)], .03, p['iron'], 8)
    return hx, hy


def beacon_light(c, x, y, z, p):
    c.cylinder('Beacon base', (x, y, z), .11, .08, p['dark'], 16)
    c.cylinder('Separate beacon amber dome', (x, y, z + .1), .085, .14, p['beacon'], 16)
    c.ell('Separate beacon amber dome cap', (x, y, z + .17), (.085, .085, .05), p['beacon'])


def drafting_table(c, x0, y0, x1, y1, h, p):
    for x in (x0 + .08, x1 - .08):
        for y in (y0 + .08, y1 - .08): post(c, x, y, h - .05, p, .04)
    slab(c, 'Drafting table top', x0, y0, x1, y1, h - .06, h, p['timber'], .015)
    plate(c, 'Unlettered building plan', ((x0 + x1) / 2, (y0 + y1) / 2, h + .006),
          [(-(x1 - x0) * .42, -(y1 - y0) * .4), ((x1 - x0) * .4, -(y1 - y0) * .42), ((x1 - x0) * .43, (y1 - y0) * .38), (-(x1 - x0) * .4, (y1 - y0) * .41)], .01, p['paper'], .003)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for a, b in [((-.3, -.2), (.25, -.2)), ((-.3, -.2), (-.3, .18)), ((.25, -.2), (.25, .18)), ((-.3, .18), (-.02, .3)), ((-.02, .3), (.25, .18))]:
        tube(c, 'Inked plan line', [(cx + a[0], cy + a[1], h + .014), (cx + b[0], cy + b[1], h + .014)], .006, p['dark'], 4)
    roll = c.cylinder('Rolled spare plan', (x1 - .12, cy, h + .05), .05, (y1 - y0) * .8, p['paper'], 16); roll.rotation_euler.x = math.pi / 2


def sawhorse(c, x, y, p, angle=0):
    ca, sa = math.cos(angle), math.sin(angle)
    for u in (-.3, .3):
        for v in (-.18, .18):
            strut(c, 'Sawhorse leg', (x + ca * u, y + sa * u, .62), (x + ca * u - sa * v, y + sa * u + ca * v, 0), .05, .05, p['oak'])
    strut(c, 'Sawhorse beam', (x - ca * .4, y - sa * .4, .64), (x + ca * .4, y + sa * .4, .64), .09, .08, p['timber'])


def roof_slope_rafters(c, x0, x1, y_eave, y_ridge, z_eave, z_ridge, p, spacing=.55, boards_to=None):
    """Open rafters; optional sheathing boards laid over the first bays as work in progress."""
    x = x0
    while x <= x1 + 1e-6:
        strut(c, 'Open roof rafter', (x, y_eave, z_eave), (x, y_ridge, z_ridge), .08, .14, p['cut'])
        x += spacing
    if boards_to:
        length = math.hypot(y_ridge - y_eave, z_ridge - z_eave)
        n = int(length / .2)
        for k in range(n):
            t = (k + .5) / n
            y = y_eave + (y_ridge - y_eave) * t; z = z_eave + (z_ridge - z_eave) * t + .1
            strut(c, 'Roof sheathing board', (x0 - .05, y, z), (boards_to, y, z), .17, .025, p['timber'] if k % 3 else p['oak'], .006)


def yard_frame(c, p):
    """Bauhof C: timber-frame building under construction with scaffold, hoist and plan table."""
    X0, X1, Y0, Y1 = -2.35, .95, -.2, 1.9
    for a, b in [((X0, Y0), (X1, Y0)), ((X1, Y0), (X1, Y1)), ((X0, Y1), (X1, Y1)), ((X0, Y0), (X0, Y1))]:
        stone_course(c, a, b, 0, .26, p, int(a[0] * 7 + b[1] * 3) & 63, .34, .32)
        strut(c, 'Oak sill beam', (a[0], a[1], .32), (b[0], b[1], .32), .16, .14, p['oak'])
    x = X0 + .2
    while x < X1 - .1:
        strut(c, 'Floor joist', (x, Y0, .42), (x, Y1, .42), .1, .12, p['cut'])
        x += .45
    for k in range(int((Y1 - Y0) / .2)):
        y = Y0 + .1 + k * .2
        if k % 5 == 3: continue
        strut(c, 'Laid floor board', (X0, y, .5), (-.55 + .25 * math.sin(k * 1.7), y, .5), .18, .03, p['timber'] if k % 3 else p['oak'], .006)
    posts = [(X0 + i * (X1 - X0) / 3, y) for i in range(4) for y in (Y0, Y1)] + [(X0, (Y0 + Y1) / 2), (X1, (Y0 + Y1) / 2)]
    for px, py in posts: post(c, px, py, 2.55, p, .08)
    for a, b in [((X0, Y0), (X1, Y0)), ((X0, Y1), (X1, Y1)), ((X0, Y0), (X0, Y1)), ((X1, Y0), (X1, Y1))]:
        strut(c, 'Wall top plate', (a[0], a[1], 2.6), (b[0], b[1], 2.6), .14, .14, p['oak'])
    for a, b in [((X0, Y0 + .1), (X0 + .8, Y0 + .1)), ((X1 - .8, Y1 - .1), (X1, Y1 - .1))]:
        strut(c, 'Wall knee brace', (a[0], a[1], .5), (b[0], b[1], 2.4), .08, .08, p['cut'])
    ym = (Y0 + Y1) / 2
    for x in (X0, X1): strut(c, 'King post', (x, ym, 2.6), (x, ym, 3.55), .12, .12, p['oak'])
    strut(c, 'Ridge beam', (X0 - .1, ym, 3.6), (X1 + .1, ym, 3.6), .14, .16, p['oak'])
    roof_slope_rafters(c, X0, X1, Y0 - .15, ym, 2.55, 3.6, p, .55, boards_to=X0 + 1.25)
    roof_slope_rafters(c, X0, X1, Y1 + .15, ym, 2.55, 3.6, p, .55, boards_to=X0 + .7)
    # Scaffold on the east wall: standards, ledgers and a plank deck read as a walkway strip.
    for sx in (1.15, 1.6):
        for sy in (Y0, ym, Y1):
            c.cylinder('Scaffold standard', (sx, sy, 1.15), .03, 2.3, p['iron'], 8)
        strut(c, 'Scaffold ledger', (sx, Y0, 1.55), (sx, Y1, 1.55), .04, .04, p['iron'])
    for k in range(3):
        strut(c, 'Scaffold plank', (1.2 + k * .17, Y0 - .1, 1.62), (1.2 + k * .17, Y1 + .1, 1.62), .16, .04, p['timber'] if k != 1 else p['oak'], .006)
    for sy in (Y0, Y1): strut(c, 'Scaffold diagonal', (1.15, sy, .05), (1.6, sy, 2.2), .03, .03, p['iron'])
    beacon_light(c, 1.6, Y0, 2.32, p)
    # Tripod hoist lifting a beam onto the frame.
    apex = (2.05, 1.35, 2.9)
    for gx, gy in [(1.75, 1.85), (2.45, 1.75), (2.15, .85)]: strut(c, 'Hoist tripod leg', (gx, gy, 0), apex, .07, .07, p['oak'])
    c.box('Hoist pulley block', (apex[0], apex[1], apex[2] - .2), (.14, .12, .22), p['dark'], .02)
    tube(c, 'Hoist rope', [(apex[0], apex[1], apex[2] - .3), (apex[0], apex[1], 1.25)], .016, p['rope'], 6)
    strut(c, 'Hoisted squared beam', (1.6, 1.35, 1.2), (2.45, 1.35, 1.2), .16, .16, p['cut'])
    # Front work yard.
    drafting_table(c, -.8, -1.65, .4, -1.05, .95, p)
    lamp_post(c, .55, -1.05, 2.0, p, (-.3, -.25))
    sawhorse(c, -1.95, -1.25, p, math.pi / 2); sawhorse(c, -1.4, -1.25, p, math.pi / 2)
    strut(c, 'Plank on sawhorses', (-2.15, -1.25, .72), (-1.15, -1.25, .72), .26, .05, p['timber'])
    timber_stack(c, 1.55, -1.3, 1.5, 3, 3, p, 0, .17, 12)
    wheelbarrow(c, .85, -.62, .4, p)
    sack_stack(c, 2.05, .25, p, 4, 13)
    return dict(staff=(-.2, -.62, 0), staff_facing=(-.2, -1.35, 0), plaque=(0, -2.25, 0), beacon=(1.6, Y0, 2.5),
                spark_saw=(-1.6, -1.25, .8), lamp_table=(.25, -1.3, 1.75), hoist=apex)


def yard_crane(c, p):
    """Bauhof D: tower crane with lattice jib over a site container and material yard."""
    # Site container: ribbed walls and a ribbed roof read as a container from above.
    cx0, cx1, cy0, cy1, h = -2.4, .55, .75, 1.95, 2.45
    slab(c, 'Container body', cx0, cy0, cx1, cy1, .1, h, p['container'], .03)
    for k in range(int((cx1 - cx0) / .28)):
        x = cx0 + .14 + k * .28
        slab(c, 'Container roof corrugation', x - .05, cy0 + .05, x + .05, cy1 - .05, h, h + .04, p['container'], .01)
        for y in (cy0 - .02, cy1 + .02): slab(c, 'Container wall rib', x - .04, y - .02, x + .04, y + .02, .15, h - .05, p['container'], .008)
    for x in (cx0, cx1):
        for y in (cy0, cy1): slab(c, 'Container corner casting', x - .08, y - .08, x + .08, y + .08, .05, h + .06, p['dark'], .01)
    slab(c, 'Container door frame', -.55, cy0 - .06, .3, cy0, .15, 2.1, p['dark'], .01)
    c.box('Container roof vent', (-1.6, 1.35, h + .12), (.35, .3, .2), p['iron'], .02)
    beacon_light(c, .35, 1.8, h + .08, p)
    c.box('Container floodlight', (-.15, cy0 + .05, h + .08), (.22, .14, .12), p['dark'], .02)
    # Tower crane: ballast, lattice mast, cat head, jib to the south-west, counterjib with blocks.
    mx, my, top = 1.75, 1.3, 4.0
    for k in range(4):
        slab(c, 'Crane ballast block', mx - .5 + (k % 2) * .5, my - .5 + (k // 2) * .5, mx + (k % 2) * .5, my + (k // 2) * .5, 0, .35, p['concrete'], .03)
    m = .24
    corners = [(mx - m, my - m), (mx + m, my - m), (mx + m, my + m), (mx - m, my + m)]
    for x, y in corners: strut(c, 'Mast corner chord', (x, y, .35), (x, y, top), .06, .06, p['ochre'])
    z = .35
    while z < top - .2:
        for i in range(4):
            a, b = corners[i], corners[(i + 1) % 4]
            strut(c, 'Mast lattice diagonal', (a[0], a[1], z), (b[0], b[1], z + .45), .03, .03, p['ochre'])
        z += .45
    c.cylinder('Slewing ring', (mx, my, top + .08), .33, .14, p['dark'], 24)
    c.box('Crane operator cab', (mx + .3, my - .32, top + .1), (.4, .36, .4), p['ochre'], .03)
    c.box('Separate window glow cab glass', (mx + .3, my - .5, top + .15), (.34, .03, .2), p['window'], .005)
    angle = math.atan2(-1.55 - my, -2.15 - mx)
    tip = (mx + 4.4 * math.cos(angle), my + 4.4 * math.sin(angle), top + .25)
    lattice_jib(c, (mx, my, top + .25), tip, .32, .42, p, p['ochre'], 11)
    back = (mx - 1.15 * math.cos(angle), my - 1.15 * math.sin(angle), top + .25)
    strut(c, 'Counterjib', (mx, my, top + .3), back, .28, .1, p['ochre'])
    for k in range(2):
        t = .55 + k * .25
        c.box('Counterweight slab', (mx - 1.15 * t * math.cos(angle), my - 1.15 * t * math.sin(angle), top + .2), (.3, .42, .38), p['concrete'], .03)
    strut(c, 'Cat head', (mx, my, top + .3), (mx, my, top + 1.05), .1, .1, p['ochre'])
    tube(c, 'Jib pendant bar', [(mx, my, top + 1.05), (tip[0] * .55 + mx * .45, tip[1] * .55 + my * .45, top + .65)], .015, p['dark'], 4)
    tube(c, 'Counterjib pendant', [(mx, my, top + 1.05), back], .015, p['dark'], 4)
    tx, ty = mx + 3.0 * math.cos(angle), my + 3.0 * math.sin(angle)
    c.box('Jib trolley', (tx, ty, top + .2), (.24, .3, .1), p['dark'], .01)
    tube(c, 'Hoist cable', [(tx, ty, top + .15), (tx, ty, 1.5)], .012, p['iron'], 4)
    c.box('Hook block', (tx, ty, 1.45), (.14, .1, .18), p['ochre'], .01)
    for k in range(3):
        strut(c, 'Slung beam bundle', (tx - .6, ty + (k - 1) * .13, 1.05 + (k % 2) * .1), (tx + .6, ty + (k - 1) * .13, 1.05 + (k % 2) * .1), .12, .12, p['cut'])
    # Material yard.
    c.ell('Builder sand heap', (-1.85, -1.3, .05), (.62, .5, .38), p['sand'])
    strut(c, 'Shovel in sand', (-1.6, -1.15, .35), (-1.2, -.9, .7), .04, .04, p['oak'])
    for k in range(9):
        strut(c, 'Rebar length', (-.95, -1.72 + k * .035, .06 + (k % 3) * .03), (.65, -1.7 + k * .035, .06 + (k % 3) * .03), .022, .022, p['rust'])
    for i in range(2):
        pallet(c, 1.25 + i * 1.0, -1.35, p, .9, .75)
        for r in range(3):
            for k in range(4):
                c.box('Stacked brick', (1.25 + i * 1.0 - .3 + k * .2, -1.35 + (r - 1) * .22, .2 + r * .1 * 0 + .08 * (k % 2) * 0 + .1), (.19, .1, .07), p['brick'], .006)
    wheelbarrow(c, .5, -.65, -.6, p)
    for x in (-1.6, -.65): post(c, x, .3, .85, p, .04)
    slab(c, 'Plan board', -1.75, .12, -.5, .5, .85, .9, p['timber'], .01)
    plate(c, 'Pinned building plan', (-1.12, .31, .91), [(-.5, -.14), (.5, -.15), (.52, .14), (-.5, .15)], .008, p['paper'], .003)
    return dict(staff=(-1.12, -.15, 0), staff_facing=(-1.12, .4, 0), plaque=(0, -2.25, 0), beacon=(.35, 1.8, h + .25),
                hook=(tx, ty, 1.45), floodlight=(-.15, cy0 - .2, h), spark_cut=(-.1, -1.6, .2), cab=(mx + .3, my - .5, top + .15))


def yard(c, p, variant):
    s = {}
    if variant == 'c': return yard_frame(c, p)
    if variant == 'd': return yard_crane(c, p)
    if variant == 'a':
        # Site hut, plan table, jib crane and material stacks behind a low timber curb.
        for a, b in [((-2.45, -1.95), (-2.45, 1.95)), ((2.45, -1.95), (2.45, .25)), ((-2.45, -1.95), (-.5, -1.95)), ((.6, -1.95), (2.45, -1.95)), ((-2.45, 1.95), (.85, 1.95))]:
            beam(c, 'Low perimeter curb timber', a, b, .16, .1, p['oak'])
            for t in (0, .5, 1):
                x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                post(c, x, y, .45, p, .06)
        for a, b in [((.9, .3), (2.45, .3)), ((.9, .3), (.9, 1.95)), ((2.45, .3), (2.45, 1.95)), ((.9, 1.95), (2.45, 1.95))]:
            plank_wall(c, a, b, 0, 2.1, p['tar'], p['oak'], seed=5)
        shed_roof(c, .9, .3, 2.45, 1.95, 2.6, 2.15, [p['tin'], p['tin'], p['rust2']], 'corrugated', 21, .18, 'south')
        beacon_light(c, 2.05, 1.6, 2.72, p)
        timber_stack(c, -1.45, 1.35, 1.8, 3, 4, p, 0, .17, 2)
        drafting_table(c, -.45, .5, .65, 1.25, .95, p)
        lamp_post(c, .78, 1.45, 2.0, p, (-.25, -.35))
        hx, hy = jib_crane(c, -2.0, -1.4, 3.1, 1.9, p, .05)
        stone_blocks(c, hx - .3, hy - .35, p, 4, 3)
        sack_stack(c, 1.2, -1.25, p, 5, 4)
        for i, (x, y) in enumerate([(2.15, -.2), (2.15, -.55), (1.85, -.35)]): gas_bottle(c, x, y, p, .12, .95, p['ochre'] if i != 1 else p['olive'])
        for k in range(3): c.box('Steel I-beam', (.2, -.9 + k * .22, .1 + (k % 2) * .02), (1.6, .14, .14), p['rust'], .01).rotation_euler.z = .04 * k
        duckboards(c, -.2, -.7, .55, .3, p, 9)
        scraps(c, [(-.9, -.6), (-.7, -.75), (.9, -.2), (1.0, .05)], p)
        s.update(staff=(.1, -.05, 0), staff_facing=(.1, .9, 0), plaque=(0, -2.25, 0), beacon=(2.05, 1.6, 2.9),
                 spark_weld=(.6, -.85, .35), window_hut=(1.6, .25, 1.2), lamp_table=(.53, 1.1, 1.7))
    else:
        # Open pole barn on the north half, A-frame gantry hoist and a cement mixer in the yard.
        for x in (-2.4, -1.0, .5):
            for y in (-.15, 1.9): post(c, x, y, 2.5, p, .1)
        for y in (-.15, 1.9): beam(c, 'Barn eave beam', (-2.5, y), (.6, y), .18, 2.45, p['oak'])
        gable_roof(c, -2.4, -.15, .5, 1.9, 2.4, 3.1, [p['tin'], p['rust2'], p['tin']], 'corrugated', 13, .2)
        timber_stack(c, -1.8, 1.0, 1.4, 4, 4, p, 0, .17, 6)
        for x in (.95, 2.4):
            tube(c, 'Gantry A-frame leg', [(x, -1.95, 0), (x, -1.4, 2.8)], .06, p['ochre'], 8)
            tube(c, 'Gantry A-frame leg', [(x, -.85, 0), (x, -1.4, 2.8)], .06, p['ochre'], 8)
            beam(c, 'A-frame spreader', (x, -1.8), (x, -1.0), .06, .9, p['ochre'])
        beam(c, 'Gantry I-beam', (.8, -1.4), (2.55, -1.4), .16, 2.85, p['rust'])
        c.box('Chain hoist block', (1.7, -1.4, 2.6), (.22, .2, .3), p['dark'], .02)
        tube(c, 'Hoist chain', [(1.7, -1.4, 2.45), (1.7, -1.4, .75)], .018, p['iron'], 6)
        stone_blocks(c, 1.45, -1.55, p, 4, 8)
        beacon_light(c, 2.55, -1.4, 2.95, p)
        # Cement mixer: tilted drum on a wheeled frame.
        drum = c.cylinder('Mixer drum', (-1.6, -1.25, .75), .38, .7, p['ochre'], 24); drum.rotation_euler = (.55, 0, .6)
        c.cylinder('Mixer drum mouth', (-1.45, -1.45, 1.05), .2, .08, p['dark'], 20).rotation_euler = (.55, 0, .6)
        c.box('Mixer frame', (-1.6, -1.25, .3), (.9, .6, .12), p['dark'], .02)
        for dx in (-.4, .4):
            wheel = annulus(c, 'Mixer wheel', (0, 0, 0), .22, .1, .08, p['rubber'], steps=20)
            wheel.location = (-1.6 + dx, -1.6, .25); wheel.rotation_euler.x = math.pi / 2
        sack_stack(c, -.55, -1.45, p, 4, 10)
        drafting_table(c, -.9, -.05, .2, .55, .95, p)
        for i, (x, y) in enumerate([(2.2, .5), (2.2, .2), (1.9, .35)]): gas_bottle(c, x, y, p, .12, .95, p['olive'] if i else p['ochre'])
        crate(c, 1.3, 1.4, 0, p, 1.4); crate(c, 1.95, 1.55, 0, p, 1.2); barrel(c, 1.1, .8, 0, .22, p)
        scraps(c, [(.3, -.8), (.5, -.65), (-.2, -.6)], p)
        s.update(staff=(.75, -.45, 0), staff_facing=(1.7, -1.4, 0), plaque=(0, -2.25, 0), beacon=(2.55, -1.4, 3.1),
                 spark_weld=(1.7, -1.4, .7), lamp_table=(-.35, .25, 1.6))
    return s


def ammo_crates(c, x, y, p, rows=2, cols=2, seed=0):
    rng = random.Random(seed)
    for r in range(rows):
        for k in range(cols):
            bx, by, z = x + k * .58, y, .18 + r * .32
            if r and rng.random() < .3: continue
            c.box('Olive ammunition crate', (bx + rng.uniform(-.03, .03), by + rng.uniform(-.03, .03), z), (.54, .36, .3), p['olive'], .025)
            c.box('Crate lid handle', (bx, by, z + .16), (.2, .05, .03), p['dark'], .01)
            for side in (-1, 1): c.box('Crate latch', (bx + side * .2, by - .17, z + .12), (.06, .03, .06), p['brass'], .006)


def rifle_rack(c, x0, x1, y, p, n=5):
    beam(c, 'Rifle rack rail', (x0, y), (x1, y), .08, 1.0, p['oak'])
    for k in range(n):
        x = x0 + (k + .5) * (x1 - x0) / n
        beam(c, 'Racked rifle stock', (x, y - .05), (x, y - .45), .06, .95, p['wood'])
        beam(c, 'Racked rifle barrel', (x, y - .45), (x, y - .95), .03, .97, p['dark'])


def armor_stand(c, x, y, p, rust=False):
    post(c, x, y, .9, p, .04)
    strut(c, 'Armor stand crossbar', (x - .24, y, .95), (x + .24, y, .95), .06, .06, p['cut'])
    plate(c, 'Armor shoulder plates', (x, y - .02, 1.0), [(-.26, -.1), (-.2, .12), (.2, .12), (.26, -.1), (.1, -.18), (-.1, -.18)], .08, p['iron'], .02)
    c.ell('Steel helmet', (x, y + .02, 1.12), (.16, .18, .12), p['rust'] if rust else p['olive'])
    tube(c, 'Helmet rim', [(x - .17, y + .02, 1.07), (x, y + .21, 1.07), (x + .17, y + .02, 1.07)], .015, p['dark'], 6)


def armory_net(c, p):
    """Ausrüstung C: issue stand under a camouflage net, open counter in front (stall layout)."""
    for x in (-2.3, -.75, .75, 2.3):
        post(c, x, .15, 2.25, p, .07); post(c, x, 1.9, 2.55, p, .07)
    # Readable through the net: rifle racks, armor stands, ammunition and a gun bench.
    rifle_rack(c, -2.15, -.45, 1.85, p, 6)
    for i, x in enumerate((.35, .95, 1.55)): armor_stand(c, x, 1.45, p, rust=i == 1)
    ammo_crates(c, .9, .5, p, 2, 2, 11)
    slab(c, 'Gun bench top', -2.15, .35, -.75, .85, .82, .9, p['timber'], .015)
    for x in (-2.05, -.85):
        for y in (.42, .78): post(c, x, y, .82, p, .035)
    strut(c, 'Stripped rifle receiver', (-1.85, .6, .95), (-1.3, .63, .95), .07, .06, p['dark'])
    strut(c, 'Stripped rifle barrel', (-1.3, .63, .94), (-.95, .66, .94), .03, .03, p['iron'])
    c.cylinder('Gun oil can', (-1.0, .45, .99), .05, .14, p['brass'], 12)
    camo_net(c, -2.45, .05, 2.45, 2.0, 2.6, 2.25, p, 5, .62)
    lantern(c, 0, 1.0, 1.9, p)
    tube(c, 'Lantern hanger', [(0, 1.0, 2.1), (0, 1.0, 2.42)], .01, p['dark'], 4)
    # Front counter: the quartermaster stands between counter and net, open to the sky.
    counter(c, -1.7, -.95, 1.7, -.5, 1.0, p)
    c.box('Issue ledger', (.35, -.72, 1.03), (.34, .25, .05), p['tar'], .01)
    c.box('Rubber stamp', (-.05, -.7, 1.05), (.07, .07, .09), p['brass'], .01)
    strut(c, 'Rifle laid on counter', (-1.45, -.75, 1.05), (-.55, -.68, 1.05), .07, .05, p['wood'])
    strut(c, 'Rifle barrel on counter', (-.55, -.68, 1.05), (-.2, -.66, 1.05), .03, .03, p['dark'])
    c.box('Ammunition tin on counter', (1.15, -.72, 1.1), (.3, .18, .16), p['olive'], .015)
    for sx in (-1, 1):
        for k in range(4):
            c.ell('Corner sandbag', (sx * (2.2 - (k % 2) * .05), -1.75 + k * .3, .12 + (k // 2) * .17), (.17, .24, .1), p['burlap'])
        for k in range(3):
            c.ell('Corner sandbag', (sx * (1.95 - k * .35), -1.85, .12), (.2, .15, .1), p['burlap'])
    ammo_crates(c, -1.6, -1.45, p, 2, 1, 12)
    c.cylinder('Oil drum', (1.45, -1.5, .45), .27, .9, p['olive'], 24)
    annulus(c, 'Drum rolling hoop', (1.45, -1.5, .6), .28, .26, .04, p['dark'], steps=24)
    lamp_post(c, -2.35, -.35, 2.1, p, (.3, 0))
    return dict(staff=(0, -.15, 0), staff_facing=(0, -1.0, 0), plaque=(0, -2.25, 0), lamp_net=(0, 1.0, 2.0),
                lamp_front=(-2.05, -.35, 1.85), glint_counter=(.35, -.72, 1.05))


def armory(c, p, variant):
    s = {}
    if variant == 'c': return armory_net(c, p)
    if variant == 'a':
        # Stone-plinth armory under a sheet-steel hip roof; open issue niche with counter at the front.
        for a, b in [((-2.45, -1.0), (-.85, -1.0)), ((.85, -1.0), (2.45, -1.0)), ((-2.45, -1.0), (-2.45, 1.95)), ((2.45, -1.0), (2.45, 1.95)), ((-2.45, 1.95), (2.45, 1.95))]:
            stone_course(c, a, b, 0, .6, p, int(a[0] * 3 + 11)); plank_wall(c, a, b, .6, 2.35, p['tar'], p['oak'], seed=3)
        hip_roof(c, -2.45, -1.0, 2.45, 1.95, 2.35, 3.35, [p['tin'], p['rust'], p['iron']], 7, .22)
        for x, y in [(-1.2, .55), (1.25, .55)]:
            c.cylinder('Roof vent stack', (x, y, 3.0), .16, .5, p['iron'], 16)
            c.ell('Turbine vent head', (x, y, 3.3), (.24, .24, .16), p['tin'])
            for k in range(10):
                a = k * math.tau / 10
                tube(c, 'Turbine vane', [(x + .1 * math.cos(a), y + .1 * math.sin(a), 3.42), (x + .23 * math.cos(a + .5), y + .23 * math.sin(a + .5), 3.32)], .012, p['dark'], 4)
        # The issue niche is open to the sky so the quartermaster stays visible.
        for x in (-.85, .85):
            stone_course(c, (x, -1.0), (x, -1.95), 0, .5, p, 9 if x < 0 else 10, .3, .3)
            slab(c, 'Niche wall cap', x - .16, -1.95, x + .16, -1.0, .5, .6, p['stone'], .02)
        flagstones(c, -.7, -1.85, .7, -1.0, p, 12, .32)
        counter(c, -.75, -2.0, .75, -1.65, 1.0, p)
        c.box('Issue ledger', (.25, -1.82, 1.03), (.32, .24, .05), p['tar'], .01)
        c.box('Rubber stamp', (-.2, -1.8, 1.05), (.07, .07, .09), p['brass'], .01)
        for side in (-1, 1):
            shutter = c.box('Folded open niche shutter', (side * 1.2, -1.85, 1.0), (.62, .07, 1.2), p['olive'], .015)
            shutter.rotation_euler.x = math.pi / 2 - .15
        ammo_crates(c, -2.35, -1.55, p, 2, 2, 4)
        for i, (x, y) in enumerate([(1.35, -1.45), (1.8, -1.6), (2.25, -1.4)]):
            c.cylinder('Oil drum', (x, y, .45), .27, .9, p['olive'] if i % 2 else p['rust'], 24)
            annulus(c, 'Drum rolling hoop', (x, y, .6), .28, .26, .04, p['dark'], steps=24)
            c.cylinder('Drum bung', (x + .12, y + .05, .91), .04, .02, p['brass'], 8)
        lamp_post(c, -.95, -2.0, 2.1, p, (.3, .1))
        s.update(staff=(0, -1.25, 0), staff_facing=(0, -2.2, 0), plaque=(0, -2.3, 0), window_west=(-2.6, .5, 1.3),
                 window_east=(2.6, .5, 1.3), lamp_front=(-.65, -1.9, 1.85), glint_counter=(.25, -1.82, 1.05))
    else:
        # Concrete field bunker under sandbags and a camouflage tarp, issue booth walled with sandbags.
        slab(c, 'Bunker concrete shell', -2.3, -.75, 2.3, 1.95, 0, 2.15, p['concrete'], .06)
        slab(c, 'Roof parapet south', -2.35, -.8, 2.35, -.6, 2.1, 2.35, p['concrete'], .03)
        slab(c, 'Roof parapet north', -2.35, 1.8, 2.35, 2.0, 2.1, 2.35, p['concrete'], .03)
        rng = random.Random(4)
        for row in range(6):
            y = -.45 + row * .38
            for k in range(9):
                x = -2.05 + k * .5 + (row % 2) * .25
                if x > 2.1: continue
                c.ell('Roof sandbag', (x + rng.uniform(-.03, .03), y, 2.27 + rng.uniform(0, .03)), (.25, .17, .1), p['burlap'])
        tarp = grid_surface(c, 'Camouflage tarp', (-2.4, .55, 2.5), (1, 0, 0), (0, 1, 0), (0, 0, 1), 2.6, 1.5,
                            lambda s, t: .12 * math.sin(s * 2.7 + 1) * math.sin(t * 2.2) - .05 * (s / 2.6), p['olive'], 36, 18, .015)
        c.cylinder('Antenna mast', (1.85, 1.45, 3.1), .03, 2.0, p['iron'], 8)
        c.box('Radio set crate', (1.6, 1.35, 2.5), (.45, .3, .25), p['olive'], .02)
        c.cylinder('Vent pipe', (-.2, 1.35, 2.6), .1, .8, p['rust'], 12)
        c.ell('Mushroom vent cap', (-.2, 1.35, 3.02), (.2, .2, .07), p['dark'])
        slab(c, 'Roof hatch', .6, .35, 1.2, .85, 2.35, 2.42, p['iron'], .02)
        # Sandbag booth in front of the issue window.
        for x0, y0, x1, y1 in [(-1.15, -1.95, -1.15, -.8), (1.15, -1.95, 1.15, -.8)]:
            for layer in range(3):
                for k in range(3):
                    c.ell('Booth wall sandbag', (x0, -1.75 + k * .4 + (layer % 2) * .1, .12 + layer * .18), (.17, .24, .1), p['burlap'])
        counter(c, -.95, -2.0, .95, -1.68, 1.0, p, p['oak'])
        c.box('Issue ledger', (.3, -1.84, 1.03), (.32, .24, .05), p['tar'], .01)
        ammo_crates(c, -2.4, -1.5, p, 2, 2, 7); ammo_crates(c, 1.4, -1.5, p, 2, 2, 8)
        lamp_post(c, -1.4, -1.95, 2.1, p, (.3, .05))
        s.update(staff=(0, -1.2, 0), staff_facing=(0, -2.2, 0), plaque=(0, -2.3, 0), window_issue=(0, -.8, 1.3),
                 lamp_front=(-1.1, -1.9, 1.85), glint_counter=(.3, -1.84, 1.05), radio=(1.6, 1.35, 2.7))
    return s


def wagon_wheel(c, x, y, z, r, p, outward=-1, tilt=None, width=.13):
    """Dark iron tyre over an oak felloe; the hub boss and cap point outward.

    Upright wheels read from above as a dark bar with a knob beyond the bed; a wheel
    laid nearly flat (`tilt`) shows its full spoked disc, the strongest wagon cue.
    """
    parts = [annulus(c, 'Iron wagon tyre', (0, 0, 0), r, r - .055, width, p['dark'], steps=40),
             annulus(c, 'Oak wheel felloe', (0, 0, 0), r - .05, r - .13, width * .8, p['oak'], steps=40),
             c.cylinder('Wagon wheel hub', (0, 0, .04), .11, width + .2, p['oak'], 16),
             c.cylinder('Iron hub cap', (0, 0, (width + .2) / 2 + .06), .075, .06, p['iron'], 12)]
    for k in range(12):
        a = k * math.tau / 12
        parts.append(tube(c, 'Wagon wheel spoke', [(.1 * math.cos(a), .1 * math.sin(a), 0), ((r - .1) * math.cos(a), (r - .1) * math.sin(a), 0)], .028, p['cut'], 6))
    from mathutils import Euler, Vector
    turn = Euler((tilt if tilt is not None else -outward * math.pi / 2, 0, 0))
    for ob in parts:
        # Offsets authored along the local axle turn with the wheel (hub boss, cap).
        offset = turn.to_matrix() @ Vector(ob.location)
        ob.rotation_euler = turn
        ob.location = Vector((x, y, z)) + offset


def covered_wagon(c, p):
    """Bed, arched canvas with raised dark hoops, outboard wheels, shafts and a spare wheel."""
    X0, X1, Y0, Y1 = -2.05, .85, .05, 1.45
    slab(c, 'Wagon bed', X0, Y0, X1, Y1, .62, .82, p['oak'], .03)
    for y in (Y0 - .03, Y1 + .03):
        for k in range(8):
            c.box('Wagon side board', (X0 + (k + .5) * (X1 - X0) / 8, y, 1.0), ((X1 - X0) / 8 - .02, .07, .36), p['tar'] if k % 3 else p['oak'], .01)
    for x in (-1.55, .4):
        wagon_wheel(c, x, Y0 - .2, .62, .62, p, -1)
        wagon_wheel(c, x, Y1 + .2, .62, .62, p, 1)
        strut(c, 'Axle tree', (x, Y0 - .3, .62), (x, Y1 + .3, .62), .1, .1, p['dark'])
    w = Y1 - Y0
    cover = grid_surface(c, 'Arched wagon canvas', (X0 + .05, Y0, .95), (1, 0, 0), (0, 1, 0), (0, 0, 1), X1 - X0 - .1, w,
                         lambda s, t: 1.05 * math.sin(math.pi * t / w) + .025 * math.sin(s * 9) * math.sin(math.pi * t / w), p['canvas'], 48, 24, .015)
    for k in range(6):
        x = X0 + .12 + k * (X1 - X0 - .24) / 5
        pts = [(x, Y0 + w * t, .95 + 1.05 * math.sin(math.pi * t) + .035) for t in [i / 16 for i in range(17)]]
        tube(c, 'Raised dark cover hoop', pts, .035, p['tar'], 6)
    tube(c, 'Cover ridge lashing', [(X0 + .1, Y0 + w / 2, 2.04), (X1 - .1, Y0 + w / 2, 2.04)], .018, p['rope'], 6)
    for k in range(2):
        plate(c, 'Canvas patch', (-1.2 + k * 1.1, .55 + k * .3, 2.0 - .1 * k), [(-.2, -.14), (.18, -.12), (.2, .13), (-.16, .15)], .01, p['burlap'], .005)
    # Driver's box, two shafts and a cross bar to the east: reads as a horse cart.
    slab(c, 'Driver box', X1, Y0 + .1, X1 + .4, Y1 - .1, .8, 1.15, p['oak'], .02)
    slab(c, 'Driver seat plank', X1 + .02, Y0 + .15, X1 + .3, Y1 - .15, 1.15, 1.2, p['timber'], .01)
    for y0, y1 in ((.25, .38), (1.25, 1.12)):
        strut(c, 'Cart shaft', (X1 + .3, y0, .62), (2.45, y1, .5), .08, .08, p['oak'])
    strut(c, 'Shaft cross bar', (2.3, .38, .52), (2.3, 1.12, .52), .07, .07, p['oak'])
    lantern(c, X1 + .3, Y1 - .05, 1.2, p)
    # Lowered tailgate with cargo and a spare wheel lying almost flat against the south side.
    slab(c, 'Lowered tailgate', X0 - .45, Y0 + .1, X0, Y1 - .1, .55, .6, p['oak'], .01)
    crate(c, X0 - .2, .45, .6, p, .9)
    wagon_wheel(c, 1.5, -.3, .2, .55, p, tilt=.22)


def scrap_stall(c, p, variant):
    s = {}
    if variant == 'a':
        covered_wagon(c, p)
        for x in (-2.25, -1.55, -.85):
            crate(c, x + .3, -1.4, 0, p, 1.45)
        slab(c, 'Plank counter top', -2.3, -1.65, -.1, -1.1, .62, .68, p['timber'], .015)
        c.cylinder('Brass scale pan', (-1.75, -1.37, .74), .17, .03, p['brass'], 24)
        c.cylinder('Brass scale pan', (-1.1, -1.37, .74), .17, .03, p['brass'], 24)
        beam(c, 'Scale beam', (-1.75, -1.37), (-1.1, -1.37), .035, .95, p['brass'])
        c.cylinder('Scale pillar', (-1.42, -1.37, .82), .035, .3, p['dark'], 8)
        c.box('Counter tray of parts', (-.5, -1.37, .72), (.36, .3, .07), p['rust2'], .01)
        scrap_pile(c, 1.8, -1.4, .62, p, 3, .7)
        scrap_pile(c, 2.05, 1.75, .38, p, 5, .4)
        c.box('Generator skid', (.55, -1.5, .12), (.8, .55, .16), p['oak'], .02)
        c.box('Generator block', (.55, -1.5, .45), (.6, .42, .5), p['olive'], .03)
        c.cylinder('Flywheel', (.2, -1.5, .5), .22, .07, p['dark'], 24).rotation_euler.y = math.pi / 2
        tube(c, 'Exhaust pipe', [(.7, -1.4, .7), (.75, -1.25, 1.1), (.75, -1.25, 1.35)], .045, p['rust'], 8)
        for x, y in [(-2.4, -1.95), (.15, -1.95)]: post(c, x, y, 2.0, p, .05)
        pts = [(-2.4 + 2.55 * t, -1.95, 1.95 - .35 * math.sin(math.pi * t)) for t in [i / 16 for i in range(17)]]
        tube(c, 'Lantern string', pts, .01, p['dark'], 4)
        for t in (.25, .5, .75):
            x, z = -2.4 + 2.55 * t, 1.95 - .35 * math.sin(math.pi * t)
            lantern(c, x, -1.95, z - .25, p)
        barrel(c, 1.35, .3, 0, .2, p, True)
        s.update(staff=(-1.42, -.72, 0), staff_facing=(-1.42, -1.6, 0), plaque=(0, -2.3, 0), spark_grind=(.2, -1.5, .6),
                 exhaust=(.75, -1.25, 1.4), lamp_wagon=(1.15, 1.4, 1.35), lamp_string_a=(-1.76, -1.95, 1.5),
                 lamp_string_b=(-1.12, -1.95, 1.45), lamp_string_c=(-.49, -1.95, 1.5))
        return s
    if variant == 'old-a':
        # Covered salvage wagon with arched canvas, crate counter with scale and heaped scrap.
        slab(c, 'Wagon bed', -2.05, -.15, 1.0, 1.55, .7, .95, p['oak'], .03)
        for k in range(8):
            c.box('Wagon side board', (-2.05 + k * .38 + .19, -.17, 1.1), (.36, .06, .35), p['tar'] if k % 3 else p['oak'], .01)
        for y in (-.4, 1.8):
            for x in (-1.6, .55): wagon_wheel(c, x, y, .62, .62, p)
        hoops = 6
        for k in range(hoops):
            x = -1.95 + k * (2.85 / (hoops - 1))
            pts = [(x, -.15 + .85 - .85 * math.cos(a), .95 + 1.15 * math.sin(a)) for a in [i * math.pi / 12 for i in range(13)]]
            tube(c, 'Bent ash cover hoop', pts, .03, p['oak'], 6)
        cover = grid_surface(c, 'Arched wagon canvas', (-2.0, -.15, .95), (1, 0, 0), (0, 1, 0), (0, 0, 1), 2.95, 1.7,
                             lambda s, t: 1.15 * math.sin(math.pi * t / 1.7) + .03 * math.sin(s * 7) - .05 * math.sin(math.pi * s / 2.95) * 0,
                             p['canvas'], 40, 24, .015)
        for k in range(3):
            plate(c, 'Canvas patch', (-1.4 + k * .9, .7 + (k - 1) * .3, 2.12), [(-.18, -.14), (.17, -.12), (.19, .13), (-.15, .15)], .01, p['olive'] if k % 2 else p['burlap'], .005)
        tube(c, 'Wagon drawbar', [(1.0, .7, .8), (2.35, .7, .55)], .05, p['oak'], 8)
        beam(c, 'Yoke bar', (2.35, .25), (2.35, 1.15), .08, .58, p['oak'])
        for x in (-2.25, -1.55, -.85):
            crate(c, x + .3, -1.35, 0, p, 1.45)
        slab(c, 'Plank counter top', -2.3, -1.6, -.1, -1.05, .62, .68, p['timber'], .015)
        c.cylinder('Brass scale pan', (-1.6, -1.3, .74), .16, .03, p['brass'], 24)
        c.cylinder('Brass scale pan', (-1.0, -1.3, .74), .16, .03, p['brass'], 24)
        beam(c, 'Scale beam', (-1.6, -1.3), (-1.0, -1.3), .03, .95, p['brass'])
        c.cylinder('Scale pillar', (-1.3, -1.3, .82), .03, .3, p['dark'], 8)
        for k in range(3): salvage = c.cylinder('Counter gear', (-.5 + k * .12, -1.25 - k * .05, .71), .06, .03, p['iron'], 10)
        scrap_pile(c, 1.75, -1.15, .72, p, 3, .7)
        scrap_pile(c, 1.95, 1.35, .48, p, 5, .5)
        # Small donkey engine with exhaust: spark and smoke anchor.
        c.box('Generator skid', (.55, -1.45, .12), (.8, .55, .16), p['oak'], .02)
        c.box('Generator block', (.55, -1.45, .45), (.6, .42, .5), p['olive'], .03)
        c.cylinder('Flywheel', (.22, -1.45, .5), .22, .07, p['dark'], 24).rotation_euler.y = math.pi / 2
        tube(c, 'Exhaust pipe', [(.7, -1.35, .7), (.75, -1.2, 1.1), (.75, -1.2, 1.35)], .045, p['rust'], 8)
        for x, y in [(-2.4, -1.9), (.15, -1.9)]: post(c, x, y, 2.0, p, .05)
        pts = [(-2.4 + 2.55 * t, -1.9, 1.95 - .35 * math.sin(math.pi * t)) for t in [i / 16 for i in range(17)]]
        tube(c, 'Lantern string', pts, .01, p['dark'], 4)
        for t in (.25, .5, .75):
            x, z = -2.4 + 2.55 * t, 1.95 - .35 * math.sin(math.pi * t)
            lantern(c, x, -1.9, z - .25, p)
        barrel(c, -2.3, .15, 0, .22, p); barrel(c, 1.3, 1.6, 0, .2, p, True)
        s.update(staff=(-1.3, -.6, 0), staff_facing=(-1.3, -1.6, 0), plaque=(0, -2.25, 0), spark_grind=(.22, -1.45, .6),
                 exhaust=(.75, -1.2, 1.4), lamp_string_a=(-1.76, -1.9, 1.5), lamp_string_b=(-1.12, -1.9, 1.45), lamp_string_c=(-.49, -1.9, 1.5))
    else:
        # Market stall: canvas awning on posts, open front counter, side scrap heaps, grinder and stove.
        for x in (-2.3, 0, 2.3):
            post(c, x, .2, 2.0, p, .07); post(c, x, 1.9, 2.5, p, .07)
        canvas_awning(c, -2.45, .1, 2.45, 1.98, 2.5, 2.0, p['olive'], p, .1, 'south', ropes=False)
        counter(c, -1.7, -.95, 1.7, -.5, 1.0, p)
        c.cylinder('Brass scale pan', (-.9, -.72, 1.06), .16, .03, p['brass'], 24)
        c.cylinder('Brass scale pan', (-.35, -.72, 1.06), .16, .03, p['brass'], 24)
        beam(c, 'Scale beam', (-.9, -.72), (-.35, -.72), .03, 1.28, p['brass'])
        for k in range(5): c.cylinder('Counter parts', (.3 + k * .22, -.7 + (k % 2) * .08, 1.05), .07, .06, p['iron'] if k % 2 else p['rust'], 10)
        scrap_pile(c, -1.85, -1.4, .58, p, 7, .6)
        scrap_pile(c, 1.95, -1.45, .5, p, 9, .5)
        # Hand-cranked grinder and a small stove with a kettle.
        c.box('Grinder bench', (-.65, -1.6, .35), (.6, .4, .7), p['oak'], .02)
        g = c.cylinder('Grinder wheel', (-.65, -1.6, .85), .2, .06, p['stone'], 24); g.rotation_euler.x = math.pi / 2
        tube(c, 'Grinder crank', [(-.65, -1.4, .85), (-.65, -1.3, .85), (-.5, -1.3, .75)], .02, p['iron'], 6)
        c.cylinder('Pot-bellied stove', (.75, -1.55, .4), .25, .8, p['dark'], 20)
        c.cylinder('Kettle', (.75, -1.55, .87), .12, .14, p['brass'], 16)
        tube(c, 'Stove pipe', [(.88, -1.45, .8), (1.0, -1.3, 1.6)], .05, p['rust'], 8)
        crate(c, 2.0, .8, 0, p, 1.3); barrel(c, -2.05, -.1, 0, .2, p)
        lamp_post(c, 2.35, -.4, 2.2, p, (-.3, 0))
        s.update(staff=(0, -.12, 0), staff_facing=(0, -1.0, 0), plaque=(0, -2.25, 0), spark_grind=(-.65, -1.6, 1.05),
                 steam=(.75, -1.55, 1.0), smoke=(1.0, -1.3, 1.65), lamp_front=(2.05, -.4, 1.95))
    return s


BUILDERS = dict(workshop=workshop, yard=yard, armory=armory, scrap_stall=scrap_stall)


def build(c, spec):
    pivot = root(c)
    p = palette(c, spec)
    model = spec['model']
    variant = (spec.get('draft') or {}).get('variant', model.get('variant', 'a'))
    points = BUILDERS[model['structure']](c, p, variant)
    asset = finish(c, pivot)
    asset['sockets'] = {name: socket(c, name, *xyz) for name, xyz in points.items()}
    for ob in asset['sockets'].values(): ob.parent = pivot
    return asset
