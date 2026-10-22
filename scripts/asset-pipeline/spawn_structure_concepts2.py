"""Second design round of the spawn structure (user 2026-10-22: "kreativer, darf organischer sein").

Same footprint contract as spawn_structure_concepts.py (U of 8 wall cells, pit in the opening,
pivot = pit centre, 1 BU = 1 cell), but free in material and mood; not every concept needs the
hard violet edge.

    E  Brutkadaver     a giant carcass forms the U: hide, spine and ribs; brood in its belly
    F  Baumstumpf      a hollow, split giant stump: growth rings on the cut, glowing fungus
    G  Brutstock       a clay mound built by the brood: chambers, chimneys, honeycomb floor
    H  Bunkerruine     a cracked war bunker overrun by black brood slime, wire and sandbags
"""
import math
from dawn_parts import surface, tapered_tube
from enemy_parts_b import plate
from spawn_structure_concepts import (VOID_PRIMARY, WALL_CELLS, MARGIN, edges, strip, inset_outline, centred_plate,
                                      chamfered, damp, lump)


def centerline(step=.2):
    """Wall centre path of the U, left arm tip -> back wall -> right arm tip."""
    pts = []
    for y in [-.85 + i * step for i in range(int(2.35 / step) + 1)]: pts.append((-1.5, y))
    for x in [-1.5 + i * step for i in range(1, int(3.0 / step))]: pts.append((x, 1.5))
    for y in [1.5 - i * step for i in range(int(2.35 / step) + 1)]: pts.append((1.5, y))
    return pts


def square(half=1.04):
    return [(-half, -half), (half, -half), (half, half), (-half, half)]


class ConceptKit2:
    def __init__(self, c, spec):
        lib = spec['model'].get('librarySurfaces', {})
        def m(name, rgb, wear=.3, emission=0):
            return surface(c, name, rgb, wear, emission, **lib.get(name, {}))
        self.hide = damp(m('Dead grey hide', (74, 62, 70), .2), .55)
        self.flesh = damp(m('Raw carcass flesh', (82, 36, 52), .1), .45, .14)
        self.bone = m('Bleached carcass bone', (196, 186, 162), .3)
        self.bark = m('Rotten giant bark', (52, 40, 32), .35)
        self.heart_wood = m('Cut heartwood ring', (112, 86, 60), .3)
        self.sap_wood = m('Cut sapwood ring', (138, 110, 78), .3)
        self.rot = m('Rotten wood mulch', (44, 34, 28), .1)
        self.moss = m('Damp moss cushion', (54, 70, 38), .1)
        self.mycel = m('Pale mycelium', (176, 168, 182), .05)
        self.cap = m('Void fungus cap', (120, 52, 170), 0, .55)
        self.clay = m('Brood clay', (128, 96, 66), .3)
        self.clay_dark = m('Wet brood clay', (84, 62, 46), .2)
        self.wax = damp(m('Brood wax cap', (150, 132, 108), .1), .4, .15)
        self.cell = m('Open brood cell', (20, 12, 22), 0)
        self.larva = damp(m('Pale brood larva', (190, 176, 168), .05), .35, .2)
        self.concrete = m('Weathered bunker concrete', (104, 102, 96), .4)
        self.concrete_dark = m('Stained bunker concrete', (70, 68, 66), .35)
        self.rebar = m('Rusted rebar', (110, 62, 38), .5)
        self.sandbag = m('Sandbag canvas', (122, 108, 80), .35)
        self.wire = m('Barbed wire', (70, 64, 60), .3)
        self.slime = damp(m('Black brood slime', (22, 10, 28), .02), .3, .3)
        self.slime_film = damp(m('Violet slime film', (64, 26, 82), .02), .3, .3)
        self.sac = damp(m('Translucent brood egg', (70, 36, 88), .08), .4)
        self.seam = m('Deep armour seam', (12, 11, 15), 0)
        self.glow = m('Void brood heart', VOID_PRIMARY, 0, .7)
        self.vein = m('Void brood vein', (100, 34, 140), 0, .35)


