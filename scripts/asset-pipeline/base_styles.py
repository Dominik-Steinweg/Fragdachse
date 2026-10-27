"""Four rustic base styles on the shared cell/quadrant kit (base_structure_parts).

Every base cell is a turret emplacement: base turrets (32-40 px, wider than the 32 px cell) stand
on its centre. So each style builds a flat platform with a clear turret pad in the middle and
keeps everything taller low and on the exposed outer edges: a parapet, palisade, sandbag wall or
rampart toe. Corners get small accents only; gate ends carry the lights. Sockets name lights and
particle sources: lamp_* (warm lamp light), fire_* (open fire), chimney_* (smoke).
"""
import math
from base_structure_parts import (Batch, quadrants, cell_class, end_direction, corner_direction, side_normals,
                                  height_sheet, cone, scatter_rects)


class Style:
    HALF = .49   # body half width: neighbouring cells meet on the cell line
    PAD = .3     # turret pad radius; nothing but the pad stands inside it

    def __init__(self, c, m):
        self.c, self.p, self.sockets, self.b = c, self.palette(m), {}, Batch(c)

    def socket(self, name, x, y, z):
        self.sockets[f'{name}_{len(self.sockets)}'] = (x, y, z)

    def cell(self, gx, gy, cx, cy, mask, rng):
        for q in quadrants(cx, cy, mask): self.quadrant(q, rng)
        self.pad(cx, cy, rng)
        self.feature(cell_class(mask), cx, cy, mask, rng)

    def feature(self, kind, cx, cy, mask, rng):
        pass

    def flush(self):
        return self.b.flush(type(self).__name__)

    def bolts(self, cx, cy, z, radius, count, mat, size=.018):
        for i in range(count):
            a = math.tau * (i + .5) / count
            self.b.cylinder((cx + radius * math.cos(a), cy + radius * math.sin(a), z), size, .02, mat, 6, 0)

    def brazier(self, x, y, z, r, rng):
        b, p = self.b, self.p
        b.cylinder((x, y, z + .07), r, .14, p['iron'], 12, .006)
        b.cylinder((x, y, z + .145), r - .02, .02, p['ember'], 12, 0)
        for i in range(5):
            a = i * 2.4 + rng.uniform(0, 1)
            d = (r - .04) * rng.uniform(.2, .9)
            b.ell((x + d * math.cos(a), y + d * math.sin(a), z + .16), (.022, .02, .014), p['coal'], 8, 4)
        self.socket('fire', x, y, z + .25)

    def lantern(self, x, y, z):
        b, p = self.b, self.p
        b.cylinder((x, y, z + .16), .06, .035, p['brass'], 10, .005)
        b.cylinder((x, y, z + .08), .045, .13, p['lamp'], 10, 0)
        self.socket('lamp', x, y, z + .08)


# -- Steinbastion: fieldstone platform, crenellated parapet, iron turret ring ---------------

