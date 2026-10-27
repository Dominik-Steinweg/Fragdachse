"""Shared machining details, the fort emplacement and explicit turret control attachment."""
import math
import bpy
from rigs_v2 import model, control, attach
from turret_surface_parts import material

# The weapon stands on a post: on a base deck its lowest part clears the stake tips (~1.47 BU above the deck)
# and the head turns above the palisade. Recipes author the head as before; finish() lifts it.
FORT_LIFT = 1.6


def palette(c, armor=(.085, .15, .17), accent=(.64, .27, .055), charge=(.06, .58, .73)):
    # Large panels are weathered mineral/earth tones. Small functional contacts
    # retain the weapon hue; do not tint the entire structure with the accent.
    value = sum(channel * weight for channel, weight in zip(armor, (.2126, .7152, .0722)))
    armor = tuple(channel * .38 + value * .62 + warmth for channel, warmth in zip(armor, (.026, .018, .004)))
    return {
        'dark': material(c, 'Graphite ceramic recesses', (.017, .027, .036), 'recess'),
        'base': material(c, 'Earth stained structural graphite', (.065, .075, .054), 'base'),
        'steel': material(c, 'Warm brushed gunmetal', (.22, .235, .21), 'steel'),
        'edge': material(c, 'Soft worn machined edges', (.26, .29, .255), 'steel'),
        'armor': material(c, 'Weathered enamel armor', armor),
        'accent': material(c, 'Worn identification enamel', accent),
        'ivory': material(c, 'Warm ceramic contacts', (.63, .62, .49), 'ceramic'),
        'copper': material(c, 'Oxidized copper winding', (.38, .18, .060), 'copper'),
        'charge': c.material('Confined energy color', charge, emission=.30),
        'timber': material(c, 'Weathered oak post', (.16, .12, .085), 'timber'),
        # Warm dark oak, set off from the silvered deck planks it turns above.
        'turntable': material(c, 'Dark oak turntable', (.12, .072, .04), 'timber'),
        'tar': material(c, 'Tarred timber foot', (.062, .052, .043), 'timber'),
        'iron': material(c, 'Forged iron bands', (.085, .088, .085), 'steel'),
    }


def annulus(c, name, center, outer, inner, height, material, start=0, end=math.tau, steps=48):
    """An open machined ring with a real hole and broad softened edges."""
    x, y, z = center
    vs, fs = [], []
    for i in range(steps + 1):
        a = start + (end - start) * i / steps
        for r, h in [(outer, -.5*height), (inner, -.5*height), (outer, .5*height), (inner, .5*height)]:
            vs.append((x + r*math.cos(a), y + r*math.sin(a), z + h))
    for i in range(steps):
        a, b = i*4, (i+1)*4
        fs.extend([(a+2, b+2, b+3, a+3), (a, a+1, b+1, b), (a, b, b+2, a+2), (a+1, a+3, b+3, b+1)])
    fs.extend([(0, 2, 3, 1), (steps*4, steps*4+1, steps*4+3, steps*4+2)])
    mesh = bpy.data.meshes.new(name); mesh.from_pydata(vs, [], fs); mesh.update()
    ob = bpy.data.objects.new(name, mesh); c.scene.collection.objects.link(ob); mesh.materials.append(material)
    bevel = ob.modifiers.new('Soft ring edges', 'BEVEL'); bevel.width = min(.012, height*.12); bevel.segments = 2
    ob.modifiers.new('Ring face normals', 'WEIGHTED_NORMAL')
    return ob


def cylinder_x(c, name, location, radius, length, material, vertices=24):
    ob = c.cylinder(name, location, radius, length, material, vertices)
    ob.rotation_euler.y = math.pi / 2
    return ob


def tube(c, name, location, radius, thickness, length, material):
    ob = annulus(c, name, (0, 0, 0), radius, radius-thickness, length, material, steps=24)
    ob.rotation_euler.y = math.pi/2; ob.location = location
    return ob