def building_e(c, k, rng):
    """Brutkadaver: hide over the U, a spine along the outer back, ribs arching to the pit."""
    path = centerline(.18)
    for x, y in path:
        lump(c, k.hide, x + rng.uniform(-.06, .06), y + rng.uniform(-.06, .06), .16, rng.uniform(.38, .46), rng.uniform(.34, .42), .2, rng)
    for x, y in path[::2]:
        lump(c, k.flesh, x + rng.uniform(-.12, .12), y + rng.uniform(-.12, .12), .3, rng.uniform(.1, .16), rng.uniform(.08, .12), .05, rng)
    # Spine along the outer edge of the back wall and both arms.
    for x, y in path[1:-1:2]:
        ox = -.3 if x < -1.2 else .3 if x > 1.2 else 0
        oy = .3 if y > 1.2 and abs(x) < 1.2 else 0
        c.ell('Bleached carcass bone', (x + ox, y + oy, .36), (.11, .11, .07), k.bone)
    # Ribs: from the spine over the hide down to the pit edge, the U's readable skeleton.
    for x, y in path[2:-2:3]:
        if abs(x) > 1.2:
            side = 1 if x > 0 else -1
            pts = [(x + side * .32, y, .34), (x + side * .05, y, .48), (x - side * .3, y + .05, .36), (x - side * .44, y + .08, .1)]
        else:
            pts = [(x, y + .32, .34), (x, y + .05, .48), (x + .04, y - .3, .36), (x + .06, y - .44, .1)]
        tapered_tube(c, 'Bleached carcass bone', pts, [.05, .045, .035, .015], k.bone, 8)
    for x, y in ((-1.2, .6), (1.25, -.2), (-.5, 1.22), (.6, 1.25)):
        lump(c, k.sac, x, y, .28, .08, .07, .06, rng, 'Translucent brood egg')
        c.ell('Void brood heart', (x, y, .33), (.03, .03, .02), k.glow)


def building_f(c, k, rng):
    """Baumstumpf: a split hollow stump; growth rings on the cut, bark outside, glowing fungus."""
    plate(c, 'Rotten giant bark', (0, 0, .2), inset_outline(MARGIN), .4, k.bark, .06)
    # Growth rings follow the U from both faces: the cut reads as one solid trunk.
    bands = [(.0, .1, k.bark), (.1, .15, k.sap_wood), (.15, .18, k.heart_wood), (.18, .24, k.sap_wood), (.24, .27, k.heart_wood),
             (.27, .33, k.sap_wood), (.33, .36, k.heart_wood), (.36, .42, k.sap_wood), (.42, .47, k.heart_wood)]
    for a, d, n, length in edges():
        for off0, off1, mat in bands:
            strip(c, 'Growth ring', a, d, n, 0, length, MARGIN + off0, MARGIN + off1, .41 + (.03 if mat is k.bark else 0), .02, mat, .004)
        # Deep bark furrows across the outer rim.
        steps = int(length / .09)
        for j in range(steps):
            t = (j + .5) * length / steps
            strip(c, 'Bark furrow', a, d, n, t - .012, t + .012, MARGIN, MARGIN + .09, .47, .015, k.rot, .002)
    for i in range(10):
        x, y = rng.choice(WALL_CELLS)
        start = (x + rng.uniform(-.3, .3), y + rng.uniform(-.3, .3), .43)
        a = rng.uniform(0, math.tau)
        tapered_tube(c, 'Dry crack', [start, (start[0] + .22 * math.cos(a), start[1] + .22 * math.sin(a), .43)], [.012, .004], k.rot, 5)
    for x, y, r in ((-1.6, 1.6, .2), (1.55, -.6, .16), (.3, 1.7, .14), (-1.6, -.5, .15)):
        lump(c, k.moss, x, y, .44, r, r * .8, .05, rng)
    # Void fungus: shelf caps on the cut rim, glowing where the trunk meets the hollow.
    for x, y, r in ((-1.18, .8, .1), (-1.15, .55, .07), (1.2, .2, .09), (1.17, -.05, .065), (-.7, 1.18, .08),
                    (.4, 1.2, .1), (1.6, 1.6, .12), (-1.65, -.75, .08)):
        cap = c.ell('Void fungus cap', (x, y, .47), (r, r * .8, r * .4), k.cap)
        cap.rotation_euler.z = rng.uniform(0, math.pi)
        for j in range(3):
            c.ell('Pale mycelium', (x + rng.uniform(-r, r), y + rng.uniform(-r, r), .5), (.012, .012, .006), k.mycel)