class Burg(Style):
    PZ, PH, MH, EW = .8, 1.16, 1.42, .16

    def palette(self, m):
        return dict(
            stone=m('Curtain fieldstone', (122, 117, 104), .4), walk=m('Wall walk flagstone', (146, 140, 124), .35),
            walk2=m('Worn paving stone', (118, 113, 101), .38), slate=m('Slate shingle', (88, 94, 100), .26),
            moss=m('Masonry moss', (66, 80, 40), .5), ivy=m('Ivy leaves', (48, 66, 34), .3), iron=m('Forged iron', (92, 96, 94), .25),
            dark=m('Soot iron', (43, 44, 39), .18), padstone=m('Dark cobblestone', (96, 94, 86), .4),
            ember=m('Separate forge ember', (230, 96, 24), .05, .9), coal=m('Forge coal', (30, 29, 25), .1),
            brass=m('Worn brass fittings', (158, 119, 61), .3), lamp=m('Separate lantern emission', (244, 153, 53), .01, .7))

    def quadrant(self, q, rng):
        b, p, H, EW = self.b, self.p, self.HALF, self.EW
        for a0, b0, a1, b1 in q.regions(H):
            b.box(q.p((a0 + a1) / 2, (b0 + b1) / 2, (self.PZ - .04) / 2), q.dims(a1 - a0, b1 - b0, self.PZ - .04), p['stone'], .015)
            self.flagstones(q, (a0, b0, a1, b1), rng)
        for qe, a0, a1 in q.edges(H):
            if a1 - a0 < .02: continue
            self.parapet(qe, a0, a1, rng)
        if q.kind == 'outer':
            self.block(q, H - EW, H, H - EW, H, self.PH, rng)
            b.box(q.p(H - .12, H - .12, (self.PH + self.MH + .04) / 2), (.24, .24, self.MH + .04 - self.PH), p['stone'], .015, None, .012, rng)
        elif q.kind == 'inner':
            self.block(q, H - EW, .5, H - EW, H, self.PH, rng)
            self.block(q.turned(), H - EW, .5, H - EW, H, self.PH, rng)
        for x, y in scatter_rects([q.p(.08, H - EW - .1)[:2] + q.p(.45, H - EW - .02)[:2]], rng, rng.randrange(0, 3)):
            if math.hypot(x - q.cx, y - q.cy) > self.PAD + .04:
                s = rng.uniform(.03, .06)
                b.ell((x, y, self.PZ + .03), (s, s * .7, .016), p['moss'], 8, 4)
        if q.kind == 'straight' and rng.random() < .3:
            b.ell(q.p(rng.uniform(.05, .45), H - .01, self.PH - .12), q.dims(rng.uniform(.08, .14), .05, .12), p['ivy'], 8, 5)

    def block(self, q, a0, a1, b0, b1, top, rng):
        self.b.box(q.p((a0 + a1) / 2, (b0 + b1) / 2, (self.PZ - .04 + top) / 2), q.dims(a1 - a0, b1 - b0, top - self.PZ + .04),
                   self.p['stone'], .012, None, .01, rng)

    def parapet(self, q, a0, a1, rng):
        """Single stones of the breastwork, then merlons centred on cell centres and cell lines."""
        H, EW = self.HALF, self.EW
        a = a0
        while a < a1 - .02:
            w = min(rng.uniform(.16, .26), a1 - a)
            self.b.box(q.p(a + w / 2, H - EW / 2, (self.PZ - .04 + self.PH) / 2 + rng.uniform(-.01, .01)),
                       q.dims(w - .012, EW, self.PH - self.PZ + .04), self.p['stone'], .012, None, .012, rng)
            a += w
        for centre in (0, .5):
            lo, hi = max(a0, centre - .13), min(a1, centre + .13)
            if q.kind == 'outer': hi = min(hi, H - .27)
            if hi - lo > .06:
                self.b.box(q.p((lo + hi) / 2, H - EW / 2, (self.PH + self.MH) / 2), q.dims(hi - lo, EW + .01, self.MH - self.PH),
                           self.p['stone'], .015, None, .012, rng)

    def flagstones(self, q, rect, rng):
        a0, b0, a1, b1 = rect
        bb = b0
        while bb < b1 - .03:
            h = min(rng.uniform(.16, .26), b1 - bb)
            a = a0
            while a < a1 - .03:
                w = min(rng.uniform(.16, .3), a1 - a)
                self.b.box(q.p(a + w / 2, bb + h / 2, self.PZ - .02 + rng.uniform(0, .01)), q.dims(w - .02, h - .02, .04),
                           self.p['walk'] if rng.random() > .3 else self.p['walk2'], .008, None, .008, rng)
                a += w
            bb += h

    def pad(self, cx, cy, rng):
        b, p, z = self.b, self.p, self.PZ
        b.cylinder((cx, cy, z + .02), self.PAD, .05, p['iron'], 32, .006)
        b.cylinder((cx, cy, z + .035), self.PAD - .045, .05, p['padstone'], 32, .006)
        self.bolts(cx, cy, z + .05, self.PAD - .022, 12, p['dark'], .014)

    def feature(self, kind, cx, cy, mask, rng):
        b, p = self.b, self.p
        if kind == 'corner':
            dx, dy = corner_direction(mask)
            x, y = cx + dx * .34, cy + dy * .34
            b.cylinder((x, y, (self.MH + .1) / 2), .15, self.MH + .1, p['stone'], 20, .01)
            cone(self.c, 'Bartizan slate cap', (x, y), .17, self.MH + .08, self.MH + .5, p['slate'], 20)
            self.socket('lamp', cx + dx * .52, cy + dy * .52, 1.1)
        elif kind == 'end':
            dx, dy = end_direction(mask)
            x, y = cx + dx * .34, cy + dy * .34
            b.box((x, y, (self.MH + .2) / 2), (.28, .28, self.MH + .2), p['stone'], .015, None, .01, rng)
            self.brazier(x, y, self.MH + .2, .1, rng)


