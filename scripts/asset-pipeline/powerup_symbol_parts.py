"""Power-up symbols r04: authored relief models with material breakup and seamless loops.

Every symbol keeps one bold, stable silhouette for the 20-30 pixel game view; motion lives in
light, small parts and emission. Loops are keyframed on every exported frame (no interpolation
dependence), so frame N would equal frame 0 and is never exported.
"""
import math
import bpy
from mathutils import Matrix
from rigs_v2 import model
from powerup_parts import linear, outline, curve_polygon, cross_points, lathe


# ── Materials ──────────────────────────────────────────────────────────────

def _node(nodes, kind, **inputs):
    node = nodes.new(kind)
    for name, value in inputs.items():
        node.inputs[name].default_value = value
    return node


def _math(nodes, links, operation, a, b=None, clamp=False):
    node = nodes.new('ShaderNodeMath'); node.operation = operation; node.use_clamp = clamp
    for index, value in enumerate((a, b)):
        if value is None: continue
        if isinstance(value, (int, float)): node.inputs[index].default_value = value
        else: links.new(value, node.inputs[index])
    return node.outputs[0]


def _range(nodes, links, value, from_min, from_max, to_min, to_max, clamp=True):
    node = nodes.new('ShaderNodeMapRange'); node.clamp = clamp
    for name, v in (('From Min', from_min), ('From Max', from_max), ('To Min', to_min), ('To Max', to_max)):
        node.inputs[name].default_value = v
    links.new(value, node.inputs['Value'])
    return node.outputs[0]


def _mix(nodes, links, fac, a, b, blend='MIX'):
    node = nodes.new('ShaderNodeMixRGB'); node.blend_type = blend
    for index, value in ((0, fac), (1, a), (2, b)):
        if isinstance(value, (int, float)): node.inputs[index].default_value = value
        elif isinstance(value, tuple): node.inputs[index].default_value = (*value, 1)
        else: links.new(value, node.inputs[index])
    return node.outputs[0]


def surface(ctx, name, color, roughness=.5, metallic=0., variation=.12, edge=None, edge_amount=.55,
            bump=.12, grime=.45, spec=.35, scale=6.):
    """Matte authored surface: value breakup, edge wear toward `edge`, cavity grime, fine bump."""
    mat = ctx.material(name, linear(color), 'technical')
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bs = nodes.get('Principled BSDF')
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Metallic'].default_value = metallic
    bs.inputs['Specular IOR Level'].default_value = spec
    base = bs.inputs['Base Color'].links[0].from_socket
    coords = nodes.new('ShaderNodeTexCoord')
    noise = _node(nodes, 'ShaderNodeTexNoise', Scale=scale, Detail=5., Roughness=.6)
    links.new(coords.outputs['Object'], noise.inputs['Vector'])
    fine = _node(nodes, 'ShaderNodeTexNoise', Scale=scale*5, Detail=3., Roughness=.5)
    links.new(coords.outputs['Object'], fine.inputs['Vector'])
    tones = _range(nodes, links, noise.outputs['Fac'], .3, .7, 1-variation, 1+variation*.5)
    colour = _mix(nodes, links, 1., base, tones, 'MULTIPLY')
    bevel = nodes.new('ShaderNodeBevel'); bevel.samples = 6; bevel.inputs['Radius'].default_value = .028
    if edge is not None:
        geometry = nodes.new('ShaderNodeNewGeometry')
        dot = nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
        links.new(bevel.outputs['Normal'], dot.inputs[0]); links.new(geometry.outputs['Normal'], dot.inputs[1])
        rim = _range(nodes, links, dot.outputs['Value'], .995, .93, 0., 1.)
        broken = _range(nodes, links, fine.outputs['Fac'], .35, .6, .2, 1.)
        wear = _math(nodes, links, 'MULTIPLY', _math(nodes, links, 'MULTIPLY', rim, broken), edge_amount, clamp=True)
        colour = _mix(nodes, links, wear, colour, linear(edge))
    ao = nodes.new('ShaderNodeAmbientOcclusion'); ao.samples = 8; ao.inputs['Distance'].default_value = .09
    dirt = _range(nodes, links, ao.outputs['AO'], 0., 1., 1-grime, 1.)
    colour = _mix(nodes, links, 1., colour, dirt, 'MULTIPLY')
    links.new(colour, bs.inputs['Base Color'])
    bump_node = _node(nodes, 'ShaderNodeBump', Strength=bump, Distance=.01)
    links.new(fine.outputs['Fac'], bump_node.inputs['Height'])
    links.new(bevel.outputs['Normal'], bump_node.inputs['Normal'])
    links.new(bump_node.outputs['Normal'], bs.inputs['Normal'])
    return mat


def emissive(mat, color, strength):
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Emission Color'].default_value = (*linear(color), 1)
    bs.inputs['Emission Strength'].default_value = strength
    return bs.inputs['Emission Strength']


