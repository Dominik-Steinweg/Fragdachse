"""Wooden demolition bridge kit: one master per state holding decks of width 4, 3 and 2.

One BU is one metre, one cell and 32 display pixels (352 px canvas / 11 BU).
Travel runs along X; each deck spans eight cells. The decks are stacked across Y
with their centres on y = +3 (four cells wide), -1 (three) and -4 (two). The
runtime (src/effects/bridge/BridgeKit.ts) picks the deck of the authored width
and cuts it along cell lines only: the west end (abutment plus first cell), runs
of the six middle cells and the east end. A board gap, a curb joint and a
handrail splice therefore sit on every whole metre, and nothing else crosses a
cell line: posts, moss cushions, ivy, leaves and debris stay inside their cell.

Boards are laid like the watchtower floor: courses of pieces with butt joints
over the stringers, never on the same stringer as the neighbouring course, with
their own albedo offsets, tone and millimetric height. The bridge is old and
overgrown: moss in the joints and along the curbs, cushions at the posts, ivy on
the handrails, leaf litter, grass at the banks and the odd missing board piece.

Lights: the shared key/fill rig moved ten times further out along its own
directions (same angle, softness and irradiance at the pivot) so that a cell
cut from one end matches one from the other.
"""
import math
from bridge_parts import Kit, PX, distant_lights, paint, surface

SPAN = 8                         # cells along travel
HALF_SPAN = SPAN / 2
OUTER = HALF_SPAN + 10 * PX      # abutment outer face on the bank (runtime overhang 10 px)
DECKS = ((4, 3.0), (3, -1.0), (2, -4.0))  # (width in cells, centre y)
DECK_Z = .30                     # board tops; the bank sits slightly lower
BOARDS_PER_CELL = 6
PITCH = 1 / BOARDS_PER_CELL
BOARD_GAP = .018
# Joists every half metre carry the butt joints; pieces average 0.8 to 1 m like the watchtower floor.
STRINGERS = {4: (-1.5, -1.0, -.5, 0.0, .5, 1.0, 1.5), 3: (-1.0, -.5, 0.0, .5, 1.0), 2: (-.5, 0.0, .5)}
JOINT_COUNTS = {4: (3, 4, 2, 3, 4, 3, 2, 4, 3, 3), 3: (2, 3, 2, 1, 3, 2, 3, 2), 2: (1, 2, 1, 2, 1, 1, 2)}
# Main stringers carry the sill straps and survive the collapse as stubs.
MAIN_STRINGERS = {4: (-1.5, -.5, .5, 1.5), 3: (-1.0, 0.0, 1.0), 2: (-.5, .5)}
# Only a single short piece (one joist bay) may be missing: the deck must still read as walkable.
MISSING_PIECE_MAX = .55


def rail_y(width):
    """Handrail centre: its outer face is the 3 px rail overhang beyond the deck edge."""
    return width / 2 + 3 * PX - .046


def inside_cell(rng, x0, margin=.08):
    return x0 + rng.uniform(margin, 1 - margin)


