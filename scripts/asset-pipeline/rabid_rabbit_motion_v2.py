"""Rabid Rabbit (rabid-rabbit) motions: idle, half-bound gallop (move), bite lunge (claw), pounce windup, leap.

Legs, back and head swing in the sagittal plane. Every pitch here is an absolute world rotation
about +X relative to the rest pose (positive swings a leg's tip forwards and lifts the nose); each
bone receives the difference to its parent, expressed in its own rest frame, so a chain keeps
the authored world angles whatever the parent does. Forelegs can additionally spread outwards
(a yaw on the upper bone), so reaching paws clear the head seen from above. Every bone rolls its
Z axis up, so ear and head yaws are Euler Z seen from the camera and ear lifts are Euler X.

From straight above the ears are the clearest cue: each ear has a root and a tip bone, the tip
lags the root as follow-through (it streams back, flops and whips forwards), `sweep` turns an ear
back towards the spine (negative: forwards) and `lift` raises it. The void glow in the ear tips is
keyed with every pose: strength (a factor of its rest value), reach (how far it creeps back from
the tips) and flow (the phase of its flicker); it smoulders at rest and floods the ears in motion.

Real height lives on `carriage` (leap Z); no clip travels in XY or bakes a display scale, the
runtime owns travel and lift. Every call keys every control, so no clip inherits a pose, and
one-shots reach the exact rest pose (and glow) on their last frame.
"""
import math
from mathutils import Quaternion, Vector

SUPPORTED_MOTIONS = ('rabbit_idle', 'rabbit_bound', 'rabbit_bite', 'rabbit_windup', 'rabbit_leap')
SIDES = (('left', 'l', -1), ('right', 'r', 1))
FRONT = ('upper', 'lower', 'foot')
REAR = ('thigh', 'shin', 'foot')
LATERAL = Vector((1, 0, 0))
UP = Vector((0, 0, 1))
ZERO = (0, 0, 0)
# Absolute leg pitches (upper/thigh, lower/shin, foot) per named pose, radians about +X.
FRONT_POSES = {
    'reach': (1.20, .90, .40),     # stretched ahead in flight, paws catching the ground
    'push': (-.70, -.60, -1.10),   # swept back after the forefoot push-off, paw trailing
    'brace': (.35, .45, .15),      # planted ahead to take a landing
    'strike': (1.45, 1.15, .60),   # bite lunge: both paws thrown out past the head
}
REAR_POSES = {
    'tuck': (.55, .35, .15),       # gathered under the belly, hind paws landing beside the chest
    'extend': (-1.20, -.50, -2.45),  # push-off: the long feet kick back, toes trailing behind the rump
    'coil': (.30, .25, .05),       # deeper crouch before a spring
}


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


def wrapped(phase, centre, width):
    """Periodic Gaussian bump: exact loop closure."""
    d = abs(phase - centre) % 1
    d = min(d, 1 - d)
    return math.exp(-(d / width) ** 2)


def wave(phase, start, cycles, end=1):
    """Damped settle after `start`: exactly zero before it and at `end` (one-shots end at rest)."""
    if phase <= start or phase >= end:
        return 0
    u = (phase - start) / (end - start)
    return math.sin(math.tau * cycles * u) * math.exp(-3.2 * u) * (1 - smooth(.8, 1, u))


def blend(poses, mix):
    """mix: {pose: weight}; the remainder is the rest pose (all zero)."""
    out = [0, 0, 0]
    for name, weight in mix.items():
        for k, value in enumerate(poses[name]):
            out[k] += weight * value
    return out


def turn(rig, name, pitch=0, yaw=0):
    """Rotation about world +X (pitch) then world Z (yaw), expressed in the bone's rest frame."""
    rest = rig.data.bones[name].matrix_local.to_3x3().inverted()
    q = Quaternion((rest @ UP).normalized(), yaw) @ Quaternion((rest @ LATERAL).normalized(), pitch)
    return tuple(q.to_euler('XYZ'))


