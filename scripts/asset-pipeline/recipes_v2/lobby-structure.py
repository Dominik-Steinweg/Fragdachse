"""Lobby base buildings at 1 BU = 1 m = 32 px: workshop, yard, armory and scrap stall.

Each structure fills a 5 x 4 m footprint (x -2.5..2.5, y -2..2) in a 6 m canvas, authored with
its working front facing south (-Y); `model.turn` rotates the finished assembly by quarter turns
for its place in the lobby. Sockets mark staff, plaque, smoke, sparks and lights. Thin rigging
that players may walk under carries `fdNoCollide`, so the derived outline ignores it.
"""
import math
import random
from dawn_parts import root, finish, plate, beam, tube, annulus
from dawn_lobby_details import barrel, sack, lantern, crate, hammer, tongs, endgrain, scraps
from lobby_structure_parts import (palette, slab, gable_roof, plank_wall, stone_course, post, chimney, skylight, counter,
                                   timber_stack, pallet, scrap_pile, lamp_post, socket, grid_surface, strut, ridge_tent,
                                   shop_cuirass, shop_helmet, shop_glove, shop_boot, corrugated_slope)


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


def base_tile(c, x, y, z, size, p, angle=0, tilt=0):
    """One finished base floor tile as the base draws it: dark stone in a steel frame,
    a cyan light strip inside the frame and the round centre motif. Cyan only lives here."""
    from mathutils import Euler, Vector
    turn = Euler((tilt, 0, angle))
    parts = []
    half = size / 2
    parts.append(c.box('Base tile dark stone', (0, 0, .04), (size - .1, size - .1, .08), p['base_stone'], .015))
    for sx, sy, w, h in [(0, half - .03, size, .06), (0, -half + .03, size, .06), (half - .03, 0, .06, size), (-half + .03, 0, .06, size)]:
        parts.append(c.box('Base tile steel frame', (sx, sy, .06), (w, h, .1), p['base_steel'], .008))
    for sx, sy, w, h in [(0, half - .085, size - .2, .022), (0, -half + .085, size - .2, .022), (half - .085, 0, .022, size - .2), (-half + .085, 0, .022, size - .2)]:
        parts.append(c.box('Separate base cyan tile strip', (sx, sy, .085), (w, h, .012), p['cyan'], .003))
    parts.append(annulus(c, 'Base tile ring motif', (0, 0, .085), size * .2, size * .14, .012, p['base_steel'], steps=28))
    for ob in parts:
        offset = turn.to_matrix() @ Vector(ob.location)
        ob.rotation_euler = turn
        ob.location = Vector((x, y, z)) + offset


