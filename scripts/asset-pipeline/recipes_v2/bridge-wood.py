"""Wooden demolition bridge kit: a 6 x 4 cell master, standing or collapsed.

One BU is one metre, one cell and 32 display pixels (224 px canvas / 7 BU).
Travel runs along X. The runtime (src/effects/bridge/BridgeKit.ts) cuts the
render along cell boundaries: both ends (abutment plus first/last cell), any of
the four middle cells, and the deck halves either side of y = 0 and y = +-1.
The model therefore keeps a joint at every such boundary: board gaps at every
whole metre along X, handrail and curb butt joints with iron splices on them,
posts and piles inside cells, masonry joints at y = -1, 0, 1. Wear depends only
on the distance from the centreline, never on the position along the span.

Lights: the shared key/fill rig moved ten times further out along its own
directions (same angle, softness and irradiance at the pivot) so that a cell
cut from the west end matches one from the east end.
"""
import math
from bridge_parts import Kit, PX, distant_lights, paint, surface

HALF_SPAN = 3.0                 # deck x range [-3, 3]: six cells
HALF_WIDTH = 2.0                # deck y range [-2, 2]: four cells
OUTER = HALF_SPAN + 10 * PX     # abutment outer face on the bank (runtime overhang 10 px)
RAIL = HALF_WIDTH + 3 * PX - .046  # handrail centre: outer face at the 3 px rail overhang
DECK_Z = .30                    # board tops; the bank sits slightly lower
BOARDS_PER_CELL = 6
BOARD_GAP = .018
STRINGERS = (-1.5, -.5, .5, 1.5)
CURB = 1.95


def materials(ctx, char):
    palette = [(171, 143, 108), (160, 137, 110), (182, 146, 104), (150, 130, 106), (176, 147, 112)]
    factors = (1.06, .95, .88, 1.02, .98, 1.10, .92, 1.04, .86, 1.0, 1.08, .93)
    boards = [surface(ctx, f'Weathered bridge board {i}', tuple(min(255, round(v * f)) for v in palette[(i * 3) % 5]),
                      'wood', 'board', char, .2, (.62, 1.38)) for i, f in enumerate(factors)]
    fresh = surface(ctx, 'Replaced fresher board', (196, 160, 116), 'wood', 'board', char, .2, (.62, 1.38))
    return {
        'boards': boards, 'fresh': fresh,
        'rail': surface(ctx, 'Sun worn bridge handrail', (169, 140, 104), 'wood', 'timber', char),
        'post': surface(ctx, 'Bridge post', (150, 124, 94), 'wood', 'timber', char),
        'heavy': surface(ctx, 'Dark structural bridge timber', (112, 92, 66), 'wood', 'timber', char),
        'iron': surface(ctx, 'Matte forged bridge iron', (46, 49, 47), 'steel', 'iron'),
        'shade': paint(ctx, 'Shaded understructure seen through the gaps', (34, 30, 26)),
        'stones': [surface(ctx, f'Abutment stone {i}', rgb, 'coat', 'stone') for i, rgb in
                   enumerate(((132, 136, 133), (112, 116, 113), (126, 121, 110), (141, 143, 137), (104, 104, 99)))],
    }


def abutments(kit, m):
    """Dressed stone bank seats with a timber sill; identical in both states."""
    rng = kit.rng
    for side in (-1, 1):
        # Two courses along X; each course has joints at y = -1, 0, 1 for the runtime cuts.
        for (x0, x1) in ((HALF_SPAN - .16, HALF_SPAN + .07), (HALF_SPAN + .07, OUTER)):
            for band in ((-2.09, -1), (-1, 0), (0, 1), (1, 2.09)):
                y, joints = band[0], []
                while y < band[1] - .05:
                    length = rng.uniform(.28, .62)
                    if band[1] - (y + length) < .22:
                        length = band[1] - y
                    joints.append((y, y + length))
                    y += length
                for (y0, y1) in joints:
                    cx = side * (x0 + x1) / 2
                    kit.box('abutments', 'Dressed abutment cap stone', (cx, (y0 + y1) / 2, .13 + rng.uniform(-.03, .02)),
                            (x1 - x0 - .022, y1 - y0 - .024, .22), rng.choice(m['stones']), .035, jitter=.014)
        # The sill takes the board ends; newel posts stand on it at the corners.
        kit.box('structure', 'End sill timber', (side * (HALF_SPAN - .07), 0, DECK_Z - .045), (.17, 2 * HALF_WIDTH + .1, .16), m['heavy'], .012)