def materials(ctx, char):
    """`char` is the half span for the ruin's blast soot, 0 for the standing bridge."""
    palette = [(171, 143, 108), (160, 137, 110), (182, 146, 104), (150, 130, 106), (176, 147, 112), (142, 128, 102)]
    factors = (1.06, .95, .88, 1.02, .98, 1.10, .92, 1.04, .86, 1.0, 1.08, .93, .9, 1.03)
    grain = (.62, 1.38)
    boards = [surface(ctx, f'Weathered bridge board {i}', tuple(min(255, round(v * f)) for v in palette[(i * 5) % 6]),
                      'wood', 'board', char, .2, grain, mossy=.3) for i, f in enumerate(factors)]
    return {
        'boards': boards,
        'fresh': surface(ctx, 'Replaced fresher board', (190, 156, 114), 'wood', 'board', char, .2, grain),
        'rotten': surface(ctx, 'Dark damp mossy board', (118, 112, 88), 'wood', 'board', char, .2, grain, mossy=.85),
        'rail': surface(ctx, 'Sun worn bridge handrail', (165, 138, 104), 'wood', 'timber', char),
        'post': surface(ctx, 'Bridge post', (146, 122, 94), 'wood', 'timber', char),
        'heavy': surface(ctx, 'Dark structural bridge timber', (108, 90, 66), 'wood', 'timber', char),
        'iron': surface(ctx, 'Matte forged bridge iron', (46, 49, 47), 'steel', 'iron'),
        'shade': paint(ctx, 'Shaded understructure seen through the gaps', (34, 30, 26)),
        'stones': [surface(ctx, f'Abutment stone {i}', rgb, 'coat', 'stone') for i, rgb in
                   enumerate(((132, 136, 133), (112, 116, 113), (126, 121, 110), (141, 143, 137), (104, 104, 99)))],
        'moss': [paint(ctx, f'Moss cushion {i}', rgb) for i, rgb in enumerate(((78, 102, 44), (96, 118, 52), (66, 88, 40), (112, 126, 60)))],
        'ivy': [paint(ctx, f'Ivy leaf {i}', rgb) for i, rgb in enumerate(((52, 80, 36), (66, 96, 42), (44, 68, 32)))],
        'stem': paint(ctx, 'Ivy stem', (70, 58, 40)),
        'leaves': [paint(ctx, f'Fallen leaf {i}', rgb) for i, rgb in
                   enumerate(((128, 92, 46), (150, 116, 54), (104, 98, 50), (136, 74, 40), (118, 104, 62)))],
        'grass': [paint(ctx, f'Bank grass {i}', rgb) for i, rgb in enumerate(((88, 116, 48), (120, 134, 60), (104, 112, 54)))],
    }


def blob(kit, group, name, loc, scale, mat, spin=0.0):
    """Low-poly rounded lump (moss cushion, leaf, ivy leaf)."""
    import bpy
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    ob.rotation_euler = (0, 0, spin)
    ob.data.materials.append(mat)
    for face in ob.data.polygons:
        face.use_smooth = True
    return kit.adopt(group, ob)


def moss_cushion(kit, m, x, y, z, size):
    rng = kit.rng
    for _ in range(rng.randint(3, 6)):
        r = size * rng.uniform(.45, 1)
        blob(kit, 'overgrowth', 'Moss cushion', (x + rng.uniform(-size, size) * .8, y + rng.uniform(-size, size) * .8, z),
             (r, r * rng.uniform(.7, 1.1), r * .45), rng.choice(m['moss']), rng.uniform(0, math.pi))


def grass_tuft(kit, m, x, y, z):
    rng = kit.rng
    blades = rng.randint(7, 12)
    for i in range(blades):
        angle = i / blades * 2 * math.pi + rng.uniform(-.3, .3)
        length = rng.uniform(.1, .2)
        tilt = rng.uniform(.9, 1.25)
        kit.box('overgrowth', 'Grass blade', (x + math.cos(angle) * length * .45, y + math.sin(angle) * length * .45, z + .03),
                (length, .014, .008), rng.choice(m['grass']), .002, (0, -tilt * .35, angle))


def abutments(kit, m, width, cy):
    """Dressed stone bank seats with a timber sill, moss and grass; identical in both states."""
    rng = kit.rng
    half = width / 2 + 3 * PX
    for side in (-1, 1):
        for (x0, x1) in ((HALF_SPAN - .16, HALF_SPAN + .07), (HALF_SPAN + .07, OUTER)):
            y = -half
            while y < half - .05:
                length = rng.uniform(.28, .62)
                if half - (y + length) < .22:
                    length = half - y
                kit.box('abutments', 'Dressed abutment cap stone', (side * (x0 + x1) / 2, cy + y + length / 2, .13 + rng.uniform(-.03, .02)),
                        (x1 - x0 - .022, length - .024, .22), rng.choice(m['stones']), .035, jitter=.014)
                y += length
        kit.box('structure', 'End sill timber', (side * (HALF_SPAN - .07), cy, DECK_Z - .045), (.17, width + .1, .16), m['heavy'], .012)
        # Moss in the masonry joints and grass from the bank.
        for _ in range(rng.randint(2, 4)):
            moss_cushion(kit, m, side * rng.uniform(HALF_SPAN + .1, OUTER - .06), cy + rng.uniform(-half + .1, half - .1), .25, .06)
        for _ in range(rng.randint(2, 3)):
            grass_tuft(kit, m, side * rng.uniform(HALF_SPAN + .16, OUTER - .05), cy + rng.uniform(-half + .05, half - .05), .2)


