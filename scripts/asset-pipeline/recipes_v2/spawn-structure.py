"""Hostile spawn structure (GDD Spawnbauwerk V1): a U of eight heavy stone blocks around a brood pit.

One Blender unit is one 32 px world cell. The pivot is the centre of the 2 x 2 brood pit, so the
building and the separate pit asset share one anchor in every orientation. Built opening south
(-Y), then turned about the pivot so the shared key light stays world-fixed:

    y  2 ┌───┬───┬───┬───┐   back wall (4 blocks), brood heart in the middle
       1 ├───┼───┴───┼───┤
         │arm│  pit  │arm│   arms (2 blocks each), veins run toward the pit
      -1 └───┘       └───┘
        -2  -1   0   1   2 x

Only the eight wall cells carry geometry, all of it inside |x|,|y| <= 1.97 on the cell grid: a dark
mortar bed closes the joints, the outer and inner plinth edges stay hard and visible so the hitbox
reads at 128 px. The void brood mass sits on top of the blocks with a stone rim left free, never on
the pit. Only the veins and the heart emit (congruent passes `veins` and `core`).
`model.state` is intact/damaged/rubble and `model.outlet` the side the pit opens to.
"""
import math
import random
import bpy
from dawn_parts import surface, root, finish, bolt, tapered_tube
from enemy_parts_b import plate


def centred_plate(c, name, center, outline, thickness, material, bevel=.025):
    """A plate whose origin sits at its own centre, so its tilt and turn stay local."""
    ob = plate(c, name, (0, 0, 0), outline, thickness, material, bevel)
    ob.location = center
    return ob

OUTLET_TURN = {'south': 0.0, 'east': math.pi / 2, 'north': math.pi, 'west': -math.pi / 2}
# VOID_PALETTE (src/config.ts): deep 0x6f16a8, primary 0xb347ff, bright 0xd98cff.
VOID_DEEP, VOID_PRIMARY, VOID_BRIGHT = (111, 22, 168), (179, 71, 255), (217, 140, 255)
# Wall cells (centre x, y) of the south-opening U.
WALL_CELLS = [(-1.5, 1.5), (-.5, 1.5), (.5, 1.5), (1.5, 1.5), (-1.5, .5), (-1.5, -.5), (1.5, .5), (1.5, -.5)]
EDGE = 1.97          # every part stays inside the hitbox cells (|x|,|y| <= 2), 1 px margin
BLOCK = .93
BLOCK_HEIGHT = .34
TOP = BLOCK_HEIGHT + .05
# Outline of the U mortar bed (south opening), slightly inset from the cell grid.
U_OUTLINE = [(-EDGE, -.97), (-EDGE, EDGE), (EDGE, EDGE), (EDGE, -.97), (1.03, -.97), (1.03, .97), (-1.03, .97), (-1.03, -.97)]


def damp(mat, roughness=.5):
    """Broken damp sheen for the brood mass, never hard plastic glints."""
    n, l = mat.node_tree.nodes, mat.node_tree.links
    bs = n['Principled BSDF']
    bs.inputs['Specular IOR Level'].default_value = .2
    bs.inputs['Coat Weight'].default_value = .08
    bs.inputs['Coat Roughness'].default_value = .42
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 15
    ramp = n.new('ShaderNodeMapRange')
    ramp.inputs['To Min'].default_value = roughness - .12; ramp.inputs['To Max'].default_value = roughness + .14
    l.new(noise.outputs['Fac'], ramp.inputs['Value']); l.new(ramp.outputs['Result'], bs.inputs['Roughness'])
    return mat


