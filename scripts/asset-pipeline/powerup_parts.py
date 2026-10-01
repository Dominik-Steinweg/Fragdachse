"""Authored relief geometry; original icon layers are references, never flat decals."""
import math
import bpy
from rigs_v2 import model


def linear(hex_color):
    rgb = [int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb)


def painted(ctx, name, color, wear=.07, roughness=.34):
    mat = ctx.material(name, linear(color), 'technical')
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bs = nodes.get('Principled BSDF')
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Specular IOR Level'].default_value = .38
    bs.inputs['Coat Weight'].default_value = .16 if roughness < .5 else .04
    bs.inputs['Coat Roughness'].default_value = .30
    coordinates = nodes.new('ShaderNodeTexCoord')
    noise = nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 9
    noise.inputs['Detail'].default_value = 2
    links.new(coordinates.outputs['Generated'], noise.inputs['Vector'])
    tones = nodes.new('ShaderNodeValToRGB')
    tones.color_ramp.elements[0].position = .2
    tones.color_ramp.elements[0].color = (1-wear, 1-wear, 1-wear, 1)
    tones.color_ramp.elements[1].position = .8
    tones.color_ramp.elements[1].color = (1, 1, 1, 1)
    links.new(noise.outputs['Fac'], tones.inputs[0])
    original = bs.inputs['Base Color'].links[0].from_socket
    mix = nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
    links.new(original, mix.inputs[1]); links.new(tones.outputs['Color'], mix.inputs[2])
    links.new(mix.outputs[0], bs.inputs['Base Color'])
    bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .12
    bump.inputs['Distance'].default_value = .012
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    # Real ray-traced edge normals: dense curved outline vertices can globally clamp
    # a geometric bevel almost to zero. This retains a readable highlight on curves.
    bevel = nodes.new('ShaderNodeBevel'); bevel.inputs['Radius'].default_value = .045
    bevel.samples = 4
    links.new(bevel.outputs['Normal'], bump.inputs['Normal'])
    links.new(bump.outputs['Normal'], bs.inputs['Normal'])
    return mat


def outline(name, points, z, thickness, material, bevel=.035):
    # Real closed mesh, including bottom and bevelled sidewall; no camera-facing quad.
    if sum(x*points[(i+1) % len(points)][1]-points[(i+1) % len(points)][0]*y for i, (x, y) in enumerate(points)) < 0:
        points = list(reversed(points))
    n = len(points)
    vertices = [(x, y, z) for x, y in points] + [(x, y, z+thickness) for x, y in points]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    mesh = bpy.data.meshes.new(name); mesh.from_pydata(vertices, [], faces); mesh.update()
    ob = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(material)
    edge = ob.modifiers.new('Soft worn edges', 'BEVEL'); edge.width = bevel; edge.segments = 4
    ob.modifiers.new('Broad face normals', 'WEIGHTED_NORMAL')
    return ob


def rounded_rect(width, height, radius, segments=12):
    result = []
    for cx, cy, start in [(width/2-radius, height/2-radius, 0), (-width/2+radius, height/2-radius, 90),
                          (-width/2+radius, -height/2+radius, 180), (width/2-radius, -height/2+radius, 270)]:
        result += [(cx+radius*math.cos(math.radians(start+i*90/segments)),
                    cy+radius*math.sin(math.radians(start+i*90/segments))) for i in range(segments+1)]
    return result


def curve_polygon(anchors, steps=7):
    """Closed Catmull-Rom contour for broad flame/lenticular blade curves."""
    result = []
    for i in range(len(anchors)):
        p0, p1, p2, p3 = [anchors[j % len(anchors)] for j in (i-1, i, i+1, i+2)]
        for j in range(steps):
            t = j/steps
            result.append(tuple(.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t*t
                                  +(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t*t*t) for k in (0, 1)))
    return result


def cross_points(cx=0, cy=0, length=.7, arm=.235):
    return [(cx+x, cy+y) for x, y in [(-arm,length),(arm,length),(arm,arm),(length,arm),(length,-arm),
        (arm,-arm),(arm,-length),(-arm,-length),(-arm,-arm),(-length,-arm),(-length,arm),(-arm,arm)]]


