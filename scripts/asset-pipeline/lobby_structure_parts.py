"""Lobby structure kit: roofs, walls, canvas and yard props in metres (1 BU = 1 m = 32 px).

Everything is real geometry for the fixed -Z camera. Canonical orientation: the working
front faces south (-Y). No ground plane, baked ground shadow or extra light is added.
"""
import math
import random
import bpy
from mathutils import Vector
from dawn_parts import material_factory, plate, tube, annulus, beam, bolt


def palette(c, spec):
    m = material_factory(c, spec)
    return dict(
        oak=m('Weathered oak', (104, 84, 60), .32),
        timber=m('Silvered timber', (140, 128, 106), .30),
        tar=m('Dark tarred timber', (58, 50, 42), .20),
        stone=m('Fieldstone', (118, 118, 108), .40),
        mortar=m('Lime mortar bed', (98, 94, 84), .30),
        concrete=m('Poured site concrete', (126, 124, 116), .35),
        iron=m('Forged iron', (96, 100, 98), .25),
        dark=m('Soot iron', (43, 44, 39), .18),
        rust=m('Rusted corrugated iron', (124, 84, 56), .45),
        rust2=m('Weathered rust sheet', (98, 74, 56), .40),
        tin=m('Galvanized roof sheet', (118, 122, 116), .42),
        paving=m('Worn paving stone', (100, 98, 90), .38),
        camo_green=m('Camouflage leaf green', (54, 64, 40), .22),
        camo_brown=m('Camouflage leaf brown', (86, 70, 48), .22),
        container=m('Faded container paint', (96, 102, 92), .40),
        brick=m('Fired clay brick', (128, 76, 58), .30),
        sand=m('Builder sand', (164, 146, 108), .15),
        base_stone=m('Base dark stone', (60, 64, 66), .35),
        base_steel=m('Base steel frame', (72, 80, 84), .22),
        cyan=m('Separate base cyan glow', (114, 202, 255), .01, .6),
        leather=m('Shop leather', (122, 78, 44), .28),
        plate_steel=m('Shop steel plate', (150, 156, 152), .22),
        shop_moss=m('Shop moss', (88, 104, 48), .40),
        slate_canvas=m('Slate blue canvas', (74, 90, 108), .25),
        oxblood=m('Oxblood canvas', (110, 50, 44), .25),
        slate=m('Slate shingle', (72, 76, 78), .26),
        shingle=m('Split wood shingle', (98, 80, 60), .30),
        canvas=m('Weathered canvas', (156, 140, 104), .25),
        olive=m('Olive tarpaulin', (92, 96, 66), .28),
        burlap=m('Sandbag burlap', (132, 116, 82), .30),
        brass=m('Worn brass fittings', (158, 119, 61), .30),
        ochre=m('Faded signal ochre', (176, 136, 54), .40),
        paper=m('Plan parchment', (185, 177, 147), .10),
        rope=m('Hemp cord', (142, 128, 94), .30),
        moss=m('Masonry moss', (66, 78, 41), .50),
        coal=m('Forge coal', (30, 29, 25), .10),
        water=m('Quenching water', (48, 63, 61), .05),
        rubber=m('Cracked cart rubber', (40, 42, 40), .16),
        cut=m('Exposed timber', (145, 122, 87), .30),
        wood=m('Old oak', (110, 88, 62), .30),
        cloth=m('Weathered canvas', (156, 140, 104), .25),
        ember=m('Separate forge ember', (222, 85, 19), .05, .7),
        lamp=m('Separate lantern emission', (244, 153, 53), .01, .7),
        window=m('Separate window glow', (150, 120, 82), .02, .12),
        beacon=m('Separate beacon amber', (232, 140, 30), .02, .8),
        screen=m('Separate screen glow', (118, 176, 150), .02, .45),
    )


# -- Geometry primitives -------------------------------------------------------

def slab(c, name, x0, y0, x1, y1, z0, z1, mat, bevel=.02):
    return c.box(name, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)), mat, bevel)


