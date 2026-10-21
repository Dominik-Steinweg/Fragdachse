"""Hostile void-tech portal generator on a 3 x 3 cell footprint (96 px, 30 px per BU).

`model.concept` selects the authored form family, `model.state` intact/damaged/rubble and
`model.outlet` the cardinal direction of the energy outlet (built north, then turned about the
fixed pivot so the shared key light stays world-fixed). Only violet energy parts emit; every
other surface is matte procedural Dawn wear without external images.
"""
import math
import random
import bpy
from mathutils import Vector
from dawn_parts import surface, root, finish, bolt, crown, tapered_tube
from enemy_parts_b import plate, tube
from turret_parts import annulus, cylinder_x

OUTLET_TURN = {'north': 0, 'west': math.pi / 2, 'south': math.pi, 'east': -math.pi / 2}
# Front of each concept's emitter (built north, BU): where the runtime portal feed leaves the asset.
OUTLET_POINT = {'a': (.08, 1.42), 'b': (0, 1.40), 'c': (-.06, 1.46)}
# VOID_PALETTE (src/config.ts): deep 0x6f16a8, primary 0xb347ff, bright 0xd98cff.
VOID_DEEP, VOID_PRIMARY, VOID_BRIGHT = (111, 22, 168), (179, 71, 255), (217, 140, 255)


def polygon(n, radius, phase=0.0, jitter=0.0, rng=None):
    pts = []
    for i in range(n):
        a = phase + math.tau * i / n
        r = radius * (1 + (rng.uniform(-jitter, jitter) if rng else 0))
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def rot(pts, a):
    ca, sa = math.cos(a), math.sin(a)
    return [(x * ca - y * sa, x * sa + y * ca) for x, y in pts]


def P(c, name, center, outline, thickness, material, bevel=.025):
    """A plate whose origin sits at its own centre, so tilts and the outlet turn stay local."""
    ob = plate(c, name, center, outline, thickness, material, bevel)
    verts = ob.data.vertices
    mid = sum((v.co for v in verts), Vector()) / len(verts)
    for v in verts: v.co -= mid
    ob.location = mid
    return ob


class Kit:
    """Named matte roles; emission only on void energy roles."""

    def __init__(self, c, spec, state):
        lib = spec['model'].get('librarySurfaces', {})
        self.c, self.state = c, state
        def m(name, rgb, wear=.3, emission=0):
            return surface(c, name, rgb, wear, emission, **lib.get(name, {}))
        dead = state == 'rubble'
        self.armor = m('Blackened void armor plate', (44, 42, 52), .34)
        self.iron = m('Charcoal forged iron', (63, 60, 66), .30)
        self.seam = m('Deep oiled recess', (17, 16, 22), 0)
        self.bronze = m('Oxidised dark bronze winding', (104, 74, 50), .40)
        self.insulator = m('Soot-stained ceramic insulator', (128, 120, 108), .36)
        self.rust = m('Old rust bleed', (98, 54, 34), .45)
        self.stone = m('Hand-hewn dark slate', (66, 64, 70), .42)
        self.obsidian = m('Void-glass obsidian', (34, 22, 46), .10)
        self.scorch = m('Soot and scorch crust', (28, 25, 26), .20)
        # Energy roles: the core reads saturated violet by day; emission drives the night pass.
        self.core = m('Void resonance core', VOID_PRIMARY, 0, .0 if dead else .6)
        self.glow = m('Void energy seam', VOID_BRIGHT, 0, .05 if dead else .8)
        self.flow = m('Void outlet flow', VOID_PRIMARY, 0, .0 if dead else .7)
        self.dim = m('Spent void crystal', VOID_DEEP, .1, .12 if dead else 0)
        if dead:
            # A collapsed generator carries no live energy anywhere, only spent residue.
            self.core = self.glow = self.flow = self.dim


