"""Shared authoring for the demolition bridge kit and its explosives.

The bridge sprites are cut apart at runtime along cell boundaries and recombined
into decks of any authored span and width (src/effects/bridge/BridgeKit.ts).
Every helper here therefore keeps its wear statistically uniform along the
travel axis (X) and mirrored across it (Y): any one-cell window of a render may
sit next to any other. The timber finish follows the watchtower recipe so both
structures read as the same carpentry.
"""
import math
import random
from collections import defaultdict

import bpy
from mathutils import Vector

from weapon_surface_parts import material, paint_depth

# One BU is one metre and one cell; 32 display pixels.
PX = 1 / 32


def linear(rgb):
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
                 for v in (channel / 255 for channel in rgb))


def distant_lights(scene, factor=10.0):
    """Push the shared key and fill out along their own direction.

    Direction, solid angle (softness) and irradiance at the pivot stay those of
    the shared rig; only the distance falloff across a wide kit render shrinks,
    so cut-apart cells of the render match in brightness.
    """
    for ob in scene.objects:
        if ob.type != 'LIGHT':
            continue
        ob.location = ob.location * factor
        ob.data.energy *= factor * factor
        ob.data.size *= factor


class Shader:
    """Small node-building vocabulary for the finishing passes."""

    def __init__(self, mat):
        self.nodes, self.links = mat.node_tree.nodes, mat.node_tree.links
        self.bs = self.nodes['Principled BSDF']

    def node(self, kind, label):
        n = self.nodes.new(kind)
        n.name = n.label = label
        return n

    def plug(self, value, socket):
        if isinstance(value, (float, int, tuple)):
            socket.default_value = value
        else:
            self.links.new(value, socket)

    def calc(self, op, a, b=0, label='Bridge finish math'):
        n = self.node('ShaderNodeMath', label)
        n.operation = op
        self.plug(a, n.inputs[0]); self.plug(b, n.inputs[1])
        return n.outputs[0]

    def remap(self, value, low, high, a=0, b=1, label='Bridge finish mask'):
        n = self.node('ShaderNodeMapRange', label)
        n.clamp = True
        for key, v in [('Value', value), ('From Min', low), ('From Max', high), ('To Min', a), ('To Max', b)]:
            self.plug(v, n.inputs[key])
        return n.outputs[0]

    def mix(self, a, b, fac, mode='MIX', label='Bridge finish colour'):
        n = self.node('ShaderNodeMixRGB', label)
        n.blend_type = mode
        self.plug(fac, n.inputs[0]); self.plug(a, n.inputs[1]); self.plug(b, n.inputs[2])
        return n.outputs[0]

    def noise(self, source, scale, detail=1.5, stretch=None, label='Bridge finish noise'):
        vector = source
        if stretch:
            v = self.node('ShaderNodeVectorMath', label + ' stretch')
            v.operation = 'MULTIPLY'
            v.inputs[1].default_value = stretch
            self.links.new(source, v.inputs[0])
            vector = v.outputs[0]
        n = self.node('ShaderNodeTexNoise', label)
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        self.links.new(vector, n.inputs['Vector'])
        return n.outputs['Fac']