def building_g(c, k, rng):
    """Brutstock: a clay mound of the brood; chamber holes, chimneys, glow deep inside."""
    path = centerline(.16)
    for x, y in path:
        for j in range(2):
            r = rng.uniform(.26, .34)
            c.ell('Brood clay', (x + rng.uniform(-.16, .16), y + rng.uniform(-.16, .16), .2), (r, r * rng.uniform(.9, 1.1), .24), k.clay)
    for x, y in path[::2]:
        r = rng.uniform(.14, .2)
        c.ell('Wet brood clay', (x + rng.uniform(-.18, .18), y + rng.uniform(-.18, .18), .36), (r, r, .1), k.clay_dark)
    for i, (x, y) in enumerate(path[1::2]):
        ox, oy = rng.uniform(-.18, .18), rng.uniform(-.18, .18)
        c.ell('Open brood cell', (x + ox, y + oy, .42), (.06, .05, .03), k.cell)
        if i % 2 == 0: c.ell('Void brood heart', (x + ox, y + oy, .43), (.025, .02, .01), k.glow)
    for x, y, h in ((-1.4, 1.55, .55), (1.45, 1.5, .62), (.1, 1.6, .5)):
        tapered_tube(c, 'Brood clay', [(x, y, .2), (x + .02, y, .2 + h * .6), (x + .03, y + .02, .2 + h)], [.22, .14, .06], k.clay, 12)
        c.ell('Open brood cell', (x + .03, y + .02, .2 + h), (.04, .04, .02), k.cell)


def building_h(c, k, rng):
    """Bunkerruine: a cracked war bunker in a U, overrun by black brood slime; wire and sandbags."""
    plate(c, 'Weathered bunker concrete', (0, 0, .19), inset_outline(MARGIN), .38, k.concrete, .03)
    for x, y in WALL_CELLS:
        plate(c, 'Stained bunker concrete', (0, 0, .385), [(x + px, y + py) for px, py in chamfered(.44, .02)], .01, k.concrete_dark, .003)
    for i in range(9):
        x, y = rng.choice(WALL_CELLS)
        pts = [(x + rng.uniform(-.4, .4), y + rng.uniform(-.4, .4), .4)]
        for s in range(3):
            pts.append((pts[-1][0] + rng.uniform(-.15, .15), pts[-1][1] + rng.uniform(-.15, .15), .4))
        tapered_tube(c, 'Concrete crack', pts, [.012, .01, .008, .003], k.seam, 5)
    for j in range(5):
        x0 = 1.75 + rng.uniform(-.1, .1)
        tapered_tube(c, 'Rusted rebar', [(x0, 1.75 - j * .06, .38), (x0 + .05, 1.78 - j * .06, .52)], [.012, .012], k.rebar, 5)
    for side in (-1, 1):
        for j in range(3):
            c.ell('Sandbag canvas', (side * (1.32 + j * .18), -.75, .45), (.1, .07, .05), k.sandbag)
    for i in range(14):
        loop = c.ell('Barbed wire', (-1.7 + i * .26, 1.82, .45), (.1, .03, .08), k.wire)
        loop.rotation_euler.z = .3
    # Brood slime spills over the walls from the pit side: the invasion reads at a glance.
    for x, y, r in ((-1.2, .5, .3), (-1.15, -.3, .22), (1.2, .7, .28), (-.6, 1.2, .26), (.5, 1.22, .3), (1.22, -.5, .2)):
        lump(c, k.slime, x, y, .39, r, r * .7, .05, rng)
        lump(c, k.slime_film, x + rng.uniform(-.05, .05), y + rng.uniform(-.05, .05), .42, r * .4, r * .3, .02, rng)
    for x, y in ((-1.25, .3), (.4, 1.25), (1.22, .55)):
        pts = [(x, y, .44), (x + rng.uniform(-.25, .25), y + rng.uniform(-.25, .25), .44), (x + rng.uniform(-.4, .4), y + rng.uniform(-.4, .4), .43)]
        tapered_tube(c, 'Void brood vein', pts, [.018, .012, .004], k.vein, 6)


