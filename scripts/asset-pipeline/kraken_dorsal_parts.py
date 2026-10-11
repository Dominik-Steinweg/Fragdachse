"""Kraken V8 head, domed spear mantle, segmented keel, muscle plates, fins and oral crown.

Model space: +Y is forward (mouth), the spear tip points south. z = 0 is the
waterline used by the elevation pass; the mantle rides high, the arms dip in and out.
Large forms are geometry (they must survive 320 px); folds come from displacement,
pores and pigment from the material.
"""
import math
import bpy
import bmesh
from mathutils import Vector, noise
from recipes_v2.enemy_parts_a import horn, smooth_path, outward_normals
from kraken_skin_v8 import paint_pattern, write_rest

# (y, half width, centre z, half height) from the oral front to the spear tip.
SECTIONS = [
    (2.10, .06, .50, .05), (1.95, .44, .50, .32), (1.70, .76, .50, .48),
    (1.42, .84, .52, .52), (1.12, .74, .50, .50), (.82, .76, .46, .54),
    (.30, 1.00, .44, .66), (-.40, 1.04, .42, .66), (-1.20, .96, .38, .57),
    (-2.00, .72, .33, .43), (-2.70, .39, .27, .26), (-3.25, .05, .24, .05),
]
MAIN_EYE = (.36, 1.66, .15)
SECOND_EYE = (.58, 1.40, .12)
DOME = .72  # < 1 gives fuller, steeper mantle flanks than an ellipse


def section_sampler():
    points, heights = smooth_path([(w, y, z) for y, w, z, h in SECTIONS], [h for y, w, z, h in SECTIONS], steps=10)

    def section(y):
        for i in range(len(points) - 1):
            a, b = points[i], points[i + 1]
            if b[1] <= y <= a[1] or a[1] <= y <= b[1]:
                t = (y - a[1]) / ((b[1] - a[1]) or 1)
                return a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t, heights[i] + (heights[i + 1] - heights[i]) * t
        return .04, .3, .03
    return points, heights, section


def relief(x, y, w):
    """Broad muscle relief: paired lateral furrows and eye sockets."""
    across = abs(x) / max(w, .05)
    swell = .025 * noise.noise(Vector((x * 2.6, y * 2.6, 7)))
    body = max(0, min(1, (1.05 - y) / .35))  # furrows only behind the head
    furrow = .05 * math.exp(-((across - .58) / .07) ** 2) * body
    sockets = 0
    for ex, ey, er in (MAIN_EYE, SECOND_EYE):
        for side in (-1, 1):
            d2 = ((x - side * ex) ** 2 + (y - ey) ** 2) / (er * 1.45) ** 2
            sockets += er * .62 * math.exp(-d2 * 1.6)
    return swell - furrow - sockets


def mantle(c, material):
    points, heights, section = section_sampler()

    def surface(x, y):
        w, z, h = section(y)
        crown = math.sqrt(max(0, 1 - (x / max(w, .01)) ** 2))
        return z + (h + relief(x, y, w)) * crown ** DOME

    vertices, faces, sides = [], [], 80
    for (w, y, z), h in zip(points, heights):
        for j in range(sides):
            a = math.tau * j / sides
            x = w * math.cos(a)
            s = math.sin(a)
            lift = (h + relief(x, y, w)) * s ** DOME if s > 0 else h * .7 * s
            vertices.append((x, y, z + lift))
    for i in range(len(points) - 1):
        for j in range(sides):
            faces.append((i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j))
    faces.extend([tuple(range(sides - 1, -1, -1)), tuple((len(points) - 1) * sides + j for j in range(sides))])
    mesh = bpy.data.meshes.new('Kraken V8 head and spear mantle')
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(mesh.name, mesh)
    c.scene.collection.objects.link(ob)
    return ob, surface, section


KEEL = [(.88 - k * .37, 1 - k * .065) for k in range(11)]
SPINES = (1, 3, 6, 9)


