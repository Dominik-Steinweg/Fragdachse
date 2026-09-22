"""Rest-space fur and surface-conforming details for the authored zombie sculpt."""
import math
import random
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


class Surface:
    def __init__(self, objects):
        bpy.context.view_layer.update()
        vertices, faces = [], []
        graph = bpy.context.evaluated_depsgraph_get()
        for ob in objects:
            evaluated = ob.evaluated_get(graph)
            mesh = evaluated.to_mesh()
            offset = len(vertices)
            vertices.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
            faces.extend(tuple(offset+i for i in p.vertices) for p in mesh.polygons)
            evaluated.to_mesh_clear()
        self.tree = BVHTree.FromPolygons(vertices, faces)

    def height(self, x, y):
        p, _, _, _ = self.tree.ray_cast(Vector((x,y,4)), Vector((0,0,-1)))
        return p.z if p is not None else None

    def point(self, x, y, lift=.008):
        z = self.height(x,y)
        if z is None: raise ValueError(f'Zombie detail leaves its skin at {x:.3f}, {y:.3f}')
        return (x,y,z+lift)


def mesh_object(c, name, vertices, faces, materials, indices=None):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    for mat in materials:mesh.materials.append(mat)
    for i,p in enumerate(mesh.polygons):
        p.use_smooth=True
        if indices:p.material_index=indices[i]
    ob=bpy.data.objects.new(name,mesh);c.scene.collection.objects.link(ob)
    return ob


def patch(c, name, surface, outline, material, lift=.012, crown=.005):
    """Tessellated patch follows the real curved skin rather than spanning it as a flat plate."""
    cx=sum(x for x,y in outline)/len(outline);cy=sum(y for x,y in outline)/len(outline)
    vertices=[surface.point(cx,cy,lift+crown)];faces=[];n=len(outline)
    for ring in range(1,7):
        t=ring/6
        vertices.extend(surface.point(cx+(x-cx)*t,cy+(y-cy)*t,lift+crown*(1-t*t)) for x,y in outline)
        start=1+(ring-1)*n
        for i in range(n):
            j=(i+1)%n
            faces.append((0,start+i,start+j) if ring==1 else (start-n+i,start+i,start+j,start-n+j))
    return mesh_object(c,name,vertices,faces,[material])


def oval(x,y,rx,ry,angle=0,ragged=0,seed=0):
    rng=random.Random(seed);points=[]
    phase=rng.uniform(0,math.tau)
    for i in range(48):
        a=math.tau*i/48;r=1+ragged*(.62*math.sin(5*a+phase)+.28*math.sin(9*a-phase)+.16*math.sin(13*a+phase))
        dx,dy=rx*math.cos(a)*r,ry*math.sin(a)*r
        points.append((x+dx*math.cos(angle)-dy*math.sin(angle),y+dx*math.sin(angle)+dy*math.cos(angle)))
    return points


def torn_rim(c,surface,outer,inner,material):
    vertices=[];faces=[];count=len(outer)
    for t in (0,.22,.5,.78,1):
        for (ox,oy),(ix,iy) in zip(outer,inner):
            vertices.append(surface.point(ix+(ox-ix)*t,iy+(oy-iy)*t,.015+.027*math.sin(math.pi*t)))
    for ring in range(4):
        for i in range(count):
            a=ring*count+i;b=ring*count+(i+1)%count
            faces.append((a,a+count,b+count,b))
    return mesh_object(c,'Rolled irregular torn skin lip',vertices,faces,[material])


def locks(c, name, surface, bounds, materials, seed=1, spacing=.058, length=.085, skip=None):
    """One mesh of overlapping curved tufts; long planes survive the export reduction."""
    rng=random.Random(seed);vertices=[];faces=[];indices=[]
    xmin,ymin,xmax,ymax=bounds
    rows=math.ceil((ymax-ymin)/spacing)
    for row in range(rows+1):
        y=ymin+row*spacing
        for col in range(math.ceil((xmax-xmin)/spacing)+1):
            x=xmin+(col+.5*(row%2))*spacing+rng.uniform(-.015,.015)
            yy=y+rng.uniform(-.016,.016);z=surface.height(x,yy)
            if z is None or (skip and skip(x,yy)):continue
            w=rng.uniform(.25,.42)*spacing;lng=length*rng.uniform(.70,1.22)
            sweep=x*.06+rng.uniform(-.018,.018)
            base=len(vertices)
            for t,width in [(0,1),(.2,.94),(.46,.73),(.72,.42),(1,.015)]:
                for u in (-1,-.33,.33,1):
                    dx=u*w*width+sweep*t;dy=-lng*t
                    h=surface.height(x+dx,yy+dy)
                    lift=-.004+.011*math.sin(math.pi*t)*(1-u*u)
                    vertices.append((x+dx,yy+dy,(h if h is not None else z-.045*t)+lift))
            index=rng.choices(range(len(materials)),weights=[6]+[1]*(len(materials)-1))[0]
            for row_index in range(4):
                for col_index in range(3):
                    a=base+row_index*4+col_index
                    faces.append((a,a+4,a+5,a+1));indices.append(index)
    ob=mesh_object(c,name,vertices,faces,materials,indices)
    ob.visible_shadow=False
    return ob


