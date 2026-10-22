"""Design concepts of the spawn structure (GDD Spawnbauwerk V1), for the user's choice.

Shared contract of every concept: one Blender unit is one 32 px world cell; the pivot is the brood
pit centre; the building is the canonical U (south opening, turned later by the recipe) with every
part inside |x|,|y| <= 1.97 on its wall cells; dark walls; a violet line marks the hitbox edge; the
pit is walkable ground without frame, ring, swirl or central orifice. Drafts: intact/active only.

    A  Bollwerk        heavy bevelled armour, continuous glowing seam, corner bastions, brood gate
    B  Brutgeschwuer   brood tissue overgrows a dark plinth, a thick glowing vein traces the edge
    C  Obsidian        splintered obsidian slabs, violet crystal inlay on the edge, crystal spires
    D  Brutmaschine    industrial brood works: glowing conduit on the edge, brood tanks, pumps
"""
import math
import random
from dawn_parts import surface, tapered_tube
from enemy_parts_b import plate

VOID_DEEP, VOID_PRIMARY, VOID_BRIGHT = (111, 22, 168), (179, 71, 255), (217, 140, 255)
WALL_CELLS = [(-1.5, 1.5), (-.5, 1.5), (.5, 1.5), (1.5, 1.5), (-1.5, .5), (-1.5, -.5), (1.5, .5), (1.5, -.5)]
OUTLINE = [(-2, -1), (-1, -1), (-1, 1), (1, 1), (1, -1), (2, -1), (2, 2), (-2, 2)]
OUTER_CORNERS = [(-2, 2), (2, 2), (-2, -1), (2, -1)]
MARGIN = .03