class Kit:
    """Named matte roles; emission only on the void vein and heart roles."""

    def __init__(self, c, spec, state):
        lib = spec['model'].get('librarySurfaces', {})
        def m(name, rgb, wear=.3, emission=0):
            return surface(c, name, rgb, wear, emission, **lib.get(name, {}))
        dead = state == 'rubble'
        self.stone = m('Weathered dark masonry block', (74, 72, 78), .42)
        self.stone_alt = m('Soot-darkened masonry block', (60, 58, 64), .40)
        self.stone_top = m('Worn block cap stone', (88, 85, 88), .36)
        self.joint = m('Deep mortar joint', (20, 18, 24), 0)
        self.iron = m('Blackened binding iron', (48, 45, 52), .34)
        self.rust = m('Old rust bleed', (98, 54, 34), .45)
        self.mass = damp(m('Void brood mass', (60, 22, 80), .14))
        self.fold = damp(m('Bruised brood fold', (84, 34, 96), .12), .46)
        self.egg = damp(m('Translucent brood egg', (118, 64, 132), .1), .4)
        self.husk = m('Dried brood husk', (44, 34, 42), .30)
        self.throat = m('Opaque brood throat', (14, 8, 20), 0)
        self.bone = m('Weathered chitin tusk', (158, 146, 122), .34)
        self.scorch = m('Soot and scorch crust', (28, 25, 26), .20)
        # Energy roles: deep violet by day so they never read as neon; emission drives the night passes.
        self.vein = m('Void brood vein', (140, 50, 200), 0, .0 if dead else .4)
        self.heart = m('Void brood heart', VOID_PRIMARY, 0, .0 if dead else .8)
        self.spent = m('Spent void residue', VOID_DEEP, .1, .1 if dead else 0)
        if dead:
            self.vein = self.heart = self.spent


def turned(x, y, a):
    return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)


def mortar_bed(c, k, rubble):
    """Dark bed under the blocks: joints read as mortar and the U silhouette stays closed."""
    plate(c, 'Mortar bed', (0, 0, .03), U_OUTLINE, .06, k.joint, .01)
    if rubble:
        plate(c, 'Exposed bed rubble', (0, 0, .07), [(x * .97, y * .97) for x, y in U_OUTLINE], .02, k.scorch, .005)


def stone_block(c, k, rng, x, y, damaged, rubble):
    """One heavy cell block: hewn sides, a worn cap and chipped corners when damaged."""
    h = BLOCK_HEIGHT * rng.uniform(.93, 1.05) * (.5 if rubble else 1)
    s = BLOCK * (rng.uniform(.82, .92) if rubble else 1)
    chip = (lambda: rng.uniform(.06, .2)) if damaged else (lambda: rng.uniform(.01, .05))
    half = s / 2
    outline = [(-half + chip(), -half), (half - chip(), -half), (half, -half + chip()), (half, half - chip()),
               (half - chip(), half), (-half + chip(), half), (-half, half - chip()), (-half, -half + chip())]
    material = k.stone if rng.random() < .6 else k.stone_alt
    block = plate(c, 'Weathered masonry block', (0, 0, h / 2 + .04), outline, h, material, .06)
    cap = plate(c, 'Worn block cap stone', (0, 0, h + .06), [(px * .86, py * .86) for px, py in outline], .05, k.stone_top, .035)
    g = bpy.data.objects.new('Masonry cell', None); c.scene.collection.objects.link(g)
    for ob in (block, cap): ob.parent = g
    g.location = (x + (rng.uniform(-.04, .04) if rubble else 0), y + (rng.uniform(-.04, .04) if rubble else 0), 0)
    g.rotation_euler = ((rng.uniform(-.14, .14), rng.uniform(-.14, .14), rng.uniform(-.2, .2)) if rubble
                        else (0, 0, rng.uniform(-.012, .012)))


def binding_iron(c, k, rng, damaged):
    """Riveted iron bands on the outer plinth faces: the hitbox border reads as a built edge."""
    inset = EDGE - .035
    runs = [((-inset, inset), (inset, inset)), ((-inset, inset), (-inset, -.95)), ((inset, inset), (inset, -.95))]
    for i, ((x0, y0), (x1, y1)) in enumerate(runs):
        length = math.hypot(x1 - x0, y1 - y0)
        steps = max(2, round(length / .5))
        for j in range(steps):
            if damaged and i == 2 and j in (1, 2): continue
            t0, t1 = j / steps + .015, (j + 1) / steps - .015
            a = (x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0); b = (x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1)
            dx, dy = b[0] - a[0], b[1] - a[1]; ln = math.hypot(dx, dy); nx, ny = -dy / ln * .03, dx / ln * .03
            plate(c, 'Binding iron band', (0, 0, BLOCK_HEIGHT * .55),
                  [(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)], .09, k.iron, .01)
            bolt(c, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, BLOCK_HEIGHT * .55 + .05, k.rust if rng.random() < .3 else k.iron, .028)


