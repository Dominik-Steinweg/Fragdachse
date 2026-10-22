"""Hostile spawn structure (GDD Spawnbauwerk V1): a dark armoured U around a brood pit.

One Blender unit is one 32 px world cell. The pivot is the centre of the 2 x 2 brood pit, so the
building and the separate pit asset share one anchor in every orientation. Built opening south
(-Y), then turned about the pivot so the shared key light stays world-fixed:

    y  2 ┌───────────────┐   back wall, brood heart in the middle
       1 │   ┌───────┐   │
         │arm│  pit  │arm│   arms, veins run toward the pit
      -1 └───┘       └───┘
        -2  -1   0   1   2 x

The body speaks the hostile base's language (base47blob_hostile): one continuous near-black armour
slab with plated cells, a raised grey frame along every edge of the U and dashed violet light strips
just inside it, so the hitbox outline glows like an enemy base. Everything stays inside |x|,|y| <=
1.97 on the cell grid. Rough void brood grows along the wall centrelines, inside the strips.
Emissive passes: `rim` (light strips), `veins` (brood veins), `core` (brood heart).
`model.state` is intact/damaged/rubble and `model.outlet` the side the pit opens to.
"""
import math
import random
import bpy
from dawn_parts import surface, root, finish, tapered_tube
from enemy_parts_b import plate
from spawn_structure_concepts import BUILDINGS, ConceptKit
import spawn_structure_concepts2 as second_round

OUTLET_TURN = {'south': 0.0, 'east': math.pi / 2, 'north': math.pi, 'west': -math.pi / 2}
# VOID_PALETTE (src/config.ts): deep 0x6f16a8, primary 0xb347ff, bright 0xd98cff.
VOID_DEEP, VOID_PRIMARY, VOID_BRIGHT = (111, 22, 168), (179, 71, 255), (217, 140, 255)
WALL_CELLS = [(-1.5, 1.5), (-.5, 1.5), (.5, 1.5), (1.5, 1.5), (-1.5, .5), (-1.5, -.5), (1.5, .5), (1.5, -.5)]
# The U on the cell grid, counter-clockwise (interior on the left of every edge).
OUTLINE = [(-2, -1), (-1, -1), (-1, 1), (1, 1), (1, -1), (2, -1), (2, 2), (-2, 2)]
MARGIN = .03         # 1 px inside the hitbox cells
TOP = .3             # armour slab height


def centred_plate(c, name, center, outline, thickness, material, bevel=.025):
    """A plate whose origin sits at its own centre, so its tilt and turn stay local."""
    ob = plate(c, name, (0, 0, 0), outline, thickness, material, bevel)
    ob.location = center
    return ob


def damp(mat, roughness=.5):
    """Broken damp sheen for the brood mass, never hard plastic glints."""
    n, l = mat.node_tree.nodes, mat.node_tree.links
    bs = n['Principled BSDF']
    bs.inputs['Specular IOR Level'].default_value = .2
    bs.inputs['Coat Weight'].default_value = .1
    bs.inputs['Coat Roughness'].default_value = .38
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 15
    ramp = n.new('ShaderNodeMapRange')
    ramp.inputs['To Min'].default_value = roughness - .12; ramp.inputs['To Max'].default_value = roughness + .14
    l.new(noise.outputs['Fac'], ramp.inputs['Value']); l.new(ramp.outputs['Result'], bs.inputs['Roughness'])
    return mat


class Kit:
    """Named matte roles; emission only on the rim strips, the veins and the heart."""

    def __init__(self, c, spec, state):
        lib = spec['model'].get('librarySurfaces', {})
        def m(name, rgb, wear=.3, emission=0):
            return surface(c, name, rgb, wear, emission, **lib.get(name, {}))
        dead = state == 'rubble'
        self.armor = m('Blackened void armour', (31, 30, 35), .22)
        self.panel = m('Void armour plate', (38, 37, 43), .2)
        self.frame = m('Grey armour frame', (78, 76, 84), .3)
        self.seam = m('Deep armour seam', (12, 11, 15), 0)
        self.node = m('Dark frame node', (22, 21, 26), .1)
        self.mass = damp(m('Void brood mass', (40, 18, 52), .12))
        self.fold = damp(m('Bruised brood fold', (66, 28, 82), .1), .46)
        self.egg = damp(m('Translucent brood egg', (70, 36, 88), .08), .4)
        self.husk = m('Dried brood husk', (40, 30, 40), .3)
        self.throat = m('Opaque brood throat', (12, 6, 18), 0)
        self.chitin = m('Dark chitin hook', (74, 66, 76), .3)
        self.scorch = m('Soot and scorch crust', (24, 22, 24), .2)
        # Energy roles: the strips read violet by day like the enemy base; the night carries all three.
        self.rim = m('Void rim seam', VOID_PRIMARY, 0, .0 if dead else .9)
        self.vein = m('Void brood vein', (100, 34, 140), 0, .0 if dead else .3)
        self.heart = m('Void brood heart', VOID_PRIMARY, 0, .0 if dead else .8)
        self.spent = m('Spent void residue', VOID_DEEP, .1, .1 if dead else 0)
        if dead:
            self.rim = self.vein = self.heart = self.spent


