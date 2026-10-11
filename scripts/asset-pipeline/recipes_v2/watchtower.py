"""Open timber watchtower, concept B: a quiet floor over a real braced structure.

One BU is 32 display pixels with the catalog's explicit orthoScale of 2.
All structure fits inside the 2x2 canvas; these are art dimensions, not a
second gameplay footprint. Camera, lighting and render defaults stay shared.
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
    nodes['Uneven material finish'].inputs[0].default_value = .12 if kind == 'wood' else .22
    nodes['Tactile grain and machining'].inputs['Strength'].default_value = .08
    nodes['Contact dirt in seams'].inputs['Distance'].default_value = .065
    if kind == 'wood':
        # Planks run east-west; broad color groups take priority over fibres.
        nodes['Longitudinal walnut fibres direction'].inputs[1].default_value = (.6, 16, 5)
        nodes['Restrained exposed grain'].inputs[1].default_value = .035
        nodes['Surface-specific scoring'].inputs[1].default_value = .035
    bs = nodes['Principled BSDF']
    for link in list(bs.inputs['Roughness'].links):
        mat.node_tree.links.remove(link)
    bs.inputs['Roughness'].default_value = .92
    bs.inputs['Metallic'].default_value = 0
    bs.inputs['Specular IOR Level'].default_value = .08
    return mat


def build(ctx, spec):
    floor = surface(ctx, 'Quiet warm ash deck', (181, 141, 88), 'wood')
    rail = surface(ctx, 'Oiled timber handrails', (131, 94, 55), 'wood')
    end = surface(ctx, 'Dark endgrain fascia and structural timber', (111, 80, 50), 'wood')
    iron = surface(ctx, 'Matte forged iron connections', (68, 72, 71), 'steel')
    stone = surface(ctx, 'Cool dressed stone foundations', (137, 144, 145), 'coat')
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

    # Low stone plinths and splayed piers remain visible beyond the deck corners.
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * .826, sy * .826
            box('foundations', 'Chamfered stone footing', (x, y, .10), (.24, .24, .20), stone, .025)
            beam('supports', 'Splayed main timber pier', (sx*.865, sy*.865, .20),
                 (sx*.795, sy*.795, 1.46), .13, .13, end)
            box('hardware', 'Pier shoe iron collar', (sx*.858, sy*.858, .30), (.15, .15, .045), iron)
            # Knee braces project beyond the platform and connect beneath joists.
            beam('supports', 'Outward diagonal knee brace', (sx*.89, sy*.87, .40),
                 (sx*.52, sy*.77, 1.43), .09, .09, rail)
            beam('supports', 'Transverse diagonal knee brace', (sx*.87, sy*.89, .40),
                 (sx*.77, sy*.52, 1.43), .09, .09, rail)
            box('railings', 'Continuous corner post', (sx*.795, sy*.795, 1.65), (.125, .125, .66), rail, .014)
            box('hardware', 'Iron post cap', (sx*.795, sy*.795, 1.985), (.137, .137, .028), iron, .012)
            box('hardware', 'Post connection band', (sx*.795, sy*.795, 1.51), (.142, .142, .043), iron)

    # Real underfloor X bracing, deliberately occluded in the strict plan view.
    for side in (-1, 1):
        beam('supports', 'East-west undercroft cross brace', (-.80, side*.80, .28),
             (.80, side*.80, 1.39), .075, .075, end)
        beam('supports', 'North-south undercroft cross brace', (side*.80, -.80, .28),
             (side*.80, .80, 1.39), .075, .075, end)
        box('supports', 'Underfloor joist', (side*.52, 0, 1.39), (.10, 1.72, .15), end)
        if side == 1:
            box('deck', 'North fascia', (0, .831, 1.475), (1.74, .078, .13), end)
        else:
            for sx in (-1, 1):
                box('deck', 'South fascia beside ladder', (sx*.54, -.831, 1.475), (.66, .078, .13), end)
        box('deck', 'North-south fascia', (side*.831, 0, 1.475), (.078, 1.66, .13), end)

    # Six broad boards, no alternating values. Southern board has a ladder notch.
    for index in range(6):
        y = -.80 + (index + .5) * (1.60 / 6)
        if index == 0:
            for side in (-1, 1):
                box('deck', 'South board beside ladder opening', (side*.505, y, 1.535),
                    (.59, 1.60/6-.004, .095), floor, .004)
            box('deck', 'South board behind shallow ladder notch', (0, -.616, 1.535),
                (.424, .161, .095), floor, .004)
        else:
            box('deck', 'Broad east-west ash floorboard', (0, y, 1.535),
                (1.60, 1.60/6-.004, .095), floor, .004)
        if index > 0:
            box('deck', 'Floorboard tongue below joint', (0, -.80+index*1.60/6, 1.56),
                (1.60, .018, .012), floor, .002)

    # Handrails are >2 nominal pixels, with a genuinely open southern gate.
    box('railings', 'North handrail', (0, .806, 1.90), (1.60, .072, .085), rail, .012)
    for side in (-1, 1):
        box('railings', 'Side handrail', (side*.806, 0, 1.90), (.072, 1.60, .085), rail, .012)
        box('railings', 'South handrail beside entry', (side*.515, -.806, 1.90), (.57, .072, .085), rail, .012)
        box('railings', 'Entry upright', (side*.225, -.797, 1.71), (.075, .075, .46), rail)
        for along in (-.38, .38):
            box('railings', 'Side intermediate upright', (side*.806, along, 1.70), (.048, .048, .38), rail)
            box('hardware', 'Side rail iron strap', (side*.806, along, 1.95), (.085, .039, .020), iron, .003)
            box('hardware', 'End rail iron strap', (along, side*.806, 1.95), (.039, .085, .020), iron, .003)
        for sy in (-1, 1):
            # An L plate connects each cap to its two perpendicular rails.
            box('hardware', 'Corner bracket along X', (side*.732, sy*.795, 1.951), (.12, .047, .020), iron, .004)
            box('hardware', 'Corner bracket along Y', (side*.795, sy*.732, 1.951), (.047, .12, .020), iron, .004)

    # Leaning ladder: three exposed lower treads project south of the floor.
    lower_y, upper_y = -.930, -.645
    for side in (-1, 1):
        beam('ladder', 'Leaning access ladder stringer', (side*.176, lower_y, .16),
             (side*.176, upper_y, 1.64), .043, .043, rail)
        box('hardware', 'Ladder hook at deck', (side*.176, upper_y, 1.64), (.052, .08, .024), iron, .005)
    for index in range(7):
        t = (index + .5) / 7
        box('ladder', 'Ladder rung', (0, lower_y + (upper_y-lower_y)*t, .16+1.48*t),
            (.345, .032, .034), rail, .005)

    for meshes in parts.values():
        for ob in meshes:
            paint_depth(ctx, ob)
    return {'root': root, 'parts': parts, 'rig': None, 'sockets': {}}