def sweep(mat, color, direction, width, strength):
    """Additive light band along `direction` (object space).

    Returns (offset, base): the band position and the material's own emission strength, both
    keyable; the Principled strength input itself is linked afterwards.
    """
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bs = nodes.get('Principled BSDF')
    coords = nodes.new('ShaderNodeTexCoord')
    dot = nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
    dot.inputs[1].default_value = direction
    links.new(coords.outputs['Object'], dot.inputs[0])
    offset = nodes.new('ShaderNodeValue'); offset.outputs[0].default_value = 9.
    distance = _math(nodes, links, 'ABSOLUTE', _math(nodes, links, 'SUBTRACT', dot.outputs['Value'], offset.outputs[0]))
    band = _range(nodes, links, distance, 0., width, 1., 0.)
    soft = _math(nodes, links, 'POWER', band, 1.6)
    existing = bs.inputs['Emission Strength'].default_value
    base = nodes.new('ShaderNodeValue'); base.outputs[0].default_value = existing
    total = _math(nodes, links, 'ADD', _math(nodes, links, 'MULTIPLY', soft, strength), base.outputs[0])
    if existing == 0:
        bs.inputs['Emission Color'].default_value = (*linear(color), 1)
    links.new(total, bs.inputs['Emission Strength'])
    return offset.outputs[0], base.outputs[0]


def hologram(mat, alpha):
    """Translucent hologram: horizontal scanlines modulate emission and coverage, edges glow.

    Returns (phase, gain): the scanline phase and an emission/alpha multiplier, both keyable.
    """
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bs = nodes.get('Principled BSDF')
    coords = nodes.new('ShaderNodeTexCoord')
    wave = nodes.new('ShaderNodeTexWave'); wave.wave_type = 'BANDS'; wave.bands_direction = 'Y'
    wave.inputs['Scale'].default_value = 7.; wave.inputs['Distortion'].default_value = 0.
    wave.inputs['Detail'].default_value = 0.
    links.new(coords.outputs['Object'], wave.inputs['Vector'])
    lines = _range(nodes, links, wave.outputs['Fac'], .2, .8, .55, 1.25)
    layer = nodes.new('ShaderNodeLayerWeight'); layer.inputs['Blend'].default_value = .3
    edge = _math(nodes, links, 'POWER', layer.outputs['Facing'], 2.5)
    gain = nodes.new('ShaderNodeValue'); gain.outputs[0].default_value = 1.
    source = bs.inputs['Emission Strength'].links[0].from_socket if bs.inputs['Emission Strength'].is_linked else None
    base = source if source else bs.inputs['Emission Strength'].default_value
    glow = _math(nodes, links, 'MULTIPLY', _math(nodes, links, 'MULTIPLY', base, lines), gain.outputs[0])
    links.new(_math(nodes, links, 'ADD', glow, _math(nodes, links, 'MULTIPLY', edge, 1.2)), bs.inputs['Emission Strength'])
    cover = _math(nodes, links, 'ADD', _math(nodes, links, 'MULTIPLY', lines, alpha*.8), _math(nodes, links, 'MULTIPLY', edge, .5))
    links.new(_math(nodes, links, 'MINIMUM', _math(nodes, links, 'MULTIPLY', cover, gain.outputs[0]), 1.), bs.inputs['Alpha'])
    return wave.inputs['Phase Offset'], gain.outputs[0]


