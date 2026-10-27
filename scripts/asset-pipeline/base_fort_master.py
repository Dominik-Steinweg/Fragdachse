"""Palisadenschanze master: the persistent base core as one coherent fort (1 BU = 1 m = 32 px).

Built after the chosen reference (refs round 5, variant 5): four L-shaped bastions of individual
mossy sharpened stakes round flat plank decks, small uniform square gate posts with a lantern on
top at both ends of every arm, many small torches on brackets outside the palisade, and two thin
dark doorsteps across every gate. The core never changes shape, so it is built once as a whole
instead of from the cell kit; blocking cells (decks, palisade) stay clearly apart from the walkable
ground. Every deck centre stays clear, because each cell is a turret place.

The ground belongs to the asset, but only as translucent layers over the game's own gravel: decades of
light traffic have worn broad, softly bounded bands of paler compacted ground through all four gates
and round the stone ring, made of countless faint overlapping marks; loose pebbles lie along their
edges; moss grows in patches over the courtyard corners and the palisade feet; stones, broken plank ends and chips lie at the inner
corners and the gate posts. Ground objects carry `fdGround` so a runtime pass can split them from
the structure. The north-west quarter is authored once and turned by quarter turns.
Ground textures: art/poc/base-rustic/{path-ref5,moss-ref5}.png, cut from the chosen reference and made
seamless, so path and meadow match it.
"""
import math
import random
from pathlib import Path
from base_structure_parts import Batch, mesh_object, cone
from dawn_parts import linear

DECK, WALL = .74, .26
LINE = 3.5 - WALL / 2           # palisade centre line on the outer sides
INNER = 2.5                     # courtyard edge
GATE = 1.5 + WALL / 2           # gate post line: the arm ends, either side of the 3-cell gates
LOG_R, LOG_PITCH, LOG_H = .11, .22, 1.6
POST_R, POST_H = .09, 1.45
TEXTURES = Path(__file__).resolve().parents[2] / 'art' / 'poc' / 'base-rustic'


class Turn:
    """Quarter turn about the core centre; Euler XYZ composes as Rz(k) applied after the local one."""
    def __init__(self, k):
        self.k = k
        self.c, self.s = round(math.cos(k * math.pi / 2)), round(math.sin(k * math.pi / 2))

    def p(self, x, y, z=0.0):
        return (self.c * x - self.s * y, self.s * x + self.c * y, z)

    def r(self, rx=0.0, ry=0.0, rz=0.0):
        return (rx, ry, rz + self.k * math.pi / 2)


def wobble(x, y, seed=0):
    """Cheap smooth 2-D noise in -1..1 for rims and heights."""
    return (math.sin(x * 2.3 + seed) * math.cos(y * 1.7 - seed * .7) + .6 * math.sin(x * 5.1 - y * 4.3 + seed * 1.3)) / 1.6


def smooth(f):
    f = min(1.0, max(0.0, f))
    return f * f * (3 - 2 * f)


