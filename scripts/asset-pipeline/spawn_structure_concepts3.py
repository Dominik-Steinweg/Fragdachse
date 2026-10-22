"""Third design round of the spawn structure (user 2026-10-22: organic like the carcass, try a maw).

Footprint contract unchanged: the U of 8 wall cells is the solid body, the 2 x 2 pit in its opening
is walkable; pivot = pit centre, 1 BU = 1 cell, built opening south (-Y). Maws keep their teeth on
the three inner sides only, so the open side reads as the mouth and nothing reads as a ring.

    I  Kadaver II       one heavy carcass with a clear rib cage; the opened chest holds the brood
    J  Grabwurm-Maul    a buried worm's chitin head (back wall) and mandibles (arms); throat in the pit
    K  Brutmutter       a segmented brood queen curled into the U; eggs glow through her skin
    M  Fleischrachen    a flesh mound with lip folds and rows of teeth; the tongue lolls toward the base
"""
import math
from dawn_parts import surface, tapered_tube
from enemy_parts_b import plate
from spawn_structure_concepts import VOID_PRIMARY, damp, lump, centred_plate


def centerline(step=.2, tip=-.85):
    """Wall centre path of the U, left arm tip -> back wall -> right arm tip."""
    pts = []
    count = int((1.5 - tip) / step)
    for i in range(count + 1): pts.append((-1.5, tip + i * (1.5 - tip) / count))
    for i in range(1, int(3.0 / step)): pts.append((-1.5 + i * 3.0 / int(3.0 / step), 1.5))
    for i in range(count + 1): pts.append((1.5, 1.5 - i * (1.5 - tip) / count))
    return pts


def inward(x, y):
    """Unit vector from a wall centre point toward the pit (inner side of the wall)."""
    if y > 1.2 and abs(x) < 1.25: return (0.0, -1.0)
    return (1.0 if x < 0 else -1.0, 0.0)


def square(half=1.04):
    return [(-half, -half), (half, -half), (half, half), (-half, half)]


class ConceptKit3:
    def __init__(self, c, spec):
        lib = spec['model'].get('librarySurfaces', {})
        def m(name, rgb, wear=.3, emission=0):
            return surface(c, name, rgb, wear, emission, **lib.get(name, {}))
        self.hide = damp(m('Dead grey hide', (68, 58, 66), .2), .55)
        self.hide_dark = damp(m('Dark leathery hide', (44, 36, 44), .15), .5)
        self.flesh = damp(m('Raw carcass flesh', (90, 34, 54), .08), .42, .16)
        self.gum = damp(m('Wet violet gum', (104, 40, 82), .05), .38, .22)
        self.tongue = damp(m('Monster tongue', (122, 58, 92), .05), .36, .25)
        self.throat = m('Opaque brood throat', (12, 6, 18), 0)
        self.bone = m('Bleached carcass bone', (196, 186, 162), .3)
        self.tooth = m('Yellowed monster tooth', (206, 192, 158), .25)
        self.chitin = damp(m('Black chitin plate', (30, 26, 32), .2), .3, .3)
        self.chitin_edge = m('Chitin ridge', (64, 54, 58), .3)
        self.eye = damp(m('Glossy dead eye', (10, 8, 14), 0), .1, .6)
        self.grub = damp(m('Translucent grub skin', (150, 118, 150), .05), .4, .25)
        self.grub_crease = m('Grub segment crease', (78, 52, 78), .05)
        self.sac = damp(m('Translucent brood egg', (70, 36, 88), .08), .4)
        self.shell = m('Hatched egg shell', (176, 160, 168), .2)
        self.slime = damp(m('Black brood slime', (22, 10, 28), .02), .3, .3)
        self.glow = m('Void brood heart', VOID_PRIMARY, 0, .7)
        self.vein = m('Void brood vein', (100, 34, 140), 0, .35)


def body_tube(c, mat, path, radius, z, rng, jitter=.03, name='Carcass body'):
    pts = [(x + rng.uniform(-jitter, jitter), y + rng.uniform(-jitter, jitter), z) for x, y in path]
    ob = tapered_tube(c, name, pts, [radius * rng.uniform(.94, 1.04) for _ in pts], mat, 16)
    ob.scale.z = .55
    return ob


