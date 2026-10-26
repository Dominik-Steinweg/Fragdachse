"""Persistent base and outpost kit at 1 BU = 1 m = 1 cell = 32 px.

A base is a set of grid cells. Every cell is built from its own 8-neighbour mask only and split
into four quadrants like the 47-blob autotile: full, inner corner, straight or outer corner. The
same code therefore renders a whole base (master) or one isolated cell per mask (kit atlas), and
an atlas cell matches the cell inside a whole base. Geometry stays inside its own cell; it meets
the neighbour only on the shared cell line, where the neighbour continues it.

Grid coordinates follow the game (y grows south); Blender +Y is north, so a cell (gx, gy) sits at
x = gx - ox, y = oy - gy for the scene origin (ox, oy).
"""
import math
import random
import bpy

# AutoTiler bit order, clockwise from north (src/arena/AutoTiler.ts).
N, NE, E, SE, S, SW, W, NW = 1, 2, 4, 8, 16, 32, 64, 128


def mask_of(cells, gx, gy):
    """Corner-suppressed 8-neighbour mask, identical to AutoTiler.computeMask."""
    has = lambda x, y: (x, y) in cells
    n, e, s, w = has(gx, gy - 1), has(gx + 1, gy), has(gx, gy + 1), has(gx - 1, gy)
    mask = (N if n else 0) | (E if e else 0) | (S if s else 0) | (W if w else 0)
    if n and e and has(gx + 1, gy - 1): mask |= NE
    if s and e and has(gx + 1, gy + 1): mask |= SE
    if s and w and has(gx - 1, gy + 1): mask |= SW
    if n and w and has(gx - 1, gy - 1): mask |= NW
    return mask


def all_masks():
    """The 47 distinct corner-suppressed masks in ascending order."""
    found = set()
    for bits in range(256):
        n, e, s, w = bits & N, bits & E, bits & S, bits & W
        mask = bits & (N | E | S | W)
        if n and e and bits & NE: mask |= NE
        if s and e and bits & SE: mask |= SE
        if s and w and bits & SW: mask |= SW
        if n and w and bits & NW: mask |= NW
        found.add(mask)
    return sorted(found)


def cell_class(mask):
    """Coarse role of a cell for per-cell features (towers, gate posts, tents)."""
    links = [d for d in (N, E, S, W) if mask & d]
    if not links: return 'isolated'
    if len(links) == 1: return 'end'
    if len(links) == 2:
        if set(links) in ({N, S}, {E, W}): return 'straight'
        diagonal = {frozenset({N, E}): NE, frozenset({E, S}): SE, frozenset({S, W}): SW, frozenset({W, N}): NW}[frozenset(links)]
        return 'block-corner' if mask & diagonal else 'corner'
    return 'junction' if len(links) == 3 else 'cross'


def end_direction(mask):
    """Unit (x, y) in Blender axes pointing from an end cell away from its only neighbour."""
    return {N: (0, -1), S: (0, 1), E: (-1, 0), W: (1, 0)}[next(d for d in (N, E, S, W) if mask & d)]


def corner_direction(mask):
    """Diagonal (x, y) in Blender axes pointing out of a corner cell, away from both links."""
    return (-1 if mask & E else 1), (1 if mask & S else -1)


def side_normals(mask):
    """Unit (x, y) normals of the exposed cell sides."""
    return [v for d, v in ((N, (0, 1)), (E, (1, 0)), (S, (0, -1)), (W, (-1, 0))) if not mask & d]


class Quadrant:
    """One quarter of a cell in canonical coordinates a, b in [0, .5].

    a runs along an exposed edge, b across it towards the exposed side. `swap` exchanges the
    roles of x and y, so one canonical piece serves both axes. `kind` is full, inner, straight or
    outer; a straight quadrant is swapped when its exposed edge runs along Y.
    """
    def __init__(self, cx, cy, sx, sy, kind, swap=False):
        self.cx, self.cy, self.sx, self.sy, self.kind, self.swap = cx, cy, sx, sy, kind, swap

    def turned(self):
        return Quadrant(self.cx, self.cy, self.sx, self.sy, self.kind, not self.swap)

    def p(self, a, b, z=0.0):
        u, v = (b, a) if self.swap else (a, b)
        return (self.cx + self.sx * u, self.cy + self.sy * v, z)

    def dims(self, da, db, dz):
        return (db, da, dz) if self.swap else (da, db, dz)

    def depth(self, a, b, half):
        """Distance to the nearest exposed edge of a body of the given half width."""
        if self.kind == 'full': return 9.0
        if self.kind == 'straight': return half - b
        if self.kind == 'outer': return min(half - a, half - b)
        return max(half - a, half - b)  # inner corner: the valley runs along the diagonal

    def regions(self, half):
        """Body footprint of the given half width as canonical rectangles (a0, b0, a1, b1)."""
        return {'full': [(0, 0, .5, .5)], 'straight': [(0, 0, .5, half)], 'outer': [(0, 0, half, half)],
                'inner': [(0, 0, .5, half), (0, half, half, .5)]}[self.kind]

    def edges(self, line):
        """Exposed edge runs at offset `line` as (frame, a0, a1); corners are left to `corner`."""
        if self.kind == 'straight': return [(self, 0, .5)]
        if self.kind == 'outer': return [(self, 0, line), (self.turned(), 0, line)]
        if self.kind == 'inner': return [(self, line, .5), (self.turned(), line, .5)]
        return []

    def has_corner(self):
        return self.kind in ('outer', 'inner')

    def tilt(self, slope):
        """Euler that tilts a box so its top falls by `slope` towards the exposed side (+b)."""
        angle = math.atan(slope)
        return (0, self.sx * angle, 0) if self.swap else (-self.sy * angle, 0, 0)

    def along(self):
        """Euler that turns a Z cylinder so its axis runs along a."""
        return (math.pi / 2, 0, 0) if self.swap else (0, math.pi / 2, 0)


