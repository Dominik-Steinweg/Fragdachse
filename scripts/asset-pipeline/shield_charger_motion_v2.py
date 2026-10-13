"""Shield charger: bash, windup (shield swung aside), charge loop and exhausted recover.

The 'shield' control pivots at the grip; 'aside' turns it about the body origin to
the left flank and tips its top outward, so the frontal arc reads visibly open.
"""
import math
from mathutils import Matrix, Vector
from claw_motion_v2 import apply_claw

ASIDE_TURN = math.radians(105)   # about the body origin, counter-clockwise from above
ASIDE_TIP = -.42                 # top edge falls outward (radians about the shield's own X)
ASIDE_DROP = -.20
ARM_TURN = 1.6                   # shield arm about its shoulder, hand onto the flank shield


def smooth(value):
    t = max(0, min(1, value))
    return t*t*(3-2*t)


def lerp(a, b, t):
    return tuple(x+(y-x)*t for x, y in zip(a, b))


def aside(asset, t):
    """Shield control offset (location, rotation) for blend t between carried and aside."""
    grip = Vector(asset['parts']['shield']['grip'])
    turn = ASIDE_TURN*t
    swung = Matrix.Rotation(turn, 3, 'Z') @ grip
    location = (swung.x-grip.x, swung.y-grip.y, ASIDE_DROP*t)
    return location, (ASIDE_TIP*t, 0, turn)


def legs(asset, frame, key, offsets):
    for name in asset['parts']['limbs']:
        location, rotation = offsets.get(name, ((0, 0, 0), (0, 0, 0)))
        bone = asset['rig'].pose.bones[name]
        key(bone, 'location', location, frame)
        key(bone, 'rotation_euler', rotation, frame)


def crouch_pose(asset, t, frame, pose, key):
    """Braced, lowered stance with the shield aside: the windup end and charge base."""
    location, rotation = aside(asset, t)
    pose('shield', location=location, rotation=rotation)
    pose('body', location=(0, -.08*t, -.10*t), rotation=(-.10*t, 0, 0), scale=(1+.05*t, 1-.03*t, 1-.07*t))
    pose('head', location=(0, .05*t, -.09*t), rotation=(-.12*t, 0, 0))
    pose('tail', rotation=(.22*t, 0, 0))
    # The shield arm swings out to the flank with the shield; the free paw tucks to the chest.
    pose('left_arm', location=(0, 0, -.12*t), rotation=(0, 0, ARM_TURN*t))
    pose('right_arm', location=(.06*t, -.30*t, -.10*t), rotation=(0, 0, -.35*t))
    legs(asset, frame, key, {'left': ((-.04*t, .12*t, 0), (.10*t, 0, 0)),
                             'right': ((.04*t, -.20*t, 0), (-.16*t, 0, 0))})


def apply_shield(asset, motion, phase, frame, idle, parameters, pose, key):
    if motion == 'shield_bash':
        pull, reach = apply_claw(asset, phase, frame, idle, parameters, pose, key)
        # Shield and both gripping arms shove together, so the paws stay behind the shield.
        translation = (0, -.12*pull+.30*reach, .05*pull+.05*reach)
        pose('shield', location=translation, rotation=(.06*pull-.10*reach, 0, 0))
        for name in ('left_arm', 'right_arm'):
            pose(name, location=tuple(.9*v for v in translation))
        # Paws push from behind the grip instead of punching past the shield's top edge.
        for name in asset['parts'].get('claw_bones', []):
            key(asset['rig'].pose.bones[name], 'location', tuple(.45*v for v in translation), frame)
        return
    if idle:
        crouch_pose(asset, 0, frame, pose, key)
        return
    if motion == 'shield_windup':
        ready = parameters['markerPhases']['ready']
        t = smooth(phase/(ready*.72))
        crouch_pose(asset, t, frame, pose, key)
        # A brief settle before the held ready pose keeps the end frame stable.
        settle = math.sin(math.pi*min(1, max(0, (phase-ready*.72)/(ready*.28))))
        pose('head', location=(0, .05+.012*settle, -.09-.012*settle), rotation=(-.12-.03*settle, 0, 0))
    elif motion == 'shield_charge':
        angle = math.tau*phase
        bob = .5-.5*math.cos(2*angle)
        sway = math.sin(angle)
        location, rotation = aside(asset, 1)
        pose('shield', location=(location[0], location[1]+.03*sway, location[2]+.025*bob), rotation=rotation)
        pose('body', location=(.02*sway, .14, -.07+.05*bob), rotation=(-.17+.03*bob, 0, .04*sway), scale=(.97, 1.10, .95))
        pose('head', location=(0, .13, -.11+.02*bob), rotation=(-.15, 0, -.03*sway))
        pose('tail', rotation=(-.18, 0, .14*sway))
        pose('left_arm', location=(0, 0, -.12), rotation=(0, 0, ARM_TURN))
        pose('right_arm', location=(.06, -.30+.08*sway, -.10), rotation=(.20*sway, 0, -.35+.08*sway))
        stride, lift = parameters.get('stride', .30), parameters.get('lift', .11)
        legs(asset, frame, key, {name: ((0, stride*math.sin(angle+i*math.pi), lift*max(0, math.cos(angle+i*math.pi))),
                                        (.14*math.sin(angle+i*math.pi), 0, 0))
                                 for i, name in enumerate(asset['parts']['limbs'])})
    elif motion == 'shield_recover':
        raise_phase = parameters['markerPhases']['raise']
        lift = smooth((phase-raise_phase)/(1-raise_phase))
        tired = 1-lift
        breath = .5-.5*math.cos(math.tau*2.5*min(phase, raise_phase)/raise_phase)
        location, rotation = aside(asset, tired)
        pose('shield', location=(location[0], location[1], location[2]-.06*tired), rotation=(rotation[0]-.10*tired, 0, rotation[2]))
        pose('body', location=(0, -.05*tired, -.13*tired), rotation=(-.05*tired, 0, 0),
             scale=(1+(.04+.035*breath)*tired, 1, 1+(-.08+.04*breath)*tired))
        pose('head', location=(0, .02*tired, -.15*tired), rotation=(-.26*tired, 0, .05*tired))
        pose('tail', rotation=(-.10*tired, 0, 0))
        pose('left_arm', location=(0, 0, -.16*tired), rotation=(0, 0, ARM_TURN*tired))
        pose('right_arm', location=(.06*tired, -.30*tired, -.16*tired), rotation=(.18*tired, 0, -.35*tired))
        legs(asset, frame, key, {'left': ((-.05*tired, .06*tired, 0), (0, 0, -.06*tired)),
                                 'right': ((.05*tired, -.06*tired, 0), (0, 0, .06*tired))})
    else:
        raise ValueError(f'Unknown shield charger motion: {motion}')
