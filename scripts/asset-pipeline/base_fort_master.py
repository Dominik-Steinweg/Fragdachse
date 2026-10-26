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
            tuft=m('Turf tuft', (58, 74, 36), .3), tuft2=m('Dry turf tuft', (104, 98, 62), .3))
        self.earth = ground_material('Earthwork loam', (104, 86, 62), (70, 56, 40), .6)
        self.track = ground_material('Trampled track', (100, 86, 66), (68, 58, 44))
        self.loam = ground_material('Courtyard loam', (118, 100, 74), (84, 68, 50), .25)

    def socket(self, name, xyz):
        self.sockets[f'{name}_{len(self.sockets)}'] = xyz

    # -- shared parts ---------------------------------------------------------------
    def log(self, t, x, y, h, r=None):
        rng, b = self.rng, self.b
        r = r or LOG_R + rng.uniform(-.012, .01)
        h += rng.uniform(-.08, .08)
        b.cylinder(t.p(x, y, h / 2), r, h, self.p['bark'], 10, .008, None, rng.uniform(0, 1))
        px, py, _ = t.p(x + rng.uniform(-.008, .008), y + rng.uniform(-.008, .008))
        cone(self.c, 'Sharpened log tip', (px, py), r, h, h + .17, self.p['cut'], 8, 0, rng.uniform(0, 1))

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
        if k == 0: self.flag(t)

    def gate(self, t):
        """North gate: iron-banded sills continue the outer palisade line and the inner edge line."""
        b, p = self.b, self.p
        # Dark, flush and narrow, so they read as thresholds in the gravel, never as a wall.
        x = 1.5 + WALL / 2 - .14
        for y, width in ((LINE, .17), (INNER + .05, .09)):
            self.beam(t, (-x, y), (x, y), .018, width, .04, p['tar'])
            for f in (-.66, 0, .66):
                b.box(t.p(f * x, y, .018), (.04, width + .01, .038), p['iron'], .003, t.r())

    def flag(self, t):
        from dawn_parts import plate
        b, p = self.b, self.p
        x, y = -LINE, LINE
        b.cylinder(t.p(x, y, 2.55 + .6), .035, 1.2, p['oak'], 8, .004)
        tip = t.p(x + .62, y - .1)[:2]
        root_a, root_b = t.p(x + .03, y)[:2], t.p(x + .03, y - .26)[:2]
        plate(self.c, 'Fort pennant', (0, 0, 3.05), [root_a, tip, root_b], .02, p['flag'], .004)
        mid = ((root_a[0] + tip[0]) / 2, (root_a[1] + tip[1]) / 2)
        plate(self.c, 'Fort pennant band', (0, 0, 3.07), [root_a, mid, ((root_a[0] + root_b[0]) / 2, (root_a[1] + root_b[1]) / 2)],
              .02, p['flag2'], .003)

    # -- ground: glacis, approaches, chips, courtyard ------------------------------------
    def glacis(self, k):
        """Earth bank round the north side and the north-west corner; it opens for the gate road."""
        rng, t = self.rng, Turn(k)
        width = .7

        def sample(x, y):
            if y < 3.5 - .02 or x > 3.5: return None
            out = y - 3.5 if x >= -3.5 else math.hypot(-3.5 - x, y - 3.5)
            w = width * (1 + .22 * wobble(x, y, k))
            f = max(0.0, 1 - out / w)
            f *= min(1.0, max(0.0, (abs(x) - 1.45) / .45))                    # gate road
            if f <= 0: return (.004, 0.0, 0.0)
            return (.22 * f ** 1.5 + .004, min(1.0, f * 1.7), .2 * f)
        turned_sheet(self.c, 'Glacis', k, -3.5 - width * 1.3, 3.48, 3.5, 3.5 + width * 1.3, sample, self.earth, .06)
        b = self.b
        for _ in range(28):
            u, v = rng.uniform(-4.1, 3.4), rng.uniform(3.55, 4.05)
            if abs(u) < 1.5: continue
            if rng.random() < .6:
                s = rng.uniform(.035, .07)
                b.ell(t.p(u, v, .12), (s, s, .05), self.p['tuft'] if rng.random() > .3 else self.p['tuft2'], 8, 4)
            else:
                s = rng.uniform(.03, .06)
                b.box(t.p(u, v, .08), (s * 1.4, s, s * .8), self.p['stone'], .01, t.r(0, 0, rng.uniform(0, 3)), .01, rng)

    def approach(self, k):
        """Worn gate passage and road through the glacis, fading out into the meadow."""
        def sample(x, y):
            if abs(x) > 1.9 or not 2.4 < y < 5.4: return None
            f = max(0.0, 1 - max(0.0, abs(x) - 1.15) / .75) * min(1.0, max(0.0, (5.4 - y) / 1.4))
            f *= .85 + .15 * wobble(x * 1.5, y * 1.5, k + 2)
            rut = max(0.0, 1 - abs(abs(x) - .55) / .12) * .5
            return (.003, min(1.0, f * .85), min(1.0, .2 + rut))
        turned_sheet(self.c, 'Gate approach', k, -1.9, 2.4, 1.9, 5.4, sample, self.track, .08)

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
        """Flat stone rose in the courtyard centre: a ring of dressed stones and four timber spokes."""
        b, rng, p = self.b, self.rng, self.p
        for i in range(20):
            a = i * math.tau / 20
            b.box((1.0 * math.cos(a), 1.0 * math.sin(a), .025), (.3, .17, .045), p['stone'], .015, (0, 0, a + math.pi / 2), .01, rng)
        for k in range(4):
            self.beam(Turn(k), (.32, 0), (.86, 0), .03, .12, .05, p['oak'])
        b.cylinder((0, 0, .025), .3, .05, p['stone'], 24, .02)
        b.cylinder((0, 0, .05), .12, .02, p['iron'], 16, .004)

    def chips(self, k, count=50):
        t, b, rng, p = Turn(k), self.b, self.rng, self.p
        for _ in range(count):
            side = rng.random()
            if side < .5: x, y = rng.uniform(-3.4, 3.4), rng.uniform(3.5, 3.8)
            else: x, y = rng.uniform(-2.45, -1.75), rng.uniform(2.1, 2.3)
            if side < .5 and abs(x) < 1.5: continue
            mat = p['straw'] if rng.random() < .35 else p['chip']
            b.box(t.p(x, y, .012), (rng.uniform(.03, .07), rng.uniform(.01, .025), .01), mat, 0, t.r(0, 0, rng.uniform(0, 3.2)))

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
        self.rose()
        if self.ground == 'loam': self.loam_courtyard()
        for ob in self.b.flush('Fort master'):
            if any(key in ob.name for key in ('Wood chips', 'Straw', 'Turf')):
                ob['fdGround'] = True
        return self.sockets
