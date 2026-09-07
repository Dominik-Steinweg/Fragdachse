"""East-facing rocket turret. Geometry only; shared render/material policy lives in the pipeline."""
import bpy
import math


def build(c):
    armor = c.material('Petrol enamel', (.055, .20, .18), 'technical')
    edge = c.material('Brushed grey steel', (.19, .25, .255), 'technical')
    recess = c.material('Warm dark mechanism', (.018, .029, .031))
    amber = c.material('Ochre identification paint', (.73, .32, .045), 'technical')
    ivory = c.material('Warm missile casing', (.55, .59, .43), 'technical')
    red = c.material('Terracotta warhead', (.51, .065, .028), 'technical')
    light = c.material('Small turquoise indicator', (.08, .61, .54), emission=.45)
    c.cylinder('Fixed eight-sided mounting foot', (-.10, 0, .12), 1.13, .24, recess, 8)
    c.cylinder('Steel turret ring', (-.10, 0, .26), 1.05, .14, edge, 12)
    c.cylinder('Inset rotating bearing', (-.10, 0, .36), .92, .13, recess)
    c.cylinder('Rotating armored carrier', (-.10, 0, .43), .82, .12, armor, 12)
    for i in range(8):
        a = math.tau * i / 8 + math.pi / 8
        c.cylinder('Mount fastener', (-.10 + math.cos(a) * .98, math.sin(a) * .98, .36), .048, .025, ivory, 6)
    for side in [-1, 1]:
        y = side * .63
        c.box('Pod undercarriage', (.10, y, .59), (2.38, .65, .22), recess, .10)
        c.box('Painted pod armor', (.07, y, .77), (2.18, .62, .25), armor, .10)
        c.box('Open ammunition well', (.05, y, .904), (1.35, .46, .022), recess, .03)
        c.box('Rear pod armor cap', (-.95, y, .79), (.29, .65, .25), edge, .075)
        c.box('Ochre nose collar', (.90, y, .81), (.26, .64, .29), amber, .05)
        c.box('Dark launch nose', (1.115, y, .77), (.21, .49, .22), recess, .045)
        for dy in [-.13, .13]:
            missile_y = y + dy
            ob = c.cylinder('Loaded rocket body', (-.15, missile_y, .986), .088, .77, ivory, 16)
            ob.rotation_euler.y = math.pi / 2
            ob = c.cylinder('Warhead warning band', (.26, missile_y, .986), .09, .07, amber, 16)
            ob.rotation_euler.y = math.pi / 2
            bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=.089, radius2=.01, depth=.31,
                                           location=(.45, missile_y, .986), rotation=(0, math.pi / 2, 0))
            bpy.context.object.name = 'Distinct east-pointing rocket nose'
            bpy.context.object.data.materials.append(red)
            c.box('Rocket fin', (-.51, missile_y, .99), (.15, .21, .033), edge, .01)
            c.box('Launch rail', (1.15, missile_y, .91), (.28, .052, .03), edge, .009)
        c.box('Rocket retaining bridge', (-.23, y, 1.094), (.075, .52, .031), armor, .009)
        for x in [-.99, -.88, -.77]:
            c.box('Rear vent', (x, y, .927), (.038, .34, .019), recess, .005)
        c.box('Ivory pod recognition stripe', (.9, y, .963), (.07, .41, .012), ivory, .003)
    c.box('Central drive spine', (-.28, 0, .67), (1.40, .41, .35), armor, .09)
    c.box('Ochre service hatch', (-.55, 0, .86), (.33, .29, .045), amber, .04)
    for x in [-.64, -.54, -.44]:
        c.box('Service hatch vents', (x, 0, .887), (.033, .17, .012), recess, .004)
    c.box('Optical sensor housing', (.57, 0, .67), (.36, .32, .27), recess, .07)
    c.box('Optical sensor glass', (.62, 0, .811), (.16, .17, .024), light, .035)
    for y in [-1, 1]:
        c.box('Bearing position lamp', (-.15, y, .345), (.16, .055, .025), light, .014)
