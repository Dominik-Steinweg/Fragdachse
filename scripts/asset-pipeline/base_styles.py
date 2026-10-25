"""Four rustic base styles on the shared cell/quadrant kit (base_structure_parts).

Every style builds one cell from its mask: a body over the quadrant regions, an edge treatment
along exposed sides, a corner piece and per-cell features. Features use the coarse cell class, so
the persistent core (four 3-cell corner bastions) reads as a corner structure with two short arms
ending at the gates. Small parts go through one Batch per style; sockets name lights and particle
sources: lamp_* / window_* (warm lamp light), fire_* (open fire), chimney_* (smoke).
"""
import math
from dawn_parts import plate
from base_structure_parts import (Batch, quadrants, cell_class, end_direction, corner_direction, side_normals,
                                  height_sheet, flat_sheet, mesh_object, cone, pyramid_roof, scatter_rects)


class Style:
    def __init__(self, c, m):
        self.c, self.p, self.sockets, self.b = c, self.palette(m), {}, Batch(c)

    def socket(self, name, x, y, z):
        self.sockets[f'{name}_{len(self.sockets)}'] = (x, y, z)

    def cell(self, gx, gy, cx, cy, mask, rng):
        for q in quadrants(cx, cy, mask): self.quadrant(q, rng)
        self.feature(cell_class(mask), cx, cy, mask, rng)

    def feature(self, kind, cx, cy, mask, rng):
        pass

    def flush(self):
        return self.b.flush(type(self).__name__)

    # Shared small parts -----------------------------------------------------------
    def brazier(self, x, y, z, r=.15, rng=None):
        b, p = self.b, self.p
        b.cylinder((x, y, z + .08), r, .16, p['iron'], 14, .008)
        b.cylinder((x, y, z + .17), r + .012, .025, p['dark'], 14, .004)
        b.cylinder((x, y, z + .165), r - .025, .02, p['ember'], 14, 0)
        for i in range(6):
            a = i * 2.4 + (rng.uniform(0, 1) if rng else 0)
            d = (r - .06) * (.3 + .7 * ((i * 37) % 10) / 10)
            b.ell((x + d * math.cos(a), y + d * math.sin(a), z + .185), (.03, .026, .018), p['coal'], 8, 5)
        self.socket('fire', x, y, z + .3)

    def lantern(self, x, y, z):
        b, p = self.b, self.p
        b.cylinder((x, y, z + .2), .075, .04, p['brass'], 12, .006)
        b.cylinder((x, y, z + .1), .055, .16, p['lamp'], 12, 0)
        self.socket('lamp', x, y, z + .1)


# -- Burg: fieldstone curtain wall, crenellated parapet, round corner towers ---------