def build_base(ctx, spec):
    rim = painted(ctx, 'Dark outer gunmetal separation', '303E49', .13, .55)
    bevel = painted(ctx, 'Exposed chamfered steel', '9CA9AE', .15, .43)
    face = painted(ctx, 'Recessed middle grey face', '7F898A', .19, .60)
    wear = painted(ctx, 'Exposed pale edge wear', 'C1C9C5', .08, .48)
    # Explicit continuous ring geometry: the broad bevel cannot be clamped by
    # short edges in the rounded corners. Inner rim stands above the center.
    profiles = [(1.94,.25,.02),(1.94,.25,.13),(1.72,.19,.28),(1.61,.16,.28),(1.56,.14,.21)]
    loops = [[(x,y,z) for x,y in rounded_rect(w,w,r)] for w,r,z in profiles]
    n=len(loops[0]); vertices=[p for loop in loops for p in loop]
    faces=[tuple(reversed(range(n)))]; slots=[0]
    for k in range(len(loops)-1):
        for i in range(n):
            faces.append((k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i))
            slots.append([0,1,1,0][k])
    faces.append(tuple(range((len(loops)-1)*n,len(loops)*n))); slots.append(2)
    mesh=bpy.data.meshes.new('Explicit broad bevel and recessed face');mesh.from_pydata(vertices,[],faces);mesh.update()
    body=bpy.data.objects.new('Rounded common foundation',mesh);ctx.scene.collection.objects.link(body)
    for material in [rim,bevel,face]:mesh.materials.append(material)
    for poly,index in zip(mesh.polygons,slots):poly.material_index=index
    # Short broken scuffs belong to the base itself, outside all symbol footprints.
    for i, (x, y, length, angle) in enumerate([(-.51,.825,.18,-3),(.28,.82,.10,2),(-.82,-.30,.13,85),(.76,-.67,.12,60)]):
        scratch = ctx.box('Restrained edge scuff '+str(i), (x,y,.284), (length,.018,.009), wear, .005)
        scratch.rotation_euler.z = math.radians(angle)
    return model(ctx.scene, {'base_meshes': [body]})


