"""Explosive reactive-prop barrel seen straight from above.

Both variants share the drum silhouette: rolled chime, recessed lid, embossed
stiffening ring and screw bungs. `rusted` is a weathered oxide-red drum with
rust creep and a faded hazard diamond. `toxic` is a dark olive drum whose torn
lid exposes a glowing toxic-green sludge pool that spills over the chime.
"""
import math
import bpy
from dawn_parts import surface, root, finish, plate


def torus(c, name, center, major, minor, mat, segments=72):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=segments,
                                     minor_segments=12, location=center)
    ob = bpy.context.object; ob.name = name; ob.data.materials.append(mat)
    for face in ob.data.polygons: face.use_smooth = True
    return ob


def blob(c, name, center, scale, mat, rotation=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=center)
    ob = bpy.context.object; ob.name = name; ob.scale = scale; ob.rotation_euler.z = rotation
    ob.data.materials.append(mat)
    for face in ob.data.polygons: face.use_smooth = True
    return ob


def placed(c, name, center, outline, thickness, mat, bevel, rotation=(0, 0, 0)):
    """`plate` writes world-space vertices; build at the origin so rotation stays local."""
    ob = plate(c, name, (0, 0, 0), outline, thickness, mat, bevel)
    ob.location = center; ob.rotation_euler = rotation
    return ob


def bung(c, name, x, y, flange_r, steel, plug):
    c.cylinder(name + ' flange', (x, y, .405), flange_r, .03, steel, 40)
    c.cylinder(name + ' hex plug', (x, y, .425), flange_r * .62, .03, plug, 6)


def rusted(c, shell_top):
    """One large flame placard instead of small details: it must read at 27 px."""
    paint = surface(c, 'Oxide red drum paint', (172, 50, 34), .55)
    # Rust lives in the procedural wear (chips, edge abrasion, corrosion streaks), not in decals.
    lid = surface(c, 'Sun-faded red lid', (176, 56, 36), .82)
    chime = surface(c, 'Worn chime with bare rust', (120, 70, 42), .9)
    label = surface(c, 'Hazard placard', (232, 220, 190), .3)
    mark = surface(c, 'Charcoal flame print', (36, 28, 26), .08)
    c.cylinder('Drum shell', (0, 0, shell_top - .42), .47, .84, paint, 72)
    torus(c, 'Rolled top chime', (0, 0, shell_top + .012), .462, .042, chime)
    c.cylinder('Recessed lid', (0, 0, shell_top - .015), .44, .03, lid, 72)
    placed(c, 'Hazard placard', (0, 0, shell_top + .004),
           [(0, .335), (.335, 0), (0, -.335), (-.335, 0)], .012, label, .012)
    flame = [(0, .215), (.03, .13), (.07, .09), (.085, .16), (.115, .07), (.125, -.03), (.085, -.11),
             (0, -.135), (-.085, -.11), (-.125, -.03), (-.1, .05), (-.06, .02), (-.04, .1)]
    placed(c, 'Hazard flame', (0, .03, shell_top + .012), flame, .006, mark, .002)
    c.box('Hazard flame base bar', (0, -.165, shell_top + .012), (.26, .04, .006), mark, .004)


def toxic(c, shell_top):
    paint = surface(c, 'Olive waste drum paint', (64, 76, 42), .55)
    chime = surface(c, 'Corroded olive chime', (60, 64, 44), .85)
    lid = surface(c, 'Dented olive lid', (78, 90, 52), .5)
    torn = surface(c, 'Torn lid steel', (150, 150, 128), .5)
    steel = surface(c, 'Pitted bung steel', (132, 134, 124), .4)
    plug = surface(c, 'Dark bung plug', (58, 60, 54), .2)
    sludge = surface(c, 'Toxic sludge body', (64, 178, 34), 0, .9)
    core = surface(c, 'Toxic glowing core', (136, 255, 60), 0, 1.7)
    froth = surface(c, 'Toxic froth highlight', (150, 236, 92), 0, 1.0)
    c.cylinder('Drum shell', (0, 0, shell_top - .42), .47, .84, paint, 72)
    torus(c, 'Rolled top chime', (0, 0, shell_top + .012), .462, .042, chime)
    # Torn lid: an outer lid ring with jagged flaps peeled up around the opening.
    steps = 72
    outline = []
    for k in range(steps):
        t = k * math.tau / steps
        jag = .255 + .035 * math.sin(5 * t + .7) + .02 * math.sin(11 * t)
        outline.append((jag * math.cos(t), jag * math.sin(t)))
    ring_outline = [(.44 * math.cos(k * math.tau / steps), .44 * math.sin(k * math.tau / steps)) for k in range(steps)]
    lid_ring = plate(c, 'Lid ring', (0, 0, shell_top + .006), ring_outline, .03, lid, .006)
    hole = plate(c, 'Lid opening cutter', (0, 0, shell_top + .006), outline, .2, lid, 0)
    boolean = lid_ring.modifiers.new('Torn opening', 'BOOLEAN'); boolean.operation = 'DIFFERENCE'; boolean.object = hole
    bpy.context.view_layer.objects.active = lid_ring
    bpy.ops.object.modifier_apply(modifier=boolean.name)
    bpy.data.objects.remove(hole, do_unlink=True)
    for i, a in enumerate([.4, 1.7, 3.0, 4.5, 5.6]):
        r = .27
        placed(c, f'Peeled lid flap {i}', (r * math.cos(a), r * math.sin(a), shell_top + .03),
               [(-.05, -.025), (.05, -.03), (.035, .03), (-.03, .028)], .012, torn, .003,
               (math.radians(32) * (1 if i % 2 else -1), 0, a + math.pi / 2))
    torus(c, 'Embossed lid ring', (0, 0, shell_top + .02), .37, .014, lid)
    bung(c, 'Vent bung', -.28, -.2, .055, steel, plug)
    c.cylinder('Toxic sludge pool', (.01, -.01, shell_top), .31, .02, sludge, 48)
    blob(c, 'Toxic glowing core', (.03, .0, shell_top + .006), (.13, .115, .012), core, .4)
    for i, (x, y, s) in enumerate([(.07, .06, .032), (-.09, -.05, .024), (.11, -.09, .018)]):
        blob(c, f'Sludge bubble {i}', (x, y, shell_top + .008), (s, s, s * .35), froth)
    # One irregular drip runs from the pool over the lid ring and the chime edge.
    drip = surface(c, 'Toxic drip', (62, 168, 32), 0, .55)
    for i, (a, reach, width) in enumerate([(3.6, .48, .03)]):
        outline = []
        for k in range(9):
            t = k / 8
            r = .24 + (reach - .24) * t
            w = width * (1 - .55 * t) * (1 + .25 * math.sin(7 * t + i))
            outline.append((r, w))
        tongue = [(r, w) for r, w in outline] + [(r, -w * (1 + .2 * math.cos(5 * r))) for r, w in reversed(outline)]
        placed(c, f'Sludge spill {i}', (0, 0, shell_top + .03), tongue, .05, drip, .012, (0, 0, a))


def build(c, spec):
    c.scene.cycles.filter_width = 1.0
    pivot = root(c)
    shell_top = .40
    variant = spec['model']['variant']
    if variant == 'rusted': rusted(c, shell_top)
    elif variant == 'toxic': toxic(c, shell_top)
    else: raise ValueError(f'Unknown barrel variant: {variant}')
    return finish(c, pivot)