# -- Palisadenschanze: plank deck, low sharpened palisade, timber turntable ------------------

class Fort(Style):
    PZ, R = .7, .085

    def palette(self, m):
        return dict(
            bark=m('Bark log', (82, 64, 46), .35), cut=m('Cut log end', (156, 126, 88), .3), plank=m('Silvered timber', (140, 128, 106), .3),
            oak=m('Weathered oak', (104, 84, 60), .32), tar=m('Dark tarred timber', (58, 50, 42), .2), rope=m('Hemp cord', (142, 128, 94), .3),
            iron=m('Forged iron', (92, 96, 94), .25), dark=m('Soot iron', (43, 44, 39), .18),
            ember=m('Separate forge ember', (230, 96, 24), .05, .9), coal=m('Forge coal', (30, 29, 25), .1),
            brass=m('Worn brass fittings', (158, 119, 61), .3), lamp=m('Separate lantern emission', (244, 153, 53), .01, .7),
            mossy=m('Mossy log tip', (90, 100, 56), .35), moss=m('Masonry moss', (60, 76, 38), .5))

    def log(self, x, y, rng, r=None, top=None):
        """Individual mossy sharpened stake, as on the persistent core (base_fort_master)."""
        r = r or self.R + rng.uniform(-.01, .008)
        h = top or self.PZ + .72 + rng.uniform(-.06, .06)
        self.b.cylinder((x, y, h / 2), r, h, self.p['bark'], 10, .008, None, rng.uniform(0, 1))
        cone(self.c, 'Sharpened log tip', (x + rng.uniform(-.008, .008), y + rng.uniform(-.008, .008)), r, h, h + .16,
             self.p['mossy' if rng.random() < .55 else 'cut'], 8, 0, rng.uniform(0, 1))
        if rng.random() < .7:
            a = rng.uniform(0, math.tau)
            self.b.ell((x + r * .55 * math.cos(a), y + r * .55 * math.sin(a), h - .02), (r * .6, r * .45, .025), self.p['moss'], 8, 4)

    def torch_out(self, x, y, outward, rng):
        """Small torch on an iron bracket outside the palisade, as on the core."""
        b, p = self.b, self.p
        z = 1.18 + rng.uniform(-.04, .04)
        ox, oy = outward
        b.rod((x - ox * .12, y - oy * .12, z - .1), (x, y, z - .1), .012, p['dark'], 6)
        b.rod((x - ox * .02, y - oy * .02, z - .26), (x + ox * .015, y + oy * .015, z), .018, p['oak'], 6)
        b.cylinder((x + ox * .015, y + oy * .015, z + .015), .034, .05, p['iron'], 10, .004)
        b.ell((x + ox * .015, y + oy * .015, z + .05), (.026, .026, .03), p['ember'], 8, 4)
        self.socket('torch', x + ox * .015, y + oy * .015, z + .1)

    def post_lantern(self, x, y, rng):
        """Small square gate post with a lantern standing on top, as on the core."""
        b, p, h = self.b, self.p, 1.45
        b.box((x, y, h / 2), (.18, .18, h), p['oak'], .012, None, .006, rng)
        b.box((x, y, h + .02), (.21, .21, .04), p['tar'], .005)
        b.box((x, y, h + .06), (.13, .13, .04), p['dark'], .006)
        b.cylinder((x, y, h + .14), .05, .12, p['lamp'], 10, 0)
        b.box((x, y, h + .215), (.14, .14, .025), p['dark'], .006)
        self.socket('lamp', x, y, h + .14)

    def quadrant(self, q, rng):
        b, p, H, R = self.b, self.p, self.HALF, self.R
        deck = H - 2 * R
        for a0, b0, a1, b1 in q.regions(deck):
            a = a0
            while a < a1 - .02:
                w = min(.118, a1 - a)
                b.box(q.p(a + w / 2, (b0 + b1) / 2, self.PZ - .025), q.dims(w - .014, b1 - b0 + .01, .045),
                      p['plank'] if rng.random() > .35 else p['oak'], .006, None, .006, rng)
                a += w
        line = H - R
        for qe, a0, a1 in q.edges(H):
            for a in (.083, .25, .417):
                if a0 - 1e-6 <= a <= a1 + 1e-6 and (q.kind == 'straight' or a < line - .12):
                    self.log(*qe.p(a, line)[:2], rng)
            if a1 - a0 > .05:
                b.cylinder(qe.p((a0 + a1) / 2, line - R - .03, self.PZ + .4), .028, a1 - a0, p['tar'], 8, .004, qe.along())
        if q.has_corner():
            self.log(*q.p(line, line)[:2], rng, self.R + .02)

    def pad(self, cx, cy, rng):
        """No socket: the deck centre stays clear for a turret."""

    def feature(self, kind, cx, cy, mask, rng):
        b, p = self.b, self.p
        # Decks stay free for turrets: light hangs outside, small torches on the open sides and corners.
        for nx, ny in side_normals(mask):
            if kind in ('straight', 'end') and rng.random() < .5:
                self.torch_out(cx + nx * (self.HALF + .06) + ny * .12, cy + ny * (self.HALF + .06) + nx * .12, (nx, ny), rng)
        if kind == 'corner':
            # A heavier corner stake with a torch hanging out over the outer corner.
            dx, dy = corner_direction(mask)
            x, y = cx + dx * (self.HALF - self.R - .02), cy + dy * (self.HALF - self.R - .02)
            self.log(x, y, rng, .12, self.PZ + .8)
            self.torch_out(x + dx * .14, y + dy * .14, (dx * .7, dy * .7), rng)
        elif kind == 'end':
            # Two uniform gate posts on the end corners, each with a lantern on top.
            dx, dy = end_direction(mask)
            for side in (-1, 1):
                self.post_lantern(cx + dx * .36 - dy * side * .34, cy + dy * .36 + dx * side * .34, rng)


