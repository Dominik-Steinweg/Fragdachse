"""Brutkadaver blockout (GDD Spawnbauwerk V1, concept a): a giant beast carcass curled into a C.

Blender supplies form, volume and the fit to the footprint; a Qwen paint-over in the style of the
chosen concept image supplies material and detail (scripts: export-spawn-structure.mjs, comfy).
Built opening south (-Y) on the canonical U: the back wall carries the open ribcage, the left arm
ends in the skull, the right arm in the tail; the brood nest (separate pit asset) fills the curl.
"""
import math
from dawn_parts import surface, tapered_tube
from spawn_structure_concepts import VOID_PRIMARY, damp, lump


def body_path(step=.08):
    """Rounded U through the wall centres: left arm up, arc over the back, right arm down."""
    pts = []
    corner = .75
    # The left arm starts at the neck; the skull (built separately) fills its lower cell.
    for i in range(int((1.5 - corner + .15) / step) + 1):
        pts.append((-1.5, -.15 + i * step))
    for i in range(1, 12):
        a = math.pi - i * (math.pi / 2) / 12
        pts.append((-1.5 + corner + corner * math.cos(a), 1.5 - corner + corner * math.sin(a)))
    for i in range(int((3.0 - 2 * corner) / step) + 1):
        pts.append((-1.5 + corner + i * step, 1.5))
    for i in range(1, 12):
        a = math.pi / 2 - i * (math.pi / 2) / 12
        pts.append((1.5 - corner + corner * math.cos(a), 1.5 - corner + corner * math.sin(a)))
    for i in range(int((1.5 - corner + .95) / step) + 1):
        pts.append((1.5, 1.5 - corner - i * step))
    return pts


def frame_at(pts, i):
    """Tangent and inward normal (toward the curl) at path index i."""
    a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
    tx, ty = b[0] - a[0], b[1] - a[1]
    length = math.hypot(tx, ty) or 1
    tx, ty = tx / length, ty / length
    # The path runs clockwise (left arm up, back to the right, right arm down): the curl is on its right.
    return (tx, ty), (ty, -tx)


class CarcassKit:
    def __init__(self, c, spec):
        lib = spec['model'].get('librarySurfaces', {})
        def m(name, rgb, wear=.3, emission=0):
            return surface(c, name, rgb, wear, emission, **lib.get(name, {}))
        self.hide = damp(m('Dead grey hide', (150, 140, 128), .25), .6)
        self.bone = m('Bleached carcass bone', (200, 190, 168), .3)
        self.dark = m('Opaque brood throat', (24, 14, 26), 0)
        self.flesh = damp(m('Raw carcass flesh', (70, 30, 50), .05), .45)
        self.glow = m('Void brood heart', VOID_PRIMARY, 0, .6)


def build_carcass(c, k, rng):
    pts = body_path()
    n = len(pts)
    spine_start, spine_end = int(n * .24), int(n * .78)
    # Body: heavy along the neck and flank, tapering into a thin tail on the right. Over the back
    # the hide only covers the spine side: the curl side lies open under the ribs.
    centre, radii = [], []
    for i in range(n):
        t = i / (n - 1)
        (tx, ty), (nx, ny) = frame_at(pts, i)
        x, y = pts[i]
        open_back = math.sin(math.pi * min(1, max(0, (i - spine_start) / (spine_end - spine_start)))) if spine_start <= i <= spine_end else 0
        shift = -.17 * open_back
        centre.append((x + nx * shift, y + ny * shift, .22))
        tail = max(0, (t - .72) / .28)
        radii.append(max(.06, (.46 - .2 * open_back) * (1 - .82 * tail ** 1.4)))
    body = tapered_tube(c, 'Dead grey hide', centre, radii, k.hide, 20)
    body.scale.z = .62
    # The rotted cavity under the ribs: dark flesh, read as a hollow in the beast's back.
    for i in range(spine_start + 2, spine_end - 2, 2):
        (tx, ty), (nx, ny) = frame_at(pts, i)
        x, y = pts[i]
        lump(c, k.dark, x + nx * .2, y + ny * .2, .08, .26, .3, .06, rng, 'Opaque brood throat', math.atan2(ty, tx))
        if i % 6 == 0: lump(c, k.flesh, x + nx * .24, y + ny * .24, .14, .1, .08, .04, rng)
    # Ribs rise from the spine on the outer side and arch over the cavity toward the nest.
    for i in range(spine_start, spine_end, 3):
        (tx, ty), (nx, ny) = frame_at(pts, i)
        x, y = pts[i]
        reach = .5 + .06 * math.sin(math.pi * (i - spine_start) / (spine_end - spine_start))
        rib = [(x - nx * .3, y - ny * .3, .3), (x - nx * .06, y - ny * .06, .5), (x + nx * .24, y + ny * .24, .44),
               (x + nx * reach, y + ny * reach, .16)]
        tapered_tube(c, 'Bleached carcass bone', rib, [.052, .048, .04, .014], k.bone, 10)
    # Spine ridge with short spikes on the outer flank.
    for i in range(int(n * .12), int(n * .9), 2):
        (tx, ty), (nx, ny) = frame_at(pts, i)
        x, y = pts[i]
        c.ell('Bleached carcass bone', (x - nx * .34, y - ny * .34, .3), (.055, .055, .045), k.bone)
        if i % 4 == 0:
            tapered_tube(c, 'Bleached carcass bone', [(x - nx * .36, y - ny * .36, .32), (x - nx * .5, y - ny * .5, .34)], [.032, .004], k.bone, 6)
    # Skull at the left end: long and flat, snout toward the opening, sockets on the flanks.
    sx, sy = -1.47, -.38
    c.ell('Dead grey hide', (sx, sy + .2, .2), (.34, .3, .2), k.hide)
    skull = c.ell('Bleached carcass bone', (sx, sy - .05, .26), (.27, .38, .18), k.bone)
    snout = c.ell('Bleached carcass bone', (sx + .04, sy - .42, .18), (.15, .2, .11), k.bone)
    for side in (-1, 1):
        sock = c.ell('Opaque brood throat', (sx + side * .21, sy - .06, .3), (.05, .12, .06), k.dark)
        tapered_tube(c, 'Bleached carcass bone', [(sx + side * .12, sy + .28, .36), (sx + side * .3, sy + .48, .3)], [.05, .01], k.bone, 8)
    for j in range(5):
        tapered_tube(c, 'Bleached carcass bone', [(sx + .17, sy - .32 - j * .1, .13), (sx + .23, sy - .35 - j * .1, .1)], [.022, .004], k.bone, 6)
    # Tail: thin vertebrae trailing toward the opening on the right.
    for j in range(6):
        c.ell('Bleached carcass bone', (1.49 + .01 * j, -.55 - j * .07, .12 - j * .012), (.055 - j * .006, .045, .035), k.bone)
    # A few brood sacs bursting from torn hide, faint violet glow.
    for i in (int(n * .3), int(n * .55), int(n * .72)):
        (tx, ty), (nx, ny) = frame_at(pts, i)
        x, y = pts[i]
        c.ell('Raw carcass flesh', (x + nx * .32, y + ny * .32, .3), (.09, .08, .07), k.flesh)
        c.ell('Void brood heart', (x + nx * .32, y + ny * .32, .36), (.03, .03, .02), k.glow)