def teeth(c, k, rng, along, size=1.0, rows=1, broken=.15):
    """Teeth on the inner edge of the U, pointing into the pit; `along` are wall-centre points."""
    for x, y in along:
        ix, iy = inward(x, y)
        for row in range(rows):
            base_off = .22 + row * .1
            if rng.random() < broken: continue
            bx, by = x + ix * base_off + rng.uniform(-.03, .03), y + iy * base_off + rng.uniform(-.03, .03)
            length = rng.uniform(.18, .28) * size * (1 - row * .3)
            # Teeth stop at the pit edge: the hitbox stays the wall, the mouth stays walkable.
            reach = min(length, .5 - base_off + .06)
            tip = (bx + ix * reach + rng.uniform(-.03, .03), by + iy * reach + rng.uniform(-.03, .03), .2)
            tapered_tube(c, 'Yellowed monster tooth', [(bx - ix * .08, by - iy * .08, .3), (bx, by, .32), ((bx + tip[0]) / 2, (by + tip[1]) / 2, .28), tip],
                         [.06 * size, .065 * size, .04 * size, .004], k.tooth, 8)


# ── I Kadaver II ─────────────────────────────────────────────────────────────────────────────

def building_i(c, k, rng):
    path = centerline(.15)
    body_tube(c, k.hide, path, .46, .2, rng)
    for x, y in path[::2]:
        lump(c, k.hide_dark, x + rng.uniform(-.1, .1), y + rng.uniform(-.1, .1), .38, rng.uniform(.14, .22), rng.uniform(.12, .18), .06, rng)
    # Thick spine on the outer flank.
    for x, y in path[1:-1:2]:
        ix, iy = inward(x, y)
        c.ell('Bleached carcass bone', (x - ix * .3, y - iy * .3, .42), (.12, .12, .08), k.bone)
    # The chest is torn open on the pit side: raw flesh between the ribs.
    for x, y in path[2:-2:2]:
        ix, iy = inward(x, y)
        lump(c, k.flesh, x + ix * .2, y + iy * .2, .36, .16, .14, .07, rng)
    # Heavy ribs arch from the spine over the body and hook down into the pit edge.
    for x, y in path[1:-1:3]:
        ix, iy = inward(x, y)
        px, py = -iy, ix
        pts = [(x - ix * .32, y - iy * .32, .42), (x - ix * .05 + px * .03, y - iy * .05 + py * .03, .62),
               (x + ix * .28 + px * .05, y + iy * .28 + py * .05, .5), (x + ix * .46 + px * .06, y + iy * .46 + py * .06, .16)]
        tapered_tube(c, 'Bleached carcass bone', pts, [.07, .06, .045, .018], k.bone, 10)
    for x, y in ((-1.2, .45), (1.22, -.1), (-.45, 1.2), (.55, 1.22), (1.2, .85)):
        for j in range(3):
            r = rng.uniform(.06, .09)
            lump(c, k.sac, x + rng.uniform(-.07, .07), y + rng.uniform(-.07, .07), .42, r, r * .9, r * .8, rng, 'Translucent brood egg')
        c.ell('Void brood heart', (x, y, .5), (.03, .03, .02), k.glow)


def pit_i(c, k, rng):
    plate(c, 'Raw carcass flesh', (0, 0, -.02), square(), .04, k.flesh, .02)
    for j in range(8):
        lump(c, k.gum, rng.uniform(-.65, .65), rng.uniform(-.65, .65), .03, rng.uniform(.18, .28), rng.uniform(.14, .22), .05, rng)
    for (x, y) in ((-.3, .35), (.35, .1), (-.1, -.4)):
        for j in range(4):
            r = rng.uniform(.07, .1)
            lump(c, k.sac, x + rng.uniform(-.12, .12), y + rng.uniform(-.12, .12), .09, r, r * .9, r * .8, rng, 'Translucent brood egg')
    for j in range(3):
        c.ell('Void brood heart', (rng.uniform(-.4, .4), rng.uniform(-.4, .4), .06), (.05, .04, .01), k.glow)


# ── J Grabwurm-Maul ──────────────────────────────────────────────────────────────────────────

