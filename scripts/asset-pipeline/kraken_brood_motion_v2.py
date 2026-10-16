"""Mini-Kraken (kraken brood) motions: land crawl, ink spit, leap and idle.

Arms key (pitch, twist, yaw) per chain bone like the boss: positive pitch lifts, and
`side * yaw` with yaw > 0 sweeps an arm forward on either side. The `mantle` bone pumps the
sac in its own axes (x across, y along the sac towards the tail, z up); the `head` bone and
the eyes riding on `body` stay put. Lid pivots rotate about the eye's lateral axis and
negative angles lower the hood. Every call keys every control, so no clip inherits a pose,
and one-shots reach the exact rest pose on their last frame.
"""
import math

SUPPORTED_MOTIONS = ('kraken_brood_idle', 'kraken_brood_crawl', 'kraken_brood_spit', 'kraken_brood_leap')
LIDS = ('lid_main_l', 'lid_main_r', 'lid_second_l', 'lid_second_r')
CLOSED = -1.10  # radians: hood over the iris
SWING = .40  # share of the crawl cycle an arm spends lifted


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def envelope(phase, *points):
    """Smooth beats with exact plateaus and exact rest endpoints."""
    if phase <= points[0][0]:
        return points[0][1]
    for (a, value), (b, target) in zip(points, points[1:]):
        if phase <= b:
            return value + (target - value) * smooth(a, b, phase)
    return points[-1][1]


def rest_bend(j, side, t):
    return (0, 0, 0)


def key_pose(asset, frame, pose, key, bend=rest_bend, carriage=((0, 0, 0), (0, 0, 0), (1, 1, 1)),
             body=(1, 1, 1), sac=(1, 1, 1), sac_turn=(0, 0, 0), lids=None, attack=((0, 0, 0), (1, 1, 1))):
    """bend(j, side, t) -> (pitch, twist, yaw) per chain bone; j = 0 front arm .. 3 rear arm."""
    rig = asset['rig']
    for i, chain in enumerate(asset['parts']['tentacle_chains']):
        side = -1 if i < 4 else 1
        for k, name in enumerate(chain):
            bone = rig.pose.bones[name]
            pitch, twist, yaw = bend(i % 4, side, k / (len(chain) - 1))
            key(bone, 'rotation_euler', (pitch, twist, side * yaw), frame)
            key(bone, 'location', (0, 0, 0), frame)
            key(bone, 'scale', (1, 1, 1), frame)
    for name, scale, rotation in (('mantle', sac, sac_turn), ('head', (1, 1, 1), (0, 0, 0))):
        bone = rig.pose.bones[name]
        key(bone, 'rotation_euler', rotation, frame)
        key(bone, 'location', (0, 0, 0), frame)
        key(bone, 'scale', scale, frame)
    location, rotation, scale = carriage
    pose('carriage', location=location, rotation=rotation, scale=scale)
    pose('body', scale=body)
    for name in LIDS:
        pose(name, rotation=(CLOSED * (lids(name) if lids else 0), 0, 0))
    pose('attack_motion', location=attack[0], scale=attack[1])


def idle(asset, phase, frame, pose, key):
    """Slow sac pumping, writhing arms with curling tips and an unsettling out-of-sync blink."""
    cycle = math.tau * phase
    breath = .5 - .5 * math.cos(cycle)

    def bend(j, side, t):
        wave = math.sin(cycle - 3.0 * t + j * 1.4 + (.9 if side > 0 else 0))
        curl = math.sin(cycle + j * .8 + (1.7 if side > 0 else 0))
        return (.035 * math.sin(cycle + j * 1.1 + side) * t * t, 0, .045 * wave * t - .05 * max(0, curl) * t ** 3)

    def lids(name):
        lag = .05 if 'second' in name else 0
        return envelope(phase, (0, 0), (.52 + lag, 0), (.60 + lag, 1), (.70 + lag, 0), (1, 0))

    key_pose(asset, frame, pose, key, bend,
             carriage=((0, .012 * math.sin(cycle), .008 * breath), (0, .010 * math.sin(cycle), .018 * math.sin(cycle)), (1, 1, 1)),
             body=(1 + .010 * breath, 1, 1 + .018 * breath),
             sac=(1 + .055 * breath, 1 + .02 * breath, 1 + .08 * breath),
             sac_turn=(0, 0, .03 * math.sin(cycle - .7)), lids=lids)


