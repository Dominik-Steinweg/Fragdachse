"""Enemy-specific skulls and protective equipment, viewed with the unchanged top camera."""
import math
from mathutils import Vector
from enemy_parts_b import tube, plate
from weapon_surface_parts import material, paint_depth


def pyro_head(c):
    red=material(c,'Fire red worn protective helmet',(.42,.020,.012),kind='coat')
    dark=material(c,'Sooted elastomer respirator',(.014,.018,.019),kind='rubber')
    metal=material(c,'Dull stainless mask fittings',(.20,.23,.22),.16,kind='edge')
    glass=material(c,'Smoked amber visor glass',(.23,.073,.019),kind='ceramic')
    lining=c.material('Charcoal woven fireproof hood',(.048,.026,.021),'organic')
    before=set(c.scene.objects)
    c.ell('Fireproof neck hood',(0,-.015,1.92),(.37,.44,.21),lining)
    c.ell('Flared helmet lower brim',(0,-.05,1.96),(.46,.405,.065),red)
    c.ell('Rounded red helmet crown',(0,-.12,2.055),(.365,.345,.255),red)
    # Two raised ribs run over the helmet, following its real rounded upper surface.
    for side in (-1,1):
        points=[]
        for i in range(19):
            y=-.36+i*.45/18;x=side*.14
            z=2.055+.255*math.sqrt(max(0,1-(x/.365)**2-((y+.12)/.345)**2))
            points.append((x,y,z+.009))
        tube(c,'Helmet stiffening rib',points,.017,metal,12)
        c.ell('Helmet rivet',(side*.36,-.075,2.0),(.025,.025,.016),metal)
    c.ell('Forward rubber face seal',(0,.285,1.98),(.265,.26,.13),dark)
    for side in (-1,1):
        rim=c.ell('Recessed respirator lens rim',(side*.13,.28,2.087),(.112,.115,.035),metal)
        rim.rotation_euler.z=side*.27
        lens=c.ell('Separate smoked respirator eyepiece',(side*.13,.29,2.109),(.089,.088,.021),glass)
        lens.rotation_euler.z=side*.27
        c.ell('Round breathing filter housing',(side*.265,.39,1.977),(.109,.139,.09),dark)
        c.ell('Metal filter grille',(side*.27,.405,2.053),(.082,.103,.021),metal)
        for dx in (-.040,0,.040):
            c.box('Filter grille opening',(side*.27+dx,.41,2.075),(.016,.117,.012),dark,.006)
        tube(c,'Respirator retention strap',[(side*.28,.30,2.055),(side*.365,.13,2.02),(side*.37,-.08,2.04)],.025,dark,12)
    c.ell('Central projecting respirator valve',(0,.48,1.983),(.109,.123,.095),dark)
    for dx in (-.04,0,.04): c.box('Breather valve slit',(dx,.50,2.065),(.015,.09,.012),metal,.005)
    plate(c,'Helmet identification badge',(0,-.12,2.311),[(-.07,-.085),(.07,-.085),(.082,.035),(0,.08),(-.082,.035)],.009,metal,.004)
    head=[o for o in c.scene.objects if o not in before and o.type=='MESH']
    for ob in head: paint_depth(c,ob)
    return head


def alien_bands(skin):
    """Short facial remnants of the badger mask, leaving the broad alien dome unstriped."""
    n,l=skin.node_tree.nodes,skin.node_tree.links
    bs=n.get('Principled BSDF');base=bs.inputs['Base Color'].links[0].from_socket
    coords=n.new('ShaderNodeTexCoord');xyz=n.new('ShaderNodeSeparateXYZ');l.new(coords.outputs['Generated'],xyz.inputs[0])
    def op(kind,a,b):
        node=n.new('ShaderNodeMath');node.operation=kind
        for v,s in [(a,node.inputs[0]),(b,node.inputs[1])]:
            if isinstance(v,(int,float)):s.default_value=v
            else:l.new(v,s)
        return node.outputs[0]
    def ramp(source,low,high):
        node=n.new('ShaderNodeValToRGB');node.color_ramp.interpolation='EASE'
        for e,p,v in zip(node.color_ramp.elements,(low,high),(1,0)):e.position=p;e.color=(v,v,v,1)
        l.new(source,node.inputs[0]);return node.outputs[0]
    x=op('ABSOLUTE',op('SUBTRACT',xyz.outputs['X'],.5),0)
    extent=n.new('ShaderNodeMapRange');extent.clamp=True
    extent.inputs['From Min'].default_value=.25;extent.inputs['From Max'].default_value=.70
    extent.inputs['To Min'].default_value=0;extent.inputs['To Max'].default_value=.92
    l.new(xyz.outputs['Y'],extent.inputs['Value'])
    center=op('ADD',.10,op('MULTIPLY',op('SINE',op('MULTIPLY',xyz.outputs['Y'],math.pi),0),.10))
    band=op('MULTIPLY',ramp(op('ABSOLUTE',op('SUBTRACT',x,center),0),.017,.053),extent.outputs[0])
    mix=n.new('ShaderNodeMixRGB');mix.name='Subtle dark badger ancestry bands'
    l.new(band,mix.inputs[0]);l.new(base,mix.inputs[1]);mix.inputs[2].default_value=(.018,.022,.022,1)
    crest=n.new('ShaderNodeMixRGB');crest.name='Short off-white facial crest'
    l.new(op('MULTIPLY',ramp(x,.035,.105),extent.outputs[0]),crest.inputs[0]);l.new(mix.outputs[0],crest.inputs[1])
    crest.inputs[2].default_value=(.72,.77,.70,1);l.new(crest.outputs[0],bs.inputs['Base Color'])