def coil_drum(c, k, name, at, angle, z, radius=.22, length=.62, rings=7):
    """Horizontal winding drum seen from above: stripes read as a coil at 96 px."""
    grp = []
    drum = c.cylinder(name + ' core', (0, 0, 0), radius * .86, length, k.seam, 24)
    drum.rotation_euler.y = math.pi / 2; grp.append(drum)
    for j in range(rings):
        ring = annulus(c, 'Oxidised coil winding', (0, 0, 0), radius * 1.1, radius * .86, length / rings * .7, k.bronze, steps=32)
        ring.rotation_euler.y = math.pi / 2; ring.location.x = -length / 2 + (j + .5) * length / rings; grp.append(ring)
    for sgn in (-1, 1):
        cap = c.cylinder('Coil drum end flange', (sgn * (length / 2 + .03), 0, 0), radius * 1.22, .07, k.iron, 8)
        cap.rotation_euler.y = math.pi / 2; grp.append(cap)
    ins = c.cylinder('Ceramic insulator stack', (-length / 2 - .12, 0, .02), radius * .45, .16, k.insulator, 12)
    ins.rotation_euler.y = math.pi / 2; grp.append(ins)
    grp.append(c.ell('Coil emitter tip', (-length / 2 - .22, 0, .02), (.07, .07, .07), k.glow))
    grp.append(c.box('Coil drum saddle', (0, 0, -radius * .75), (length * .8, radius * 2.1, .10), k.iron, .03))
    g = bpy.data.objects.new(name, None); c.scene.collection.objects.link(g)
    for ob in grp: ob.parent = g
    g.location = (*at, z); g.rotation_euler.z = angle
    return g


def ragged(rng, cx, cy, radius, n=9, jitter=.35, phase=0.0):
    """Irregular torn outline around a centre, absolute XY."""
    return [(cx + radius * (1 + rng.uniform(-jitter, jitter)) * math.cos(phase + math.tau * i / n),
             cy + radius * (1 + rng.uniform(-jitter, jitter)) * math.sin(phase + math.tau * i / n)) for i in range(n)]


def octagon_radius(radius, t):
    """Edge distance of the plinth octagon (vertices at pi/8 + k*pi/4) in direction t."""
    return radius * math.cos(math.pi / 8) / math.cos((t + math.pi / 8) % (math.pi / 4) - math.pi / 8)


def sector(rng, inner, outer, a0, a1, steps=6, jitter=.06):
    """Annular plinth slab between two angles; the inner edge is broken, the outer edge octagonal."""
    ts = sorted({a0, a1, *[a0 + (a1 - a0) * i / steps for i in range(steps + 1)],
                 *[math.pi / 8 + k * math.pi / 4 for k in range(-8, 16) if a0 < math.pi / 8 + k * math.pi / 4 < a1]})
    pts = [(octagon_radius(outer, t) * math.cos(t), octagon_radius(outer, t) * math.sin(t)) for t in ts]
    for i in range(steps, -1, -1):
        r = inner * (1 + rng.uniform(-jitter * 3, jitter * 3))
        t = a0 + (a1 - a0) * i / steps
        pts.append((r * math.cos(t), r * math.sin(t)))
    return pts


