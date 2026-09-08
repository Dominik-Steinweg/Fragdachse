"""Player-only painted coat: broad fur groups with rest-space flow coordinates."""
import math
import bpy


def painted_coat(ctx, groups, materials, settings):
    """Reuse the packed fur source; texture coordinates deform with the skin."""
    bpy.context.view_layer.update()
    coat_materials = set(materials.values())
    for ob in ctx.scene.objects:
        if ob.type != 'MESH' or not any(slot.material in coat_materials for slot in ob.material_slots):
            continue
        flow = ob.data.attributes.new('FD_FurUV', 'FLOAT_VECTOR', 'POINT')
        mantle = ob in groups['arms'] and ob not in groups['hands']
        for vertex, item in zip(ob.data.vertices, flow.data):
            p = ob.matrix_world @ vertex.co
            if mantle:
                # Tangential strokes follow the U-shaped mantle into both arms.
                x, y = abs(p.x), p.y + .10
                radius = math.hypot(x, y)
                angle = math.atan2(x, -y)
                item.vector = (-.10 + .78 * radius, .08 + .46 * angle, 0)
            else:
                # Broad north/south tufts on the face, legs, thumbs and tail.
                item.vector = (.48 + .60 * p.x, .50 + .60 * p.y, 0)

    for role, material in materials.items():
        nodes, links = material.node_tree.nodes, material.node_tree.links
        flow = nodes.new('ShaderNodeAttribute')
        flow.attribute_name = 'FD_FurUV'
        flow.name = 'Rest-space painted fur flow'
        texture_grey = None
        for node in nodes:
            if node.type == 'TEX_IMAGE':
                node.extension = 'REPEAT'
                links.new(flow.outputs['Vector'], node.inputs['Vector'])
            elif node.type == 'MAP_RANGE' and node.inputs['Value'].is_linked:
                source = node.inputs['Value'].links[0].from_node
                if source.type == 'RGBTOBW':
                    texture_grey = node.inputs['Value'].links[0].from_socket
                    node.inputs['From Min'].default_value = .15
                    node.inputs['From Max'].default_value = .33
                    # Quiet, long painted groups; broad form values stay dominant.
                    node.inputs['To Min'].default_value = .95 if role == 'head' else .76
                    node.inputs['To Max'].default_value = 1.06 if role == 'head' else 1.20
                elif source.type == 'TEX_NOISE':
                    # Remove the shared organic shader's cloudy modulation.
                    node.inputs['To Min'].default_value = 1
                    node.inputs['To Max'].default_value = 1
        if role == 'head':
            bands = nodes['Authored facial band mix']
            dark_fur = nodes.new('ShaderNodeMixRGB')
            dark_fur.name = 'Textured charcoal face bands'
            dark_fur.blend_type = 'MULTIPLY'
            dark_fur.inputs[0].default_value = 1
            dark_fur.inputs[1].default_value = (.011, .015, .019, 1)
            band_values = nodes.new('ShaderNodeMapRange')
            band_values.inputs['From Min'].default_value = .15
            band_values.inputs['From Max'].default_value = .33
            band_values.inputs['To Min'].default_value = .85
            band_values.inputs['To Max'].default_value = 1.15
            links.new(texture_grey, band_values.inputs['Value'])
            links.new(band_values.outputs['Result'], dark_fur.inputs[2])
            links.new(dark_fur.outputs[0], bands.inputs[2])
        bs = nodes.get('Principled BSDF')
        original = bs.inputs['Base Color'].links[0].from_socket
        if role in ('head', 'tail', 'feet', 'dark'):
            # A deterministic crown/side temperature hierarchy, never random color.
            geometry = nodes.new('ShaderNodeNewGeometry')
            normal_z = nodes.new('ShaderNodeSeparateXYZ')
            links.new(geometry.outputs['Normal'], normal_z.inputs[0])
            tones = nodes.new('ShaderNodeValToRGB')
            tones.name = 'Cool sides and warm crown'
            tones.color_ramp.interpolation = 'EASE'
            tones.color_ramp.elements[0].position = .12
            tones.color_ramp.elements[0].color = (.62, .74, .90, 1)
            tones.color_ramp.elements[1].position = .95
            tones.color_ramp.elements[1].color = (1, .97, .88, 1)
            links.new(normal_z.outputs['Z'], tones.inputs[0])
            mix = nodes.new('ShaderNodeMixRGB')
            mix.blend_type = 'MULTIPLY'
            mix.inputs[0].default_value = 1
            links.new(original, mix.inputs[1])
            links.new(tones.outputs[0], mix.inputs[2])
            original = mix.outputs[0]

        # Cross-object AO follows the animated head/arm contact. It changes only
        # albedo: no displacement, geometry, alpha, cast ground shadow or new lamp.
        ao = nodes.new('ShaderNodeAmbientOcclusion')
        ao.name = 'Soft head and mantle contact AO'
        ao.samples = 32
        ao.only_local = False
        ao.inputs['Distance'].default_value = settings.get('contactAODistance', .42)
        occlusion = nodes.new('ShaderNodeValToRGB')
        occlusion.name = 'Broad cool contact falloff'
        occlusion.color_ramp.interpolation = 'EASE'
        occlusion.color_ramp.elements[0].position = .15
        occlusion.color_ramp.elements[0].color = (.12, .20, .30, 1)
        occlusion.color_ramp.elements[1].position = .98
        occlusion.color_ramp.elements[1].color = (1, 1, 1, 1)
        depth = nodes.new('ShaderNodeMath')
        depth.name = 'Soft contact depth response'
        depth.operation = 'POWER'
        depth.inputs[1].default_value = 3
        links.new(ao.outputs['AO'], depth.inputs[0])
        links.new(depth.outputs[0], occlusion.inputs[0])
        contact = nodes.new('ShaderNodeMixRGB')
        contact.name = 'Painted contact depth'
        contact.blend_type = 'MULTIPLY'
        contact.inputs[0].default_value = settings.get('contactAOStrength', .9)
        links.new(original, contact.inputs[1])
        links.new(occlusion.outputs[0], contact.inputs[2])
        links.new(contact.outputs[0], bs.inputs['Base Color'])