def building_j(c, k, rng):
    # Head carapace over the back wall: overlapping chitin plates, ridges and a cluster of eyes.
    for i, x in enumerate((-1.45, -.75, 0, .75, 1.45)):
        w = .5 if abs(x) > 1 else .42
        ob = centred_plate(c, 'Black chitin plate', (x, 1.52, .22 + (.06 if abs(x) < .1 else 0)),
                           [(-w, -.4), (w, -.42), (w * .9, .42), (-w * .9, .44)], .38, k.chitin, .12)
        ob.rotation_euler.z = rng.uniform(-.05, .05)
        tapered_tube(c, 'Chitin ridge', [(x - w * .7, 1.82, .42), (x, 1.88, .46), (x + w * .7, 1.82, .42)], [.03, .04, .03], k.chitin_edge, 8)
    for x, y, r in ((-.32, 1.2, .07), (-.18, 1.25, .05), (.32, 1.2, .07), (.18, 1.25, .05), (-.05, 1.3, .035), (.05, 1.3, .035)):
        c.ell('Glossy dead eye', (x, y, .44), (r, r, r * .7), k.eye)
        c.ell('Void brood heart', (x + r * .3, y + r * .3, .44 + r * .6), (r * .2, r * .2, .01), k.glow)
    # Mandibles: thick curved jaws along the arms, hooking toward each other at the opening.
    for side in (-1, 1):
        pts = [(side * 1.5, 1.2, .26), (side * 1.55, .5, .28), (side * 1.52, -.2, .26), (side * 1.4, -.7, .22), (side * 1.12, -.92, .16)]
        tapered_tube(c, 'Black chitin plate', pts, [.46, .44, .38, .28, .1], k.chitin, 16).scale.z = .6
        for j, (x, y, z) in enumerate(pts[:-1]):
            tapered_tube(c, 'Chitin ridge', [(x - side * .25, y, .44), (x - side * .3, y - .2, .4)], [.025, .015], k.chitin_edge, 6)
    # Serrated teeth on the inner edges of both mandibles and under the head.
    teeth(c, k, rng, [(-1.5, y) for y in (.85, .5, .15, -.2, -.55)] + [(1.5, y) for y in (.85, .5, .15, -.2, -.55)], 1.5, 1, .05)
    teeth(c, k, rng, [(x, 1.5) for x in (-.75, -.35, .35, .75)], 1.2, 1, .1)
    for x, y in ((-1.62, .2), (1.6, .9), (1.58, -.3)):
        tapered_tube(c, 'Void brood vein', [(x, y, .46), (x + rng.uniform(-.1, .1), y + .3, .44)], [.02, .006], k.vein, 6)


def pit_maw(c, k, rng, tongue_tip=-.95):
    """Mouth floor: gums at the walls, a dark gullet at the back, the tongue toward the opening."""
    plate(c, 'Wet violet gum', (0, 0, -.02), square(), .04, k.gum, .02)
    for j in range(10):
        x = rng.choice((-1, 1)) * rng.uniform(.65, .95)
        lump(c, k.gum, x, rng.uniform(-.9, .9), .03, rng.uniform(.12, .2), rng.uniform(.12, .2), .06, rng)
    gullet = [(-.45, .55), (-.2, .44), (.18, .42), (.48, .52), (.5, .82), (.2, .98), (-.2, .99), (-.5, .84)]
    plate(c, 'Opaque brood throat', (0, 0, .03), gullet, .02, k.throat, .02)
    c.ell('Void brood heart', (0, .75, .035), (.2, .08, .005), k.glow)
    pts = [(0, .45, .07), (.02, .1, .08), (-.02, -.3, .07), (.03, -.65, .06), (0, tongue_tip, .04)]
    tongue = tapered_tube(c, 'Monster tongue', pts, [.28, .33, .32, .27, .16], k.tongue, 16)
    tongue.scale.z = .3
    tapered_tube(c, 'Grub segment crease', [(0, .35, .12), (0, -.2, .12), (0, -.7, .09)], [.02, .02, .01], k.grub_crease, 6)
    for j in range(4):
        x = rng.uniform(-.6, .6)
        tapered_tube(c, 'Black brood slime', [(x, .6, .06), (x + rng.uniform(-.1, .1), .1, .05), (x + rng.uniform(-.2, .2), -.3, .04)],
                     [.015, .01, .004], k.slime, 6)


def pit_j(c, k, rng):
    pit_maw(c, k, rng)


# ── K Brutmutter ─────────────────────────────────────────────────────────────────────────────

