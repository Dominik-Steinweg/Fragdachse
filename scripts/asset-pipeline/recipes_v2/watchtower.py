"""Open timber watchtower, concept B: a quiet floor over a real braced structure.

One BU is 32 display pixels: 72 px canvas / 2.25 BU orthoScale.
The deck fills the centred 64 px footprint; the canvas preserves small footing
and ladder overhangs. These art dimensions do not define gameplay collision.
"""
import bpy
from mathutils import Vector
from weapon_surface_parts import material, paint_depth


def linear(rgb):
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
                 for v in (channel / 255 for channel in rgb))


def surface(ctx, name, rgb, kind):
    # The shared finish starts with Authoring.material(..., 'technical').
    mat = material(ctx, name, linear(rgb), 0, kind)
    nodes = mat.node_tree.nodes
    nodes['Uneven material finish'].inputs[0].default_value = .26 if kind == 'wood' else .22
    nodes['Tactile grain and machining'].inputs['Strength'].default_value = .08
    nodes['Contact dirt in seams'].inputs['Distance'].default_value = .065
    if kind == 'wood':
        # Planks run east-west; broad color groups take priority over fibres.
        nodes['Longitudinal walnut fibres direction'].inputs[1].default_value = (.6, 16, 5)
        nodes['Restrained exposed grain'].inputs[1].default_value = .06
        nodes['Surface-specific scoring'].inputs[1].default_value = .045
    bs = nodes['Principled BSDF']
    for link in list(bs.inputs['Roughness'].links):
        mat.node_tree.links.remove(link)
    bs.inputs['Roughness'].default_value = .92
    bs.inputs['Metallic'].default_value = 0
    bs.inputs['Specular IOR Level'].default_value = .08
    return mat


def build(ctx, spec):
    # Tiny, non-alternating board variation stays below the character contrast.
    floors = [surface(ctx, 'Warm ash floorboard '+str(i),
                      tuple(round(v*factor) for v in (177, 130, 76)), 'wood')
              for i, factor in enumerate((.975, 1.012, .99, 1.025, 1.0, .985))]
    for mat in floors:
        # Actual elevated rails occlude the deck; no painted perimeter stripe.
        mat.node_tree.nodes['Contact dirt in seams'].inputs['Distance'].default_value = .55
    rail = surface(ctx, 'Oiled timber handrails', (182, 139, 82), 'wood')
    ladder = surface(ctx, 'Light worn ladder treads', (198, 153, 94), 'wood')
    end = surface(ctx, 'Dark endgrain fascia and structural timber', (111, 80, 50), 'wood')
    iron = surface(ctx, 'Matte forged iron connections', (68, 72, 71), 'steel')
    stone = surface(ctx, 'Cool dressed stone foundations', (149, 160, 165), 'coat')
    root = bpy.data.objects.new('Watchtower export pivot', None)
    ctx.scene.collection.objects.link(root)
    parts = {key: [] for key in ('deck', 'railings', 'supports', 'foundations', 'ladder', 'hardware')}

    def box(group, name, loc, size, mat, bevel=.008):
        ob = ctx.box(name, loc, size, mat, bevel)
        ob.parent = root
        parts[group].append(ob)
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
            box('foundations', 'Chamfered stone footing', (x, y, .10), (.24, .24, .20), stone, .025)
            beam('supports', 'Splayed main timber pier', (sx*(.865+support_spread), sy*(.865+support_spread), .20),
                 (sx*post, sy*post, 1.46), .13, .13, end)
            box('hardware', 'Pier shoe iron collar', (sx*(.858+support_spread), sy*(.858+support_spread), .30), (.15, .15, .045), iron)
            # Knee braces project beyond the platform and connect beneath joists.
            beam('supports', 'Outward diagonal knee brace', (sx*(.89+support_spread), sy*(.87+support_spread), .40),
                 (sx*(.52+spread), sy*(.72+spread), 1.43), .09, .09, end)
            beam('supports', 'Transverse diagonal knee brace', (sx*(.87+support_spread), sy*(.89+support_spread), .40),
                 (sx*(.72+spread), sy*(.52+spread), 1.43), .09, .09, end)
            box('railings', 'Continuous corner post', (sx*post, sy*post, 1.65), (.153, .153, .72), rail, .014)
            box('railings', 'Exposed wooden post crown', (sx*post, sy*post, 2.021), (.156, .156, .035), ladder, .012)
            # Slim iron corner wraps leave most of the five-pixel wood crown exposed.
            for edge in (-1, 1):
                box('hardware', 'Post crown iron side wrap', (sx*post+edge*.077, sy*post, 2.016), (.022, .174, .04), iron, .004)
                box('hardware', 'Post crown iron end wrap', (sx*post, sy*post+edge*.077, 2.016), (.15, .022, .04), iron, .004)
            box('hardware', 'Post connection band', (sx*post, sy*post, 1.51), (.168, .168, .043), iron)

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

    # Six broad boards with restrained irregular values and a shallow entry notch.
    for index in range(6):
        floor = floors[index]
        pitch = half_floor / 3
        y = -half_floor + (index + .5) * pitch
        if index == 0:
            for side in (-1, 1):
                box('deck', 'South board beside ladder opening', (side*(.48+spread/2), y, 1.535),
                    (.54+spread, pitch-.004, .095), floor, .004)
            box('deck', 'South board behind shallow ladder notch', (0, -half_floor+pitch-.074, 1.535),
                (.424, .144, .095), floor, .004)
        else:
            box('deck', 'Broad east-west ash floorboard', (0, y, 1.535),
                (2*half_floor, pitch-.004, .095), floor, .004)
        if index > 0:
            box('deck', 'Floorboard tongue below joint', (0, -half_floor+index*pitch, 1.56),
                (2*half_floor, .018, .012), floor, .002)

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
        beam('ladder', 'Leaning access ladder stringer', (side*.176, lower_y, .16),
             (side*.176, upper_y, 1.64), .053, .053, ladder)
        box('hardware', 'Ladder hook at deck', (side*.176, upper_y, 1.64), (.052, .08, .024), iron, .005)
    for index in range(6):
        t = (index + .5) / 6
        box('ladder', 'Ladder rung', (0, lower_y + (upper_y-lower_y)*t, .16+1.48*t),
            (.345, .035, .038), ladder, .005)

    for meshes in parts.values():
        for ob in meshes:
            paint_depth(ctx, ob)
    return {'root': root, 'parts': parts, 'rig': None, 'sockets': {}}
