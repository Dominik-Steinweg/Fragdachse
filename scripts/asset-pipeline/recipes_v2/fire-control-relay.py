"""RELAY_v01: three folding feet, concentric upright lens, stable centre pivot."""
import math
from rigs_v2 import control, attach
from enemy_parts_b import plate
from turret_parts import annulus
from fire_control_parts import surfaces, lens, finish


def build(c, spec):
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
