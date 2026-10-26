"""Palisadenschanze master: the persistent base core as one coherent fort (1 BU = 1 m = 32 px).

The core never changes shape, so it is built once as a whole instead of from the cell kit. It has
to read as one building while blocking cells (raised decks, palisade) stay clearly apart from the
walkable ground (flat gravel):

- one outer outline: the palisade runs round all four sides, and flush, iron-banded gate sills
  carry the line across the three-cell entrances;
- one inner outline: the deck edge beams frame the courtyard and the inner gate sills close it;
- hierarchy: the corner cells are towers (higher deck, heavy posts, taller palisade), the arms are
  fighting walks between them; every deck stays flat and clear, because each cell is a turret place;
- the courtyard belongs to the fort: a stone-lined gutter along the walls and a flat stone rose in
  the middle, all at ground level;
- outside, one earth bank (glacis) runs round the fort and opens for the worn gate approaches;
- lights trace the outline: tower corners, mid-walls, gate posts, inner tower corners.

Ground objects carry `fdGround` so a runtime pass can split them from the structure. The north-west
quarter (tower, two arms, north gate, its glacis) is authored once and turned by quarter turns.
The build area ground itself stays the game's gravel; `ground = loam` keeps the earlier loam study.
"""
import math
import random
from base_structure_parts import Batch, mesh_object, cone
from dawn_parts import linear

ARM_DECK, TOWER_DECK, WALL = .74, 1.0, .26
LINE = 3.5 - WALL / 2           # palisade centre line on the outer sides
INNER = 2.5                     # courtyard edge
LOG_R, LOG_PITCH = .1, .2


class Turn:
    """Quarter turn about the core centre; Euler XYZ composes as Rz(k) applied after the local one."""
    def __init__(self, k):
        self.k = k
        self.c, self.s = round(math.cos(k * math.pi / 2)), round(math.sin(k * math.pi / 2))

    def p(self, x, y, z=0.0):
        return (self.c * x - self.s * y, self.s * x + self.c * y, z)

    def r(self, rx=0.0, ry=0.0, rz=0.0):
        return (rx, ry, rz + self.k * math.pi / 2)


def build_area(stage):
    """PersistentBaseCore.isCellInsidePersistentBaseBuildArea as a cell predicate."""
    if stage == 0: return lambda dx, dy: abs(dx) <= 3 and abs(dy) <= 3
    radius = 4 + stage
    return lambda dx, dy: dx * dx + dy * dy <= radius * radius or (max(abs(dx), abs(dy)) <= radius and min(abs(dx), abs(dy)) <= 1)


