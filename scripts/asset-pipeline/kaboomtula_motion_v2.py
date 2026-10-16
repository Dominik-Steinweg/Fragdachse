"""Kabummtula (kaboomtula) motions: idle, skitter (move), web spit (claw), threat pose (alert), leap.

Every bone rolls its Z axis up, so Euler Z is a yaw seen from the camera and Euler X lifts the
bone's tip. For legs, `side * f` with f > 0 sweeps a leg's tip forward on either side (right
legs turn counter-clockwise, left legs clockwise); a negative f sweeps it back, which spreads the
front legs and gathers the rear ones. Fangs point inwards at rest; `-side * a` unfolds them
forward. Real height lives on `carriage` (leap Z); no clip travels in XY or bakes a display
scale, the runtime owns travel and lift. The abdomen's vein glow is keyed as a factor of the
recipe's rest strength. Every call keys every control, so no clip inherits a pose, and one-shots
reach the exact rest pose on their last frame.
"""
import math

SUPPORTED_MOTIONS = ('kaboomtula_idle', 'kaboomtula_skitter', 'kaboomtula_spit', 'kaboomtula_alert', 'kaboomtula_leap')
SIDES = (('l', -1), ('r', 1))
ZERO = (0, 0, 0)
# Tetrapod groups: legs 1 and 3 of one side step with legs 2 and 4 of the other.
GROUP = {('l', 1): 0, ('r', 2): 0, ('l', 3): 0, ('r', 4): 0, ('r', 1): 1, ('l', 2): 1, ('r', 3): 1, ('l', 4): 1}
SWEEP = {1: .30, 2: .25, 3: .25, 4: .30}  # skitter yaw amplitude per leg pair (radians)
SWING = .42  # share of the gait cycle a leg spends lifted


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


def key_pose(asset, frame, pose, key, legs=None, bones=None, carriage=(ZERO, ZERO), glow=1.0):
    """legs(key, n, side) -> {segment: rotation}; bones: {name: (rotation, location, scale)}."""
    rig = asset['rig']
    bones = bones or {}
    for bone in rig.pose.bones:
        rotation, location, scale = bones.get(bone.name, (ZERO, ZERO, (1, 1, 1)))
        if legs and bone.name.startswith('leg_'):
            leg, segment = bone.name[4:].split('_')
            rotation = legs(leg[0], int(leg[1]), -1 if leg[0] == 'l' else 1).get(segment, ZERO)
        key(bone, 'rotation_euler', rotation, frame)
        key(bone, 'location', location, frame)
        key(bone, 'scale', scale, frame)
    pose('carriage', location=carriage[0], rotation=carriage[1])
    socket = asset['parts']['vein_glow']
    socket.default_value = asset['parts']['vein_glow_rest'] * glow
    socket.keyframe_insert(data_path='default_value', frame=frame)


def jaws(chelicera=0, fang=0, fang_pitch=0, palp=(0, 0, 0)):
    """Chelicerae pitch, fang unfolding and pedipalp (lift, spread, tibia lift) for both sides."""
    out = {}
    lift, spread, bend = palp
    for key, side in SIDES:
        out[f'chelicera_{key}'] = ((chelicera, 0, 0), ZERO, (1, 1, 1))
        out[f'fang_{key}'] = ((fang_pitch, 0, -side * fang), ZERO, (1, 1, 1))
        out[f'palp_{key}_femur'] = ((lift, 0, side * spread), ZERO, (1, 1, 1))
        out[f'palp_{key}_tibia'] = ((bend, 0, 0), ZERO, (1, 1, 1))
    return out


def abdomen(pitch=0, yaw=0, scale=(1, 1, 1)):
    return {'abdomen': ((pitch, 0, yaw), ZERO, scale)}


def idle(asset, phase, frame, pose, key):
    """Slow breathing bomb with a double heartbeat in the veins, tasting palps, one tapping leg."""
    cycle = math.tau * phase
    breath = .5 - .5 * math.cos(cycle)
    beat = wrapped(phase, .12, .045) + .6 * wrapped(phase, .25, .045)
    tap = wrapped(phase, .64, .07)

    def legs(leg, n, side):
        sway = .015 * math.sin(cycle + n * 1.3 + (side > 0))
        out = {'femur': (0, 0, side * sway)}
        if leg == 'l' and n == 1:
            out = {'femur': (.22 * tap, 0, side * (sway + .05 * tap)), 'tibia': (.16 * tap, 0, 0), 'tarsus': (.10 * tap, 0, 0)}
        return out
    bones = {**jaws(chelicera=.03 * math.sin(cycle),
                    palp=(.05 + .05 * math.sin(2 * cycle), .07 * math.sin(2 * cycle + 1), .04 * math.sin(2 * cycle))),
             **abdomen(yaw=.02 * math.sin(cycle - .6), scale=(1 + .025 * breath, 1 + .012 * breath, 1 + .035 * breath))}
    key_pose(asset, frame, pose, key, legs, bones,
             carriage=((0, 0, .006 * breath), (0, 0, .008 * math.sin(cycle))), glow=1 + .10 * math.sin(cycle) + .30 * beat)