def keel_scute(c, y, size, surface, material):
    """A rearward lance-shaped plate, broad at its living root and ridged along its axis."""
    vertices, faces = [], []
    rings, sides = 16, 24
    for i in range(rings + 1):
        t = i / rings
        py = y + .23 * size - .65 * size * t
        # Broad anterior shoulders converge into an elongated posterior point.
        profile = min(1, t / .22) * max(0, (1 - t) / .78) ** 1.15
        width = .006 + .29 * size * profile
        for j in range(sides):
            angle = math.tau * j / sides
            x = width * math.cos(angle)
            top = max(0, math.sin(angle))
            z = surface(x, py) - .035 * size
            z += (.035 + .17 * math.sin(math.pi * t)) * size * top ** 2.8
            z += min(0, math.sin(angle)) * .035 * size
            vertices.append((x, py, z))
    for i in range(rings):
        for j in range(sides):
            faces.append((i * sides + j, i * sides + (j + 1) % sides,
                          (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j))
    faces.extend([tuple(range(sides - 1, -1, -1)), tuple(rings * sides + j for j in range(sides))])
    mesh = bpy.data.meshes.new('Ridged overlapping keel scute')
    mesh.from_pydata(vertices, [], faces)
    outward_normals(mesh)
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    ob = bpy.data.objects.new(mesh.name, mesh)
    c.scene.collection.objects.link(ob)
    paint_pattern(ob, lambda p, n: (.22 + .55 * max(0, n.z) ** 3, .10 * max(0, n.z) ** 4, .10))
    write_rest(ob)
    return ob


def dorsal(c, surface, section, material, horn_material, arm_roots):
    """Returns (tissue to fuse, separate bony keel parts, crest polylines for the value plan)."""
    tissue, bones, crests = [], [], []
    # Fleshy keel ridge (fused) carrying a row of pale bony scutes (separate, crisp).
    for k, (y, f) in enumerate(KEEL):
        z = surface(0, y)
        ridge = c.ell('Keel muscle', (0, y, z - .035 * f), (.21 * f, .32 * f, .115 * f), material)
        tissue.append(ridge)
        scute = keel_scute(c, y, f, surface, horn_material)
        bones.append(scute)
        crests.append([(0, y + .17 * f), (0, y - .2 * f)])
        if k in SPINES:
            top = z + .07 * f
            pts = [(0, y + .08, top - .11), (0, y, top + .02), (0, y - .13 * f, top + .24 * f), (0, y - .36 * f, top + .39 * f), (0, y - .58 * f, top + .41 * f)]
            spine = horn(c, 'Rearward keel spine', pts, [.12 * f, .10 * f, .067 * f, .026 * f, .002], horn_material, sides=20)
            paint_pattern(spine, lambda p, n, base=top, f=f: (.15 + .70 * min(1, max(0, (p.z - base) / (.42 * f))), .15, .12))
            write_rest(spine)
            bones.append(spine)
    # Overlapping diamond scales in staggered rows, pointing back and outward like armour.
    for row, (across, size) in enumerate([(.20, 1), (.38, .92), (.56, .80), (.73, .66)]):
        for k in range(16):
            y = .78 - k * .26 - (.13 if row % 2 else 0)
            w, _, _ = section(y)
            if w < .22 or y > .95:
                continue
            s = size * min(1, w / .85) * (1 + .10 * noise.noise(Vector((row * 1.3, k * .9, 3))))
            for side in (-1, 1):
                x = side * across * w
                scale = c.ell('Mantle armour scale', (x, y, surface(x, y) - .03 * s), (.13 * s, .19 * s, .045 * s), material)
                scale.rotation_euler = (-.20, side * .10, side * (.42 + .12 * row))
                tissue.append(scale)
    # Muscular shoulders where each arm leaves the head: the arm roots sink into these.
    for (p0, p1) in arm_roots:
        p0, p1 = Vector(p0), Vector(p1)
        d = (p1 - p0).normalized()
        centre = p0 + d * .45
        shoulder = c.ell('Arm shoulder tissue', tuple(centre), (.46, .32, .26), material)
        shoulder.rotation_euler.z = math.atan2(d.y, d.x)
        tissue.append(shoulder)
    return tissue, bones, crests


def face_ridges(c, surface, material):
    """Cthulhu skull: brow lines converging in a V over the snout, cheek ridges towards the beard."""
    tissue, crests = [], []
    for side in (-1, 1):
        lines = [
            ([(side * .66, 1.56), (side * .40, 1.46), (side * .16, 1.28), (0, 1.10)], [.010, .065, .060, .010]),
            ([(side * .70, 1.44), (side * .58, 1.70), (side * .40, 1.90), (side * .18, 2.02)], [.010, .070, .060, .012]),
        ]
        for xy, radii in lines:
            pts = [(x, y, surface(x, y) - r * .2) for (x, y), r in zip(xy, radii)]
            tissue.append(horn(c, 'Skull ridge', pts, radii, material, sides=16))
            crests.append(xy)
    return tissue, crests


def fuse(c, parts, material, voxel=.014):
    """One closed, continuous skin for mantle, keel, plates, shoulders and eye sockets."""
    bpy.context.view_layer.update()
    for part in parts:
        bpy.context.view_layer.objects.active = part
        bpy.ops.object.select_all(action='DESELECT')
        part.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:
        part.select_set(True)
    skin = parts[0]
    bpy.context.view_layer.objects.active = skin
    bpy.ops.object.join()
    skin.name = 'Kraken V8 continuous head, mantle and keel'
    remesh = skin.modifiers.new('Fuse organic tissue', 'REMESH')
    remesh.mode, remesh.voxel_size, remesh.adaptivity, remesh.use_smooth_shade = 'VOXEL', voxel, 0, True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    bm = bmesh.new()
    bm.from_mesh(skin.data)
    pending, islands = set(bm.verts), []
    while pending:
        stack, group = [pending.pop()], []
        while stack:
            vertex = stack.pop()
            group.append(vertex)
            for edge in vertex.link_edges:
                other = edge.other_vert(vertex)
                if other in pending:
                    pending.remove(other)
                    stack.append(other)
        islands.append(group)
    for group in sorted(islands, key=len, reverse=True)[1:]:
        if len(group) > 32:
            raise ValueError('Detached mantle tissue after fusion')
        bmesh.ops.delete(bm, geom=group, context='VERTS')
    bm.to_mesh(skin.data)
    bm.free()
    # Corrective smoothing fairs voxel steps and the tissue unions, keeping the large forms.
    smooth = skin.modifiers.new('Faired tissue unions', 'CORRECTIVE_SMOOTH')
    smooth.factor, smooth.iterations, smooth.smooth_type = .6, 6, 'LENGTH_WEIGHTED'
    smooth.use_only_smooth = True
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    skin.data.materials.clear()
    skin.data.materials.append(material)
    for polygon in skin.data.polygons:
        polygon.material_index, polygon.use_smooth = 0, True
    skin['anatomyRole'] = 'mantle'
    return skin


def ridge_distance(x, y, lines):
    best = 9
    for line in lines:
        for (ax, ay), (bx, by) in zip(line, line[1:]):
            dx, dy = bx - ax, by - ay
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / ((dx * dx + dy * dy) or 1)))
            best = min(best, math.hypot(x - ax - t * dx, y - ay - t * dy))
    return best