def lump(c, mat, x, y, z, sx, sy, sz, rng, name='Void brood lump', angle=None):
    """Organic lump; round ones turn freely, elongated ones keep their authored `angle`."""
    ob = c.ell(name, (x, y, z), (sx, sy, sz), mat)
    ob.rotation_euler.z = rng.uniform(0, math.pi) if angle is None else angle
    phase = rng.uniform(0, math.tau)
    for v in ob.data.vertices:
        v.co.z *= 1 + .16 * math.sin(v.co.x * 9 + v.co.y * 5 + phase)
    return ob


def brood_mass(c, k, rng, damaged):
    """One cohesive overgrowth: a ridge on the back wall that flows down both arms and thins out.

    A stone rim of ~.15 BU stays free on the outer and inner faces, so the hard plinth edge carries
    the hitbox outline and the soft mass reads as growth on the building.
    """
    for i in range(15):
        x = -1.62 + i * 3.24 / 14 + rng.uniform(-.04, .04)
        size = 1.0 - .18 * abs(x) / 1.6
        lump(c, k.mass, x, 1.5 + rng.uniform(-.07, .07), TOP + .05, .27 * size, .31 * size, .2 * size, rng)
    for side in (-1, 1):
        for i in range(7):
            y = 1.15 - i * .27
            size = 1.0 - i * .095
            lump(c, k.mass, side * (1.5 + rng.uniform(-.05, .05)), y, TOP + .03, .25 * size, .24 * size, .16 * size, rng)
    # Folds bind the ridge and lead the eye down the arms toward the opening.
    for side in (-1, 1):
        for j in range(2):
            pts = [(side * (.55 + .5 * j), 1.68, TOP + .2), (side * (1.35 + .1 * j), 1.62 - .05 * j, TOP + .22),
                   (side * (1.6 - .12 * j), 1.0, TOP + .17), (side * (1.55 - .1 * j), .1, TOP + .13), (side * 1.48, -.55, TOP + .06)]
            tapered_tube(c, 'Bruised brood fold', pts, [.05, .07, .06, .045, .015], k.fold, 10)
    # Egg clusters at the back corners keep the brood identity of the former nest.
    for side in (-1, 1):
        for (dx, dy, r) in ((0, 0, .15), (.2, -.12, .12), (-.06, -.24, .1)):
            x, y = side * (1.55 - dx), 1.55 + dy
            lump(c, k.egg, x, y, TOP + .22, r, r * .92, r * .8, rng, 'Translucent brood egg')
    if damaged:
        for i in range(4):
            x, y = rng.uniform(-1.6, 1.6), rng.uniform(1.3, 1.7)
            plate(c, 'Torn brood wound', (x, y, TOP + .3), [(-.13, -.08), (.14, -.06), (.11, .09), (-.1, .08)], .02, k.scorch, .005)


def veins(c, k, rng, damaged):
    """Fine veins in the brood membrane run from the heart along both arms toward the pit."""
    routes = []
    for side in (-1, 1):
        routes.append([(side * .3, 1.36, TOP + .3), (side * .9, 1.46, TOP + .27), (side * 1.38, 1.3, TOP + .25),
                       (side * 1.5, .7, TOP + .19), (side * 1.46, .05, TOP + .15), (side * 1.36, -.6, TOP + .09)])
        routes.append([(side * .2, 1.52, TOP + .28), (side * .7, 1.66, TOP + .26), (side * 1.22, 1.62, TOP + .24)])
    for i, pts in enumerate(routes):
        if damaged and i == 0: pts = pts[:4]
        radii = [.026 - .016 * j / (len(pts) - 1) for j in range(len(pts))]
        tapered_tube(c, 'Void brood vein', pts, radii, k.vein, 8)
        for j in range(1, len(pts) - 1):
            x, y, z = pts[j]
            off = rng.choice((-1, 1)) * rng.uniform(.1, .16)
            end = (x + off, y + rng.uniform(-.1, .1), z - .02)
            if abs(end[0]) < 1.12 and end[1] < 1.0: continue  # never over the pit
            tapered_tube(c, 'Void brood vein', [(x, y, z), end], [.014, .005], k.vein, 6)