def key_pose(asset, frame, pose, key, body=0, hips=0, head=0, front=None, rear=None, spread=0, bones=None,
             carriage=(ZERO, ZERO), yaws=None, glow=1.0, reach=None, flow=0):
    """body/hips/head: absolute pitches (hips points backwards: positive tucks the rump under);
    front/rear: {side: (a, b, c)} absolute leg pitches; spread: outward forelimb yaw (both sides);
    yaws: {bone: world yaw}; bones: {name: (rotation, location, scale)} for ears, jaw, tail and stretch;
    glow: strength factor, reach: glow reach along the ear (None: rest), flow: flicker phase."""
    rig, parts = asset['rig'], asset['parts']
    bones, yaws = bones or {}, dict(yaws or {})
    front, rear = front or {}, rear or {}
    pitch = {'body': body, 'hips': hips - body, 'head': head - body}
    for side, _, s in SIDES:
        legs = front.get(side, (0, 0, 0))
        parent = body
        for segment, value in zip(FRONT, legs):
            pitch[f'front_{side}_{segment}'] = value - parent
            parent = value
        yaws[f'front_{side}_upper'] = yaws.get(f'front_{side}_upper', 0) - s * spread
        legs = rear.get(side, (0, 0, 0))
        parent = hips
        for segment, value in zip(REAR, legs):
            pitch[f'rear_{side}_{segment}'] = value - parent
            parent = value
    for bone in rig.pose.bones:
        rotation, location, scale = bones.get(bone.name, (ZERO, ZERO, (1, 1, 1)))
        if bone.name in pitch or bone.name in yaws:
            rotation = turn(rig, bone.name, pitch.get(bone.name, 0), yaws.get(bone.name, 0))
        key(bone, 'rotation_euler', rotation, frame)
        key(bone, 'location', location, frame)
        key(bone, 'scale', scale, frame)
    pose('carriage', location=carriage[0], rotation=carriage[1])
    for socket, value in ((parts['ear_glow'], parts['ear_glow_rest'] * glow),
                          (parts['ear_glow_reach'], parts['ear_glow_reach_rest'] if reach is None else min(1, reach)),
                          (parts['ear_glow_flow'], flow)):
        socket.default_value = value
        socket.keyframe_insert(data_path='default_value', frame=frame)


def ears(root=(0, 0), tip=(0, 0), each=None):
    """Two-segment ears. root/tip = (lift, sweep) for both ears; the tip is relative to the root.
    each = {'l'|'r': ((lift, sweep) root, (lift, sweep) tip)} adds per-ear motion."""
    out = {}
    for _, key, side in SIDES:
        (rl, rs), (tl, ts) = (each or {}).get(key, ((0, 0), (0, 0)))
        out[f'ear_{key}'] = ((root[0] + rl, 0, -side * (root[1] + rs)), ZERO, (1, 1, 1))
        out[f'ear_{key}_tip'] = ((tip[0] + tl, 0, -side * (tip[1] + ts)), ZERO, (1, 1, 1))
    return out


def idle(asset, phase, frame, pose, key):
    """Tense breathing crouch: nose twitches and a slow look aside; each ear swivels forwards to
    listen in turn, its tip trailing and overshooting; the void in the tips smoulders and breathes."""
    cycle = math.tau * phase
    breath = .5 - .5 * math.cos(cycle)
    twitch = math.sin(math.tau * 4 * phase) * (wrapped(phase, .20, .07) + wrapped(phase, .62, .07))
    listen_l, lag_l = wrapped(phase, .30, .07), wrapped(phase, .35, .07) - .4 * wrapped(phase, .44, .05)
    listen_r, lag_r = wrapped(phase, .76, .07), wrapped(phase, .81, .07) - .4 * wrapped(phase, .90, .05)
    bones = {
        **ears(root=(.03 * breath, 0), tip=(.04 * math.sin(cycle - .8), 0),
               each={'l': ((.10 * listen_l, -.32 * listen_l), (.12 * lag_l, -.22 * lag_l)),
                     'r': ((.10 * listen_r, -.32 * listen_r), (.12 * lag_r, -.22 * lag_r))}),
        'body': (ZERO, ZERO, (1 + .025 * breath, 1, 1 + .035 * breath)),
        'jaw': ((-.06 * max(0, twitch), 0, 0), ZERO, (1, 1, 1)),
        'tail': ((.30 * wrapped(phase, .55, .04), 0, 0), ZERO, (1, 1, 1)),
    }
    key_pose(asset, frame, pose, key, head=.03 * twitch + .04 * math.sin(cycle), bones=bones,
             yaws={'head': .14 * math.sin(cycle + .4)},
             carriage=((0, 0, .008 * breath), ZERO),
             glow=1 + .22 * math.sin(cycle), reach=.32 + .08 * breath, flow=.6 * math.sin(cycle))