def ammo_crates(c, x, y, p, rows=2, cols=2, seed=0):
    rng = random.Random(seed)
    for r in range(rows):
        for k in range(cols):
            bx, by, z = x + k * .58, y, .18 + r * .32
            if r and rng.random() < .3: continue
            c.box('Olive ammunition crate', (bx + rng.uniform(-.03, .03), by + rng.uniform(-.03, .03), z), (.54, .36, .3), p['olive'], .025)
            c.box('Crate lid handle', (bx, by, z + .16), (.2, .05, .03), p['dark'], .01)
            for side in (-1, 1): c.box('Crate latch', (bx + side * .2, by - .17, z + .12), (.06, .03, .06), p['brass'], .006)


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
    X0, X1, Y0, Y1 = -2.05, .85, .0, 1.5
    slab(c, 'Wagon bed', X0, Y0, X1, Y1, .62, .82, p['oak'], .03)
    # Side boards stay visible as a wooden rim beside the canvas, with iron stakes and rails.
    for y in (Y0 + .04, Y1 - .04):
        for k in range(8):
            c.box('Wagon side board', (X0 + (k + .5) * (X1 - X0) / 8, y, 1.0), ((X1 - X0) / 8 - .02, .08, .36), p['cut'] if k % 3 else p['oak'], .01)
        strut(c, 'Side top rail', (X0, y, 1.2), (X1, y, 1.2), .1, .05, p['oak'])
        for k in range(5):
            c.box('Iron side stake', (X0 + .1 + k * (X1 - X0 - .2) / 4, y + (.05 if y > 1 else -.05), 1.0), (.05, .03, .42), p['dark'], .006)
    for x in (-1.55, .4):
        wagon_wheel(c, x, Y0 - .22, .62, .62, p, -1)
        wagon_wheel(c, x, Y1 + .22, .62, .62, p, 1)
        strut(c, 'Axle tree', (x, Y0 - .32, .62), (x, Y1 + .32, .62), .1, .1, p['dark'])
    w = Y1 - Y0 - .24
    cy0 = Y0 + .12
    cover = grid_surface(c, 'Arched wagon canvas', (X0 + .05, cy0, 1.18), (1, 0, 0), (0, 1, 0), (0, 0, 1), X1 - X0 - .1, w,
                         lambda s, t: .95 * math.sin(math.pi * t / w) + .03 * math.sin(s * 9) * math.sin(math.pi * t / w)
                         - .05 * math.exp(-((t / w - .5) / .2) ** 2) * (1 - math.cos(s * 2.2)) * .5, p['canvas'], 56, 28, .015)
    for k in range(6):
        x = X0 + .12 + k * (X1 - X0 - .24) / 5
        pts = [(x, cy0 + w * t, 1.18 + .95 * math.sin(math.pi * t) + .035) for t in [i / 16 for i in range(17)]]
        tube(c, 'Raised dark cover hoop', pts, .035, p['tar'], 6)
        for y, z in ((cy0 + .02, 1.2), (cy0 + w - .02, 1.2)):
            tube(c, 'Canvas tie-down rope', [(x, y, z), (x, y + (-.1 if y < 1 else .1), 1.05)], .012, p['rope'], 4)
    tube(c, 'Cover ridge lashing', [(X0 + .1, cy0 + w / 2, 2.17), (X1 - .1, cy0 + w / 2, 2.17)], .018, p['rope'], 6)
    for k in range(2):
        patch = plate(c, 'Canvas patch', (0, 0, 0), [(-.2, -.14), (.18, -.12), (.2, .13), (-.16, .15)], .01, p['burlap'], .005)
        patch.location = (-1.2 + k * 1.1, .55 + k * .35, 2.08)
    c.cylinder('Rolled rear canvas flap', (X0 + .05, cy0 + w / 2, 2.05), .09, w * .8, p['canvas'], 14).rotation_euler.x = math.pi / 2
    c.box('Toolbox on driver box', (X1 + .2, Y1 - .35, 1.28), (.3, .2, .16), p['olive'], .015)
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
    barrel(c, X0 - .22, 1.05, .6, .17, p)


def workshop(c, p):
    """Werkstatt: smithy hall with corrugated gable roof, chimney and skylight; open paved forge veranda south."""
    s = {}
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
    return s


