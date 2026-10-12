"""Open timber watchtower, concept B: a quiet floor over a real braced structure.

One BU is 32 display pixels: 72 px canvas / 2.25 BU orthoScale.
The deck fills the centred 64 px footprint; the canvas preserves small footing
and ladder overhangs. These art dimensions do not define gameplay collision.
"""
import bpy
import random
from mathutils import Vector
from weapon_surface_parts import material, paint_depth


def linear(rgb):
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
                 for v in (channel / 255 for channel in rgb))


def surface(ctx, name, rgb, kind):
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
        remap.inputs['From Min'].default_value = .14
        remap.inputs['From Max'].default_value = .34
        remap.inputs['To Min'].default_value = .68
        remap.inputs['To Max'].default_value = 1.28
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
    return mat


def build(ctx, spec):
    # Tiny, non-alternating board variation stays below the character contrast.
    floors = [surface(ctx, 'Weathered timber board '+str(i),
                      tuple(round(v*factor) for v in (181, 140, 94)), 'wood')
              for i, factor in enumerate((.96, 1.025, .985, 1.045, 1.01, .95, 1.035, .98, 1.055, 1.0, .97))]
    for mat in floors:
        # Actual elevated rails occlude the deck; no painted perimeter stripe.
        mat.node_tree.nodes['Contact dirt in seams'].inputs['Distance'].default_value = .55
    rail = surface(ctx, 'Sun worn timber handrails', (185, 147, 100), 'wood')
    ladder = surface(ctx, 'Light worn ladder treads', (190, 150, 101), 'wood')
    end = surface(ctx, 'Dark endgrain fascia and structural timber', (111, 80, 50), 'wood')
    iron = surface(ctx, 'Matte forged iron connections', (68, 72, 71), 'steel')
    stone = surface(ctx, 'Cool dressed stone foundations', (149, 160, 165), 'coat')
    moss = surface(ctx, 'Earth stained moss at footing', (87, 99, 73), 'coat')
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
            box('railings', 'Exposed wooden post crown', (sx*post, sy*post, 2.021), (.15, .15, .025), rail, .005)
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
        box('supports', 'Underfloor joist', (side*(.52+spread), 0, 1.39), (.10, 1.59+2*spread, .15), end)
        if side == 1:
            box('deck', 'North fascia', (0, fascia, 1.475), (1.63+2*spread, .078, .13), end)
        else:
            for sx in (-1, 1):
                box('deck', 'South fascia beside ladder', (sx*(.505+spread/2), -fascia, 1.475), (.62+spread, .078, .13), end)
        box('deck', 'North-south fascia', (side*fascia, 0, 1.475), (.078, 1.55+2*spread, .13), end)

    # Eleven 156 mm boards (5 display px) with supported staggered butt joints.
    # Every join sits on one of these real transverse joists, never in mid-air.
    for x in (-.30, .30):
        box('supports', 'Butt joint bearing joist', (x, 0, 1.45), (.10, 1.78, .16), end)
    pitch = 2*half_floor/11
    for index in range(11):
        floor = floors[index]
        y = -half_floor + (index + .5) * pitch
        gap = rng.uniform(.004, .007)
        z = 1.563+rng.uniform(-.0018, .0018)
        join = (-.30, .30, -.30, .30, .30, -.30, .30, -.30, -.30, .30, -.30)[index]
        spans = [(-half_floor, join-.0025), (join+.0025, half_floor)]
        if index == 0:
            spans = [(-half_floor, -.216), (.216, half_floor)]
        for left, right in spans:
            ob = box('deck', 'Narrow weathered floorboard with bearing end', ((left+right)/2, y, z),
                     (right-left, pitch-gap, .04), floor, .0025)
            ob.rotation_euler.x = rng.uniform(-.006, .006)
            ob.rotation_euler.z = rng.uniform(-.0007, .0007)
            # Paired nails either side of a butt joint still land within its
            # 100 mm supporting joist; low-poly heads are subpixel at 1x.
            for bearing in (-.66, join-.025, join+.025, .66):
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