class Burg(Style):
    HALF = .46
    WZ, PZ, MZ, PW = 2.7, 3.0, 3.34, .17

    def palette(self, m):
        return dict(
            stone=m('Curtain fieldstone', (118, 114, 102), .4), walk=m('Wall walk flagstone', (140, 134, 120), .35),
            walk2=m('Worn paving stone', (112, 108, 98), .38), slate=m('Slate shingle', (92, 98, 104), .26),
            slate2=m('Dark slate shingle', (66, 70, 78), .26), moss=m('Masonry moss', (66, 78, 41), .5),
            ivy=m('Ivy leaves', (50, 68, 36), .3), iron=m('Forged iron', (96, 100, 98), .25), dark=m('Soot iron', (43, 44, 39), .18),
            ember=m('Separate forge ember', (230, 96, 24), .05, .9), coal=m('Forge coal', (30, 29, 25), .1),
            brass=m('Worn brass fittings', (158, 119, 61), .3), lamp=m('Separate lantern emission', (244, 153, 53), .01, .7))

    def quadrant(self, q, rng):
        b, p = self.b, self.p
        H, E, PW = self.HALF, self.HALF, self.PW
        for a0, b0, a1, b1 in q.regions(H):
            b.box(q.p((a0 + a1) / 2, (b0 + b1) / 2, self.WZ / 2), q.dims(a1 - a0, b1 - b0, self.WZ), p['stone'], .01)
            self.flagstones(q, (a0, b0, a1, b1), rng)
        for qe, a0, a1 in q.edges(E):
            if a1 - a0 < .02: continue
            b.box(qe.p((a0 + a1) / 2, E - PW / 2, (self.WZ + self.PZ) / 2), qe.dims(a1 - a0, PW, self.PZ - self.WZ), p['stone'], .012)
            for centre in (0, .5):
                lo, hi = max(a0, centre - .15), min(a1, centre + .15)
                if q.kind == 'outer': hi = min(hi, E - .27)
                if hi - lo > .06:
                    b.box(qe.p((lo + hi) / 2, E - PW / 2, (self.PZ + self.MZ) / 2), qe.dims(hi - lo, PW + .01, self.MZ - self.PZ), p['stone'], .015)
        if q.has_corner():
            b.box(q.p(E - PW / 2, E - PW / 2, (self.WZ + self.PZ) / 2), (PW, PW, self.PZ - self.WZ), p['stone'], .012)
            if q.kind == 'outer':
                b.box(q.p(E - .12, E - .12, (self.PZ + self.MZ) / 2), (.24, .24, self.MZ - self.PZ), p['stone'], .015)
        inner = [tuple(q.p(a0, b0)[:2]) + tuple(q.p(a1, b1)[:2]) for a0, b0, a1, b1 in q.regions(H - PW)]
        for x, y in scatter_rects(inner, rng, rng.randrange(0, 3)):
            s = rng.uniform(.05, .1)
            b.ell((x, y, self.WZ + .05), (s, s * rng.uniform(.6, 1), .022), p['moss'], 10, 5)
        if q.kind in ('straight', 'outer') and rng.random() < .35:
            b.ell(q.p(rng.uniform(.05, .3), E - .05, self.MZ - .08), q.dims(rng.uniform(.1, .16), .07, .06), p['ivy'], 10, 5)

    def flagstones(self, q, rect, rng):
        a0, b0, a1, b1 = rect
        bb = b0
        while bb < b1 - .03:
            h = min(rng.uniform(.17, .28), b1 - bb)
            a = a0
            while a < a1 - .03:
                w = min(rng.uniform(.17, .32), a1 - a)
                self.b.box(q.p(a + w / 2, bb + h / 2, self.WZ + .02 + rng.uniform(0, .012)), q.dims(w - .022, h - .022, .04),
                           self.p['walk'] if rng.random() > .3 else self.p['walk2'], .008)
                a += w
            bb += h

    def tower(self, cx, cy, radius, height=3.9):
        c, p = self.c, self.p
        self.b.cylinder((cx, cy, height / 2), radius, height, p['stone'], 28, .01)
        top, courses, rim = height + 1.6, 8, .49
        for k in range(courses):
            r0 = rim - k * rim / courses
            r1 = max(rim - (k + 1) * rim / courses, .015)
            z0 = height - .06 + (top - height) * k / courses
            z1 = height - .06 + (top - height) * (k + 1) / courses
            cone(c, 'Tower slate course', (cx, cy), r0, z0, z1, p['slate'] if k % 2 else p['slate2'], 28, r1, k * .11)
        self.b.ell((cx, cy, top + .03), (.045, .045, .06), p['iron'], 10, 5)
        self.socket('window', cx, cy, 2.2)

    def feature(self, kind, cx, cy, mask, rng):
        b, p = self.b, self.p
        if kind in ('corner', 'isolated'):
            self.tower(cx, cy, .44 if kind == 'corner' else .4)
        elif kind == 'end':
            # The wall ends in a squat pier with a fire basket that marks the gate.
            dx, dy = end_direction(mask)
            px, py = cx + dx * .22, cy + dy * .22
            b.box((px, py, 1.62), (.5, .5, 3.24), p['stone'], .015)
            for ox, oy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                b.box((px + ox * .19, py + oy * .19, 3.36), (.12, .12, .24), p['stone'], .01)
            self.brazier(px, py, 3.24, .13, rng)
            self.socket('lamp', cx + dx * .52, cy + dy * .52, 2.0)