def support(c, p, radius=.86, facets=12, accent_lugs=False):
    """Fort emplacement under the weapon. On a base deck only a small tarred timber foot and an iron-banded oak
    post stand between the stakes (inside a 15px circle at ortho2.8/display40); above the stake tips the post
    carries a broad round timber turntable with an iron rim, visible round the head, on which the lifted weapon
    turns. `radius` sizes the turntable, `facets` its swivel plate; `accent_lugs` paints the band clamps."""
    top = .335 + FORT_LIFT                                        # where the head's old carrier joint now sits
    deck_top, deck_h = top - .12, .14                               # turntable: underside ~0.2 BU above the stake tips
    parts = [c.box('Tarred timber foot', (0, 0, .11), (.72, .72, .22), p['tar'], .035)]
    for i in range(4):
        a = math.pi/4 + i*math.pi/2
        x, y = .27*math.cos(a)*math.sqrt(2), .27*math.sin(a)*math.sqrt(2)
        strap = c.box('Iron corner strap', (x, y, .225), (.17, .11, .03), p['iron'], .008)
        strap.rotation_euler.z = a; parts.append(strap)
        parts.append(c.cylinder('Foot bolt', (x, y, .245), .032, .022, p['edge'], 6))
    post = deck_top - deck_h - .22
    parts.append(c.cylinder('Oak emplacement post', (0, 0, .22 + post/2), .19, post, p['timber'], 8))
    for z in (.5, .5 + post*.5):
        parts.append(c.cylinder('Iron post band', (0, 0, z), .205, .055, p['iron'], 8))
        parts.append(c.box('Band clamp', (.2, 0, z), (.05, .07, .07), p['accent'] if accent_lugs else p['iron'], .01))
    for i in range(4):                                             # knee braces under the turntable
        a = i*math.pi/2
        brace = c.box('Turntable knee brace', (.3*math.cos(a), .3*math.sin(a), deck_top - deck_h - .14), (.42, .07, .07), p['timber'], .01)
        brace.rotation_euler = (0, -.62, a)                       # outer end up under the rim
        parts.append(brace)
    R = radius * .93
    parts.append(c.cylinder('Timber turntable', (0, 0, deck_top - deck_h/2), R - .08, deck_h, p['turntable'], 24))
    for y in (-.5, -.25, 0, .25, .5):                               # board seams across the turntable
        half = math.sqrt(max(0, (R - .07)**2 - y*y))
        parts.append(c.box('Turntable board seam', (0, y + .125, deck_top + .002), (2*half, .022, .012), p['tar'], 0))
    parts.append(annulus(c, 'Iron turntable rim', (0, 0, deck_top - deck_h/2), R, R - .11, deck_h + .03, p['iron'], steps=32))
    for i in range(10):
        a = (i + .5) * math.tau / 10
        parts.append(c.cylinder('Rim bolt', ((R - .055)*math.cos(a), (R - .055)*math.sin(a), deck_top + .018), .026, .02, p['edge'], 6))
    r = min(.42, radius*.5)
    parts.append(c.cylinder('Iron swivel plate', (0, 0, top - .07), r, .1, p['iron'], max(8, facets)))
    parts.append(annulus(c, 'Dark carrier rotation joint', (0, 0, top), r*.86, r*.68, .065, p['dark']))
    return parts


def grille(c, name, center, width, height, material, recess, bars=4, along='x'):
    x, y, z = center
    out = [c.box(name+' well', (x, y, z), (width, height, .040), recess, .025)]
    for i in range(bars):
        t = (i+.5)/bars - .5
        loc = (x+t*width, y, z+.028) if along == 'x' else (x, y+t*height, z+.028)
        dims = (width/bars*.40, height*.80, .035) if along == 'x' else (width*.80, height/bars*.40, .035)
        out.append(c.box(name+' raised fin', loc, dims, material, .007))
    return out


def new_meshes(c, before):
    return [ob for ob in c.scene.objects if ob.type == 'MESH' and ob not in before]


def finish(c, base_meshes, groups=None, pivots=None, sockets=None, emission=None, lift=FORT_LIFT):
    """Lifts every head mesh, pivot and socket onto the emplacement post, then attaches the controls."""
    base = set(base_meshes)
    for ob in c.scene.objects:
        if ob.type == 'MESH' and ob not in base and ob.parent is None:
            ob.location.z += lift
    up = lambda xyz: (xyz[0], xyz[1], xyz[2] + lift)
    asset = model(c.scene)
    asset['parts']['base_meshes'] = list(base_meshes)
    for name, objects in (groups or {}).items():
        pivot = control(c.scene, name+' animation control', up((pivots or {}).get(name, (0, 0, 0))), asset['root'])
        attach(objects, pivot); asset['parts'][name] = pivot
    if emission is not None:
        asset['parts']['emission'] = emission.node_tree.nodes['Principled BSDF'].inputs['Emission Strength']
    for name, location in (sockets or {'muzzle': (1.28, 0, .70)}).items():
        asset['sockets'][name] = control(c.scene, name+' socket', up(location), asset['root'])
    return asset
