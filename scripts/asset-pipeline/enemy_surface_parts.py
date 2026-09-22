"""Shared enemy surface finish: directional broad fur, colored form and contact.

Geometry, identity colors and locomotion are owned by the individual recipes.
No extra light, silhouette change, emission or screen-space outline is added.
"""


def finish_surfaces(scene, materials=None):
    materials=materials if materials is not None else {m for ob in scene.objects if ob.type=='MESH' for m in ob.data.materials}
    for material in materials:
        if material.get('FD_EnemyFinish'): continue
        n,l=material.node_tree.nodes,material.node_tree.links
        bs=n.get('Principled BSDF')
        if not bs or bs.inputs['Emission Strength'].default_value > 0: continue
        source=bs.inputs['Base Color'].links[0].from_socket if bs.inputs['Base Color'].is_linked else None
        if source is None:
            base=n.new('ShaderNodeRGB'); base.outputs[0].default_value=bs.inputs['Base Color'].default_value
            source=base.outputs[0]
        geometry=n.new('ShaderNodeNewGeometry')
        facing=n.new('ShaderNodeVectorMath'); facing.operation='DOT_PRODUCT'
        facing.inputs[1].default_value=(0,0,1); l.new(geometry.outputs['Normal'],facing.inputs[0])
        ramp=n.new('ShaderNodeMapRange'); ramp.interpolation_type='SMOOTHSTEP'
        ramp.inputs['From Min'].default_value=.10; ramp.inputs['From Max'].default_value=.96
        ramp.inputs['To Min'].default_value=.38; ramp.inputs['To Max'].default_value=1.20
        l.new(facing.outputs['Value'],ramp.inputs['Value'])
        shade=n.new('ShaderNodeMixRGB'); shade.blend_type='MULTIPLY'; shade.inputs[0].default_value=.84
        l.new(source,shade.inputs[1]); l.new(ramp.outputs[0],shade.inputs[2])
        ao=n.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value=.14; ao.samples=16
        contact=n.new('ShaderNodeMixRGB'); contact.blend_type='MULTIPLY'; contact.inputs[0].default_value=.48
        l.new(shade.outputs[0],contact.inputs[1]); l.new(ao.outputs['AO'],contact.inputs[2])
        l.new(contact.outputs[0],bs.inputs['Base Color'])
        # Stretch existing local surface coordinates into broad longitudinal groups.
        # Generated coordinates stay attached to the weighted mesh during gait.
        for noise in [node for node in n if node.type=='TEX_NOISE']:
            if noise.inputs['Vector'].is_linked:
                coords=noise.inputs['Vector'].links[0].from_socket
                stretch=n.new('ShaderNodeVectorMath'); stretch.operation='MULTIPLY'
                stretch.inputs[1].default_value=(3.2,.65,1.1)
                l.new(coords,stretch.inputs[0]); l.new(stretch.outputs[0],noise.inputs['Vector'])
            noise.inputs['Scale'].default_value=7
            noise.inputs['Detail'].default_value=1.5
        # Quiet texture leaves authored colors and smooth sculpted volumes readable.
        for node in [node for node in n if node.type=='MAP_RANGE' and node.inputs['Value'].is_linked]:
            source_type=node.inputs['Value'].links[0].from_node.type
            if source_type=='TEX_NOISE':
                node.inputs['To Min'].default_value=.90
                node.inputs['To Max'].default_value=1.06
            elif source_type=='RGBTOBW':
                node.inputs['To Min'].default_value=.78
                node.inputs['To Max'].default_value=1.08
        bs.inputs['Roughness'].default_value=.80
        bs.inputs['Specular IOR Level'].default_value=.18
        coords=n.new('ShaderNodeTexCoord')
        grain_coords=n.new('ShaderNodeVectorMath'); grain_coords.operation='MULTIPLY'
        organic=any(node.type=='TEX_NOISE' for node in n)
        grain_coords.inputs[1].default_value=(5,.7,2) if organic else (1,1,1)
        l.new(coords.outputs['Generated'],grain_coords.inputs[0])
        grain=n.new('ShaderNodeTexNoise'); grain.inputs['Scale'].default_value=22 if organic else 48
        grain.inputs['Detail'].default_value=2
        l.new(grain_coords.outputs[0],grain.inputs['Vector'])
        relief=n.new('ShaderNodeBump'); relief.inputs['Strength'].default_value=.24
        relief.inputs['Distance'].default_value=.014 if organic else .006
        l.new(grain.outputs['Fac'],relief.inputs['Height']);l.new(relief.outputs['Normal'],bs.inputs['Normal'])
        material['FD_EnemyFinish']=True
