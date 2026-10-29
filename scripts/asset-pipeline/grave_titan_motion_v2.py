"""Grave Titan motions: heavy breathing, the rearing paw slam, the all-round stomp, the grave-light
gather (cast) and the emergence from the earth for the intro.

Controls come from recipes_v2/grave-titan.py. `body`, `head` and `tail` are object controls at the
asset origin; head and tail turn about the recipe's `neck_pivot` / `tail_pivot` through a
compensating translation. `lid` carries the crypt lid with its cross fissure, `stones_l` /
`stones_r` the headstone rows (pivot at their inner base line; a positive splay lifts their outer
edge). `grave_flare` scales the grave light colour (0 rest .. 1 full gather), `ground_cut` lists
the per-material cut heights (rest far below the paws). Euler X lifts the front of a
forward-pointing part, so a positive body pitch rears the front up and a positive head pitch
raises the snout. Every call keys every control and limb bone, so no clip inherits a pose, and the
one-shots reach the exact rest pose on their last frame. No clip travels in XY; the runtime owns
travel. The top-down camera hides height, so rearing also shortens the body, splays the stones and
lifts the paws outward; the slam and stomp land with a short squash.
"""
import math
from mathutils import Euler, Vector

SUPPORTED_MOTIONS = ('titan_idle', 'titan_slam', 'titan_stomp', 'titan_cast', 'titan_emerge')
ZERO = (0, 0, 0)
CUT_REST = -10.0


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def envelope(phase, *points):
    """Smooth beats with exact plateaus and exact endpoints."""
    if phase <= points[0][0]:
        return points[0][1]
    for (a, value), (b, target) in zip(points, points[1:]):
        if phase <= b:
            return value + (target - value) * smooth(a, b, phase)
    return points[-1][1]


def pivoted(pivot, rotation, location=ZERO):
    """Translation that turns an origin control about `pivot`, plus an extra offset."""
    p = Vector(pivot)
    return tuple(p - Euler(rotation, 'XYZ').to_matrix() @ p + Vector(location))


def key_value(socket, value, frame):
    socket.default_value = value
    socket.keyframe_insert(data_path='default_value', frame=frame)


def key_pose(asset, frame, pose, key, body=(ZERO, ZERO, (1, 1, 1)), head=(ZERO, ZERO), tail=(ZERO, ZERO),
             lid=(0, 0, 0), stones=(0, 0), flare=0, cut=CUT_REST, limbs=None):
    """head/tail = (rotation about the pivot, offset); lid = (lift, slide, tilt); stones = (splay, lift);
    limbs(name, side, front) -> (location, rotation)."""
    parts = asset['parts']
    pose('body', location=body[0], rotation=body[1], scale=body[2])
    pose('head', location=pivoted(parts['neck_pivot'], head[0], head[1]), rotation=head[0])
    pose('tail', location=pivoted(parts['tail_pivot'], tail[0], tail[1]), rotation=tail[0])
    lift, slide, tilt = lid
    pose('lid', location=(0, slide, lift), rotation=(tilt, 0, 0))
    splay, rise = stones
    for name, side in (('stones_l', -1), ('stones_r', 1)):
        pose(name, location=(0, 0, rise), rotation=(0, -side * splay, 0))
    key_value(parts['grave_flare'], flare, frame)
    for socket in parts['ground_cut']:
        key_value(socket, cut, frame)
    for name in parts['limbs']:
        bone = asset['rig'].pose.bones[name]
        location, rotation = limbs(name, -1 if 'left' in name else 1, name.startswith('front_')) if limbs else (ZERO, ZERO)
        key(bone, 'location', location, frame)
        key(bone, 'rotation_euler', rotation, frame)


def idle(asset, phase, frame, p, pose, key):
    """Slow heavy breathing that lifts the lid and the headstones; the grave light breathes along."""
    angle = math.tau * phase
    breath = (.5 - .5 * math.cos(angle)) * p.get('breath', 1)
    sway = math.sin(angle) * p.get('sway', 1)
    key_pose(asset, frame, pose, key,
             body=((0, -.010 * breath, .012 * breath), (.012 * breath, 0, .010 * sway), (1 + .022 * breath, 1 + .008 * breath, 1 + .030 * breath)),
             head=((.030 * breath, 0, .055 * sway), (0, -.010 * breath, .006 * breath)),
             tail=((0, 0, .10 * sway), ZERO),
             lid=(.012 * breath, 0, 0), stones=(.045 * breath, .006 * breath), flare=.12 * breath)


def slam(asset, phase, frame, p, pose, key):
    """Rear up slowly (front paws high and wide, stones bristling, light rising), then crash both
    front paws forward at `impact` with a squash; recover heavily to rest."""
    strike, impact = p['markerPhases']['strike'], p['markerPhases']['impact']
    rear = envelope(phase, (0, 0), (strike * .78, 1), (strike, 1), (impact, 0)) * p.get('rear', 1)
    lunge = envelope(phase, (0, 0), (strike, 0), (impact, 1), (impact + .10, 1), (1, 0)) * p.get('lunge', 1)
    squash = envelope(phase, (0, 0), (impact - .02, 0), (impact, 1), (impact + .14, .25), (1, 0))

    def limbs(name, side, front):
        if front:
            return ((side * (.12 * rear - .05 * lunge), .02 * rear + .20 * lunge, .34 * rear),
                    (-.62 * rear + .18 * lunge, 0, side * .10 * rear))
        return (side * .03 * squash, -.07 * rear + .05 * lunge, 0), (.16 * rear, 0, 0)
    key_pose(asset, frame, pose, key,
             body=((0, -.085 * rear + .02 * lunge, .10 * rear - .035 * squash), (.22 * rear - .05 * lunge, 0, 0),
                   (1 + .045 * squash, 1, 1 - .07 * squash)),
             head=((.26 * rear - .09 * lunge, 0, 0), (0, -.06 * rear - .02 * lunge, .04 * rear - .03 * lunge)),
             tail=((-.16 * rear + .10 * lunge, 0, 0), ZERO),
             lid=(.03 * rear + .025 * squash, 0, .05 * rear), stones=(.24 * rear + .10 * squash, .02 * rear + .02 * squash),
             flare=.35 * rear + .25 * squash, limbs=limbs)


