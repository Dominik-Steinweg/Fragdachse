"""Quacksalber (plague-toad) motions: idle, in-place shuffle (move), hop, heal channel, tongue lash.

Every bone rolls its Z axis up, so Euler Z is a yaw seen from the camera and Euler X lifts the
bone's tip. Leg poses are authored as world headings per segment for the right side (degrees,
0 = outwards, 90 = north), mirrored for the left, and turned into parent-relative yaws against
the rig's rest bones. Real height lives on `carriage` (hop Z); no clip travels in XY or bakes a
display scale, the runtime owns travel and lift. Lid bones rotate about their own Y (the eye's
lateral axis); negative angles close the hood over the iris. Every call keys every control, so
no clip inherits a pose, and one-shots reach the exact rest pose on their last frame.
"""
import math

SUPPORTED_MOTIONS = ('toad_idle', 'toad_shuffle', 'toad_hop', 'toad_channel', 'toad_tongue')
LEGS = ('front_left', 'front_right', 'rear_left', 'rear_right')
SEGMENTS = ('upper', 'lower', 'foot')
CLOSED = -1.10  # radians: hood over the iris
GLOW = .35  # resting emission of the stitched cross
# Right-side world headings (upper, lower, foot) in degrees.
POSES = {
    'rear': {
        'crouch': (42, -117, 62),  # haunches gathered under the body, knees forward
        'extend': (-34, -100, -72),  # kicked back in a V behind the body, knees still bent
        'splay': (20, -124, 36),  # landing: haunches spread wide
        'push': (16, -100, 30),  # small in-place push
    },
    'front': {
        'brace': (0, 104, 120),  # arms planted wide
        'tuck': (-28, 66, 84),  # swept back along the flanks at take-off
        'reach': (46, 82, 90),  # stretched forward to catch the landing
        'step': (30, 90, 98),  # lunge step for the tongue lash
    },
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


def wrap(angle):
    return math.atan2(math.sin(angle), math.cos(angle))


def leg_yaws(rig, leg, mix):
    """mix: {pose: weight}; the remainder is the rest pose. Returns local yaw per segment."""
    side = -1 if leg.endswith('left') else 1
    group = POSES['front' if leg.startswith('front') else 'rear']
    world, previous, out = [], 0, []
    for k, segment in enumerate(SEGMENTS):
        bone = rig.data.bones[f'{leg}_{segment}']
        d = bone.tail_local - bone.head_local
        rest = math.atan2(d.y, d.x)
        delta = 0
        for name, weight in mix.items():
            heading = math.radians(group[name][k])
            target = heading if side > 0 else math.pi - heading
            delta += weight * wrap(target - rest)
        out.append(delta - previous)
        previous = delta
    return out


def key_pose(asset, frame, pose, key, legs=None, bones=None, carriage=((0, 0, 0), (0, 0, 0)), glow=GLOW):
    """legs: {leg: {pose: weight}}; bones: {name: (rotation, location, scale)} overrides."""
    rig = asset['rig']
    bones = bones or {}
    yaws = {leg: leg_yaws(rig, leg, (legs or {}).get(leg, {})) for leg in LEGS}
    for bone in rig.pose.bones:
        rotation, location, scale = bones.get(bone.name, ((0, 0, 0), (0, 0, 0), (1, 1, 1)))
        leg, _, segment = bone.name.rpartition('_')
        if leg in yaws:
            yaw = yaws[leg][SEGMENTS.index(segment)]
            rotation = (rotation[0], rotation[1], rotation[2] + yaw)
        key(bone, 'rotation_euler', rotation, frame)
        key(bone, 'location', location, frame)
        key(bone, 'scale', scale, frame)
    pose('carriage', location=carriage[0], rotation=carriage[1])
    socket = asset['parts']['cross_glow']
    socket.default_value = glow
    socket.keyframe_insert(data_path='default_value', frame=frame)


def lids(amount):
    return {name: ((0, CLOSED * amount, 0), (0, 0, 0), (1, 1, 1)) for name in ('lid_l', 'lid_r')}


def both(group, mix):
    return {leg: mix for leg in LEGS if leg.startswith(group)}


def idle(asset, phase, frame, pose, key):
    """Slow breathing, a quick gular pump in the throat sac, one heavy blink, faint cross glow."""
    cycle = math.tau * phase
    breath = .5 - .5 * math.cos(cycle)
    gular = .5 - .5 * math.cos(2 * cycle)
    blink = envelope(phase, (0, 0), (.56, 0), (.62, 1), (.68, 1), (.78, 0), (1, 0))
    bones = {
        'body': ((0, 0, .012 * math.sin(cycle)), (0, 0, 0), (1 + .012 * breath, 1 + .008 * breath, 1 + .035 * breath)),
        'head': ((.015 * math.sin(cycle - .6), 0, .018 * math.sin(cycle)), (0, 0, 0), (1, 1, 1)),
        'throat': ((0, 0, 0), (0, .012 * gular, 0), (1 + .10 * gular, 1 + .14 * gular, 1 + .24 * gular)),
        **lids(blink),
    }
    key_pose(asset, frame, pose, key, bones=bones,
             carriage=((0, 0, .006 * breath), (.010 * math.sin(cycle), 0, 0)), glow=GLOW + .08 * breath)


def shuffle(asset, phase, frame, pose, key):
    """Fallback locomotion: one small hop in place per loop (gather, pop up, land, settle)."""
    cycle = math.tau * phase
    gather = envelope(phase, (0, 0), (.20, 1), (.28, 1), (.36, 0), (1, 0))
    air = math.sin(math.pi * smooth(.30, .66, phase)) if .30 < phase < .66 else 0
    land = envelope(phase, (0, 0), (.62, 0), (.68, 1), (.82, .2), (.94, 0), (1, 0))
    gular = .5 - .5 * math.cos(2 * cycle)
    bones = {
        'body': ((0, 0, 0), (0, 0, 0), (1 + .04 * gather + .07 * land, 1 + .05 * air, 1 - .08 * gather - .12 * land)),
        'head': ((.06 * air - .03 * land, 0, 0), (0, 0, 0), (1, 1, 1)),
        'throat': ((0, 0, 0), (0, 0, 0), (1 + .06 * gular + .08 * land, 1 + .08 * gular, 1 + .14 * gular + .10 * land)),
        **lids(.3 * land),
    }
    rear = {'crouch': gather * (1 - air), 'push': air * .8, 'splay': land * .6}
    front = {'brace': .6 * gather + .7 * land, 'reach': .5 * air}
    key_pose(asset, frame, pose, key, legs={**both('rear', rear), **both('front', front)}, bones=bones,
             carriage=((0, 0, -.04 * gather + .24 * air - .03 * land), (.10 * air * (1 - phase) - .05 * land, 0, 0)))


def hop(asset, phase, frame, p, pose, key):
    """Crouch (to `launch`), kick off with real height, legs trail, squash on `land`, settle."""
    markers = p.get('markerPhases', {})
    launch, land = markers.get('launch', 6 / 19), markers.get('land', 14 / 19)
    apex = p.get('apex', .85)
    crouch = envelope(phase, (0, 0), (launch * .80, 1), (launch, 1), (launch + .07, 0), (1, 0))
    flight = (phase - launch) / (land - launch)
    height = math.sin(math.pi * flight) if 0 < flight < 1 else 0
    stretch = envelope(phase, (0, 0), (launch - .03, 0), (launch + .06, 1), (launch + .20, 0), (1, 0))
    trail = envelope(phase, (0, 0), (launch - .02, 0), (launch + .07, 1), (land - .16, 1), (land - .02, 0), (1, 0))
    reach = envelope(phase, (0, 0), (launch + .08, 0), (land - .10, 1), (land, .5), (land + .06, 0), (1, 0))
    tuck = envelope(phase, (0, 0), (launch - .02, 0), (launch + .06, 1), (launch + .20, 0), (1, 0))
    splat = envelope(phase, (0, 0), (land - .03, 0), (land, 1), (land + .07, .85), (1, 0))
    jiggle = splat * math.sin(math.tau * 3 * max(0, phase - land) / max(1e-6, 1 - land))
    bones = {
        'body': ((0, 0, 0), (0, 0, 0), (1 + .05 * crouch - .05 * stretch + .11 * splat, 1 + .11 * stretch + .03 * splat,
                                         1 - .14 * crouch + .06 * stretch - .20 * splat)),
        'head': ((.10 * height - .06 * splat, 0, 0), (0, 0, 0), (1, 1, 1)),
        'throat': ((0, 0, 0), (0, -.02 * stretch, 0), (1 + .14 * jiggle + .06 * splat, 1 + .10 * jiggle, 1 + .22 * jiggle + .10 * splat)),
        'cross': ((0, 0, 0), (0, 0, -.025 * splat), (1, 1, 1)),
        **lids(.15 * crouch + .45 * splat),
    }
    rear = {'crouch': crouch, 'extend': trail, 'splay': splat * .9}
    front = {'brace': max(crouch, splat) * .9, 'tuck': tuck, 'reach': reach}
    key_pose(asset, frame, pose, key, legs={**both('rear', rear), **both('front', front)}, bones=bones,
             carriage=((0, 0, -.07 * crouch + apex * height - .04 * splat), (.24 * stretch + .05 * height - .16 * reach * (1 - splat), 0, 0)))


def channel(asset, phase, frame, pose, key):
    """Rest heal: the throat sac pumps, the stitched cross rises and glows, the eyes stare wide."""
    cycle = math.tau * phase
    pump = .5 - .5 * math.cos(2 * cycle)
    pulse = .5 - .5 * math.cos(2 * cycle - 1.1)
    bones = {
        'body': ((0, 0, .01 * math.sin(cycle)), (0, 0, 0), (1 + .02 * pump, 1 + .01 * pump, 1 + .05 + .03 * pump)),
        'head': ((.07 + .02 * pump, 0, 0), (0, 0, 0), (1, 1, 1)),
        'throat': ((0, 0, 0), (0, .04 * pump, 0), (1 + .38 * pump, 1 + .46 * pump, 1 + .70 * pump)),
        'cross': ((0, 0, 0), (0, 0, .10 + .035 * pulse), (1.05 + .04 * pulse, 1.05 + .04 * pulse, 1.05 + .04 * pulse)),
        **lids(-.28 - .04 * pump),
    }
    front = {'brace': .45}
    key_pose(asset, frame, pose, key, legs=both('front', front), bones=bones,
             carriage=((0, 0, .02 + .01 * pump), (.02 * math.sin(cycle), 0, 0)), glow=.8 + .7 * pulse)


def tongue(asset, phase, frame, p, pose, key):
    """Rear back (to `strike`), lunge and lash the tongue out (to `impact`), hold, reel it in."""
    markers = p.get('markerPhases', {})
    strike, impact = markers.get('strike', 5 / 13), markers.get('impact', 8 / 13)
    follow = impact + (1 - impact) / 5  # one frame past `impact`, like the shared claw contract
    coil = envelope(phase, (0, 0), (strike * .85, 1), (strike, 1), (strike + (impact - strike) * .5, 0), (1, 0))
    lunge = envelope(phase, (0, 0), (strike, 0), (impact, 1), (follow, 1), (1, 0))
    lash = envelope(phase, (0, 0), (strike, 0), (impact, 1), (follow, 1), (follow + (1 - follow) * .55, 0), (1, 0))
    jaw_y, body_y = .20, .12
    # Stretch the stem so the sticky tip reaches `tongueReach` (BU from the pivot) at impact.
    stretch = max(1, (p.get('tongueReach', 2.92) - (.78 + jaw_y + body_y)) / .30)
    bones = {
        'body': ((0, 0, 0), (0, 0, 0), (1 + .04 * coil, 1 - .03 * coil + .05 * lunge, 1 - .06 * coil)),
        'head': ((-.05 * coil + .12 * lunge, 0, 0), (0, 0, 0), (1, 1, 1)),
        'jaw': ((-.18 * lunge, 0, 0), (0, jaw_y * lunge, -.02 * lunge), (1 + .06 * lunge, 1, 1)),
        'throat': ((0, 0, 0), (0, .03 * coil, 0), (1 + .20 * coil, 1 + .18 * coil, 1 + .30 * coil - .10 * lunge)),
        'tongue': ((.04 * lash, 0, 0), (0, 0, 0), (1 + .45 * lash, 1 + (stretch - 1) * lash, 1 + .30 * lash)),
        'tongue_tip': ((0, 0, 0), (0, 0, 0), (1 + .45 * lash, 1 + .45 * lash, 1 + .30 * lash)),
        **lids(.20 * coil - .15 * lunge),
    }
    rear = {'crouch': coil * .8, 'push': lunge * .6}
    front = {'brace': coil * .7, 'step': lunge}
    key_pose(asset, frame, pose, key, legs={**both('rear', rear), **both('front', front)}, bones=bones,
             carriage=((0, -.08 * coil + body_y * lunge, -.04 * coil), (-.05 * coil + .06 * lunge, 0, 0)))


def apply_plague_toad(asset, motion, phase, frame, idle_pose, p, pose, key):
    if motion not in SUPPORTED_MOTIONS:
        raise ValueError(f'Unknown plague toad motion: {motion}')
    if idle_pose:
        return key_pose(asset, frame, pose, key)
    if motion == 'toad_idle':
        return idle(asset, phase, frame, pose, key)
    if motion == 'toad_shuffle':
        return shuffle(asset, phase, frame, pose, key)
    if motion == 'toad_hop':
        return hop(asset, phase, frame, p, pose, key)
    if motion == 'toad_channel':
        return channel(asset, phase, frame, pose, key)
    return tongue(asset, phase, frame, p, pose, key)