def building_k(c, k, rng):
    path = centerline(.34, -.8)
    # Segmented abdomen curled through the U; segments swell toward the back wall.
    for i, (x, y) in enumerate(path):
        swell = .82 + .18 * math.sin(math.pi * i / (len(path) - 1))
        ix, iy = inward(x, y)
        seg = c.ell('Translucent grub skin', (x, y, .2), (.44 * swell if ix else .3, .44 * swell if iy else .3, .3 * swell), k.grub)
        seg.rotation_euler.z = rng.uniform(-.05, .05)
        if 0 < i < len(path) - 1:
            px, py = -iy, ix
            nx, ny = path[i + 1]
            mx, my = (x + nx) / 2, (y + ny) / 2
            tapered_tube(c, 'Grub segment crease', [(mx - ix * .4, my - iy * .4, .3), (mx, my, .42), (mx + ix * .4, my + iy * .4, .3)],
                         [.03, .035, .03], k.grub_crease, 8)
        # Eggs glow through the skin on the pit side.
        if i % 2 == 0:
            c.ell('Void brood heart', (x + ix * .15, y + iy * .15, .4), (.07, .07, .02), k.glow)
    # Small head with mandibles at the left tip, the tail tip at the right.
    hx, hy = -1.5, -.85
    c.ell('Black chitin plate', (hx, hy, .2), (.28, .22, .2), k.chitin)
    for side in (-1, 1):
        tapered_tube(c, 'Black chitin plate', [(hx + side * .12, hy - .12, .2), (hx + side * .16, hy - .3, .18), (hx + side * .05, hy - .4, .16)],
                     [.05, .035, .006], k.chitin, 8)
    tapered_tube(c, 'Translucent grub skin', [(1.5, -.6, .2), (1.48, -.85, .16), (1.4, -.93, .1)], [.2, .12, .04], k.grub, 12)
    # Stubby legs along the outer flank.
    for x, y in path[1:-1]:
        ix, iy = inward(x, y)
        tapered_tube(c, 'Chitin ridge', [(x - ix * .32, y - iy * .32, .16), (x - ix * .44, y - iy * .44, .1)], [.03, .015], k.chitin_edge, 6)


def pit_k(c, k, rng):
    plate(c, 'Black brood slime', (0, 0, -.02), square(), .04, k.slime, .02)
    for j in range(30):
        x, y = rng.uniform(-.7, .7), rng.uniform(-.7, .7)
        r = rng.uniform(.07, .11)
        if rng.random() < .2:
            for s in range(3):
                ob = centred_plate(c, 'Hatched egg shell', (x + rng.uniform(-.06, .06), y + rng.uniform(-.06, .06), .04),
                                   [(-.05, -.02), (.05, -.03), (.04, .03), (-.04, .02)], .015, k.shell, .004)
                ob.rotation_euler.z = rng.uniform(0, math.pi)
            continue
        lump(c, k.sac, x, y, .06, r, r * .9, r * .75, rng, 'Translucent brood egg')
        if rng.random() < .3: c.ell('Void brood heart', (x, y, .1), (r * .4, r * .4, .01), k.glow)


# ── M Fleischrachen ──────────────────────────────────────────────────────────────────────────

def building_m(c, k, rng):
    path = centerline(.16)
    body_tube(c, k.hide_dark, path, .47, .18, rng, .02, 'Flesh mound')
    for x, y in path[::2]:
        lump(c, k.hide, x + rng.uniform(-.14, .14), y + rng.uniform(-.14, .14), .34, rng.uniform(.14, .2), rng.uniform(.12, .18), .07, rng)
    # Rolled lips along the inner edge: wet gums show where the mouth begins.
    lip = [(x + inward(x, y)[0] * .28, y + inward(x, y)[1] * .28) for x, y in path[1:-1]]
    tapered_tube(c, 'Wet violet gum', [(x, y, .26) for x, y in lip], [.13] * len(lip), k.gum, 12).scale.z = .7
    # Two ragged rows of teeth on the three inner sides.
    along = [(-1.5, y) for y in (1.0, .7, .4, .1, -.2, -.5, -.75)] + [(1.5, y) for y in (1.0, .7, .4, .1, -.2, -.5, -.75)] \
        + [(x, 1.5) for x in (-.85, -.5, -.15, .2, .55, .85)]
    teeth(c, k, rng, along, 1.4, 2, .12)
    for x, y, r in ((-1.62, 1.6, .09), (1.6, 1.62, .08), (-1.68, .3, .07), (1.66, -.4, .07), (.3, 1.75, .08)):
        c.ell('Translucent brood egg', (x, y, .4), (r, r, r * .7), k.sac)
        c.ell('Void brood heart', (x, y, .45), (r * .35, r * .35, .01), k.glow)
    for x, y in ((-1.7, 1.0), (1.7, .2), (-.6, 1.75)):
        tapered_tube(c, 'Void brood vein', [(x, y, .42), (x + rng.uniform(-.2, .2), y + rng.uniform(-.25, .25), .4)], [.02, .006], k.vein, 6)


def pit_m(c, k, rng):
    pit_maw(c, k, rng, -1.02)


BUILDINGS = {'i': building_i, 'j': building_j, 'k': building_k, 'm': building_m}
PITS = {'i': pit_i, 'j': pit_j, 'k': pit_k, 'm': pit_m}