def gait(u):
    """Sweep -1 (back) .. +1 (forward) and lift: swing forward lifted, stance back planted."""
    u %= 1
    if u < SWING:
        return -1 + 2 * smooth(0, SWING, u), math.sin(math.pi * u / SWING)
    return 1 - 2 * (u - SWING) / (1 - SWING), 0


def skitter(asset, phase, frame, pose, key):
    """Fast alternating tetrapod gait in place; the body wobbles, the bomb sways behind."""
    cycle = math.tau * phase

    def legs(leg, n, side):
        sweep, lift = gait(phase + .5 * GROUP[(leg, n)] + .04 * (n - 1))
        return {'femur': (.34 * lift, 0, side * SWEEP[n] * sweep), 'tibia': (.22 * lift, 0, 0), 'tarsus': (.12 * lift, 0, 0)}
    bones = {**jaws(palp=(.10 * max(0, math.sin(cycle)), .10 * math.sin(cycle), .06 * max(0, -math.sin(cycle)))),
             **abdomen(pitch=.03 * math.sin(2 * cycle - .5), yaw=.06 * math.sin(cycle - .8),
                       scale=(1, 1 + .015 * math.sin(2 * cycle - 1), 1))}
    bob = .5 - .5 * math.cos(2 * cycle)
    key_pose(asset, frame, pose, key, legs, bones,
             carriage=((.012 * math.sin(cycle), .02 * math.sin(2 * cycle), .018 * bob), (.02 * math.sin(2 * cycle), .015 * math.sin(cycle), .035 * math.sin(cycle))),
             glow=1.15 + .12 * math.sin(2 * cycle))


def alert(asset, phase, frame, pose, key):
    """Threat pose: rear up, raise and spread the front legs and palps, bare the fangs, the bomb flares."""
    rise = envelope(phase, (0, 0), (.32, 1), (.78, 1), (1, 0))
    shiver = math.sin(math.tau * 7 * phase) * smooth(.25, .40, phase) * (1 - smooth(.72, .80, phase))

    def legs(leg, n, side):
        if n == 1:
            return {'femur': (.60 * rise, 0, side * (-.50 * rise + .06 * shiver)), 'tibia': (.50 * rise, 0, 0), 'tarsus': (.25 * rise, 0, 0)}
        if n == 2:
            return {'femur': (.28 * rise, 0, side * (-.26 * rise + .03 * shiver)), 'tibia': (.18 * rise, 0, 0)}
        if n == 3:
            return {'femur': (-.05 * rise, 0, side * .05 * rise)}
        return {'femur': (-.10 * rise, 0, side * -.10 * rise)}
    bones = {**jaws(chelicera=.30 * rise, fang=1.0 * rise, fang_pitch=-.35 * rise, palp=(.50 * rise, -.40 * rise + .05 * shiver, .30 * rise)),
             **abdomen(pitch=-.22 * rise, scale=(1 + .08 * rise, 1 + .04 * rise, 1 + .10 * rise))}
    key_pose(asset, frame, pose, key, legs, bones,
             carriage=((0, -.05 * rise, .08 * rise), (.22 * rise, 0, .02 * shiver)), glow=1 + 1.1 * rise + .15 * shiver * rise)


