"""Palisadenschanze master: the persistent base core as one hand-built asset (1 BU = 1 m = 32 px).

The core never changes shape, so it is built once with cross-cell details instead of from the
cell kit: four L-shaped bastions (corner cell plus two arms) with a plank fighting deck, a sharpened
palisade on the outer sides, closed palisade ends with two gate posts at every entrance, a hand rail
towards the courtyard, and earthwork, chips and worn tracks as ground transitions. Cell centres stay
free for turrets; lights hang at outer corners, along the outer palisade, at the inner corners and
on the gate posts. Ground objects carry `fdGround` so a runtime pass can split them from the
structure. The north-west bastion is authored once and turned by quarter turns about the centre.

ground = gravel: only transitions over the game's gravel; ground = loam: packed loam with ruts,
puddles and a boardwalk cross over the build area of `buildStage` (PersistentBaseCore rule).
"""
import math
import random
from base_structure_parts import Batch, mesh_object, cone
from dawn_parts import linear

DECK, WALL = .74, .26          # deck top; outer palisade zone width
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
    """Noise-broken ground colour; vertex attributes FD_Alpha (coverage) and FD_Dark (wear/ruts)."""
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
        grow = n.new('ShaderNodeMapRange'); grow.inputs['From Min'].default_value = .52; grow.inputs['From Max'].default_value = .64
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


