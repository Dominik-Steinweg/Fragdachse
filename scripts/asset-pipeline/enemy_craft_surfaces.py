"""Material-specific weathering, grown grain and quiet relief for the enemy library."""
import math
from zombie_surface_parts import weather
from weapon_surface_parts import material as weapon_material, paint_depth


def technical(c,name,color,kind='coat'):
    mat=weapon_material(c,name,color,kind=kind)
    # Weapon materials also support moving armor: bind world-scale grain to the
    # authored rest mesh, so scratches do not swim while a limb walks in place.
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    rest=nodes.new('ShaderNodeAttribute');rest.attribute_name='FD_CraftRest'
    for link in list(links):
        if link.from_node.type=='NEW_GEOMETRY' and link.from_socket.name=='Position':links.new(rest.outputs['Vector'],link.to_socket)
    mat['FD_EnemyFinish']=True
    return mat


def finish_material(mat,kind):
    if mat.get('FD_CraftSurface'):return
    mat['FD_CraftSurface']=kind
    if mat.get('FD_SurfaceKind'):return
    weather(mat,cloth=kind in ('cloth','leather'))
    n,l=mat.node_tree.nodes,mat.node_tree.links;bs=n.get('Principled BSDF')
    source=bs.inputs['Base Color'].links[0].from_socket
    uv=n.new('ShaderNodeTexCoord');coords=uv.outputs['Generated']
    stone=kind in ('stone','basalt')
    grain=n.new('ShaderNodeTexNoise');grain.inputs['Scale'].default_value=38 if stone else 14
    grain.inputs['Detail'].default_value=4;l.new(coords,grain.inputs['Vector'])
    rough=n.new('ShaderNodeMapRange');rough.inputs['To Min'].default_value=.33 if stone else .49;rough.inputs['To Max'].default_value=1.32
    l.new(grain.outputs['Fac'],rough.inputs[0])
    mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.76
    l.new(source,mix.inputs[1]);l.new(rough.outputs[0],mix.inputs[2]);l.new(mix.outputs[0],bs.inputs['Base Color'])
    relief=grain.outputs['Fac']
    if kind in ('horn','fungus','sac'):
        wave=n.new('ShaderNodeTexWave');wave.wave_type='RINGS' if kind=='fungus' else 'BANDS';wave.bands_direction='Y'
        wave.inputs['Scale'].default_value=19 if kind=='horn' else 9;wave.inputs['Distortion'].default_value=5
        l.new(coords,wave.inputs['Vector']);relief=wave.outputs['Fac']
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.47 if stone else .32
    bump.inputs['Distance'].default_value=.034 if stone else .018
    if bs.inputs['Normal'].is_linked:l.new(bs.inputs['Normal'].links[0].from_socket,bump.inputs['Normal'])
    l.new(relief,bump.inputs['Height']);l.new(bump.outputs['Normal'],bs.inputs['Normal'])
    bs.inputs['Roughness'].default_value=.91 if stone else .78


def sculpt_stone(ob):
    for v in ob.data.vertices:
        p=ob.matrix_world@v.co
        offset=.017*(math.sin(p.x*17+p.y*9)*math.sin(p.y*19-p.z*12)+.35*math.sin(p.x*43+p.y*35))
        v.co+=v.normal*offset
    ob.data.update()


def attach_depth(c,objects):
    for ob in objects:
        if any(m and m.get('FD_SurfaceKind') for m in ob.data.materials):
            paint_depth(c,ob)
            attr=ob.data.attributes.new('FD_CraftRest','FLOAT_VECTOR','POINT')
            for vertex,value in zip(ob.data.vertices,attr.data):value.vector=ob.matrix_world@vertex.co
