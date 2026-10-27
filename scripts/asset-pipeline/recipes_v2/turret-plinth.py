"""Stone plinth a fort lays under a turret on its deck (1 BU = 1 m): four dressed field-stone slabs with
chamfered edges and open joints over a dark mortar core, a central iron anchor plate with its bolts and the
socket of the turret post; moss settles in the stone's shaded seams. It is square and does not turn with the weapon."""
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
    c.box('Mortar core', (0, 0, HEIGHT / 2 - .01), (SIDE - .05, SIDE - .05, HEIGHT - .02), mortar, .01)
    half = SIDE / 4
    for sx in (-1, 1):
        for sy in (-1, 1):
            h = HEIGHT + rng.uniform(-.012, .008)
            slab = c.box('Dressed plinth slab', (sx * half + rng.uniform(-.004, .004), sy * half + rng.uniform(-.004, .004), h / 2),
                         (SIDE / 2 - .024, SIDE / 2 - .024, h), stones[rng.randrange(2)], .035)
            slab.rotation_euler.z = rng.uniform(-.025, .025)
    c.box('Iron anchor plate', (0, 0, HEIGHT + .008), (.30, .30, .018), iron, .006)
    for sx in (-1, 1):
        for sy in (-1, 1):
            c.cylinder('Anchor bolt', (sx * .115, sy * .115, HEIGHT + .022), .022, .016, edge, 6)
    c.cylinder('Post socket', (0, 0, HEIGHT + .02), .085, .02, iron, 16)
    c.cylinder('Socket bore', (0, 0, HEIGHT + .031), .06, .004, mortar, 16)
    return model(c.scene)