def image_material(name, file, tile, value=1.0, saturation=1.0, tint=None, tint_amount=0.0, dark=(70, 60, 48), patchy=0.0):
    """Ground from a seamless photo texture in world metres; FD_Alpha gives coverage, FD_Dark wear.

    `patchy` lets the texture's own brightness break the cover up, so the game ground shows through
    the darker parts of the texture.
    """
    import bpy
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    n, l = mat.node_tree.nodes, mat.node_tree.links
    bsdf = n['Principled BSDF']; bsdf.inputs['Roughness'].default_value = .93
    geo = n.new('ShaderNodeNewGeometry')
    scale = n.new('ShaderNodeVectorMath'); scale.operation = 'SCALE'; scale.inputs['Scale'].default_value = 1 / tile
    l.new(geo.outputs['Position'], scale.inputs[0])
    image = bpy.data.images.load(str(TEXTURES / file), check_existing=True)
    image.pack()
    tex = n.new('ShaderNodeTexImage'); tex.image = image; tex.extension = 'REPEAT'; tex.interpolation = 'Cubic'
    l.new(scale.outputs[0], tex.inputs['Vector'])
    hsv = n.new('ShaderNodeHueSaturation'); hsv.inputs['Value'].default_value = value; hsv.inputs['Saturation'].default_value = saturation
    l.new(tex.outputs['Color'], hsv.inputs['Color'])
    color = hsv.outputs['Color']
    if tint:
        mix = n.new('ShaderNodeMixRGB'); mix.inputs[0].default_value = tint_amount
        l.new(color, mix.inputs[1]); mix.inputs[2].default_value = (*linear(tint), 1)
        color = mix.outputs['Color']
    shade = n.new('ShaderNodeAttribute'); shade.attribute_name = 'FD_Dark'
    darken = n.new('ShaderNodeMixRGB'); darken.blend_type = 'MULTIPLY'
    l.new(shade.outputs['Fac'], darken.inputs[0]); l.new(color, darken.inputs[1]); darken.inputs[2].default_value = (*linear(dark), 1)
    l.new(darken.outputs['Color'], bsdf.inputs['Base Color'])
    alpha = n.new('ShaderNodeAttribute'); alpha.attribute_name = 'FD_Alpha'
    bw = n.new('ShaderNodeRGBToBW'); l.new(tex.outputs['Color'], bw.inputs[0])
    if patchy:
        spread = n.new('ShaderNodeMapRange'); spread.clamp = True
        spread.inputs['From Min'].default_value = .5 - .5 / patchy; spread.inputs['From Max'].default_value = .5 + .5 / patchy
        l.new(bw.outputs[0], spread.inputs['Value'])
        both = n.new('ShaderNodeMath'); both.operation = 'MULTIPLY'
        l.new(alpha.outputs['Fac'], both.inputs[0]); l.new(spread.outputs['Result'], both.inputs[1])
        l.new(both.outputs[0], bsdf.inputs['Alpha'])
    else:
        l.new(alpha.outputs['Fac'], bsdf.inputs['Alpha'])
    bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .35; bump.inputs['Distance'].default_value = .01
    l.new(bw.outputs[0], bump.inputs['Height']); l.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def ground_tint(name, rgb):
    """Flat matte colour whose coverage comes only from FD_Alpha: wear marks over the game ground."""
    import bpy
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    n, l = mat.node_tree.nodes, mat.node_tree.links
    bsdf = n['Principled BSDF']; bsdf.inputs['Roughness'].default_value = .95
    bsdf.inputs['Base Color'].default_value = (*linear(rgb), 1)
    alpha = n.new('ShaderNodeAttribute'); alpha.attribute_name = 'FD_Alpha'
    l.new(alpha.outputs['Fac'], bsdf.inputs['Alpha'])
    return mat


def turned_sheet(c, name, k, x0, y0, x1, y1, sample, mat, step=.07):
    """ground_sheet over a local rectangle of quarter turn k."""
    t, inv = Turn(k), Turn(-k)
    a, b = t.p(x0, y0)[:2], t.p(x1, y1)[:2]
    return ground_sheet(c, name, min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]),
                        lambda x, y: sample(*inv.p(x, y)[:2]), mat, step)


