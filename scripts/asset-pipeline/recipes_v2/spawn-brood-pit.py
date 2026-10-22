"""Brood pit of the hostile spawn structure (GDD Spawnbauwerk V1): the free 2 x 2 spawn surface.

One Blender unit is one 32 px world cell; the pivot is the pit centre, shared with the U building.
The floor continues the building's dark armour, sunk lower and darker, and has burst open: an
irregular pool of black-violet brood ooze wells up through broken plates, with a clutch of eggs at
one edge and a faint glow from the depth. Walkable ground: no frame, no light strips (those mark
the walls), no ring, no radial folds, no central orifice. Only the pool's depth glow emits (`glow`).
`model.state`: sealed (dormant crust over the pool), active (wet ooze), dry (spent, cracked basin).
"""
import math
import random
import bpy
from dawn_parts import surface, root, finish
from enemy_parts_b import plate
from spawn_structure_concepts import PITS, ConceptKit
import spawn_structure_concepts2 as second_round
import spawn_structure_concepts3 as third_round

VOID_DEEP = (111, 22, 168)
# The floor reaches just under the walls (which draw above it), so no ground shows at the seam.
HALF = 1.04
POOL_CENTRE = (.06, -.04)


def centred_plate(c, name, center, outline, thickness, material, bevel=.025):
    """A plate whose origin sits at its own centre, so its tilt and turn stay local."""
    ob = plate(c, name, (0, 0, 0), outline, thickness, material, bevel)
    ob.location = center
    return ob


def glossy(mat, roughness=.34):
    """Viscous ooze: a broken wet sheen, still matte enough for the shared soft lights."""
    n, l = mat.node_tree.nodes, mat.node_tree.links
    bs = n['Principled BSDF']
    bs.inputs['Specular IOR Level'].default_value = .22
    bs.inputs['Coat Weight'].default_value = .14
    bs.inputs['Coat Roughness'].default_value = .3
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 9
    ramp = n.new('ShaderNodeMapRange')
    ramp.inputs['To Min'].default_value = roughness - .08; ramp.inputs['To Max'].default_value = roughness + .16
    l.new(noise.outputs['Fac'], ramp.inputs['Value']); l.new(ramp.outputs['Result'], bs.inputs['Roughness'])
    return mat


class Kit:
    def __init__(self, c, spec, state):
        lib = spec['model'].get('librarySurfaces', {})
        def m(name, rgb, wear=.3, emission=0):
            return surface(c, name, rgb, wear, emission, **lib.get(name, {}))
        active = state == 'active'
        self.floor = m('Sunken void armour floor', (24, 23, 28), .2)
        self.seam = m('Deep armour seam', (10, 9, 13), 0)
        self.shard = m('Broken floor plate', (34, 33, 39), .25)
        ooze = m('Black brood ooze', (16, 8, 22), .04)
        self.ooze = glossy(ooze) if active else ooze
        film = m('Violet ooze film', (54, 22, 68) if active else (40, 24, 44), .04)
        self.film = glossy(film, .26) if active else film
        self.egg = glossy(m('Translucent brood egg', (70, 36, 88), .06), .3)
        self.crust = m('Dormant brood crust', (52, 44, 52), .3)
        self.residue = m('Spent brood residue', (36, 30, 36), .25)
        self.glow = m('Brood pool glow', VOID_DEEP, 0, .35 if active else 0)


def pool_outline(rng, radius, points=15, jitter=.22):
    """Irregular, lopsided pool edge: never a circle, never radially even."""
    out = []
    phase = rng.uniform(0, math.tau)
    for i in range(points):
        a = phase + math.tau * i / points + rng.uniform(-.12, .12)
        r = radius * (1 + rng.uniform(-jitter, jitter)) * (1 + .12 * math.cos(a - .8))
        out.append((POOL_CENTRE[0] + r * math.cos(a), POOL_CENTRE[1] + r * .9 * math.sin(a)))
    return out


def floor(c, k):
    """Four sunken armour plates with deep seams, darker and lower than the walls."""
    plate(c, 'Deep armour seam', (0, 0, -.03), [(-HALF, -HALF), (HALF, -HALF), (HALF, HALF), (-HALF, HALF)], .03, k.seam, .005)
    for gx in (-.5, .5):
        for gy in (-.5, .5):
            s, ch = .48, .08
            pts = [(-s + ch, -s), (s - ch, -s), (s, -s + ch), (s, s - ch), (s - ch, s), (-s + ch, s), (-s, s - ch), (-s, -s + ch)]
            plate(c, 'Sunken void armour floor', (0, 0, .0), [(gx + px, gy + py) for px, py in pts], .04, k.floor, .012)