# -- Feldstellung: sandbag walls, earth floor, steel turret plate, oil-drum fire ------------

class Feld(Style):
    PZ, BAG = .05, (.29, .17, .12)

    def palette(self, m):
        return dict(
            bag=m('Sandbag burlap', (138, 120, 84), .3), bag2=m('Wet sandbag burlap', (112, 98, 70), .3),
            earth=m('Trampled earth', (96, 80, 60), .25), plate=m('Faded container paint', (92, 98, 74), .4),
            iron=m('Forged iron', (92, 96, 94), .25), dark=m('Soot iron', (43, 44, 39), .18), rust=m('Rusted drum', (118, 78, 50), .45),
            net=m('Camouflage net', (70, 76, 50), .3), leaf=m('Camouflage leaf brown', (92, 74, 50), .25), leaf2=m('Camouflage leaf green', (60, 72, 42), .25),
            crate=m('Olive tarpaulin', (88, 94, 64), .3), plank=m('Weathered oak', (104, 84, 60), .32),
            ember=m('Separate forge ember', (230, 96, 24), .05, .9), coal=m('Forge coal', (30, 29, 25), .1),
            brass=m('Worn brass fittings', (158, 119, 61), .3), lamp=m('Separate lantern emission', (244, 153, 53), .01, .7))

    def bag(self, x, y, z, along, rng, scale=1.0):
        L, W, Hh = (s * scale for s in self.BAG)
        rot = (rng.uniform(-.05, .05), rng.uniform(-.05, .05), along + rng.uniform(-.08, .08))
        self.b.ell((x, y, z), (L / 2, W / 2, Hh / 2), self.p['bag'] if rng.random() > .3 else self.p['bag2'], 12, 6, rot)

    def quadrant(self, q, rng):
        b, p, H = self.b, self.p, self.HALF
        for a0, b0, a1, b1 in q.regions(H):
            b.box(q.p((a0 + a1) / 2, (b0 + b1) / 2, self.PZ / 2), q.dims(a1 - a0, b1 - b0, self.PZ), p['earth'], .01)
        rows = ((H - .08, 4), (H - .22, 2))  # outer row four courses high, inner step two
        for qe, a0, a1 in q.edges(H):
            along = math.pi / 2 if qe.swap else 0.0
            # Running bond: even courses centre on .125/.375, odd ones on 0/.25. A bag on the
            # quadrant line a = 0 belongs to one quadrant only; none reaches the cell line.
            owner = (qe.sy if qe.swap else qe.sx) > 0
            for bpos, courses in rows:
                if q.kind == 'inner' and bpos < H - .1: continue
                for k in range(courses):
                    for a in ((.0, .25) if k % 2 else (.125, .375)):
                        if a == 0 and not owner: continue
                        if not a0 - 1e-6 <= a <= a1 + 1e-6 or (q.kind != 'straight' and a > a1 - .14): continue
                        self.bag(*qe.p(a, bpos)[:2], self.PZ + .055 + k * .1, along, rng)
        if q.has_corner():
            for k in range(4):
                self.bag(*q.p(H - .1, H - .1)[:2], self.PZ + .055 + k * .1, math.pi / 4 * (1 if q.sx * q.sy > 0 else -1), rng, .95)

    def pad(self, cx, cy, rng):
        b, p, z = self.b, self.p, self.PZ
        b.cylinder((cx, cy, z + .025), self.PAD, .05, p['plate'], 8, .006, None, math.pi / 8)
        b.cylinder((cx, cy, z + .055), .1, .03, p['dark'], 16, .004)
        self.bolts(cx, cy, z + .055, self.PAD - .04, 8, p['iron'], .015)
        for i in range(4):
            a = i * math.pi / 2 + math.pi / 4
            b.box((cx + .18 * math.cos(a), cy + .18 * math.sin(a), z + .052), (.12, .02, .006), p['dark'], 0, (0, 0, a))

    def net(self, cx, cy, dx, dy, rng):
        """Camouflage net thrown over the corner wall: a sagging sheet with scraps of leaf cloth."""
        H = self.HALF
        q = quadrants(cx, cy, 0)[[(1, 1), (-1, 1), (-1, -1), (1, -1)].index((dx, dy))]
        height_sheet(self.c, 'Camouflage net', q, (.2, .2, H, H),
                     lambda a, b: .5 + .06 * math.sin(a * 17) * math.sin(b * 13), self.p['net'], .04, .01, True)
        for x, y in scatter_rects([q.p(.22, .22)[:2] + q.p(H - .02, H - .02)[:2]], rng, 14):
            s = rng.uniform(.03, .06)
            self.b.ell((x, y, .56), (s, s * .6, .01), self.p['leaf'] if rng.random() > .5 else self.p['leaf2'], 6, 3, (0, 0, rng.uniform(0, 3)))

    def feature(self, kind, cx, cy, mask, rng):
        b, p = self.b, self.p
        if kind == 'corner':
            dx, dy = corner_direction(mask)
            self.net(cx, cy, dx, dy, rng)
            self.lantern(cx + dx * .39, cy + dy * .39, .56)
        elif kind == 'end':
            dx, dy = end_direction(mask)
            x, y = cx + dx * .36, cy + dy * .36
            b.cylinder((x, y, .32), .13, .62, p['rust'], 16, .008)
            b.cylinder((x, y, .64), .135, .025, p['dark'], 16, .004)
            self.brazier(x, y, .5, .11, rng)


