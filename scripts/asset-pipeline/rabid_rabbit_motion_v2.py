"""Rabid Rabbit (rabid-rabbit) motions: idle, half-bound gallop (move), bite lunge (claw), pounce windup, leap.

Legs, back and head swing in the sagittal plane. Every pitch here is an absolute world rotation
about +X relative to the rest pose (positive swings a leg's tip forwards and lifts the nose); each
bone receives the difference to its parent, expressed in its own rest frame, so a chain keeps
the authored world angles whatever the parent does. Every bone rolls its Z axis up, so ear and
head yaws are Euler Z seen from the camera and ear lifts are Euler X. Real height lives on
`carriage` (leap Z); no clip travels in XY or bakes a display scale, the runtime owns travel and
lift. Every call keys every control, so no clip inherits a pose, and one-shots reach the exact rest
pose on their last frame. The optional void ear glow is keyed as a factor of its rest strength.
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
    'reach': (.75, 1.05, .55),    # stretched ahead in flight, paws catching the ground
    'push': (-.55, -.45, -1.05),  # swept back after the forefoot push-off, paw trailing
    'brace': (.30, .45, .15),     # planted ahead to take a landing
    'strike': (.95, 1.25, .70),   # bite lunge: both paws thrown past the body circle
}
REAR_POSES = {
    'tuck': (.55, .35, .10),      # gathered under the belly, hind feet landing past the forefeet
    'extend': (-.85, -1.25, -1.90),  # push-off: the long feet kick back, toes last off the ground
    'coil': (.30, .25, .05),      # deeper crouch before a spring
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


def key_pose(asset, frame, pose, key, body=0, hips=0, head=0, front=None, rear=None, bones=None, carriage=(ZERO, ZERO),
             yaws=None, glow=1.0):
    """body/hips/head: absolute pitches (hips points backwards: positive tucks the rump under);
    front/rear: {side: (a, b, c)} absolute leg pitches;
    yaws: {bone: world yaw}; bones: {name: (rotation, location, scale)} for ears, jaw, tail and stretch."""
    rig = asset['rig']
    bones, yaws = bones or {}, yaws or {}
    front, rear = front or {}, rear or {}
    pitch = {'body': body, 'hips': hips - body, 'head': head - body}
    for side, _, _ in SIDES:
        legs = front.get(side, (0, 0, 0))
        parent = body
        for segment, value in zip(FRONT, legs):
            pitch[f'front_{side}_{segment}'] = value - parent
            parent = value
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
    socket = asset['parts'].get('ear_glow')
    if socket is not None:
        socket.default_value = asset['parts']['ear_glow_rest'] * glow
        socket.keyframe_insert(data_path='default_value', frame=frame)


def ears(lift=0, spread=0, flick=(0, 0)):
    """Both ears: lift raises the tips, spread yaws them outwards, flick adds a per-ear lift (l, r)."""
    return {f'ear_{key}': ((lift + flick[0 if key == 'l' else 1], 0, -side * spread), ZERO, (1, 1, 1)) for _, key, side in SIDES}


def idle(asset, phase, frame, pose, key):
    """Tense breathing crouch: quick nose twitches, one ear flick each side, a tail flick, glowing ears pulse."""
    cycle = math.tau * phase
    breath = .5 - .5 * math.cos(cycle)
    twitch = math.sin(math.tau * 4 * phase) * (wrapped(phase, .20, .07) + wrapped(phase, .62, .07))
    flick = (.35 * wrapped(phase, .34, .035), .35 * wrapped(phase, .80, .035))
    bones = {
        **ears(lift=.03 * breath, flick=flick),
        'body': (ZERO, ZERO, (1 + .025 * breath, 1, 1 + .035 * breath)),
        'jaw': ((-.06 * max(0, twitch), 0, 0), ZERO, (1, 1, 1)),
        'tail': ((.30 * wrapped(phase, .55, .04), 0, 0), ZERO, (1, 1, 1)),
    }
    key_pose(asset, frame, pose, key, head=.03 * twitch + .02 * math.sin(cycle), bones=bones,
             yaws={'head': .05 * math.sin(cycle + .4)},
             carriage=((0, 0, .008 * breath), ZERO), glow=1 + .25 * math.sin(cycle))


def bound(asset, phase, frame, pose, key):
    """Half-bound gallop in place: hind feet land together past the forefeet, the back flexes and
    stretches, the forefeet land one after the other; one flight phase per loop."""
    cycle = math.tau * phase
    # Gait clock (phase 0 = hind feet land, gathered): push off (to .30), flight (.30-.52),
    # left then right forefoot land (.50/.56), gather while the hind legs swing forward (.62-1).
    gather = wrapped(phase, 0, .14)
    extend = wrapped(phase, .40, .14)
    flight = math.sin(math.pi * smooth(.24, .58, phase)) if .24 < phase < .58 else 0

    def front_mix(offset):
        u = (phase - offset) % 1
        reach = wrapped(u, .44, .10)
        push = wrapped(u, .74, .12)
        brace = wrapped(u, .58, .06)
        return blend(FRONT_POSES, {'reach': reach, 'push': push, 'brace': brace * .5})

    rear = blend(REAR_POSES, {'tuck': wrapped(phase, .94, .14), 'extend': wrapped(phase, .30, .11)})
    bones = {
        **ears(lift=.06 * flight - .03 * gather, spread=.05 * extend),
        'hips': (ZERO, (0, .14 * extend - .06 * gather, 0), (1, 1 + .06 * extend, 1)),
        'tail': ((.25 * extend, 0, 0), ZERO, (1, 1, 1)),
        'jaw': ((-.08 * extend, 0, 0), ZERO, (1, 1, 1)),
    }
    key_pose(asset, frame, pose, key, body=.10 * extend - .08 * gather, hips=.30 * gather - .15 * extend,
             head=-.06 * extend + .08 * gather, front={'left': front_mix(0), 'right': front_mix(.06)},
             rear={'left': rear, 'right': rear}, bones=bones,
             carriage=((0, .06 * extend - .05 * gather, .16 * flight - .03 * gather), (.06 * math.sin(cycle), 0, 0)),
             glow=1.15 + .15 * math.sin(cycle))


def bite(asset, phase, frame, p, pose, key):
    """Coil (to `strike`), lunge with jaws wide and both forepaws thrown out, snap shut on `impact`, recover."""
    markers = p.get('markerPhases', {})
    strike, impact = markers.get('strike', 5 / 11), markers.get('impact', 7 / 11)
    follow = impact + (1 - impact) / 4  # one frame past `impact`, like the shared claw contract
    coil = envelope(phase, (0, 0), (strike * .85, 1), (strike, 1), (strike + (impact - strike) * .5, 0), (1, 0))
    lunge = envelope(phase, (0, 0), (strike, 0), (impact, 1), (follow, 1), (1, 0))
    gape = envelope(phase, (0, 0), (strike * .7, 0), (strike, 1), (impact - (impact - strike) * .25, 1), (impact, 0), (1, 0))
    paws = blend(FRONT_POSES, {'strike': lunge, 'brace': .4 * coil})
    rear = blend(REAR_POSES, {'coil': coil, 'extend': .55 * lunge})
    bones = {
        **ears(lift=-.04 * coil - .02 * lunge),
        'jaw': ((-.55 * gape, 0, 0), ZERO, (1, 1, 1)),
        'head': (ZERO, (0, .22 * lunge, 0), (1, 1, 1)),
        'hips': (ZERO, (0, .10 * lunge, 0), (1, 1 + .05 * lunge, 1)),
    }
    key_pose(asset, frame, pose, key, body=-.06 * coil + .08 * lunge, hips=.08 * coil - .05 * lunge,
             head=-.10 * coil + .14 * gape - .06 * lunge, front={'left': paws, 'right': paws},
             rear={'left': rear, 'right': rear}, bones=bones,
             carriage=((0, -.10 * coil + .45 * lunge, -.06 * coil + .05 * lunge), (-.04 * coil + .05 * lunge, 0, 0)),
             glow=1 + .4 * coil + .8 * lunge)


def windup(asset, phase, frame, pose, key):
    """Pounce lock (loop): pressed flat, rump raised and wiggling, hind feet treading, eyes on the target."""
    cycle = math.tau * phase
    wiggle = math.sin(cycle * 2)
    tread = math.sin(cycle * 2)
    rear_l = blend(REAR_POSES, {'coil': .9 + .25 * max(0, tread)})
    rear_r = blend(REAR_POSES, {'coil': .9 + .25 * max(0, -tread)})
    paws = blend(FRONT_POSES, {'brace': .55})
    bones = {
        **ears(lift=-.05, spread=-.04),
        'hips': (ZERO, (0, -.04, 0), (1, 1, 1)),
        'tail': ((.20 + .10 * math.sin(cycle * 4), 0, .15 * wiggle), ZERO, (1, 1, 1)),
    }
    key_pose(asset, frame, pose, key, body=-.10, hips=-.16 - .03 * math.sin(cycle * 4), head=-.04,
             front={'left': paws, 'right': paws}, rear={'left': rear_l, 'right': rear_r}, bones=bones,
             yaws={'hips': .14 * wiggle, 'head': -.03 * wiggle},
             carriage=((0, -.06, -.07), (-.05, .03 * wiggle, 0)), glow=1.5 + .3 * math.sin(cycle * 2))


def leap(asset, phase, frame, p, pose, key):
    """Crouch (to `launch`), spring with the body stretched, forepaws reaching and hind feet trailing,
    hit the ground on `land` with braced forepaws, settle to rest."""
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
    paws = blend(FRONT_POSES, {'reach': reach, 'brace': brace})
    rear = blend(REAR_POSES, {'coil': crouch, 'extend': trail, 'tuck': tuck})
    bones = {
        **ears(lift=.10 * stretch - .05 * crouch - .04 * brace, spread=.06 * stretch),
        'hips': (ZERO, (0, .16 * stretch - .05 * crouch, 0), (1, 1 + .08 * stretch, 1)),
        'jaw': ((-.30 * reach * (1 - brace), 0, 0), ZERO, (1, 1, 1)),
        'tail': ((.30 * stretch, 0, 0), ZERO, (1, 1, 1)),
    }
    pitch = .14 * math.sin(math.tau * t) if launch < phase < land else 0
    key_pose(asset, frame, pose, key, body=-.10 * crouch + .10 * stretch - .08 * brace, hips=.10 * crouch - .20 * stretch + .08 * brace,
             head=.10 * reach - .06 * brace, front={'left': paws, 'right': paws}, rear={'left': rear, 'right': rear}, bones=bones,
             carriage=((0, -.06 * crouch + .10 * stretch, -.08 * crouch + .70 * height - .05 * brace), (-.05 * crouch + pitch, 0, 0)),
             glow=1 + .6 * crouch + 1.0 * stretch + .3 * brace)


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
