"""Fast running badger with a moving mantle and anchored weapon grips."""
import bpy
from rigs_v2 import model, limb_rig, control, attach
from recipes import badger as original


def build(ctx, spec):
    settings = spec['model']
    groups = original.build(ctx, settings)
    asset = model(ctx.scene)
    # Narrow stance under the hips; keep the feet pointing north.
    for side in ('left', 'right'):
        for ob in groups[side + '_leg']:
            ob.location.x *= settings['footSpacing']
            ob.location.y -= settings['footSouthOffset']
    rig = limb_rig(ctx.scene, asset, {
        'left_leg': ((-.20 * settings['footSpacing'], -.30, .4), groups['left_leg']),
        'right_leg': ((.20 * settings['footSpacing'], -.30, .4), groups['right_leg']),
    })
    body = control(ctx.scene, 'Balanced pelvis and torso', parent=asset['root'])
    head = control(ctx.scene, 'Independent head balance', parent=body)
    attach([ob for ob in groups['upper'] if ob not in groups['head'] and ob not in groups['arms']], body)
    attach(groups['head'], head)
    # Blend the mantle's body motion smoothly to zero at the wrists. Two
    # complementary bone weights keep the arm silhouette continuous while the
    # entire grip and thumb geometry remains rooted, including between samples.
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    shoulder = rig.data.edit_bones.new('mantle')
    shoulder.head, shoulder.tail = (0, 0, 0), (0, .25, 0)
    shoulder.parent = rig.data.edit_bones['root']
    bpy.ops.object.mode_set(mode='OBJECT')
    follow = rig.pose.bones['mantle'].constraints.new('COPY_TRANSFORMS')
    follow.target = body
    follow.owner_space = follow.target_space = 'WORLD'
    bpy.context.view_layer.update()
    for ob in groups['arms']:
        if ob in groups['hands']:
            ob['motionRole'] = 'grip'
            continue
        moving = ob.vertex_groups.new(name='mantle')
        fixed = ob.vertex_groups.new(name='root')
        for vertex in ob.data.vertices:
            y = (ob.matrix_world @ vertex.co).y
            t = max(0, min(1, (y - .05) / .50))
            weight = 1 - t*t*(3-2*t)
            moving.add([vertex.index], weight, 'REPLACE')
            fixed.add([vertex.index], 1-weight, 'REPLACE')
        modifier = ob.modifiers.new('Shoulder motion with stable wrists', 'ARMATURE')
        modifier.object = rig
        ob['motionRole'] = 'arms'
    asset['parts'].update(body=body, head=head)
    for ob in groups['head']: ob['motionRole'] = 'head'
    for ob in groups['upper']:
        if 'motionRole' not in ob: ob['motionRole'] = 'body'
    for name in ('left_leg', 'right_leg'):
        for ob in groups[name]: ob['motionRole'] = name
    return asset
