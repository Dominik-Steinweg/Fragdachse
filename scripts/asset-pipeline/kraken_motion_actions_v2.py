"""Marker-timed water actions and the shared six-arm brood throw.

Angles are local increments along sixteen bones, not whole-arm rotations.
Every sampled pose owns all controls, including the normally hidden brood.
"""
from kraken_motion_v2 import smooth


EGG_ARMS = (0, 2, 3, 4, 6, 7)


def envelope(phase, *points):
    """Smooth pose beats with exact plateaus and exact rest endpoints."""
    if phase <= points[0][0]:
        return points[0][1]
    for (a, value), (b, target) in zip(points, points[1:]):
        if phase <= b:
            return value + (target - value) * smooth(a, b, phase)
    return points[-1][1]


def key_eggs(pose, amounts=None):
    amounts = amounts or {}
    for n in range(1, 7):
        size = 1 + 999 * amounts.get(n, 0)
        pose(f'egg_carry_{n}', scale=(size, size, size))


def key_rest(asset, frame, pose, key, key_arms, key_lids):
    pose('body')
    pose('surfacing')
    key_arms(asset, frame, key, lambda i, side, t: (0, 0, 0))
    key_lids(pose, lambda name: 0)
    key_eggs(pose)


def brood_throw(asset, phase, frame, p, pose, key, key_arms, key_lids, land=False):
    release = p.get('markerPhases', {}).get('release', .57)
    windup = release * .67
    finish = release + (1 - release) * .52
    gather = envelope(phase, (0, 0), (windup, 1), (release, .25), (finish, 0), (1, 0))
    snap = envelope(phase, (0, 0), (windup, 0), (release, 1), (finish, -.24), (1, 0))
    # Six tips emerge in three slightly staggered pairs. Visibility cuts exactly
    # at release; no egg remains attached to a recovering arm.
    eggs = {}
    for n, arm in enumerate(EGG_ARMS, 1):
        delay = (arm % 4) * .018
        eggs[n] = smooth(.035 + delay, windup * .85 + delay, phase) if phase < release else 0
    key_eggs(pose, eggs)
    pose('body', scale=(1 - .045 * gather + .025 * snap,
                        1 - .025 * gather, 1 + .10 * gather - .07 * snap),
         location=(0, -.035 * gather, .035 * gather))
    pose('surfacing', location=(0, 0, (.035 if land else .10) * gather),
         rotation=(.025 * gather - .018 * snap, 0, 0))

    def bend(i, side, t):
        if i not in EGG_ARMS:
            return (-.012 * gather * (1 - t), 0, -side * .008 * snap * t)
        # The throw propagates towards the tip; the distal flick peaks at release.
        lag = .065 * t
        fling = envelope(phase, (0, 0), (windup + lag, 0),
                         (release + lag * .35, 1), (finish + lag, -.22), (1, 0))
        pitch = .085 * gather * (.7 + .3 * t) - .065 * fling * (.35 + .65 * t)
        yaw = -side * .060 * gather * (.25 + .75 * t) + side * .037 * fling * t
        return (pitch, side * .009 * gather * t, yaw)

    key_arms(asset, frame, key, bend)
    blink = envelope(phase, (0, 0), (windup, .12), (release, .38), (finish, 0), (1, 0))
    key_lids(pose, lambda name: blink * (.8 if 'second' in name else 1))


def apply_action(asset, motion, phase, frame, p, pose, key, key_arms, key_lids):
    if motion not in ('kraken_call_tentacle', 'kraken_throw_egg'):
        raise ValueError(f'Unknown Kraken water action: {motion}')
    if phase <= 0 or phase >= 1:
        return key_rest(asset, frame, pose, key, key_arms, key_lids)
    if motion == 'kraken_throw_egg':
        return brood_throw(asset, phase, frame, p, pose, key, key_arms, key_lids)

    markers = p.get('markerPhases', {})
    dive, resurface = markers.get('dive', 8 / 19), markers.get('resurface', 16 / 19)
    arm = int(p.get('arm', 4))
    if not 0 <= arm < 8:
        raise ValueError('Kraken call arm must be in [0, 7]')
    side = -1 if arm < 4 else 1
    anticipation = envelope(phase, (0, 0), (dive * .48, 1), (dive, 0), (1, 0))
    submerged = envelope(phase, (0, 0), (dive * .48, 0), (dive, 1), (resurface, 1), (1, 0))
    # The body only ducks; the called arm itself plunges steeply below the surface.
    pose('surfacing', location=(0, 0, -.12 * submerged),
         rotation=(0, side * (.025 * anticipation + .065 * submerged), 0))
    pose('body', scale=(1 + .025 * submerged, 1, 1 - .045 * submerged))
    key_eggs(pose)

    def bend(i, arm_side, t):
        if i != arm:
            return (.018 * submerged * t, 0, -arm_side * .010 * submerged * t)
        down = envelope(phase, (0, 0), (dive * .48 + .055 * t, 0),
                        (dive, 1), (resurface, 1), (1, 0))
        pitch = .09 * anticipation * (.7 + .3 * t) - down * (.26 * (1 - t) + .05 * t)
        yaw = arm_side * (.025 * anticipation - .025 * down) * (.4 + .6 * t)
        return (pitch, 0, yaw)

    key_arms(asset, frame, key, bend)
    squint = envelope(phase, (0, 0), (dive * .65, 0), (dive, .35),
                      (dive + (resurface - dive) * .4, .08), (resurface, .08), (1, 0))
    key_lids(pose, lambda name: squint)