def bound(asset, phase, frame, pose, key):
    """Half-bound gallop in place: hind paws land together beside the chest past the forefeet,
    push the body long, a flight with forepaws reaching out past the head and hind feet trailing,
    then the forefeet land one after the other and the back gathers again. Head and ears ride the
    bounce with a lag; the void floods the ears and pulses with every push-off."""
    cycle = math.tau * phase
    # Gait clock (phase 0 = hind paws land, back gathered): push off (to .35), flight (.35-.55),
    # left then right forefoot land (.55/.61), gather while the hind legs swing forwards (.65-1).
    gather = wrapped(phase, .98, .17)
    extend = wrapped(phase, .42, .15)
    flight = math.sin(math.pi * smooth(.28, .60, phase)) if .28 < phase < .60 else 0

    def front_mix(offset):
        u = (phase - offset) % 1
        return blend(FRONT_POSES, {'reach': wrapped(u, .47, .13), 'push': wrapped(u, .82, .14), 'brace': .5 * wrapped(u, .60, .06)})

    def spread_of(offset):
        return .32 * wrapped((phase - offset) % 1, .47, .14)
    rear = blend(REAR_POSES, {'tuck': wrapped(phase, .97, .18), 'extend': wrapped(phase, .40, .16)})
    # Ears lag the body's bounce: the root a little, the tip more, streaming back after the push.
    root = (.14 * math.sin(math.tau * (phase - .40)), .22 * extend - .08 * gather)
    tip = (.22 * math.sin(math.tau * (phase - .52)), .20 * wrapped(phase, .54, .15) - .14 * wrapped(phase, .10, .12))
    flap = .07 * math.sin(cycle + 1.2)
    bones = {
        **ears(root=root, tip=tip, each={'l': ((0, 0), (0, flap)), 'r': ((0, 0), (0, -flap))}),
        'hips': (ZERO, (0, .17 * extend - .10 * gather, 0), (1, 1 + .06 * extend, 1)),
        'head': (ZERO, (0, .08 * extend - .03 * gather, 0), (1, 1, 1)),
        'tail': ((.25 * extend, 0, 0), ZERO, (1, 1, 1)),
        'jaw': ((-.10 * extend, 0, 0), ZERO, (1, 1, 1)),
    }
    key_pose(asset, frame, pose, key, body=.10 * extend - .08 * gather, hips=.30 * gather - .15 * extend,
             head=.14 * math.sin(math.tau * (phase - .15)) - .04 * extend, front={'left': front_mix(0), 'right': front_mix(.06)},
             rear={'left': rear, 'right': rear}, bones=bones,
             yaws={'front_left_upper': spread_of(0), 'front_right_upper': -spread_of(.06), 'head': .05 * math.sin(cycle)},
             carriage=((0, .08 * extend - .06 * gather, .16 * flight - .03 * gather), (.06 * math.sin(cycle), 0, 0)),
             glow=1.30 + .35 * extend, reach=.70 + .16 * extend + .05 * math.sin(2 * cycle), flow=.9 * math.sin(cycle))