def concept_a(c, k, rng, damaged, rubble):
    """Resonanzkessel: riveted octagon, caged core, two unequal coil drums, a capacitor bank, offset conduit.

    Damaged: torn deck, cracked core, a wrenched coil, ruptured conduit, burst capacitor.
    Rubble: split plinth slabs around an imploded crater, toppled coils, emitter knocked over.
    """
    if not rubble:
        base = P(c, 'Octagonal armored plinth', (0, 0, .10), polygon(8, 1.43, math.pi / 8, .025, rng), .20, k.armor, .05)
        P(c, 'Raised inner deck', (.02, -.03, .26), polygon(8, 1.06, math.pi / 8 + .05, .03, rng), .14, k.iron, .04)
    else:
        base = None
        cuts = [math.radians(v) for v in (8, 101, 188, 262, 368)]
        for i in range(4):
            a0, a1 = cuts[i] + .05, cuts[i + 1] - .05
            mid = (a0 + a1) / 2
            push = rng.uniform(.04, .10)
            slab = P(c, 'Split plinth slab', (push * math.cos(mid), push * math.sin(mid), .10), sector(rng, .52, 1.36, a0, a1), .20, k.armor, .04)
            slab.rotation_euler = (rng.uniform(-.10, .10), rng.uniform(-.10, .10), rng.uniform(-.05, .05))
            if i != 2:
                deck = P(c, 'Cracked deck fragment', (push * math.cos(mid), push * math.sin(mid), .25), sector(rng, .56, 1.0, a0 + .1, a1 - .1, 4, .1), .10, k.iron, .03)
                deck.rotation_euler = slab.rotation_euler.copy()
        c.cylinder('Exposed plinth bedding', (0, 0, .03), 1.30, .06, k.seam, 8)
    # Welded field repairs break the symmetry: a rusted corner patch and a long weld bead.
    P(c, 'Welded rust repair patch', (-.86, -.86, .215), [(-.42, -.10), (.10, -.44), (.36, -.18), (-.18, .30)], .03, k.rust, .01)
    if not rubble:
        tube(c, 'Rough weld bead', [(-1.05, -.40, .23), (-.70, -.78, .23), (-.36, -1.10, .23)], .022, k.iron, 6)
        for i in range(8):
            a = math.pi / 8 + math.tau * i / 8 + rng.uniform(-.06, .06)
            if i == 5 or (damaged and i == 1): continue
            bolt(c, 1.24 * math.cos(a), 1.24 * math.sin(a), .21, k.iron, .045)
        for i in (0, 2, 3, 6):
            a = math.tau * i / 8 + rng.uniform(-.1, .1)
            c.box('Plinth seam groove', (1.05 * math.cos(a), 1.05 * math.sin(a), .205), (.05, .36, .02), k.seam, .005).rotation_euler.z = a
        for j in range(4):
            c.box('Exhaust louvre', (.72 + j * .07, -.78 + j * .07, .36), (.05, .34, .05), k.seam, .01).rotation_euler.z = math.pi / 4
    if damaged and not rubble:
        # Torn deck on the north-east shoulder: a ragged hole, bent ribs and severed cable stubs.
        P(c, 'Torn deck breach', (0, 0, .336), ragged(rng, .66, .50, .25, 10, .30), .012, k.seam, .004)
        lip = P(c, 'Peeled armor lip', (0, 0, .36), [(.42, .70), (.80, .66), (.86, .74), (.48, .80)], .03, k.armor, .01)
        lip.rotation_euler.x = .25
        for dx in (-.08, .07):
            c.box('Bent internal rib', (.66 + dx, .50, .33), (.05, .38, .05), k.iron, .01).rotation_euler.z = .5 + dx * 3
        for a in (.4, 2.2):
            tube(c, 'Severed bronze cable', [(.66, .50, .33), (.66 + .14 * math.cos(a), .50 + .14 * math.sin(a), .36)], .022, k.bronze, 6)
    # Core well, core and cage.
    if not rubble:
        annulus(c, 'Core well rim', (0, 0, .40), .64, .45, .16, k.iron)
        c.cylinder('Core well throat', (0, 0, .30), .46, .08, k.seam, 40)
        c.ell('Resonance core', (0, 0, .40), (.33, .33, .26), k.core)
        annulus(c, 'Core energy halo seam', (0, 0, .485), .455, .43, .02, k.glow, 0, math.tau if not damaged else 4.6, 48)
        if damaged:
            for i in range(4):
                a = rng.uniform(0, math.tau)
                pts = [(0, -.018), (.30, -.008), (.31, .010), (0, .018)]
                P(c, 'Core fracture line', (0, 0, .655), rot(pts, a), .02, k.seam, .003)
    else:
        # Imploded crater: black throat, a broken rim and a ring of spent crystal shards.
        c.cylinder('Imploded core crater', (0, 0, .08), .56, .10, k.scorch, 24)
        for i in range(5):
            a0 = math.tau * i / 5 + rng.uniform(0, .3)
            rim = annulus(c, 'Broken core rim', (0, 0, .22), .64, .46, .12, k.iron, a0, a0 + rng.uniform(.5, .9), 8)
            rim.rotation_euler.x = rng.uniform(-.12, .12)
        for i in range(9):
            a = rng.uniform(0, math.tau)
            r = rng.uniform(.05, .38)
            shard = P(c, 'Spent core shard', (r * math.cos(a), r * math.sin(a), .16),
                      rot([(-.06, 0), (.06, 0), (0, rng.uniform(.14, .24))], rng.uniform(0, math.tau)), .06, k.dim, .008)
            shard.rotation_euler.x = rng.uniform(-.6, .6)
    for i, a in enumerate((math.radians(38), math.radians(152), math.radians(262), math.radians(318))):
        if (damaged and i == 1) or (rubble and i in (0, 2)): continue
        reach = .70 if i != 3 else .52
        pts = [(.36, -.075), (reach - .04, -.10), (reach, .10), (.38, .075), (.22, .03), (.22, -.03)]
        clamp = P(c, 'Hooked core clamp', (0, 0, .55 if not rubble else .28),
                  rot(pts, a + rng.uniform(-.08, .08) + (.5 if rubble else 0)), .075, k.armor, .02)
        if damaged: clamp.rotation_euler.x = rng.uniform(.4, .8) if rubble else rng.uniform(-.2, .2)
    # Two unequal coil drums west and south-south-west.
    west = coil_drum(c, k, 'Main coil drum', (-.98, .10), math.atan2(.10, -.98) - .10, .54, .25, .68, 8)
    south = coil_drum(c, k, 'Auxiliary coil drum', (-.22, -1.0), math.atan2(-1.0, -.22) + .08, .50, .19, .52, 6)
    if damaged and not rubble:
        # Wrenched off its saddle; two windings have sprung loose.
        west.rotation_euler.z += .34
        west.rotation_euler.x = .22
        west.location = (-.94, .20, .48)
        for j in range(2):
            pts = [(-1.10 + j * .10 + .06 * math.cos(t * 9), .40 + .16 * t + .06 * math.sin(t * 9), .46 - .04 * t) for t in [i / 8 for i in range(9)]]
            tube(c, 'Sprung coil winding', pts, .022, k.bronze, 6)
    if rubble:
        west.rotation_euler = (.55, .35, west.rotation_euler.z + .9)
        west.location = (-.86, .28, .30)
        south.rotation_euler = (-.45, .20, south.rotation_euler.z - .7)
        south.location = (-.30, -.90, .26)
        for j in range(5):
            a = rng.uniform(1.6, 4.4)
            r = rng.uniform(.75, 1.20)
            annulus(c, 'Scattered winding arc', (r * math.cos(a), r * math.sin(a), .22), .16, .12, .04, k.bronze, rng.uniform(0, 3), rng.uniform(3.5, 5.5), 12)
    # Capacitor bank east, cabled into the core rim.
    for n, (x, y, r) in enumerate(((1.02, .30, .17), (.98, -.18, .15), (.72, -.52, .12))):
        if rubble or (damaged and n == 1):
            P(c, 'Split capacitor shell', (x, y, .26), rot([(-.16, -.08), (.16, -.06), (.12, .10), (-.14, .09)], rng.uniform(0, 3)), .08, k.armor, .02)
            P(c, 'Capacitor burn crust', (x, y, .215), ragged(rng, 0, 0, .19, 8, .3), .01, k.scorch, .003)
            continue
        c.cylinder('Capacitor canister', (x, y, .40), r, .30, k.armor, 18)
        annulus(c, 'Capacitor clamp ring', (x, y, .45), r + .015, r - .02, .05, k.iron, steps=24)
        c.cylinder('Capacitor ceramic cap', (x, y, .56), r * .62, .05, k.insulator, 16)
        tube(c, 'Capacitor feed cable', [(x - r * .4, y, .58), ((x + .62) / 2, y * .7, .62), (.62, y * .35, .50)], .038, k.seam, 8)
    # Outlet: one heavy and one light conduit bending north-east into an offset emitter head.
    if not damaged:
        tube(c, 'Heavy armored conduit', [(.02, .46, .44), (.06, .78, .42), (.14, 1.04, .41)], .095, k.armor, 12)
        c.box('Conduit flow slot', (.12, .78, .535), (.03, .40, .02), k.flow, .004).rotation_euler.z = -.14
    elif not rubble:
        # Ruptured mid-span: two torn ends and a raw violet discharge between them.
        tube(c, 'Heavy armored conduit', [(.02, .46, .44), (.05, .70, .42)], .095, k.armor, 12)
        tube(c, 'Heavy armored conduit', [(.10, .88, .42), (.14, 1.04, .41)], .095, k.armor, 12)
        for y, x in ((.71, .05), (.87, .10)):
            end = annulus(c, 'Torn conduit end', (0, 0, 0), .105, .06, .05, k.iron, steps=16)
            end.rotation_euler.x = math.pi / 2
            end.location = (x, y, .42)
        c.ell('Conduit rupture discharge', (.075, .79, .44), (.06, .06, .04), k.flow)
        c.box('Conduit flow slot', (.13, .97, .535), (.03, .14, .02), k.flow, .004).rotation_euler.z = -.14
    else:
        for pts, w in (([(.00, .50, .22), (.06, .68, .20)], .09), ([(.24, .82, .18), (.40, .95, .16)], .09), ([(-.22, .50, .20), (-.30, .74, .16)], .06)):
            tube(c, 'Torn conduit piece', pts, w, k.armor, 10)
    if not rubble:
        tube(c, 'Light armored conduit', [(-.20, .44, .42), (-.12, .74, .40), (-.04, 1.04, .39)], .060, k.iron, 10)
        for y in (.66, .90):
            c.box('Conduit clamp band', (-.03 + y * .12, y, .45), (.48, .07, .12), k.iron, .02).rotation_euler.z = -.12
    hx = .08
    head = [c.box('Emitter head housing', (hx, 1.18, .42), (.64, .30, .24), k.armor, .05),
            c.box('Emitter head top plate', (hx - .06, 1.16, .55), (.40, .20, .04), k.iron, .02)]
    for sgn in (-1, 1):
        if damaged and sgn > 0 and not rubble:
            # The east prong is snapped and lies on the deck beside the head.
            snapped = P(c, 'Snapped emitter prong', (.56, 1.02, .34), rot([(-.06, -.10), (.06, -.10), (.04, .10), (-.03, .10)], .9), .10, k.iron, .02)
            snapped.rotation_euler.y = .3
            continue
        head.append(P(c, 'Emitter fork prong', (0, 0, .47),
                      [(hx + sgn * .17, 1.24), (hx + sgn * .30, 1.24), (hx + sgn * .27, 1.45), (hx + sgn * .20, 1.45)], .12, k.iron, .02))
    head.append(c.box('Emitter discharge slit', (hx, 1.34, .51), (.30, .06, .03), k.dim if rubble else k.flow, .006))
    if rubble:
        # Knocked over: the whole head lies tilted on its side, lower and further east.
        g = bpy.data.objects.new('Fallen emitter head', None)
        c.scene.collection.objects.link(g)
        g.location = (hx, 1.18, .42)
        for ob in head:
            ob.parent = g
            ob.location -= g.location
        g.location = (.34, 1.00, .22)
        g.rotation_euler = (0, 1.1, .5)
    return base


