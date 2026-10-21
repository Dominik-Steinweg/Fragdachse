"""Dynamite for the demolition bridges: the carried crate, the planted charge and the Dawn cache.

One BU is one metre and 32 display pixels. `model.kind` selects the asset:
  crate  20 px canvas: an open crate whose red sticks are the one readable symbol
  charge 32 px canvas: four sticks tied into a bundle, fuse running off north-east
         to the spark the runtime draws at +12/-10 display px (BridgeRenderer)
  cache  96 px canvas: the Dawn stockpile, crates of the same model on a pallet
         under a tarp, a plunger detonator and a coil of fuse cord beside it
"""
import math

import bpy
from bridge_parts import Kit, dynamite_stick, paint, surface

CRATE = (.5, .42, .28)  # outer length (x), width (y), height


def materials(ctx):
    m = {
        'iron': surface(ctx, 'Matte crate iron', (52, 54, 52), 'steel', 'iron'),
        'handle': surface(ctx, 'Worn plunger steel', (118, 120, 114), 'steel', 'iron'),
        'paper': paint(ctx, 'Red dynamite paper', (166, 44, 32)),
        'paper_faded': paint(ctx, 'Faded dynamite paper', (176, 70, 52)),
        'cap': paint(ctx, 'Crimped tan stick ends', (198, 176, 136)),
        'twine': paint(ctx, 'Hemp twine', (152, 126, 86)),
        'fuse': paint(ctx, 'Tarred fuse cord', (46, 40, 34)),
        'tarp': paint(ctx, 'Weathered olive tarp', (80, 86, 60)),
    }
    # Timber only where the asset declares the albedo; unused images would not survive the save.
    if 'wood' in ctx.images:
        m.update({
            'crate': surface(ctx, 'Stained crate boards', (150, 116, 80), 'wood', 'timber', grain=(.6, 1.3)),
            'crate_light': surface(ctx, 'Lighter crate boards', (172, 136, 94), 'wood', 'timber', grain=(.6, 1.3)),
            'pallet': surface(ctx, 'Pallet boards', (138, 112, 82), 'wood', 'timber', grain=(.6, 1.3)),
        })
    return m


def crate(kit, m, cx, cy, z0, angle=0.0, open_top=True, scale=1.0, sticks_faded=False):
    """A plank crate on z0; open crates show a tight layer of red sticks."""
    rng = kit.rng
    length, width, height = (v * scale for v in CRATE)
    wall = .03 * scale
    ca, sa = math.cos(angle), math.sin(angle)

    def at(x, y):
        return cx + x * ca - y * sa, cy + x * sa + y * ca

    wood = m['crate_light'] if rng.random() < .4 else m['crate']
    for sy in (-1, 1):
        x, y = at(0, sy * (width - wall) / 2)
        kit.box('crates', 'Crate side wall', (x, y, z0 + height / 2), (length, wall, height), wood, .006, (0, 0, angle))
    for sx in (-1, 1):
        x, y = at(sx * (length - wall) / 2, 0)
        kit.box('crates', 'Crate end wall', (x, y, z0 + height / 2), (wall, width - 2 * wall, height), wood, .006, (0, 0, angle))
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = at(sx * (length / 2 - .03 * scale), sy * (width / 2 - .03 * scale))
            kit.box('hardware', 'Crate iron corner', (x, y, z0 + height + .004), (.055 * scale, .055 * scale, .012), m['iron'], .003, (0, 0, angle))
    if open_top:
        inner = width - 2 * wall
        count = max(3, int(inner / (.058 * scale)))
        radius = inner / count / 2 * .96
        for i in range(count):
            x, y = at(rng.uniform(-.008, .008) * scale, -inner / 2 + (i + .5) * inner / count)
            paper = m['paper_faded'] if sticks_faded and rng.random() < .3 else m['paper']
            dynamite_stick(kit, 'dynamite', (x, y, z0 + height - radius * 1.1), length - 2 * wall - .02 * scale, radius, angle,
                           paper, m['cap'], tilt=rng.uniform(-.03, .03))
        # A twine band holds the layer together.
        x, y = at(0, 0)
        kit.box('dynamite', 'Twine band over the sticks', (x, y, z0 + height - radius * .05), (.03 * scale, inner, .012), m['twine'], .004, (0, 0, angle))
    else:
        for i in range(4):
            x, y = at(0, -width / 2 + wall + (i + .5) * (width - 2 * wall) / 4)
            kit.box('crates', 'Crate lid board', (x, y, z0 + height - .012), (length - .01, (width - 2 * wall) / 4 - .008, .024),
                    wood, .004, (0, 0, angle + rng.uniform(-.01, .01)))
        # Red warning band painted across the lid.
        x, y = at(0, 0)
        kit.box('crates', 'Red warning band', (x, y, z0 + height + .001), (length * .9, .07 * scale, .004), m['paper'], .001, (0, 0, angle))


def fuse_cord(kit, m, points, radius=.012):
    for a, b in zip(points, points[1:]):
        kit.beam('fuse', 'Fuse cord', a, b, radius * 2, radius * 2, m['fuse'], .002)