def paint_mantle(ob, section, lines, sockets=()):
    def sampler(p, n):
        w, _, _ = section(p.y)
        across = abs(p.x) / max(w, .05)
        flank = min(1, max(0, (across - .20) / .50)) ** 1.15
        head = max(0, min(1, (p.y - .95) / .5))
        flank *= 1 - .35 * head
        # Pale crests on keel plates, muscle plates and brows read as structure on the saddle.
        crest = math.exp(-(ridge_distance(p.x, p.y, lines) / .05) ** 2) * max(0, n.z) ** 2
        rim = max(.35 * max(0, (across - .9) / .1), .55 * crest)
        # Deep eye sockets read as dark hollows around the glowing irises.
        for sx, sy, sr in sockets:
            d = math.hypot(p.x - sx, p.y - sy) / (sr * 1.7)
            flank *= 1 - .75 * math.exp(-d * d * 2)
            rim *= 1 - math.exp(-d * d * 2)
        return flank, rim, across
    paint_pattern(ob, sampler)


def fins(c, section, surface, material, spike_material=None):
    """Closed living fins: thickened rays grow into swept spines in the same surface.

    The membrane, the ray roots and the tips share vertices. No separate rods
    cross a thin sheet or leave visible insertion caps on the lower mantle.
    """
    objects = []
    rows, cols, scallops = 156, 20, 6.5
    y0, y1 = .55, -3.05
    for side in (-1, 1):
        vertices, faces, pattern = [], [], []

        def edge_point(t, s, layer):
            y = y0 + (y1 - y0) * t
            w, _, _ = section(y)
            # The rear arms sweep across the upper flank. Keep this part of the
            # fin buried in the mantle and let its visible fan open behind them.
            flare = min(1, max(0, (t - .45) / .23))
            flare = flare * flare * (3 - 2 * flare)
            extent = .48 * math.sin(math.pi * min(1, t * 1.08)) ** .8
            scallop = 1 - .32 * abs(math.sin(math.pi * scallops * t)) ** 1.5
            gate = min(1, max(0, (t - .055) / .08)) * min(1, max(0, (.95 - t) / .12))
            ray = math.exp(-(math.sin(math.pi * scallops * t) / (.23 - .15 * s)) ** 2) * gate
            x = w * .74 + (w * (.10 + .16 * flare) + extent * scallop * flare) * s + .15 * ray * s ** 5 * flare
            inner_z = surface(w * .74, y) - .13
            pleat = math.cos(math.tau * scallops * t)
            # Fin lies below the arm crown. Its fleshy root is buried well inside
            # the mantle; depth and thickness taper continuously towards the rim.
            z = inner_z + (.105 - inner_z) * s ** .72 + .018 * pleat * s
            thickness = .012 + .052 * ray * math.sin(math.pi * s) ** .7
            return Vector((side * x, y - .13 * ray * s ** 3, z + layer * thickness)), ray

        stride = (rows + 1) * (cols + 1)
        for layer in (1, -1):
            offset = len(vertices)
            for i in range(rows + 1):
                for j in range(cols + 1):
                    s = j / cols
                    point, ray = edge_point(i / rows, s, layer)
                    vertices.append(tuple(point))
                    pattern.append((.42 + .42 * s, .62 * s ** 1.8 * (1 - .48 * ray), .45))
            for i in range(rows):
                for j in range(cols):
                    a = offset + i * (cols + 1) + j
                    faces.append((a, a + 1, a + cols + 2, a + cols + 1))
        for i in range(rows):
            for j in (0, cols):
                a, b = i * (cols + 1) + j, (i + 1) * (cols + 1) + j
                faces.append((a, b, b + stride, a + stride))
        for j in range(cols):
            for i in (0, rows):
                a, b = i * (cols + 1) + j, i * (cols + 1) + j + 1
                faces.append((a, b, b + stride, a + stride))
        mesh = bpy.data.meshes.new('Kraken continuous fin and grown spines')
        mesh.from_pydata(vertices, [], faces)
        outward_normals(mesh)
        mesh.materials.append(material)
        for p in mesh.polygons:
            p.use_smooth = True
        ob = bpy.data.objects.new(mesh.name, mesh)
        c.scene.collection.objects.link(ob)
        sub = ob.modifiers.new('Faired fin rays and spine roots', 'SUBSURF')
        sub.levels = sub.render_levels = 1
        attr = mesh.color_attributes.new(name='FD_Pattern', type='FLOAT_COLOR', domain='POINT')
        for value, (r, g, b) in zip(attr.data, pattern):
            value.color = (r, g, b, 1)
        write_rest(ob)
        ob['anatomyRole'] = 'mantle-fin'
        objects.append(ob)
    return objects