def heart(c, k, rng, damaged, rubble):
    """Brood heart in the back wall: a membrane sac under two chitin ribs, split lengthwise by a
    glowing seam that points into the pit."""
    if rubble:
        lump(c, k.husk, 0, 1.45, TOP + .02, .5, .36, .07, rng, 'Collapsed brood husk', 0.0)
        c.ell('Spent heart residue', (0, 1.38, TOP + .06), (.06, .2, .03), k.spent)
        return
    lump(c, k.fold, 0, 1.45, TOP + .14, .44, .42, .28, rng, 'Brood heart sac')
    seam = .3 if not damaged else .18
    c.ell('Brood heart seam shadow', (0, 1.4, TOP + .36), (.075, seam + .04, .07), k.throat)
    c.ell('Brood heart slit', (0, 1.38, TOP + .4), (.04, seam, .06), k.heart)
    for side in (-1, 1):
        pts = [(side * .3, 1.86, TOP + .08), (side * .36, 1.66, TOP + .38), (side * .34, 1.38, TOP + .44),
               (side * .26, 1.12, TOP + .3), (side * .2, .98, TOP + .12)]
        tapered_tube(c, 'Heart clasp rib', pts, [.055, .05, .045, .03, .008], k.bone, 9)


def tusks(c, k, rng, damaged):
    """Two chitin tusks on the arm tips flank the opening and hook toward its centre."""
    for side in (-1, 1):
        if damaged and side == 1:
            tapered_tube(c, 'Broken chitin tusk', [(side * 1.5, -.5, TOP), (side * 1.44, -.74, TOP + .14)], [.1, .07], k.bone, 9)
            continue
        pts = [(side * 1.58, -.42, TOP - .02), (side * 1.55, -.7, TOP + .16), (side * 1.4, -.86, TOP + .28),
               (side * 1.2, -.9, TOP + .32), (side * 1.08, -.86, TOP + .3)]
        tapered_tube(c, 'Weathered chitin tusk', pts, [.12, .1, .07, .035, .004], k.bone, 10)
        tapered_tube(c, 'Tusk sinew wrap', [(side * 1.62, -.38, TOP + .02), (side * 1.5, -.52, TOP + .08), (side * 1.36, -.5, TOP + .04)],
                     [.03, .035, .02], k.fold, 8)


def rubble_spill(c, k, rng):
    for i in range(12):
        cell = rng.choice(WALL_CELLS)
        x, y = cell[0] + rng.uniform(-.32, .32), cell[1] + rng.uniform(-.32, .32)
        pts = [(rng.uniform(-.12, -.06), rng.uniform(-.1, -.04)), (rng.uniform(.06, .12), rng.uniform(-.1, -.04)),
               (rng.uniform(.04, .1), rng.uniform(.05, .11)), (rng.uniform(-.1, -.04), rng.uniform(.04, .1))]
        ob = centred_plate(c, 'Broken masonry chunk', (x, y, .2), pts, rng.uniform(.08, .14), k.stone, .02)
        ob.rotation_euler = (rng.uniform(-.4, .4), rng.uniform(-.4, .4), rng.uniform(0, math.tau))
    for i in range(5):
        cell = rng.choice(WALL_CELLS)
        plate(c, 'Scorch crust patch', (cell[0] + rng.uniform(-.25, .25), cell[1] + rng.uniform(-.25, .25), .3),
              [(-.18, -.11), (.2, -.09), (.16, .13), (-.14, .14)], .01, k.scorch, .004)
    for side in (-1, 1):
        lump(c, k.husk, side * 1.5, .25, .3, .3, .62, .05, rng, 'Deflated brood husk', 0.0)
    lump(c, k.husk, 0, 1.5, .3, 1.45, .3, .05, rng, 'Deflated brood husk', 0.0)


def build(c, spec):
    model = spec['model']
    state, outlet = model.get('state', 'intact'), model.get('outlet', 'south')
    if state not in ('intact', 'damaged', 'rubble') or outlet not in OUTLET_TURN:
        raise ValueError(f'Unknown spawn structure model: {state}/{outlet}')
    rng = random.Random(f'spawn-structure-{state}')
    pivot = root(c)
    k = Kit(c, spec, state)
    damaged, rubble = state != 'intact', state == 'rubble'
    mortar_bed(c, k, rubble)
    for x, y in WALL_CELLS:
        stone_block(c, k, rng, x, y, damaged, rubble)
    if not rubble:
        binding_iron(c, k, rng, damaged)
        brood_mass(c, k, rng, damaged)
        veins(c, k, rng, damaged)
        tusks(c, k, rng, damaged)
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
    core.location = (*turned(0, 1.38, turn), TOP + .4)
    result = finish(c, pivot)
    mouth.parent = pivot; core.parent = pivot
    result['sockets'] = {'mouth': mouth, 'core': core}
    return result