def coil(kit, m, cx, cy, z, rings=3, radius=.14):
    for i in range(rings * 14):
        t0, t1 = i / 14 * 2 * math.pi, (i + 1) / 14 * 2 * math.pi
        r0, r1 = radius - .012 * i / 14, radius - .012 * (i + 1) / 14
        fuse_cord(kit, m, [(cx + r0 * math.cos(t0), cy + r0 * math.sin(t0), z + .012 * (i // 14)),
                           (cx + r1 * math.cos(t1), cy + r1 * math.sin(t1), z + .012 * ((i + 1) // 14))])


def charge(kit, m):
    rng = kit.rng
    for i, y in enumerate((-.14, -.047, .047, .14)):
        dynamite_stick(kit, 'dynamite', (rng.uniform(-.015, .015), y, .05), .6, .046, 0, m['paper'], m['cap'], tilt=rng.uniform(-.02, .02))
    for x in (-.17, .17):
        kit.box('dynamite', 'Twine lashing', (x, 0, .1), (.022, .34, .012), m['twine'], .004)
    # Blasting cap pushed into the top stick; the fuse leaves towards the spark at (+0.375, +0.3125).
    kit.box('dynamite', 'Copper blasting cap', (.31, .14, .06), (.07, .024, .024), m['iron'], .004)
    curve = []
    for i in range(13):
        t = i / 12
        # Quadratic Bezier from the cap via an eastward bulge to the spark point.
        p0, p1, p2 = (.345, .14), (.45, .22), (.375, .3125)
        curve.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                      (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1], .06 + .02 * t))
    fuse_cord(kit, m, curve, .011)


def cache(kit, m):
    rng = kit.rng
    # Pallet: deck boards across three runners.
    for y in (-.62, 0, .62):
        kit.box('pallet', 'Pallet runner', (0, y, .05), (1.7, .1, .1), m['pallet'], .006)
    for i in range(9):
        x = -.8 + i * .2
        kit.box('pallet', 'Pallet deck board', (x + rng.uniform(-.01, .01), 0, .115), (.16, 1.36, .03), m['pallet'], .004,
                (0, 0, rng.uniform(-.01, .01)))
    z = .13
    # Bottom layer of closed crates, two stacked on top, one opened at the front.
    for (cx, cy, a) in ((-.52, .36, .02), (.02, .4, -.03), (.55, .34, .04), (-.5, -.2, -.02)):
        crate(kit, m, cx, cy, z, a, open_top=False)
    crate(kit, m, .1, -.22, z, .05, open_top=True)
    crate(kit, m, -.3, .38, z + CRATE[2], .12, open_top=False)
    crate(kit, m, .36, .36, z + CRATE[2], -.08, open_top=True, sticks_faded=True)
    # Tarp thrown over the stacked back left crate, falling in folds to the pallet.
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=24, y_subdivisions=20, size=1, location=(-.32, .38, 0))
    tarp = bpy.context.object
    tarp.name = 'Draped tarp'
    tarp.scale = (.74, .6, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    phase = rng.uniform(0, math.pi)
    for v in tarp.data.vertices:
        edge = max(abs(v.co.x) / .37, abs(v.co.y) / .3)
        top = .13 + 2 * CRATE[2] + .065
        fold = .025 * math.sin(v.co.x * 23 + phase) * math.sin(v.co.y * 9) + .015 * math.sin(v.co.y * 31 + v.co.x * 7)
        v.co.z = top - .5 * max(0, edge - .62) ** 1.4 + fold * min(1, edge * 1.4)
    tarp.data.materials.append(m['tarp'])
    for face in tarp.data.polygons:
        face.use_smooth = True
    mod = tarp.modifiers.new('Cloth thickness', 'SOLIDIFY')
    mod.thickness = .01
    kit.adopt('tarp', tarp)
    # Plunger detonator with its T handle, cord to the open crate, a spare coil.
    kit.box('detonator', 'Detonator box', (.7, -.6, .12), (.3, .22, .24), m['crate'], .014, (0, 0, .2))
    kit.box('detonator', 'Detonator iron lid', (.7, -.6, .245), (.26, .18, .012), m['iron'], .004, (0, 0, .2))
    kit.cylinder('detonator', 'Plunger rod', (.7, -.6, .33), .02, .2, m['handle'], 10)
    kit.box('detonator', 'Plunger T handle', (.7, -.6, .44), (.38, .05, .05), m['handle'], .01, (0, 0, .2))
    fuse_cord(kit, m, [(.56, -.58, .05), (.46, -.52, .05), (.38, -.46, .1), (.3, -.4, .2)])
    coil(kit, m, -.78, -.66, .02)
    for (x, y, a) in ((-.32, -.68, .5), (-.18, -.74, .2)):
        dynamite_stick(kit, 'dynamite', (x, y, .03), .3, .03, a, m['paper'], m['cap'])


def build(ctx, spec):
    kind = spec['model']['kind']
    kit = Kit(ctx, 'Explosives ' + kind, {'crate': 31, 'charge': 37, 'cache': 41}[kind])
    m = materials(ctx)
    if kind == 'crate':
        crate(kit, m, 0, 0, 0)
    elif kind == 'charge':
        charge(kit, m)
    else:
        cache(kit, m)
    return kit.result()