def ground_material(name, light, dark, grass=0.0, wet=False, attributes=True):
    """Noise-broken ground colour; vertex attributes FD_Alpha (coverage) and FD_Dark (wear)."""
    import bpy
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    n, l = mat.node_tree.nodes, mat.node_tree.links
    bsdf = n['Principled BSDF']; bsdf.inputs['Roughness'].default_value = .35 if wet else .92
    geo = n.new('ShaderNodeNewGeometry')
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 4.0; noise.inputs['Detail'].default_value = 9
    l.new(geo.outputs['Position'], noise.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = .3, .72
    ramp.color_ramp.elements[0].color = (*linear(dark), 1); ramp.color_ramp.elements[1].color = (*linear(light), 1)
    l.new(noise.outputs['Fac'], ramp.inputs[0])
    color = ramp.outputs['Color']
    if grass:
        patch = n.new('ShaderNodeTexNoise'); patch.inputs['Scale'].default_value = 2.2; patch.inputs['Detail'].default_value = 7
        l.new(geo.outputs['Position'], patch.inputs['Vector'])
        grow = n.new('ShaderNodeMapRange'); grow.inputs['From Min'].default_value = .5; grow.inputs['From Max'].default_value = .62
        grow.inputs['To Max'].default_value = grass
        l.new(patch.outputs['Fac'], grow.inputs['Value'])
        mix = n.new('ShaderNodeMixRGB'); l.new(grow.outputs['Result'], mix.inputs[0])
        l.new(color, mix.inputs[1]); mix.inputs[2].default_value = (*linear((48, 64, 30)), 1)
        color = mix.outputs['Color']
    if attributes:
        shade = n.new('ShaderNodeAttribute'); shade.attribute_name = 'FD_Dark'
        darken = n.new('ShaderNodeMixRGB'); darken.blend_type = 'MULTIPLY'
        l.new(shade.outputs['Fac'], darken.inputs[0]); l.new(color, darken.inputs[1]); darken.inputs[2].default_value = (*linear((92, 80, 66)), 1)
        color = darken.outputs['Color']
        alpha = n.new('ShaderNodeAttribute'); alpha.attribute_name = 'FD_Alpha'
        l.new(alpha.outputs['Fac'], bsdf.inputs['Alpha'])
    l.new(color, bsdf.inputs['Base Color'])
    bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .4; bump.inputs['Distance'].default_value = .015
    fine = n.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = 60; l.new(geo.outputs['Position'], fine.inputs['Vector'])
    l.new(fine.outputs['Fac'], bump.inputs['Height']); l.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


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
    for attr, values in (('FD_Alpha', alphas), ('FD_Dark', darks)):
        layer = ob.data.color_attributes.new(attr, 'FLOAT_COLOR', 'POINT')
        for v, value in zip(layer.data, values): v.color = (value, value, value, 1)
    ob['fdGround'] = True
    return ob


def wobble(x, y, seed=0):
    """Cheap smooth 2-D noise in -1..1 for rims and heights."""
    return (math.sin(x * 2.3 + seed) * math.cos(y * 1.7 - seed * .7) + .6 * math.sin(x * 5.1 - y * 4.3 + seed * 1.3)) / 1.6


def turned_sheet(c, name, k, x0, y0, x1, y1, sample, mat, step=.07):
    """ground_sheet over a local rectangle of quarter turn k."""
    t, inv = Turn(k), Turn(-k)
    a, b = t.p(x0, y0)[:2], t.p(x1, y1)[:2]
    return ground_sheet(c, name, min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]),
                        lambda x, y: sample(*inv.p(x, y)[:2]), mat, step)