def crawl(asset, phase, frame, pose, key):
    """Octopus crawl on land: alternating arm groups reach, plant and haul; the sac drags behind."""
    cycle = math.tau * phase

    def gait(u):
        u %= 1
        if u < SWING:
            k = smooth(0, SWING, u)
            return -1 + 2 * k, math.sin(math.pi * u / SWING), 0
        k = (u - SWING) / (1 - SWING)
        return 1 - 2 * k, 0, math.sin(math.pi * k)

    def bend(j, side, t):
        group = (j + (1 if side > 0 else 0)) % 2
        sweep, lift, grip = gait(phase + .5 * group - .06 * j)
        reach = (.085, .075, .065, .060)[j] * (1 - .35 * t)
        pitch = .11 * lift * (1 - t) ** 1.2 + .06 * lift * t ** 3 - .02 * grip * (1 - t)
        return (pitch, 0, reach * sweep - .07 * grip * t * t)

    push = math.sin(2 * cycle)
    load = .5 - .5 * math.cos(2 * cycle)
    key_pose(asset, frame, pose, key, bend,
             carriage=((.010 * math.sin(cycle), .060 * push, .022 * load), (0, .025 * math.sin(cycle), .035 * math.sin(cycle)), (1, 1, 1)),
             body=(1 - .012 * load, 1 + .015 * load, 1 + .015 * load),
             sac=(1 - .035 * math.sin(2 * cycle - .9), 1 + .07 * math.sin(2 * cycle - .9), 1 + .03 * load),
             sac_turn=(0, 0, .07 * math.sin(cycle - .8)))


def spit(asset, phase, frame, p, pose, key):
    """Inhale and rear (to `strike`), jet the ink from the sac (to `impact`), then settle."""
    markers = p.get('markerPhases', {})
    strike, impact = markers.get('strike', 4 / 11), markers.get('impact', 7 / 11)
    coil = envelope(phase, (0, 0), (strike * .85, 1), (strike, 1), (strike + (impact - strike) * .45, 0), (1, 0))
    # The lunge follows through one frame past `impact` (the shared claw contract), then settles.
    follow = impact + (1 - impact) / 4
    jet = envelope(phase, (0, 0), (strike, 0), (impact, .85), (follow, 1), (1, 0))

    def bend(j, side, t):
        front = j < 2
        if front:  # rear up and spread, then flare wide to clear the jet
            yaw = (-.075 if j == 0 else -.045) * coil - (.12 if j == 0 else .07) * jet
            return (.09 * coil * (1 - t) + .03 * jet * t, 0, yaw * (1 - .3 * t) - .05 * coil * t * t)
        return (-.025 * coil - .02 * jet, 0, -.03 * coil + .025 * jet)

    key_pose(asset, frame, pose, key, bend,
             carriage=((0, -.07 * coil, .03 * coil), (.11 * coil - .07 * jet, 0, 0), (1, 1, 1)),
             body=(1, 1 + .04 * jet, 1 + .03 * coil),
             sac=(1 + .10 * coil - .16 * jet, 1 + .04 * coil - .06 * jet, 1 + .14 * coil - .20 * jet),
             attack=((0, .20 * jet, 0), (1, 1, 1)))


def leap(asset, phase, frame, p, pose, key):
    """Crouch with a shiver (to `launch`), fly closer to the camera, splat down on `land`."""
    markers = p.get('markerPhases', {})
    launch, land = markers.get('launch', 11 / 21), markers.get('land', 17 / 21)
    crouch = envelope(phase, (0, 0), (launch * .8, 1), (launch, 1), (launch + .06, 0), (1, 0))
    air = envelope(phase, (0, 0), (launch, 0), (launch + (land - launch) * .45, 1), (land - .02, .8), (land, 0), (1, 0))
    splat = envelope(phase, (0, 0), (land - .03, 0), (land, 1), (land + (1 - land) * .35, .8), (1, 0))
    shiver = math.sin(math.tau * 9 * phase) * smooth(.25, .45, phase) * (1 - smooth(launch - .04, launch, phase))

    def bend(j, side, t):
        front = j < 2
        gather = (-.05 if front else .04) * crouch  # draw the crown in
        fly = (.07 if front else -.08) * air  # front arms reach ahead, rear arms stream behind
        splay = (-.06 if front else .045) * splat
        pitch = -.03 * crouch + (.06 if front else .02) * air * (1 - t) - .04 * splat
        tip = -.05 * crouch * t * t + (.06 if not front else 0) * air * t * t
        return (pitch, 0, gather + fly + splay + tip)

    s = 1 + .14 * air
    key_pose(asset, frame, pose, key, bend,
             carriage=((0, -.10 * crouch + .06 * air, -.04 * crouch + .35 * air), (-.06 * crouch + .05 * air, 0, .02 * shiver),
                       (s * (1 + .05 * crouch + .04 * splat), s * (1 - .04 * crouch + .04 * splat), s * (1 - .10 * crouch - .10 * splat))),
             body=(1 + .02 * crouch, 1 + .03 * air, 1 - .04 * crouch),
             sac=(1 + .08 * crouch - .10 * air + .10 * splat, 1 - .04 * crouch + .12 * air - .04 * splat,
                  1 - .14 * crouch - .08 * air - .18 * splat),
             lids=lambda name: -.15 * crouch)


def apply_kraken_brood(asset, motion, phase, frame, idle_pose, p, pose, key):
    if motion not in SUPPORTED_MOTIONS:
        raise ValueError(f'Unknown kraken brood motion: {motion}')
    if idle_pose:
        return key_pose(asset, frame, pose, key)
    if motion == 'kraken_brood_idle':
        return idle(asset, phase, frame, pose, key)
    if motion == 'kraken_brood_crawl':
        return crawl(asset, phase, frame, pose, key)
    if motion == 'kraken_brood_spit':
        return spit(asset, phase, frame, p, pose, key)
    return leap(asset, phase, frame, p, pose, key)