# -- Wallanlage: turfed earth rampart, stone turret stand, log toe and stakes ---------------

class Wall(Style):
    TOE, TOP = .06, .56

    def palette(self, m):
        return dict(
            turf=self.turf(), stone=m('Fieldstone', (120, 118, 106), .4), walk=m('Wall walk flagstone', (146, 140, 124), .35),
            bark=m('Bark log', (82, 64, 46), .35), cut=m('Cut log end', (156, 126, 88), .3), iron=m('Forged iron', (92, 96, 94), .25),
            dark=m('Soot iron', (43, 44, 39), .18), tuft=m('Turf tuft', (58, 74, 36), .3), tuft2=m('Dry turf tuft', (104, 98, 62), .3),
            ember=m('Separate forge ember', (230, 96, 24), .05, .9), coal=m('Forge coal', (30, 29, 25), .1),
            brass=m('Worn brass fittings', (158, 119, 61), .3), lamp=m('Separate lantern emission', (244, 153, 53), .01, .7))

    def turf(self):
        """Grass on the gentle crest, bare earth on the steep flanks (by surface normal)."""
        import bpy
        from dawn_parts import linear
        mat = bpy.data.materials.new('Rampart turf')
        mat.use_nodes = True
        n, l = mat.node_tree.nodes, mat.node_tree.links
        bsdf = n['Principled BSDF']; bsdf.inputs['Roughness'].default_value = .9
        geo = n.new('ShaderNodeNewGeometry')
        split = n.new('ShaderNodeSeparateXYZ'); l.new(geo.outputs['Normal'], split.inputs[0])
        steep = n.new('ShaderNodeMapRange'); steep.inputs['From Min'].default_value = .35; steep.inputs['From Max'].default_value = .6
        l.new(split.outputs['Z'], steep.inputs['Value'])
        noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 9; noise.inputs['Detail'].default_value = 6
        l.new(geo.outputs['Position'], noise.inputs['Vector'])
        grass = n.new('ShaderNodeValToRGB')
        grass.color_ramp.elements[0].color = (*linear((38, 54, 26)), 1); grass.color_ramp.elements[1].color = (*linear((74, 92, 44)), 1)
        l.new(noise.outputs['Fac'], grass.inputs[0])
        earth = n.new('ShaderNodeValToRGB')
        earth.color_ramp.elements[0].color = (*linear((70, 56, 40)), 1); earth.color_ramp.elements[1].color = (*linear((112, 92, 66)), 1)
        l.new(noise.outputs['Fac'], earth.inputs[0])
        mix = n.new('ShaderNodeMixRGB'); l.new(steep.outputs['Result'], mix.inputs[0])
        l.new(earth.outputs['Color'], mix.inputs[1]); l.new(grass.outputs['Color'], mix.inputs[2])
        l.new(mix.outputs['Color'], bsdf.inputs['Base Color'])
        bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .5; bump.inputs['Distance'].default_value = .01
        fine = n.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = 140; l.new(geo.outputs['Position'], fine.inputs['Vector'])
        l.new(fine.outputs['Fac'], bump.inputs['Height']); l.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        return mat

    def berm(self, q, a, b):
        d = min(q.depth(a, b, self.HALF), .42)
        return self.TOE + (self.TOP - self.TOE) * math.sin(math.pi / 2 * d / .42) ** 1.4

    def quadrant(self, q, rng):
        b, p, H = self.b, self.p, self.HALF
        for rect in q.regions(H):
            height_sheet(self.c, 'Rampart turf', q, rect, lambda a, bb: self.berm(q, a, bb), p['turf'], .04, .05, True)
        for qe, a0, a1 in q.edges(H):
            if a1 - a0 < .03: continue
            b.cylinder(qe.p((a0 + a1) / 2, H - .055, .055), .055, a1 - a0 + .01, p['bark'], 10, .006, qe.along())
            if a0 <= .25 <= a1 and (q.kind == 'straight' or .25 < H - .15):
                x, y, _ = qe.p(.25, H - .1)
                b.cylinder((x, y, .14), .028, .28, p['bark'], 8, .004)
                b.ell((x, y, .28), (.028, .028, .02), p['cut'], 6, 3)
        if q.has_corner():
            x, y, _ = q.p(H - .07, H - .07)
            b.cylinder((x, y, .16), .045, .32, p['bark'], 8, .006)
        for x, y in scatter_rects([q.p(.04, .04)[:2] + q.p(.48, H - .08)[:2]], rng, rng.randrange(2, 6)):
            if math.hypot(x - q.cx, y - q.cy) < self.PAD + .1: continue
            s = rng.uniform(.025, .05)
            a, bb = abs(x - q.cx), abs(y - q.cy)
            if q.swap: a, bb = bb, a
            b.ell((x, y, self.berm(q, a, bb) + .01), (s, s, .03), p['tuft'] if rng.random() > .3 else p['tuft2'], 8, 4)

    def pad(self, cx, cy, rng):
        b, p = self.b, self.p
        b.cylinder((cx, cy, (self.TOP + .06) / 2), self.PAD + .02, self.TOP + .06, p['stone'], 28, .02)
        b.cylinder((cx, cy, self.TOP + .07), self.PAD - .02, .03, p['stone'], 28, .008)
        b.cylinder((cx, cy, self.TOP + .072), self.PAD - .035, .03, p['iron'], 28, .004)
        b.cylinder((cx, cy, self.TOP + .078), self.PAD - .065, .03, p['stone'], 28, .006)
        self.bolts(cx, cy, self.TOP + .09, self.PAD - .05, 8, p['dark'], .014)

    def feature(self, kind, cx, cy, mask, rng):
        b, p = self.b, self.p
        if kind == 'corner':
            dx, dy = corner_direction(mask)
            x, y = cx + dx * .4, cy + dy * .4
            b.cylinder((x, y, .5), .04, 1.0, p['bark'], 8, .006)
            self.lantern(x, y, 1.0)
        elif kind == 'end':
            dx, dy = end_direction(mask)
            for side in (-1, 1):
                x, y = cx + dx * .4 - dy * side * .3, cy + dy * .4 + dx * side * .3
                b.cylinder((x, y, .55), .045, 1.1, p['bark'], 8, .006)
                self.brazier(x, y, 1.1, .065, rng)