def newel(kit, m, side, sy, broken=False):
    rng = kit.rng
    x, y = side * (HALF_SPAN - .07), sy * (RAIL - .04)
    top = DECK_Z + (rng.uniform(.35, .7) if broken else 1.02)
    tilt = (rng.uniform(-.25, .25), rng.uniform(-.25, .25), 0) if broken else None
    kit.box('railings', 'Corner newel post', (x, y, (DECK_Z - .25 + top) / 2), (.17, .17, top - DECK_Z + .25), m['post'], .01, tilt)
    if not broken:
        kit.box('hardware', 'Newel iron cap', (x, y, top + .012), (.172, .172, .025), m['iron'], .004)


def standing(kit, m):
    rng = kit.rng
    for y in STRINGERS + (-CURB, CURB):
        kit.box('structure', 'Longitudinal stringer', (0, y, DECK_Z - .16), (2 * HALF_SPAN - .1, .15, .2), m['heavy'], .01)
    # Joists and their shade fill the board gaps from below instead of open water.
    kit.box('structure', 'Shaded understructure', (0, 0, DECK_Z - .42), (2 * HALF_SPAN - .1, 2 * HALF_WIDTH - .06, .04), m['shade'], .002)
    pitch = 1 / BOARDS_PER_CELL
    for i in range(int(2 * HALF_SPAN * BOARDS_PER_CELL)):
        x0 = -HALF_SPAN + i * pitch
        mat = m['fresh'] if rng.random() < .05 else rng.choice(m['boards'])
        y0, y1 = -1.985 + rng.uniform(-.012, .012), 1.985 + rng.uniform(-.012, .012)
        board = kit.box('deck', 'Cross board', (x0 + pitch / 2, (y0 + y1) / 2, DECK_Z - .0225 + rng.uniform(-.003, .003)),
                        (pitch - BOARD_GAP, y1 - y0, .045), mat, .004)
        board.rotation_euler = (rng.uniform(-.004, .004), rng.uniform(-.01, .01), rng.uniform(-.004, .004))
    # Low curbs, handrails and guard rails: one segment per cell, butt joints with splices on the cell lines.
    for cell in range(int(2 * HALF_SPAN)):
        x0, x1 = -HALF_SPAN + cell, -HALF_SPAN + cell + 1
        for sy in (-1, 1):
            kit.box('railings', 'Curb segment', ((x0 + x1) / 2, sy * CURB, DECK_Z + .035), (1 - .012, .13, .07), m['heavy'], .008)
            kit.box('railings', 'Handrail segment', ((x0 + x1) / 2, sy * RAIL, DECK_Z + .97), (1 - .01, .092, .08), m['rail'], .014)
            kit.box('railings', 'Guard rail segment', ((x0 + x1) / 2, sy * (RAIL - .045), DECK_Z + .52), (1 - .01, .05, .05), m['heavy'], .008)
            if 0 < cell < 2 * HALF_SPAN - 1:
                post_x = (x0 + x1) / 2 + rng.uniform(-.04, .04)
                kit.box('railings', 'Railing post', (post_x, sy * (RAIL - .015), DECK_Z + .35), (.12, .12, 1.2), m['post'], .008)
                for along in (-1, 1):
                    kit.box('hardware', 'Post side strap', (post_x + along * .066, sy * (RAIL - .015), DECK_Z + .9),
                            (.012, .1, .2), m['iron'], .002)
        for sy in (-1, 1):
            if cell > 0:
                kit.box('hardware', 'Handrail splice strap', (x0, sy * RAIL, DECK_Z + 1.015), (.11, .104, .014), m['iron'], .003)
                kit.box('hardware', 'Curb splice strap', (x0, sy * CURB, DECK_Z + .073), (.09, .14, .01), m['iron'], .003)
    for side in (-1, 1):
        for sy in (-1, 1):
            newel(kit, m, side, sy)
        # Straps tie the deck to the sill, away from the runtime cut lines.
        for y in (-1.5, -.5, .5, 1.5):
            kit.box('hardware', 'Sill tie strap', (side * (HALF_SPAN - .13), y, DECK_Z + .038), (.32, .06, .012), m['iron'], .003)