# -- Westernfort: sharpened log palisade, plank walkway, blockhouses -------------------

class Fort(Style):
    R, LINE = .11, .375
    LZ, WZ = 2.3, 1.55

    def palette(self, m):
        return dict(
            bark=m('Bark log', (82, 64, 46), .35), cut=m('Cut log end', (156, 126, 88), .3), plank=m('Silvered timber', (140, 128, 106), .3),
            oak=m('Weathered oak', (104, 84, 60), .32), tar=m('Dark tarred timber', (58, 50, 42), .2),
            shingle=m('Split wood shingle', (98, 80, 60), .3), shingle2=m('Old wood shingle', (86, 72, 56), .3),
            iron=m('Forged iron', (96, 100, 98), .25), dark=m('Soot iron', (43, 44, 39), .18), rope=m('Hemp cord', (142, 128, 94), .3),
            ember=m('Separate forge ember', (230, 96, 24), .05, .9), coal=m('Forge coal', (30, 29, 25), .1),
            brass=m('Worn brass fittings', (158, 119, 61), .3), lamp=m('Separate lantern emission', (244, 153, 53), .01, .7),
            burlap=m('Sandbag burlap', (132, 116, 82), .3))

    def log(self, x, y, rng):
        r = self.R + rng.uniform(-.012, .008)
        h = self.LZ + rng.uniform(-.14, .12)
        self.b.cylinder((x, y, h / 2), r, h, self.p['bark'], 12, .01, None, rng.uniform(0, 1))
        cone(self.c, 'Sharpened log tip', (x + rng.uniform(-.01, .01), y + rng.uniform(-.01, .01)), r, h, h + .22, self.p['cut'], 9, 0, rng.uniform(0, 1))

    def quadrant(self, q, rng):
        b, p = self.b, self.p
        L, R = self.LINE, self.R
        deck = L - R - .015
        for a0, b0, a1, b1 in q.regions(deck):
            a = a0
            while a < a1 - .02:
                w = min(.125, a1 - a)
                b.box(q.p(a + w / 2, (b0 + b1) / 2, self.WZ + rng.uniform(0, .012)), q.dims(w - .012, b1 - b0 + .02, .045),
                      p['plank'] if rng.random() > .3 else p['oak'], .006)
                a += w
        for qe, a0, a1 in q.edges(L):
            for a in (.125, .375):
                if a0 - 1e-6 <= a <= a1 + 1e-6 and (q.kind == 'straight' or a < L - .01):
                    self.log(*qe.p(a, L)[:2], rng)
        if q.has_corner():
            self.log(*q.p(L, L)[:2], rng)
        if q.kind == 'straight' and rng.random() < .3:
            b.ell(q.p(rng.uniform(.1, .4), deck - .08, self.WZ + .08), q.dims(.2, .12, .08), p['burlap'], 10, 5)

    def blockhouse(self, cx, cy, mask, half=.47):
        c, b, p = self.c, self.b, self.p
        b.box((cx, cy, 1.4), (half * 2 - .04, half * 2 - .04, 2.8), p['bark'], .02)
        pyramid_roof(c, 'Blockhouse shingle roof', (cx, cy), half + .015, 2.75, 3.75, p['shingle'])
        for k in range(1, 5):
            s = half + .015 - k * (half / 5)
            z = 2.75 + k * (1.0 / 5) + .02
            for sx, sy, w, h in ((0, 1, 2 * s, .05), (0, -1, 2 * s, .05), (1, 0, .05, 2 * s), (-1, 0, .05, 2 * s)):
                b.box((cx + sx * s, cy + sy * s, z), (w, h, .03), p['shingle2'], .005)
        for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
            b.rod((cx, cy, 3.78), (cx + sx * (half + .01), cy + sy * (half + .01), 2.77), .03, p['tar'], 6)
        dx, dy = corner_direction(mask)
        self.socket('lamp', cx + dx * .55, cy + dy * .55, 1.9)

    def feature(self, kind, cx, cy, mask, rng):
        b, p = self.b, self.p
        if kind in ('corner', 'isolated'):
            self.blockhouse(cx, cy, mask, .47 if kind == 'corner' else .44)
        elif kind == 'end':
            dx, dy = end_direction(mask)
            gx, gy = cx + dx * .31, cy + dy * .31
            b.box((gx, gy, 1.55), (.32, .32, 3.1), p['oak'], .02)
            b.box((gx, gy, 3.12), (.36, .36, .05), p['tar'], .01)
            b.rod((gx - dy * .3, gy + dx * .3, 1.2), (gx, gy, 2.5), .04, p['tar'], 6)
            self.brazier(gx, gy, 3.14, .12, rng)