STYLES = dict(burg=Burg, fort=Fort, feld=Feld, wall=Wall)


# -- Concept courtyard grounds (boards only) --------------------------------------------

def fade_material(name, base_rgb, dark_rgb, scale, voronoi=False, fade=.6, size=7.6):
    """Courtyard ground that fades out at its rim, so the game's own ground shows around it."""
    import bpy
    from dawn_parts import linear
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    n, l = mat.node_tree.nodes, mat.node_tree.links
    bsdf = n['Principled BSDF']; bsdf.inputs['Roughness'].default_value = .88
    geo = n.new('ShaderNodeNewGeometry')
    if voronoi:
        edge = n.new('ShaderNodeTexVoronoi'); edge.feature = 'DISTANCE_TO_EDGE'; edge.inputs['Scale'].default_value = scale
        l.new(geo.outputs['Position'], edge.inputs['Vector'])
        cells = n.new('ShaderNodeTexVoronoi'); cells.inputs['Scale'].default_value = scale
        l.new(geo.outputs['Position'], cells.inputs['Vector'])
        grey = n.new('ShaderNodeRGBToBW'); l.new(cells.outputs['Color'], grey.inputs[0])
        source, fac = edge.outputs['Distance'], grey.outputs[0]
        ramp_points = (.03, .09)
    else:
        noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = scale; noise.inputs['Detail'].default_value = 8
        l.new(geo.outputs['Position'], noise.inputs['Vector'])
        source, fac, ramp_points = noise.outputs['Fac'], noise.outputs['Fac'], (.35, .7)
    ramp = n.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = ramp_points
    ramp.color_ramp.elements[0].color = (*linear(dark_rgb), 1); ramp.color_ramp.elements[1].color = (*linear(base_rgb), 1)
    l.new(source, ramp.inputs[0])
    lift = n.new('ShaderNodeMapRange'); lift.inputs['To Min'].default_value = .78; lift.inputs['To Max'].default_value = 1.12
    l.new(fac, lift.inputs['Value'])
    tone = n.new('ShaderNodeMixRGB'); tone.blend_type = 'MULTIPLY'; tone.inputs[0].default_value = 1
    l.new(ramp.outputs['Color'], tone.inputs[1]); l.new(lift.outputs['Result'], tone.inputs[2])
    # Grass reclaims the yard in patches, more towards the rim than on the worn centre.
    patches = n.new('ShaderNodeTexNoise'); patches.inputs['Scale'].default_value = 1.4; patches.inputs['Detail'].default_value = 6
    l.new(geo.outputs['Position'], patches.inputs['Vector'])
    growth = n.new('ShaderNodeMapRange'); growth.inputs['From Min'].default_value = .5; growth.inputs['From Max'].default_value = .66
    growth.inputs['To Max'].default_value = .85
    l.new(patches.outputs['Fac'], growth.inputs['Value'])
    grass = n.new('ShaderNodeMixRGB'); l.new(growth.outputs['Result'], grass.inputs[0])
    l.new(tone.outputs['Color'], grass.inputs[1]); grass.inputs[2].default_value = (*linear((46, 62, 30)), 1)
    l.new(grass.outputs['Color'], bsdf.inputs['Base Color'])
    bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .45; bump.inputs['Distance'].default_value = .02
    l.new(source, bump.inputs['Height']); l.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    # Rim fade: distance to the square's edge, broken up by noise.
    split = n.new('ShaderNodeSeparateXYZ'); l.new(geo.outputs['Position'], split.inputs[0])
    absx = n.new('ShaderNodeMath'); absx.operation = 'ABSOLUTE'; l.new(split.outputs['X'], absx.inputs[0])
    absy = n.new('ShaderNodeMath'); absy.operation = 'ABSOLUTE'; l.new(split.outputs['Y'], absy.inputs[0])
    far = n.new('ShaderNodeMath'); far.operation = 'MAXIMUM'; l.new(absx.outputs[0], far.inputs[0]); l.new(absy.outputs[0], far.inputs[1])
    wobble = n.new('ShaderNodeTexNoise'); wobble.inputs['Scale'].default_value = 3.5; l.new(geo.outputs['Position'], wobble.inputs['Vector'])
    edge_dist = n.new('ShaderNodeMath'); edge_dist.operation = 'MULTIPLY_ADD'
    l.new(wobble.outputs['Fac'], edge_dist.inputs[0]); edge_dist.inputs[1].default_value = 1.1; l.new(far.outputs[0], edge_dist.inputs[2])
    alpha = n.new('ShaderNodeMapRange'); alpha.inputs['From Min'].default_value = size / 2 + .3 - fade; alpha.inputs['From Max'].default_value = size / 2 + .3
    alpha.inputs['To Min'].default_value = .86; alpha.inputs['To Max'].default_value = 0
    l.new(edge_dist.outputs[0], alpha.inputs['Value']); l.new(alpha.outputs['Result'], bsdf.inputs['Alpha'])
    return mat