def stomp(asset, phase, frame, p, pose, key):
    """Lift the forequarters with both front paws high, then stamp them down at `impact`: the whole
    body quakes, the stones jump and the lid jolts."""
    strike, impact = p['markerPhases']['strike'], p['markerPhases']['impact']
    lift = envelope(phase, (0, 0), (strike * .80, 1), (strike, 1), (impact, 0)) * p.get('lift', 1)
    quake = envelope(phase, (0, 0), (impact - .02, 0), (impact, 1), (impact + .12, .30), (1, 0)) * p.get('quake', 1)
    shiver = math.sin(phase * math.pi * 9) * quake

    def limbs(name, side, front):
        if front:
            return (side * .13 * lift, .05 * lift, .36 * lift), (-.52 * lift, 0, side * .12 * lift)
        return (side * .05 * quake, -.03 * lift, 0), (.12 * lift, 0, 0)
    key_pose(asset, frame, pose, key,
             body=((.012 * shiver, -.04 * lift, .12 * lift - .05 * quake), (.15 * lift, .02 * shiver, 0),
                   (1 + .055 * quake, 1 + .055 * quake, 1 - .09 * quake)),
             head=((.18 * lift - .07 * quake, 0, .03 * shiver), (0, 0, .03 * lift)),
             tail=((-.10 * lift, 0, .06 * shiver), ZERO),
             lid=(.02 * lift + .035 * quake, 0, .02 * shiver), stones=(.18 * lift + .14 * quake, .035 * quake),
             flare=.25 * lift + .45 * quake, limbs=limbs)


def cast(asset, phase, frame, p, pose, key):
    """Gather the grave lights: snout up, lid lifting, headstones splayed open and the fissures
    flaring towards `release`; then everything settles back to rest."""
    release = p['markerPhases']['release']
    rise = envelope(phase, (0, 0), (release, 1), (release + .09, 1), (1, 0)) * p.get('rise', 1)
    pulse = envelope(phase, (0, 0), (release - .06, .35), (release, 1), (release + .12, .55), (1, 0))

    def limbs(name, side, front):
        return ((side * .03 * rise, -.02 * rise, 0), ZERO) if front else ((0, .02 * rise, 0), ZERO)
    key_pose(asset, frame, pose, key,
             body=((0, -.03 * rise, .05 * rise), (.06 * rise, 0, 0), (1 + .02 * rise, 1 + .03 * rise, 1 + .03 * rise)),
             head=((.30 * rise, 0, 0), (0, -.03 * rise, .05 * rise)),
             tail=((-.18 * rise, 0, 0), ZERO),
             lid=(.06 * rise, -.03 * rise, .06 * rise), stones=(.38 * rise * p.get('splay', 1), .04 * rise),
             flare=min(1.5, rise + .5 * pulse), limbs=limbs)


def emerge(asset, phase, frame, p, pose, key):
    """Rise out of the earth: the cut height sinks from just below the lid top to below the paws
    while the body heaves up from a sunken crouch, the front paws claw out and a roar ends it."""
    up = smooth(0, 1, phase)
    down = 1 - up
    roar = envelope(phase, (0, 0), (.62, 0), (.82, 1), (1, 0))
    heave = math.sin(phase * math.pi * 4) * down * p.get('heave', 1)
    cut = CUT_REST if phase >= 1 else p.get('cutFrom', 1.05) + (p.get('cutTo', -.15) - p.get('cutFrom', 1.05)) * smooth(0, .88, phase)

    def limbs(name, side, front):
        if front:
            claw = math.sin(phase * math.pi * 3) * down
            return (side * .10 * down, .12 * down + .04 * claw, .10 * down + .06 * abs(claw)), (-.30 * down, 0, side * .08 * down)
        return (side * .04 * down, -.04 * down, 0), (.10 * down, 0, 0)
    key_pose(asset, frame, pose, key,
             body=((.015 * heave, 0, -.18 * down + .02 * heave), (-.08 * down + .05 * roar, .035 * heave, 0), (1, 1, 1)),
             head=((-.16 * down + .22 * roar, 0, .05 * heave), (0, .04 * roar, .03 * roar)),
             tail=((.10 * down, 0, .08 * heave), ZERO),
             lid=(.02 * abs(heave), 0, .03 * heave), stones=(.20 * down + .10 * roar, .02 * abs(heave)),
             flare=.45 * down + .55 * roar, cut=cut, limbs=limbs)


def apply_grave_titan(asset, motion, phase, frame, idle_pose, parameters, pose, key):
    if motion not in SUPPORTED_MOTIONS:
        raise ValueError(f'Unknown grave titan motion: {motion}')
    if idle_pose:
        key_pose(asset, frame, pose, key)
    elif motion == 'titan_idle':
        idle(asset, phase, frame, parameters, pose, key)
    elif motion == 'titan_slam':
        slam(asset, phase, frame, parameters, pose, key)
    elif motion == 'titan_stomp':
        stomp(asset, phase, frame, parameters, pose, key)
    elif motion == 'titan_cast':
        cast(asset, phase, frame, parameters, pose, key)
    else:
        emerge(asset, phase, frame, parameters, pose, key)