def pit_e(c, k, rng):
    """Belly cavity: wet dark flesh with rib stumps and a clutch of brood sacs."""
    plate(c, 'Raw carcass flesh', (0, 0, -.02), square(), .04, k.flesh, .02)
    for j in range(10):
        lump(c, k.flesh, rng.uniform(-.7, .7), rng.uniform(-.7, .7), .02, rng.uniform(.18, .3), rng.uniform(.14, .24), .04, rng)
    for side in (-1, 1):
        for y in (-.5, .1, .7):
            tapered_tube(c, 'Bleached carcass bone', [(side * 1.0, y, .06), (side * .7, y - .05, .08), (side * .5, y - .1, .04)],
                         [.04, .03, .01], k.bone, 6)
    for x, y in ((.15, .2), (-.25, -.3), (.35, -.45)):
        for j in range(3):
            r = rng.uniform(.07, .1)
            lump(c, k.sac, x + rng.uniform(-.1, .1), y + rng.uniform(-.1, .1), .08, r, r * .9, r * .8, rng, 'Translucent brood egg')
    for i in range(3):
        c.ell('Void brood heart', (rng.uniform(-.4, .4), rng.uniform(-.4, .4), .05), (.05, .04, .01), k.glow)


def pit_f(c, k, rng):
    """Hollow of the stump: rotten mulch, mycelium threads, grubs and a few glowing caps."""
    plate(c, 'Rotten wood mulch', (0, 0, -.02), square(), .04, k.rot, .02)
    for j in range(16):
        ob = centred_plate(c, 'Rotten wood chip', (rng.uniform(-.85, .85), rng.uniform(-.85, .85), .03),
                           [(-.1, -.03), (.1, -.025), (.09, .03), (-.08, .025)], .02, k.bark, .005)
        ob.rotation_euler.z = rng.uniform(0, math.pi)
    for j in range(7):
        a = rng.uniform(0, math.tau)
        pts = [(rng.uniform(-.6, .6), rng.uniform(-.6, .6), .04)]
        for s in range(4):
            a += rng.uniform(-.7, .7)
            pts.append((pts[-1][0] + .16 * math.cos(a), pts[-1][1] + .16 * math.sin(a), .04))
        tapered_tube(c, 'Pale mycelium', pts, [.01, .008, .007, .005, .002], k.mycel, 5)
    for j in range(5):
        x, y = rng.uniform(-.5, .5), rng.uniform(-.5, .5)
        tapered_tube(c, 'Pale brood larva', [(x, y, .05), (x + .06, y + .04, .06), (x + .1, y + .1, .05)], [.035, .04, .025], k.larva, 8)
    for x, y, r in ((-.6, .6, .07), (.5, -.55, .06), (.65, .4, .05)):
        c.ell('Void fungus cap', (x, y, .06), (r, r * .8, r * .4), k.cap)