def oral_crown(c, surface, material):
    """Ten tapered feeding tendrils grow forward from a continuous facial hood.

    Returns (tentacle meshes to fuse into the skull, centre lines [(point, radius, t)]).
    Roots start deep in the jowls and swell, so the voxel union grows them out of the face.
    """
    objects, lines = [], []
    for side in (-1, 1):
        for j, (bx, by) in enumerate([(.06, 2.00), (.16, 1.98), (.27, 1.93), (.38, 1.84), (.48, 1.72)]):
            spread = .20 + .055 * j
            reach = .85 - .055 * j
            asymmetry = .018 * math.sin(j * 2.1 + side)
            pts = [(side * bx * .7, by - .16, surface(bx * .7, by - .16) - .20),
                   (side * bx, by, surface(bx, by) - .06),
                   (side * (bx + spread * .35), by + reach * .35, .78 - .014 * j),
                   (side * (bx + spread * .85), by + reach * .74 + asymmetry, .68 - .010 * j),
                   (side * (bx + spread * .65), by + reach + asymmetry, .54),
                   (side * (bx + spread * .20), by + reach * .97 + asymmetry, .47)]
            radii = [.15 - .01 * j, .125 - .010 * j, .085 - .006 * j, .051 - .003 * j, .022, .003]
            objects.append(horn(c, 'Bearded oral tentacle', pts, radii, material, sides=20))
            centres, widths = smooth_path(pts, radii, steps=6)
            for k, (p, r) in enumerate(zip(centres, widths)):
                lines.append((Vector(p), r, k / (len(centres) - 1)))
    return objects, lines


def colour_beard(ob, lines, oral_material):
    """After fusion: beard skin gets the crimson oral material, graded from the face outwards."""
    from mathutils.kdtree import KDTree
    tree = KDTree(len(lines))
    for i, (p, r, t) in enumerate(lines):
        tree.insert(p, i)
    tree.balance()
    mesh = ob.data
    attr = mesh.color_attributes['FD_Pattern']
    beard = [False] * len(mesh.vertices)
    for v in mesh.vertices:
        if v.co.y < 1.5:
            continue
        _, i, dist = tree.find(v.co)
        p, r, t = lines[i]
        if dist < r + .03 and t > .14:
            beard[v.index] = True
            grade = min(1, max(0, (t - .14) / .6))
            attr.data[v.index].color = (grade * .85, .05 * grade, .25, 1)
    slot = len(mesh.materials)
    mesh.materials.append(oral_material)
    for polygon in mesh.polygons:
        if sum(beard[i] for i in polygon.vertices) * 2 > len(polygon.vertices):
            polygon.material_index = slot