def grid_surface(c, name, origin, u, v, n, width, length, profile, mat, nu=48, nv=12, thickness=.02, smooth=True):
    """A displaced sheet spanned by unit vectors u/v; profile(s, t) offsets along n (metres)."""
    origin, u, v, n = Vector(origin), Vector(u), Vector(v), Vector(n)
    verts, faces = [], []
    for j in range(nv + 1):
        t = j / nv
        for i in range(nu + 1):
            s = i / nu
            verts.append(tuple(origin + u * (s * width) + v * (t * length) + n * profile(s * width, t * length)))
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            faces.append((a, a + 1, a + nu + 2, a + nu + 1))
    mesh = bpy.data.meshes.new(name + ' mesh'); mesh.from_pydata(verts, [], faces); mesh.update()
    ob = bpy.data.objects.new(name, mesh); c.scene.collection.objects.link(ob)
    mesh.materials.append(mat)
    for face in mesh.polygons: face.use_smooth = smooth
    if thickness:
        solid = ob.modifiers.new('Sheet thickness', 'SOLIDIFY'); solid.thickness = thickness; solid.offset = -1
    return ob


def slope_frame(x0, x1, y_ridge, y_eave, z_ridge, z_eave):
    """Unit vectors of a roof slope whose ridge runs along X; v points down-slope."""
    dy, dz = y_eave - y_ridge, z_eave - z_ridge
    length = math.hypot(dy, dz)
    v = Vector((0, dy / length, dz / length))
    u = Vector((1, 0, 0))
    n = u.cross(v)
    if n.z < 0: n = -n
    return u, v, n, length


def corrugated_slope(c, name, x0, x1, y_ridge, y_eave, z_ridge, z_eave, mats, seed=0, pitch=.13, sheet=.86, gap=.012):
    """Overlapping corrugated sheets with individual tilt, tone and occasional patch."""
    rng = random.Random(seed)
    u, v, n, length = slope_frame(x0, x1, y_ridge, y_eave, z_ridge, z_eave)
    x = x0
    sheets = []
    while x < x1 - .05:
        w = min(sheet * rng.uniform(.9, 1.1), x1 - x)
        lift = rng.uniform(.0, .025)
        mat = mats[rng.randrange(len(mats))]
        origin = Vector((x, y_ridge, z_ridge)) + n * (.035 + lift)
        ob = grid_surface(c, name, origin, u, v, n, w + .04, length, lambda s, t: .022 * math.sin(s / pitch * math.tau),
                          mat, nu=max(8, int(w / pitch * 6)), nv=6, thickness=.012, smooth=True)
        sheets.append(ob)
        # Rivet rows across each sheet catch the low key light.
        for k in range(1, 4):
            p = Vector((x + w / 2, y_ridge, z_ridge)) + v * (length * k / 4) + n * (.07 + lift)
            for dx in (-w * .35, 0, w * .35):
                c.cylinder('Roof sheet rivet', tuple(p + u * dx), .014, .012, mats[0], 6)
        x += w - gap
    return sheets


def shingle_slope(c, name, x0, x1, y_ridge, y_eave, z_ridge, z_eave, mats, seed=0, course=.22, tile=.30):
    rng = random.Random(seed)
    u, v, n, length = slope_frame(x0, x1, y_ridge, y_eave, z_ridge, z_eave)
    rows = max(2, int(length / course))
    base = Vector((x0, y_ridge, z_ridge))
    for r in range(rows):
        t = length - (r + 1) * course + course * .5
        offset = (r % 2) * tile * .5
        x = -offset
        while x < x1 - x0:
            w = tile * rng.uniform(.78, 1.12)
            lo, hi = max(0, x), min(x1 - x0, x + w)
            if hi - lo > .06:
                center = base + u * ((lo + hi) / 2) + v * t + n * (.05 + r * .0015 + rng.uniform(0, .012))
                ob = c.box(name, tuple(center), (hi - lo - .018, course * 1.35, .035), mats[rng.randrange(len(mats))], .01)
                q = Vector((0, 0, 1)).rotation_difference(n)
                ob.rotation_mode = 'QUATERNION'; ob.rotation_quaternion = q
            x += w
    return None


