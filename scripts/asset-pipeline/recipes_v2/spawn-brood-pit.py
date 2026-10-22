"""Brood pit of the hostile spawn structure (GDD Spawnbauwerk V1): the free 2 x 2 spawn surface.

One Blender unit is one 32 px world cell; the pivot is the pit centre, shared with the U building
asset. A sunken stone basin holds a matte brood membrane drawn into radial folds around a closed,
puckered orifice where enemies rise. Deliberately no portal language: no glowing rim, no swirl,
no see-through aperture. Only a faint violet shimmer between the folds emits (`glow` pass).
`model.state`: sealed (dormant crust), active (wet membrane), dry (spent, cracked crater).
"""
import math
import random
import bpy
from dawn_parts import surface, root, finish, tapered_tube
from enemy_parts_b import plate


def centred_plate(c, name, center, outline, thickness, material, bevel=.025):
    """A plate whose origin sits at its own centre, so its tilt and turn stay local."""
    ob = plate(c, name, (0, 0, 0), outline, thickness, material, bevel)
    ob.location = center
    return ob

VOID_DEEP = (111, 22, 168)
HALF = .97           # the basin stays inside the 2 x 2 pit cells


def damp(mat, roughness=.45):
    n, l = mat.node_tree.nodes, mat.node_tree.links
    bs = n['Principled BSDF']
    bs.inputs['Specular IOR Level'].default_value = .26
    bs.inputs['Coat Weight'].default_value = .16
    bs.inputs['Coat Roughness'].default_value = .32
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 18
    ramp = n.new('ShaderNodeMapRange')
    ramp.inputs['To Min'].default_value = roughness - .12; ramp.inputs['To Max'].default_value = roughness + .12
    l.new(noise.outputs['Fac'], ramp.inputs['Value']); l.new(ramp.outputs['Result'], bs.inputs['Roughness'])
    return mat


class Kit:
    def __init__(self, c, spec, state):
        lib = spec['model'].get('librarySurfaces', {})
        def m(name, rgb, wear=.3, emission=0):
            return surface(c, name, rgb, wear, emission, **lib.get(name, {}))
        active = state == 'active'
        self.rim = m('Low brood rim', (46, 26, 52), .2)
        self.bed = m('Dark basin bedding', (24, 18, 26), 0)
        membrane = m('Brood pit membrane', (54, 22, 70) if state != 'dry' else (52, 40, 44), .12)
        self.membrane = damp(membrane) if active else membrane
        fold = m('Brood pit fold', (80, 34, 96) if state != 'dry' else (60, 48, 50), .12)
        self.fold = damp(fold, .4) if active else fold
        self.crust = m('Dormant brood crust', (64, 52, 60), .3)
        self.orifice = m('Closed brood orifice', (12, 6, 16), 0)
        self.ash = m('Spent pit ash', (58, 52, 50), .3)
        self.glow = m('Brood pit shimmer', VOID_DEEP, 0, .35 if active else .08 if state == 'sealed' else 0)


def lump(c, mat, x, y, z, sx, sy, sz, rng, name):
    ob = c.ell(name, (x, y, z), (sx, sy, sz), mat)
    ob.rotation_euler.z = rng.uniform(0, math.pi)
    phase = rng.uniform(0, math.tau)
    for v in ob.data.vertices:
        v.co.z *= 1 + .14 * math.sin(v.co.x * 8 + v.co.y * 6 + phase)
    return ob


def basin(c, k, rng):
    """Dark soil bed with a low organic rim. Grey stone is reserved for the walls (the hitbox); the
    walkable spawn surface stays dark and organic, so the opening never reads as a wall."""
    plate(c, 'Dark basin bedding', (0, 0, -.02), [(-HALF, -HALF), (HALF, -HALF), (HALF, HALF), (-HALF, HALF)], .04, k.bed, .01)
    corners = [(-HALF + .08, -HALF + .08), (HALF - .08, -HALF + .08), (HALF - .08, HALF - .08), (-HALF + .08, HALF - .08)]
    for i in range(4):
        (x0, y0), (x1, y1) = corners[i], corners[(i + 1) % 4]
        pts = []
        for j in range(6):
            t = j / 5
            wobble = rng.uniform(-.03, .03)
            pts.append((x0 + (x1 - x0) * t + (y1 - y0) / 2 * wobble, y0 + (y1 - y0) * t - (x1 - x0) / 2 * wobble, .02))
        tapered_tube(c, 'Low brood rim', pts, [rng.uniform(.035, .055) for _ in pts], k.rim, 8)