def bite(asset, phase, frame, p, pose, key):
    """Coil with ears pinned (to `strike`), lunge with jaws wide and both forepaws thrown out past
    the head, snap shut on `impact` with a shake of the head; the ear tips whip back on the lunge
    and flop forwards after the bite. The void flares through the ears with the strike."""
    markers = p.get('markerPhases', {})
    strike, impact = markers.get('strike', 5 / 11), markers.get('impact', 7 / 11)
    follow = impact + (1 - impact) / 4  # one frame past `impact`, like the shared claw contract
    coil = envelope(phase, (0, 0), (strike * .85, 1), (strike, 1), (strike + (impact - strike) * .5, 0), (1, 0))
    lunge = envelope(phase, (0, 0), (strike, 0), (impact, 1), (follow, 1), (1, 0))
    gape = envelope(phase, (0, 0), (strike * .7, 0), (strike, 1), (impact - (impact - strike) * .25, 1), (impact, 0), (1, 0))
    pinned = envelope(phase, (0, 0), (strike * .6, 1), (follow, 1), (1, 0))
    whip = envelope(phase, (0, 0), (strike, 0), (impact, 1), (follow, .3), (1, 0))
    flop = envelope(phase, (0, 0), (follow, 0), (follow + (1 - follow) * .35, 1), (1, 0))
    shake = wave(phase, impact, 1.5)
    paws = blend(FRONT_POSES, {'strike': lunge, 'brace': .4 * coil})
    rear = blend(REAR_POSES, {'coil': coil, 'extend': .55 * lunge})
    bones = {
        **ears(root=(-.04 * coil - .02 * lunge, .40 * pinned), tip=(-.10 * pinned + .16 * flop, .28 * whip - .34 * flop)),
        'jaw': ((-.55 * gape, 0, 0), ZERO, (1, 1, 1)),
        'head': (ZERO, (0, .22 * lunge, 0), (1, 1, 1)),
        'hips': (ZERO, (0, .14 * lunge, 0), (1, 1 + .05 * lunge, 1)),
    }
    key_pose(asset, frame, pose, key, body=-.06 * coil + .08 * lunge, hips=.08 * coil - .05 * lunge,
             head=-.10 * coil + .14 * gape - .06 * lunge, front={'left': paws, 'right': paws},
             rear={'left': rear, 'right': rear}, spread=.42 * lunge + .08 * coil, bones=bones, yaws={'head': .20 * shake},
             carriage=((0, -.10 * coil + .45 * lunge, -.06 * coil + .05 * lunge), (-.04 * coil + .05 * lunge, 0, .05 * shake)),
             glow=1 + .40 * coil + .75 * lunge, reach=.30 + .45 * coil + .30 * lunge, flow=1.2 * math.sin(math.pi * phase))


def windup(asset, phase, frame, pose, key):
    """Pounce lock (loop): pressed flat with the ears pinned back along the spine and trembling,
    rump raised and wiggling, hind feet treading, forepaws braced wide, head locked on the target.
    The void charges and fills the ears almost to the root, pulsing."""
    cycle = math.tau * phase
    wiggle = math.sin(cycle * 2)
    tread = math.sin(cycle * 2)
    tremble = math.sin(cycle * 6)
    rear_l = blend(REAR_POSES, {'coil': .9 + .30 * max(0, tread)})
    rear_r = blend(REAR_POSES, {'coil': .9 + .30 * max(0, -tread)})
    paws = blend(FRONT_POSES, {'brace': .65})
    bones = {
        **ears(root=(-.06, .45 + .03 * math.sin(cycle * 4)), tip=(-.06 + .03 * tremble, .12 + .05 * tremble)),
        'hips': (ZERO, (0, -.05, 0), (1, 1, 1)),
        'tail': ((.20 + .10 * math.sin(cycle * 4), 0, .25 * wiggle), ZERO, (1, 1, 1)),
    }
    key_pose(asset, frame, pose, key, body=-.10, hips=-.16 - .03 * math.sin(cycle * 4), head=-.06 + .015 * tremble,
             front={'left': paws, 'right': paws}, rear={'left': rear_l, 'right': rear_r}, spread=.22, bones=bones,
             yaws={'hips': .24 * wiggle, 'head': -.04 * wiggle + .02 * tremble},
             carriage=((0, -.06, -.07), (-.05, .05 * wiggle, 0)),
             glow=1.45 + .30 * math.sin(cycle * 2), reach=.88 + .07 * math.sin(cycle * 2), flow=1.0 * math.sin(cycle))


