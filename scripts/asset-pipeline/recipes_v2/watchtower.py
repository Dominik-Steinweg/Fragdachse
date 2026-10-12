"""Open timber watchtower, concept B: a quiet floor over a real braced structure.

One BU is 32 display pixels: 72 px canvas / 2.25 BU orthoScale.
The deck fills the centred 64 px footprint; the canvas preserves small footing
and ladder overhangs. These art dimensions do not define gameplay collision.
"""
import bpy
import json
import random
from mathutils import Vector
from weapon_surface_parts import material, paint_depth


def linear(rgb):
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
                 for v in (channel / 255 for channel in rgb))


def weathering(mat, floor=False, endgrain=False, iron=False, cracks=False, stone=False):
    """Medium-frequency wear on the existing geometry; no baked light or decals."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bs = nodes['Principled BSDF']
    color = bs.inputs['Base Color'].links[0].from_socket

    def node(kind, label):
        n = nodes.new(kind)
        n.name = n.label = label
        return n

    def plug(value, socket):
        if isinstance(value, (float, int, tuple)):
            socket.default_value = value
        else:
            links.new(value, socket)

    def calc(op, a, b):
        n = node('ShaderNodeMath', 'Weathering '+op)
        n.operation = op
        plug(a, n.inputs[0]); plug(b, n.inputs[1])
        return n.outputs[0]

    def remap(value, low, high, a=0, b=1):
        n = node('ShaderNodeMapRange', 'Soft weathering mask')
        n.clamp = True
        for key, v in [('Value', value), ('From Min', low), ('From Max', high), ('To Min', a), ('To Max', b)]:
            plug(v, n.inputs[key])
        return n.outputs[0]

    def mix(a, b, fac, mode='MIX'):
        n = node('ShaderNodeMixRGB', 'Weathered timber colour')
        n.blend_type = mode
        plug(fac, n.inputs[0]); plug(a, n.inputs[1]); plug(b, n.inputs[2])
        return n.outputs[0]

    coords = node('ShaderNodeTexCoord', 'Wear coordinates')
    local = node('ShaderNodeSeparateXYZ', 'Timber end distances')
    links.new(coords.outputs['Generated'], local.inputs[0])
    geom = node('ShaderNodeNewGeometry', 'World wear position')
    world = node('ShaderNodeSeparateXYZ', 'Deck wear axes')
    links.new(geom.outputs['Position'], world.inputs[0])
    noise = node('ShaderNodeTexNoise', 'Broad irregular wear patches')
    noise.inputs['Scale'].default_value = 13
    noise.inputs['Detail'].default_value = 2
    links.new(geom.outputs['Position'], noise.inputs['Vector'])
    irregular = remap(noise.outputs['Fac'], .27, .74)
    dx = calc('MINIMUM', local.outputs['X'], calc('SUBTRACT', 1, local.outputs['X']))
    dy = calc('MINIMUM', local.outputs['Y'], calc('SUBTRACT', 1, local.outputs['Y']))
    edge = remap(calc('MINIMUM', dx, dy), .008, .10, 1, 0)
    # Centimetre-scale colonies stay broad enough to survive the 32 px/m export.
    colony = node('ShaderNodeTexNoise', 'Broken moss colonies')
    colony.inputs['Scale'].default_value = 8
    colony.inputs['Detail'].default_value = 1.3
    links.new(geom.outputs['Position'], colony.inputs['Vector'])
    moss_patch = remap(colony.outputs['Fac'], .44, .66)
    perimeter = remap(calc('MAXIMUM', calc('ABSOLUTE', world.outputs['X'], 0),
                          calc('ABSOLUTE', world.outputs['Y'], 0)), .60, .83)
    moss_color = mix((*linear((76, 99, 46)), 1), (*linear((113, 127, 65)), 1), irregular)
    if iron:
        # Broken rust rim and rubbed charcoal faces, also on the nail heads.
        rust = calc('MULTIPLY', calc('MAXIMUM', calc('MULTIPLY', edge, .8), .14), irregular)
        color = mix(color, (*linear((133, 77, 39)), 1), rust)
    elif stone:
        damp = remap(world.outputs['Z'], .04, .24, 1, .25)
        color = mix(color, moss_color, calc('MULTIPLY', damp, moss_patch))
    else:
        # Intermittent pale fibres break the perfect bevel; no bright outline.
        chipped = calc('MULTIPLY', edge, remap(irregular, .58, .88, 0, .42))
        color = mix(color, (*linear((171, 156, 127)), 1), chipped)
        if endgrain:
            # Exposed post crowns are cross-cut timber, not longitudinal flooring.
            centre = node('ShaderNodeVectorMath', 'Endgrain pith')
            centre.operation = 'SUBTRACT'
            centre.inputs[1].default_value = (.38, .57, 0)
            links.new(coords.outputs['Generated'], centre.inputs[0])
            grain = node('ShaderNodeTexWave', 'Coarse endgrain rings')
            grain.wave_type = 'RINGS'
            grain.rings_direction = 'Z'
            grain.inputs['Scale'].default_value = 3
            grain.inputs['Distortion'].default_value = 1.7
            links.new(centre.outputs[0], grain.inputs['Vector'])
            color = mix(color, remap(grain.outputs['Fac'], 0, 1, .55, .98), .58, 'MULTIPLY')
        if floor:
            dirt = calc('MULTIPLY', edge, calc('ADD', .28, calc('MULTIPLY', irregular, .28)))
            color = mix(color, (*linear((71, 60, 42)), 1), dirt)
            if cracks:
                # Sparse tapered end splits, millimetres wide; the albedo supplies
                # the less regular surrounding fibres without changing the mesh.
                centre = calc('ADD', .43, calc('MULTIPLY', irregular, .08))
                width = calc('MULTIPLY', remap(dx, 0, .15, 1, 0), .025)
                fissure = calc('LESS_THAN', calc('ABSOLUTE', calc('SUBTRACT', local.outputs['Y'], centre), 0), width)
                color = mix(color, (*linear((66, 53, 36)), 1), calc('MULTIPLY', fissure, .8))

            def oval(x, y, sx, sy):
                # Broad colony noise also breaks the wear contour by a few cm;
                # this is a rubbed surface, not a precisely painted path.
                drift = calc('MULTIPLY', calc('SUBTRACT', colony.outputs['Fac'], .5), .16)
                a = calc('DIVIDE', calc('SUBTRACT', calc('ADD', world.outputs['X'], drift), x), sx)
                b = calc('DIVIDE', calc('SUBTRACT', world.outputs['Y'], y), sy)
                d = calc('ADD', calc('MULTIPLY', a, a), calc('MULTIPLY', b, b))
                return remap(d, .15, 1.0, 1, 0)

            # Broad pale tread from the southern ladder into the middle.
            tread = calc('MAXIMUM', oval(-.025, -.47, .32, .72), oval(.055, .025, .51, .43))
            # A broad, rubbed grey core flattens grain, with soft tracked dirt
            # outside it. Material coordinates keep wear continuous across joins.
            apron = calc('MAXIMUM', oval(-.015, -.47, .40, .80), oval(.035, .035, .59, .53))
            dirt_rim = calc('MULTIPLY', calc('SUBTRACT', apron, tread), .25)
            color = mix(color, (*linear((91, 81, 62)), 1), dirt_rim)
            wear = calc('MULTIPLY', tread, calc('ADD', .48, calc('MULTIPLY', irregular, .18)))
            color = mix(color, (*linear((197, 184, 155)), 1), wear)
            bump = nodes['Tactile grain and machining']
            links.new(calc('MULTIPLY', calc('SUBTRACT', 1, wear), .08), bump.inputs['Strength'])
            stain = calc('MAXIMUM', oval(-.47, .40, .25, .18), oval(.48, -.27, .17, .24))
            stain = calc('MULTIPLY', stain, calc('ADD', .16, calc('MULTIPLY', irregular, .20)))
            color = mix(color, (*linear((82, 77, 56)), 1), stain)
            refuge = calc('MAXIMUM', perimeter, calc('MULTIPLY', edge, .65))
            moss_mask = calc('MULTIPLY', calc('MULTIPLY', refuge, moss_patch),
                             calc('SUBTRACT', 1, remap(tread, 0, .18)))
            color = mix(color, moss_color, calc('MULTIPLY', moss_mask, .90))
        else:
            # Hand-rubbed, grey exposed crowns with irregular dark patches.
            worn = remap(irregular, .3, .8, 0, .28)
            color = mix(color, (*linear((188, 174, 145)), 1), worn)
            # Damp post feet, exposed joist ends and patches on unhandled rails.
            damp = remap(world.outputs['Z'], .2, 1.9, 1, .35)
            moss_mask = calc('MULTIPLY', calc('MULTIPLY', perimeter, moss_patch), damp)
            color = mix(color, moss_color, calc('MULTIPLY', moss_mask, .90))
    links.new(color, bs.inputs['Base Color'])


def surface(ctx, name, rgb, kind, floor=False, endgrain=False, cracks=False):
    # The shared finish starts with Authoring.material(..., 'technical').
    mat = material(ctx, name, linear(rgb), 0, kind)
    nodes = mat.node_tree.nodes
    nodes['Uneven material finish'].inputs[0].default_value = .10 if kind == 'wood' else .30
    nodes['Tactile grain and machining'].inputs['Strength'].default_value = .08
    nodes['Contact dirt in seams'].inputs['Distance'].default_value = .065
    if kind == 'wood':
        # Original generated albedo, packed by the pipeline. Explicit UVs keep
        # the fibres longitudinal at a physical scale, independent of part size.
        tex = next(n for n in nodes if n.type == 'TEX_IMAGE')
        tex.image = ctx.images['wood']
        tex.extension = 'REPEAT'
        uv = nodes.new('ShaderNodeTexCoord')
        mat.node_tree.links.new(uv.outputs['UV'], tex.inputs['Vector'])
        remap = next(n for n in nodes if n.type == 'MAP_RANGE')
        remap.inputs['From Min'].default_value = .08
        remap.inputs['From Max'].default_value = .38
        remap.inputs['To Min'].default_value = .48
        remap.inputs['To Max'].default_value = 1.65
        nodes['Longitudinal walnut fibres direction'].inputs[1].default_value = (.6, 16, 5)
        nodes['Restrained exposed grain'].inputs[1].default_value = .025
        nodes['Surface-specific scoring'].inputs[1].default_value = .012
        nodes['Material edge abrasion'].inputs[1].default_value = .18
        mat.node_tree.links.new(tex.outputs['Color'], nodes['Tactile grain and machining'].inputs['Height'])
    elif kind == 'steel':
        nodes['Scraped and polished streaks'].inputs[2].default_value = (*linear((119, 90, 66)), 1)
        nodes['Surface-specific scoring'].inputs[1].default_value = .08
        nodes['Material edge abrasion'].inputs[1].default_value = .28
    else:
        nodes['Machining and handling streaks'].inputs['Scale'].default_value = 26
        nodes['Machining and handling streaks direction'].inputs[1].default_value = (1, 1, 1)
        nodes['Surface-specific scoring'].inputs[1].default_value = .015
        nodes['Tactile grain and machining'].inputs['Strength'].default_value = .40
        nodes['Tactile grain and machining'].inputs['Distance'].default_value = .009
        nodes['Material edge abrasion'].inputs[1].default_value = .12
    bs = nodes['Principled BSDF']
    for link in list(bs.inputs['Roughness'].links):
        mat.node_tree.links.remove(link)
    bs.inputs['Roughness'].default_value = .92
    bs.inputs['Metallic'].default_value = 0
    bs.inputs['Specular IOR Level'].default_value = .08
    weathering(mat, floor, endgrain, kind == 'steel', cracks, kind == 'coat')
    return mat


def build(ctx, spec):
    # Individual pieces vary, rather than striping complete horizontal courses.
    palette = [(177,145,105), (166,141,112), (188,149,102), (177,145,105)]
    factors = (1.10, .97, .90, 1.04, 1.0, 1.13, .95, 1.06, .86, .99, 1.08,
               .94, 1.02, .89, 1.12, .98, .93, 1.04, 1.14, .96, 1.02, .91,
               1.06, .94, 1.10, .98)
    floors = [surface(ctx, 'Weathered timber board '+str(i),
                      tuple(round(v*factor) for v in palette[(i*7+i//3)%4]), 'wood', floor=True, cracks=i in (3, 8, 17))
              for i, factor in enumerate(factors)]
    for mat in floors:
        # Actual elevated rails occlude the deck; no painted perimeter stripe.
        mat.node_tree.nodes['Contact dirt in seams'].inputs['Distance'].default_value = .65
    rail = surface(ctx, 'Sun worn timber handrails', (169, 140, 104), 'wood')
    crown = surface(ctx, 'Dry dark post endgrain', (144, 122, 91), 'wood', endgrain=True)
    ladder = surface(ctx, 'Light worn ladder treads', (183, 150, 111), 'wood')
    end = surface(ctx, 'Dark endgrain fascia and structural timber', (112, 92, 66), 'wood')
    iron = surface(ctx, 'Matte forged iron connections', (46, 49, 47), 'steel')
    stone = surface(ctx, 'Cool dressed stone foundations', (149, 160, 165), 'coat')
    moss = surface(ctx, 'Earth stained moss at footing', (86, 111, 58), 'coat')
    root = bpy.data.objects.new('Watchtower export pivot', None)
    ctx.scene.collection.objects.link(root)
    parts = {key: [] for key in ('deck', 'railings', 'supports', 'foundations', 'ladder', 'hardware')}
    rng = random.Random(603)

    def box(group, name, loc, size, mat, bevel=.008):
        ob = ctx.box(name, loc, size, mat, bevel)
        ob.parent = root
        parts[group].append(ob)
        if mat.get('FD_SurfaceKind') == 'wood':
            # Meter-based top projection, with unique offsets and 180-degree
            # reversals. Quarter turns only align grain to a part's long axis.
            uv = ob.data.uv_layers.active or ob.data.uv_layers.new(name='TimberUV')
            u0, v0 = rng.random(), rng.random()
            direction = rng.choice((-1, 1))
            long_y = size[1] > size[0]
            for loop in ob.data.loops:
                co = ob.data.vertices[loop.vertex_index].co
                along, across = (co.y, co.x) if long_y else (co.x, co.y)
                uv.data[loop.index].uv = (u0+direction*along/1.15, v0+direction*across/.65)
        return ob

    def beam(group, name, start, finish, width, depth, mat):
        a, b = Vector(start), Vector(finish)
        ob = box(group, name, (a + b) / 2, (width, depth, (b - a).length), mat)
        ob.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
        return ob

    # Grow the walking surface, not the post/rail cross sections or player scale.
    spread = .14
    support_spread = .12
    half_floor = .75 + spread
    post = .747 + spread
    handrail = .753 + spread
    lower_rail = .736 + spread
    fascia = .775 + spread

    # Low stone plinths and splayed piers remain visible beyond the deck corners.
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (.826 + support_spread), sy * (.826 + support_spread)
            footing = box('foundations', 'Rough hewn stone footing', (x, y, .10), (.24, .24, .20), stone, .012)
            for vertex in footing.data.vertices:
                vertex.co.x += rng.uniform(-.004, .004)
                vertex.co.y += rng.uniform(-.004, .004)
                vertex.co.z += rng.uniform(-.003, .003)
            box('foundations', 'Low moss stained stone rim', (x, y, .035), (.245, .245, .06), moss, .022)
            beam('supports', 'Splayed main timber pier', (sx*(.865+support_spread), sy*(.865+support_spread), .20),
                 (sx*post, sy*post, 1.46), .13, .13, end)
            box('hardware', 'Pier shoe iron collar', (sx*(.858+support_spread), sy*(.858+support_spread), .30), (.15, .15, .045), iron)
            # Knee braces project beyond the platform and connect beneath joists.
            beam('supports', 'Outward diagonal knee brace', (sx*(.89+support_spread), sy*(.87+support_spread), .40),
                 (sx*(.52+spread), sy*(.72+spread), 1.43), .09, .09, end)
            beam('supports', 'Transverse diagonal knee brace', (sx*(.87+support_spread), sy*(.89+support_spread), .40),
                 (sx*(.72+spread), sy*(.52+spread), 1.43), .09, .09, end)
            box('railings', 'Continuous corner post', (sx*post, sy*post, 1.65), (.145, .145, .72), rail, .006)
            box('railings', 'Exposed wooden post crown', (sx*post, sy*post, 2.021), (.15, .15, .025), crown, .005)
            # Slim iron corner wraps leave most of the five-pixel wood crown exposed.
            for edge in (-1, 1):
                box('hardware', 'Post crown iron side wrap', (sx*post+edge*.077, sy*post, 2.016), (.006, .16, .025), iron, .002)
                box('hardware', 'Post crown iron end wrap', (sx*post, sy*post+edge*.077, 2.016), (.15, .006, .025), iron, .002)
            box('hardware', 'Post connection band', (sx*post, sy*post, 1.51), (.155, .155, .035), iron, .002)

    # Real underfloor X bracing, deliberately occluded in the strict plan view.
    for side in (-1, 1):
        beam('supports', 'East-west undercroft cross brace', (-.80-spread, side*(.80+spread), .28),
             (.80+spread, side*(.80+spread), 1.39), .075, .075, end)
        beam('supports', 'North-south undercroft cross brace', (side*(.80+spread), -.80-spread, .28),
             (side*(.80+spread), .80+spread, 1.39), .075, .075, end)
        if side == 1:
            box('deck', 'North fascia', (0, fascia, 1.475), (1.63+2*spread, .078, .13), end)
        else:
            for sx in (-1, 1):
                box('deck', 'South fascia beside ladder', (sx*(.505+spread/2), -fascia, 1.475), (.62+spread, .078, .13), end)
        box('deck', 'North-south fascia', (side*fascia, 0, 1.475), (.078, 1.55+2*spread, .13), end)

    # Four bearing lines, 440 mm apart. Independent layout RNG avoids changing
    # joins when material UVs or decorative hardware consume random values.
    joists = (-.66, -.22, .22, .66)
    layout_rng = random.Random(605)
    joins_by_row, previous = [], set()
    for count in (0, 2, 0, 3, 1, 2, 1, 0, 2, 1, 2):
        joins = sorted(layout_rng.sample([x for x in joists if x not in previous], count))
        joins_by_row.append(joins)
        previous = set(joins)
    root['Watchtower joists m'] = json.dumps(joists)
    root['Watchtower row joins m south to north'] = json.dumps(joins_by_row)
    for x in joists:
        box('supports', 'Butt joint bearing joist', (x, 0, 1.45), (.10, 1.78, .16), end)
    pitch = 2*half_floor/11
    material_index = 0
    for index in range(11):
        y = -half_floor + (index + .5) * pitch
        gap = rng.uniform(.004, .007)
        z = 1.563+rng.uniform(-.0018, .0018)
        joins = joins_by_row[index]
        starts = [-half_floor] + [x+.0025 for x in joins]
        ends = [x-.0025 for x in joins] + [half_floor]
        spans = list(zip(starts, ends))
        if index == 0:
            spans = [(-half_floor, -.216), (.216, half_floor)]
        for piece, (left, right) in enumerate(spans):
            floor = floors[material_index]
            material_index += 1
            ob = box('deck', 'Narrow weathered floorboard with bearing end', ((left+right)/2, y, z),
                     (right-left, pitch-gap, .04), floor, .0025)
            ob.rotation_euler.x = rng.uniform(-.006, .006)
            ob.rotation_euler.z = rng.uniform(-.0007, .0007)
            ob['Watchtower course'] = index
            ob['Watchtower span m'] = (left, right)
            # Paired nails either side of a butt joint still land within its
            # 100 mm supporting joist; low-poly heads are subpixel at 1x.
            bearings = [x+offset for x in joists for offset in ((-.025, .025) if x in joins else (0,))]
            for bearing in bearings:
                if left+.018 < bearing < right-.018:
                    for across in (-.042, .042):
                        nail = ctx.cylinder('Recessed 7 mm nail head', (bearing, y+across, z+.0195), .0035, .0012, iron, vertices=8)
                        nail.modifiers[0].width = .0004
                        nail.modifiers[0].segments = 1
                        nail.parent = root
                        parts['hardware'].append(nail)

    # Handrails are >2 nominal pixels, with a genuinely open southern gate.
    box('railings', 'North handrail', (0, handrail, 1.90), (2*half_floor, .082, .085), rail, .015)
    # Lower safety rails sit beneath the handrails in plan view. Their real
    # ambient occlusion adds a soft inner edge on the floor, separated in Z.
    box('railings', 'North lower guard rail', (0, lower_rail, 1.70), (2*half_floor, .043, .048), end)
    for side in (-1, 1):
        box('railings', 'Side handrail', (side*handrail, 0, 1.90), (.082, 2*half_floor, .085), rail, .015)
        box('railings', 'Side lower guard rail', (side*lower_rail, 0, 1.70), (.043, 2*half_floor, .048), end)
        box('railings', 'South handrail beside entry', (side*(.489+spread/2), -handrail, 1.90), (.52+spread, .082, .085), rail, .015)
        box('railings', 'South lower guard rail beside entry', (side*(.489+spread/2), -lower_rail, 1.70), (.52+spread, .043, .048), end)
        box('railings', 'Entry upright', (side*.225, -post, 1.71), (.075, .075, .46), rail)
        for along in (-.38, .38):
            box('railings', 'Side intermediate upright', (side*handrail, along, 1.70), (.048, .048, .38), rail)
            box('hardware', 'Side rail iron strap', (side*handrail, along, 1.95), (.096, .052, .025), iron, .003)
            box('hardware', 'End rail iron strap', (along, side*handrail, 1.95), (.052, .096, .025), iron, .003)
        for sy in (-1, 1):
            # An L plate connects each cap to its two perpendicular rails.
            box('hardware', 'Corner bracket along X', (side*(.681+spread), sy*post, 1.951), (.12, .047, .020), iron, .004)
            box('hardware', 'Corner bracket along Y', (side*post, sy*(.681+spread), 1.951), (.047, .12, .020), iron, .004)

    # Leaning ladder: three exposed lower treads project south of the floor.
    lower_y, upper_y = -1.045, -.60-spread
    for side in (-1, 1):
        beam('ladder', 'Leaning access ladder stringer', (side*.1985, lower_y, .16),
             (side*.1985, upper_y, 1.64), .053, .053, ladder)
        box('hardware', 'Ladder hook at deck', (side*.1985, upper_y, 1.64), (.052, .08, .008), iron, .002)
    for index in range(5):
        t = (index + .5) / 5
        box('ladder', 'Ladder rung', (0, lower_y + (upper_y-lower_y)*t, .16+1.48*t),
            (.397, .035, .038), ladder, .005)

    for meshes in parts.values():
        for ob in meshes:
            paint_depth(ctx, ob)
    return {'root': root, 'parts': parts, 'rig': None, 'sockets': {}}