def newel(kit, m, side, sy, width, cy, broken=False):
    rng = kit.rng
    x, y = side * (HALF_SPAN - .07), cy + sy * (rail_y(width) - .04)
    top = DECK_Z + (rng.uniform(.35, .7) if broken else 1.02)
    tilt = (rng.uniform(-.25, .25), rng.uniform(-.25, .25), 0) if broken else None
    kit.box('railings', 'Corner newel post', (x, y, (DECK_Z - .25 + top) / 2), (.17, .17, top - DECK_Z + .25), m['post'], .01, tilt)
    if not broken:
        kit.box('hardware', 'Newel iron cap', (x, y, top + .012), (.172, .172, .025), m['iron'], .004)
        moss_cushion(kit, m, x - side * .1, y - sy * .1, DECK_Z + .02, .05)


def courses(kit, m, width, cy):
    """Cross boards in courses, butt-jointed over the stringers like the watchtower floor.

    Shade under the boards fills the narrow gaps; where a short piece is missing
    there is no shade either, so the river shows through between the stringers.
    """
    rng = kit.rng
    half = width / 2 - .015
    stringers = STRINGERS[width]
    counts = JOINT_COUNTS[width]
    previous = set()
    for course in range(SPAN * BOARDS_PER_CELL):
        x0 = -HALF_SPAN + course * PITCH
        options = [s for s in stringers if s not in previous]
        joints = sorted(rng.sample(options, min(len(options), counts[course % len(counts)])))
        previous = set(joints)
        bounds = [-half] + joints + [half]
        end_cell = course < BOARDS_PER_CELL or course >= (SPAN - 1) * BOARDS_PER_CELL
        shade_from = -half
        for a, b in zip(bounds, bounds[1:]):
            # The odd short piece is gone.
            if not end_cell and b - a < MISSING_PIECE_MAX and rng.random() < .05:
                if a - shade_from > .01:
                    kit.box('structure', 'Shade under the boards', (x0 + PITCH / 2, cy + (shade_from + a) / 2, DECK_Z - .42),
                            (PITCH, a - shade_from, .04), m['shade'], .002)
                shade_from = b
                continue
            roll = rng.random()
            mat = m['fresh'] if roll < .05 else m['rotten'] if roll < .11 else rng.choice(m['boards'])
            lo, hi = a + (.0025 if a > -half else rng.uniform(-.01, .006)), b - (.0025 if b < half else rng.uniform(-.006, .01))
            board = kit.box('deck', 'Cross board piece', (x0 + PITCH / 2, cy + (lo + hi) / 2, DECK_Z - .0225 + rng.uniform(-.0025, .0025)),
                            (PITCH - BOARD_GAP, hi - lo, .045), mat, .004)
            board.rotation_euler = (rng.uniform(-.005, .005), rng.uniform(-.008, .008), rng.uniform(-.003, .003))
        if half - shade_from > .01:
            kit.box('structure', 'Shade under the boards', (x0 + PITCH / 2, cy + (shade_from + half) / 2, DECK_Z - .42),
                    (PITCH, half - shade_from, .04), m['shade'], .002)


