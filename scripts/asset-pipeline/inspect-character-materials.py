"""Read-only Blender material audit. No render, save, source mutation or output files."""
import bpy
import json

scenes = [s for s in bpy.data.scenes if s.get('asset_manifest')]
if len(scenes) != 1:
    raise ValueError('Expected one archived asset scene')
materials = {slot.material for o in scenes[0].objects if o.type == 'MESH' for slot in o.material_slots if slot.material}
result = []
for m in sorted(materials, key=lambda m: m.name):
    nodes = m.node_tree.nodes
    bs = nodes.get('Principled BSDF')
    entry = {'material': m.name}
    if bs:
        entry['emissionStrength'] = float(bs.inputs['Emission Strength'].default_value)
        entry['emissionLinked'] = bs.inputs['Emission Strength'].is_linked or bs.inputs['Emission Color'].is_linked
        entry['specularIOR'] = float(bs.inputs['Specular IOR Level'].default_value)
        entry['roughness'] = float(bs.inputs['Roughness'].default_value)
    for name in ('Form shadow strength', 'Surface detail strength', 'Broad muscle values', 'Soft contact depth response'):
        node = nodes.get(name)
        if node:
            entry[name] = ([{'position': e.position, 'color': list(e.color)} for e in node.color_ramp.elements]
                           if node.type == 'VALTORGB' else
                           [{'name': s.name, 'linked': s.is_linked,
                             'value': list(s.default_value) if hasattr(s.default_value, '__len__') else s.default_value}
                            for s in node.inputs if hasattr(s, 'default_value')])
    result.append(entry)
print('FD_MATERIAL_AUDIT ' + json.dumps(result))