class FortMaster:
    def __init__(self, c, m, ground='gravel', stage=0, seed=7):
        self.c, self.b, self.rng, self.ground, self.stage = c, Batch(c), random.Random(seed), ground, stage
        self.sockets = {}
        self.p = dict(
            bark=m('Bark log', (82, 64, 46), .35), cut=m('Cut log end', (156, 126, 88), .3), plank=m('Silvered timber', (140, 128, 106), .3),
            oak=m('Weathered oak', (104, 84, 60), .32), tar=m('Dark tarred timber', (58, 50, 42), .2), rope=m('Hemp cord', (142, 128, 94), .3),
            iron=m('Forged iron', (92, 96, 94), .25), dark=m('Soot iron', (43, 44, 39), .18), burlap=m('Sandbag burlap', (132, 116, 82), .3),
            stone=m('Fieldstone', (120, 118, 106), .4), straw=m('Straw litter', (170, 146, 92), .2), chip=m('Wood chips', (150, 120, 84), .25),
            ember=m('Separate forge ember', (230, 96, 24), .05, .9), coal=m('Forge coal', (30, 29, 25), .1),
            brass=m('Worn brass fittings', (158, 119, 61), .3), lamp=m('Separate lantern emission', (244, 153, 53), .01, .7),
            tuft=m('Turf tuft', (58, 74, 36), .3), tuft2=m('Dry turf tuft', (104, 98, 62), .3))
        self.earth = ground_material('Earthwork loam', (104, 86, 62), (70, 56, 40), .55)
        self.track = ground_material('Trampled track', (96, 80, 60), (64, 52, 38))
        self.loam = ground_material('Courtyard loam', (118, 100, 74), (84, 68, 50), .25)
        self.puddle = ground_material('Puddle', (34, 36, 34), (24, 26, 26), 0, True, False)

    def socket(self, name, xyz):
        self.sockets[f'{name}_{len(self.sockets)}'] = xyz

    # -- one bastion in the north-west frame --------------------------------------------
    def log(self, t, x, y, r=None, top=None):
        rng, b = self.rng, self.b
        r = r or LOG_R + rng.uniform(-.012, .01)
        h = top or 1.5 + rng.uniform(-.09, .09)
        b.cylinder(t.p(x, y, h / 2), r, h, self.p['bark'], 10, .008, None, rng.uniform(0, 1))
        px, py, _ = t.p(x + rng.uniform(-.008, .008), y + rng.uniform(-.008, .008))
        cone(self.c, 'Sharpened log tip', (px, py), r, h, h + .17, self.p['cut'], 8, 0, rng.uniform(0, 1))

    def logs(self, t, a, b, fixed, along_x):
        """Palisade run from a to b along one axis at the fixed coordinate."""
        n = max(1, round(abs(b - a) / LOG_PITCH))
        for i in range(n):
            v = a + (b - a) * (i + .5) / n
            self.log(t, *((v, fixed) if along_x else (fixed, v)))

    def deck(self, t, x0, y0, x1, y1, boards_along_y):
        """Plank deck on a tarred frame; boards with staggered butt joints and the odd darker board."""
        b, rng, p = self.b, self.rng, self.p
        b.box(t.p((x0 + x1) / 2, (y0 + y1) / 2, DECK / 2 - .03), (x1 - x0, y1 - y0, DECK - .06), p['tar'], .01, t.r())
        span = (x0, x1) if boards_along_y else (y0, y1)
        run = (y0, y1) if boards_along_y else (x0, x1)
        u = span[0]
        while u < span[1] - .03:
            w = min(.135, span[1] - u)
            v = run[0]
            while v < run[1] - .03:
                length = min(rng.uniform(.7, 1.6), run[1] - v)
                mat = p['oak'] if rng.random() < .3 else p['plank']
                cx, cy = ((u + w / 2, v + length / 2) if boards_along_y else (v + length / 2, u + w / 2))
                size = ((w - .014, length - .012, .045) if boards_along_y else (length - .012, w - .014, .045))
                b.box(t.p(cx, cy, DECK - .022 + rng.uniform(0, .008)), size, mat, .006, t.r(), .005, rng)
                v += length
            u += w

    def lantern(self, t, x, y, z, arm_to=None):
        b, p = self.b, self.p
        if arm_to:
            b.rod(t.p(*arm_to), t.p(x, y, arm_to[2]), .016, p['dark'], 6)
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

    def bastion(self, k):
        """North-west bastion: corner cell (-3, 3), arms (-2, 3) east and (-3, 2) south."""
        t, b, p, rng = Turn(k), self.b, self.p, self.rng
        # Fighting deck: the outer palisade zone stays free, the arm ends are closed by logs.
        self.deck(t, -3.5 + WALL, 2.5, -1.5 - WALL, 3.5 - WALL, True)      # corner + east arm
        self.deck(t, -3.5 + WALL, 1.5 + WALL, -2.5, 2.5, False)           # south arm
        # Outer palisade (north and west), then the closed ends at both gates.
        line = 3.5 - WALL / 2
        self.logs(t, -3.5 + WALL, -1.5 - WALL, line, True)
        self.logs(t, 1.5 + WALL, 3.5 - WALL, -line, False)
        self.log(t, -line, line, LOG_R + .035, 1.85)                         # corner post
        self.logs(t, 2.62 + .16, line - .16, -1.5 - WALL / 2, False)          # between the gate posts
        self.logs(t, -line + .16, -2.62 - .16, 1.5 + WALL / 2, True)
        # Binding wales inside the palisade and a hand rail along the courtyard edges.
        b.rod(t.p(-3.5 + WALL + .02, line - LOG_R - .03, 1.15), t.p(-1.5 - WALL, line - LOG_R - .03, 1.15), .03, p['tar'], 8)
        b.rod(t.p(-line + LOG_R + .03, 1.5 + WALL, 1.15), t.p(-line + LOG_R + .03, 3.5 - WALL - .02, 1.15), .03, p['tar'], 8)
        for (ax, ay), (bx, by) in (((-2.5, 2.55), (-1.5 - WALL - .02, 2.55)), ((-2.55, 1.5 + WALL + .02), (-2.55, 2.5))):
            b.rod(t.p(ax, ay, DECK + .5), t.p(bx, by, DECK + .5), .025, p['oak'], 8)
            for f in (0, .5, 1):
                x, y = ax + (bx - ax) * f, ay + (by - ay) * f
                b.cylinder(t.p(x, y, DECK + .25), .03, .5, p['oak'], 8, .004)
        # Gate posts: square, iron-banded, a torch on the outer post and a lantern on the inner.
        for gate in ((-1.5 - WALL / 2, line), (-1.5 - WALL / 2, 2.62)), ((-line, 1.5 + WALL / 2), (-2.62, 1.5 + WALL / 2)):
            (ox, oy), (ix, iy) = gate
            for x, y, h in ((ox, oy, 2.05), (ix, iy, 1.75)):
                b.box(t.p(x, y, h / 2), (.3, .3, h), p['oak'], .015, t.r(), .008, rng)
                b.box(t.p(x, y, h + .02), (.34, .34, .05), p['tar'], .006, t.r())
                for z in (.5, h - .3):
                    b.box(t.p(x, y, z), (.32, .32, .05), p['iron'], .004, t.r())
            self.torch(t, ox, oy, 2.07)
            dx, dy = (1, 0) if gate[0][1] == line else (0, -1)   # towards the gate opening
            self.lantern(t, ix + dx * .24, iy + dy * .24, 1.2, (ix, iy, 1.55))
        # Lights at the edges: outer corner lantern hanging out, lanterns outside the arms, inner corner post.
        self.lantern(t, -3.72, 3.72, 1.25, (-line, line, 1.65))
        self.lantern(t, -2.0, 3.72, 1.1, (-2.0, line, 1.4))
        self.lantern(t, -3.72, 2.0, 1.1, (-line, 2.0, 1.4))
        b.cylinder(t.p(-2.6, 2.6, (DECK + 1.1) / 2), .06, DECK + 1.1, p['oak'], 8, .006)
        self.lantern(t, -2.42, 2.42, DECK + .62, (-2.6, 2.6, DECK + 1.0))
        # The decks stay clear: every cell centre is a turret place.

    # -- ground: earthwork, chips, tracks, courtyard ----------------------------------
    def earthwork(self, k):
        """Earth banked against the outer palisade and around the corner, fading into the ground."""
        t, rng = Turn(k), self.rng
        width = .62

        def sample(x, y):
            outside = max(-3.5 - x, y - 3.5)          # distance beyond the outer sides
            if outside < -.02 or x > -1.45 or y < 1.45: return None
            if x < -3.5 and y > 3.5: outside = math.hypot(-3.5 - x, y - 3.5)
            w = width * (1 + .25 * wobble(x, y, k))
            f = max(0.0, 1 - outside / w)
            end = min(1.0, (-1.45 - x) / .5, (y - 1.45) / .5)   # taper towards the gates
            f *= max(0.0, end)
            return (.24 * f ** 1.6 + .005, min(1.0, f * 1.6), .25 * f)
        x0, y0, x1, y1 = -3.5 - width * 1.3, 1.45, -1.45, 3.5 + width * 1.3
        pts = [t.p(x, y)[:2] for x, y in ((x0, y0), (x1, y1))]
        wx0, wx1 = sorted((pts[0][0], pts[1][0])); wy0, wy1 = sorted((pts[0][1], pts[1][1]))
        inv = Turn(-k)
        ground_sheet(self.c, 'Palisade earthwork', wx0, wy0, wx1, wy1, lambda x, y: sample(*inv.p(x, y)[:2]), self.earth, .06)
        b = self.b
        for _ in range(26):
            u, v = rng.uniform(-3.5 - .5, -1.6), rng.uniform(3.52, 3.5 + .45)
            if rng.random() < .5: u, v = -v, -u + 0   # mirror onto the west side
            if rng.random() < .55:
                s = rng.uniform(.035, .07)
                b.ell(t.p(u, v, .1), (s, s, .05), self.p['tuft'] if rng.random() > .3 else self.p['tuft2'], 8, 4)
            else:
                s = rng.uniform(.03, .06)
                b.box(t.p(u, v, .06), (s * 1.4, s, s * .8), self.p['stone'], .01, t.r(0, 0, rng.uniform(0, 3)), .01, rng)

    def chips(self, k, count=60):
        """Wood chips, bark and straw at the palisade foot and under the deck edge."""
        t, b, rng, p = Turn(k), self.b, self.rng, self.p
        for _ in range(count):
            side = rng.random()
            if side < .4: x, y = rng.uniform(-3.4, -1.6), rng.uniform(3.5, 3.85)
            elif side < .8: x, y = rng.uniform(-3.85, -3.5), rng.uniform(1.6, 3.4)
            else: x, y = rng.uniform(-2.45, -1.6), rng.uniform(2.3, 2.48)
            mat = p['straw'] if rng.random() < .35 else p['chip']
            b.box(t.p(x, y, .012), (rng.uniform(.03, .07), rng.uniform(.01, .025), .01), mat, 0, t.r(0, 0, rng.uniform(0, 3.2)))

    def thresholds(self):
        """Worn ground at the four gates, inside and outside; over gravel it stays a soft darkening."""
        def sample(x, y):
            along, across = (abs(y), abs(x)) if abs(y) >= abs(x) else (abs(x), abs(y))
            if across > 1.9 or not 1.6 < along < 4.9: return None
            f = max(0.0, 1 - max(0.0, across - 1.1) / .8) * max(0.0, 1 - abs(along - 3.25) / 1.6)
            f *= .8 + .2 * wobble(x * 1.6, y * 1.6, 4)
            return (.004, min(1.0, f * .9), .2 + .35 * f)
        ground_sheet(self.c, 'Gate thresholds', -5.0, -5.0, 5.0, 5.0, sample, self.track, .1)

    def courtyard(self):
        """Packed loam over the build area with ruts, wear and a soft broken rim."""
        inside = build_area(self.stage)
        reach = 3.5 if self.stage == 0 else 4 + self.stage + .5

        def coverage(x, y):
            gx, gy = round(x), round(-y)
            best = 0.0
            for ox in (-1, 0, 1):
                for oy in (-1, 0, 1):
                    cx, cy = gx + ox, gy + oy
                    if inside(cx, cy):
                        d = max(abs(x - cx), abs(-y - cy))
                        best = max(best, 1.0 if d <= .5 else max(0.0, 1 - (d - .5) / .7))
            return best

        def sample(x, y):
            f = coverage(x, y) * (.9 + .1 * wobble(x * 1.7, y * 1.7, 5))
            if f <= .01: return None
            across = min(abs(x), abs(y))
            rut = max(0.0, 1 - abs(across - .55) / .14) * .45 if max(abs(x), abs(y)) > 1.2 else 0
            centre = max(0.0, 1 - math.hypot(x, y) / 2.5) * .25
            return (.002, min(1.0, f * 1.2), min(1.0, rut + centre + .15 * (1 + wobble(x, y, 9)) / 2))
        r = reach + 1
        ground_sheet(self.c, 'Courtyard loam', -r, -r, r, r, sample, self.loam, .1)
        rng = self.rng
        for _ in range(5 + 3 * self.stage):
            x, y = rng.uniform(-reach, reach), rng.uniform(-reach, reach)
            if min(abs(x), abs(y)) < .6 or not inside(round(x), round(-y)) or (abs(x) > 2.4 and abs(y) > 1.4 and abs(x) < 3.6 and abs(y) < 3.6): continue
            s = rng.uniform(.25, .5)
            self.b.ell((x, y, .006), (s, s * rng.uniform(.4, .8), .006), self.puddle, 16, 3, (0, 0, rng.uniform(0, 3)))

    def boardwalk(self):
        """Plank walkway from every gate to a landing in the middle of the courtyard."""
        b, rng, p = self.b, self.rng, self.p
        reach = 3.7 if self.stage == 0 else 4 + self.stage - .2
        for k in range(4):
            t = Turn(k)
            for side in (-.36, .36):
                b.box(t.p((reach + .62) / 2, side, .03), (reach - .62, .07, .05), p['tar'], .006, t.r())
            u = .62
            while u < reach:
                if rng.random() > .05:
                    mat = p['oak'] if rng.random() < .35 else p['plank']
                    b.box(t.p(u + .07, rng.uniform(-.02, .02), .07), (.125, .86 + rng.uniform(-.04, .02), .04), mat, .006,
                          t.r(0, 0, rng.uniform(-.03, .03)), .006, rng)
                u += .145
        for x in range(-4, 5):
            v = x * .14
            b.box((v, 0, .072), (.125, 1.26, .04), p['plank'] if rng.random() > .3 else p['oak'], .006, None, .006, rng)

    def build(self):
        for k in range(4):
            self.bastion(k)
            self.earthwork(k)
            self.chips(k)
        if self.ground == 'loam':
            self.courtyard()
            self.boardwalk()
        else:
            self.thresholds()
        for ob in self.b.flush('Fort master'):
            if ob.name.startswith('Fort master') and any(key in ob.name for key in ('Wood chips', 'Straw', 'Turf', 'Puddle', 'Fieldstone')):
                ob['fdGround'] = True
        return self.sockets
