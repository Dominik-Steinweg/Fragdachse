"""Explicit adapter for archived Kraken materials; never edits source Blend files.

Pigment, dermis, authored cavity depth and AO remain. Directional form colour,
view sheen and BSDF highlights do not enter albedo. Shading normals keep bump.
"""
import bpy


def adapt(original, mode, height_range):
    m = original.copy()
    m.name = 'LS_' + mode + '_' + original.name
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bs is None:
        raise ValueError('Unsupported Kraken material: ' + original.name)
    audit = {'material': original.name, 'mode': mode, 'bypassed': []}
    # v8 mix(Color) nodes retain cavity and painted depth downstream of this
    # directional scalar. Make only the lamp-dependent multiplier neutral.
    for n in list(nodes):
        if n.name in ('Broad form value', 'Deep cool flanks and lit organic ridge edges'):
            for link in list(n.outputs[0].links):
                socket = link.to_socket
                links.remove(link)
                socket.default_value = (1,1,1,1) if socket.type == 'RGBA' else 1
            audit['bypassed'].append(n.name)
        if n.name == 'Iridescent violet-teal sheen':
            # MIX RGBA sockets factor=0, A=6. Keep pigment, drop view highlight.
            for link in list(n.inputs[0].links): links.remove(link)
            n.inputs[0].default_value = 0
            audit['bypassed'].append(n.name)
    geom = nodes.new('ShaderNodeNewGeometry')
    emit = nodes.new('ShaderNodeEmission')
    def link_or_value(source, target):
        if source.is_linked: links.new(source.links[0].from_socket,target)
        else: target.default_value=source.default_value
    if mode == 'albedo':
        link_or_value(bs.inputs['Base Color'],emit.inputs['Color'])
    elif mode == 'emission':
        link_or_value(bs.inputs['Emission Color'],emit.inputs['Color'])
        link_or_value(bs.inputs['Emission Strength'],emit.inputs['Strength'])
    elif mode == 'normal':
        normal = bs.inputs['Normal'].links[0].from_socket if bs.inputs['Normal'].is_linked else geom.outputs['Normal']
        mul = nodes.new('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value=(.5,-.5,.5)
        add = nodes.new('ShaderNodeVectorMath'); add.operation = 'ADD'; add.inputs[1].default_value=(.5,.5,.5)
        links.new(normal,mul.inputs[0]); links.new(mul.outputs[0],add.inputs[0]); links.new(add.outputs[0],emit.inputs['Color'])
    elif mode == 'height':
        xyz=nodes.new('ShaderNodeSeparateXYZ'); links.new(geom.outputs['Position'],xyz.inputs[0])
        remap=nodes.new('ShaderNodeMapRange'); remap.clamp=False
        remap.inputs['From Min'].default_value=height_range[0];remap.inputs['From Max'].default_value=height_range[1]
        links.new(xyz.outputs['Z'],remap.inputs['Value']);links.new(remap.outputs[0],emit.inputs['Color'])
    else: raise ValueError(mode)
    for output in [n for n in nodes if n.type=='OUTPUT_MATERIAL']:
        links.new(emit.outputs[0],output.inputs['Surface'])
    # Animated emission drivers on the copy remain evaluable. No source nodes change.
    return m, audit