# -- Waldhütte: hipped shingle roofs following the cells, stone chimneys ----------------

class Hut(Style):
    HALF, EZ, SLOPE = .48, 1.9, 1.5

    @property
    def RZ(self): return self.EZ + self.SLOPE * self.HALF

    def palette(self, m):
        return dict(
            shingle=m('Split wood shingle', (104, 84, 62), .3), shingle2=m('Old wood shingle', (88, 74, 58), .3),
            mossy=m('Mossy shingle', (82, 84, 56), .35), under=m('Roof boarding', (60, 50, 40), .2), ridge=m('Weathered oak', (104, 84, 60), .32),
            stone=m('Fieldstone', (118, 118, 108), .4), mortar=m('Lime mortar bed', (98, 94, 84), .3), dark=m('Soot iron', (43, 44, 39), .18),
            moss=m('Masonry moss', (64, 78, 40), .5), iron=m('Forged iron', (96, 100, 98), .25),
            brass=m('Worn brass fittings', (158, 119, 61), .3), lamp=m('Separate lantern emission', (244, 153, 53), .01, .7),
            ember=m('Separate forge ember', (230, 96, 24), .05, .9), coal=m('Forge coal', (30, 29, 25), .1))

    def roof_z(self, q, a, b):
        return self.EZ + self.SLOPE * min(q.depth(a, b, self.HALF), self.HALF)

    def quadrant(self, q, rng):
        c, b, p, H = self.c, self.b, self.p, self.HALF
        for rect in q.regions(H):
            height_sheet(c, 'Roof boarding', q, rect, lambda a, bb: self.roof_z(q, a, bb) - .02, p['under'], .05, .03, False)
        if q.kind == 'full':
            for x, y in scatter_rects([tuple(q.p(0, 0)[:2]) + tuple(q.p(.5, .5)[:2])], rng, 3):
                s = rng.uniform(.08, .16)
                b.ell((x, y, self.RZ + .02), (s, s * .8, .03), p['moss'], 10, 5)
        d = .035
        while d < H - .02:
            edge = H - d
            if q.kind == 'straight': runs = [(q, 0, .5)]
            elif q.kind == 'outer': runs = [(q, 0, edge), (q.turned(), 0, edge)]
            elif q.kind == 'inner': runs = [(q, edge, .5), (q.turned(), edge, .5)]
            else: runs = []
            for qe, a0, a1 in runs:
                a = a0 + rng.uniform(-.04, 0)
                while a < a1 - .015:
                    lo = max(a, a0)
                    w = min(rng.uniform(.11, .19), a1 - lo)
                    if w > .02:
                        z = self.EZ + self.SLOPE * d + .012 + rng.uniform(0, .008)
                        mossy = rng.random() < .12 + .35 * (d < .12)
                        mat = p['mossy'] if mossy else (p['shingle'] if rng.random() > .35 else p['shingle2'])
                        b.box(qe.p(lo + w / 2, edge, z), qe.dims(w - .012, .1, .018), mat, .004, qe.tilt(self.SLOPE))
                    a = lo + w
            d += .072
        if q.kind == 'straight' and (q.sx > 0 if q.swap else q.sy > 0):
            b.cylinder(q.p(.25, 0, self.RZ + .025), .05, .52, p['ridge'], 10, .01, q.along())
        if q.kind == 'outer':
            b.rod(q.p(0, 0, self.RZ + .03), q.p(H, H, self.EZ + .03), .028, p['ridge'], 6)
        if q.kind != 'full' and rng.random() < .45:
            a, bb = rng.uniform(.05, .4), rng.uniform(.08, H - .06)
            if q.depth(a, bb, H) > 0:
                s = rng.uniform(.06, .12)
                b.ell(q.p(a, bb, self.roof_z(q, a, bb) + .03), (s, s * .7, .025), p['moss'], 10, 5)

    def chimney(self, x, y, rng):
        b, p = self.b, self.p
        b.box((x, y, 2.4), (.36, .36, 1.9), p['stone'], .02)
        for k in range(4):
            for ox, oy in ((.0, .19), (.19, .0), (.0, -.19), (-.19, .0)):
                b.box((x + ox, y + oy, 1.75 + k * .4 + rng.uniform(0, .1)), (.3 if ox == 0 else .05, .05 if ox == 0 else .3, .16), p['stone'], .015)
        b.box((x, y, 3.38), (.44, .44, .06), p['mortar'], .01)
        b.box((x, y, 3.41), (.18, .18, .02), p['dark'], .003)
        self.socket('chimney', x, y, 3.45)

    def feature(self, kind, cx, cy, mask, rng):
        # Window light falls out of the walls under the eaves, so it sits just beyond each open side.
        sides = side_normals(mask)
        if kind in ('corner', 'isolated', 'junction'):
            self.chimney(cx, cy, rng)
        elif kind == 'end':
            dx, dy = end_direction(mask)
            self.socket('lamp', cx + dx * .58, cy + dy * .58, 1.5)
            sides = [s for s in sides if s != (dx, dy)]
        elif kind == 'straight' and rng.random() >= .6:
            sides = []
        for nx, ny in sides:
            self.socket('window', cx + nx * .6, cy + ny * .6, .8)