def pit_g(c, k, rng):
    """Honeycomb floor of brood cells: wax-capped, open with larvae, a few glowing deep."""
    plate(c, 'Wet brood clay', (0, 0, -.02), square(), .04, k.clay_dark, .02)
    r = .15
    rows = int(2.0 / (r * 1.5)) + 2
    for row in range(-rows, rows + 1):
        for col in range(-rows, rows + 1):
            x = col * r * math.sqrt(3) + (row % 2) * r * math.sqrt(3) / 2
            y = row * r * 1.5
            if abs(x) > .9 or abs(y) > .9: continue
            hexagon = [(x + r * .92 * math.cos(math.pi / 6 + i * math.pi / 3), y + r * .92 * math.sin(math.pi / 6 + i * math.pi / 3)) for i in range(6)]
            plate(c, 'Brood clay', (0, 0, .03), hexagon, .04, k.clay, .01)
            pick = rng.random()
            if pick < .4:
                c.ell('Brood wax cap', (x, y, .055), (r * .7, r * .7, .02), k.wax)
            elif pick < .8:
                c.ell('Open brood cell', (x, y, .052), (r * .62, r * .62, .015), k.cell)
                if pick < .55:
                    c.ell('Pale brood larva', (x, y, .06), (r * .35, r * .28, .02), k.larva)
            else:
                c.ell('Open brood cell', (x, y, .052), (r * .62, r * .62, .015), k.cell)
                c.ell('Void brood heart', (x, y, .056), (r * .3, r * .3, .01), k.glow)


def pit_h(c, k, rng):
    """Collapsed floor slab: cracked concrete sinks into a hole where brood slime wells up."""
    plate(c, 'Black brood slime', (0, 0, -.02), square(), .04, k.slime, .02)
    for x, y in ((-.62, .6), (.65, .55), (-.6, -.65), (.6, -.6)):
        pts = [(rng.uniform(-.3, -.2), rng.uniform(-.3, -.2)), (rng.uniform(.2, .3), rng.uniform(-.3, -.2)),
               (rng.uniform(.2, .3), rng.uniform(.2, .3)), (rng.uniform(-.3, -.2), rng.uniform(.2, .3))]
        ob = centred_plate(c, 'Sunken floor slab', (x, y, .02), pts, .04, k.concrete_dark, .01)
        ob.rotation_euler = (rng.uniform(-.12, .12), rng.uniform(-.12, .12), rng.uniform(-.3, .3))
    hole = []
    for i in range(12):
        a = i * math.tau / 12 + rng.uniform(-.15, .15)
        rr = rng.uniform(.38, .6)
        hole.append((.05 + rr * math.cos(a), -.05 + rr * .85 * math.sin(a)))
    plate(c, 'Black brood slime', (0, 0, .025), hole, .02, k.slime, .01)
    for x, y in hole[::2]:
        a = math.atan2(y, x)
        ob = centred_plate(c, 'Broken floor slab', (x * 1.15, y * 1.15, .05), [(-.16, -.09), (.15, -.1), (.13, .09), (-.12, .1)], .05, k.concrete, .01)
        ob.rotation_euler = (rng.uniform(-.3, .3), rng.uniform(.15, .35), a + math.pi / 2)
    for j in range(4):
        x, y = rng.uniform(-.7, .7), rng.uniform(-.7, .7)
        tapered_tube(c, 'Rusted rebar', [(x, y, .06), (x + rng.uniform(-.2, .2), y + rng.uniform(-.2, .2), .1)], [.012, .01], k.rebar, 5)
    for j in range(3):
        lump(c, k.slime_film, .05 + rng.uniform(-.25, .25), -.05 + rng.uniform(-.2, .2), .04, rng.uniform(.06, .12), .06, .015, rng)
    for i in range(2):
        c.ell('Void brood heart', (rng.uniform(-.2, .25), rng.uniform(-.25, .15), .037), (.06, .04, .01), k.glow)


BUILDINGS = {'e': building_e, 'f': building_f, 'g': building_g, 'h': building_h}
PITS = {'e': pit_e, 'f': pit_f, 'g': pit_g, 'h': pit_h}