def concept_b(c, k, rng, damaged, rubble):
    """Leerenmonolith: hewn slate plinth, obsidian crystal heart, four iron-bound menhirs, carved spillway."""
    base = P(c, 'Hewn slate plinth', (0, 0, .09), polygon(7, 1.42, .2, .05, rng), .18, k.stone, .06)
    P(c, 'Stepped slate dais', (0, 0, .24), polygon(6, 1.02, .4, .06, rng), .14, k.stone, .05)
    annulus(c, 'Iron-bound core ring', (0, 0, .36), .58, .44, .12, k.iron, steps=40)
    c.cylinder('Fissure throat', (0, 0, .30), .45, .06, k.seam, 36)
    c.ell('Void fissure heart', (0, 0, .32), (.32, .32, .10), k.core if not rubble else k.dim)
    n = 7 if not rubble else 4
    for i in range(n):
        a = math.tau * i / 7 + rng.uniform(-.15, .15)
        r = .20 + rng.uniform(0, .10)
        h = rng.uniform(.30, .48) * (.5 if rubble else 1)
        pts = rot([(-.07, -.05), (.07, -.06), (.10, .14), (0, .30), (-.09, .12)], a - math.pi / 2)
        ob = P(c, 'Obsidian crystal prism', (r * math.cos(a), r * math.sin(a), .36 + h / 2), pts, h, k.obsidian, .015)
        ob.rotation_euler = (rng.uniform(-.3, .3), rng.uniform(-.3, .3), 0)
        if rubble: ob.rotation_euler.x += 1.1
    # Four menhir pylons on the diagonals, iron bands, violet emitter studs facing the heart.
    for i, a in enumerate((math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4)):
        x, y = 1.0 * math.cos(a), 1.0 * math.sin(a)
        if rubble and i % 2 == 0:
            ob = P(c, 'Toppled menhir slab', (x * 1.05, y * 1.05, .30),
                       rot([(-.14, -.34), (.15, -.30), (.13, .32), (-.12, .36)], a + 1.2), .20, k.stone, .03)
            continue
        h = .95 if not (damaged and i == 1) else .55
        pts = rot([(-.21, -.25), (.22, -.22), (.19, .27), (-.18, .25)], a + rng.uniform(-.2, .2))
        tube(c, 'Iron-sheathed feed cable', [(x * .80, y * .80, .34), (x * .66, y * .66, .40), (x * .56, y * .56, .40)], .045, k.iron, 8)
        slab = P(c, 'Iron-bound menhir pylon', (x, y, .30 + h / 2), pts, h, k.stone, .04)
        for z in (.45, .30 + h - .12):
            band = P(c, 'Rusted iron band', (x, y, z), [(px * 1.08, py * 1.08) for px, py in pts], .06, k.rust, .01)
        c.ell('Menhir emitter stud', (x * .82, y * .82, .30 + h - .05), (.06, .06, .05), k.glow)
    # Carved spillway north with flowing groove and cables.
    for s in (-1, 1):
        P(c, 'Carved spillway curb', (0, 0, .30), [(s * .12, .52), (s * .30, .52), (s * .30, 1.40), (s * .14, 1.40)], .14, k.stone, .03)
        tube(c, 'Bound power cable', [(s * .40, .45, .30), (s * .42, .85, .28), (s * .36, 1.30, .28)], .055, k.seam, 10)
    c.box('Spillway groove floor', (0, .96, .25), (.26, .90, .04), k.seam, .01)
    c.box('Spillway void flow', (0, .96, .275), (.12, .88, .02), k.flow, .005)
    c.box('Spillway lip stone', (0, 1.38, .32), (.70, .14, .14), k.stone, .03)
    return base