def ridge_cap(c, x0, x1, y, z, mat, radius=.07):
    ob = c.cylinder('Rolled ridge cap', ((x0 + x1) / 2, y, z + .03), radius, x1 - x0 + .06, mat, 14)
    ob.rotation_euler.y = math.pi / 2
    return ob


def gable_roof(c, x0, y0, x1, y1, eave, ridge, mats, style='corrugated', seed=0, overhang=.22):
    """Ridge runs east-west at the footprint's centre line; both slopes are real geometry."""
    ym = (y0 + y1) / 2
    ox0, ox1 = x0 - overhang, x1 + overhang
    ys, yn = y0 - overhang, y1 + overhang
    drop = (ridge - eave) * overhang / max(.1, ym - y0)
    if style == 'corrugated':
        corrugated_slope(c, 'South corrugated roof sheet', ox0, ox1, ym, ys, ridge, eave - drop, mats, seed)
        corrugated_slope(c, 'North corrugated roof sheet', ox0, ox1, ym, yn, ridge, eave - drop, mats, seed + 7)
    else:
        shingle_slope(c, 'South roof shingle', ox0, ox1, ym, ys, ridge, eave - drop, mats, seed)
        shingle_slope(c, 'North roof shingle', ox0, ox1, ym, yn, ridge, eave - drop, mats, seed + 7)
    ridge_cap(c, ox0, ox1, ym, ridge + .05, mats[0])
    for x in (ox0, ox1):
        for ye in (ys, yn):
            tube(c, 'Gable barge board', [(x, ym, ridge + .04), (x, ye, eave - drop + .03)], .045, mats[-1] if style != 'corrugated' else mats[0], 6)


def plank_wall(c, a, b, z0, z1, mat, alt=None, thickness=.12, board=.18, seed=0):
    """Vertical boards between two plan points; tops stay visible under the eaves."""
    rng = random.Random(seed)
    ax, ay = a; bx, by = b
    length = math.hypot(bx - ax, by - ay); angle = math.atan2(by - ay, bx - ax)
    count = max(1, int(length / board))
    for i in range(count):
        t = (i + .5) / count
        x, y = ax + (bx - ax) * t, ay + (by - ay) * t
        h = z1 - rng.uniform(0, .05)
        ob = c.box('Vertical wall board', (x, y, (z0 + h) / 2), (length / count - .01, thickness, h - z0), alt if (alt and i % 3 == 0) else mat, .012)
        ob.rotation_euler.z = angle


def stone_course(c, a, b, z, height, p, seed=0, depth=.42, size=.34):
    """A dry-stone plinth course; every stone is its own irregular mesh."""
    from dawn_lobby_details import rock
    rng = random.Random(seed)
    ax, ay = a; bx, by = b
    length = math.hypot(bx - ax, by - ay)
    count = max(1, int(length / size))
    angle = math.atan2(by - ay, bx - ax)
    for i in range(count):
        t = (i + .5) / count
        x, y = ax + (bx - ax) * t + rng.uniform(-.02, .02), ay + (by - ay) * t + rng.uniform(-.02, .02)
        s = rock(c, 'Dressed plinth fieldstone', (x, y, z + height * .5), (length / count * .55, depth * .5, height * .55), p, seed * 101 + i)
        s.rotation_euler.z = angle + rng.uniform(-.06, .06)


def post(c, x, y, h, p, r=.09, mat=None):
    c.box('Squared timber post', (x, y, h / 2), (r * 2, r * 2, h), mat or p['oak'], .02)
    c.box('Post end grain', (x, y, h + .01), (r * 2 - .02, r * 2 - .02, .02), p['cut'], .006)


