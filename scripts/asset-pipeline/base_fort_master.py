"""Palisadenschanze master: the persistent base core as one coherent fort (1 BU = 1 m = 32 px).

Built after the chosen reference (refs round 5, variant 5), reworked for plan-view readability:
four L-shaped bastions of individual stakes with axe-hewn four-facet points round warm plank decks,
heavy iron-banded gate posts with an iron fire bowl on the outer pair, an old cobbled passage sunk
into the ground through every gate that ties the bastions into one ring, a few large torches outside
the palisade, and a raised fieldstone hearth on the anchor cell (a solid cell, see PersistentBaseCore).
A dark, damp foot strip sets the decks off from the courtyard gravel. The core never changes shape,
so it is built once as a whole instead of from the cell kit; blocking cells (decks, palisade,
hearth) stay clearly apart from the walkable ground. Every deck centre stays clear, because each
cell is a turret place.

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
from base_structure_parts import Batch, mesh_object
from base_styles import fort_timber, hewn_stake
from dawn_parts import linear

DECK, WALL = 1.25, .26        # raised fighting deck: turrets on it fire over the palisade
LINE = 3.5 - WALL / 2           # palisade centre line on the outer sides
INNER = 2.5                     # courtyard edge
GATE = 1.5 + WALL / 2           # gate post line: the arm ends, either side of the 3-cell gates
LOG_R, LOG_PITCH, LOG_H = .12, .21, DECK + .54   # shoulder to shoulder: a low closed breastwork, long points above it
POST_R, POST_H, INNER_POST_H = .15, DECK + .62, DECK + .4   # heavy squared gate posts
HEARTH_R = .5                   # outer radius of the raised hearth ring on the anchor cell
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
        self.p = dict(fort_timber(m),
            cobble=m('Gate sett', (150, 142, 126), .35), cobble_worn=m('Gate sett worn', (166, 158, 140), .35),
            cobble_dark=m('Gate sett dark', (128, 122, 110), .35), kerb=m('Gate kerb stone', (142, 136, 122), .4),
            hearth=m('Hearth stone', (126, 118, 104), .4), soot_stone=m('Sooted hearth stone', (52, 48, 44), .3),
            ash=m('Hearth ash', (126, 122, 114), .2), spit=m('Spit iron', (46, 46, 42), .2),
            fresh=m('Fresh repair board', (176, 146, 104), .25), crate=m('Crate wood', (164, 134, 94), .3),
            loose=m('Loose plank', (88, 66, 46), .32), loose_tar=m('Loose tarred plank', (58, 48, 40), .2),
            sack=m('Burlap sack', (158, 136, 98), .3), tarp=m('Oiled tarp', (84, 82, 56), .3), cut=m('Cut log end', (150, 126, 92), .3),
            rope=m('Hemp cord', (142, 128, 94), .3), water=m('Bucket water', (38, 44, 46), .05),
            fresh_bark=m('Fresh bark', (110, 88, 62), .3), block=m('Chopping block top', (150, 124, 90), .3),
            leaf=m('Fallen leaf', (104, 76, 44), .3), leaf2=m('Dry leaf', (136, 108, 64), .3), leaf3=m('Rust leaf', (120, 70, 40), .3),
            iron=m('Forged iron', (86, 90, 88), .25), dark=m('Soot iron', (40, 41, 37), .18), stone=m('Fieldstone', (128, 124, 112), .4),
            ringstone=m('Wall walk flagstone', (122, 118, 108), .35), chip=m('Wood chips', (150, 120, 84), .25),
            ember=m('Separate forge ember', (230, 96, 24), .05, .9), coal=m('Forge coal', (30, 29, 25), .1),
            brass=m('Worn brass fittings', (150, 112, 58), .3),
            moss=m('Stake moss', (70, 92, 38), .3), moss2=m('Old moss', (84, 96, 46), .3),
            gmoss=m('Ground moss', (70, 84, 42), .3), gmoss2=m('Old ground moss', (84, 88, 54), .3),
            lichen=m('Grey lichen', (150, 152, 128), .2), ringrock=m('Ring fieldstone', (112, 108, 98), .4),
            grass=m('Turf tuft', (66, 82, 40), .3), grass2=m('Dry turf tuft', (118, 108, 70), .3), fern=m('Fern frond', (52, 78, 34), .3),
            sill=m('Threshold stone', (96, 92, 84), .4), sill2=m('Mossy threshold stone', (80, 82, 68), .35), charred=m('Charred bits', (34, 30, 27), .1),
            log=m('Charred fire log', (38, 33, 29), .12))
        # Partial covers over the game's gravel: the path pales and compacts it, moss grows over it in patches.
        self.path = image_material('Worn path gravel', 'gravel-path-03.png', 2.2, .98, .9, patchy=1.25)
        self.mossmat = image_material('Moss carpet', 'moss-carpet-01.png', 1.4, .78, .78, (92, 98, 56), .3, (40, 46, 28), patchy=1.8)
        self.rut = ground_tint('Trodden earth', (78, 66, 50))
        self.foot = ground_tint('Damp deck foot', (44, 38, 31))
        self.joint = ground_tint('Cobble joint earth', (74, 64, 52))
        self.soot_mat = ground_tint('Torch soot', (30, 27, 24))
        self.soot = []

    def socket(self, name, xyz):
        self.sockets[f'{name}_{len(self.sockets)}'] = xyz

    # -- parts ------------------------------------------------------------------------
    def stake(self, t, x, y, h=LOG_H, r=None):
        rng = self.rng
        r = r or LOG_R + rng.uniform(-.012, .01)
        px, py, _ = t.p(x, y)
        fresh = self.p['fresh']
        mats = self.p if rng.random() > .07 else dict(self.p, bark=self.p['fresh_bark'], point=fresh, point_old=fresh, point_moss=fresh)
        hewn_stake(self.b, px, py, h + rng.uniform(-.07, .05), r, mats, rng)
        if rng.random() < .18:                                       # a grey lichen fleck on one facet
            a = rng.uniform(0, math.tau)
            self.b.ell((px + r * .45 * math.cos(a), py + r * .45 * math.sin(a), h + r * .5), (r * .3, r * .25, .01), self.p['lichen'], 8, 3)

    def stakes(self, t, a, b, fixed, along_x):
        n = max(1, round(abs(b - a) / LOG_PITCH))
        for i in range(n):
            v = a + (b - a) * (i + .5) / n + self.rng.uniform(-.015, .015)
            w = fixed + self.rng.uniform(-.018, .018)                         # not set out with a ruler
            self.stake(t, *((v, w) if along_x else (w, v)))

    def post(self, t, x, y, outer):
        """Heavy squared gate post, iron-banded, with a cap board; the outer pair of every gate carries
        an iron fire bowl that lights the gate, the inner pair ends lower under a plain cap."""
        b, p, rng = self.b, self.p, self.rng
        h = POST_H if outer else INNER_POST_H
        b.box(t.p(x, y, h / 2), (2 * POST_R, 2 * POST_R, h), p['oak'], .014, t.r(0, 0, rng.uniform(-.04, .04)), .008, rng)
        b.box(t.p(x, y, h + .025), (2 * POST_R + .05, 2 * POST_R + .05, .05), p['tar'], .006, t.r())
        for z in (h - .2, h - .62, .4):
            b.box(t.p(x, y, z), (2 * POST_R + .02, 2 * POST_R + .02, .05), p['iron'], .003, t.r())
        for dx in (-1, 1):                                                # rivet heads on the cap board
            for dy in (-1, 1):
                b.cylinder(t.p(x + dx * (POST_R - .02), y + dy * (POST_R - .02), h + .052), .013, .008, p['dark'], 6, 0)
        if outer:
            self.fire_bowl(t, x, y, h + .05)

    def fire_bowl(self, t, x, y, z):
        """Iron fire bowl, wider than the post: a dark rim round a bed of glowing coal under charred
        log ends; the flames and their light come from the runtime."""
        b, p, rng = self.b, self.p, self.rng
        r = .19
        b.cylinder(t.p(x, y, z + .02), .07, .04, p['dark'], 10, .006)                  # foot on the post cap
        b.cylinder(t.p(x, y, z + .085), r, .09, p['dark'], 16, .012)                    # the iron bowl
        b.cylinder(t.p(x, y, z + .132), r - .035, .01, p['coal'], 16, 0)               # ash and coal bed inside the rim
        for _ in range(6):                                                             # glowing gaps between the coals
            a, d = rng.uniform(0, math.tau), (r - .07) * math.sqrt(rng.random())
            s = rng.uniform(.03, .05)
            b.ell(t.p(x + d * math.cos(a), y + d * math.sin(a), z + .136), (s, s * .75, .012), p['ember'], 8, 3)
        for _ in range(12):                                                            # black coal lumps over the glow
            a, d = rng.uniform(0, math.tau), (r - .055) * math.sqrt(rng.random())
            s = rng.uniform(.02, .038)
            b.ell(t.p(x + d * math.cos(a), y + d * math.sin(a), z + .145), (s, s * .8, s * .6), p['coal'], 8, 4)
        for i in range(3):                                                             # charred log ends meeting in the fire
            a = i * math.tau / 3 + rng.uniform(-.3, .3)
            ln = rng.uniform(.1, .13)
            b.rod(t.p(x + math.cos(a) * ln, y + math.sin(a) * ln, z + .15), t.p(x - math.cos(a) * .015, y - math.sin(a) * .015, z + .19),
                  .026, p['log'], 6)
        for i in range(8):                                                             # rivets round the rim
            a = i * math.tau / 8
            b.cylinder(t.p(x + (r - .008) * math.cos(a), y + (r - .008) * math.sin(a), z + .132), .008, .006, p['iron'], 6, 0)
        self.socket('bowl', t.p(x, y, z + .2))

    def torch(self, t, x, y, outward, z, size=1.0, pole=False):
        """Large torch on an iron bracket at the palisade, or on a short stake knocked into the earth bank
        (about 30 cm, so it casts no long shadow): a pitch-wrapped head in an iron basket, glowing at the top."""
        b, p, rng = self.b, self.p, self.rng
        ox, oy = outward
        if pole:
            b.cylinder(t.p(x, y, z / 2), .05, z, p['bark'], 8, .005, t.r(rng.uniform(-.05, .05), rng.uniform(-.05, .05)))
        else:
            arm = rng.uniform(.16, .24)
            b.rod(t.p(x - ox * arm, y - oy * arm, z - .14), t.p(x, y, z - .14), .018, p['dark'], 6)
        b.rod(t.p(x - ox * .03, y - oy * .03, z - .34), t.p(x + ox * .02, y + oy * .02, z), .028, p['oak'], 6)
        hx, hy = x + ox * .02, y + oy * .02
        b.cylinder(t.p(hx, hy, z + .03), .06 * size, .1, p['tar'], 12, .008)               # pitch-wrapped head
        for i in range(4):                                                               # iron basket straps
            a = i * math.pi / 4
            b.box(t.p(hx, hy, z + .03), (.13 * size, .012, .1), p['dark'], .002, t.r(0, 0, a))
        b.ell(t.p(hx, hy, z + .085), (.05 * size, .045 * size, .03 * size), p['ember'], 10, 4, t.r(0, 0, rng.uniform(0, 3)))
        self.socket('torch', t.p(hx, hy, z + .14))
        gx, gy, _ = t.p(hx + ox * .05, hy + oy * .05)
        self.soot.append((gx, gy, .2 + .1 * size))
        for _ in range(rng.randrange(3, 7)):
            a, d = rng.uniform(0, math.tau), rng.uniform(0, .16 * size)
            b.box((gx + d * math.cos(a), gy + d * math.sin(a), .004), (rng.uniform(.012, .03), rng.uniform(.008, .016), .008),
                  p['charred'], .002, (0, 0, rng.uniform(0, 3)))

    def torches(self, t):
        """Three large torches outside one quarter, never in an even row: one beside each gate end,
        one at the outer corner, on the palisade or on a short stake in the bank."""
        rng = self.rng
        face = LINE + LOG_R + .1
        for side in ('n', 'w'):
            u = -GATE - rng.uniform(.24, .42)
            x, y, ow = (u, face, (0, 1)) if side == 'n' else (-face, -u, (-1, 0))
            self.torch(t, x, y, ow, rng.uniform(DECK + .1, DECK + .4), rng.choice((1.0, 1.0, 1.15)))
        if rng.random() < .55:
            # On a short stake in the bank, right at the palisade foot: further out it reads as lost in the meadow.
            self.torch(t, -LINE - rng.uniform(.22, .28), LINE + rng.uniform(.22, .28), (-.7, .7), rng.uniform(.28, .34), 1.15, True)
        else:
            self.torch(t, -LINE - .16, LINE + .16, (-.7, .7), DECK + .4, 1.1)

    def deck(self, t, x0, y0, x1, y1, boards_along_y):
        """Plank deck on a tarred frame: boards of mixed width and age with staggered butt joints, pale
        fresh repair boards, the odd tarred old one, trodden boards, nail heads."""
        b, rng, p = self.b, self.rng, self.p
        z = DECK
        b.box(t.p((x0 + x1) / 2, (y0 + y1) / 2, z / 2 - .03), (x1 - x0, y1 - y0, z - .06), p['tar'], .01, t.r())
        span = (x0, x1) if boards_along_y else (y0, y1)
        run = (y0, y1) if boards_along_y else (x0, x1)
        u = span[0]
        while u < span[1] - .03:
            w = min(rng.uniform(.1, .17), span[1] - u)
            v = run[0]
            while v < run[1] - .03:
                length = min(rng.uniform(.5, 1.5), run[1] - v)
                r = rng.random()
                mat = (p['fresh'] if r < .05 else p['tar'] if r < .11 else p['worn'] if r < .24
                       else p['oak'] if r < .5 else p['plank'])
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

    def deck_moss(self, t):
        """Moss and lichen creep over the decks from the palisade side and settle in the corners."""
        b, rng, p = self.b, self.rng, self.p
        # A few broad, flat patches: small raised cushions cast a speckle of self-shadow on the deck.
        for _ in range(12):
            if rng.random() < .5: x, y = rng.uniform(-3.2, -1.6), rng.uniform(3.04, 3.2)
            else: x, y = rng.uniform(-3.2, -3.04), rng.uniform(1.6, 3.2)
            s = rng.uniform(.06, .13)
            b.ell(t.p(x, y, DECK + .002), (s, s * rng.uniform(.45, .7), .003), p['moss' if rng.random() < .55 else 'moss2'], 10, 3,
                  t.r(0, 0, rng.uniform(0, 3)))
        for _ in range(8):
            x, y = rng.uniform(-3.2, -1.6), rng.uniform(1.6, 3.2)
            if min(abs(x - round(x)), abs(y - round(y))) > .14 and max(abs(x - round(x)), abs(y - round(y))) < .3: continue
            s = rng.uniform(.015, .035)
            b.ell(t.p(x, y, DECK + .005), (s, s * .8, .006), p['lichen'], 6, 3)

    # -- stores and fittings ----------------------------------------------------------------
    def hatch(self, t, x, y):
        """A trapdoor in the corner deck: boards across the deck boards in a dark frame, two iron hinges
        and a ring, so it reads at once as a hatch."""
        b, p, rng, z, half = self.b, self.p, self.rng, DECK + .002, .19
        b.box(t.p(x, y, z - .004), (2 * half + .05, 2 * half + .05, .012), p['tar'], .004, t.r())
        for i in range(4):
            u = -half + half / 4 + i * half / 2
            b.box(t.p(x, y + u, z + .004), (2 * half - .01, .085, .03), p['oak'], .004, t.r(0, 0, rng.gauss(0, .01)), .003, rng)
        for k in (-1, 1):
            b.box(t.p(x + k * .11, y - half + .05, z + .022), (.03, .12, .006), p['dark'], .002, t.r())
        b.cylinder(t.p(x, y + half - .06, z + .022), .032, .006, p['iron'], 10, .002)

    def crate(self, t, x, y, turn, z, size):
        """A pale plank crate with dark edge battens and a diagonal brace on the lid."""
        b, p, rng, h = self.b, self.p, self.rng, size * .8
        b.box(t.p(x, y, z + h / 2), (size, size, h), p['crate'], .006, t.r(0, 0, turn), .004, rng)
        c, s_ = math.cos(turn), math.sin(turn)
        for k in (-1, 1):
            for along in (True, False):
                u, v = (0, k * (size / 2 - .016)) if along else (k * (size / 2 - .016), 0)
                b.box(t.p(x + u * c - v * s_, y + u * s_ + v * c, z + h + .006), (size, .032, .012) if along else (.032, size, .012),
                      p['tar'], .003, t.r(0, 0, turn))
        b.box(t.p(x, y, z + h + .007), (size * 1.3, .028, .012), p['tar'], .003, t.r(0, 0, turn + math.pi / 4))

    def sacks(self, t, x, y, turn, z, count, spread):
        """Burlap sacks heaped together, each a fat pillow tied off at one end."""
        b, p, rng = self.b, self.p, self.rng
        for i in range(count):
            u, v = rng.uniform(-spread, spread), rng.uniform(-spread * .7, spread * .7)
            a = turn + rng.uniform(-.5, .5)
            sx, sy = x + u * math.cos(turn) - v * math.sin(turn), y + u * math.sin(turn) + v * math.cos(turn)
            layer = .05 if i < 3 else .11
            b.ell(t.p(sx, sy, z + layer), (.13, .085, .06), p['sack'], 12, 6, t.r(0, 0, a))
            b.ell(t.p(sx + math.cos(a) * .125, sy + math.sin(a) * .125, z + layer + .01), (.03, .025, .025), p['rope'], 8, 4, t.r(0, 0, a))

    def bucket(self, t, x, y, z):
        """Fire bucket: a ring of oak staves with an iron hoop round dark water."""
        b, p = self.b, self.p
        b.cylinder(t.p(x, y, z + .1), .1, .2, p['oak'], 14, .006)
        b.cylinder(t.p(x, y, z + .185), .104, .02, p['dark'], 14, .002)
        b.cylinder(t.p(x, y, z + .19), .082, .01, p['water'], 14, 0)

    def coil(self, t, x, y, z, r):
        """A coil of hemp rope lying flat: a spiral of short round segments."""
        b, p = self.b, self.p
        turns, steps = 3.2, 40
        for i in range(steps):
            f = i / steps
            a, rr = f * turns * math.tau, r * (.35 + .65 * f)
            b.ell(t.p(x + rr * math.cos(a), y + rr * math.sin(a), z + .018), (.024, .018, .018), p['rope'], 6, 3, t.r(0, 0, a + math.pi / 2))

    def firewood(self, t, x, y, turn, z, length, rows):
        """Split logs stacked one way: a row of bark tubes with pale cut ends."""
        b, p, rng = self.b, self.p, self.rng
        c, s_ = math.cos(turn), math.sin(turn)
        for layer, count in enumerate(rows):
            for i in range(count):
                v = (i - (count - 1) / 2) * .085 + rng.uniform(-.01, .01)
                r = rng.uniform(.035, .045)
                end = length / 2 + rng.uniform(-.03, .03)
                zz = z + r + layer * .075
                ends = [(x + u * c - v * s_, y + u * s_ + v * c) for u in (-end, end)]
                (ax, ay), (bx, by) = ends
                b.rod(t.p(ax, ay, zz), t.p(bx, by, zz), r, p['bark'], 8)
                for ex, ey in ends:
                    b.cylinder(t.p(ex, ey, zz), r * .92, .012, p['cut'], 8, 0, t.r(0, math.pi / 2, turn))

    def deck_stores(self, t):
        """On the decks only the edges carry anything, the turret places stay clear: a fire bucket and a
        rope coil where the corner deck meets the arms on the courtyard side, a small crate against the
        palisade between corner and arm."""
        rng = self.rng
        self.bucket(t, -2.64, 2.62, DECK)
        if rng.random() < .7:
            self.coil(t, -2.62, 2.86, DECK, .11)
        self.crate(t, -2.5 + rng.uniform(-.06, .06), 3.1, rng.uniform(-.15, .15), DECK, .2)

    def nook(self, t):
        """The courtyard corner inside the L of the bastion: supplies tucked against both walls, the
        least trodden place in the fort. No ladder: it would suggest the decks can be climbed."""
        rng = self.rng
        self.crate(t, -2.3, 2.3, rng.uniform(-.1, .1), 0, .3)
        if rng.random() < .5:
            self.crate(t, -2.3 + rng.uniform(-.03, .03), 2.3 + rng.uniform(-.03, .03), rng.uniform(.3, .6), .24, .22)
        self.sacks(t, -2.27, 1.98, -math.pi / 2 + rng.uniform(-.2, .2), 0, rng.randrange(3, 5), .12)
        if rng.random() < .6:
            self.firewood(t, -1.98, 2.3, rng.uniform(-.1, .1), 0, .44, (5, 3))

    def beam(self, t, a, b_, z, width, height, mat=None):
        """A squared timber between two plan points; z is its top."""
        (ax, ay), (bx, by) = a, b_
        length = math.hypot(bx - ax, by - ay)
        rz = math.atan2(by - ay, bx - ax)
        self.b.box(t.p((ax + bx) / 2, (ay + by) / 2, z - height / 2), (length, width, height), mat or self.p['tar'], .008, t.r(0, 0, rz))

    # -- one quarter: corner (-3, 3), arms (-2, 3) and (-3, 2), the north gate ---------------
    def quarter(self, k):
        t, p = Turn(k), self.p
        self.gate_turn = k
        inner_post = INNER + POST_R + .02
        self.deck(t, -3.5 + WALL, INNER, -INNER, 3.5 - WALL, False)               # corner square
        self.deck(t, -INNER, INNER, -1.5, 3.5 - WALL, True)                      # east arm
        self.deck(t, -3.5 + WALL, 1.5, -INNER, INNER, False)                     # south arm
        for a, b_ in (((-INNER, INNER), (-INNER, 3.5 - WALL)), ((-3.5 + WALL, INNER), (-INNER, INNER))):
            self.beam(t, a, b_, DECK + .006, .05, .03)                           # flush seam between corner and arms
        for a, b_ in (((-INNER, INNER + .04), (-GATE + POST_R, INNER + .04)), ((-INNER - .04, GATE - POST_R), (-INNER - .04, INNER))):
            self.beam(t, a, b_, DECK + .03, .13, .1)                             # tarred courtyard edge beams
        # Outer palisade, a heavier corner stake, closed arm ends between the gate posts.
        self.stakes(t, -LINE + .2, -GATE - .16, LINE, True)
        self.stakes(t, GATE + .16, LINE - .2, -LINE, False)
        self.stake(t, -LINE, LINE, LOG_H + .1, LOG_R + .035)
        self.stakes(t, inner_post + POST_R + .02, LINE - POST_R - .02, -GATE, False)
        self.stakes(t, -LINE + POST_R + .02, -inner_post - POST_R - .02, GATE, True)
        for a, b_ in (((-LINE + .2, LINE - LOG_R - .035), (-GATE - .15, LINE - LOG_R - .035)),
                      ((-LINE + LOG_R + .035, GATE + .15), (-LINE + LOG_R + .035, LINE - .2))):
            self.beam(t, a, b_, DECK + .28, .06, .08)                            # binding wale inside the stakes
        # Heavy gate posts at both ends of both arms, fire bowls on the outer pair; the decks stay free for
        # turrets, so all other light hangs outside: large torches at the gate ends and the outer corner.
        for x, y, outer in ((-GATE, LINE, True), (-GATE, inner_post, False), (-LINE, GATE, True), (-inner_post, GATE, False)):
            self.post(t, x, y, outer)
        self.torches(t)
        self.deck_moss(t)
        self.hatch(t, -3.02, 2.74)
        self.deck_stores(t)
        self.nook(t)
        self.gate(t)

    def gate(self, t):
        """North gate passage: an old cobbled floor across the whole gate, sunk into the ground. Rows of
        rough cobbles between the gate posts and a row of larger kerb stones on each wall line, worn
        flat and pale where the traffic runs, stones lost towards the sides with moss in the gaps, and
        the courtyard gravel washed over every edge, so it reads as ground one walks over."""
        b, p, rng = self.b, self.p, self.rng
        x = GATE - POST_R + .04                                            # tucked under the posts: no bare strip at the sides
        inner, outer = INNER + .03, LINE + .09

        def stone(u, v, half_u, half_v, mat, height):
            # A roughly squared sett, set deep: its worn top stands only a centimetre out of the ground,
            # some lower than the gravel washed over them.
            top = rng.uniform(.007, .017)
            b.box(t.p(u, v, top - height / 2), (2 * half_u, 2 * half_v, height), mat, min(half_u, half_v) * .35,
                  t.r(0, 0, rng.gauss(0, .06)), min(half_u, half_v) * .22, rng)

        def course(v, depth, kerb):
            u = -x + rng.uniform(0, .04)
            while u < x - .04:
                w = min(rng.uniform(.3, .44) if kerb else rng.uniform(.13, .2), x - u)
                c, side = u + w / 2, abs(u + w / 2) / x
                if rng.random() < (.04 if kerb else .06 + .3 * side * side):     # a stone gone: grit and moss in the hole
                    b.ell(t.p(c, v, .004), (w * .35, depth * .4, .006), p['gmoss' if rng.random() < .6 else 'gmoss2'], 8, 3)
                else:
                    mid = 1 - side
                    mat = (p['kerb'] if kerb else p['cobble_worn'] if rng.random() < .15 + .65 * mid
                           else p['cobble_dark'] if rng.random() < .2 else p['cobble'])
                    stone(c, v + rng.uniform(-.015, .015), w / 2 - .012, depth / 2 - .012, mat, .03 + .02 * (1 - mid))
                    if side > .55 and rng.random() < .35:                          # moss in the joints at the sides
                        b.ell(t.p(u + w + .005, v, .006), (.02, depth * .35, .005), p['gmoss'], 6, 3)
                u += w + rng.uniform(.012, .028)

        def joints(u, v):
            # Dark earth in the joints between the stones; it frays out where the paving ends.
            edge = min(x + .02 - abs(u), v - inner + .1, outer + .1 - v)
            a = smooth(edge / .12) * (.42 + .12 * wobble(u * 9, v * 9, 53))
            return None if a <= .02 else (.005, min(1.0, a), 0.0)
        turned_sheet(self.c, 'Cobble joint earth', self.gate_turn, -x - .1, inner - .15, x + .1, outer + .15, joints, self.joint, .03)
        course(inner, .15, True)
        v = inner + .14
        while v < outer - .13:
            depth = rng.uniform(.14, .18)
            course(v + depth / 2, depth, False)
            v += depth + .012
        course(outer, .16, True)
        for _ in range(26):                                                # loose cobbles kicked out into the courtyard and the approach
            u, v = rng.uniform(-x, x), rng.choice((rng.uniform(inner - .5, inner - .12), rng.uniform(outer + .12, outer + .5)))
            s = rng.uniform(.04, .07)
            stone(u, v, s, s * rng.uniform(.7, .95), p['cobble'] if rng.random() < .6 else p['cobble_dark'], .025)

        def grit(u, v):
            # The gravel washes over the edges of the paving and settles in its low middle in drifts.
            edge = max(0.0, min(u + x, x - u, (v - inner + .12) * 2, (outer + .12 - v) * 2))
            rim = 1 - smooth(edge / .2)
            drift = max(0.0, wobble(u * 3.1, v * 7.3, 51) - .3) * .35
            a = max(rim, drift) * (.65 + .3 * wobble(u * 11, v * 11, 52))
            return None if a <= .02 else (.011, min(.8, a), .15)
        turned_sheet(self.c, 'Gate grit', self.gate_turn, -x - .3, inner - .4, x + .3, outer + .4, grit, self.path, .035)

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
            rim = smooth((4.4 + .35 * wobble(x * 1.4, y * 1.4, 8) - far) / .6)
            if rim <= .01: return None
            f = rim * (1 - smooth(path_wear(x, y) * 1.1 - .25))
            f *= .75 + .25 * wobble(x * 3.1, y * 3.1, 2)
            return (.003, max(0.0, min(1.0, f * 1.2)), .25 * (1 - rim))
        ground_sheet(self.c, 'Moss carpet', -4.8, -4.8, 4.8, 4.8, moss, self.mossmat, .07)
        self.ground_growth()
        self.leaves()
        self.torch_soot()
        self.deck_foot()

    def leaves(self):
        """Fallen leaves blown together where the wind drops: in the courtyard corners, along the foot of
        the palisade inside and out, in the lee of the hearth; hardly any on the trodden bands."""
        b, rng, p = self.b, self.rng, self.p
        placed = 0
        while placed < 420:
            x, y = rng.uniform(-4.4, 4.4), rng.uniform(-4.4, 4.4)
            far, near = max(abs(x), abs(y)), min(abs(x), abs(y))
            if 2.45 < far < 3.62 and near > 1.45: continue                       # decks and palisade
            if math.hypot(x, y) < .62: continue                                    # the hearth itself
            nook = far < 2.5 and near > 1.5                                        # courtyard corners
            foot = 3.55 < far < 4.1 and near > 1.4                                 # outside along the walls
            inner_foot = 2.0 < far < 2.5 and near > 1.4
            weight = (.9 if nook else .7 if foot else .5 if inner_foot else .06) * (1 - .9 * path_wear(x, y))
            if rng.random() > weight: continue
            s_ = rng.uniform(.018, .034)
            mat = p['leaf'] if rng.random() < .45 else p['leaf2'] if rng.random() < .6 else p['leaf3']
            b.ell((x, y, .003 + rng.uniform(0, .004)), (s_, s_ * .6, .003), mat, 6, 3, (0, 0, rng.uniform(0, math.tau)))
            placed += 1

    def torch_soot(self):
        """One translucent sheet of ash and soot under all torch heads, ragged and densest under the flame."""
        soot = self.soot

        def sample(x, y):
            keep = 1.0
            for sx, sy, r in soot:
                d = math.hypot(x - sx, y - sy) / (r * (1 + .25 * wobble(x * 9 + sx, y * 9 + sy, 3)))
                if d < 1: keep *= 1 - .62 * (1 - d) ** 1.6
            a = 1 - keep
            return None if a <= .004 else (.005, a, 0.0)
        ground_sheet(self.c, 'Torch soot', -5.4, -5.4, 5.4, 5.4, sample, self.soot_mat, .035)

    def deck_foot(self):
        """A dark, damp strip of trodden earth and drip along the decks' courtyard side: rain runs off the
        planks there and nobody walks in it, so the bastions stand off clearly from the courtyard gravel.
        Its width breathes and it frays into the gravel, so it stays organic."""
        turns = [Turn(-k) for k in range(4)]

        def edge_distance(x, y):
            best = 9.0
            for inv in turns:
                lx, ly, _ = inv.p(x, y)
                if lx < -INNER - .02 and ly > INNER + .02: continue                 # under the corner deck
                along_e = max(-INNER, min(-GATE + POST_R, lx))                        # east arm, its courtyard edge y = INNER
                along_s = max(GATE - POST_R, min(INNER, ly))                         # south arm, its courtyard edge x = -INNER
                best = min(best, math.hypot(lx - along_e, ly - INNER), math.hypot(lx + INNER, ly - along_s))
            return best

        def sample(x, y):
            d = edge_distance(x, y)
            reach = .3 + .12 * wobble(x * 2.3, y * 2.3, 21) + .05 * wobble(x * 9, y * 9, 22)
            if d > reach + .12: return None
            a = (1 - smooth((d - reach + .12) / .24)) * (.62 + .12 * wobble(x * 4.7, y * 4.7, 23))
            return None if a <= .01 else (.0042, min(1.0, a), 0.0)
        ground_sheet(self.c, 'Damp deck foot', -2.9, -2.9, 2.9, 2.9, sample, self.foot, .035)

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
                marks.append((x0, rng.uniform(-.12, .12), rng.uniform(.12, .26), y_end, y_start, rng.uniform(.035, .09)))

            def sample(x, y, marks=marks):
                keep = 1.0
                for x0, drift, width, y_end, y_start, strength in marks:
                    if not y_end < y < y_start: continue
                    centre = x0 + drift * (y - y_end) / (y_start - y_end) + .03 * math.sin(y * 2.7 + x0 * 5)
                    across = abs(x - centre)
                    if across >= width: continue
                    along = min(1.0, (y - y_end) / .6, (y_start - y) / .9)
                    keep *= 1 - strength * (1 - across / width) * along
                # Soft ceiling: marks that happen to coincide must not sum to one dark line.
                a = .3 * (1 - math.exp((keep - 1) / .3))
                return None if a <= .003 else (.0045, a, 0.0)
            turned_sheet(self.c, 'Wear marks', k, -2.0, .8, 2.0, 5.3, sample, self.rut, .04)

    def pebbles(self):
        """Loose stones as traffic leaves them: kicked into drifts along the band edges and into heaps
        at the gate posts, a few strays in the middle, bare stretches in between. Clusters follow the
        band direction; their size follows a long tail, so a few heaps are big and most are small."""
        b, rng, p = self.b, self.rng, self.p

        def free(x, y):
            far, near = max(abs(x), abs(y)), min(abs(x), abs(y))
            return (not (2.45 < far < 3.65 and near > 1.45) and not (2.45 < far < 3.55 and near < 1.5)
                    and math.hypot(x, y) > 1.45)

        def stone(x, y, s):
            mat = p['stone'] if rng.random() < .6 else p['ringrock']
            if s > .03:
                b.rock((x, y, s * .15), (s, s * rng.uniform(.6, .9), s * .45), mat, rng, .2, (0, 0, rng.uniform(0, 3)), rng.choice((5, 6, 7)), 3)
            else:
                b.box((x, y, s * .2), (s * rng.uniform(1, 1.5), s, s * .55), mat, s * .25, (0, 0, rng.uniform(0, 3)), s * .2, rng)

        heaps = 0
        while heaps < 85:
            x, y = rng.uniform(-5.2, 5.2), rng.uniform(-5.2, 5.2)
            f = path_wear(x, y)
            if not (.08 < f < .7) or not free(x, y) or rng.random() > 1 - abs(f - .35) * 1.6: continue
            heaps += 1
            count = min(60, int(4 + rng.paretovariate(1.3) * 5))
            spread = rng.uniform(.06, .22) * (1 + count / 40)
            along_y = abs(x) < abs(y)                                       # drifts lie along the band
            sx, sy = (spread * .45, spread * 1.6) if along_y else (spread * 1.6, spread * .45)
            for _ in range(count):
                px, py = x + rng.gauss(0, sx), y + rng.gauss(0, sy)
                if not free(px, py) or path_wear(px, py) < .03: continue
                stone(px, py, rng.uniform(.008, .026) if rng.random() < .82 else rng.uniform(.03, .06))
        for gate in range(4):                                               # heaps at the gate post feet
            t = Turn(gate)
            for side in (-1, 1):
                for line in (LINE + .16, INNER - .12):
                    cx, cy = side * (GATE - .12), line
                    for _ in range(rng.randrange(6, 18)):
                        px, py = cx + rng.gauss(0, .1), cy + rng.gauss(0, .08)
                        wx, wy, _ = t.p(px, py)
                        stone(wx, wy, rng.uniform(.01, .028) if rng.random() < .75 else rng.uniform(.03, .055))
        strays = 0
        while strays < 160:                                                  # single strays, more at the rim
            x, y = rng.uniform(-5.2, 5.2), rng.uniform(-5.2, 5.2)
            f = path_wear(x, y)
            if f < .04 or not free(x, y) or rng.random() < f * .7: continue
            stone(x, y, rng.uniform(.008, .03))
            strays += 1
        flat = 0
        while flat < 40:                                                     # big flat stones worn level with the path
            x, y = rng.uniform(-5, 5), rng.uniform(-5, 5)
            if path_wear(x, y) < .55 or not free(x, y): continue
            s = rng.uniform(.07, .15)
            b.rock((x, y, -s * .12), (s, s * rng.uniform(.55, .85), s * .25), p['ringrock'], rng, .18, (0, 0, rng.uniform(0, 3)),
                   rng.choice((5, 6, 7)), 3)
            flat += 1

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
                    b.box(t.p(x, y, .02), (ln, rng.uniform(.06, .1), .03), p['loose_tar'] if rng.random() < .6 else p['loose'], .004,
                          t.r(rng.uniform(-.05, .05), 0, rng.uniform(0, 3.2)), .012, rng)
                else:
                    for _ in range(4):
                        b.box(t.p(x + rng.uniform(-.08, .08), y + rng.uniform(-.08, .08), .01), (rng.uniform(.03, .07), .015, .01),
                              p['chip'], 0, t.r(0, 0, rng.uniform(0, 3.2)))

    def ring(self):
        """Stone circle round the hearth, set long ago and grown into the ground: rough field stones of
        different sizes sunk to different depths in a bed of trodden earth, two of them gone, moss in
        every joint, grit washed over the edges. Inside it ash and charcoal from years of fires fan out
        downwind from the raised hearth."""
        b, rng, p = self.b, self.rng, self.p

        def bed(x, y):
            r = math.hypot(x, y)
            if r > 1.6: return None
            f = max(0.0, 1 - abs(r - 1.0) / .38) * (.75 + .25 * wobble(x * 4, y * 4, 12))
            return None if f < .02 else (.0035, min(1.0, f * .55), 0.0)
        ground_sheet(self.c, 'Ring earth bed', -1.6, -1.6, 1.6, 1.6, bed, self.rut, .04)
        ash = ground_tint('Hearth ash ground', (112, 108, 100))

        def spread(x, y):
            # Densest at the hearth foot, thinning towards the stone circle and drifting with the wind (+X).
            d = math.hypot(x - .12, y - .03) / (1 + .18 * wobble(x * 6, y * 6, 31))
            a = (1 - smooth((d - .45) / .5)) * (.55 + .25 * wobble(x * 9, y * 9, 32))
            return None if a <= .01 else (.0045, min(.85, a), 0.0)
        ground_sheet(self.c, 'Hearth ash ground', -1.0, -1.0, 1.1, 1.0, spread, ash, .03)
        gone = set(rng.sample(range(20), 2))
        for i in range(20):
            if i in gone: continue
            a = i * math.tau / 20 + rng.uniform(-.03, .03)
            r = 1.0 + rng.uniform(-.035, .035)
            sx, sy = rng.uniform(.15, .19), rng.uniform(.09, .12)
            # Flat, angular and sunk: only a weathered top face shows above the ground.
            b.rock((r * math.cos(a), r * math.sin(a), rng.uniform(-.03, -.012)), (sx, sy, rng.uniform(.045, .06)), p['ringrock'], rng, .22,
                   (rng.uniform(-.05, .05), rng.uniform(-.05, .05), a + math.pi / 2 + rng.uniform(-.12, .12)), rng.choice((5, 6, 6, 7)), 3)
        for _ in range(55):                                                      # charcoal and half-burnt chips kicked out of the fire
            a, r = rng.uniform(0, math.tau), HEARTH_R + .08 + abs(rng.gauss(0, .2))
            s = rng.uniform(.012, .035)
            b.box((r * math.cos(a) + .06, r * math.sin(a), .006), (s * rng.uniform(1, 2.2), s, s * .5), p['charred'], s * .2,
                  (0, 0, rng.uniform(0, 3)), s * .2, rng)
        for _ in range(50):                                                      # moss and grass round the stone circle
            a, r = rng.uniform(0, math.tau), rng.choice((rng.uniform(.84, .92), rng.uniform(1.1, 1.3)))
            s = rng.uniform(.02, .055)
            b.ell((r * math.cos(a), r * math.sin(a), .008), (s, s * .7, .008), p['gmoss' if rng.random() < .6 else 'gmoss2'], 8, 3, (0, 0, a))
        for _ in range(40):                                                      # grit washed over the stones
            a, r = rng.uniform(0, math.tau), rng.uniform(.75, 1.25)
            s = rng.uniform(.01, .022)
            b.box((r * math.cos(a), r * math.sin(a), .035), (s, s * .8, s * .5), p['stone'], s * .2, (0, 0, rng.uniform(0, 3)), s * .2, rng)
        self.hearth()

    def hearth(self):
        """The fort's hearth on the anchor cell: a raised ring of fieldstones in two courses, sooted on the
        inside, round a bed of ash and glowing coal under a star of charred logs. The cell is solid in
        the game, so the hearth may stand knee-high; flames, smoke and light come from the runtime."""
        b, rng, p = self.b, self.rng, self.p
        b.cylinder((0, 0, .07), HEARTH_R - .04, .14, p['soot_stone'], 24, .01)          # rubble core under the courses
        n = 13
        for i in range(n):                                                         # lower course: large, flat-faced stones
            a = i * math.tau / n + rng.uniform(-.05, .05)
            r = HEARTH_R - .1 + rng.uniform(-.015, .015)
            b.rock((r * math.cos(a), r * math.sin(a), .1), (rng.uniform(.13, .16), rng.uniform(.1, .12), rng.uniform(.1, .12)),
                   p['hearth'], rng, .16, (0, 0, a + math.pi / 2 + rng.uniform(-.15, .15)), rng.choice((6, 7)), 4)
        n = 11
        for i in range(n):                                                         # upper course, staggered and a little inward
            a = (i + .5) * math.tau / n + rng.uniform(-.06, .06)
            r = HEARTH_R - .13 + rng.uniform(-.015, .015)
            mat = p['soot_stone'] if rng.random() < .25 else p['hearth']
            b.rock((r * math.cos(a), r * math.sin(a), .23), (rng.uniform(.11, .13), rng.uniform(.08, .1), rng.uniform(.07, .09)),
                   mat, rng, .18, (0, 0, a + math.pi / 2 + rng.uniform(-.15, .15)), rng.choice((5, 6, 7)), 4)
        b.cylinder((0, 0, .2), HEARTH_R - .2, .06, p['soot_stone'], 24, .008)       # sooted lining inside the courses
        b.cylinder((0, 0, .215), HEARTH_R - .21, .02, p['ash'], 24, 0)              # pale ash bed
        for _ in range(16):                                                        # glowing gaps in the coal bed
            a, d = rng.uniform(0, math.tau), (HEARTH_R - .26) * math.sqrt(rng.random())
            s = rng.uniform(.035, .065)
            b.ell((d * math.cos(a), d * math.sin(a), .228), (s, s * .7, .012), p['ember'], 8, 3, (0, 0, rng.uniform(0, 3)))
        for _ in range(26):                                                        # black coal lumps over the glow
            a, d = rng.uniform(0, math.tau), (HEARTH_R - .24) * math.sqrt(rng.random())
            s = rng.uniform(.022, .042)
            b.ell((d * math.cos(a), d * math.sin(a), .235), (s, s * .8, s * .6), p['coal'], 8, 4)
        base = rng.uniform(0, math.tau)
        for i in range(5):                                                         # charred logs meeting in the fire
            a = base + i * math.tau / 5 + rng.uniform(-.2, .2)
            outer, inner = HEARTH_R - .16, rng.uniform(.03, .07)
            b.rod((outer * math.cos(a), outer * math.sin(a), .26), (inner * math.cos(a + .3), inner * math.sin(a + .3), .34),
                  rng.uniform(.045, .06), p['log'], 8)
            mid = (outer + inner) * .5
            b.ell((mid * math.cos(a), mid * math.sin(a), .33), (.05, .02, .01), p['ember'], 8, 3, (0, 0, a))
        self.socket('hearth', (0.0, 0.0, .45))
        # The hearth cell is solid, so a corner round the ring carries the fire's wood. No chopping block:
        # its sawn round read as a stray disc beside the fire from above.
        self.firewood(Turn(0), .42, .4, -math.pi / 4, 0, .34, (4, 2))
        for _ in range(105):                     # the removed block's draws, so the ground details after it keep their places
            self.rng.random()

    def moss_patch(self, x, y, size):
        """A flat, ragged patch of moss on the ground: a few overlapping low lobes of two shades, so it
        reads as growth in the ground layer rather than as a raised oval stone."""
        b, rng, p = self.b, self.rng, self.p
        main = 'gmoss' if rng.random() < .6 else 'gmoss2'
        for _ in range(rng.randrange(3, 6)):
            a, d = rng.uniform(0, math.tau), size * rng.uniform(0, .75)
            r = size * rng.uniform(.35, .7)
            mat = main if rng.random() < .75 else ('gmoss2' if main == 'gmoss' else 'gmoss')
            b.ell((x + d * math.cos(a), y + d * math.sin(a), .004), (r, r * rng.uniform(.55, .95), .007), p[mat], 10, 3,
                  (0, 0, rng.uniform(0, 3)))

    def ground_growth(self):
        """Grass tufts and moss patches where feet rarely go: along the band edges, the palisade feet
        inside and outside, the courtyard corners; a few ferns at the outer corners."""
        b, rng, p = self.b, self.rng, self.p
        tufts = 0
        while tufts < 260:
            x, y = rng.uniform(-4.6, 4.6), rng.uniform(-4.6, 4.6)
            far, near = max(abs(x), abs(y)), min(abs(x), abs(y))
            if 2.45 < far < 3.65 and near > 1.45: continue                        # inside the bastions
            f = path_wear(x, y)
            if f > .55 or (f < .05 and far < 2.45) or math.hypot(x, y) < 1.45: continue
            for _ in range(rng.randrange(3, 7)):
                a = rng.uniform(0, math.tau)
                ln = rng.uniform(.035, .075)
                b.ell((x + math.cos(a) * ln * .5, y + math.sin(a) * ln * .5, .03), (ln, .007, .012),
                      p['grass' if rng.random() > .3 else 'grass2'], 6, 3, (rng.uniform(-.3, .3), 0, a))
            tufts += 1
        cushions = 0
        while cushions < 160:
            x, y = rng.uniform(-4.2, 4.2), rng.uniform(-4.2, 4.2)
            far, near = max(abs(x), abs(y)), min(abs(x), abs(y))
            if 2.45 < far < 3.65 and near > 1.45: continue
            if path_wear(x, y) > .35: continue
            if not (far > 3.55 or (far < 2.55 and far > 2.0 and near > 1.0)): continue
            self.moss_patch(x, y, rng.uniform(.05, .12))
            cushions += 1
        for k in range(4):
            t = Turn(k)
            for i in range(8):
                a = i * math.tau / 8 + rng.uniform(-.2, .2)
                ln = rng.uniform(.16, .26)
                b.ell(t.p(-3.95 + ln * .5 * math.cos(a), 3.95 + ln * .5 * math.sin(a), .07), (ln * .5, .045, .012), p['fern'], 10, 3,
                      t.r(rng.uniform(-.2, .2), 0, a))

    def build(self):
        for k in range(4):
            self.quarter(k)
            self.rubble(k)
        self.ring()
        self.ground()
        for ob in self.b.flush('Fort master'):
            if any(key in ob.name for key in ('Wood chips', 'Fieldstone', 'Ring fieldstone', 'Turf tuft', 'Dry turf tuft', 'Fern frond',
                                              'Threshold stone', 'Mossy threshold stone', 'Charred bits', 'Ground moss', 'Old ground moss',
                                              'Gate sett', 'Gate kerb stone', 'Fallen leaf', 'Dry leaf', 'Rust leaf',
                                              'Loose plank', 'Loose tarred plank')):
                ob['fdGround'] = True
        return self.sockets