def build_symbol(ctx, spec):
    kind = spec['model']['symbol']
    def mat(name, color): return painted(ctx, name, color)
    if kind == 'hp':
        outline('Raised crimson medical cross', cross_points(), .26, .22, mat('Used crimson enamel','F01736'), .075)
    elif kind == 'armor':
        shield = [(-.66,.71),(.66,.71),(.65,-.10),(.43,-.46),(0,-.78),(-.43,-.46),(-.65,-.10)]
        outline('Gold shield rim', shield, .26, .13, mat('Dulled gold rim','BA7C26'), .045)
        outline('Convex amber shield face', [(x*.84,y*.84+.015) for x,y in shield], .38, .15, mat('Amber enamel','FFB71F'), .070)
    elif kind == 'rage':
        flame = [(-.52,-.53),(-.67,-.16),(-.59,.23),(-.39,.48),(-.36,.05),(-.16,.22),(.09,.79),(.35,.38),(.40,.04),(.57,.32),(.63,-.19),(.40,-.61),(0,-.72)]
        outline('Red flame relief', curve_polygon(flame), .26, .14, mat('Red-orange ceramic','FA281C'), .025)
        core = [(-.34,-.43),(-.35,-.14),(-.19,-.23),(.05,.31),(.25,-.10),(.32,-.40),(0,-.57)]
        outline('Warm flame heart', curve_polygon(core), .395, .075, mat('Warm coral heart','FF7941'), .025)
    elif kind == 'adrenaline':
        steel = mat('Satin syringe fittings','476B82'); blue = mat('Blue opaque dose cartridge','079EF8')
        pale = mat('Pale syringe scale','B8D8D9'); dark = mat('Blue-grey plunger','4A6170')
        made = []
        def box(name, x, y, w, h, material, z=.33, depth=.12, bevel=.018):
            ob=ctx.box(name,(x,y,z),(w,h,depth),material,bevel);made.append(ob);return ob
        box('Dose outer casing',0,.03,.43,.83,steel)
        box('Blue dose window',0,.04,.31,.66,blue,.415,.05)
        box('Finger flange',0,-.41,.68,.10,steel)
        box('Plunger stem',0,-.56,.10,.26,pale)
        box('Plunger thumb pad',0,-.72,.47,.10,dark)
        box('Needle hub',0,.51,.18,.16,dark)
        box('Needle',0,.71,.075,.26,pale,.33,.055,.01)
        for y in [-.14,.07,.27]: box('Broad dose tick',.11,y,.10,.025,pale,.451,.018,.005)
        angle=-math.pi/4
        for ob in made:
            x,y=ob.location.x,ob.location.y
            ob.location.x=x*math.cos(angle)-y*math.sin(angle);ob.location.y=x*math.sin(angle)+y*math.cos(angle)
            ob.rotation_euler.z=angle
    elif kind == 'bfg':
        ctx.cylinder('Deep green orb rim',(0,0,.31),.75,.14,mat('Green casing','3E722B'),64)
        ctx.ell('Lime energy lens',(0,0,.40),(.64,.64,.30),mat('Lime ceramic energy','95E829'))
        ctx.ell('Pale central core',(0,0,.69),(.27,.27,.07),mat('Pale lime core','E1FF83'))
    elif kind == 'damage-amp':
        plum=mat('Tempered magenta blades','E517BC'); edge=mat('Exposed pink cutting bevel','FF8BE4')
        blade=[(0,.79),(.13,.42),(.41,.17),(.45,-.17),(.32,-.45),(.03,-.80),(.10,-.40),(.23,-.16),(.22,.11),(.10,.35)]
        for side in [-1,1]:
            points=curve_polygon([(side*x,y) for x,y in blade])
            outline('Curved open blade '+str(side),points,.26,.15,plum,.018)
            ridge=[(side*x,y) for x,y in [(.06,.61),(.17,.32),(.34,.08),(.35,-.17),(.23,-.44),(.10,-.62),(.29,-.17),(.29,.07),(.14,.33)]]
            outline('Blade edge wear '+str(side),curve_polygon(ridge,4),.405,.022,edge,.008)
    elif kind == 'holy-grenade':
        gold=mat('Worn brass holy shell','FFB918'); shade=mat('Oxidized collar','AD782C')
        ctx.ell('Round holy grenade body',(0,-.23,.40),(.55,.57,.28),gold)
        ctx.box('Brass neck',(0,.32,.35),(.29,.31,.15),shade,.025)
        # Cross is upright in the image plane, not pointing into the camera.
        outline('Holy cross',[(x*.43,y*.43+.52) for x,y in cross_points(length=.62,arm=.18)],.29,.16,gold,.016)
        ctx.box('Single red square seal',(0,-.25,.683),(.24,.24,.025),mat('Red wax seal','D51E29'),.012)
    elif kind == 'nuke':
        yellow=mat('Safety yellow enamel','FFD30B'); black=mat('Charcoal radiation inlay','141D25')
        ctx.cylinder('Radiation warning medallion',(0,0,.34),.75,.15,yellow,96)
        ctx.cylinder('Trefoil center',(0,0,.428),.14,.025,black,48)
        for angle in [30,150,270]:
            outer=[(.65*math.cos(math.radians(angle+d)),.65*math.sin(math.radians(angle+d))) for d in range(-30,31,3)]
            inner=[(.235*math.cos(math.radians(angle+d)),.235*math.sin(math.radians(angle+d))) for d in range(30,-31,-3)]
            outline('Radiation sector '+str(angle),outer+inner,.418,.025,black,.006)
    else:
        raise ValueError('Unknown power-up symbol: '+kind)
    return model(ctx.scene, {'symbol_meshes': [ob for ob in ctx.scene.objects if ob.type=='MESH']})