def broken_edge(c, k, rng, outline):
    """Plate shards tipped up around the burst: the pool forced its way through the floor."""
    for x, y in outline:
        if rng.random() < .45: continue
        a = math.atan2(y - POOL_CENTRE[1], x - POOL_CENTRE[0])
        w, l = rng.uniform(.07, .12), rng.uniform(.1, .18)
        pts = [(-l, -w), (l * .8, -w * 1.2), (l, w * .6), (-l * .7, w)]
        ob = centred_plate(c, 'Broken floor plate', (x + math.cos(a) * .06, y + math.sin(a) * .06, .04), pts, .03, k.shard, .008)
        ob.rotation_euler = (rng.uniform(-.25, .25), rng.uniform(.1, .35), a + math.pi / 2 + rng.uniform(-.4, .4))


def pool(c, k, rng, state, outline):
    if state == 'dry':
        plate(c, 'Spent brood residue', (0, 0, .025), outline, .02, k.residue, .01)
        for i in range(7):
            x, y = POOL_CENTRE[0] + rng.uniform(-.4, .4), POOL_CENTRE[1] + rng.uniform(-.35, .35)
            ob = centred_plate(c, 'Deep armour seam', (x, y, .038), [(-.16, -.008), (.16, -.008), (.16, .008), (-.16, .008)], .006, k.seam, 0)
            ob.rotation_euler.z = rng.uniform(0, math.pi)
        return
    plate(c, 'Black brood ooze', (0, 0, .03), outline, .03, k.ooze, .02)
    for i in range(4):
        x, y = POOL_CENTRE[0] + rng.uniform(-.38, .38), POOL_CENTRE[1] + rng.uniform(-.3, .3)
        ob = c.ell('Violet ooze film', (x, y, .05), (rng.uniform(.08, .16), rng.uniform(.05, .1), .012), k.film)
        ob.rotation_euler.z = rng.uniform(0, math.pi)
    # Depth glow: a few uneven patches under the surface, never centred.
    for i in range(3):
        x, y = POOL_CENTRE[0] + rng.uniform(-.3, .3), POOL_CENTRE[1] + rng.uniform(-.25, .25)
        ob = c.ell('Brood pool glow', (x, y, .036), (rng.uniform(.1, .17), rng.uniform(.06, .11), .01), k.glow)
        ob.rotation_euler.z = rng.uniform(0, math.pi)
    for i in range(3):
        x, y = POOL_CENTRE[0] + rng.uniform(-.35, .35), POOL_CENTRE[1] + rng.uniform(-.3, .3)
        r = rng.uniform(.03, .05)
        c.ell('Black brood ooze', (x, y, .05), (r, r, r * .7), k.ooze)
    # A clutch of eggs on one edge of the pool, half sunk in the ooze.
    a0 = rng.uniform(0, math.tau)
    ex, ey = POOL_CENTRE[0] + math.cos(a0) * .5, POOL_CENTRE[1] + math.sin(a0) * .42
    for dx, dy, r in ((0, 0, .1), (.13, .06, .08), (-.07, .12, .075), (.06, -.11, .065)):
        egg = c.ell('Translucent brood egg', (ex + dx, ey + dy, .07), (r, r * .9, r * .75), k.egg)
        egg.rotation_euler.z = rng.uniform(0, math.pi)
    if state == 'sealed':
        for i in range(9):
            x, y = POOL_CENTRE[0] + rng.uniform(-.48, .48), POOL_CENTRE[1] + rng.uniform(-.4, .4)
            pts = [(-.12, -.07), (.11, -.09), (.14, .05), (.02, .1), (-.11, .06)]
            ob = centred_plate(c, 'Dormant brood crust', (x, y, .06), pts, .015, k.crust, .005)
            ob.rotation_euler.z = rng.uniform(0, math.tau)


def build(c, spec):
    state = spec['model'].get('state', 'active')
    if state not in ('sealed', 'active', 'dry'):
        raise ValueError(f'Unknown brood pit state: {state}')
    pivot = root(c)
    concept = spec['model'].get('concept', 'pool')
    if concept in third_round.PITS:
        third_round.PITS[concept](c, third_round.ConceptKit3(c, spec), random.Random(f'spawn-brood-pit-concept-{concept}'))
    elif concept in second_round.PITS:
        second_round.PITS[concept](c, second_round.ConceptKit2(c, spec), random.Random(f'spawn-brood-pit-concept-{concept}'))
    elif concept in PITS:
        # Design drafts for the user's choice (active only); see spawn_structure_concepts.py.
        PITS[concept](c, ConceptKit(c, spec), random.Random(f'spawn-brood-pit-concept-{concept}'))
    else:
        k = Kit(c, spec, state)
        floor(c, k)
        outline = pool_outline(random.Random('spawn-brood-pit-pool'), .66)
        broken_edge(c, k, random.Random('spawn-brood-pit-edge'), outline)
        pool(c, k, random.Random(f'spawn-brood-pit-{state}'), state, outline)
    centre = bpy.data.objects.new('Brood orifice socket', None); c.scene.collection.objects.link(centre)
    centre.location = (*POOL_CENTRE, .06)
    result = finish(c, pivot)
    centre.parent = pivot
    result['sockets'] = {'orifice': centre}
    return result