def chimney(c, x, y, z0, z1, p, w=.62, d=.62, seed=0):
    """Stone stack with an open dark flue; the flue opening is the smoke socket."""
    from dawn_lobby_details import rock
    rng = random.Random(seed)
    slab(c, 'Chimney core', x - w / 2, y - d / 2, x + w / 2, y + d / 2, z0, z1, p['mortar'], .03)
    layers = max(2, int((z1 - z0) / .22))
    for k in range(layers):
        zz = z0 + (k + .5) * (z1 - z0) / layers
        for side in range(4):
            for j in range(2):
                ox = (j - .5) * w * .5
                pos = [(x + ox, y - d / 2), (x + d / 2 * 0 + w / 2, y + ox), (x - ox, y + d / 2), (x - w / 2, y - ox)][side]
                s = rock(c, 'Chimney stone', (pos[0], pos[1], zz), (.17, .11, .11), p, seed * 31 + k * 9 + side * 2 + j)
                s.rotation_euler.z = side * math.pi / 2 + rng.uniform(-.1, .1)
    slab(c, 'Chimney cap stone', x - w / 2 - .05, y - d / 2 - .05, x + w / 2 + .05, y + d / 2 + .05, z1, z1 + .08, p['stone'], .025)
    c.box('Soot black flue', (x, y, z1 + .085), (w * .52, d * .52, .02), p['coal'], .01)
    annulus(c, 'Sooted flue lip', (x, y, z1 + .09), w * .34, w * .26, .04, p['dark'], steps=16)


def skylight(c, x, y, z, w, l, tilt, p):
    frame = c.box('Skylight timber frame', (x, y, z), (w + .1, l + .1, .06), p['tar'], .01)
    glass = c.box('Separate window glow skylight', (x, y, z + .02), (w, l, .03), p['window'], .005)
    for ob in (frame, glass): ob.rotation_euler.x = tilt
    for k in range(1, 3):
        bar = c.box('Skylight glazing bar', (x - w / 2 + w * k / 3, y, z + .045), (.035, l, .025), p['dark'], .005)
        bar.rotation_euler.x = tilt


def counter(c, x0, y0, x1, y1, h, p, top=None):
    slab(c, 'Counter carcass', x0, y0, x1, y1, 0, h - .06, p['oak'], .02)
    slab(c, 'Worn counter top', x0 - .04, y0 - .04, x1 + .04, y1 + .04, h - .06, h, top or p['timber'], .015)
    for k in range(int((x1 - x0) / .2)):
        tube(c, 'Counter top board joint', [(x0 + (k + 1) * .2, y0 - .03, h + .002), (x0 + (k + 1) * .2, y1 + .03, h + .002)], .006, p['tar'], 4)


def timber_stack(c, x, y, length, rows, cols, p, angle=0, beam_size=.16, seed=0):
    rng = random.Random(seed)
    ca, sa = math.cos(angle), math.sin(angle)
    for r in range(rows):
        for k in range(cols - (r % 2)):
            off = (k - (cols - 1) / 2 + (r % 2) * .5) * (beam_size + .02)
            px, py = x - sa * off, y + ca * off
            ob = c.box('Stacked squared timber', (px + ca * rng.uniform(-.06, .06), py + sa * rng.uniform(-.06, .06), beam_size * (r + .5)),
                       (length * rng.uniform(.92, 1), beam_size, beam_size), p['cut'] if (r + k) % 2 else p['oak'], .015)
            ob.rotation_euler.z = angle
        if r % 2 == 0:
            for side in (-1, 1):
                c.box('Stack spacer batten', (x + ca * side * length * .38, y + sa * side * length * .38, beam_size * (r + 1)),
                      (.06, (beam_size + .02) * cols, .03), p['tar'], .005).rotation_euler.z = angle


def pallet(c, x, y, p, w=1.0, d=.8):
    for k in range(5):
        c.box('Pallet deck board', (x - w / 2 + (k + .5) * w / 5, y, .11), (w / 5 - .03, d, .025), p['timber'] if k % 2 else p['oak'], .006)
    for yy in (-d / 2 + .06, 0, d / 2 - .06):
        c.box('Pallet stringer', (x, y + yy, .05), (w, .08, .09), p['oak'], .01)


