"""Lobby staff badgers: the player sculpt and rig, dressed per role (smith, foreman,
quartermaster, dealer). The ivory crown and face stripes stay exposed for readability;
headgear sits on the rear dark bands. Hands keep the player's stable grip and hold a tool.
"""
import math
from recipes_v2 import badger as player
from rigs_v2 import attach, control
from dawn_parts import surface, plate, beam, bolt, annulus, tube
from weapon_surface_parts import paint_depth


def materials(c):
    return dict(
        leather=surface(c, 'Supple brown leather', (140, 87, 45), .22),
        heavy=surface(c, 'Scorched smith leather', (86, 56, 36), .30),
        seam=surface(c, 'Rolled leather seams', (181, 130, 75), .16),
        soot=surface(c, 'Soot grey cloth', (78, 78, 72), .25),
        red=surface(c, 'Vermilion neckerchief', (192, 59, 35), .09),
        ochre=surface(c, 'Faded safety ochre', (196, 150, 52), .30),
        reflect=surface(c, 'Dull reflective tape', (196, 196, 184), .10),
        olive=surface(c, 'Field olive drab', (92, 98, 66), .28),
        olive_dark=surface(c, 'Dark olive webbing', (62, 66, 46), .22),
        iron=surface(c, 'Worn tool steel', (174, 185, 177), .18),
        dark=surface(c, 'Blackened iron', (46, 46, 42), .15),
        wood=surface(c, 'Oiled ash haft', (150, 112, 70), .20),
        brass=surface(c, 'Old brass fittings', (207, 168, 94), .14),
        glass=surface(c, 'Muted welding glass', (99, 148, 150), .05),
        paper=surface(c, 'Rolled plan paper', (206, 198, 168), .10),
        book=surface(c, 'Ledger cloth binding', (96, 46, 38), .14),
    )


def back_panel(c, name, outline, z, m, thickness=.045):
    return plate(c, name, (0, 0, z), outline, thickness, m, .025)


def smith(c, m):
    body, head, held = [], [], []
    body.append(back_panel(c, 'Heavy forge apron', [(-.32, -.33), (.32, -.33), (.38, -.66), (.27, -.74), (-.27, -.74), (-.38, -.66)], 1.74, m['heavy'], .06))
    for x, y in [(-.12, -.52), (.15, -.6), (.02, -.68)]:
        body.append(c.ell('Apron scorch mark', (x, y, 1.775), (.05, .035, .01), m['dark']))
    for side in (-1, 1):
        body.append(beam(c, 'Apron cross strap', (side * .38, -.28), (-side * .1, -.5), .05, 1.77, m['seam']))
    body.append(plate(c, 'Leather shoulder guard', (.36, -.32, 1.8), [(-.12, -.1), (.12, -.08), (.14, .1), (-.1, .12)], .05, m['heavy'], .02))
    body.append(tube(c, 'Soot sweat cloth', [(-.36, -.29, 1.89), (-.3, -.42, 1.87), (0, -.5, 1.85), (.3, -.42, 1.87), (.36, -.29, 1.89)], .038, m['soot']))
    head.append(tube(c, 'Knotted rear headband', [(-.27, -.12, 2.12), (-.22, -.3, 2.12), (0, -.36, 2.11), (.22, -.3, 2.12), (.27, -.12, 2.12)], .022, m['soot']))
    head.append(plate(c, 'Headband knot tail', (.05, -.42, 2.1), [(0, .02), (.07, -.03), (.04, -.13), (-.03, -.07)], .02, m['soot'], .01))
    # Forge hammer in the offset grips, head to the north-east, plus heavy gloves.
    held.append(beam(c, 'Forge hammer haft', (-.22, .64), (.24, .86), .05, 1.665, m['wood']))
    held.append(c.box('Forge hammer head', (.27, .9, 1.68), (.13, .22, .12), m['dark'], .02))
    for x in (-.27, .27):
        held.append(c.ell('Heavy leather glove', (x, .7, 1.66), (.1, .1, .07), m['heavy']))
    return body, head, held