def membrane(c, k, rng, state):
    if state == 'dry':
        lump(c, k.ash, 0, 0, -.02, .78, .78, .05, rng, 'Spent pit ash')
        for i in range(9):
            a = i * math.tau / 9 + rng.uniform(-.1, .1)
            r0, r1 = rng.uniform(.05, .2), rng.uniform(.55, .8)
            tapered_tube(c, 'Dry crack', [(r0 * math.cos(a), r0 * math.sin(a), .03), (r1 * math.cos(a + .2), r1 * math.sin(a + .2), .03)],
                         [.025, .008], k.orifice, 6)
        for i in range(6):
            a = rng.uniform(0, math.tau); r = rng.uniform(.3, .7)
            plate(c, 'Torn membrane shred', (r * math.cos(a), r * math.sin(a), .04),
                  [(-.1, -.05), (.12, -.04), (.08, .06), (-.06, .07)], .015, k.membrane, .004)
        c.ell('Collapsed orifice', (0, 0, .0), (.14, .14, .03), k.orifice)
        return
    # Inset from the lip so a dark shadow gap reads as depth: the membrane lies sunken, not domed.
    lump(c, k.membrane, 0, 0, .0, .78, .78, .05, rng, 'Brood pit membrane')
    # Irregular folds: uneven count, length and bend, so the surface never reads as a dial or ring.
    angles = sorted(rng.uniform(0, math.tau) for _ in range(9))
    for i, a in enumerate(angles):
        bend = rng.uniform(-.35, .35)
        reach = rng.uniform(.48, .82)
        width = rng.uniform(.035, .065)
        pts = [(.1 * math.cos(a), .1 * math.sin(a), .07),
               (reach * .45 * math.cos(a + bend * .4), reach * .45 * math.sin(a + bend * .4), .075),
               (reach * .8 * math.cos(a + bend), reach * .8 * math.sin(a + bend), .05),
               (reach * math.cos(a + bend * 1.2), reach * math.sin(a + bend * 1.2), .02)]
        tapered_tube(c, 'Brood pit fold', pts, [width * .8, width, width * .7, .012], k.fold, 9)
    for i in range(6):
        a = rng.uniform(0, math.tau); r = rng.uniform(.25, .7)
        lump(c, k.membrane, r * math.cos(a), r * math.sin(a), .02, rng.uniform(.1, .18), rng.uniform(.08, .14), .05, rng, 'Brood pit membrane')
    # A faint subsurface shimmer in a few valleys near the orifice, never as a ring.
    for i in range(4):
        a = angles[rng.randrange(len(angles))] + rng.uniform(.15, .35); r = rng.uniform(.18, .42)
        c.ell('Brood pit shimmer', (r * math.cos(a), r * math.sin(a), .035), (.04, rng.uniform(.06, .1), .02), k.glow).rotation_euler.z = a + rng.uniform(-.5, .5)
    # Closed puckered orifice: dark centre gathered by short folds.
    c.ell('Closed brood orifice', (0, 0, .07), (.11, .11, .04), k.orifice)
    for i in range(7):
        a = i * math.tau / 7
        tapered_tube(c, 'Brood pit fold', [(.06 * math.cos(a), .06 * math.sin(a), .1), (.17 * math.cos(a + .3), .17 * math.sin(a + .3), .09)],
                     [.03, .04], k.fold, 8)
    if state == 'sealed':
        for i in range(8):
            a = rng.uniform(0, math.tau); r = rng.uniform(.2, .72)
            pts = [(-.13, -.07), (.12, -.09), (.15, .05), (.02, .11), (-.12, .06)]
            ob = centred_plate(c, 'Dormant brood crust', (r * math.cos(a), r * math.sin(a), .1), pts, .02, k.crust, .006)
            ob.rotation_euler.z = rng.uniform(0, math.tau)


def build(c, spec):
    state = spec['model'].get('state', 'active')
    if state not in ('sealed', 'active', 'dry'):
        raise ValueError(f'Unknown brood pit state: {state}')
    rng = random.Random(f'spawn-brood-pit-{state}')
    pivot = root(c)
    k = Kit(c, spec, state)
    basin(c, k, rng)
    membrane(c, k, rng, state)
    centre = bpy.data.objects.new('Brood orifice socket', None); c.scene.collection.objects.link(centre)
    centre.location = (0, 0, .1)
    result = finish(c, pivot)
    centre.parent = pivot
    result['sockets'] = {'orifice': centre}
    return result