def overgrowth(kit, m, width, cy):
    """Cell-local growth on the standing deck: cushions at the curbs and posts, ivy, leaf litter."""
    rng = kit.rng
    edge = width / 2 - .16
    for cell in range(SPAN):
        x0 = -HALF_SPAN + cell
        for sy in (-1, 1):
            for _ in range(rng.randint(2, 4)):
                moss_cushion(kit, m, inside_cell(rng, x0, .12), cy + sy * (edge + rng.uniform(-.04, .06)), DECK_Z + .01, rng.uniform(.04, .08))
            if rng.random() < .45:
                # Ivy creeps along the handrail within this cell.
                start = x0 + rng.uniform(.08, .4)
                length = rng.uniform(.3, .55)
                ry = cy + sy * rail_y(width)
                steps = max(4, int(length / .05))
                for i in range(steps):
                    x = start + length * i / steps
                    if x > x0 + .93:
                        break
                    wobble = math.sin(i * 1.7 + rng.uniform(0, 1)) * .03
                    kit.box('overgrowth', 'Ivy stem', (x, ry + wobble * .5, DECK_Z + 1.02), (.06, .008, .008), m['stem'], .001,
                            (0, 0, rng.uniform(-.4, .4)))
                    if rng.random() < .8:
                        blob(kit, 'overgrowth', 'Ivy leaf', (x, ry + wobble + rng.uniform(-.04, .04), DECK_Z + 1.03),
                             (.03, .022, .006), rng.choice(m['ivy']), rng.uniform(0, math.pi))
        for _ in range(rng.randint(2, 6)):
            # Leaf litter collects towards the curbs.
            y = rng.uniform(-1, 1) * (width / 2 - .2)
            if rng.random() < .6:
                y = math.copysign(rng.uniform(width / 2 - .5, width / 2 - .2), y)
            blob(kit, 'overgrowth', 'Fallen leaf', (inside_cell(rng, x0), cy + y, DECK_Z + .004),
                 (rng.uniform(.03, .045), rng.uniform(.018, .026), .004), rng.choice(m['leaves']), rng.uniform(0, math.pi))


def standing(kit, m, width, cy):
    rng = kit.rng
    rail = rail_y(width)
    curb = width / 2 - .05
    for y in STRINGERS[width] + (-curb, curb):
        kit.box('structure', 'Longitudinal stringer', (0, cy + y, DECK_Z - .16), (2 * HALF_SPAN - .1, .15, .2), m['heavy'], .01)
    courses(kit, m, width, cy)
    for cell in range(SPAN):
        x0, x1 = -HALF_SPAN + cell, -HALF_SPAN + cell + 1
        for sy in (-1, 1):
            kit.box('railings', 'Curb segment', ((x0 + x1) / 2, cy + sy * curb, DECK_Z + .035), (1 - .012, .13, .07), m['heavy'], .008)
            kit.box('railings', 'Handrail segment', ((x0 + x1) / 2, cy + sy * rail, DECK_Z + .97), (1 - .01, .092, .08), m['rail'], .014)
            kit.box('railings', 'Guard rail segment', ((x0 + x1) / 2, cy + sy * (rail - .045), DECK_Z + .52), (1 - .01, .05, .05), m['heavy'], .008)
            if 0 < cell < SPAN - 1:
                post_x = (x0 + x1) / 2 + rng.uniform(-.04, .04)
                kit.box('railings', 'Railing post', (post_x, cy + sy * (rail - .015), DECK_Z + .35), (.12, .12, 1.2), m['post'], .008)
                for along in (-1, 1):
                    kit.box('hardware', 'Post side strap', (post_x + along * .066, cy + sy * (rail - .015), DECK_Z + .9),
                            (.012, .1, .2), m['iron'], .002)
                if rng.random() < .5:
                    moss_cushion(kit, m, post_x, cy + sy * (rail - .12), DECK_Z + .02, .05)
        for sy in (-1, 1):
            if cell > 0:
                kit.box('hardware', 'Handrail splice strap', (x0, cy + sy * rail, DECK_Z + 1.015), (.11, .104, .014), m['iron'], .003)
                kit.box('hardware', 'Curb splice strap', (x0, cy + sy * curb, DECK_Z + .073), (.09, .14, .01), m['iron'], .003)
    for side in (-1, 1):
        for sy in (-1, 1):
            newel(kit, m, side, sy, width, cy)
        for y in MAIN_STRINGERS[width]:
            kit.box('hardware', 'Sill tie strap', (side * (HALF_SPAN - .13), cy + y, DECK_Z + .038), (.32, .06, .012), m['iron'], .003)
    overgrowth(kit, m, width, cy)