def turbulence(mat):
    """Noise-modulated emission colour (hot streaks); returns the keyable noise offset."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bs = nodes.get('Principled BSDF')
    coords = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    links.new(coords.outputs['Object'], mapping.inputs['Vector'])
    noise = _node(nodes, 'ShaderNodeTexNoise', Scale=4.5, Detail=3., Roughness=.5, Distortion=1.2)
    links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    streak = _range(nodes, links, noise.outputs['Fac'], .38, .66, .45, 1.5)
    layer = nodes.new('ShaderNodeLayerWeight'); layer.inputs['Blend'].default_value = .4
    edge = _range(nodes, links, layer.outputs['Facing'], .2, .9, 1., .35)
    colour = tuple(bs.inputs['Emission Color'].default_value[:3])
    hot = _mix(nodes, links, 1., colour, _math(nodes, links, 'MULTIPLY', streak, edge), 'MULTIPLY')
    links.new(hot, bs.inputs['Emission Color'])
    base = bs.inputs['Base Color'].links[0].from_socket
    links.new(_mix(nodes, links, 1., base, edge, 'MULTIPLY'), bs.inputs['Base Color'])
    return mapping.inputs['Location']


# ── Geometry helpers ───────────────────────────────────────────────────────

def pivot(ob, x, y, z=0.):
    """Move the object origin to (x, y, z) without moving its geometry."""
    ob.data.transform(Matrix.Translation((-x, -y, -z)))
    ob.location = (x, y, z)
    return ob


def lying_cylinder(ctx, name, y0, y1, radius, z, material, vertices=40, bevel=.02, x=0.):
    """Cylinder along +Y (north) between y0 and y1, resting on its side."""
    length = y1 - y0
    ob = ctx.cylinder(name, (x, (y0+y1)/2, z), radius, length, material, vertices)
    ob.rotation_euler.x = math.pi/2
    ob.modifiers['Machined edge'].width = bevel
    bpy.context.view_layer.update()
    ob.data.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)
    for face in ob.data.polygons: face.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(40))
    return ob


def torus(name, location, major, minor, rotation, material, segments=72, minor_segments=16):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=segments,
                                     minor_segments=minor_segments, location=location, rotation=rotation)
    ob = bpy.context.object; ob.name = name
    ob.data.materials.append(material)
    for face in ob.data.polygons: face.use_smooth = True
    return ob


def sphere(ctx, name, location, radius, material):
    ob = ctx.ell(name, location, (radius, radius, radius), material)
    return ob


def keyed(frames, apply):
    """Bake one key per exported frame; t runs over [0, 1) so the loop closes on frame N."""
    for frame in range(frames):
        apply(frame / frames, frame)


def key_socket(socket, value, frame):
    socket.default_value = value
    socket.keyframe_insert('default_value', frame=frame)


def smooth_pulse(t, centre, width):
    """Raised cosine pulse on the loop circle, peak 1 at `centre`."""
    distance = abs(((t - centre + .5) % 1.) - .5)
    return .5 + .5*math.cos(math.pi*distance/width) if distance < width else 0.


# ── Symbols ────────────────────────────────────────────────────────────────

def build_symbol(ctx, spec):
    kind = spec['model']['symbol']
    frames = spec.get('loop', {}).get('frames', 1)
    animate = BUILDERS[kind](ctx, spec)
    asset = model(ctx.scene, {'symbol_meshes': [ob for ob in ctx.scene.objects if ob.type == 'MESH']})
    if animate and frames > 1: animate(frames)
    return asset


def hp(ctx, spec):
    red = surface(ctx, 'Worn crimson enamel', 'C8102A', .46, edge='D9D2C6', edge_amount=.5, grime=.5)
    rim = surface(ctx, 'Dark crimson casing', '7A0A1A', .5, edge='B9B2A8', edge_amount=.45)
    core = surface(ctx, 'Healing light', 'D9667A', .35, variation=.04, grime=.15)
    pulse = emissive(core, 'FFD2DA', .2)
    outline('Medical cross casing', cross_points(length=.76, arm=.27), .24, .16, rim, .05)
    outline('Medical cross enamel', cross_points(length=.7, arm=.215), .38, .12, red, .06)
    outline('Healing light groove', cross_points(length=.52, arm=.06), .49, .03, core, .015)

    def animate(frames):
        # Heartbeat: a strong beat and a softer echo, then rest.
        keyed(frames, lambda t, f: key_socket(pulse, .12 + 1.6*smooth_pulse(t, .1, .1) + .9*smooth_pulse(t, .32, .09), f))
    return animate


SHIELD = [(-.62, .7), (.62, .7), (.6, -.05), (.42, -.44), (0, -.78), (-.42, -.44), (-.6, -.05)]


def armor(ctx, spec):
    steel = surface(ctx, 'Blued steel rim', '7E878F', .4, metallic=.85, edge='DCE2E6', edge_amount=.7, grime=.5)
    field = surface(ctx, 'Amber field enamel', 'E39A12', .52, edge='9DA6AD', edge_amount=.55, grime=.5)
    brass = surface(ctx, 'Brass rivets and boss', 'C99A4A', .38, metallic=.9, edge='F2DDB0', grime=.35)
    outline('Steel shield rim', SHIELD, .24, .14, steel, .05)
    inner = [(x*.8, y*.8 + .02) for x, y in SHIELD]
    outline('Amber shield field', inner, .36, .1, field, .04)
    # Vertical steel spine and a central boss give the shield a readable mass.
    spine = [(-.07, .6), (.07, .6), (.07, -.5), (0, -.6), (-.07, -.5)]
    outline('Steel spine', spine, .44, .05, steel, .02)
    sphere(ctx, 'Brass boss', (0, .1, .48), .15, brass).scale.z *= .45
    for x, y in [(-.52, .64), (.52, .64), (-.55, -.1), (.55, -.1), (0, -.7)]:
        ctx.cylinder(f'Rim rivet {x:+.2f} {y:+.2f}', (x, y, .4), .035, .04, brass, 16)
    offsets = [sweep(material, 'FFF4D6', (.62, .78, 0.), .16, 1.1)[0] for material in (steel, field, brass)]

    def animate(frames):
        # One diagonal glint across the shield in the first third, then a quiet rest.
        def at(t, f):
            position = -1.25 + 2.5*(t/.34) if t < .34 else 9.
            for socket in offsets: key_socket(socket, position, f)
        keyed(frames, at)
    return animate


FLAME = [(-.5, -.52), (-.64, -.18), (-.56, .2), (-.36, .44), (-.32, .06), (-.14, .26), (.04, .8),
         (.3, .4), (.38, .06), (.54, .32), (.6, -.18), (.4, -.6), (0, -.72)]
FLAME_MID = [(-.36, -.44), (-.44, -.16), (-.32, .14), (-.22, .02), (-.04, .22), (.06, .54), (.2, .24),
             (.3, .02), (.38, .14), (.42, -.2), (.28, -.5), (0, -.6)]
FLAME_CORE = [(-.22, -.42), (-.24, -.18), (-.1, .0), (.0, .26), (.12, .04), (.22, -.14), (.18, -.42), (0, -.52)]


def rage(ctx, spec):
    ember = surface(ctx, 'Ember outer flame', 'B81E0C', .8, variation=.22, grime=.3, spec=.08)
    mid = surface(ctx, 'Orange flame body', 'E85A12', .8, variation=.16, grime=.15, spec=.08)
    core = surface(ctx, 'White-hot flame heart', 'FFCF55', .8, variation=.08, grime=.05, spec=.08)
    glows = [emissive(ember, 'D8300E', .35), emissive(mid, 'FF7A1E', .7), emissive(core, 'FFE07A', 1.)]
    drifts = [turbulence(material) for material in (ember, mid, core)]
    # 0.9 leaves headroom for the stretching tongues inside the pulsing safety face.
    shrink = lambda points: [(x*.9, y*.9 + .02) for x, y in points]
    layers = [outline('Outer flame', curve_polygon(shrink(FLAME)), .24, .16, ember, .03),
              outline('Middle flame', curve_polygon(shrink(FLAME_MID)), .38, .1, mid, .03),
              outline('Flame heart', curve_polygon(shrink(FLAME_CORE)), .46, .07, core, .025)]
    for layer, base_y in zip(layers, (-.58, -.49, -.42)): pivot(layer, 0., base_y)

    def animate(frames):
        def at(t, f):
            for index, layer in enumerate(layers):
                phase = 2*math.pi*(t + index*.23)
                # Tongues stretch and lean from the stable base; the outline stays a flame.
                layer.scale = (1 - .035*math.sin(phase*2 + 1.1), 1 + .06*math.sin(phase) + .02*math.sin(phase*3), 1)
                layer.rotation_euler.z = .045*math.sin(phase + index)
                layer.keyframe_insert('scale', frame=f); layer.keyframe_insert('rotation_euler', frame=f)
            for index, (socket, base) in enumerate(zip(glows, (.35, .7, 1.))):
                key_socket(socket, base*(1 + .18*math.sin(2*math.pi*(t*2) + index*1.7)), f)
            for socket in drifts:
                # Turbulence circles through noise space: seamless, and it reads as living fire.
                angle = 2*math.pi*t
                key_socket(socket, (.35*math.cos(angle), .35*math.sin(angle), .2*math.sin(2*angle)), f)
        keyed(frames, at)
    return animate


def adrenaline(ctx, spec):
    """A full syringe pushes a dose out through the needle in a short squirt, then draws back up.

    Built along +Y and turned to point north-east. The dose column is tied to the plunger seal,
    so the liquid visibly shrinks while the jet leaves the tip.
    """
    steel = surface(ctx, 'Satin steel fittings', '9AA4AC', .36, metallic=.85, edge='E6ECEF', grime=.4)
    dark = surface(ctx, 'Rubber plunger seal', '2A3138', .62, grime=.3)
    glass = surface(ctx, 'Clear barrel glass', 'F2FBFF', .08, variation=.02, grime=.03, spec=.7)
    glass.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value = .3
    dose = surface(ctx, 'Blue adrenaline dose', '0E7FE0', .3, variation=.06, grime=.1)
    dose_glow = emissive(dose, '2AA8FF', .55)
    jet = surface(ctx, 'Adrenaline jet', '3AA6FF', .2, variation=.02, grime=0.)
    emissive(jet, '8AD4FF', 1.)
    tick = surface(ctx, 'Engraved dose ticks', '2B3A48', .5, grime=.2)
    z = .44
    parts = {
        'barrel': lying_cylinder(ctx, 'Glass barrel', -.3, .34, .2, z, glass, 48, .03),
        'dose': lying_cylinder(ctx, 'Blue dose column', SEAL_FULL, BARREL_FRONT, .16, z, dose, 40, .02),
        'flange': ctx.box('Finger flange', (0, -.35, z), (.7, .08, .12), steel, .03),
        'seal': lying_cylinder(ctx, 'Plunger seal', SEAL_FULL - .06, SEAL_FULL, .165, z, dark, 32, .012),
        'rod': lying_cylinder(ctx, 'Plunger rod', SEAL_FULL - .64, SEAL_FULL - .06, .045, z, steel, 20, .012),
        'thumb': lying_cylinder(ctx, 'Thumb pad', SEAL_FULL - .7, SEAL_FULL - .64, .16, z, dark, 32, .018),
        'hub': lying_cylinder(ctx, 'Needle hub', .34, .46, .08, z, steel, 24, .018),
        'needle': lying_cylinder(ctx, 'Needle', .46, NEEDLE_TIP, .022, z, steel, 12, .005),
        'stream': sphere(ctx, 'Jet stream', (0, NEEDLE_TIP, z), 1., jet),
    }
    drops = [sphere(ctx, f'Jet droplet {i}', (0, NEEDLE_TIP, z), 1., jet) for i in range(JET_DROPS)]
    for index, y in enumerate((-.16, .0, .16)):
        ctx.box(f'Dose tick {index}', (.09, y, z + .205), (.15, .022, .014), tick, .004)
    pivot(parts['dose'], 0, BARREL_FRONT, 0)
    for name in ('rod', 'thumb', 'seal'): pivot(parts[name], 0, SEAL_FULL, 0)
    # The turn below reads matrix_world; the moved origins must be evaluated first.
    bpy.context.view_layer.update()
    angle = -math.pi/4
    rotation = Matrix.Rotation(angle, 4, 'Z')
    for ob in [o for o in ctx.scene.objects if o.type == 'MESH']:
        ob.matrix_world = rotation @ ob.matrix_world
    axis = (math.cos(angle + math.pi/2), math.sin(angle + math.pi/2))
    at_axis = lambda ob, d: (axis[0]*d, axis[1]*d, ob.location.z)

    def animate(frames):
        def at(t, f):
            # Hold full, press (squirt), hold empty, draw back up.
            if t < .14: stroke = 0.
            elif t < .5: stroke = _ease((t - .14)/.36)
            elif t < .6: stroke = 1.
            else: stroke = 1 - _ease((t - .6)/.4)
            seal = SEAL_FULL + (SEAL_EMPTY - SEAL_FULL)*stroke
            for name in ('rod', 'thumb', 'seal'):
                ob = parts[name]; ob.location = at_axis(ob, seal); ob.keyframe_insert('location', frame=f)
            parts['dose'].scale = (1, max(.02, (BARREL_FRONT - seal)/(BARREL_FRONT - SEAL_FULL)), 1)
            parts['dose'].keyframe_insert('scale', frame=f)
            # The jet only exists while the plunger moves forward.
            push = (t - .14)/.36
            length = .24*math.sin(math.pi*push)**.7 if 0 < push < 1 else 0.
            stream = parts['stream']
            stream.location = at_axis(stream, NEEDLE_TIP + length/2)
            stream.scale = (.034, max(.001, length/2), .034) if length > .01 else (.001,)*3
            stream.keyframe_insert('location', frame=f); stream.keyframe_insert('scale', frame=f)
            for index, droplet in enumerate(drops):
                age = (t - (.18 + index*.045))/.13
                if 0 <= age < 1:
                    distance, radius = NEEDLE_TIP + .05 + .24*age, (.06 - .012*(index % 3))*(1 - .45*age)
                else:
                    distance, radius = NEEDLE_TIP, .001
                droplet.location = at_axis(droplet, distance); droplet.scale = (radius,)*3
                droplet.keyframe_insert('location', frame=f); droplet.keyframe_insert('scale', frame=f)
            key_socket(dose_glow, .45 + .55*smooth_pulse(t, .32, .2), f)
        keyed(frames, at)
    return animate


# A partial dose: the level drops to about half while the length changes only slightly.
SEAL_FULL, SEAL_EMPTY, BARREL_FRONT, NEEDLE_TIP, JET_DROPS = -.2, .03, .3, .76, 7


def _ease(t):
    t = max(0., min(1., t))
    return t*t*(3 - 2*t)


def bfg(ctx, spec):
    housing = surface(ctx, 'Gunmetal orb housing', '3E464C', .44, metallic=.8, edge='A9B3B9', edge_amount=.7, grime=.55)
    clamp = surface(ctx, 'Brass housing clamps', 'B48A44', .4, metallic=.9, edge='EBD3A0', grime=.4)
    lathe('Orb housing ring', [(.8, .2), (.8, .3), (.77, .36), (.7, .38), (.64, .34), (.6, .26), (.6, .2)],
          [0]*6, [housing])
    for angle in (90, 210, 330):
        a = math.radians(angle)
        ob = ctx.box(f'Housing clamp {angle}', (.68*math.cos(a), .68*math.sin(a), .4), (.18, .1, .1), clamp, .02)
        ob.rotation_euler.z = a + math.pi/2
    plasma = bpy.data.materials.new('Swirling plasma')
    plasma.use_nodes = True
    nodes, links = plasma.node_tree.nodes, plasma.node_tree.links
    bs = nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*linear('1E5A12'), 1)
    bs.inputs['Roughness'].default_value = .22
    bs.inputs['Specular IOR Level'].default_value = .5
    coords = nodes.new('ShaderNodeTexCoord')
    rotations, webs = [], []
    # Two counter-rotating webs of thin energy filaments (Voronoi cell edges, warped by noise).
    for scale in (1.6, 2.5):
        mapping = nodes.new('ShaderNodeMapping')
        links.new(coords.outputs['Object'], mapping.inputs['Vector'])
        warp = _node(nodes, 'ShaderNodeTexNoise', Scale=2., Detail=2., Roughness=.5, Distortion=.6)
        links.new(mapping.outputs['Vector'], warp.inputs['Vector'])
        warped = nodes.new('ShaderNodeVectorMath'); warped.operation = 'ADD'
        links.new(mapping.outputs['Vector'], warped.inputs[0])
        offset = nodes.new('ShaderNodeVectorMath'); offset.operation = 'SCALE'; offset.inputs['Scale'].default_value = .35
        links.new(warp.outputs['Color'], offset.inputs[0])
        links.new(offset.outputs['Vector'], warped.inputs[1])
        cells = nodes.new('ShaderNodeTexVoronoi'); cells.feature = 'DISTANCE_TO_EDGE'
        cells.inputs['Scale'].default_value = scale
        links.new(warped.outputs['Vector'], cells.inputs['Vector'])
        webs.append(_range(nodes, links, cells.outputs['Distance'], 0., .11, 1., 0.))
        rotations.append(mapping.inputs['Rotation'])
    filaments = _math(nodes, links, 'MAXIMUM', webs[0], _math(nodes, links, 'MULTIPLY', webs[1], .7))
    layer = nodes.new('ShaderNodeLayerWeight'); layer.inputs['Blend'].default_value = .35
    centre = _range(nodes, links, layer.outputs['Facing'], 0., 1., 1., 0.)
    # Hot core fading to a deep green limb; filaments and a thin rim shell carry the motion.
    body = _math(nodes, links, 'POWER', centre, 1.6)
    rim = _math(nodes, links, 'POWER', layer.outputs['Facing'], 4.)
    core_gain = nodes.new('ShaderNodeValue'); core_gain.outputs[0].default_value = .6
    shell_gain = nodes.new('ShaderNodeValue'); shell_gain.outputs[0].default_value = .3
    energy = _math(nodes, links, 'ADD', _math(nodes, links, 'MULTIPLY', body, core_gain.outputs[0]),
                   _math(nodes, links, 'ADD', _math(nodes, links, 'MULTIPLY', filaments, .5),
                         _math(nodes, links, 'MULTIPLY', rim, shell_gain.outputs[0])))
    ramp = nodes.new('ShaderNodeValToRGB')
    for element, (position, colour) in zip(ramp.color_ramp.elements, ((.08, '06280A'), (.4, '28A012'))):
        element.position = position; element.color = (*linear(colour), 1)
    for position, colour in ((.68, '8CF036'), (.92, 'EAFFA8')):
        extra = ramp.color_ramp.elements.new(position); extra.color = (*linear(colour), 1)
    links.new(energy, ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], bs.inputs['Emission Color'])
    links.new(ramp.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Emission Strength'].default_value = .85
    strength = bs.inputs['Emission Strength']
    orb = sphere(ctx, 'Plasma orb', (0, 0, .42), .56, plasma)

    def animate(frames):
        def at(t, f):
            for index, socket in enumerate(rotations):
                turn = 2*math.pi*t*(1 if index == 0 else -1)
                key_socket(socket, (0., 0., turn), f)
            # Two charge beats per loop: the core flares, the shell answers a moment later.
            beat = smooth_pulse(t, .08, .14) + smooth_pulse(t, .58, .14)
            echo = smooth_pulse(t, .16, .14) + smooth_pulse(t, .66, .14)
            key_socket(core_gain.outputs[0], .55 + .3*beat, f)
            key_socket(shell_gain.outputs[0], .25 + .55*echo, f)
            key_socket(strength, .78 + .2*beat, f)
            size = .56*(1 + .035*beat)
            orb.scale = (size, size, size); orb.keyframe_insert('scale', frame=f)
        keyed(frames, at)
    return animate


# Left UDamage blade (reference: UT2004): sharp top tip, broad angular outer shoulder, an inward
# elbow low on the inner edge and a bottom tip that turns toward the centre.
UDAMAGE_BLADE = [(x, y*.95) for x, y in [
    (-.28, .84), (-.47, .51), (-.66, .07), (-.73, -.33), (-.69, -.62), (-.4, -.77), (-.03, -.84),
    (-.07, -.55), (-.18, -.22), (-.09, -.07), (-.11, .29), (-.17, .62)]]


def inset(points, distance):
    """Mitred inward offset of a simple polygon (no edge may collapse at this distance)."""
    area = sum(x0*y1 - x1*y0 for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]))
    sign = 1 if area > 0 else -1
    lines = []
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        nx, ny = -dy/length*sign, dx/length*sign
        lines.append(((x0 + nx*distance, y0 + ny*distance), (dx, dy)))
    result = []
    for (p0, d0), (p1, d1) in zip(lines[-1:] + lines[:-1], lines):
        det = d0[0]*d1[1] - d0[1]*d1[0]
        if abs(det) < 1e-9:
            result.append(p1); continue
        u = ((p1[0] - p0[0])*d1[1] - (p1[1] - p0[1])*d1[0])/det
        result.append((p0[0] + d0[0]*u, p0[1] + d0[1]*u))
    return result


def frame_band(name, outer, inner, z, thickness, material, bevel=.012):
    """Closed rim between two matching polygons (an outline with a hole)."""
    n = len(outer)
    vertices = ([(x, y, z) for x, y in outer] + [(x, y, z + thickness) for x, y in outer]
                + [(x, y, z + thickness) for x, y in inner] + [(x, y, z) for x, y in inner])
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces += [(n + i, n + j, 2*n + j, 2*n + i),       # top
                  (3*n + i, 3*n + j, j, i),                 # bottom
                  (i, j, n + j, n + i),                     # outer wall
                  (2*n + i, 2*n + j, 3*n + j, 3*n + i)]     # inner wall
    mesh = bpy.data.meshes.new(name); mesh.from_pydata(vertices, [], faces); mesh.update()
    mesh.validate()
    ob = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(material)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)
    ob.modifiers.new('Soft worn edges', 'BEVEL').width = bevel
    ob.modifiers.new('Broad face normals', 'WEIGHTED_NORMAL')
    return ob


def span_at(points, y):
    """Horizontal extent of a simple polygon at height y."""
    xs = []
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        if (y0 - y)*(y1 - y) <= 0 and y0 != y1:
            xs.append(x0 + (y - y0)/(y1 - y0)*(x1 - x0))
    return (min(xs), max(xs)) if xs else None


def damage_amp(ctx, spec):
    """UDamage after Unreal Tournament 2004: two mirrored angular blades with steel rims and a
    ladder of glowing violet rungs. The rungs and the slit between the blades carry the read."""
    steel = surface(ctx, 'Polished blade rims', 'A3ABB5', .34, metallic=.9, edge='EEF2F5', edge_amount=.7, grime=.5)
    crystal = surface(ctx, 'Violet hologram body', '6A16B0', .3, variation=.06, grime=.12, spec=.4)
    rung = surface(ctx, 'Violet hologram rungs', 'D23CFF', .3, variation=.04, grime=.08, spec=.4)
    emissive(crystal, '9A3CF0', .55)
    emissive(rung, 'E57AFF', .95)
    pulses = [sweep(material, 'F6D8FF', (0., 1., 0.), .13, 1.6) for material in (crystal, rung)]
    contour = surface(ctx, 'Hologram contour light', 'F0B8FF', .3, variation=.02, grime=0., spec=.3)
    emissive(contour, 'F4C8FF', 1.3)
    holo = [hologram(crystal, .42), hologram(rung, .62), hologram(contour, .9)]
    body = inset(UDAMAGE_BLADE, .055)
    for side in (-1, 1):
        mirror = lambda points: [(-x, y) for x, y in points][::-1] if side > 0 else points
        frame_band(f'Blade rim {side}', mirror(UDAMAGE_BLADE), mirror(body), .22, .14, steel)
        outline(f'Blade hologram {side}', mirror(inset(UDAMAGE_BLADE, .045)), .26, .06, crystal, .01)
        # A thin light line just inside the steel frame gives the projection a crisp edge.
        frame_band(f'Hologram contour {side}', mirror(inset(UDAMAGE_BLADE, .055)), mirror(inset(UDAMAGE_BLADE, .075)),
                   .31, .02, contour, .004)
        # Rungs are cut to the crystal outline at both of their edges, so they follow the blade.
        # Few, chunky rungs keep dark gaps between them at the 25-pixel game size.
        for index in range(6):
            centre, half = -.6 + index*.235, .062
            low, high = span_at(body, centre - half), span_at(body, centre + half)
            if not low or not high: continue
            quad = [(low[0] + .03, centre - half), (low[1] - .03, centre - half),
                    (high[1] - .03, centre + half), (high[0] + .03, centre + half)]
            outline(f'Blade rung {side} {index}', mirror(quad), .38, .05, rung, .012)

    def animate(frames):
        def at(t, f):
            # An energy pulse climbs the ladder from the bottom tips to the top, then rests.
            position = -.95 + 1.9*(t/.62) if t < .62 else 9.
            for offset, base in pulses: key_socket(offset, position, f)
            key_socket(pulses[0][1], .55 + .15*smooth_pulse(t, .7, .2), f)
            key_socket(pulses[1][1], .95 + .35*smooth_pulse(t, .7, .2), f)
            # Scanlines crawl upward; two brief dips read as hologram flicker.
            flicker = 1 - .35*smooth_pulse(t, .27, .03) - .25*smooth_pulse(t, .83, .03)
            for phase, gain in holo:
                key_socket(phase, -2*math.pi*3*t, f)
                key_socket(gain, flicker, f)
        keyed(frames, at)
    return animate


def holy_grenade(ctx, spec):
    # Bright, warm gold: at the 25-pixel game size the orb must not sink into the token.
    gold = surface(ctx, 'Burnished antique gold', 'FAD066', .34, metallic=.55, variation=.08, edge='FFF4D0', edge_amount=.6, grime=.38)
    band = surface(ctx, 'Chased gold bands', 'D9A03C', .38, metallic=.62, variation=.1, edge='FFEAB4', edge_amount=.7, grime=.45)
    pearl = surface(ctx, 'Pearls', 'F1ECE2', .28, variation=.04, grime=.25, spec=.6)
    ruby = surface(ctx, 'Cabochon ruby', 'B3122A', .2, variation=.05, grime=.1, spec=.7)
    sapphire = surface(ctx, 'Cabochon sapphire', '1F43B8', .2, variation=.05, grime=.1, spec=.7)
    ruby_glow, sapphire_glow = emissive(ruby, 'FF2A3A', .2), emissive(sapphire, '3A6CFF', .15)
    r, cy, cz = .5, -.26, .5
    # The orb lies on its side, cross pointing north: from above the bands form a cross pattern.
    sphere(ctx, 'Orb body', (0, cy, cz), r, gold)
    torus('Equator band', (0, cy, cz), r + .014, .05, (math.pi/2, 0, 0), band)
    torus('Meridian band', (0, cy, cz), r + .014, .05, (0, math.pi/2, 0), band)
    for i in range(-3, 4):
        if i == 0: continue
        a, d = i*.36, r + .062
        sphere(ctx, f'Equator pearl {i}', (d*math.sin(a), cy, cz + d*math.cos(a)), .026, pearl)
        sphere(ctx, f'Meridian pearl {i}', (0, cy + d*math.sin(a), cz + d*math.cos(a)), .026, pearl)
    sphere(ctx, 'Crown ruby', (0, cy, cz + r + .03), .075, ruby).scale.z *= .55
    for x in (-.32, .32):
        sphere(ctx, f'Band sapphire {x:+.2f}', (x, cy, cz + math.sqrt(r*r - x*x) + .04), .058, sapphire).scale.z *= .6
    lying_cylinder(ctx, 'Collar', cy + r - .06, cy + r + .1, .13, cz, gold, 32, .02)
    torus('Collar ring', (0, cy + r + .1, cz), .14, .028, (math.pi/2, 0, 0), band)
    # The cross is the grenade's identifier: wide and heavy enough to survive 25 pixels.
    stem = [(-.1, .3), (.1, .3), (.1, .5), (.3, .5), (.3, .66), (.1, .66), (.1, .82), (-.1, .82),
            (-.1, .66), (-.3, .66), (-.3, .5), (-.1, .5)]
    outline('Orb cross', stem, cz - .05, .1, gold, .02)
    sphere(ctx, 'Cross ruby', (0, .58, cz + .07), .05, ruby).scale.z *= .5
    glint = [sweep(material, 'FFF2C8', (.62, .78, 0.), .14, .9)[0] for material in (gold, band)]

    def animate(frames):
        def at(t, f):
            position = -1.1 + 2.2*(t/.4) if t < .4 else 9.
            for socket in glint: key_socket(socket, position, f)
            key_socket(ruby_glow, .2 + 1.1*smooth_pulse(t, .55, .1), f)
            key_socket(sapphire_glow, .15 + .9*smooth_pulse(t, .72, .1), f)
        keyed(frames, at)
    return animate


def nuke(ctx, spec):
    steel = surface(ctx, 'Hazard plate steel', '6E767D', .42, metallic=.85, edge='D4DADF', edge_amount=.7, grime=.55)
    yellow = surface(ctx, 'Chipped hazard yellow', 'F2C014', .5, variation=.14, edge='5E666C', edge_amount=.8, grime=.5)
    black = surface(ctx, 'Charcoal trefoil', '16191C', .55, variation=.1, edge='4B5258', edge_amount=.4, grime=.3)
    warn = emissive(yellow, 'FFD23A', .05)
    lathe('Hazard plate', [(.8, .2), (.8, .3), (.78, .35), (.72, .37), (.69, .34), (.67, .33)], [0]*5, [steel])
    lathe('Hazard face', [(.67, .33), (.6, .345), (.3, .35), (.01, .35)], [0]*3, [yellow])
    for i in range(6):
        a = math.radians(30 + 60*i)
        ctx.cylinder(f'Plate bolt {i}', (.74*math.cos(a), .74*math.sin(a), .38), .03, .03, steel, 12)
    blades = []
    for angle in (90, 210, 330):
        outer = [(.6*math.cos(math.radians(angle+d)), .6*math.sin(math.radians(angle+d))) for d in range(-30, 31, 3)]
        inner = [(.2*math.cos(math.radians(angle+d)), .2*math.sin(math.radians(angle+d))) for d in range(30, -31, -3)]
        blades.append(outline(f'Trefoil blade {angle}', outer + inner, .34, .04, black, .008))
    ctx.cylinder('Trefoil centre', (0, 0, .37), .12, .04, black, 48)

    def animate(frames):
        def at(t, f):
            # A third of a turn per loop closes the 3-fold symbol seamlessly.
            for blade in blades:
                blade.rotation_euler.z = 2*math.pi/3*t
                blade.keyframe_insert('rotation_euler', frame=f)
            key_socket(warn, .05 + .3*smooth_pulse(t, .5, .25), f)
        keyed(frames, at)
    return animate


BUILDERS = {
    'hp': hp, 'armor': armor, 'rage': rage, 'adrenaline': adrenaline, 'bfg': bfg,
    'damage-amp': damage_amp, 'holy-grenade': holy_grenade, 'nuke': nuke,
}
