"""Shared machining details, compact supports and explicit turret control attachment."""
import math
import bpy
from rigs_v2 import model, control, attach


def palette(c, armor=(.085, .15, .17), accent=(.64, .27, .055), charge=(.06, .58, .73)):
    return {
        'dark': c.material('Graphite ceramic recesses', (.017, .027, .036)),
        'base': c.material('Matte structural graphite', (.047, .068, .080), 'technical'),
        'steel': c.material('Brushed gunmetal', (.14, .19, .21), 'technical'),
        'edge': c.material('Soft worn machined edges', (.29, .36, .37), 'technical'),
        'armor': c.material('Colored enamel armor', armor, 'technical'),
        'accent': c.material('Authored identification enamel', accent, 'technical'),
        'ivory': c.material('Warm ceramic contacts', (.63, .62, .49), 'technical'),
        'copper': c.material('Oxidized copper winding', (.38, .18, .060), 'technical'),
        'charge': c.material('Confined energy color', charge, emission=.30),
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
    """All support details stay inside a 25px circle at ortho2.8/display40."""
    parts = [c.cylinder('Compact structural foot', (0, 0, .10), radius, .20, p['base'], facets)]
    parts.append(annulus(c, 'Recessed outer bearing edge', (0, 0, .23), radius*.95, radius*.83, .075, p['steel']))
    parts.append(c.cylinder('Inset armored bearing', (0, 0, .265), radius*.84, .12, p['armor'], facets))
    parts.append(annulus(c, 'Dark carrier rotation joint', (0, 0, .335), radius*.69, radius*.58, .065, p['dark']))
    for i in range(4):
        a = math.pi/4 + i*math.pi/2
        x, y = .69*math.cos(a), .69*math.sin(a)
        tab = c.box('Recessed mounting lug', (x, y, .265), (.22, .16, .065), p['accent'] if accent_lugs else p['base'], .025)
        tab.rotation_euler.z = a; parts.append(tab)
        parts.append(c.cylinder('Large mounting bolt', (x, y, .310), .047, .026, p['edge'], 6))
        parts.append(c.box('Bolt head slot', (x, y, .325), (.043, .011, .008), p['dark'], .002))
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


def finish(c, base_meshes, groups=None, pivots=None, sockets=None, emission=None):
    asset = model(c.scene)
    asset['parts']['base_meshes'] = list(base_meshes)
    for name, objects in (groups or {}).items():
        pivot = control(c.scene, name+' animation control', (pivots or {}).get(name, (0, 0, 0)), asset['root'])
        attach(objects, pivot); asset['parts'][name] = pivot
    if emission is not None:
        asset['parts']['emission'] = emission.node_tree.nodes['Principled BSDF'].inputs['Emission Strength']
    for name, location in (sockets or {'muzzle': (1.28, 0, .70)}).items():
        asset['sockets'][name] = control(c.scene, name+' socket', location, asset['root'])
    return asset