def ruin(kit, m, width, cy):
    rng = kit.rng
    half = width / 2 - .015
    curb = width / 2 - .05
    for side in (-1, 1):
        for sy in (-1, 1):
            broken = rng.random() < .6
            newel(kit, m, side, sy, width, cy, broken)
            if not broken:
                reach = rng.uniform(.25, .7)
                kit.box('railings', 'Torn handrail stub', (side * (HALF_SPAN - .07 - reach / 2), cy + sy * rail_y(width), DECK_Z + .9),
                        (reach, .09, .08), m['rail'], .012, (0, side * rng.uniform(.1, .35), rng.uniform(-.08, .08)))
        for y in MAIN_STRINGERS[width] + (-curb, curb):
            reach = rng.uniform(.25, .92)
            sag = rng.uniform(.12, .42)
            start = (side * (HALF_SPAN - .1), cy + y, DECK_Z - .16)
            end = (side * (HALF_SPAN - .1 - reach), cy + y + rng.uniform(-.05, .05), DECK_Z - .16 - sag * reach)
            kit.beam('structure', 'Broken stringer stub', start, end, .15, .2, m['heavy'], .01)
        rows = rng.randint(2, 4)
        for i in range(rows + 2):
            x = side * (HALF_SPAN - (i + .5) * PITCH)
            keep = 1 - .22 * max(0, i - rows + 1) - .08 * i
            y = -half
            while y < half:
                length = rng.uniform(.35, 1.4)
                y1 = min(half, y + length)
                if rng.random() < keep:
                    droop = .0 if i < rows else rng.uniform(.04, .16)
                    kit.box('deck', 'Remaining board', (x, cy + (y + y1) / 2, DECK_Z - .0225 - droop * .5),
                            (PITCH - BOARD_GAP, y1 - y - .03, .045), rng.choice(m['boards'] + [m['rotten']]), .004,
                            (rng.uniform(-droop, droop), side * droop * rng.uniform(.5, 1.5), rng.uniform(-.05, .05)))
                y = y1 + rng.uniform(.0, .25)
        for _ in range(rng.randint(1, 2)):
            moss_cushion(kit, m, side * (HALF_SPAN - rng.uniform(.15, .45)), cy + rng.uniform(-half, half) * .8, DECK_Z, .05)
    # Broken trestle piles stand in two middle cells near the deck edges.
    for cell in (2, 5):
        cell_x = -HALF_SPAN + cell + .5
        for sy in (-1, 1):
            px, py = cell_x + rng.uniform(-.2, .2), cy + sy * (width / 2 - rng.uniform(.2, .45))
            top = rng.uniform(-.25, .12)
            kit.cylinder('piles', 'Broken trestle pile', (px, py, (top - .7) / 2), .12, top + .7, m['heavy'], 14,
                         (rng.uniform(-.08, .08), rng.uniform(-.08, .08), 0), .01)
            for _ in range(3):
                kit.box('piles', 'Splintered pile crown', (px + rng.uniform(-.04, .04), py + rng.uniform(-.04, .04), top + .04),
                        (.05, .03, .12), m['post'], .004, (rng.uniform(-.3, .3), rng.uniform(-.3, .3), rng.uniform(0, math.pi)))
    # Drifting board fragments, each inside one cell.
    for cell in range(1, SPAN - 1):
        for _ in range(rng.randint(0, 2)):
            length = rng.uniform(.34, .58)
            angle = rng.uniform(0, math.pi)
            cx = -HALF_SPAN + cell + .5 + rng.uniform(-.1, .1)
            cyy = cy + rng.uniform(-1, 1) * (width / 2 - .45)
            kit.box('debris', 'Drifting board fragment', (cx, cyy, -.45 + rng.uniform(-.02, .02)), (length, PITCH - BOARD_GAP, .045),
                    rng.choice(m['boards']), .004, (rng.uniform(-.05, .05), rng.uniform(-.05, .05), angle))


def build(ctx, spec):
    distant_lights(ctx.scene)
    state = spec['model']['state']
    kit = Kit(ctx, 'Bridge kit ' + state, 1207)
    m = materials(ctx, HALF_SPAN if state == 'ruin' else 0.0)
    # Banks first, in a fixed order: both states share every abutment, sill, cushion and tuft.
    for width, cy in DECKS:
        kit.tags = {'fd_deck_cy': cy, 'fd_deck_inv_half': 2 / width}
        abutments(kit, m, width, cy)
    for width, cy in DECKS:
        kit.tags = {'fd_deck_cy': cy, 'fd_deck_inv_half': 2 / width}
        (ruin if state == 'ruin' else standing)(kit, m, width, cy)
    return kit.result()