def finish(mat, mode, char=0.0, mossy=0.0):
    """Weathering on the real geometry; no baked light, no painted outlines.

    `board`: walking deck boards. Damp, mossy margins along both railings and
    moss in the board seams, broad scuffing between them.
    `timber`: rails, posts, sills and stringers. `stone`: abutment masonry.
    `iron`: forged straps and brackets. `char` (the half span in metres, 0 for
    none): soot towards the broken middle of the span. `mossy` adds colonies
    across the whole part (rotting boards).

    Distances across a deck come from the object attributes `fd_deck_cy` (deck
    centreline) and `fd_deck_inv_half` (1 / half width, 0 off a deck), so one
    material serves decks of every width; see Kit.tags.
    """
    s = Shader(mat)
    color = s.bs.inputs['Base Color'].links[0].from_socket
    geom = s.node('ShaderNodeNewGeometry', 'World wear position')
    world = s.node('ShaderNodeSeparateXYZ', 'Kit wear axes')
    s.links.new(geom.outputs['Position'], world.inputs[0])
    coords = s.node('ShaderNodeTexCoord', 'Part wear coordinates')
    local = s.node('ShaderNodeSeparateXYZ', 'Part edge distances')
    s.links.new(coords.outputs['Generated'], local.inputs[0])
    irregular = s.remap(s.noise(geom.outputs['Position'], 13, 2, label='Broad irregular wear'), .27, .74)
    colony = s.noise(geom.outputs['Position'], 8, 1.3, label='Broken moss colonies')
    tuft = s.remap(s.noise(geom.outputs['Position'], 22, 1.2, label='Moss tufts'), .32, .68)
    moss_color = s.mix((*linear((70, 94, 40)), 1), (*linear((121, 133, 64)), 1), tuft, label='Moss tones')
    dx = s.calc('MINIMUM', local.outputs['X'], s.calc('SUBTRACT', 1, local.outputs['X']))
    dy = s.calc('MINIMUM', local.outputs['Y'], s.calc('SUBTRACT', 1, local.outputs['Y']))
    edge = s.remap(s.calc('MINIMUM', dx, dy), .008, .10, 1, 0)
    centre = s.node('ShaderNodeAttribute', 'Deck centreline')
    centre.attribute_type, centre.attribute_name = 'OBJECT', 'fd_deck_cy'
    inverse = s.node('ShaderNodeAttribute', 'Inverse deck half width')
    inverse.attribute_type, inverse.attribute_name = 'OBJECT', 'fd_deck_inv_half'
    # 0 on the centreline, 1 at the deck edge.
    across = s.calc('MULTIPLY', s.calc('ABSOLUTE', s.calc('SUBTRACT', world.outputs['Y'], centre.outputs['Fac'])),
                    inverse.outputs['Fac'], label='Relative distance from deck centreline')

    def cushion(mask):
        bump = s.node('ShaderNodeBump', 'Soft raised moss cushion normal')
        bump.inputs['Strength'].default_value = .6
        bump.inputs['Distance'].default_value = .03
        s.links.new(s.calc('MULTIPLY', mask, s.calc('ADD', .6, s.calc('MULTIPLY', tuft, .4))), bump.inputs['Height'])
        if s.bs.inputs['Normal'].is_linked:
            s.links.new(s.bs.inputs['Normal'].links[0].from_socket, bump.inputs['Normal'])
        s.links.new(bump.outputs['Normal'], s.bs.inputs['Normal'])

    if mode == 'iron':
        rust = s.calc('MULTIPLY', s.calc('MAXIMUM', s.calc('MULTIPLY', edge, .8), .16), irregular)
        color = s.mix(color, (*linear((133, 77, 39)), 1), rust, label='Rust rim')
    elif mode == 'stone':
        damp = s.remap(world.outputs['Z'], -.05, .26, 1, .2)
        patch = s.remap(colony, .40, .62)
        moss = s.calc('MULTIPLY', s.calc('MAXIMUM', damp, s.calc('MULTIPLY', edge, .55)), patch)
        color = s.mix(color, (*linear((84, 86, 80)), 1), s.calc('MULTIPLY', damp, .45), label='Damp lower masonry')
        color = s.mix(color, moss_color, s.calc('MULTIPLY', moss, .9))
        cushion(moss)
    else:
        chipped = s.calc('MULTIPLY', edge, s.remap(irregular, .58, .88, 0, .42))
        color = s.mix(color, (*linear((171, 156, 127)), 1), chipped, label='Pale chipped fibres')
        if mode == 'board':
            # Scuffed walking surface between the curbs: grain keeps its luminance.
            fibres = s.noise(geom.outputs['Position'], 1, 1.2, (18, 3, 4), 'Wear along the board fibres')
            scuff = s.calc('MULTIPLY', s.remap(across, .62, .18), s.remap(fibres, .38, .62, .25, 1))
            grey = s.node('ShaderNodeRGBToBW', 'Rubbed wood keeps grain luminance')
            s.links.new(color, grey.inputs[0])
            bare = s.mix(color, grey.outputs[0], .22)
            bare = s.mix(bare, (1.3, 1.38, 1.45, 1), 1, 'MULTIPLY', 'Sun bleached scuffing')
            color = s.mix(color, bare, s.calc('MULTIPLY', scuff, .7))
            dirt = s.calc('MULTIPLY', edge, s.calc('ADD', .25, s.calc('MULTIPLY', irregular, .3)))
            color = s.mix(color, (*linear((71, 60, 42)), 1), dirt, label='Dirt in board ends')
            # Spray and shade keep the deck margins damp; moss settles along the curbs.
            margin = s.remap(across, .66, .95)
            color = s.mix(color, (*linear((88, 84, 62)), 1), s.calc('MULTIPLY', margin, .55), label='Damp deck margin')
            moss = s.calc('MULTIPLY', margin, s.remap(colony, .3, .52))
            # Moss and algae creep out of the seams and board ends.
            seams = s.calc('MULTIPLY', edge, s.remap(colony, .38, .6))
            moss = s.calc('MAXIMUM', moss, s.calc('MULTIPLY', seams, .85))
            if mossy:
                moss = s.calc('MAXIMUM', moss, s.calc('MULTIPLY', s.remap(colony, .5 - mossy * .22, .66), mossy))
            algae = s.calc('MULTIPLY', s.remap(irregular, .4, .9), s.calc('ADD', .18, s.calc('MULTIPLY', margin, .3)))
            color = s.mix(color, (*linear((96, 104, 66)), 1), algae, label='Green algae film')
            color = s.mix(color, moss_color, s.calc('MULTIPLY', moss, .92))
            cushion(moss)
        else:
            low = s.remap(world.outputs['Z'], -.1, .55, 1, .15)
            patch = s.remap(colony, .40, .58)
            moss = s.calc('MULTIPLY', s.calc('MULTIPLY', low, patch), s.remap(across, .8, .97))
            # Lichen and moss also settle on the bridge's rails and posts (not on crates).
            outdoors = s.remap(inverse.outputs['Fac'], 0, .01)
            lichen = s.calc('MULTIPLY', s.remap(colony, .56, .7), s.calc('MULTIPLY', outdoors, .7))
            edge_moss = s.calc('MULTIPLY', edge, s.remap(colony, .45, .62, 0, .7))
            moss = s.calc('MAXIMUM', moss, s.calc('MULTIPLY', edge_moss, outdoors))
            worn = s.remap(irregular, .3, .8, 0, .24)
            color = s.mix(color, (*linear((188, 174, 145)), 1), worn, label='Hand rubbed timber')
            color = s.mix(color, (*linear((150, 152, 104)), 1), s.calc('MULTIPLY', lichen, .55), label='Pale lichen')
            color = s.mix(color, moss_color, s.calc('MULTIPLY', moss, .85))
            cushion(moss)
    if char:
        # Burnt towards the blast in the middle of the span; broken ends darkest.
        towards = s.remap(s.calc('ABSOLUTE', world.outputs['X']), char - .08, char - .75)
        flakes = s.remap(s.noise(geom.outputs['Position'], 30, 2, label='Charred crust'), .3, .7)
        soot = s.calc('MINIMUM', 1, s.calc('ADD', s.calc('MULTIPLY', towards, .9), s.calc('MULTIPLY', flakes, .35)))
        charcoal = s.mix((*linear((24, 20, 17)), 1), (*linear((58, 44, 34)), 1), flakes, label='Charcoal tones')
        color = s.mix(color, charcoal, soot, label='Blast char')
    s.links.new(color, s.bs.inputs['Base Color'])
    return mat