def leap(asset, phase, frame, p, pose, key):
    """Crouch with ears pinned (to `launch`), spring with the body stretched, forepaws spread and
    reaching past the head, hind feet trailing and the ears streaming back; hit the ground on
    `land` with braced forepaws as the ears whip forwards and settle. The void charges in the
    crouch, blazes through the whole ear in flight and fades back to the tips."""
    markers = p.get('markerPhases', {})
    launch, land = markers.get('launch', 5 / 19), markers.get('land', 13 / 19)
    crouch = envelope(phase, (0, 0), (launch * .80, 1), (launch, 1), (launch + .05, 0), (1, 0))
    t = max(0, min(1, (phase - launch) / (land - launch)))
    height = math.sin(math.pi * t) if launch < phase < land else 0
    stretch = envelope(phase, (0, 0), (launch - .02, 0), (launch + .06, 1), (land - .08, .85), (land, .2), (1, 0))
    reach = envelope(phase, (0, 0), (launch, 0), (launch + .10, 1), (land, .6), (land + .05, 0), (1, 0))
    trail = envelope(phase, (0, 0), (launch - .03, 0), (launch + .04, 1), (land - .12, .8), (land, 0), (1, 0))
    brace = envelope(phase, (0, 0), (land - .04, 0), (land, 1), (land + (1 - land) * .45, .6), (1, 0))
    tuck = envelope(phase, (0, 0), (land - .10, 0), (land, 1), (land + (1 - land) * .5, .4), (1, 0))
    pinned = envelope(phase, (0, 0), (launch * .6, 1), (land, .8), (1, 0))
    stream = envelope(phase, (0, 0), (launch, 0), (launch + .08, 1), (land - .04, 1), (land, 0), (1, 0))
    settle = wave(phase, land - .02, 1.6)
    paws = blend(FRONT_POSES, {'reach': reach, 'brace': brace})
    rear = blend(REAR_POSES, {'coil': crouch, 'extend': trail, 'tuck': tuck})
    flutter = .06 * math.sin(math.tau * 3 * t) * stream
    bones = {
        **ears(root=(.10 * stretch - .05 * crouch - .04 * brace, .40 * pinned + .12 * stream),
               tip=(.16 * stream - .08 * crouch + .10 * settle, .20 * stream - .34 * settle),
               each={'l': ((0, 0), (0, flutter)), 'r': ((0, 0), (0, -flutter))}),
        'hips': (ZERO, (0, .17 * stretch - .05 * crouch, 0), (1, 1 + .07 * stretch, 1)),
        'head': (ZERO, (0, .06 * stretch, 0), (1, 1, 1)),
        'jaw': ((-.30 * reach * (1 - brace), 0, 0), ZERO, (1, 1, 1)),
        'tail': ((.30 * stretch, 0, 0), ZERO, (1, 1, 1)),
    }
    pitch = .14 * math.sin(math.tau * t) if launch < phase < land else 0
    key_pose(asset, frame, pose, key, body=-.10 * crouch + .10 * stretch - .08 * brace, hips=.10 * crouch - .20 * stretch + .08 * brace,
             head=.16 * reach - .10 * brace - .06 * crouch + .05 * settle, front={'left': paws, 'right': paws},
             rear={'left': rear, 'right': rear}, spread=.40 * reach + .25 * brace, bones=bones,
             carriage=((0, -.06 * crouch + .10 * stretch, -.08 * crouch + .70 * height - .05 * brace), (-.05 * crouch + pitch, 0, 0)),
             glow=1 + .45 * crouch + .75 * stretch + .25 * brace, reach=.30 + .55 * max(crouch, stretch) + .25 * brace,
             flow=1.5 * math.sin(math.pi * phase))


def apply_rabid_rabbit(asset, motion, phase, frame, idle_pose, p, pose, key):
    if motion not in SUPPORTED_MOTIONS:
        raise ValueError(f'Unknown rabid rabbit motion: {motion}')
    if idle_pose:
        return key_pose(asset, frame, pose, key)
    if motion == 'rabbit_idle':
        return idle(asset, phase, frame, pose, key)
    if motion == 'rabbit_bound':
        return bound(asset, phase, frame, pose, key)
    if motion == 'rabbit_bite':
        return bite(asset, phase, frame, p, pose, key)
    if motion == 'rabbit_windup':
        return windup(asset, phase, frame, pose, key)
    return leap(asset, phase, frame, p, pose, key)