def concept_c(c, k, rng, damaged, rubble):
    """Spulenring: chamfered steel pad, segmented coil torus with radial spokes, three capacitors, emitter boom."""
    pad = [(1.42, -1.05), (1.42, 1.05), (1.05, 1.42), (-1.05, 1.42), (-1.42, 1.05), (-1.42, -1.05), (-1.05, -1.42), (1.05, -1.42)]
    base = P(c, 'Chamfered steel pad', (0, 0, .09), pad, .18, k.iron, .05)
    for x in (-1.15, 1.15):
        for y in (-1.15, 1.15):
            bolt(c, x * .92, y * .92, .19, k.armor, .05)
    seg = 12
    for i in range(seg):
        a0, a1 = math.tau * i / seg + .05, math.tau * (i + 1) / seg - .05
        if rubble and i % 3 == 0: continue
        z = .40 if not (damaged and i in (4, 5)) else .30
        if i in (2, 9) and not rubble:
            # Unarmored field: a bare stack of windings across the ring width.
            annulus(c, 'Ring winding bed', (0, 0, .30), 1.10, .86, .10, k.seam, a0, a1, 6)
            for j in range(6):
                t = a0 + (a1 - a0) * (j + .5) / 6
                ob = c.box('Bare ring winding', (.98 * math.cos(t), .98 * math.sin(t), .40), (.26, .045, .10), k.bronze, .015)
                ob.rotation_euler.z = t
            continue
        annulus(c, 'Armored ring segment', (0, 0, z), 1.12, .84, .22, k.rust if i == 7 else k.armor, a0, a1, 6)
        am = (a0 + a1) / 2 + math.pi / seg
        for j in range(3):
            ring = annulus(c, 'Exposed coil winding', (0, 0, 0), .15, .10, .03, k.bronze, steps=16)
            ring.rotation_euler = (math.pi / 2, 0, am + math.pi / 2)
            ring.location = (.98 * math.cos(am) + (j - 1) * .035 * -math.sin(am), .98 * math.sin(am) + (j - 1) * .035 * math.cos(am), .38)
    for a0, a1 in ((.25, 1.85), (2.35, 3.70), (4.15, 5.65)):
        annulus(c, 'Ring inner energy race arc', (0, 0, .52), .86, .83, .02, k.glow, a0, a1, 24)
    for i in range(4):
        a = math.pi / 4 + math.tau * i / 4
        if damaged and i == 2: continue
        c.box('Radial core spoke', (.58 * math.cos(a), .58 * math.sin(a), .52), (.58, .09, .09), k.iron, .02).rotation_euler.z = a
    c.ell('Suspended resonance core', (0, 0, .55), (.27, .27, .22) if not rubble else (.24, .24, .10), k.core if not rubble else k.dim)
    for i in range(3):
        cage = annulus(c, 'Core cage arc', (0, 0, 0), .33, .30, .04, k.iron, 0, math.pi, 24)
        cage.rotation_euler = (math.pi / 2, 0, math.tau * i / 3)
        cage.location = (0, 0, .50 if not rubble else .30)
    c.box('Finned transformer block', (-1.02, -1.02, .34), (.46, .40, .32), k.armor, .04).rotation_euler.z = math.pi / 4
    for j in range(4):
        c.box('Transformer cooling fin', (-1.02 + (j - 1.5) * .08, -1.02 - (j - 1.5) * .08, .52), (.05, .40, .05), k.iron, .01).rotation_euler.z = math.pi / 4
    tube(c, 'Transformer bus cable', [(-.86, -.86, .50), (-.78, -.70, .52), (-.70, -.66, .44)], .05, k.seam, 8)
    for a in (math.radians(318), math.radians(146)):
        x, y = 1.18 * math.cos(a), 1.18 * math.sin(a)
        c.cylinder('Capacitor canister', (x, y, .32), .17, .30, k.armor, 16)
        c.cylinder('Capacitor ceramic cap', (x, y, .48), .12, .04, k.insulator, 16)
        tube(c, 'Capacitor feed cable', [(x, y, .44), (x * .85, y * .85, .46), (x * .74, y * .74, .42)], .04, k.seam, 8)
    # Boom north: heavy two-segment arm and a lens head.
    c.box('Boom root block', (-.06, .98, .50), (.44, .30, .22), k.armor, .04)
    c.box('Boom arm', (-.06, 1.18, .55), (.22, .42, .14), k.iron, .03)
    c.box('Boom flow slot', (-.06, 1.18, .63), (.06, .38, .02), k.flow, .005)
    tube(c, 'Boom feed cable', [(.30, .80, .44), (.22, 1.04, .50), (.08, 1.22, .56)], .045, k.seam, 8)
    head_z = .55 if not rubble else .25
    c.box('Lens head shroud', (-.06, 1.36, head_z), (.48, .20, .24), k.armor, .05)
    c.box('Emitter lens slot', (-.06, 1.44, head_z + .04), (.32, .05, .12), k.flow, .01)
    return base