def yard(c, p):
    """Bauhof: the yard makes the base's floor tiles. Tiles lie finished inside the frame,
    stacked on a pallet and hanging from the hoist; cyan appears only as their light strips."""
    X0, X1, Y0, Y1 = -2.35, .95, -.2, 1.9
    for a, b in [((X0, Y0), (X1, Y0)), ((X1, Y0), (X1, Y1)), ((X0, Y1), (X1, Y1)), ((X0, Y0), (X0, Y1))]:
        stone_course(c, a, b, 0, .28, p, int(a[0] * 7 + b[1] * 3) & 63, .34, .32)
        strut(c, 'Oak sill beam', (a[0], a[1], .34), (b[0], b[1], .34), .16, .1, p['oak'])
    # Joists carry the floor; finished base tiles cover the west part, the rest is still open.
    x = X0 + .2
    while x < X1 - .1:
        strut(c, 'Floor joist', (x, Y0 + .1, .3), (x, Y1 - .1, .3), .1, .12, p['cut'])
        x += .45
    size = .98
    for i in range(2):
        for j in range(2):
            base_tile(c, X0 + .2 + size * (i + .5), Y0 + .1 + size * (j + .5), .36, size, p)
    base_tile(c, X0 + .2 + size * 2.5, Y0 + .1 + size * 1.5, .36, size, p)
    # Timber frame and rafters as on the other buildings, first corrugated sheets on the north slope.
    for px, py in [(X0, Y0), (X1, Y0), (X0, Y1), (X1, Y1), (-.7, Y0), (-.7, Y1)]:
        post(c, px, py, 2.6, p, .08)
    for a, b in [((X0, Y1), (X1, Y1)), ((X0, Y0), (X0, Y1)), ((X1, Y0), (X1, Y1)), ((X0, Y0), (X1, Y0))]:
        strut(c, 'Wall top plate', (a[0], a[1], 2.62), (b[0], b[1], 2.62), .14, .14, p['oak'])
    for a, b in [((X0, Y0 + .1), (X0 + .8, Y0 + .1)), ((X1 - .8, Y1 - .1), (X1, Y1 - .1))]:
        strut(c, 'Wall knee brace', (a[0], a[1], .5), (b[0], b[1], 2.4), .08, .08, p['cut'])
    ym = (Y0 + Y1) / 2
    for x in (X0, X1): strut(c, 'King post', (x, ym, 2.62), (x, ym, 3.5), .12, .12, p['oak'])
    strut(c, 'Ridge beam', (X0 - .1, ym, 3.55), (X1 + .1, ym, 3.55), .14, .16, p['oak'])
    roof_slope_rafters(c, X0, X1, Y0 - .15, ym, 2.55, 3.55, p, .55)
    roof_slope_rafters(c, X0, X1, Y1 + .15, ym, 2.55, 3.55, p, .55)
    corrugated_slope(c, 'Newly laid roof sheet', X0 - .15, X0 + 1.55, ym, Y1 + .2, 3.62, 2.52, [p['tin'], p['rust'], p['tin']], 31)
    # Timber scaffold east and a tripod hoist lowering the next tile into place.
    for sx in (1.15, 1.6):
        for sy in (Y0, ym, Y1): c.cylinder('Scaffold standard', (sx, sy, 1.15), .035, 2.3, p['oak'], 8)
        strut(c, 'Scaffold ledger', (sx, Y0, 1.55), (sx, Y1, 1.55), .05, .05, p['oak'])
    for k in range(3):
        strut(c, 'Scaffold plank', (1.2 + k * .17, Y0 - .1, 1.62), (1.2 + k * .17, Y1 + .1, 1.62), .16, .04, p['timber'] if k != 1 else p['oak'], .006)
    for sy in (Y0, Y1): strut(c, 'Scaffold diagonal', (1.15, sy, .05), (1.6, sy, 2.2), .04, .04, p['oak'])
    apex = (2.05, 1.35, 2.9)
    for gx, gy in [(1.75, 1.85), (2.45, 1.75), (2.15, .85)]: strut(c, 'Hoist tripod leg', (gx, gy, 0), apex, .07, .07, p['oak'])
    c.box('Hoist pulley block', (apex[0], apex[1], apex[2] - .2), (.14, .12, .22), p['dark'], .02)
    tube(c, 'Hoist rope', [(apex[0], apex[1], apex[2] - .3), (apex[0], apex[1], 1.45)], .016, p['rope'], 6)
    for dx in (-.3, .3): tube(c, 'Tile sling', [(apex[0], apex[1], 1.45), (apex[0] + dx, apex[1], 1.22)], .01, p['rope'], 4)
    base_tile(c, apex[0], apex[1], 1.15, .8, p, angle=.25, tilt=.06)
    # Front yard: plan table, sawhorses, a pallet of finished tiles and squared timber.
    drafting_table(c, -.8, -1.65, .4, -1.05, .95, p)
    lamp_post(c, .58, -1.05, 2.0, p, (-.3, -.25))
    sawhorse(c, -1.95, -1.25, p, math.pi / 2); sawhorse(c, -1.4, -1.25, p, math.pi / 2)
    strut(c, 'Plank on sawhorses', (-2.15, -1.25, .72), (-1.15, -1.25, .72), .26, .05, p['timber'])
    pallet(c, 1.5, -1.3, p, .95, .95)
    for k in range(3): base_tile(c, 1.5 + .02 * k, -1.3 - .015 * k, .14 + k * .1, .86, p, angle=.03 * k)
    timber_stack(c, 2.15, .15, 1.0, 2, 2, p, math.pi / 2, .16, 17)
    return dict(staff=(-.2, -.62, 0), staff_facing=(-.2, -1.35, 0), plaque=(0, -2.25, 0), spark_saw=(-1.6, -1.25, .8),
                lamp_table=(.28, -1.3, 1.75), hoist=apex, tile_glow=(X0 + 1.18, Y0 + 1.08, .45))