def spit(asset, phase, frame, p, pose, key):
    """Inhale and rear (to `strike`), thrust the chelicerae and spit forward (to `impact`), settle."""
    markers = p.get('markerPhases', {})
    strike, impact = markers.get('strike', 6 / 13), markers.get('impact', 9 / 13)
    coil = envelope(phase, (0, 0), (strike * .85, 1), (strike, 1), (strike + (impact - strike) * .5, 0), (1, 0))
    follow = impact + (1 - impact) / 5  # one frame past `impact`, like the shared claw contract
    jet = envelope(phase, (0, 0), (strike, 0), (impact, 1), (follow, 1), (1, 0))

    def legs(leg, n, side):
        if n == 1:
            return {'femur': (.25 * coil + .05 * jet, 0, side * (-.15 * coil - .05 * jet)), 'tibia': (.20 * coil, 0, 0)}
        if n == 2:
            return {'femur': (.08 * coil, 0, side * -.06 * coil)}
        return {'femur': (-.05 * coil, 0, side * (.04 * coil - .04 * jet))}
    bones = {**jaws(chelicera=.35 * coil - .45 * jet, fang=.9 * jet, fang_pitch=-.3 * jet,
                    palp=(.35 * coil, -.35 * coil - .25 * jet, .25 * coil)),
             **abdomen(pitch=-.10 * coil + .08 * jet, scale=(1 + .07 * coil - .08 * jet, 1 + .03 * coil - .04 * jet, 1 + .09 * coil - .10 * jet))}
    key_pose(asset, frame, pose, key, legs, bones,
             carriage=((0, -.08 * coil + .16 * jet, .03 * coil), (.16 * coil - .10 * jet, 0, 0)), glow=1 + .4 * coil + .8 * jet)


def leap(asset, phase, frame, p, pose, key):
    """Crouch (to `launch`), fly with the front legs reaching and the rear trailing, splat on `land`."""
    markers = p.get('markerPhases', {})
    launch, land = markers.get('launch', 5 / 21), markers.get('land', 11 / 21)
    crouch = envelope(phase, (0, 0), (launch * .85, 1), (launch, 1), (launch + .05, 0), (1, 0))
    t = max(0, min(1, (phase - launch) / (land - launch)))
    height = math.sin(math.pi * t) if launch < phase < land else 0
    fly = envelope(phase, (0, 0), (launch - .02, 0), (launch + .06, 1), (land - .05, 1), (land, 0), (1, 0))
    splat = envelope(phase, (0, 0), (land - .02, 0), (land, 1), (land + (1 - land) * .3, .7), (1, 0))
    shake = math.sin(math.tau * 6 * phase) * smooth(land, land + .05, phase) * (1 - smooth(.80, .95, phase))

    def legs(leg, n, side):
        front = n <= 2
        crouched = (.15 * crouch, 0, side * (-.08 if front else .06) * crouch)
        # (femur pitch, femur sweep, tibia pitch, tarsus pitch) in flight: legs straighten, the front
        # pairs reach ahead like an arrow head, the rear pairs trail.
        reach = {1: (-.15, .50, .45, .20), 2: (-.12, .40, .40, .15), 3: (-.12, -.35, .40, .10), 4: (-.15, -.45, .45, .15)}[n]
        spread = (-.30 if front else .25) * splat
        return {'femur': (crouched[0] + reach[0] * fly - .15 * splat, 0, crouched[2] + side * (reach[1] * fly + spread + .02 * shake)),
                'tibia': (-.20 * crouch + reach[2] * fly + .25 * splat, 0, 0), 'tarsus': (reach[3] * fly, 0, 0)}
    bones = {**jaws(chelicera=.20 * fly, fang=.9 * fly, fang_pitch=-.30 * fly, palp=(.20 * fly, .15 * fly - .10 * splat, .10 * fly)),
             **abdomen(pitch=-.12 * fly, scale=(1 + .05 * crouch + .06 * splat, 1 - .03 * crouch, 1 - .06 * crouch - .08 * splat))}
    pitch = .10 * math.sin(math.tau * t) if launch < phase < land else 0
    key_pose(asset, frame, pose, key, legs, bones,
             carriage=((0, -.04 * crouch, -.07 * crouch + .60 * height - .05 * splat), (-.05 * crouch + pitch, 0, .03 * shake)),
             glow=1 + .7 * crouch + 1.0 * fly + .3 * splat)


def apply_kaboomtula(asset, motion, phase, frame, idle_pose, p, pose, key):
    if motion not in SUPPORTED_MOTIONS:
        raise ValueError(f'Unknown kaboomtula motion: {motion}')
    if idle_pose:
        return key_pose(asset, frame, pose, key)
    if motion == 'kaboomtula_idle':
        return idle(asset, phase, frame, pose, key)
    if motion == 'kaboomtula_skitter':
        return skitter(asset, phase, frame, pose, key)
    if motion == 'kaboomtula_alert':
        return alert(asset, phase, frame, pose, key)
    if motion == 'kaboomtula_spit':
        return spit(asset, phase, frame, p, pose, key)
    return leap(asset, phase, frame, p, pose, key)