class FortMaster:
    def __init__(self, c, m, ground='gravel', stage=0, seed=7):
        self.c, self.b, self.rng, self.ground, self.stage = c, Batch(c), random.Random(seed), ground, stage
        self.sockets = {}
        self.p = dict(
            bark=m('Bark log', (96, 76, 56), .35), cut=m('Cut log end', (164, 134, 94), .3), plank=m('Silvered timber', (146, 134, 112), .3),
            oak=m('Weathered oak', (110, 88, 62), .32), tar=m('Dark tarred timber', (60, 52, 44), .2), rope=m('Hemp cord', (142, 128, 94), .3),
            iron=m('Forged iron', (92, 96, 94), .25), dark=m('Soot iron', (43, 44, 39), .18), stone=m('Fieldstone', (128, 124, 112), .4),
            flag=m('Pennant red canvas', (128, 48, 38), .25), flag2=m('Pennant yellow canvas', (176, 146, 70), .25),
            straw=m('Straw litter', (170, 146, 92), .2), chip=m('Wood chips', (150, 120, 84), .25),
            ember=m('Separate forge ember', (230, 96, 24), .05, .9), coal=m('Forge coal', (30, 29, 25), .1),
            brass=m('Worn brass fittings', (158, 119, 61), .3), lamp=m('Separate lantern emission', (244, 153, 53), .01, .7),
            tuft=m('Turf tuft', (58, 74, 36), .3), tuft2=m('Dry turf tuft', (104, 98, 62), .3),
            fresh=m('Fresh bark log', (124, 98, 68), .3), freshcut=m('Fresh cut log end', (196, 164, 116), .25),
            mossy=m('Mossy log tip', (96, 104, 62), .35), moss=m('Masonry moss', (60, 76, 38), .5), fern=m('Fern frond', (52, 78, 34), .3),
            fern2=m('Dry fern frond', (92, 90, 46), .3), bloom=m('Meadow flower white', (214, 210, 190), .1),
            bloom2=m('Meadow flower yellow', (204, 172, 64), .1), nail=m('Soot iron', (43, 44, 39), .18))
        self.earth = ground_material('Earthwork loam', (98, 80, 58), (64, 52, 38), .15)
        self.bank = ground_material('Grassed bank', (78, 92, 50), (50, 64, 32), .5)
        self.track = ground_material('Trampled track', (100, 86, 66), (68, 58, 44))
        self.loam = ground_material('Courtyard loam', (118, 100, 74), (84, 68, 50), .25)
        self.puddle = ground_material('Puddle', (30, 33, 33), (22, 24, 25), 0, True, False)

    def socket(self, name, xyz):
        self.sockets[f'{name}_{len(self.sockets)}'] = xyz

    # -- shared parts ---------------------------------------------------------------
    def log(self, t, x, y, h, r=None):
        rng, b = self.rng, self.b
        r = r or LOG_R + rng.uniform(-.014, .012)
        h += rng.uniform(-.09, .09)
        fresh = rng.random() < .1                      # a replaced log stands out lighter
        b.cylinder(t.p(x, y, h / 2), r, h, self.p['fresh' if fresh else 'bark'], 10, .008, None, rng.uniform(0, 1))
        px, py, _ = t.p(x + rng.uniform(-.008, .008), y + rng.uniform(-.008, .008))
        tip = 'freshcut' if fresh else ('mossy' if rng.random() < .16 else 'cut')
        cone(self.c, 'Sharpened log tip', (px, py), r, h, h + rng.uniform(.14, .2), self.p[tip], 8, 0, rng.uniform(0, 1))

    def logs(self, t, a, b, fixed, along_x, h):
        n = max(1, round(abs(b - a) / LOG_PITCH))
        for i in range(n):
            v = a + (b - a) * (i + .5) / n
            self.log(t, *((v, fixed) if along_x else (fixed, v)), h)

    def post(self, t, x, y, h, r, square=False):
        b, p = self.b, self.p
        if square:
            b.box(t.p(x, y, h / 2), (2 * r, 2 * r, h), p['oak'], .015, t.r(), .008, self.rng)
            b.box(t.p(x, y, h + .025), (2 * r + .04, 2 * r + .04, .05), p['tar'], .006, t.r())
            for z in (.45, h - .35):
                b.box(t.p(x, y, z), (2 * r + .02, 2 * r + .02, .05), p['iron'], .004, t.r())
        else:
            b.cylinder(t.p(x, y, h / 2), r, h, p['bark'], 12, .01, None, self.rng.uniform(0, 1))
            b.cylinder(t.p(x, y, h + .03), r + .02, .06, p['tar'], 12, .006)
            b.cylinder(t.p(x, y, h - .3), r + .012, .05, p['iron'], 12, .004)

    def deck(self, t, x0, y0, x1, y1, z, boards_along_y):
        """Plank deck on a tarred frame; staggered butt joints and the odd darker board."""
        b, rng, p = self.b, self.rng, self.p
        b.box(t.p((x0 + x1) / 2, (y0 + y1) / 2, z / 2 - .03), (x1 - x0, y1 - y0, z - .06), p['tar'], .01, t.r())
        span = (x0, x1) if boards_along_y else (y0, y1)
        run = (y0, y1) if boards_along_y else (x0, x1)
        u = span[0]
        while u < span[1] - .03:
            w = min(.13, span[1] - u)
            v = run[0]
            while v < run[1] - .03:
                length = min(rng.uniform(.6, 1.4), run[1] - v)
                mat = p['oak'] if rng.random() < .28 else p['plank']
                cx, cy = ((u + w / 2, v + length / 2) if boards_along_y else (v + length / 2, u + w / 2))
                size = ((w - .014, length - .012, .045) if boards_along_y else (length - .012, w - .014, .045))
                b.box(t.p(cx, cy, z - .022 + rng.uniform(0, .006)), size, mat, .006, t.r(), .005, rng)
                for end in (v + .05, v + length - .05):          # two nails at each board end
                    for side in (-.03, .03):
                        nx, ny = ((u + w / 2 + side, end) if boards_along_y else (end, u + w / 2 + side))
                        b.cylinder(t.p(nx, ny, z + .002), .009, .006, p['nail'], 6, 0)
                v += length
            u += w

    def beam(self, t, a, b_, z, width, height, mat=None):
        """A squared timber between two plan points; z is its top."""
        (ax, ay), (bx, by) = a, b_
        length = math.hypot(bx - ax, by - ay)
        rz = math.atan2(by - ay, bx - ax)
        self.b.box(t.p((ax + bx) / 2, (ay + by) / 2, z - height / 2), (length, width, height), mat or self.p['tar'], .008, t.r(0, 0, rz))

    def lantern(self, t, x, y, z, arm_from=None):
        b, p = self.b, self.p
        if arm_from:
            b.rod(t.p(*arm_from), t.p(x, y, arm_from[2]), .016, p['dark'], 6)
        b.cylinder(t.p(x, y, z + .17), .065, .035, p['brass'], 10, .005)
        b.cylinder(t.p(x, y, z + .085), .048, .14, p['lamp'], 10, 0)
        self.socket('lamp', t.p(x, y, z + .085))

    def torch(self, t, x, y, z):
        b, p, rng = self.b, self.p, self.rng
        b.cylinder(t.p(x, y, z + .06), .085, .12, p['iron'], 10, .006)
        b.cylinder(t.p(x, y, z + .118), .07, .018, p['coal'], 10, 0)
        b.cylinder(t.p(x, y, z + .124), .045, .016, p['ember'], 10, 0)
        for i in range(4):
            a = i * 1.7 + rng.uniform(0, 1)
            b.ell(t.p(x + .035 * math.cos(a), y + .035 * math.sin(a), z + .13), (.022, .018, .014), p['coal'], 8, 4)
        self.socket('fire', t.p(x, y, z + .25))

    # -- one quarter: tower (-3, 3), arms (-2, 3) and (-3, 2), the north gate -------------
    def quarter(self, k):
        t, b, p = Turn(k), self.b, self.p
        inner_post = INNER + .06
        # Tower: higher deck framed by heavy beams where it meets the arms.
        self.deck(t, -3.5 + WALL, INNER, -INNER, 3.5 - WALL, TOWER_DECK, False)
        self.beam(t, (-INNER - .05, INNER), (-INNER - .05, 3.5 - WALL), TOWER_DECK + .02, .12, .1)
        self.beam(t, (-3.5 + WALL, INNER + .05), (-INNER, INNER + .05), TOWER_DECK + .02, .12, .1)
        self.post(t, -LINE, LINE, 2.55, .16)
        self.post(t, -inner_post, LINE, 2.25, .12)
        self.post(t, -LINE, inner_post, 2.25, .12)
        self.post(t, -inner_post, inner_post, TOWER_DECK + 1.05, .085)
        self.logs(t, -LINE + .18, -inner_post - .14, LINE, True, 2.0)
        self.logs(t, inner_post + .14, LINE - .18, -LINE, False, 2.0)
        # Arms: fighting walks between tower and gate, palisade outside, rail and edge beam inside.
        self.deck(t, -INNER, INNER, -1.5 - WALL, 3.5 - WALL, ARM_DECK, True)
        self.deck(t, -3.5 + WALL, 1.5 + WALL, -INNER, INNER, ARM_DECK, False)
        gate_x = 1.5 + WALL / 2
        self.logs(t, -inner_post + .14, -gate_x - .17, LINE, True, 1.6)
        self.logs(t, gate_x + .17, inner_post - .14, -LINE, False, 1.6)
        self.logs(t, inner_post + .16, LINE - .16, -gate_x, False, 1.6)       # closed ends between the gate posts
        self.logs(t, -LINE + .16, -inner_post - .16, gate_x, True, 1.6)
        for a, b_ in (((-LINE + .15, LINE - LOG_R - .04), (-gate_x - .15, LINE - LOG_R - .04)),
                      ((-LINE + LOG_R + .04, gate_x + .15), (-LINE + LOG_R + .04, LINE - .15))):
            self.beam(t, a, b_, 1.25, .07, .09)                                # binding wale
        for a, b_ in (((-INNER, INNER + .04), (-gate_x - .15, INNER + .04)), ((-INNER - .04, gate_x + .15), (-INNER - .04, INNER))):
            self.beam(t, a, b_, ARM_DECK + .02, .1, .1)                        # courtyard edge beam
            for f in (0, .5, 1):
                x, y = a[0] + (b_[0] - a[0]) * f, a[1] + (b_[1] - a[1]) * f
                b.cylinder(t.p(x, y, ARM_DECK + .25), .028, .5, p['oak'], 8, .004)
            self.beam(t, a, b_, ARM_DECK + .52, .055, .05, p['oak'])           # hand rail
        # Gate posts at both arm ends: torches outside, lanterns inside, all facing the passage.
        for (ox, oy), (ix, iy), (dx, dy) in (((-gate_x, LINE), (-gate_x, inner_post), (1, 0)),
                                             ((-LINE, gate_x), (-inner_post, gate_x), (0, -1))):
            self.post(t, ox, oy, 2.3, .16, True)
            self.post(t, ix, iy, 1.95, .14, True)
            self.torch(t, ox, oy, 2.33)
            self.lantern(t, ix + dx * .25, iy + dy * .25, 1.3, (ix, iy, 1.65))
        # Lights along the outline: tower corner, mid-walls, inner tower corner.
        self.lantern(t, -3.74, 3.74, 1.6, (-LINE, LINE, 2.0))
        self.lantern(t, -2.0, 3.72, 1.15, (-2.0, LINE, 1.45))
        self.lantern(t, -3.72, 2.0, 1.15, (-LINE, 2.0, 1.45))
        self.lantern(t, -2.36, 2.36, TOWER_DECK + .55, (-inner_post, inner_post, TOWER_DECK + .95))
        self.gate(t)
        self.flag(t)
        self.wall_details(t, k)

    def gate(self, t):
        """North gate: iron-banded sills continue the outer palisade line and the inner edge line."""
        b, p = self.b, self.p
        # Dark, flush and narrow, so they read as thresholds in the gravel, never as a wall.
        x = 1.5 + WALL / 2 - .14
        for y, width in ((LINE, .11), (INNER + .05, .065)):
            self.beam(t, (-x, y), (x, y), .018, width, .04, p['tar'])
            for f in (-.66, 0, .66):
                b.box(t.p(f * x, y, .018), (.04, width + .01, .038), p['iron'], .003, t.r())

    def flag(self, t):
        """Pennant on the tower's corner post; every pennant blows the same way (world +X)."""
        from dawn_parts import plate
        b, p = self.b, self.p
        x, y, _ = t.p(-LINE, LINE)
        b.cylinder((x, y, 2.55 + .6), .035, 1.2, p['oak'], 8, .004)
        root_a, root_b, tip = (x + .03, y + .13), (x + .03, y - .13), (x + .66, y - .04)
        plate(self.c, 'Fort pennant', (0, 0, 3.05), [root_a, tip, root_b], .02, p['flag'], .004)
        plate(self.c, 'Fort pennant band', (0, 0, 3.07), [root_a, ((root_a[0] + tip[0]) / 2, (root_a[1] + tip[1]) / 2 + .01), (x + .03, y)],
              .02, p['flag2'], .003)

    def wall_details(self, t, k):
        """Iron clamps on the wales, a hatch in the tower deck and, on two sides, a woodpile outside."""
        b, p = self.b, self.p
        for i in range(6):
            u = -3.1 + i * .27
            if u < -1.8: b.box(t.p(u, LINE - LOG_R - .04, 1.26), (.04, .1, .04), p['iron'], .004, t.r())
            v = 3.1 - i * .27
            if v > 1.8: b.box(t.p(-LINE + LOG_R + .04, v, 1.26), (.1, .04, .04), p['iron'], .004, t.r())
        hx, hy = -2.78, 2.78
        b.box(t.p(hx, hy, TOWER_DECK + .004), (.36, .36, .03), p['tar'], .004, t.r())
        for j in range(3):
            b.box(t.p(hx - .1 + j * .1, hy, TOWER_DECK + .012), (.085, .3, .025), p['plank'], .004, t.r())
        b.cylinder(t.p(hx + .1, hy, TOWER_DECK + .03), .03, .012, p['iron'], 10, 0)
        if k % 2 == 0:
            for row in range(2):
                for j in range(3 - row):
                    y, z = 3.58 + j * .13 + row * .065, .065 + row * .11
                    b.rod(t.p(-2.48, y, z), t.p(-1.86, y, z), .062, p['bark'], 10)

    # -- ground: glacis, approaches, chips, courtyard ------------------------------------
    def glacis(self, k):
        """Earth banked against the north palisade and round the north-west corner.

        A narrow strip of trodden dark earth hugs the log feet; beyond it a grassed bank of uneven
        width runs out softly into the meadow. Both open for the gate road. Long grass grows in
        clumps along the foot, as it does where a mower never reaches.
        """
        rng, t, b, p = self.rng, Turn(k), self.b, self.p
        width = .9

        def out_of(x, y):
            return y - 3.5 if x >= -3.5 else math.hypot(-3.5 - x, y - 3.5)

        def road(x):
            return min(1.0, max(0.0, (abs(x) - 1.45) / .45))

        def bank(x, y):
            if y < 3.5 - .02 or x > 3.5: return None
            w = width * (1 + .38 * wobble(x * .9, y * .9, k))
            f = max(0.0, 1 - out_of(x, y) / w) * road(x)
            if f <= 0: return (.004, 0.0, 0.0)
            soft = f * f * (3 - 2 * f)
            return (.2 * f ** 1.6 + .004, min(1.0, soft * 1.3), .1 * (1 - f))

        def foot(x, y):
            if y < 3.5 - .02 or x > 3.5: return None
            w = .2 * (1 + .45 * wobble(x * 2.1, y * 2.1, k + 7))
            f = max(0.0, 1 - out_of(x, y) / w) * road(x)
            if f <= 0: return (.008, 0.0, 0.0)
            return (.2 * max(0.0, 1 - out_of(x, y) / width) ** 1.6 + .008, min(1.0, f * 1.4), .45 * f)
        turned_sheet(self.c, 'Glacis bank', k, -3.5 - width * 1.4, 3.48, 3.5, 3.5 + width * 1.4, bank, self.bank, .06)
        turned_sheet(self.c, 'Palisade foot', k, -3.5 - .4, 3.48, 3.5, 3.5 + .4, foot, self.earth, .04)
        for _ in range(24):                                                       # grass clumps along the foot
            u = rng.uniform(-3.9, 3.4)
            if abs(u) < 1.6: continue
            v = rng.uniform(3.53, 3.68) if u > -3.5 else rng.uniform(3.53, 3.9)
            for _ in range(rng.randrange(4, 8)):
                a = rng.uniform(-1.2, 1.2) + math.pi / 2
                ln = rng.uniform(.05, .09)
                bx, by = u + math.cos(a) * ln * .6, v + math.sin(a) * ln * .6
                b.ell(t.p(bx, by, .12), (ln, .008, .02), p['tuft'] if rng.random() > .3 else p['tuft2'], 6, 3,
                      t.r(rng.uniform(-.4, .4), 0, a))
        for _ in range(30):                                                       # stones and tufts on the bank
            u, v = rng.uniform(-4.2, 3.4), rng.uniform(3.7, 4.35)
            if abs(u) < 1.7: continue
            if rng.random() < .65:
                s = rng.uniform(.03, .06)
                b.ell(t.p(u, v, .1), (s, s, .04), p['tuft'] if rng.random() > .35 else p['tuft2'], 8, 4)
            else:
                s = rng.uniform(.025, .05)
                b.box(t.p(u, v, .06), (s * 1.4, s, s * .7), p['stone'], .01, t.r(0, 0, rng.uniform(0, 3)), .01, rng)

    def approach(self, k):
        """Worn gate passage and road through the glacis, fading out into the meadow."""
        def sample(x, y):
            if abs(x) > 1.9 or not 1.1 < y < 5.4: return None
            f = max(0.0, 1 - max(0.0, abs(x) - 1.15) / .75) * min(1.0, max(0.0, (5.4 - y) / 1.4))
            if y < 2.5: f *= .45 * min(1.0, (y - 1.1) / .6)                   # worn path over the courtyard gravel
            f *= .85 + .15 * wobble(x * 1.5, y * 1.5, k + 2)
            rut = max(0.0, 1 - abs(abs(x) - .55) / .12) * .5
            return (.003, min(1.0, f * .85), min(1.0, .2 + rut))
        turned_sheet(self.c, 'Gate approach', k, -1.9, 1.1, 1.9, 5.4, sample, self.track, .08)
        t, rng = Turn(k), self.rng
        for _ in range(rng.randrange(1, 3)):                                      # puddles in the ruts
            x, y = rng.choice((-.55, .55)) + rng.uniform(-.05, .05), rng.uniform(3.9, 4.9)
            s = rng.uniform(.16, .3)
            self.b.ell(t.p(x, y, .008), (s * .45, s, .006), self.puddle, 14, 3, t.r(0, 0, rng.uniform(-.2, .2)))

    def gutter(self, k):
        """Stone-lined gutter along the two courtyard faces of the quarter's arms."""
        t, b, rng, p = Turn(k), self.b, self.rng, self.p
        runs = (((-INNER, INNER - .13), (-1.5 - WALL, INNER - .13)), ((-INNER + .13, 1.5 + WALL), (-INNER + .13, INNER)))
        for (ax, ay), (bx, by) in runs:
            length = math.hypot(bx - ax, by - ay)
            n = max(1, round(length / .12))
            for i in range(n):
                f = (i + .5) / n
                x, y = ax + (bx - ax) * f, ay + (by - ay) * f
                s = rng.uniform(.09, .11)
                size = (s, .09, .035) if ay == by else (.09, s, .035)
                b.box(t.p(x, y, .02), size, p['stone'], .012, t.r(), .008, rng)
            off = -.09
            if ay == by: self.beam(t, (ax, ay + off), (bx, by + off), .01, .07, .01, p['coal'])
            else: self.beam(t, (ax - off, ay), (bx - off, by), .01, .07, .01, p['coal'])

    def rose(self):
        """Stone rose in the courtyard centre, grown into the ground rather than laid on it.

        The ring sits in a bed of trodden earth that fades into the gravel; its stones are sunk to
        different depths, a little shifted, one is missing; moss and grass fill the joints and
        creep in from the rim; the timber spokes are worn and half covered with grit.
        """
        b, rng, p = self.b, self.rng, self.p

        def bed(x, y):
            r = math.hypot(x, y)
            edge = 1.45 + .18 * wobble(x * 1.3, y * 1.3, 11)
            if r > edge + .02: return None
            f = min(1.0, max(0.0, (edge - r) / .45))
            ring = max(0.0, 1 - abs(r - 1.0) / .3)
            return (.003, min(1.0, f * .85), .25 + .35 * ring)
        ground_sheet(self.c, 'Rose bed', -1.75, -1.75, 1.75, 1.75, bed, self.track, .05)
        missing = rng.randrange(20)
        for i in range(20):
            if i == missing: continue
            a = i * math.tau / 20 + rng.uniform(-.03, .03)
            r = 1.0 + rng.uniform(-.025, .025)
            b.box((r * math.cos(a), r * math.sin(a), rng.uniform(.0, .022)), (.29, .165, .045), p['stone'], .018,
                  (rng.uniform(-.03, .03), rng.uniform(-.03, .03), a + math.pi / 2 + rng.uniform(-.06, .06)), .014, rng)
        for k in range(4):
            self.beam(Turn(k), (.34, rng.uniform(-.02, .02)), (.84, rng.uniform(-.02, .02)), .018, .11, .04, p['tar'])
        b.cylinder((0, 0, .02), .3, .04, p['stone'], 24, .02)
        b.cylinder((0, 0, .041), .11, .014, p['iron'], 16, .004)
        for _ in range(48):                                                       # moss and grass in and round the ring
            a = rng.uniform(0, math.tau)
            r = rng.choice((rng.uniform(.84, .9), rng.uniform(1.09, 1.25), rng.uniform(.95, 1.05)))
            s = rng.uniform(.02, .045)
            mat = p['moss'] if r > 1.05 or rng.random() < .4 else p['tuft']
            b.ell((r * math.cos(a), r * math.sin(a), .04), (s, s * .7, .012), mat, 8, 3, (0, 0, a))
        for _ in range(26):                                                       # grit on the spokes and the hub
            a, r = rng.uniform(0, math.tau), rng.uniform(.3, .85)
            b.box((r * math.cos(a), r * math.sin(a), .03), (.025, .02, .01), p['stone'], 0, (0, 0, rng.uniform(0, 3)))

    def chips(self, k, count=50):
        t, b, rng, p = Turn(k), self.b, self.rng, self.p
        for _ in range(count):
            side = rng.random()
            if side < .5: x, y = rng.uniform(-3.4, 3.4), rng.uniform(3.5, 3.8)
            else: x, y = rng.uniform(-2.45, -1.75), rng.uniform(2.1, 2.3)
            if side < .5 and abs(x) < 1.5: continue
            mat = p['straw'] if rng.random() < .35 else p['chip']
            b.box(t.p(x, y, .012), (rng.uniform(.03, .07), rng.uniform(.01, .025), .01), mat, 0, t.r(0, 0, rng.uniform(0, 3.2)))

    def forest(self, k):
        """Ferns at the tower corners and flowers on the bank."""
        t, b, rng, p = Turn(k), self.b, self.rng, self.p
        cx, cy = -3.98, 3.98
        for i in range(9):
            a = i * math.tau / 9 + rng.uniform(-.15, .15)
            ln = rng.uniform(.18, .28)
            b.ell(t.p(cx + ln * .5 * math.cos(a), cy + ln * .5 * math.sin(a), .07), (ln * .5, .045, .012),
                  p['fern'] if rng.random() > .25 else p['fern2'], 10, 3, t.r(rng.uniform(-.2, .2), 0, a))
        for _ in range(22):
            u, v = rng.uniform(-4.2, 3.4), rng.uniform(3.62, 4.15)
            if abs(u) < 1.6: continue
            b.ell(t.p(u, v, .1), (.016, .016, .01), p['bloom'] if rng.random() > .4 else p['bloom2'], 6, 3)

    def loam_courtyard(self):
        """The earlier loam study: packed loam over the build area."""
        inside = build_area(self.stage)
        reach = 3.5 if self.stage == 0 else 4 + self.stage + .5

        def coverage(x, y):
            gx, gy = round(x), round(-y)
            best = 0.0
            for ox in (-1, 0, 1):
                for oy in (-1, 0, 1):
                    if inside(gx + ox, gy + oy):
                        d = max(abs(x - gx - ox), abs(-y - gy - oy))
                        best = max(best, 1.0 if d <= .5 else max(0.0, 1 - (d - .5) / .7))
            return best

        def sample(x, y):
            f = coverage(x, y) * (.9 + .1 * wobble(x * 1.7, y * 1.7, 5))
            if f <= .01: return None
            return (.002, min(1.0, f * 1.2), .15 * (1 + wobble(x, y, 9)) / 2)
        r = reach + 1
        ground_sheet(self.c, 'Courtyard loam', -r, -r, r, r, sample, self.loam, .1)

    def build(self):
        for k in range(4):
            self.quarter(k)
            self.glacis(k)
            self.approach(k)
            self.gutter(k)
            self.chips(k)
            self.forest(k)
        self.rose()
        if self.ground == 'loam': self.loam_courtyard()
        for ob in self.b.flush('Fort master'):
            if any(key in ob.name for key in ('Wood chips', 'Straw', 'Turf', 'Puddle', 'Fern', 'Meadow flower', 'Masonry moss', 'Fieldstone')):
                ob['fdGround'] = True
        return self.sockets