def quadrants(cx, cy, mask):
    out = []
    for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        h = mask & (E if sx > 0 else W)
        v = mask & (N if sy > 0 else S)
        d = mask & {(1, 1): NE, (-1, 1): NW, (-1, -1): SW, (1, -1): SE}[(sx, sy)]
        if h and v: kind, swap = ('full' if d else 'inner'), False
        elif h: kind, swap = 'straight', False
        elif v: kind, swap = 'straight', True
        else: kind, swap = 'outer', False
        out.append(Quadrant(cx, cy, sx, sy, kind, swap))
    return out


def cell_seed(gx, gy, variant):
    """Deterministic per-cell seed shared by master renders and the kit atlas."""
    return ((gx * 73856093) ^ (gy * 19349663) ^ (variant * 83492791)) & 0xffffffff


# -- Mesh helpers -------------------------------------------------------------

class Batch:
    """Collects many small boxes, cylinders and ellipsoids into one mesh per material.

    Thousands of single primitives through bpy.ops cost minutes per scene; one mesh per
    material and bevel width renders the same and builds in seconds.
    """
    def __init__(self, c):
        self.c, self.groups = c, {}

    def _group(self, mat, bevel):
        return self.groups.setdefault((mat.name, round(bevel, 4)), dict(mat=mat, bevel=bevel, verts=[], faces=[], smooth=[]))

    def _add(self, mat, bevel, local, faces, smooth, loc, rot):
        from mathutils import Euler, Vector
        g = self._group(mat, bevel)
        m = Euler(rot).to_matrix() if rot else None
        base = len(g['verts'])
        for v in local:
            p = m @ Vector(v) if m else Vector(v)
            g['verts'].append((p.x + loc[0], p.y + loc[1], p.z + loc[2]))
        g['faces'].extend(tuple(base + i for i in f) for f in faces)
        g['smooth'].extend(smooth)

    def box(self, loc, size, mat, bevel=.01, rot=None, jitter=0.0, rng=None):
        """`jitter` moves every corner by up to that many metres, for hand-cut stones and planks."""
        x, y, z = (s / 2 for s in size)
        local = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z), (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
        if jitter and rng:
            local = [(px + rng.uniform(-jitter, jitter), py + rng.uniform(-jitter, jitter), pz + rng.uniform(-jitter, jitter) * .6)
                     for px, py, pz in local]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self._add(mat, bevel, local, faces, [False] * 6, loc, rot)

    def cylinder(self, loc, radius, depth, mat, sides=12, bevel=.01, rot=None, phase=0.0):
        ring = [(radius * math.cos(phase + i * math.tau / sides), radius * math.sin(phase + i * math.tau / sides)) for i in range(sides)]
        local = [(x, y, -depth / 2) for x, y in ring] + [(x, y, depth / 2) for x, y in ring]
        faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
        faces += [tuple(range(sides - 1, -1, -1)), tuple(range(sides, 2 * sides))]
        self._add(mat, bevel, local, faces, [True] * sides + [False, False], loc, rot)

    def rod(self, a, b, radius, mat, sides=8):
        from mathutils import Vector
        a, b = Vector(a), Vector(b)
        rot = Vector((0, 0, 1)).rotation_difference(b - a).to_euler()
        self.cylinder(tuple((a + b) / 2), radius, (b - a).length, mat, sides, 0, tuple(rot))

    def ell(self, loc, scale, mat, segments=12, rings=7, rot=None):
        sx, sy, sz = scale
        local = [(0, 0, -sz)]
        for r in range(1, rings):
            phi = math.pi * r / rings - math.pi / 2
            for s in range(segments):
                th = math.tau * s / segments
                local.append((sx * math.cos(phi) * math.cos(th), sy * math.cos(phi) * math.sin(th), sz * math.sin(phi)))
        local.append((0, 0, sz))
        top = len(local) - 1
        faces = [(0, 1 + (s + 1) % segments, 1 + s) for s in range(segments)]
        for r in range(rings - 2):
            a, b = 1 + r * segments, 1 + (r + 1) * segments
            faces += [(a + s, a + (s + 1) % segments, b + (s + 1) % segments, b + s) for s in range(segments)]
        last = 1 + (rings - 2) * segments
        faces += [(last + s, last + (s + 1) % segments, top) for s in range(segments)]
        self._add(mat, 0, local, faces, [True] * len(faces), loc, rot)

    def flush(self, name):
        made = []
        for (mat_name, _), g in self.groups.items():
            if not g['faces']: continue
            ob = mesh_object(self.c, f'{name} {mat_name}', g['verts'], g['faces'], g['mat'])
            for face, smooth in zip(ob.data.polygons, g['smooth']): face.use_smooth = smooth
            if g['bevel'] > 0:
                mod = ob.modifiers.new('Soft edge', 'BEVEL'); mod.width, mod.segments = g['bevel'], 2
                mod.limit_method = 'ANGLE'
            ob.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
            made.append(ob)
        self.groups = {}
        return made

def mesh_object(c, name, verts, faces, mat, smooth=False, solidify=0.0):
    mesh = bpy.data.meshes.new(name + ' mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    c.scene.collection.objects.link(ob)
    mesh.materials.append(mat)
    for face in mesh.polygons: face.use_smooth = smooth
    if solidify:
        mod = ob.modifiers.new('Sheet thickness', 'SOLIDIFY'); mod.thickness = solidify; mod.offset = -1
    return ob


def height_sheet(c, name, q, rect, height, mat, step=.05, solidify=.03, smooth=True):
    """A displaced sheet over one canonical rectangle; height(a, b) gives z in metres."""
    a0, b0, a1, b1 = rect
    nu, nv = max(1, round((a1 - a0) / step)), max(1, round((b1 - b0) / step))
    verts, faces = [], []
    for j in range(nv + 1):
        b = b0 + (b1 - b0) * j / nv
        for i in range(nu + 1):
            a = a0 + (a1 - a0) * i / nu
            verts.append(q.p(a, b, height(a, b)))
    flip = (q.sx * q.sy < 0) != q.swap  # keep the winding upward under mirror and swap
    for j in range(nv):
        for i in range(nu):
            k = j * (nu + 1) + i
            face = (k, k + 1, k + nu + 2, k + nu + 1)
            faces.append(face[::-1] if flip else face)
    return mesh_object(c, name, verts, faces, mat, smooth, solidify)


def flat_sheet(c, name, x0, y0, x1, y1, z, mat, solidify=0.0):
    return mesh_object(c, name, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [(0, 1, 2, 3)], mat, False, solidify)


def cone(c, name, center, radius, z0, z1, mat, sides=24, tip_radius=0.0, phase=0.0):
    x, y = center
    ring = lambda r, z: [(x + r * math.cos(phase + i * math.tau / sides), y + r * math.sin(phase + i * math.tau / sides), z) for i in range(sides)]
    if tip_radius > 0:
        faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
        return mesh_object(c, name, ring(radius, z0) + ring(tip_radius, z1), faces, mat, sides > 10)
    faces = [(i, (i + 1) % sides, sides) for i in range(sides)]
    return mesh_object(c, name, ring(radius, z0) + [(x, y, z1)], faces, mat, sides > 10)


def pyramid_roof(c, name, center, half, z0, z1, mat):
    """Hipped square roof: four sloped sheets meeting in one point."""
    x, y = center
    corners = [(x - half, y - half), (x + half, y - half), (x + half, y + half), (x - half, y + half)]
    verts = [(px, py, z0) for px, py in corners] + [(x, y, z1)]
    return mesh_object(c, name, verts, [(i, (i + 1) % 4, 4) for i in range(4)], mat, False, .04)


def rod(c, name, a, b, radius, mat, sides=10):
    """A round member between two 3-D points."""
    from mathutils import Vector
    a, b = Vector(a), Vector(b)
    ob = c.cylinder(name, tuple((a + b) / 2), radius, (b - a).length, mat, sides)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(b - a)
    return ob


def scatter_rects(rects, rng, count):
    """Random points inside axis-aligned rectangles, weighted by area."""
    areas = [abs((x1 - x0) * (y1 - y0)) for x0, y0, x1, y1 in rects]
    total = sum(areas) or 1
    for _ in range(count):
        pick = rng.uniform(0, total)
        for rect, area in zip(rects, areas):
            if pick <= area:
                x0, y0, x1, y1 = rect
                yield rng.uniform(x0, x1), rng.uniform(y0, y1)
                break
            pick -= area