# -- Pfadfinderlager: lashed pole fence, tarp lean-tos, Kohten -----------------------

class Camp(Style):
    LINE, HALF, TZ0, TZ1 = .43, .43, 1.0, 1.72

    def palette(self, m):
        return dict(
            pole=m('Peeled pine pole', (150, 126, 92), .3), pole2=m('Weathered pole', (122, 104, 80), .3), rope=m('Hemp cord', (150, 134, 98), .3),
            tarp=m('Ochre tarp canvas', (156, 128, 76), .25), tarp2=m('Khaki tarp canvas', (128, 120, 88), .25),
            kohte=m('Kohte canvas', (64, 56, 48), .25), seam=m('Kohte seam', (44, 40, 36), .2),
            pennant=m('Pennant red canvas', (146, 58, 44), .25), pennant2=m('Pennant yellow canvas', (176, 146, 70), .25),
            iron=m('Forged iron', (96, 100, 98), .25), dark=m('Soot iron', (43, 44, 39), .18), wood=m('Old oak', (110, 88, 62), .3),
            cut=m('Exposed timber', (145, 122, 87), .3), brass=m('Worn brass fittings', (158, 119, 61), .3),
            lamp=m('Separate lantern emission', (244, 153, 53), .01, .7), ember=m('Separate forge ember', (230, 96, 24), .05, .9),
            coal=m('Forge coal', (30, 29, 25), .1))

    def tarp_z(self, q, a, b):
        t = min(q.depth(a, b, self.HALF), self.HALF) / self.HALF
        sag = .05 * math.sin(math.pi * min(a, .5) / .5) * (q.kind != 'full')
        return self.TZ0 + (self.TZ1 - self.TZ0) * t - sag

    def post(self, x, y, rng, h=1.3):
        b, p = self.b, self.p
        b.cylinder((x, y, h / 2), .045, h, p['pole'] if rng.random() > .3 else p['pole2'], 10, .008)
        b.ell((x, y, h), (.04, .04, .02), p['cut'], 8, 4)
        b.cylinder((x, y, h - .17), .062, .05, p['rope'], 12, .01)

    def quadrant(self, q, rng, tarp=True):
        c, b, p, L = self.c, self.b, self.p, self.LINE
        if tarp:
            mat = p['tarp'] if (int(q.cx * 3 + q.cy * 7) % 3) else p['tarp2']
            for rect in q.regions(self.HALF):
                height_sheet(c, 'Tarp lean-to', q, rect, lambda a, bb: self.tarp_z(q, a, bb), mat, .045, .015, True)
            if q.kind == 'straight' and (q.sx > 0 if q.swap else q.sy > 0):
                b.cylinder(q.p(.25, 0, self.TZ1 + .03), .028, .52, p['pole'], 8, .006, q.along())
        for qe, a0, a1 in q.edges(L):
            if a1 - a0 < .02: continue
            b.cylinder(qe.p((a0 + a1) / 2, L, 1.1), .022, a1 - a0 + .01, p['pole2'], 8, .004, qe.along())
            if a0 <= .25 <= a1 and (q.kind == 'straight' or .25 < L - .1):
                self.post(*qe.p(.25, L)[:2], rng)
        if q.has_corner():
            self.post(*q.p(L, L)[:2], rng, 1.38)

    def cell(self, gx, gy, cx, cy, mask, rng):
        kind = cell_class(mask)
        for q in quadrants(cx, cy, mask): self.quadrant(q, rng, kind not in ('corner', 'isolated'))
        self.feature(kind, cx, cy, mask, rng)

    def kohte(self, cx, cy, radius=.47):
        c, b, p = self.c, self.b, self.p
        sides, top = 8, 2.25
        cone(c, 'Kohte canvas cone', (cx, cy), radius, .02, top, p['kohte'], sides, .07, math.pi / 8)
        for i in range(sides):
            a = math.pi / 8 + i * math.tau / sides
            b.rod((cx + .08 * math.cos(a), cy + .08 * math.sin(a), top + .01), (cx + radius * math.cos(a), cy + radius * math.sin(a), .04), .012, p['seam'], 5)
        b.cylinder((cx, cy, top - .02), .07, .03, p['coal'], 12, 0)
        b.ell((cx, cy, top - .25), (.05, .05, .02), p['ember'], 8, 4)
        for sx in (-1, 1):
            b.rod((cx - .2 * sx, cy - .2, top - .12), (cx + .2 * sx, cy + .2, top + .12), .022, p['pole'], 6)
        self.socket('chimney', cx, cy, top + .1)

    def feature(self, kind, cx, cy, mask, rng):
        b, p = self.b, self.p
        if kind in ('corner', 'isolated'):
            self.kohte(cx, cy, .47 if kind == 'corner' else .43)
            # Firelight spills out of the door, which faces away from the corner (into the camp).
            dx, dy = corner_direction(mask)
            self.socket('fire', cx - dx * .45, cy - dy * .45, .35)
        elif kind == 'end':
            dx, dy = end_direction(mask)
            fx, fy = cx + dx * .28 - dy * .2, cy + dy * .28 + dx * .2
            b.cylinder((fx, fy, 1.7), .035, 3.4, p['pole'], 8, .006)
            # The pennant hangs into the cell and lies broad from above.
            tip = (fx - dx * .42 + dy * .08, fy - dy * .42 - dx * .08)
            plate(self.c, 'Camp pennant', (0, 0, 3.25), [(fx, fy), (fx + dy * .1, fy - dx * .1), tip], .02, p['pennant'], .004)
            plate(self.c, 'Camp pennant stripe', (0, 0, 3.27), [(fx, fy), (fx + dy * .04, fy - dx * .04),
                  (fx + (tip[0] - fx) * .55, fy + (tip[1] - fy) * .55)], .02, p['pennant2'], .003)
            lx, ly = cx + dx * .28 + dy * .2, cy + dy * .28 - dx * .2
            # The lantern hangs above the tarp ridge, so its light reaches the ground around the post.
            b.cylinder((lx, ly, .95), .03, 1.9, p['pole2'], 8, .006)
            self.lantern(lx, ly, 1.9)
            for k in range(4):
                b.rod((cx - dy * .1 + k * .05 * dx, cy + dx * .1 + k * .05 * dy, 1.12 + k * .02),
                      (cx + dy * .2 + k * .05 * dx, cy - dx * .2 + k * .05 * dy, 1.12 + k * .02), .03, p['wood'], 7)