def alien_head(c):
    skin=c.material('Smooth pale celadon alien skin',(.30,.53,.43),'organic')
    dark=c.material('Obsidian alien eyes',(.0025,.009,.012))
    dark['FD_AlienEye']=True
    bs=dark.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.3;bs.inputs['Specular IOR Level'].default_value=.3
    crease=c.material('Recessed alien folds',(.043,.105,.088),'organic')
    pale=c.material('Subtle mint eye reflection',(.40,.63,.52))
    before=set(c.scene.objects)
    skull=c.ell('Large smooth alien cranium',(0,.005,1.95),(.445,.465,.325),skin)
    for v in skull.data.vertices:
        # Large rounded rear skull, narrow front jaw; no fur ruff or round mammal ears.
        v.co.x*=1-.43*max(0,v.co.y)
        if v.co.y<0:v.co.x*=1.07
    skull.data.update()
    alien_bands(skin)
    c.scene.view_layers[0].update();transform=skull.matrix_world.copy();inverse=transform.inverted()
    direction=(inverse.to_3x3()@Vector((0,0,-1))).normalized()
    def surface(x,y):
        hit,p,_,_=skull.ray_cast(inverse@Vector((x,y,3)),direction)
        if not hit:raise ValueError(f'Alien facial detail leaves the skull at {x:.3f}, {y:.3f}')
        return (transform@p).z
    for side in (-1,1):
        # Almond openings project onto the actual skull surface; they do not tilt the view.
        outline=[];cx,cy=side*.205,.15
        for i in range(32):
            a=i*math.tau/32
            dx=.101*math.cos(a);dy=.157*math.sin(a)*abs(math.sin(a))**.25
            angle=side*.42
            x=cx+dx*math.cos(angle)-dy*math.sin(angle);y=cy+dx*math.sin(angle)+dy*math.cos(angle)
            outline.append((x,y,surface(x,y)+.007))
        # Concentric surface samples prevent broad fan triangles from sinking into the convex skull.
        vertices=[(cx,cy,surface(cx,cy)+.020)];faces=[]
        for ring in range(1,7):
            t=ring/6
            for ox,oy,_ in outline:
                x=cx+(ox-cx)*t;y=cy+(oy-cy)*t
                vertices.append((x,y,surface(x,y)+.010+.010*(1-t*t)))
            start=1+(ring-1)*32
            for i in range(32):
                j=(i+1)%32
                faces.append((0,start+i,start+j) if ring==1 else (start-32+i,start+i,start+j,start-32+j))
        import bpy
        mesh=bpy.data.meshes.new('Conforming almond eye');mesh.from_pydata(vertices,[],faces);mesh.update()
        ob=bpy.data.objects.new('Large swept black alien eye',mesh);c.scene.collection.objects.link(ob);mesh.materials.append(dark)
        for p in mesh.polygons:p.use_smooth=True
        tube(c,'Soft alien orbital fold',outline+[outline[0]],.010,crease,10)
        c.ell('Restrained alien eye glint',(side*.18-.021,.205,surface(side*.18-.021,.205)+.026),(.014,.029,.007),pale)
        c.ell('Alien nostril',(side*.047,.389,surface(side*.047,.389)+.006),(.013,.025,.008),crease)
    tube(c,'Small alien mouth',[(x,.426-.07*abs(x),surface(x,.426-.07*abs(x))+.007) for x in (-.07,-.035,0,.035,.07)],.007,crease,10)
    return [o for o in c.scene.objects if o not in before and o.type=='MESH']