def foreman(c, m):
    body, head, held = [], [], []
    body.append(back_panel(c, 'Faded safety vest', [(-.34, -.3), (.34, -.3), (.37, -.64), (.27, -.71), (-.27, -.71), (-.37, -.64)], 1.74, m['ochre']))
    for y in (-.46, -.6):
        body.append(c.box('Reflective vest band', (0, y, 1.77), (.68, .045, .012), m['reflect'], .005))
    body.append(c.box('Vest pencil pocket', (-.2, -.36, 1.775), (.12, .1, .02), m['ochre'], .01))
    body.append(beam(c, 'Pencil behind pocket', (-.24, -.33), (-.17, -.4), .015, 1.8, m['wood']))
    # Hard hat pushed back over the rear bands; the crown stripes stay readable.
    head.append(c.ell('Hard hat shell', (0, -.3, 2.16), (.25, .2, .1), m['ochre']))
    head.append(annulus(c, 'Hard hat brim', (0, -.3, 2.13), .29, .22, .02, m['ochre'], steps=28))
    head.append(tube(c, 'Hard hat ridge', [(0, -.12, 2.24), (0, -.3, 2.27), (0, -.48, 2.24)], .02, m['ochre']))
    roll = c.cylinder('Rolled building plan', (0, .72, 1.68), .06, .62, m['paper'], 16)
    roll.rotation_euler.y = math.pi / 2
    held.append(roll)
    tie = annulus(c, 'Plan tie string', (0, 0, 0), .065, .055, .02, m['seam'], steps=16)
    tie.location = (-.12, .72, 1.68); tie.rotation_euler.y = math.pi / 2
    held.append(tie)
    return body, head, held


def quartermaster(c, m):
    body, head, held = [], [], []
    body.append(back_panel(c, 'Field jacket back', [(-.36, -.28), (.36, -.28), (.38, -.66), (.28, -.73), (-.28, -.73), (-.38, -.66)], 1.74, m['olive']))
    for side in (-1, 1):
        body.append(c.box('Shoulder epaulette', (side * .33, -.33, 1.8), (.16, .1, .03), m['olive_dark'], .01))
        body.append(bolt(c, side * .33, -.3, 1.82, m['brass'], .016))
    body.append(beam(c, 'Cross webbing strap', (-.34, -.3), (.3, -.68), .055, 1.78, m['olive_dark']))
    body.append(c.box('Webbing pouch', (.24, -.62, 1.8), (.16, .12, .06), m['olive_dark'], .015))
    head.append(c.ell('Field cap crown', (0, -.3, 2.15), (.22, .19, .07), m['olive']))
    head.append(plate(c, 'Field cap visor', (0, -.08, 2.15), [(-.14, 0), (.14, 0), (.1, .07), (-.1, .07)], .015, m['olive_dark'], .006))
    held.append(c.box('Issue ledger', (0, .72, 1.68), (.42, .3, .07), m['book'], .015))
    held.append(c.box('Ledger page edge', (0, .72, 1.72), (.38, .26, .012), m['paper'], .004))
    held.append(c.cylinder('Brass rubber stamp', (.24, .86, 1.74), .035, .09, m['brass'], 12))
    return body, head, held


def dealer(c, m):
    body, head, held = [], [], []
    body.append(back_panel(c, 'Leather apron body', [(-.28, -.37), (.28, -.37), (.34, -.64), (.25, -.70), (-.25, -.70), (-.34, -.64)], 1.74, m['leather']))
    for side in (-1, 1):
        body.append(beam(c, 'Apron shoulder strap', (side * .38, -.29), (side * .40, -.55), .042, 1.76, m['seam']))
    body.append(tube(c, 'Narrow red neck scarf', [(-.36, -.29, 1.89), (-.32, -.43, 1.87), (0, -.52, 1.84), (.32, -.43, 1.87), (.36, -.29, 1.89)], .034, m['red']))
    body.append(beam(c, 'Satchel strap', (.36, -.28), (-.4, -.62), .04, 1.79, m['seam']))
    body.append(plate(c, 'Salvage satchel', (-.44, -.55, 1.7), [(-.12, -.14), (.12, -.14), (.13, .12), (-.12, .13)], .12, m['leather'], .03))
    body.append(bolt(c, -.44, -.6, 1.77, m['brass'], .02))
    for x in (-.19, .19):
        head.append(annulus(c, 'Small welding goggle rim', (x, -.22, 2.13), .067, .046, .033, m['brass'], steps=24))
        head.append(c.cylinder('Muted welding goggle lens', (x, -.22, 2.145), .045, .016, m['glass'], 24))
    held.append(beam(c, 'Held workshop spanner', (-.27, .75), (.27, .66), .078, 1.665, m['iron']))
    held.append(annulus(c, 'Spanner jaw', (-.28, .752, 1.667), .107, .062, .055, m['iron'], start=.40, end=5.25, steps=24))
    return body, head, held


ROLES = dict(smith=smith, foreman=foreman, quartermaster=quartermaster, dealer=dealer)


def build(c, spec):
    asset = player.build(c, spec)
    m = materials(c)
    body, head, held = ROLES[spec['model']['role']](c, m)
    attach(body, asset['parts']['body'])
    attach(head, asset['parts']['head'])
    # The held tool turns about its own control at the grip; the hands stay rooted.
    grip = control(c.scene, 'Held tool grip', location=(0, .72, 1.67), parent=asset['root'])
    attach(held, grip)
    asset['parts']['tool'] = grip
    attach([o for o in c.scene.objects if o.type == 'MESH' and o.parent is None], asset['root'])
    for ob in body + head + held: paint_depth(c, ob)
    return asset