def ruin(kit, m):
    rng = kit.rng
    pitch = 1 / BOARDS_PER_CELL
    for side in (-1, 1):
        for sy in (-1, 1):
            broken = rng.random() < .6
            newel(kit, m, side, sy, broken)
            if not broken:
                # A torn handrail stub still hangs off the intact newel.
                reach = rng.uniform(.25, .7)
                kit.box('railings', 'Torn handrail stub', (side * (HALF_SPAN - .07 - reach / 2), sy * RAIL, DECK_Z + .9),
                        (reach, .09, .08), m['rail'], .012, (0, side * rng.uniform(.1, .35), rng.uniform(-.08, .08)))
        # Stringer stubs sag from the sill towards the river, burnt at their broken ends.
        for y in STRINGERS + (-CURB, CURB):
            reach = rng.uniform(.25, .92)
            sag = rng.uniform(.12, .42)
            start = (side * (HALF_SPAN - .1), y, DECK_Z - .16)
            end = (side * (HALF_SPAN - .1 - reach), y + rng.uniform(-.05, .05), DECK_Z - .16 - sag * reach)
            kit.beam('structure', 'Broken stringer stub', start, end, .15, .2, m['heavy'], .01)
        # The first boards still lie on the stubs; further out only fragments remain.
        rows = rng.randint(2, 4)
        for i in range(rows + 2):
            x = side * (HALF_SPAN - (i + .5) * pitch)
            keep = 1 - .22 * max(0, i - rows + 1) - .08 * i
            y = -1.985
            while y < 1.985:
                length = rng.uniform(.35, 1.4)
                y1 = min(1.985, y + length)
                if rng.random() < keep:
                    droop = .0 if i < rows else rng.uniform(.04, .16)
                    kit.box('deck', 'Remaining board', (x, (y + y1) / 2, DECK_Z - .0225 - droop * .5),
                            (pitch - BOARD_GAP, y1 - y - .03, .045), rng.choice(m['boards']), .004,
                            (rng.uniform(-droop, droop), side * droop * rng.uniform(.5, 1.5), rng.uniform(-.05, .05)))
                y = y1 + rng.uniform(.0, .25)
    # Broken trestle piles stand in two middle cells, near the deck edges (kept by every width).
    for cell_x in (-1.5, 1.5):
        for sy in (-1, 1):
            px, py = cell_x + rng.uniform(-.2, .2), sy * rng.uniform(1.55, 1.8)
            top = rng.uniform(-.25, .12)
            kit.cylinder('piles', 'Broken trestle pile', (px, py, (top - .7) / 2), .12, top + .7, m['heavy'], 14,
                         (rng.uniform(-.08, .08), rng.uniform(-.08, .08), 0), .01)
            for _ in range(3):
                # Splinters stay on the pile's own footprint.
                kit.box('piles', 'Splintered pile crown', (px + rng.uniform(-.04, .04), py + rng.uniform(-.04, .04), top + .04),
                        (.05, .03, .12), m['post'], .004, (rng.uniform(-.3, .3), rng.uniform(-.3, .3), rng.uniform(0, math.pi)))
    # Drifting board fragments: each stays inside one cell and one deck band.
    bands = ((1.15, 1.9), (.15, .85), (-.85, -.15), (-1.9, -1.15))
    for cell in range(1, int(2 * HALF_SPAN) - 1):
        for _ in range(rng.randint(1, 2)):
            band = rng.choice(bands)
            length = rng.uniform(.38, .62)
            angle = rng.uniform(0, math.pi)
            cx = -HALF_SPAN + cell + .5 + rng.uniform(-.12, .12)
            cy = (band[0] + band[1]) / 2 + rng.uniform(-.1, .1)
            kit.box('debris', 'Drifting board fragment', (cx, cy, -.45 + rng.uniform(-.02, .02)), (length, pitch - BOARD_GAP, .045),
                    rng.choice(m['boards']), .004, (rng.uniform(-.05, .05), rng.uniform(-.05, .05), angle))


def build(ctx, spec):
    distant_lights(ctx.scene)
    state = spec['model']['state']
    kit = Kit(ctx, 'Bridge kit ' + state, 1207)
    m = materials(ctx, state == 'ruin')
    abutments(kit, m)
    (ruin if state == 'ruin' else standing)(kit, m)
    return kit.result()