def armory(c, p):
    """Ausrüstung: oxblood fabric ridge tent behind an issue counter that shows the four shop slots."""
    ridge_tent(c, -2.35, 2.35, .05, 1.95, 2.55, 1.55, p['oxblood'], p, 3, 4)
    c.cylinder('Tent rolled door flap', (1.6, .02, 1.5), .09, .9, p['oxblood'], 14).rotation_euler.y = math.pi / 2
    # Long issue counter; armour slots laid flat, front up, like the shop icons.
    # Display scale ~1.5x: each slot reads at about 25 px in game, like a shop sign.
    counter(c, -2.2, -1.25, 2.2, -.4, .95, p)
    shop_glove(c, -1.85, -.82, .95, p, 1.65, -1); shop_glove(c, -1.38, -.86, .95, p, 1.65, 1)
    shop_cuirass(c, -.5, -.82, .95, p, 1.3)
    shop_helmet(c, .45, -.82, .95, p, 1.55)
    shop_boot(c, 1.25, -.82, .95, p, 1.5, 1); shop_boot(c, 1.85, -.8, .95, p, 1.5, 1)
    # Front corners: sandbags, ammunition, a drum and a warm lamp.
    for sx in (-1, 1):
        for k in range(3):
            c.ell('Corner sandbag', (sx * (2.2 - k * .38), -1.8, .12), (.2, .15, .1), p['burlap'])
        c.ell('Corner sandbag', (sx * 2.25, -1.45, .12), (.15, .2, .1), p['burlap'])
    ammo_crates(c, -1.6, -1.5, p, 2, 2, 14)
    c.cylinder('Oil drum', (1.3, -1.45, .45), .27, .9, p['olive'], 24)
    annulus(c, 'Drum rolling hoop', (1.3, -1.45, .6), .28, .26, .04, p['dark'], steps=24)
    lamp_post(c, .45, -1.75, 2.05, p, (-.3, .15))
    return dict(staff=(0, -.08, 0), staff_facing=(0, -1.0, 0), plaque=(0, -2.25, 0), lamp_front=(.15, -1.6, 1.8),
                lamp_tent=(0, .6, 1.6), glint_helmet=(.45, -.82, 1.3), glint_cuirass=(-.5, -.82, 1.1))


def scrap_stall(c, p):
    """Schrotthändler: covered salvage wagon, crate counter with brass scale, heaped scrap and lantern string."""
    s = {}
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
    return s

BUILDERS = dict(workshop=workshop, yard=yard, armory=armory, scrap_stall=scrap_stall)
NO_COLLIDE = ('Tent guy rope', 'Tent peg', 'Lantern string', 'Canvas tie-down rope', 'Tile sling', 'Hoist rope')


def build(c, spec):
    pivot = root(c)
    p = palette(c, spec)
    model = spec['model']
    points = BUILDERS[model['structure']](c, p)
    for ob in c.scene.objects:
        if ob.name.startswith(NO_COLLIDE): ob['fdNoCollide'] = True
    asset = finish(c, pivot)
    asset['sockets'] = {name: socket(c, name, *xyz) for name, xyz in points.items()}
    for ob in asset['sockets'].values(): ob.parent = pivot
    # Quarter turns about the pivot place the front toward the lobby path; lights stay fixed.
    pivot.rotation_euler.z = model.get('turn', 0) * math.pi / 2
    return asset