def scrap_pile(c, x, y, r, p, seed=0, height=.55):
    """A heaped mound of plates, pipes, gears and wheels; never a flat decal."""
    from dawn_parts import salvage_gear
    rng = random.Random(seed)
    # Low rusty mound under densely overlapping parts; the core never reads as a dark blob.
    c.ell('Scrap heap core', (x, y, height * .12), (r * .78, r * .66, height * .38), p['rust2'])
    sp = dict(edge=p['iron'])
    for i in range(int(42 * r / .6)):
        a = rng.uniform(0, math.tau); d = r * math.sqrt(rng.uniform(0, 1)) * .92
        px, py = x + d * math.cos(a), y + d * .85 * math.sin(a)
        z = height * max(0, 1 - (d / r) ** 2) * .62 + .04
        kind = rng.random()
        if kind < .42:
            k = rng.uniform(.8, 1.7)
            # Mesh-built parts are authored at the origin, then placed: rotation stays local.
            ob = plate(c, 'Bent scrap plate', (0, 0, 0), [(-.14 * k, -.08 * k), (.13 * k, -.1 * k), (.16 * k, .07 * k), (-.09 * k, .11 * k)], .02,
                       rng.choice((p['rust'], p['rust2'], p['iron'], p['tin'], p['olive'])), .01)
            ob.location = (px, py, z)
            ob.rotation_euler = (rng.uniform(-.6, .6), rng.uniform(-.6, .6), rng.uniform(0, math.tau))
        elif kind < .66:
            ob = c.cylinder('Scrap pipe length', (px, py, z), rng.uniform(.03, .06), rng.uniform(.3, .75), rng.choice((p['rust'], p['iron'], p['rust2'])), 10)
            ob.rotation_euler = (math.pi / 2 + rng.uniform(-.3, .3), 0, rng.uniform(0, math.tau))
        elif kind < .84:
            salvage_gear(c, (px, py, z + .02), rng.uniform(.08, .16), sp, teeth=rng.choice((8, 10, 12)))
        else:
            ob = annulus(c, 'Scrap wheel rim', (0, 0, 0), rng.uniform(.12, .2), .08, .05, rng.choice((p['rust'], p['rubber'])), steps=20)
            ob.location = (px, py, z)
            ob.rotation_euler = (rng.uniform(-.4, .4), rng.uniform(-.4, .4), 0)


def lamp_post(c, x, y, h, p, arm=(0, -.35)):
    post(c, x, y, h, p, .055, p['tar'])
    beam(c, 'Lamp bracket arm', (x, y), (x + arm[0], y + arm[1]), .04, h - .05, p['dark'])
    from dawn_lobby_details import lantern
    lantern(c, x + arm[0], y + arm[1], h - .32, p)