STYLES = dict(burg=Burg, fort=Fort, hut=Hut, camp=Camp)


# -- Concept courtyard grounds (boards only) --------------------------------------------

def cobble_material(name, stone, joint, scale=4.2):
    """Voronoi cobbles with mossy joints: one material instead of a thousand stones."""
    import bpy
    from dawn_parts import linear
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    n, l = mat.node_tree.nodes, mat.node_tree.links
    bsdf = n['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = .85
    coords = n.new('ShaderNodeNewGeometry')
    vor = n.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'; vor.inputs['Scale'].default_value = scale
    l.new(coords.outputs['Position'], vor.inputs['Vector'])
    cells = n.new('ShaderNodeTexVoronoi'); cells.inputs['Scale'].default_value = scale
    l.new(coords.outputs['Position'], cells.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = .04; ramp.color_ramp.elements[1].position = .1
    ramp.color_ramp.elements[0].color = (*linear(joint), 1); ramp.color_ramp.elements[1].color = (*linear(stone), 1)
    l.new(vor.outputs['Distance'], ramp.inputs[0])
    # Per-stone value only: the Voronoi cell colour is random hue, so take its luminance.
    grey = n.new('ShaderNodeRGBToBW'); l.new(cells.outputs['Color'], grey.inputs[0])
    lift = n.new('ShaderNodeMapRange'); lift.inputs['To Min'].default_value = .62; lift.inputs['To Max'].default_value = 1.15
    l.new(grey.outputs[0], lift.inputs['Value'])
    tone = n.new('ShaderNodeMixRGB'); tone.blend_type = 'MULTIPLY'; tone.inputs[0].default_value = 1
    l.new(ramp.outputs['Color'], tone.inputs[1]); l.new(lift.outputs['Result'], tone.inputs[2])
    l.new(tone.outputs['Color'], bsdf.inputs['Base Color'])
    bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .6; bump.inputs['Distance'].default_value = .03
    l.new(vor.outputs['Distance'], bump.inputs['Height']); l.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def courtyard_ground(c, style, m, rect, rng):
    """Style ground over the courtyard/build area; tagged concept-only by the caller."""
    x0, y0, x1, y1 = rect
    made, b = [], Batch(c)
    if style == 'burg':
        made.append(flat_sheet(c, 'Cobbled courtyard', x0, y0, x1, y1, .0, cobble_material('Courtyard cobbles', (124, 118, 104), (52, 58, 36))))
    elif style == 'fort':
        made.append(flat_sheet(c, 'Courtyard sand', x0, y0, x1, y1, .0, m('Courtyard sand', (150, 128, 92), .2)))
        rut = m('Wagon rut earth', (110, 90, 64), .25)
        for off in (-.45, .45):
            b.box(((x0 + x1) / 2, off, .003), (x1 - x0, .16, .006), rut, .002)
            b.box((off, (y0 + y1) / 2, .004), (.16, y1 - y0, .006), rut, .002)
    elif style == 'hut':
        made.append(flat_sheet(c, 'Packed loam', x0, y0, x1, y1, .0, m('Packed loam', (104, 86, 64), .25)))
        plank = m('Boardwalk plank', (128, 108, 82), .3)
        for axis in (0, 1):
            t = x0
            while t < x1 - .05:
                if not (axis == 1 and abs(t + .08) < .45):
                    pos = (t + .08, 0, .03) if axis == 0 else (0, t + .08, .035)
                    b.box(pos, (.14, .9, .04) if axis == 0 else (.9, .14, .04), plank, .006)
                t += .16
    else:
        made.append(flat_sheet(c, 'Trampled earth', x0, y0, x1, y1, .0, m('Trampled earth', (98, 82, 62), .25)))
        grass = m('Trampled grass', (66, 74, 44), .25)
        for x, y in scatter_rects([rect], rng, 40):
            if abs(x) < 1.2 or abs(y) < 1.2: continue  # paths stay bare between the gates
            s = rng.uniform(.08, .22)
            b.ell((x, y, -.008), (s, s * rng.uniform(.5, 1), .014), grass, 12, 4)
    return made + b.flush('Courtyard')
