"""Shared matte steel and confined turquoise optics for the two contact devices."""
from weapon_surface_parts import material, paint_depth
from turret_parts import annulus


def linear(hex_color):
    values = [int(hex_color[i:i+2], 16)/255 for i in (0, 2, 4)]
    return tuple(v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in values)


def surfaces(c):
    return {
        'steel': material(c, 'Matte graphite gunmetal', (.105, .125, .13), .16, 'steel'),
        'armor': material(c, 'Bead blasted steel panels', (.29, .315, .32), .20, 'steel'),
        'edge': material(c, 'Restrained machined rim', (.40, .435, .44), .22, 'edge'),
        'dark': material(c, 'Recessed graphite gasket', (.012, .022, .024), 0, 'recess'),
        'glass': c.material('Deep teal optical glass', (.006, .075, .061)),
        'light': c.material('Turquoise 3dffd0 inlay', linear('3dffd0'), emission=.65),
        'core': c.material('Pale e8fff9 optical core', linear('e8fff9'), emission=.35),
    }


def lens(c, p, radius, z, crosshair=False):
    """Upward facing real optical stack; no bloom or painted fake perspective."""
    c.cylinder('Lens gasket', (0, 0, z), radius*1.13, .075, p['dark'], 48)
    annulus(c, 'Raised machined lens bezel', (0, 0, z+.045), radius*1.12, radius, .07, p['edge'])
    c.ell('Convex smoked lens', (0, 0, z+.025), (radius, radius, .08), p['glass'])
    annulus(c, 'Narrow luminous optical ring', (0, 0, z+.10), radius*.86, radius*.77, .018, p['light'])
    if crosshair:
        for axis in (0, 1):
            dims = (radius*1.52, radius*.085, .016)
            ob = c.box('Etched target reticle', (0, 0, z+.113), dims, p['light'], .003)
            ob.rotation_euler.z = axis*1.5707963267948966
        c.cylinder('Reticle central dark stop', (0, 0, z+.127), radius*.20, .025, p['glass'], 32)
        annulus(c, 'Reticle centre ring', (0, 0, z+.148), radius*.18, radius*.12, .015, p['light'], steps=32)
        c.cylinder('Pinpoint optical core', (0, 0, z+.16), radius*.05, .012, p['core'], 24)
    else:
        c.cylinder('Luminous projector lens', (0, 0, z+.105), radius*.49, .026, p['light'], 48)
        c.ell('Small pale lens core', (0, 0, z+.128), (radius*.27, radius*.27, .02), p['core'])


def finish(c):
    for ob in c.scene.objects:
        if ob.type == 'MESH':
            paint_depth(c, ob)


def relay(c):
    import math
    from rigs_v2 import control, attach
    from enemy_parts_b import plate
    p = surfaces(c)
    groups = {}
    c.cylinder('Low central bearing housing', (0, 0, .19), .54, .30, p['steel'], 12)
    annulus(c, 'Bearing shoulder', (0, 0, .35), .59, .40, .10, p['armor'], steps=48)
    for i in range(3):
        angle = i*math.tau/3
        before = set(c.scene.objects)
        outline = [(-.15, .35), (.15, .35), (.205, 1.10), (.12, 1.30), (-.12, 1.30), (-.205, 1.10)]
        plate(c, 'Faceted folding leg', (0, 0, .18), outline, .19, p['armor'], .035)
        c.box('Rubber foot', (0, 1.14, .06), (.31, .29, .10), p['dark'], .045)
        c.box('Inset leg channel', (0, .87, .287), (.19, .46, .026), p['dark'], .023)
        c.box('Narrow turquoise leg strip', (0, .87, .306), (.095, .38, .02), p['light'], .015)
        c.cylinder('Hinge cap', (0, .48, .32), .085, .025, p['edge'], 12)
        meshes = list(set(c.scene.objects)-before)
        # Build around +Y, rotate the complete group around the fixed export centre.
        anchor = control(c.scene, f'Leg {i} azimuth')
        anchor.rotation_euler.z = angle
        hinge = control(c.scene, f'Leg {i} folding joint', (0, .40, .22), anchor)
        # Preserve local geometry relative to the hinge, then inherit its azimuth.
        for ob in meshes:
            ob.parent = hinge
            ob.location.y -= .40
            ob.location.z -= .22
        groups[f'relay_leg_{i}'] = hinge
    before = set(c.scene.objects)
    c.cylinder('Telescoping lens pedestal', (0, 0, .42), .37, .37, p['steel'], 32)
    annulus(c, 'Lens head dark seam', (0, 0, .59), .57, .40, .11, p['dark'])
    for i in range(6):
        a = math.tau*i/6
        annulus(c, 'Segmented lens head armor', (0, 0, .64), .57, .43, .13,
                p['armor'], a+.035, a+math.tau/6-.035, 8)
    lens(c, p, .38, .70)
    head_meshes = list(set(c.scene.objects)-before)
    finish(c)
    root = control(c.scene, 'Asset root - fixed export pivot')
    asset = {'root': root, 'parts': {}, 'rig': None, 'sockets': {}}
    for i in range(3):
        groups[f'relay_leg_{i}'].parent.parent = root
    attach([ob for ob in c.scene.objects if ob.type == 'MESH' and ob.parent is None], root)
    head = control(c.scene, 'Telescoping lens lift', (0, 0, .45), asset['root'])
    attach(head_meshes, head)
    groups['relay_head'] = head
    asset['parts'].update(groups)
    asset['sockets']['projector'] = control(c.scene, 'Hologram projection origin', (0, 0, .43), head)
    return asset