def ground_sheet(c, name, x0, y0, x1, y1, sample, mat, step=.08):
    """Grid over a world rectangle; sample(x, y) -> (z, alpha, dark) or None to leave a hole."""
    nx, ny = max(1, round((x1 - x0) / step)), max(1, round((y1 - y0) / step))
    verts, faces, alphas, darks, index = [], [], [], [], {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            x, y = x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny
            got = sample(x, y)
            if got is None: continue
            index[i, j] = len(verts)
            verts.append((x, y, got[0])); alphas.append(got[1]); darks.append(got[2])
    for j in range(ny):
        for i in range(nx):
            quad = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            if all(k in index for k in quad) and max(alphas[index[k]] for k in quad) > .01:
                faces.append(tuple(index[k] for k in quad))
    ob = mesh_object(c, name, verts, faces, mat, True)
    ob.visible_shadow = False                   # ground layers lie flat: they never shade the ground below
    for attr, values in (('FD_Alpha', alphas), ('FD_Dark', darks)):
        layer = ob.data.color_attributes.new(attr, 'FLOAT_COLOR', 'POINT')
        for v, value in zip(layer.data, values): v.color = (value, value, value, 1)
    ob['fdGround'] = True
    return ob


def path_wear(x, y):
    """How worn the ground is: broad bands through all four gates and round the stone ring."""
    w = .08 * wobble(x * .8, y * .8, 3)
    ns = smooth((1.5 + w - abs(x)) / .5) * smooth((5.4 - abs(y)) / 1.3)
    ew = smooth((1.5 + w - abs(y)) / .5) * smooth((5.4 - abs(x)) / 1.3)
    ring = smooth((2.0 + w - math.hypot(x, y)) / .55)
    return max(ns, ew, ring)


class FortMaster:
    def __init__(self, c, m, ground='gravel', stage=0, seed=7):
        self.c, self.b, self.rng = c, Batch(c), random.Random(seed)
        self.sockets = {}
        self.p = dict(
            bark=m('Bark log', (92, 74, 54), .35), cut=m('Cut log end', (150, 126, 92), .3), mossy=m('Stake moss tip', (78, 94, 44), .3),
            plank=m('Silvered timber', (94, 86, 74), .3), oak=m('Weathered oak', (76, 62, 46), .32), tar=m('Dark tarred timber', (56, 48, 40), .2),
            iron=m('Forged iron', (86, 90, 88), .25), dark=m('Soot iron', (40, 41, 37), .18), stone=m('Fieldstone', (128, 124, 112), .4),
            ringstone=m('Wall walk flagstone', (122, 118, 108), .35), chip=m('Wood chips', (150, 120, 84), .25),
            ember=m('Separate forge ember', (230, 96, 24), .05, .9), coal=m('Forge coal', (30, 29, 25), .1),
            brass=m('Worn brass fittings', (150, 112, 58), .3), lamp=m('Separate lantern emission', (244, 153, 53), .01, .7),
            moss=m('Stake moss', (70, 92, 38), .3))
        # Partial covers over the game's gravel: the path pales and compacts it, moss grows over it in patches.
        self.path = image_material('Worn path earth', 'path-ref5.png', 1.35, .95, .95, patchy=1.6)
        self.mossmat = image_material('Moss carpet', 'moss-ref5.png', 1.3, 1.7, .9, (118, 108, 78), .3, (40, 46, 28), patchy=2.2)
        self.rut = ground_tint('Trodden earth', (78, 66, 50))

    def socket(self, name, xyz):
        self.sockets[f'{name}_{len(self.sockets)}'] = xyz

    # -- parts ------------------------------------------------------------------------
    def stake(self, t, x, y, h=LOG_H, r=None):
        rng, b = self.rng, self.b
        r = r or LOG_R + rng.uniform(-.012, .01)
        h += rng.uniform(-.06, .06)
        b.cylinder(t.p(x, y, h / 2), r, h, self.p['bark'], 12, .01, None, rng.uniform(0, 1))
        px, py, _ = t.p(x + rng.uniform(-.008, .008), y + rng.uniform(-.008, .008))
        tip = 'mossy' if rng.random() < .55 else 'cut'
        cone(self.c, 'Sharpened stake tip', (px, py), r, h, h + rng.uniform(.16, .22), self.p[tip], 10, 0, rng.uniform(0, 1))
        a = rng.uniform(0, math.tau)                                  # moss cushion on the stake shoulder
        b.ell(t.p(x + r * .45 * math.cos(a), y + r * .45 * math.sin(a), h - .01), (r * .8, r * .65, .035), self.p['moss'], 10, 4)

    def stakes(self, t, a, b, fixed, along_x):
        n = max(1, round(abs(b - a) / LOG_PITCH))
        for i in range(n):
            v = a + (b - a) * (i + .5) / n
            self.stake(t, *((v, fixed) if along_x else (fixed, v)))

    def post(self, t, x, y):
        """Small square gate post, iron-banded, a lantern standing on top."""
        b, p = self.b, self.p
        b.box(t.p(x, y, POST_H / 2), (2 * POST_R, 2 * POST_R, POST_H), p['oak'], .012, t.r(), .006, self.rng)
        b.box(t.p(x, y, POST_H + .02), (2 * POST_R + .03, 2 * POST_R + .03, .04), p['tar'], .005, t.r())
        b.box(t.p(x, y, POST_H - .25), (2 * POST_R + .015, 2 * POST_R + .015, .04), p['iron'], .003, t.r())
        if self.rng.random() < .6:
            b.ell(t.p(x - .03, y + .03, POST_H + .045), (.06, .05, .015), p['moss'], 8, 3)
        self.lantern(t, x, y, POST_H + .04)

    def lantern(self, t, x, y, z):
        b, p = self.b, self.p
        b.box(t.p(x, y, z + .02), (.13, .13, .04), p['dark'], .006, t.r())
        b.cylinder(t.p(x, y, z + .1), .05, .12, p['lamp'], 10, 0)
        for cx, cy in ((-.055, -.055), (.055, -.055), (.055, .055), (-.055, .055)):
            b.box(t.p(x + cx, y + cy, z + .1), (.016, .016, .13), p['dark'], 0, t.r())
        b.box(t.p(x, y, z + .175), (.14, .14, .025), p['dark'], .006, t.r())
        self.socket('lamp', t.p(x, y, z + .1))

    def torch(self, t, x, y, outward):
        """Small torch on an iron bracket fixed to the outside of the palisade."""
        b, p, rng = self.b, self.p, self.rng
        z = 1.18 + rng.uniform(-.04, .04)
        ox, oy = outward
        b.rod(t.p(x - ox * .12, y - oy * .12, z - .1), t.p(x, y, z - .1), .012, p['dark'], 6)
        b.rod(t.p(x - ox * .02, y - oy * .02, z - .26), t.p(x + ox * .015, y + oy * .015, z), .018, p['oak'], 6)
        b.cylinder(t.p(x + ox * .015, y + oy * .015, z + .015), .034, .05, p['iron'], 10, .004)
        b.ell(t.p(x + ox * .015, y + oy * .015, z + .05), (.026, .026, .03), p['ember'], 8, 4)
        self.socket('torch', t.p(x + ox * .015, y + oy * .015, z + .1))

    def deck(self, t, x0, y0, x1, y1, boards_along_y):
        """Plank deck on a tarred frame; staggered butt joints, the odd darker board, nail heads."""
        b, rng, p = self.b, self.rng, self.p
        z = DECK
        b.box(t.p((x0 + x1) / 2, (y0 + y1) / 2, z / 2 - .03), (x1 - x0, y1 - y0, z - .06), p['tar'], .01, t.r())
        span = (x0, x1) if boards_along_y else (y0, y1)
        run = (y0, y1) if boards_along_y else (x0, x1)
        u = span[0]
        while u < span[1] - .03:
            w = min(.14, span[1] - u)
            v = run[0]
            while v < run[1] - .03:
                length = min(rng.uniform(.7, 1.5), run[1] - v)
                mat = p['oak'] if rng.random() < .35 else p['plank']
                cx, cy = ((u + w / 2, v + length / 2) if boards_along_y else (v + length / 2, u + w / 2))
                size = ((w - .016, length - .014, .045) if boards_along_y else (length - .014, w - .016, .045))
                b.box(t.p(cx, cy, z - .022 + rng.uniform(0, .006)), size, mat, .006, t.r(), .005, rng)
                for end in (v + .05, v + length - .05):
                    for side in (-.035, .035):
                        nx, ny = ((u + w / 2 + side, end) if boards_along_y else (end, u + w / 2 + side))
                        b.cylinder(t.p(nx, ny, z + .002), .009, .006, p['dark'], 6, 0)
                if rng.random() < .12:                                # moss in the board gaps
                    mx, my = ((u + .01, v + length * rng.uniform(.2, .8)) if boards_along_y else (v + length * rng.uniform(.2, .8), u + .01))
                    b.ell(t.p(mx, my, z + .004), (.05, .03, .008) if not boards_along_y else (.03, .05, .008), p['moss'], 8, 3)
                v += length
            u += w

    def beam(self, t, a, b_, z, width, height, mat=None):
        """A squared timber between two plan points; z is its top."""
        (ax, ay), (bx, by) = a, b_
        length = math.hypot(bx - ax, by - ay)
        rz = math.atan2(by - ay, bx - ax)
        self.b.box(t.p((ax + bx) / 2, (ay + by) / 2, z - height / 2), (length, width, height), mat or self.p['tar'], .008, t.r(0, 0, rz))

    # -- one quarter: corner (-3, 3), arms (-2, 3) and (-3, 2), the north gate ---------------
    def quarter(self, k):
        t, p = Turn(k), self.p
        inner_post = INNER + POST_R + .02
        self.deck(t, -3.5 + WALL, INNER, -INNER, 3.5 - WALL, False)               # corner square
        self.deck(t, -INNER, INNER, -1.5, 3.5 - WALL, True)                      # east arm
        self.deck(t, -3.5 + WALL, 1.5, -INNER, INNER, False)                     # south arm
        for a, b_ in (((-INNER, INNER), (-INNER, 3.5 - WALL)), ((-3.5 + WALL, INNER), (-INNER, INNER))):
            self.beam(t, a, b_, DECK + .006, .05, .03)                           # flush seam between corner and arms
        for a, b_ in (((-INNER, INNER + .04), (-GATE + POST_R, INNER + .04)), ((-INNER - .04, GATE - POST_R), (-INNER - .04, INNER))):
            self.beam(t, a, b_, DECK + .03, .1, .1, p['oak'])                    # courtyard edge beams
        # Outer palisade, a heavier corner stake, closed arm ends between the gate posts.
        self.stakes(t, -LINE + .2, -GATE - .16, LINE, True)
        self.stakes(t, GATE + .16, LINE - .2, -LINE, False)
        self.stake(t, -LINE, LINE, LOG_H + .1, LOG_R + .035)
        self.stakes(t, inner_post + .14, LINE - .16, -GATE, False)
        self.stakes(t, -LINE + .16, -inner_post - .14, GATE, True)
        for a, b_ in (((-LINE + .2, LINE - LOG_R - .035), (-GATE - .15, LINE - LOG_R - .035)),
                      ((-LINE + LOG_R + .035, GATE + .15), (-LINE + LOG_R + .035, LINE - .2))):
            self.beam(t, a, b_, 1.15, .06, .08)                                  # binding wale inside the stakes
        # Uniform gate posts with lanterns at both ends of both arms; the decks stay free for turrets,
        # so all other light hangs outside: small torches on brackets along the outer palisade.
        for x, y in ((-GATE, LINE), (-GATE, inner_post), (-LINE, GATE), (-inner_post, GATE)):
            self.post(t, x, y)
        out = LINE + LOG_R + .1
        for u in (-3.0, -2.5, -2.0):
            self.torch(t, u, out, (0, 1))
            self.torch(t, -out, -u, (-1, 0))
        self.torch(t, -LINE - .2, LINE + .2, (-.7, .7))
        self.gate(t)

    def gate(self, t):
        """North gate: two thin dark doorsteps flush in the ground, on the outer and the inner line."""
        b, p = self.b, self.p
        x = GATE - POST_R - .01
        for y, width in ((LINE, .1), (INNER + .05, .07)):
            self.beam(t, (-x, y), (x, y), .016, width, .036, p['tar'])
            for f in (-.66, 0, .66):
                b.box(t.p(f * x, y, .016), (.035, width + .008, .034), p['iron'], .003, t.r())

    # -- ground -------------------------------------------------------------------------
    def ground(self):
        def worn(x, y):
            # Ragged rim: fine noise moves the threshold, so moss and gravel bite into the edge.
            f = path_wear(x, y)
            if f <= .01: return None
            edge = smooth((f + .18 * wobble(x * 5.1, y * 5.1, 4) + .08 * wobble(x * 13, y * 11, 9) - .35) / .45)
            cover = edge * (.9 + .1 * wobble(x * 2.2, y * 2.2, 6))
            dark = .1 + .2 * max(0.0, wobble(x * 1.9, y * 1.9, 5))
            return (.004, max(0.0, min(1.0, cover)), min(1.0, dark))
        ground_sheet(self.c, 'Worn path ground', -5.6, -5.6, 5.6, 5.6, worn, self.path, .08)
        self.wear_marks()
        self.pebbles()

        def moss(x, y):
            far = max(abs(x), abs(y))
            rim = smooth((4.25 + .3 * wobble(x * 1.4, y * 1.4, 8) - far) / .6)
            if rim <= .01: return None
            f = rim * (1 - smooth(path_wear(x, y) * 1.25 - .15))
            f *= .8 + .2 * wobble(x * 3.1, y * 3.1, 2)
            return (.003, max(0.0, min(1.0, f * .95)), .25 * (1 - rim))
        ground_sheet(self.c, 'Moss carpet', -4.6, -4.6, 4.6, 4.6, moss, self.mossmat, .07)

    def wear_marks(self):
        """Countless faint, overlapping wheel and foot marks through every gate.

        The marks of one gate are summed into a single translucent sheet (alpha = 1 - prod(1 - a)):
        dozens of stacked transparent sheets would exceed the renderer's transparency depth and
        render black.
        """
        rng = self.rng
        for k in range(4):
            marks = []
            for _ in range(70):
                x0 = rng.gauss(0, .55)
                y_end, y_start = rng.uniform(.8, 1.9), rng.uniform(4.0, 5.3)
                marks.append((x0, rng.uniform(-.12, .12), rng.uniform(.07, .18), y_end, y_start, rng.uniform(.035, .09)))

            def sample(x, y, marks=marks):
                keep = 1.0
                for x0, drift, width, y_end, y_start, strength in marks:
                    if not y_end < y < y_start: continue
                    centre = x0 + drift * (y - y_end) / (y_start - y_end) + .03 * math.sin(y * 2.7 + x0 * 5)
                    across = abs(x - centre)
                    if across >= width: continue
                    along = min(1.0, (y - y_end) / .6, (y_start - y) / .9)
                    keep *= 1 - strength * (1 - across / width) * along
                a = 1 - keep
                return None if a <= .003 else (.0045, a, 0.0)
            turned_sheet(self.c, 'Wear marks', k, -2.0, .8, 2.0, 5.3, sample, self.rut, .04)

    def pebbles(self):
        """Loose pebbles and grit pushed to the sides of the worn bands, a few in the middle."""
        b, rng, p = self.b, self.rng, self.p
        placed = 0
        while placed < 520:
            x, y = rng.uniform(-5.2, 5.2), rng.uniform(-5.2, 5.2)
            f = path_wear(x, y)
            edge = 1 - abs(f - .45) / .45                                  # most along the band edges
            if f < .05 or rng.random() > .15 + .85 * max(0.0, edge): continue
            if max(abs(x), abs(y)) > 2.45 and min(abs(x), abs(y)) > 1.45 and max(abs(x), abs(y)) < 3.65: continue
            s = rng.uniform(.012, .035) if rng.random() < .85 else rng.uniform(.04, .07)
            b.box((x, y, s * .25), (s * rng.uniform(1, 1.5), s, s * .6), p['stone'] if rng.random() < .7 else p['ringstone'],
                  s * .25, (0, 0, rng.uniform(0, 3)), s * .2, rng)
            placed += 1

    def rubble(self, k):
        """Stones, broken plank ends and chips at the inner corner and at the gate post feet."""
        t, b, rng, p = Turn(k), self.b, self.rng, self.p
        spots = [((-2.25, 2.25), .45, 16), ((-GATE - .05, LINE + .32), .22, 5), ((-LINE - .32, GATE + .05), .22, 5),
                 ((-GATE + .05, INNER - .25), .2, 5), ((-INNER + .25, GATE - .05), .2, 5)]
        for (cx, cy), radius, count in spots:
            for _ in range(count):
                a, d = rng.uniform(0, math.tau), radius * math.sqrt(rng.random())
                x, y = cx + d * math.cos(a), cy + d * math.sin(a)
                kind = rng.random()
                if kind < .5:
                    s = rng.uniform(.05, .14)
                    b.box(t.p(x, y, s * .3), (s * rng.uniform(1, 1.5), s, s * .65), p['stone'], .02, t.r(0, 0, rng.uniform(0, 3)), s * .18, rng)
                elif kind < .75:
                    ln = rng.uniform(.22, .48)
                    b.box(t.p(x, y, .02), (ln, rng.uniform(.06, .1), .03), p['tar'] if rng.random() < .6 else p['oak'], .004,
                          t.r(rng.uniform(-.05, .05), 0, rng.uniform(0, 3.2)), .012, rng)
                else:
                    for _ in range(4):
                        b.box(t.p(x + rng.uniform(-.08, .08), y + rng.uniform(-.08, .08), .01), (rng.uniform(.03, .07), .015, .01),
                              p['chip'], 0, t.r(0, 0, rng.uniform(0, 3.2)))

    def ring(self):
        """Stone ring in the courtyard centre: dressed stones, four stone spokes and a hub."""
        b, rng, p = self.b, self.rng, self.p
        for i in range(20):
            a = i * math.tau / 20 + rng.uniform(-.02, .02)
            r = 1.0 + rng.uniform(-.015, .015)
            b.box((r * math.cos(a), r * math.sin(a), rng.uniform(.012, .026)), (.28, .16, .045), p['ringstone'], .018,
                  (0, 0, a + math.pi / 2 + rng.uniform(-.04, .04)), .012, rng)
        for k in range(4):
            self.beam(Turn(k), (.36, 0), (.84, 0), .022, .09, .04, p['ringstone'])
        b.cylinder((0, 0, .022), .3, .044, p['ringstone'], 28, .02)
        b.cylinder((0, 0, .045), .1, .012, p['iron'], 16, .004)
        for _ in range(18):                                                      # moss in the joints
            a = rng.uniform(0, math.tau)
            s = rng.uniform(.02, .04)
            b.ell((1.0 * math.cos(a), 1.0 * math.sin(a), .04), (s, s * .7, .01), p['moss'], 8, 3, (0, 0, a))

    def build(self):
        for k in range(4):
            self.quarter(k)
            self.rubble(k)
        self.ring()
        self.ground()
        for ob in self.b.flush('Fort master'):
            if any(key in ob.name for key in ('Wood chips', 'Fieldstone')):
                ob['fdGround'] = True
        return self.sockets
