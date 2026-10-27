"""Stone plinth a fort lays under a turret on its deck (1 BU = 1 m): one dressed field-stone block with chamfered
edges and a few weathered patches, a central iron anchor plate with its bolts and the socket of the turret post;
moss settles in the stone's shaded seams. It is square and does not turn with the weapon."""
import random
from rigs_v2 import model
from turret_surface_parts import material

SIDE, HEIGHT = .70, .26


def build(c, spec):
    rng = random.Random(41)
    stones = [material(c, 'Dressed field stone', (.255, .245, .222), 'stone'),
              material(c, 'Weathered grey stone', (.205, .2, .185), 'stone')]
    mortar = material(c, 'Dark mortar joints', (.055, .05, .045), 'recess')
    iron = material(c, 'Forged iron anchor plate', (.085, .088, .085), 'steel')
    edge = material(c, 'Rubbed iron bolt heads', (.26, .27, .25), 'steel')
    # One dressed block, no visible joints: a dark seam read as a line across the plinth at game size.
    c.box('Dressed plinth block', (0, 0, HEIGHT / 2), (SIDE, SIDE, HEIGHT), stones[0], .045)
    for _ in range(5):                                             # a few shallow worn patches of the second stone tone
        x, y = rng.uniform(-.22, .22), rng.uniform(-.22, .22)
        patch = c.box('Weathered stone patch', (x, y, HEIGHT + .001), (rng.uniform(.08, .16), rng.uniform(.06, .12), .004), stones[1], .002)
        patch.rotation_euler.z = rng.uniform(0, 3)
    c.box('Iron anchor plate', (0, 0, HEIGHT + .008), (.30, .30, .018), iron, .006)
    for sx in (-1, 1):
        for sy in (-1, 1):
            c.cylinder('Anchor bolt', (sx * .115, sy * .115, HEIGHT + .022), .022, .016, edge, 6)
    c.cylinder('Post socket', (0, 0, HEIGHT + .02), .085, .02, iron, 16)
    c.cylinder('Socket bore', (0, 0, HEIGHT + .031), .06, .004, mortar, 16)
    return model(c.scene)