def courtyard_ground(c, style, m, rect, rng):
    """Style ground over the 7 x 7 courtyard and build area, fading into the game ground."""
    from base_structure_parts import flat_sheet
    x0, y0, x1, y1 = rect
    size = x1 - x0
    made, b = [], Batch(c)
    looks = dict(burg=('Courtyard cobbles', (108, 104, 94), (44, 50, 32), 6.0, True),
                 fort=('Courtyard packed earth', (122, 104, 78), (88, 72, 52), 3.0, False),
                 feld=('Courtyard mud', (92, 78, 58), (58, 50, 38), 3.4, False),
                 wall=('Courtyard trampled grass', (70, 80, 46), (86, 72, 52), 2.6, False))
    name, base, dark, scale, vor = looks[style]
    made.append(flat_sheet(c, name, x0 - .6, y0 - .6, x1 + .6, y1 + .6, .0, fade_material(name, base, dark, scale, vor, 1.3, size)))
    if style == 'fort':
        plank = m('Boardwalk plank', (128, 108, 82), .3)
        for axis in (0, 1):
            t = x0 + .7
            while t < x1 - .7:
                if axis == 0 or abs(t + .08) > .42:
                    pos, dims = ((t + .08, 0, .025), (.14, .8, .035)) if axis == 0 else ((0, t + .08, .03), (.8, .14, .035))
                    b.box(pos, dims, plank, .006, None, .006, rng)
                t += .16
    elif style == 'feld':
        slat = m('Duckboard slat', (116, 98, 72), .3)
        for axis in (0, 1):
            t = x0 + .7
            while t < x1 - .7:
                if axis == 0 or abs(t + .06) > .36:
                    pos, dims = ((t + .06, 0, .03), (.08, .6, .03)) if axis == 0 else ((0, t + .06, .035), (.6, .08, .03))
                    b.box(pos, dims, slat, .004, None, .005, rng)
                t += .13
            for side in (-1, 1):
                pos, dims = ((0, side * .22, .012), (x1 - x0 - 1.4, .06, .025)) if axis == 0 else ((side * .22, 0, .016), (.06, x1 - x0 - 1.4, .025))
                b.box(pos, dims, slat, .004)
    elif style == 'wall':
        flag = m('Worn paving stone', (100, 96, 86), .38)
        for axis in (0, 1):
            t = x0 + .6
            while t < x1 - .6:
                w = rng.uniform(.2, .3)
                for lane in (-.16, .16):
                    if rng.random() < .85:
                        pos = (t + w / 2, lane + rng.uniform(-.04, .04), .02) if axis == 0 else (lane + rng.uniform(-.04, .04), t + w / 2, .02)
                        dims = (w - .05, .26, .04) if axis == 0 else (.26, w - .05, .04)
                        b.box(pos, dims, flag, .015, (0, 0, rng.uniform(-.08, .08)), .02, rng)
                t += w
    return made + b.flush('Courtyard')