def strut(c, name, a, b, w, h, mat, bevel=.012):
    """A squared member between two 3-D points (rafters, chords, braces)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    ob = c.box(name, tuple((a + b) / 2), (d.length, w, h), mat, bevel)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(d)
    return ob


def ridge_tent(c, x0, x1, y0, y1, z_ridge, z_eave, mat, p, poles=3, seed=0):
    """Two-slope fabric tent: sag between ridge poles, raised panel seams, hems, guy ropes.

    Reads as cloth from above through the ridge line, the catenary sag and the seams.
    """
    rng = random.Random(seed)
    ym = (y0 + y1) / 2
    span = x1 - x0
    pole_x = [x0 + span * k / (poles - 1) for k in range(poles)]
    def sag(s):
        # Low between poles, pinned at each pole.
        t = (s / span) * (poles - 1)
        return -.11 * math.sin(math.pi * (t - math.floor(t)))
    for y_eave in (y0, y1):
        dy, dz = y_eave - ym, z_eave - z_ridge
        length = math.hypot(dy, dz)
        v = Vector((0, dy / length, dz / length)); u = Vector((1, 0, 0)); n = u.cross(v)
        if n.z < 0: n = -n
        grid_surface(c, 'Tent fabric slope', (x0, ym, z_ridge), u, v, n, span, length,
                     lambda s, t: sag(s) * (1 - .4 * t / length) + .018 * math.sin(s * 5.3 + t * 3) * (t / length)
                     - .03 * math.exp(-((t / length - .55) / .18) ** 2) * math.sin(s * 2.1), mat, 64, 20, .014)
        # Raised seams down the slope at each panel joint, and a rolled hem at the eave.
        for k in range(1, 4):
            s = span * k / 4
            pts = [Vector((x0 + s, ym, z_ridge)) + v * (length * t) + n * (sag(s) * (1 - .4 * t) + .02) for t in [i / 6 for i in range(7)]]
            tube(c, 'Tent panel seam', [tuple(q) for q in pts], .014, mat, 6)
        eave = [Vector((x0 + span * i / 16, ym, z_ridge)) + v * length + n * (sag(span * i / 16) * .6 + .01) for i in range(17)]
        tube(c, 'Tent eave hem', [tuple(q) for q in eave], .03, p['rope'], 6)
        for i in range(0, 17, 4):
            q = eave[i]
            out = Vector((0, .55 if y_eave > ym else -.55, 0))
            peg = q + out + Vector((0, 0, -q.z + .05))
            tube(c, 'Tent guy rope', [tuple(q), tuple(peg)], .01, p['rope'], 4)
            c.cylinder('Tent peg', tuple(peg), .03, .14, p['oak'], 6)
    tube(c, 'Tent ridge seam', [(x0 - .05, ym, z_ridge + .03), (x1 + .05, ym, z_ridge + .03)], .03, mat, 8)
    for x in pole_x:
        c.cylinder('Tent pole', (x, ym, z_ridge / 2), .045, z_ridge, p['oak'], 10)
        c.ell('Tent pole finial', (x, ym, z_ridge + .06), (.06, .06, .05), p['brass'])
    for k in range(3):
        px = rng.uniform(x0 + .5, x1 - .5)
        py = ym + rng.choice((-1, 1)) * rng.uniform(.3, .6)
        zz = z_ridge - (z_ridge - z_eave) * abs(py - ym) / ((y1 - y0) / 2) + .03
        patch = plate(c, 'Sewn tent patch', (0, 0, 0), [(-.2, -.15), (.19, -.13), (.21, .14), (-.17, .16)], .008, p['canvas'], .004)
        patch.location = (px, py, zz)
        patch.rotation_euler.x = math.atan2(z_ridge - z_eave, (y1 - y0) / 2) * (1 if py < ym else -1)


def shop_cuirass(c, x, y, z, p, s=1.0):
    """Leather cuirass laid flat, front up: shoulder plates, hex badge, belt; mirrors the shop icon."""
    def place(ob, dx, dy, dz=0):
        ob.location = (x + dx * s, y + dy * s, z + dz); return ob
    body = [(-.26, .3), (-.12, .36), (0, .3), (.12, .36), (.26, .3), (.3, .05), (.27, -.3), (-.27, -.3), (-.3, .05)]
    place(plate(c, 'Cuirass leather body', (0, 0, 0), [(a * s, b * s) for a, b in body], .07, p['leather'], .025), 0, 0, .035)
    place(plate(c, 'Cuirass neck opening', (0, 0, 0), [(-.1 * s, .3 * s), (0, .24 * s), (.1 * s, .3 * s), (0, .34 * s)], .02, p['dark'], .004), 0, 0, .075)
    for side in (-1, 1):
        sh = plate(c, 'Cuirass steel shoulder plate', (0, 0, 0), [(-.11 * s, -.09 * s), (.11 * s, -.1 * s), (.13 * s, .08 * s), (-.1 * s, .11 * s)], .05, p['plate_steel'], .02)
        place(sh, side * .3, .22, .09); sh.rotation_euler.z = side * .25
        for k in range(3): place(c.cylinder('Cuirass rivet', (0, 0, 0), .014 * s, .012, p['brass'], 6), side * (.24 + k * .045), .16 + k * .06, .12)
    hexagon = [(.09 * s * math.cos(a), .09 * s * math.sin(a)) for a in [k * math.pi / 3 + math.pi / 6 for k in range(6)]]
    place(plate(c, 'Cuirass hex steel badge', (0, 0, 0), hexagon, .04, p['plate_steel'], .012), 0, .02, .09)
    place(c.box('Cuirass belt', (0, 0, 0), (.58 * s, .07 * s, .03), p['tar'], .006), 0, -.22, .085)
    place(c.box('Cuirass belt buckle', (0, 0, 0), (.08 * s, .08 * s, .03), p['plate_steel'], .006), 0, -.22, .1)
    for dx, dy in [(-.17, .0), (.15, -.1)]:
        place(c.ell('Cuirass moss patch', (0, 0, 0), (.05 * s, .035 * s, .01), p['shop_moss']), dx, dy, .075)


def shop_helmet(c, x, y, z, p, s=1.0):
    c.ell('Helmet leather dome', (x, y, z + .1 * s), (.2 * s, .23 * s, .15 * s), p['leather'])
    annulus(c, 'Helmet steel brow band', (x, y, z + .06 * s), .205 * s, .175 * s, .05 * s, p['plate_steel'], steps=28)
    tube(c, 'Helmet steel crest band', [(x, y + .22 * s, z + .07 * s), (x, y + .1 * s, z + .22 * s), (x, y - .1 * s, z + .22 * s), (x, y - .23 * s, z + .07 * s)], .035 * s, p['plate_steel'], 8)
    c.box('Helmet nasal guard', (x, y - .24 * s, z + .05 * s), (.07 * s, .1 * s, .1 * s), p['plate_steel'], .01)
    for side in (-1, 1):
        c.box('Helmet cheek guard', (x + side * .15 * s, y - .17 * s, z + .04 * s), (.08 * s, .12 * s, .08 * s), p['leather'], .015)
    c.ell('Helmet moss patch', (x + .06 * s, y + .08 * s, z + .23 * s), (.06 * s, .05 * s, .015), p['shop_moss'])


def shop_glove(c, x, y, z, p, s=1.0, mirror=1):
    hand = [(-.09, -.16), (.09, -.16), (.11, .02), (.12, .1), (.08, .2), (.03, .22), (-.02, .21), (-.07, .19), (-.11, .12), (-.17, .06), (-.15, -.02)]
    ob = plate(c, 'Gauntlet leather hand', (0, 0, 0), [(a * s * mirror, b * s) for a, b in hand], .06, p['leather'], .02)
    ob.location = (x, y, z + .03)
    for k in range(3):
        c.box('Gauntlet knuckle plate', (x + (k - 1) * .055 * s * mirror, y + .13 * s, z + .07), (.045 * s, .05 * s, .02), p['plate_steel'], .005)
    c.box('Gauntlet cuff', (x, y - .17 * s, z + .05), (.22 * s, .08 * s, .06), p['tar'], .01)


def shop_boot(c, x, y, z, p, s=1.0, mirror=1):
    """Boot laid on its side: shaft and foot as an L, steel shin plate and toe cap."""
    boot = [(-.09, .26), (.08, .26), (.08, -.06), (.24, -.12), (.25, -.22), (-.1, -.22)]
    ob = plate(c, 'Boot leather profile', (0, 0, 0), [(a * s * mirror, b * s) for a, b in boot], .1, p['leather'], .025)
    ob.location = (x, y, z + .05)
    c.box('Boot steel shin plate', (x, y + .1 * s, z + .11), (.12 * s, .16 * s, .02), p['plate_steel'], .006)
    c.box('Boot steel toe cap', (x + .19 * s * mirror, y - .17 * s, z + .11), (.1 * s, .08 * s, .02), p['plate_steel'], .006)
    for k in range(2):
        c.box('Boot strap', (x, y + (.18 - k * .12) * s, z + .105), (.19 * s, .025 * s, .015), p['tar'], .004)
    c.box('Boot sole', (x + .07 * s * mirror, y - .225 * s, z + .05), (.36 * s, .035 * s, .1), p['dark'], .006)


def socket(c, name, x, y, z):
    ob = bpy.data.objects.new('Socket ' + name, None)
    ob.location = (x, y, z)
    c.scene.collection.objects.link(ob)
    return ob