def surface(ctx, name, rgb, kind, mode=None, char=0.0, seam_dirt=.065, grain=(.48, 1.65), mossy=0.0):
    """Watchtower carpentry finish: shared material plus the packed timber albedo."""
    mat = material(ctx, name, linear(rgb), 0, kind)
    nodes = mat.node_tree.nodes
    nodes['Uneven material finish'].inputs[0].default_value = .10 if kind == 'wood' else .30
    nodes['Tactile grain and machining'].inputs['Strength'].default_value = .08
    nodes['Contact dirt in seams'].inputs['Distance'].default_value = seam_dirt
    if kind == 'wood':
        # Explicit UVs keep the fibres along each part at a physical scale.
        tex = next(n for n in nodes if n.type == 'TEX_IMAGE')
        tex.image = ctx.images['wood']
        tex.extension = 'REPEAT'
        uv = nodes.new('ShaderNodeTexCoord')
        mat.node_tree.links.new(uv.outputs['UV'], tex.inputs['Vector'])
        remap = next(n for n in nodes if n.type == 'MAP_RANGE')
        remap.inputs['From Min'].default_value = .08
        remap.inputs['From Max'].default_value = .38
        remap.inputs['To Min'].default_value = grain[0]
        remap.inputs['To Max'].default_value = grain[1]
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
    if mode:
        finish(mat, mode, char, mossy)
    return mat