BUILDERS = {'a': concept_a, 'b': concept_b, 'c': concept_c}


def debris(c, k, rng, rubble):
    """Shared wreck layer: scattered plate shards, scorch crust and violet crystal splinters."""
    count = 16 if rubble else 6
    for i in range(count):
        a = rng.uniform(0, math.tau); r = rng.uniform(.4, 1.30)
        x, y = r * math.cos(a), r * math.sin(a)
        if abs(x) > 1.35 or abs(y) > 1.35: continue
        s = rng.uniform(.10, .22) * (1.3 if rubble else 1)
        pts = rot([(-s, -s * .5), (s * .9, -s * .6), (s * .6, s * .7), (-s * .7, s * .4)], rng.uniform(0, math.tau))
        ob = P(c, 'Torn plate shard', (x, y, .24 + rng.uniform(0, .10)), pts, .035, k.armor if i % 3 else k.iron, .01)
        ob.rotation_euler = (rng.uniform(-.4, .4), rng.uniform(-.4, .4), 0)
    for i in range(5 if rubble else 2):
        a = rng.uniform(0, math.tau); r = rng.uniform(.1, .9)
        pts = rot([(-.20, -.12), (.22, -.10), (.18, .14), (-.16, .16)], rng.uniform(0, math.tau))
        P(c, 'Scorch crust patch', (r * math.cos(a), r * math.sin(a), .20 if rubble else .36), pts, .01, k.scorch, .004)
    for i in range(6 if rubble else 3):
        a = rng.uniform(0, math.tau); r = rng.uniform(.15, .75)
        pts = rot([(-.03, 0), (.03, 0), (0, .16)], rng.uniform(0, math.tau))
        P(c, 'Void crystal splinter', (r * math.cos(a), r * math.sin(a), .30), pts, .04, k.dim if rubble else k.glow, .005)


