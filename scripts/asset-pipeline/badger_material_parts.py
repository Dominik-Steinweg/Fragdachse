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
                item.vector = (-.10 + .92 * radius, .08 + .60 * angle, 0)
            else:
                # Broad north/south tufts on the face, legs, thumbs and tail.
                item.vector = (.48 + .70 * p.x, .50 + .70 * p.y, 0)

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
                    node.inputs['From Min'].default_value = .12
                    node.inputs['From Max'].default_value = .40
                    # Deliberate large value patches survive the 32px reduction.
                    node.inputs['To Min'].default_value = .90 if role == 'head' else .42
                    node.inputs['To Max'].default_value = 1.16 if role == 'head' else 1.52
                elif source.type == 'TEX_NOISE':
                    node.inputs['To Min'].default_value = .90
                    node.inputs['To Max'].default_value = 1.04
        if role == 'head':
            bands = nodes['Authored facial band mix']
            dark_fur = nodes.new('ShaderNodeMixRGB')
            dark_fur.name = 'Textured charcoal face bands'
            dark_fur.blend_type = 'MULTIPLY'
            dark_fur.inputs[0].default_value = 1
            dark_fur.inputs[1].default_value = (.011, .015, .019, 1)
            band_values = nodes.new('ShaderNodeMapRange')
            band_values.inputs['From Min'].default_value = .12
            band_values.inputs['From Max'].default_value = .40
            band_values.inputs['To Min'].default_value = .4
            band_values.inputs['To Max'].default_value = 1.7
            links.new(texture_grey, band_values.inputs['Value'])
            links.new(band_values.outputs['Result'], dark_fur.inputs[2])
            links.new(dark_fur.outputs[0], bands.inputs[2])
        # Restrained broad warm/cool color variation, without adding any light.
        if role == 'body':
            bs = nodes.get('Principled BSDF')
            original = bs.inputs['Base Color'].links[0].from_socket
            noise = nodes.new('ShaderNodeTexNoise')
            noise.inputs['Scale'].default_value = 5
            noise.inputs['Detail'].default_value = 0
            links.new(flow.outputs['Vector'], noise.inputs['Vector'])
            tones = nodes.new('ShaderNodeValToRGB')
            tones.name = 'Broad warm and slate fur groups'
            tones.color_ramp.elements[0].color = (.67, .79, .92, 1)
            tones.color_ramp.elements[1].color = (1.14, 1.05, .88, 1)
            links.new(noise.outputs['Fac'], tones.inputs[0])
            mix = nodes.new('ShaderNodeMixRGB')
            mix.blend_type = 'MULTIPLY'
            mix.inputs[0].default_value = settings.get('furColorVariation', .6)
            links.new(original, mix.inputs[1])
            links.new(tones.outputs[0], mix.inputs[2])
            links.new(mix.outputs[0], bs.inputs['Base Color'])