def paint(ctx, name, rgb, mode=None):
    """Matte painted or dyed surfaces (dynamite paper, tarp, twine)."""
    mat = material(ctx, name, linear(rgb), 0, 'coat')
    nodes = mat.node_tree.nodes
    nodes['Uneven material finish'].inputs[0].default_value = .22
    nodes['Material edge abrasion'].inputs[1].default_value = .10
    bs = nodes['Principled BSDF']
    for link in list(bs.inputs['Roughness'].links):
        mat.node_tree.links.remove(link)
    bs.inputs['Roughness'].default_value = .88
    bs.inputs['Specular IOR Level'].default_value = .1
    if mode:
        finish(mat, mode)
    return mat


class Kit:
    """Parts of one asset under its export pivot, with timber UVs and grouped meshes."""

    def __init__(self, ctx, label, seed):
        self.ctx = ctx
        self.root = bpy.data.objects.new(label + ' export pivot', None)
        ctx.scene.collection.objects.link(self.root)
        self.parts = defaultdict(list)
        self.rng = random.Random(seed)
        # Object attributes stamped on every adopted part (read by `finish`).
        self.tags = {'fd_deck_cy': 0.0, 'fd_deck_inv_half': 0.0}

    def adopt(self, group, ob, mat=None):
        ob.parent = self.root
        for key, value in self.tags.items():
            ob[key] = value
        self.parts[group].append(ob)
        if mat is not None and mat.get('FD_SurfaceKind') == 'wood':
            self.timber_uv(ob)
        return ob

    def timber_uv(self, ob):
        # Metre-based projection along the part's longest local axis, with
        # unique offsets and 180-degree reversals per part.
        uv = ob.data.uv_layers.active or ob.data.uv_layers.new(name='TimberUV')
        extent = [max(v.co[i] for v in ob.data.vertices) - min(v.co[i] for v in ob.data.vertices) for i in range(3)]
        along_axis = max(range(3), key=lambda i: extent[i])
        across_axis = max((i for i in range(3) if i != along_axis), key=lambda i: extent[i])
        u0, v0 = self.rng.random(), self.rng.random()
        direction = self.rng.choice((-1, 1))
        for loop in ob.data.loops:
            co = ob.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = (u0 + direction * co[along_axis] / 1.15, v0 + direction * co[across_axis] / .65)

    def box(self, group, name, loc, size, mat, bevel=.008, rotation=None, jitter=0.0):
        ob = self.ctx.box(name, loc, size, mat, bevel)
        if jitter:
            for vertex in ob.data.vertices:
                vertex.co.x += self.rng.uniform(-jitter, jitter)
                vertex.co.y += self.rng.uniform(-jitter, jitter)
                vertex.co.z += self.rng.uniform(-jitter * .7, jitter * .7)
        if rotation:
            ob.rotation_euler = rotation
        return self.adopt(group, ob, mat)

    def beam(self, group, name, start, finish_point, width, depth, mat, bevel=.008):
        a, b = Vector(start), Vector(finish_point)
        ob = self.ctx.box(name, (a + b) / 2, (width, depth, (b - a).length), mat, bevel)
        ob.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
        return self.adopt(group, ob, mat)

    def cylinder(self, group, name, loc, radius, depth, mat, vertices=16, rotation=None, bevel=None):
        ob = self.ctx.cylinder(name, loc, radius, depth, mat, vertices)
        if bevel is not None:
            ob.modifiers[0].width = bevel
        if rotation:
            ob.rotation_euler = rotation
        return self.adopt(group, ob, mat)

    def result(self):
        for meshes in self.parts.values():
            for ob in meshes:
                paint_depth(self.ctx, ob)
        return {'root': self.root, 'parts': dict(self.parts), 'rig': None, 'sockets': {}}


def dynamite_stick(kit, group, centre, length, radius, angle, paper, cap, fuse=None, tilt=0.0):
    """One paper-wrapped stick lying on its side, with crimped ends."""
    x, y, z = centre
    rotation = (math.pi / 2, tilt, angle + math.pi / 2)
    kit.cylinder(group, 'Paper wrapped dynamite stick', (x, y, z), radius, length, paper, 14, rotation, radius * .45)
    dx, dy = math.cos(angle) * length / 2, math.sin(angle) * length / 2
    for sign in (-1, 1):
        kit.cylinder(group, 'Crimped stick end', (x + sign * dx * .985, y + sign * dy * .985, z), radius * .82,
                     length * .035, cap, 12, rotation, radius * .2)
    if fuse is not None:
        kit.cylinder(group, 'Fuse cord stub', (x + dx * 1.04, y + dy * 1.04, z + radius * .2), radius * .22,
                     length * .09, fuse, 8, rotation, .001)