def coat_finish(c, materials):
    """The existing packed painted-fur image gets anatomical flow and a stronger lock range."""
    bpy.context.view_layer.update()
    for ob in c.scene.objects:
        if ob.type!='MESH' or not any(m in materials for m in ob.data.materials):continue
        attr=ob.data.attributes.new('FD_ZombieRest','FLOAT_VECTOR','POINT')
        for v,a in zip(ob.data.vertices,attr.data):a.vector=ob.matrix_world@v.co
    for mat in materials:
        n,l=mat.node_tree.nodes,mat.node_tree.links
        coords=n.new('ShaderNodeAttribute');coords.attribute_name='FD_ZombieRest'
        scale=n.new('ShaderNodeVectorMath');scale.operation='MULTIPLY_ADD'
        scale.inputs[1].default_value=(.69,.60,.5);scale.inputs[2].default_value=(.5,.5,0)
        l.new(coords.outputs['Vector'],scale.inputs[0])
        grey=None
        for node in list(n):
            if node.type=='TEX_IMAGE':
                node.extension='REPEAT';l.new(scale.outputs[0],node.inputs['Vector'])
            if node.type=='MAP_RANGE' and node.inputs['Value'].is_linked:
                kind=node.inputs['Value'].links[0].from_node.type
                if kind=='RGBTOBW':
                    grey=node.inputs['Value'].links[0].from_socket
                    for k,v in [('From Min',.07),('From Max',.45),('To Min',.48),('To Max',1.20)]:node.inputs[k].default_value=v
                elif kind=='TEX_NOISE':node.inputs['To Min'].default_value=.97;node.inputs['To Max'].default_value=1.03
        if grey:
            bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.27;bump.inputs['Distance'].default_value=.018
            l.new(grey,bump.inputs['Height']);l.new(bump.outputs['Normal'],n.get('Principled BSDF').inputs['Normal'])


def face_bands(material):
    n,l=material.node_tree.nodes,material.node_tree.links;bs=n.get('Principled BSDF')
    pale=bs.inputs['Base Color'].links[0].from_socket
    coord=n.new('ShaderNodeAttribute');coord.attribute_name='FD_ZombieRest'
    xyz=n.new('ShaderNodeSeparateXYZ');l.new(coord.outputs['Vector'],xyz.inputs[0])
    def op(kind,a,b):
        node=n.new('ShaderNodeMath');node.operation=kind
        for value,socket in [(a,node.inputs[0]),(b,node.inputs[1])]:
            if isinstance(value,(int,float)):socket.default_value=value
            else:l.new(value,socket)
        return node.outputs[0]
    front=n.new('ShaderNodeMapRange');front.clamp=True
    front.inputs['From Min'].default_value=.25;front.inputs['From Max'].default_value=1.16
    l.new(xyz.outputs['Y'],front.inputs[0])
    width=op('SUBTRACT',.41,op('MULTIPLY',front.outputs[0],.23))
    distance=op('DIVIDE',op('ABSOLUTE',xyz.outputs['X'],0),width)
    noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=75;noise.inputs['Detail'].default_value=1
    l.new(coord.outputs['Vector'],noise.inputs['Vector'])
    distance=op('ADD',distance,op('MULTIPLY',op('SUBTRACT',noise.outputs['Fac'],.5),.12))
    ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.interpolation='EASE'
    ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
    for i,(pos,val) in enumerate([(0,0),(.22,0),(.34,1),(.75,1),(.87,0)]):
        e=ramp.color_ramp.elements[0] if i==0 else ramp.color_ramp.elements.new(pos)
        e.position=pos;e.color=(val,val,val,1)
    l.new(distance,ramp.inputs[0])
    dark=n.new('ShaderNodeMixRGB');dark.blend_type='MULTIPLY';dark.inputs[0].default_value=1
    l.new(pale,dark.inputs[1]);dark.inputs[2].default_value=(.075,.078,.080,1)
    mix=n.new('ShaderNodeMixRGB');l.new(ramp.outputs[0],mix.inputs[0]);l.new(pale,mix.inputs[1]);l.new(dark.outputs[0],mix.inputs[2]);l.new(mix.outputs[0],bs.inputs['Base Color'])


def weather(material,cloth=False):
    """Quiet stains and actual woven relief for secondary details, after the shared matte finish."""
    n,l=material.node_tree.nodes,material.node_tree.links;bs=n.get('Principled BSDF')
    source=bs.inputs['Base Color'].links[0].from_socket
    coords=n.new('ShaderNodeTexCoord');noise=n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value=11;noise.inputs['Detail'].default_value=3
    l.new(coords.outputs['Generated'],noise.inputs['Vector'])
    ramp=n.new('ShaderNodeMapRange');ramp.inputs['To Min'].default_value=.58;ramp.inputs['To Max'].default_value=1.18
    l.new(noise.outputs['Fac'],ramp.inputs[0])
    mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.8
    l.new(source,mix.inputs[1]);l.new(ramp.outputs[0],mix.inputs[2]);l.new(mix.outputs[0],bs.inputs['Base Color'])
    height=noise.outputs['Fac']
    if cloth:
        threads=[]
        for axis in ('X','Y'):
            wave=n.new('ShaderNodeTexWave');wave.bands_direction=axis;wave.inputs['Scale'].default_value=72
            l.new(coords.outputs['Generated'],wave.inputs['Vector']);threads.append(wave.outputs['Fac'])
        crossing=n.new('ShaderNodeMath');crossing.operation='MULTIPLY'
        l.new(threads[0],crossing.inputs[0]);l.new(threads[1],crossing.inputs[1]);height=crossing.outputs[0]
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.30;bump.inputs['Distance'].default_value=.009 if cloth else .018
    l.new(height,bump.inputs['Height']);l.new(bump.outputs['Normal'],bs.inputs['Normal'])