def edges():
    for a, b in zip(OUTLINE, OUTLINE[1:] + OUTLINE[:1]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        d = (dx / length, dy / length)
        yield a, d, (-d[1], d[0]), int(round(length))


def strip(c, name, a, d, n, t0, t1, off0, off1, z, thickness, material, bevel=.008):
    pts = [(a[0] + d[0] * t + n[0] * o, a[1] + d[1] * t + n[1] * o) for t, o in ((t0, off0), (t1, off0), (t1, off1), (t0, off1))]
    return plate(c, name, (0, 0, z), pts, thickness, material, bevel)


def inset_outline(offset):
    pts = []
    count = len(OUTLINE)
    for i in range(count):
        p, prev, nxt = OUTLINE[i], OUTLINE[i - 1], OUTLINE[(i + 1) % count]
        n1 = (-(p[1] - prev[1]), p[0] - prev[0]); l1 = math.hypot(*n1); n1 = (n1[0] / l1, n1[1] / l1)
        n2 = (-(nxt[1] - p[1]), nxt[0] - p[0]); l2 = math.hypot(*n2); n2 = (n2[0] / l2, n2[1] / l2)
        bis = (n1[0] + n2[0], n1[1] + n2[1])
        scale = offset / max(.2, bis[0] * n1[0] + bis[1] * n1[1])
        pts.append((p[0] + bis[0] * scale, p[1] + bis[1] * scale))
    return pts


def edge_path(offset, step=.25):
    """Closed polyline along the U at `offset` inward, sampled every `step` cells (for tubes)."""
    corners = inset_outline(offset)
    pts = []
    for i, a in enumerate(corners):
        b = corners[(i + 1) % len(corners)]
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        count = max(1, int(length / step))
        for j in range(count):
            t = j / count
            pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return pts


def centred_plate(c, name, center, outline, thickness, material, bevel=.025):
    ob = plate(c, name, (0, 0, 0), outline, thickness, material, bevel)
    ob.location = center
    return ob


def chamfered(s, ch):
    return [(-s + ch, -s), (s - ch, -s), (s, -s + ch), (s, s - ch), (s - ch, s), (-s + ch, s), (-s, s - ch), (-s, -s + ch)]


def damp(mat, roughness=.5, coat=.1):
    n, l = mat.node_tree.nodes, mat.node_tree.links
    bs = n['Principled BSDF']
    bs.inputs['Specular IOR Level'].default_value = .2
    bs.inputs['Coat Weight'].default_value = coat
    bs.inputs['Coat Roughness'].default_value = .38
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 15
    ramp = n.new('ShaderNodeMapRange')
    ramp.inputs['To Min'].default_value = roughness - .12; ramp.inputs['To Max'].default_value = roughness + .14
    l.new(noise.outputs['Fac'], ramp.inputs['Value']); l.new(ramp.outputs['Result'], bs.inputs['Roughness'])
    return mat


def lump(c, mat, x, y, z, sx, sy, sz, rng, name='Void brood lump', angle=None):
    ob = c.ell(name, (x, y, z), (sx, sy, sz), mat)
    ob.rotation_euler.z = rng.uniform(0, math.pi) if angle is None else angle
    phase = rng.uniform(0, math.tau)
    for v in ob.data.vertices:
        v.co.z *= 1 + .16 * math.sin(v.co.x * 9 + v.co.y * 5 + phase)
    return ob


class ConceptKit:
    """Material roles shared by the concepts; emission only on rim, vein and heart roles."""

    def __init__(self, c, spec):
        lib = spec['model'].get('librarySurfaces', {})
        def m(name, rgb, wear=.3, emission=0):
            return surface(c, name, rgb, wear, emission, **lib.get(name, {}))
        self.m = m
        self.armor = m('Blackened void armour', (31, 30, 35), .22)
        self.panel = m('Void armour plate', (38, 37, 43), .2)
        self.frame = m('Grey armour frame', (78, 76, 84), .3)
        self.seam = m('Deep armour seam', (12, 11, 15), 0)
        self.node = m('Dark frame node', (22, 21, 26), .1)
        self.mass = damp(m('Void brood mass', (40, 18, 52), .12))
        self.fold = damp(m('Bruised brood fold', (66, 28, 82), .1), .46)
        self.egg = damp(m('Translucent brood egg', (70, 36, 88), .08), .4)
        self.throat = m('Opaque brood throat', (12, 6, 18), 0)
        self.chitin = m('Dark chitin hook', (74, 66, 76), .3)
        self.obsidian = damp(m('Splintered obsidian', (14, 12, 20), .05), .35, .12)
        self.metal = m('Dark brood works metal', (44, 44, 50), .3)
        self.pipe = m('Blackened pipe', (34, 33, 38), .25)
        self.glass = damp(m('Brood tank glass', (60, 30, 80), .02), .2, .4)
        self.rim = m('Void rim seam', VOID_PRIMARY, 0, .9)
        self.vein = m('Void brood vein', (100, 34, 140), 0, .35)
        self.heart = m('Void brood heart', VOID_PRIMARY, 0, .8)
        self.crystal = m('Void crystal inlay', (150, 70, 220), 0, 1.0)


# ── Buildings ────────────────────────────────────────────────────────────────────────────────

def building_a(c, k, rng):
    """Bollwerk: heavy bevelled armour, continuous glowing seam, corner bastions, brood gate."""
    top = .36
    plate(c, 'Blackened void armour', (0, 0, top / 2), inset_outline(MARGIN), top, k.armor, .12)
    for a, d, n, length in edges():
        strip(c, 'Deep armour seam', a, d, n, 0, length, MARGIN + .1, MARGIN + .2, top + .005, .03, k.seam, .006)
        strip(c, 'Void rim seam', a, d, n, 0, length, MARGIN + .125, MARGIN + .175, top + .015, .025, k.rim, .004)
    for x, y in WALL_CELLS:
        plate(c, 'Void armour plate', (0, 0, top + .02), [(x + px, y + py) for px, py in chamfered(.27, .09)], .04, k.panel, .014)
    for x, y in OUTER_CORNERS:
        sx, sy = (-1 if x < 0 else 1), (-1 if y < 0 else 1)
        cx, cy = x - sx * .34, y - sy * .34
        centred_plate(c, 'Corner bastion', (cx, cy, top + .08), chamfered(.29, .1), .16, k.armor, .05)
        centred_plate(c, 'Bastion cap', (cx, cy, top + .17), chamfered(.18, .06), .04, k.panel, .015)
        centred_plate(c, 'Bastion slit', (cx, cy, top + .195), [(-.1, -.018), (.1, -.018), (.1, .018), (-.1, .018)], .01, k.heart, .003)
    # Armoured brood gate on the back wall: a heavy frame, bars and a glowing slit toward the pit.
    centred_plate(c, 'Brood gate frame', (0, 1.5, top + .09), chamfered(.4, .12), .16, k.armor, .04)
    centred_plate(c, 'Brood gate recess', (0, 1.5, top + .15), [(-.3, -.12), (.3, -.12), (.3, .12), (-.3, .12)], .04, k.throat, .01)
    centred_plate(c, 'Brood gate slit', (0, 1.47, top + .175), [(-.24, -.025), (.24, -.025), (.24, .025), (-.24, .025)], .01, k.heart, .003)
    for x in (-.2, -.07, .07, .2):
        centred_plate(c, 'Brood gate bar', (x, 1.5, top + .2), [(-.018, -.15), (.018, -.15), (.018, .15), (-.018, .15)], .03, k.frame, .006)
    # Brood seeps from the inner seams only, a sign of what the walls hold.
    for x, y, r in ((-1.24, .7, .1), (-1.22, -.2, .08), (1.25, .3, .09), (1.23, -.55, .07), (-.6, 1.24, .09), (.7, 1.25, .08)):
        lump(c, k.mass, x, y, top + .03, r, r * .8, r * .55, rng)


def building_b(c, k, rng):
    """Brutgeschwuer: brood tissue overgrows a dark plinth; a thick glowing vein traces the edge."""
    top = .22
    plate(c, 'Blackened void armour', (0, 0, top / 2), inset_outline(MARGIN), top, k.armor, .05)
    path = edge_path(MARGIN + .1, .2)
    wobble = [(x + rng.uniform(-.02, .02), y + rng.uniform(-.02, .02), top + .07 + rng.uniform(0, .03)) for x, y in path]
    tapered_tube(c, 'Bruised brood fold', [(x, y, top + .01) for x, y, z in wobble] + [(wobble[0][0], wobble[0][1], top + .01)],
                 [rng.uniform(.05, .065) for _ in range(len(wobble) + 1)], k.fold, 8)
    tapered_tube(c, 'Void rim seam', [(x, y, z + .06) for x, y, z in wobble] + [(wobble[0][0], wobble[0][1], wobble[0][2] + .06)],
                 [rng.uniform(.04, .055) for _ in range(len(wobble) + 1)], k.rim, 8)
    # Tissue fills the wall tops between the edge veins: big merged lumps, thickest on the back wall.
    for x, y in WALL_CELLS:
        for j in range(4):
            px, py = x + rng.uniform(-.24, .24), y + rng.uniform(-.24, .24)
            lump(c, k.mass, px, py, top + .06, rng.uniform(.2, .28), rng.uniform(.18, .26), rng.uniform(.12, .2) * (1.3 if y > 1 else 1), rng)
    for x, y in ((-1.5, 1.5), (1.5, 1.5), (-1.5, -.4), (1.5, .3), (.0, 1.6)):
        for j in range(4):
            r = rng.uniform(.07, .11)
            lump(c, k.egg, x + rng.uniform(-.15, .15), y + rng.uniform(-.15, .15), top + .26, r, r * .9, r * .8, rng, 'Translucent brood egg')
    for side in (-1, 1):
        pts = [(side * 1.5, 1.45, top + .3), (side * 1.55, .6, top + .26), (side * 1.45, -.2, top + .22), (side * 1.36, -.7, top + .14)]
        tapered_tube(c, 'Void brood vein', pts, [.03, .028, .022, .008], k.vein, 8)
    lump(c, k.fold, 0, 1.48, top + .2, .38, .3, .28, rng, 'Brood heart sac', 0.0)
    c.ell('Brood heart slit', (0, 1.42, top + .45), (.035, .2, .05), k.heart)


def building_c(c, k, rng):
    """Obsidian: splintered black slabs, a violet crystal inlay along the edge, crystal spires."""
    plate(c, 'Deep armour seam', (0, 0, .03), inset_outline(MARGIN), .06, k.seam, .01)
    # Three splintered slabs per wall cell, each kept inside its cell so the U outline holds.
    for x, y in WALL_CELLS:
        for j in range(3):
            px, py = x + rng.uniform(-.1, .1), y + rng.uniform(-.1, .1)
            pts = [(rng.uniform(-.3, -.18), rng.uniform(-.3, -.12)), (rng.uniform(.12, .3), rng.uniform(-.3, -.18)),
                   (rng.uniform(.18, .3), rng.uniform(.12, .3)), (rng.uniform(-.24, -.1), rng.uniform(.18, .3))]
            h = rng.uniform(.26, .4)
            ob = centred_plate(c, 'Splintered obsidian', (px, py, h / 2), pts, h, k.obsidian, .03)
            ob.rotation_euler.z = rng.uniform(-.3, .3)
    for a, d, n, length in edges():
        for cell in range(length):
            for seg in range(2):
                t0 = cell + .08 + seg * .46 + rng.uniform(0, .04)
                strip(c, 'Void crystal inlay', a, d, n, t0, t0 + .38, MARGIN + .08, MARGIN + .08 + rng.uniform(.04, .06), .41, .03, k.crystal, .006)
    for x, y in OUTER_CORNERS:
        sx, sy = (-1 if x < 0 else 1), (-1 if y < 0 else 1)
        cx, cy = x - sx * .3, y - sy * .3
        for j in range(3):
            a = rng.uniform(0, math.tau)
            pts = [(cx + .05 * math.cos(a), cy + .05 * math.sin(a), .4), (cx + .1 * math.cos(a), cy + .1 * math.sin(a), .62 + rng.uniform(0, .12))]
            tapered_tube(c, 'Void crystal inlay', pts, [.07, .005], k.crystal, 6)
    for x, y, r in ((-1.45, .6, .14), (1.5, 1.4, .12), (.4, 1.55, .13), (-.9, 1.45, .1)):
        lump(c, k.mass, x, y, .42, r, r * .8, r * .3, rng)
    c.ell('Brood heart slit', (0, 1.5, .44), (.04, .22, .04), k.heart)
    for side in (-1, 1):
        c.ell('Void crystal inlay', (side * .15, 1.5, .44), (.03, .16, .03), k.crystal)


def building_d(c, k, rng):
    """Brutmaschine: dark works with a glowing conduit on the edge, brood tanks and pumps."""
    top = .3
    plate(c, 'Dark brood works metal', (0, 0, top / 2), inset_outline(MARGIN), top, k.metal, .03)
    for x, y in WALL_CELLS:
        plate(c, 'Void armour plate', (0, 0, top + .01), [(x + px, y + py) for px, py in chamfered(.4, .05)], .02, k.panel, .006)
    # The edge conduit: a glass tube with violet brood fluid, held by dark brackets.
    path = edge_path(MARGIN + .09, .16)
    pts = [(x, y, top + .07) for x, y in path]
    tapered_tube(c, 'Void rim seam', pts + pts[:1], [.045] * (len(pts) + 1), k.rim, 10)
    for i, (x, y) in enumerate(path):
        if i % 3: continue
        centred_plate(c, 'Conduit bracket', (x, y, top + .08), [(-.05, -.05), (.05, -.05), (.05, .05), (-.05, .05)], .1, k.pipe, .01)
    # Brood tanks on the back wall and a pump between them.
    for x in (-1.0, 1.0):
        c.cylinder('Brood tank collar', (x, 1.5, top + .06), .3, .1, k.pipe, 24)
        glass = c.cylinder('Brood tank glass', (x, 1.5, top + .2), .25, .26, k.glass, 24)
        c.ell('Brood embryo', (x, 1.5, top + .22), (.13, .17, .09), k.mass)
        c.ell('Void brood heart', (x, 1.46, top + .3), (.06, .1, .03), k.heart)
    centred_plate(c, 'Pump housing', (0, 1.5, top + .1), chamfered(.26, .07), .2, k.metal, .03)
    c.cylinder('Pump flywheel', (0, 1.5, top + .23), .14, .06, k.pipe, 16)
    for side in (-1, 1):
        pts = [(side * .3, 1.5, top + .14), (side * .7, 1.5, top + .14)]
        tapered_tube(c, 'Blackened pipe', pts, [.05, .05], k.pipe, 10)
        pts = [(side * 1.5, 1.2, top + .1), (side * 1.5, .2, top + .1), (side * 1.5, -.55, top + .1), (side * 1.3, -.75, top + .1)]
        tapered_tube(c, 'Blackened pipe', pts, [.06, .06, .06, .05], k.pipe, 10)
        c.cylinder('Pump nozzle', (side * 1.25, -.78, top + .1), .07, .12, k.metal, 12)
    for x, y in ((-1.45, .4), (1.45, -.1), (-.5, 1.3)):
        lump(c, k.mass, x, y, top + .05, .12, .1, .06, rng)


BUILDINGS = {'a': building_a, 'b': building_b, 'c': building_c, 'd': building_d}


# ── Pits ─────────────────────────────────────────────────────────────────────────────────────

def pit_floor(c, k, value_mat, half=1.04):
    plate(c, 'Deep armour seam', (0, 0, -.03), [(-half, -half), (half, -half), (half, half), (-half, half)], .03, k.seam, .005)
    for gx in (-.5, .5):
        for gy in (-.5, .5):
            plate(c, 'Sunken floor plate', (0, 0, .0), [(gx + px, gy + py) for px, py in chamfered(.48, .08)], .04, value_mat, .012)


def pit_a(c, k, rng):
    """Shutter hatch: two heavy plates slid half open over black ooze with a depth glow."""
    pit_floor(c, k, k.armor)
    plate(c, 'Black brood ooze', (0, 0, .025), [(-.32, -.85), (.32, -.85), (.32, .85), (-.32, .85)], .02, k.throat, .01)
    for i in range(3):
        c.ell('Brood pool glow', (rng.uniform(-.12, .12), rng.uniform(-.6, .6), .038), (.08, .16, .01), k.vein)
    for side in (-1, 1):
        x0 = side * .26
        pts = [(x0, -.92), (x0 + side * .7, -.92), (x0 + side * .7, .92), (x0, .92)]
        plate(c, 'Shutter plate', (0, 0, .05), pts, .04, k.armor, .02)
        for y in (-.6, -.2, .2, .6):
            plate(c, 'Shutter rib', (0, 0, .075), [(x0 + side * .06, y - .03), (x0 + side * .62, y - .03), (x0 + side * .62, y + .03), (x0 + side * .06, y + .03)],
                  .015, k.seam, .006)
    for x, y, r in ((.05, .3, .05), (-.08, -.4, .04)):
        c.ell('Black brood ooze', (x, y, .045), (r, r * 1.6, r * .5), k.mass)


def pit_b(c, k, rng):
    """Spreading brood: tissue creeps over cracked plates, with egg clutches and a few veins."""
    pit_floor(c, k, k.armor)
    for j in range(9):
        x, y = rng.uniform(-.55, .55), rng.uniform(-.55, .55)
        lump(c, k.mass, x, y, .04, rng.uniform(.18, .3), rng.uniform(.14, .24), .05, rng)
    for (x, y) in ((-.45, .4), (.4, -.3)):
        for j in range(4):
            r = rng.uniform(.06, .09)
            lump(c, k.egg, x + rng.uniform(-.12, .12), y + rng.uniform(-.12, .12), .1, r, r * .9, r * .8, rng, 'Translucent brood egg')
    for j in range(3):
        a = rng.uniform(0, math.tau)
        pts = [(rng.uniform(-.2, .2), rng.uniform(-.2, .2), .09)]
        for s in range(3):
            a += rng.uniform(-.6, .6)
            pts.append((pts[-1][0] + .2 * math.cos(a), pts[-1][1] + .2 * math.sin(a), .085))
        tapered_tube(c, 'Void brood vein', pts, [.016, .014, .01, .004], k.vein, 6)


def pit_c(c, k, rng):
    """Blasted obsidian: cracked plates with a few uneven glowing fissures, black seep."""
    pit_floor(c, k, k.obsidian)
    for x0, y0, x1, y1 in ((-.7, -.5, .5, .2), (-.3, .6, .4, -.1), (.2, -.7, .7, -.3)):
        pts = []
        for s in range(6):
            t = s / 5
            pts.append((x0 + (x1 - x0) * t + rng.uniform(-.06, .06), y0 + (y1 - y0) * t + rng.uniform(-.06, .06), .045))
        tapered_tube(c, 'Black brood ooze', [(x, y, z - .03) for x, y, z in pts], [.05, .075, .085, .07, .05, .025], k.throat, 6)
        tapered_tube(c, 'Void crystal inlay', pts, [.02, .045, .055, .04, .028, .006], k.crystal, 6)
    for j in range(5):
        x, y = rng.uniform(-.6, .6), rng.uniform(-.6, .6)
        pts = [(rng.uniform(-.14, -.06), rng.uniform(-.1, -.04)), (rng.uniform(.06, .14), rng.uniform(-.1, -.04)),
               (rng.uniform(.04, .1), rng.uniform(.04, .1)), (rng.uniform(-.1, -.04), rng.uniform(.04, .1))]
        ob = centred_plate(c, 'Splintered obsidian', (x, y, .06), pts, .04, k.obsidian, .01)
        ob.rotation_euler = (rng.uniform(-.3, .3), rng.uniform(-.3, .3), rng.uniform(0, math.tau))


def pit_d(c, k, rng):
    """Drain grating over the brood basin; the violet fluid glows between the bars."""
    plate(c, 'Black brood ooze', (0, 0, -.02), [(-1.04, -1.04), (1.04, -1.04), (1.04, 1.04), (-1.04, 1.04)], .04, k.throat, .005)
    for i in range(4):
        c.ell('Brood pool glow', (rng.uniform(-.5, .5), rng.uniform(-.5, .5), .0), (.25, .18, .01), k.vein)
    lip = [(-.98, -.98), (.98, -.98), (.98, .98), (-.98, .98)]
    for i in range(4):
        a, b = lip[i], lip[(i + 1) % 4]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy); nx, ny = -dy / ln * .1, dx / ln * .1
        plate(c, 'Grating frame', (0, 0, .03), [a, b, (b[0] + nx, b[1] + ny), (a[0] + nx, a[1] + ny)], .05, k.metal, .01)
    for j in range(9):
        x = -.8 + j * .2
        plate(c, 'Grating bar', (0, 0, .04), [(x - .035, -.88), (x + .035, -.88), (x + .035, .88), (x - .035, .88)], .04, k.pipe, .008)
    for y in (-.45, .0, .45):
        plate(c, 'Grating cross bar', (0, 0, .065), [(-.88, y - .03), (.88, y - .03), (.88, y + .03), (-.88, y + .03)], .02, k.metal, .006)
    for x, y in ((-.3, .2), (.45, -.5)):
        lump(c, k.mass, x, y, .07, .1, .08, .03, rng)


PITS = {'a': pit_a, 'b': pit_b, 'c': pit_c, 'd': pit_d}
