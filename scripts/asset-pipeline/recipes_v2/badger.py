"""Preserve the reviewed sculpt; add balanced torso, head and shoulder motion."""
from rigs_v2 import model, limb_rig, control, attach
from recipes import badger as original


def build(ctx, spec):
    groups = original.build(ctx)
    asset = model(ctx.scene)
    # The sculpt stays unchanged. The neutral foot placement shifts slightly
    # forward, while the authored cycle has a shorter rearward reach.
    for side in ('left', 'right'):
        for ob in groups[side + '_leg']:
            ob.location.x *= 2.9
            ob.location.y -= spec['model'].get('footSouthOffset', .20)
    limb_rig(ctx.scene, asset, {
        'left_leg': ((-.55, -.30, .4), groups['left_leg']),
        'right_leg': ((.55, -.30, .4), groups['right_leg']),
    })
    body = control(ctx.scene, 'Balanced pelvis and torso', parent=asset['root'])
    head = control(ctx.scene, 'Independent head balance', parent=body)
    arms = control(ctx.scene, 'Shoulders and weapon-ready arms', parent=body)
    attach([ob for ob in groups['upper'] if ob not in groups['head'] and ob not in groups['arms']], body)
    attach(groups['head'], head)
    attach(groups['arms'], arms)
    asset['parts'].update(body=body, head=head, arms=arms)
    for ob in groups['head']: ob['motionRole'] = 'head'
    for ob in groups['arms']: ob['motionRole'] = 'arms'
    for ob in groups['upper']:
        if 'motionRole' not in ob: ob['motionRole'] = 'body'
    for name in ('left_leg', 'right_leg'):
        for ob in groups[name]: ob['motionRole'] = name
    return asset