def build(c, spec):
    model = spec['model']
    concept, state, outlet = model.get('concept', 'a'), model.get('state', 'intact'), model.get('outlet', 'north')
    if concept not in BUILDERS or state not in ('intact', 'damaged', 'rubble') or outlet not in OUTLET_TURN:
        raise ValueError(f'Unknown portal generator model: {concept}/{state}/{outlet}')
    rng = random.Random(f'portal-generator-{concept}-{state}')
    pivot = root(c)
    k = Kit(c, spec, state)
    damaged, rubble = state != 'intact', state == 'rubble'
    BUILDERS[concept](c, k, rng, damaged, rubble)
    if damaged: debris(c, k, rng, rubble)
    if rubble:
        # Collapse: everything sinks toward the plinth and loses height, footprint stays readable.
        for ob in c.scene.objects:
            if ob.type in ('MESH', 'EMPTY') and ob.parent is None and ob is not pivot:
                ob.location.z *= .62
                ob.scale.z *= .7
    turn = OUTLET_TURN[outlet]
    if turn:
        for ob in c.scene.objects:
            if ob.parent is None and ob is not pivot and ob.type in ('MESH', 'EMPTY'):
                x, y = ob.location.x, ob.location.y
                ob.location.x = x * math.cos(turn) - y * math.sin(turn)
                ob.location.y = x * math.sin(turn) + y * math.cos(turn)
                ob.rotation_euler.z += turn
    outlet_socket = bpy.data.objects.new('Portal outlet socket', None); c.scene.collection.objects.link(outlet_socket)
    ox, oy = OUTLET_POINT[concept]
    outlet_socket.location = (ox * math.cos(turn) - oy * math.sin(turn), ox * math.sin(turn) + oy * math.cos(turn), .45)
    core_socket = bpy.data.objects.new('Resonance core socket', None); c.scene.collection.objects.link(core_socket)
    core_socket.location = (0, 0, .5)
    result = finish(c, pivot, {'energy': [k.core, k.glow, k.flow]})
    outlet_socket.parent = pivot; core_socket.parent = pivot
    result['sockets'] = {'outlet': outlet_socket, 'core': core_socket}
    return result
