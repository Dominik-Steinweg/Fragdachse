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

    # Low stone plinths and splayed piers remain visible beyond the deck corners.
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * .826, sy * .826
            box('foundations', 'Chamfered stone footing', (x, y, .10), (.24, .24, .20), stone, .025)
            beam('supports', 'Splayed main timber pier', (sx*.865, sy*.865, .20),
                 (sx*.747, sy*.747, 1.46), .13, .13, end)
            box('hardware', 'Pier shoe iron collar', (sx*.858, sy*.858, .30), (.15, .15, .045), iron)
            # Knee braces project beyond the platform and connect beneath joists.
            beam('supports', 'Outward diagonal knee brace', (sx*.89, sy*.87, .40),
                 (sx*.52, sy*.72, 1.43), .09, .09, end)
            beam('supports', 'Transverse diagonal knee brace', (sx*.87, sy*.89, .40),
                 (sx*.72, sy*.52, 1.43), .09, .09, end)
            box('railings', 'Continuous corner post', (sx*.747, sy*.747, 1.65), (.153, .153, .72), rail, .014)
            box('railings', 'Exposed wooden post crown', (sx*.747, sy*.747, 2.021), (.156, .156, .035), ladder, .012)
            # Slim iron corner wraps leave most of the five-pixel wood crown exposed.
            for edge in (-1, 1):
                box('hardware', 'Post crown iron side wrap', (sx*.747+edge*.077, sy*.747, 2.016), (.022, .174, .04), iron, .004)
                box('hardware', 'Post crown iron end wrap', (sx*.747, sy*.747+edge*.077, 2.016), (.15, .022, .04), iron, .004)
            box('hardware', 'Post connection band', (sx*.747, sy*.747, 1.51), (.168, .168, .043), iron)

    # Real underfloor X bracing, deliberately occluded in the strict plan view.
    for side in (-1, 1):
        beam('supports', 'East-west undercroft cross brace', (-.80, side*.80, .28),
             (.80, side*.80, 1.39), .075, .075, end)
        beam('supports', 'North-south undercroft cross brace', (side*.80, -.80, .28),
             (side*.80, .80, 1.39), .075, .075, end)
        box('supports', 'Underfloor joist', (side*.52, 0, 1.39), (.10, 1.59, .15), end)
        if side == 1:
            box('deck', 'North fascia', (0, .775, 1.475), (1.63, .078, .13), end)
        else:
            for sx in (-1, 1):
                box('deck', 'South fascia beside ladder', (sx*.505, -.775, 1.475), (.62, .078, .13), end)
        box('deck', 'North-south fascia', (side*.775, 0, 1.475), (.078, 1.55, .13), end)

    # Six broad boards with restrained irregular values and a shallow entry notch.
    for index in range(6):
        floor = floors[index]
        y = -.75 + (index + .5) * .25
        if index == 0:
            for side in (-1, 1):
                box('deck', 'South board beside ladder opening', (side*.48, y, 1.535),
                    (.54, .246, .095), floor, .004)
            box('deck', 'South board behind shallow ladder notch', (0, -.574, 1.535),
                (.424, .144, .095), floor, .004)
        else:
            box('deck', 'Broad east-west ash floorboard', (0, y, 1.535),
                (1.50, .246, .095), floor, .004)
        if index > 0:
            box('deck', 'Floorboard tongue below joint', (0, -.75+index*.25, 1.56),
                (1.50, .018, .012), floor, .002)

    # Handrails are >2 nominal pixels, with a genuinely open southern gate.
    box('railings', 'North handrail', (0, .753, 1.90), (1.50, .082, .085), rail, .015)
    # Lower safety rails sit beneath the handrails in plan view. Their real
    # ambient occlusion adds a soft inner edge on the floor, separated in Z.
    box('railings', 'North lower guard rail', (0, .736, 1.70), (1.50, .043, .048), end)
    for side in (-1, 1):
        box('railings', 'Side handrail', (side*.753, 0, 1.90), (.082, 1.50, .085), rail, .015)
        box('railings', 'Side lower guard rail', (side*.736, 0, 1.70), (.043, 1.50, .048), end)
        box('railings', 'South handrail beside entry', (side*.489, -.753, 1.90), (.52, .082, .085), rail, .015)
        box('railings', 'South lower guard rail beside entry', (side*.489, -.736, 1.70), (.52, .043, .048), end)
        box('railings', 'Entry upright', (side*.225, -.747, 1.71), (.075, .075, .46), rail)
        for along in (-.38, .38):
            box('railings', 'Side intermediate upright', (side*.753, along, 1.70), (.048, .048, .38), rail)
            box('hardware', 'Side rail iron strap', (side*.753, along, 1.95), (.096, .052, .025), iron, .003)
            box('hardware', 'End rail iron strap', (along, side*.753, 1.95), (.052, .096, .025), iron, .003)
        for sy in (-1, 1):
            # An L plate connects each cap to its two perpendicular rails.
            box('hardware', 'Corner bracket along X', (side*.681, sy*.747, 1.951), (.12, .047, .020), iron, .004)
            box('hardware', 'Corner bracket along Y', (side*.747, sy*.681, 1.951), (.047, .12, .020), iron, .004)

    # Leaning ladder: three exposed lower treads project south of the floor.
    lower_y, upper_y = -.930, -.60
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