def turned(x, y, a):
    return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)


def edges():
    """Every edge of the U with its start, unit direction, inward normal and length in cells."""
    for a, b in zip(OUTLINE, OUTLINE[1:] + OUTLINE[:1]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        d = (dx / length, dy / length)
        yield a, d, (-d[1], d[0]), int(round(length))


def strip(c, name, a, d, n, t0, t1, off0, off1, z, thickness, material, bevel=.008):
    """A strip along one edge, from t0 to t1 cells, between off0 and off1 inward from the edge."""
    pts = [(a[0] + d[0] * t + n[0] * o, a[1] + d[1] * t + n[1] * o) for t, o in ((t0, off0), (t1, off0), (t1, off1), (t0, off1))]
    return plate(c, name, (0, 0, z), pts, thickness, material, bevel)


def inset_outline(offset):
    """The U outline moved inward by `offset`, mitred at every corner."""
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


def armour_body(c, k, rng, damaged, rubble):
    """One continuous near-black slab; plated cells with chamfered corners like the base tiles."""
    if rubble:
        for x, y in WALL_CELLS:
            h = TOP * rng.uniform(.35, .55)
            s = rng.uniform(.38, .46)
            pts = [(-s + rng.uniform(0, .12), -s), (s - rng.uniform(0, .12), -s), (s, s - rng.uniform(0, .12)), (-s, s)]
            ob = centred_plate(c, 'Collapsed armour slab', (x + rng.uniform(-.04, .04), y + rng.uniform(-.04, .04), h / 2),
                               pts, h, k.armor, .03)
            ob.rotation_euler = (rng.uniform(-.12, .12), rng.uniform(-.12, .12), rng.uniform(-.25, .25))
        plate(c, 'Exposed armour bed', (0, 0, .02), inset_outline(MARGIN), .04, k.seam, .01)
        return
    plate(c, 'Blackened void armour', (0, 0, TOP / 2), inset_outline(MARGIN), TOP, k.armor, .04)
    for x, y in WALL_CELLS:
        s, ch = .34, .1
        pts = [(-s + ch, -s), (s - ch, -s), (s, -s + ch), (s, s - ch), (s - ch, s), (-s + ch, s), (-s, s - ch), (-s, -s + ch)]
        if damaged and rng.random() < .3:
            pts = [(px + rng.uniform(-.06, .06), py + rng.uniform(-.06, .06)) for px, py in pts]
        plate(c, 'Void armour plate', (0, 0, TOP + .015), [(x + px, y + py) for px, py in pts], .03, k.panel, .012)
    if damaged:
        for i in range(5):
            x, y = rng.choice(WALL_CELLS)
            plate(c, 'Scorch crust patch', (0, 0, TOP + .035),
                  [(x + px * .22, y + py * .16) for px, py in ((-1, -1), (1.1, -.8), (.9, 1), (-.8, .9))], .01, k.scorch, .004)


def rim(c, k, rng, damaged, rubble):
    """Raised grey frame on every edge and dashed violet light strips just inside it (base style)."""
    if rubble:
        for a, d, n, length in edges():
            for cell in range(length):
                if rng.random() < .5:
                    strip(c, 'Broken frame bar', a, d, n, cell + .1, cell + rng.uniform(.4, .8), MARGIN, MARGIN + .07,
                          TOP * .45, .05, k.frame)
        return
    for a, d, n, length in edges():
        strip(c, 'Grey armour frame', a, d, n, 0, length, MARGIN, MARGIN + .065, TOP + .025, .05, k.frame, .012)
        for cell in range(length):
            # Damaged walls lose some strips; the remaining ones keep the hitbox outline legible.
            if not (damaged and rng.random() < .22):
                strip(c, 'Void rim seam', a, d, n, cell + .2, cell + .8, MARGIN + .085, MARGIN + .13, TOP + .02, .03, k.rim, .006)
            if cell == 0: continue
            node = c.cylinder('Dark frame node', (0, 0, 0), .045, .05, k.node, 8)
            node.location = (a[0] + d[0] * cell + n[0] * (MARGIN + .107), a[1] + d[1] * cell + n[1] * (MARGIN + .107), TOP + .03)
    # Corner nodes sit on the mitred inner corner of the strips, never outside the hitbox.
    for x, y in inset_outline(MARGIN + .107):
        node = c.cylinder('Dark frame node', (0, 0, 0), .05, .05, k.node, 8)
        node.location = (x, y, TOP + .03)


def lump(c, mat, x, y, z, sx, sy, sz, rng, name='Void brood lump', angle=None):
    """Organic lump; round ones turn freely, elongated ones keep their authored `angle`."""
    ob = c.ell(name, (x, y, z), (sx, sy, sz), mat)
    ob.rotation_euler.z = rng.uniform(0, math.pi) if angle is None else angle
    phase = rng.uniform(0, math.tau)
    for v in ob.data.vertices:
        v.co.z *= 1 + .16 * math.sin(v.co.x * 9 + v.co.y * 5 + phase)
    return ob


def brood_mass(c, k, rng, damaged):
    """Rough void brood along the wall centrelines, always inside the light strips."""
    top = TOP + .04
    for i in range(13):
        x = -1.5 + i * 3.0 / 12 + rng.uniform(-.03, .03)
        size = 1.0 - .15 * abs(x) / 1.5
        lump(c, k.mass, x, 1.5 + rng.uniform(-.05, .05), top + .04, .22 * size, .23 * size, .17 * size, rng)
    for side in (-1, 1):
        for i in range(6):
            size = 1.0 - i * .1
            lump(c, k.mass, side * (1.5 + rng.uniform(-.04, .04)), 1.1 - i * .3, top + .02, .21 * size, .21 * size, .14 * size, rng)
    for side in (-1, 1):
        pts = [(side * .5, 1.62, top + .17), (side * 1.3, 1.62, top + .19), (side * 1.58, 1.0, top + .14),
               (side * 1.55, .1, top + .11), (side * 1.48, -.5, top + .05)]
        tapered_tube(c, 'Bruised brood fold', pts, [.045, .06, .05, .04, .012], k.fold, 10)
    for side in (-1, 1):
        for (dx, dy, r) in ((0, 0, .13), (.17, -.1, .1), (-.05, -.21, .085)):
            lump(c, k.egg, side * (1.55 - dx), 1.56 + dy, top + .2, r, r * .92, r * .8, rng, 'Translucent brood egg')
    if damaged:
        for i in range(4):
            x, y = rng.uniform(-1.4, 1.4), rng.uniform(1.35, 1.65)
            plate(c, 'Torn brood wound', (x, y, top + .26), [(-.1, -.06), (.11, -.05), (.09, .07), (-.08, .06)], .02, k.scorch, .005)


def veins(c, k, rng, damaged):
    """Fine glowing veins in the brood run from the heart along both arms toward the pit."""
    top = TOP + .04
    routes = []
    for side in (-1, 1):
        routes.append([(side * .3, 1.4, top + .28), (side * .9, 1.48, top + .24), (side * 1.4, 1.36, top + .22),
                       (side * 1.52, .7, top + .17), (side * 1.47, .05, top + .13), (side * 1.4, -.5, top + .08)])
    for i, pts in enumerate(routes):
        if damaged and i == 0: pts = pts[:4]
        radii = [.018 - .01 * j / (len(pts) - 1) for j in range(len(pts))]
        tapered_tube(c, 'Void brood vein', pts, radii, k.vein, 8)


def heart(c, k, rng, damaged, rubble):
    """Brood heart on the back wall: a sac under two dark chitin ribs, split by a glowing seam."""
    top = TOP + .04
    if rubble:
        lump(c, k.husk, 0, 1.48, top - .02, .4, .26, .06, rng, 'Collapsed brood husk', 0.0)
        c.ell('Spent heart residue', (0, 1.46, top + .02), (.05, .16, .03), k.spent)
        return
    lump(c, k.fold, 0, 1.5, top + .12, .36, .3, .26, rng, 'Brood heart sac', 0.0)
    seam = .22 if not damaged else .13
    c.ell('Brood heart seam shadow', (0, 1.47, top + .33), (.065, seam + .03, .06), k.throat)
    c.ell('Brood heart slit', (0, 1.46, top + .37), (.035, seam, .05), k.heart)
    for side in (-1, 1):
        pts = [(side * .26, 1.78, top + .08), (side * .31, 1.64, top + .33), (side * .29, 1.42, top + .38),
               (side * .22, 1.24, top + .25), (side * .16, 1.2, top + .1)]
        tapered_tube(c, 'Heart clasp rib', pts, [.045, .042, .036, .024, .006], k.chitin, 9)


def hooks(c, k, rng, damaged):
    """Short chitin hooks on the arm tips curl toward the opening, inside the light strips."""
    top = TOP + .04
    for side in (-1, 1):
        if damaged and side == 1: continue
        pts = [(side * 1.55, -.3, top + .04), (side * 1.52, -.52, top + .2), (side * 1.4, -.64, top + .26), (side * 1.27, -.62, top + .22)]
        tapered_tube(c, 'Dark chitin hook', pts, [.075, .06, .035, .004], k.chitin, 9)


def rubble_spill(c, k, rng):
    for i in range(10):
        cell = rng.choice(WALL_CELLS)
        x, y = cell[0] + rng.uniform(-.3, .3), cell[1] + rng.uniform(-.3, .3)
        pts = [(rng.uniform(-.1, -.05), rng.uniform(-.09, -.04)), (rng.uniform(.05, .1), rng.uniform(-.09, -.04)),
               (rng.uniform(.04, .09), rng.uniform(.04, .1)), (rng.uniform(-.09, -.04), rng.uniform(.04, .09))]
        ob = centred_plate(c, 'Broken armour chunk', (x, y, .2), pts, rng.uniform(.06, .1), k.panel, .015)
        ob.rotation_euler = (rng.uniform(-.4, .4), rng.uniform(-.4, .4), rng.uniform(0, math.tau))
    # Spent brood lies in flat, torn patches on the slabs, never as whole bodies.
    for x, y in WALL_CELLS:
        if rng.random() < .4: continue
        lump(c, k.husk, x + rng.uniform(-.12, .12), y + rng.uniform(-.12, .12), .2, rng.uniform(.12, .2), rng.uniform(.1, .16), .025, rng,
             'Deflated brood husk')


def build(c, spec):
    model = spec['model']
    state, outlet = model.get('state', 'intact'), model.get('outlet', 'south')
    if state not in ('intact', 'damaged', 'rubble') or outlet not in OUTLET_TURN:
        raise ValueError(f'Unknown spawn structure model: {state}/{outlet}')
    rng = random.Random(f'spawn-structure-{state}')
    pivot = root(c)
    concept = model.get('concept', 'armour')
    if concept in second_round.BUILDINGS:
        second_round.BUILDINGS[concept](c, second_round.ConceptKit2(c, spec), random.Random(f'spawn-structure-concept-{concept}'))
    elif concept in BUILDINGS:
        # Design drafts for the user's choice (intact only); see spawn_structure_concepts.py.
        BUILDINGS[concept](c, ConceptKit(c, spec), random.Random(f'spawn-structure-concept-{concept}'))
    else:
        k = Kit(c, spec, state)
        damaged, rubble = state != 'intact', state == 'rubble'
        armour_body(c, k, rng, damaged, rubble)
        rim(c, k, rng, damaged, rubble)
        if not rubble:
            brood_mass(c, k, rng, damaged)
            veins(c, k, rng, damaged)
            hooks(c, k, rng, damaged)
        else:
            rubble_spill(c, k, rng)
        heart(c, k, rng, damaged, rubble)
    turn = OUTLET_TURN[outlet]
    if turn:
        for ob in c.scene.objects:
            if ob.parent is None and ob is not pivot and ob.type in ('MESH', 'EMPTY'):
                ob.location.x, ob.location.y = turned(ob.location.x, ob.location.y, turn)
                ob.rotation_euler.z += turn
    mouth = bpy.data.objects.new('Spawn structure mouth socket', None); c.scene.collection.objects.link(mouth)
    mouth.location = (*turned(0, -1.0, turn), .05)
    core = bpy.data.objects.new('Brood heart socket', None); c.scene.collection.objects.link(core)
    core.location = (*turned(0, 1.46, turn), TOP + .41)
    result = finish(c, pivot)
    mouth.parent = pivot; core.parent = pivot
    result['sockets'] = {'mouth': mouth, 'core': core}
    return result
