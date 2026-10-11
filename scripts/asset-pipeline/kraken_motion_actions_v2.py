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


# Throw order: alternating left/right from the front arms backwards.
THROW_ORDER = (0, 4, 2, 6, 3, 7)
THROW_START, THROW_STEP, THROW_WINDOW, THROW_RELEASE = .06, .11, .36, .60


def throw_windows(p):
    """Per-arm (start, release) phases; release follows the clip markers release-1..6 when present."""
    markers = p.get('markerPhases', {})
    out = {}
    for k, arm in enumerate(THROW_ORDER):
        start = THROW_START + THROW_STEP * k
        release = markers.get(f'release-{k + 1}', start + THROW_RELEASE * THROW_WINDOW)
        out[arm] = (release - THROW_RELEASE * THROW_WINDOW, release)
    return out


def smoothstep_tip(t):
    return smooth(.55, 1, t)


def brood_throw(asset, phase, frame, p, pose, key, key_arms, key_lids, land=False):
    """Six staggered throws: lift the egg, cock the arm back and up, whip it outward, follow through."""
    windows = throw_windows(p)
    local = {arm: (phase - start) / THROW_WINDOW for arm, (start, _) in windows.items()}

    def beats(u):
        lift = envelope(u, (0, 0), (.30, 1), (.62, 1), (1, 0)) if 0 < u < 1 else 0
        cock = envelope(u, (0, 0), (.15, 0), (.50, 1), (.60, .2), (.75, 0), (1, 0)) if 0 < u < 1 else 0
        snap = envelope(u, (0, 0), (.48, 0), (.60, 1), (.74, -.25), (1, 0)) if 0 < u < 1 else 0
        return lift, cock, snap

    eggs = {}
    for n, arm in enumerate(EGG_ARMS, 1):
        u = local[arm]
        eggs[n] = smooth(.05, .30, u) if u < THROW_RELEASE else 0  # gone exactly at its release
    key_eggs(pose, eggs)
    # The mantle pumps once per throw; the head leans a little towards the throwing side.
    pump = sum(beats(u)[2] for u in local.values()) / 2
    lean = sum((-1 if arm < 4 else 1) * beats(u)[1] for arm, u in local.items()) / 3
    recover = 1 - smooth(.92, 1, phase)
    pose('body', scale=(1 + .02 * pump, 1 - .015 * pump, 1 - .04 * pump))
    pose('surfacing', location=(0, 0, (.02 if land else .05) * min(1, pump) * recover),
         rotation=(0, .03 * lean * recover, 0))

    def bend(i, side, t):
        if i not in local:
            return (-.008 * pump * (1 - t), 0, 0)
        lift, cock, snap = beats(local[i])
        lag = smooth(.0, 1, t) * .06       # the whip travels from the root to the hook
        _, _, snap_late = beats(local[i] - lag)
        # From above the wind-up must read in the plane: a big swing back towards the tail with the
        # hook curling up, then a whip outward past the rest line.
        curl = .09 * cock * smoothstep_tip(t)
        pitch = .03 * lift * (.5 + .5 * t) + .07 * cock * (.6 + .4 * t) + curl - .06 * snap_late * (.3 + .7 * t)
        yaw = -side * .15 * cock * (.25 + .75 * t) + side * .10 * snap_late * (.2 + .8 * t)
        twist = side * .05 * cock * t
        return (pitch, twist, yaw)

    key_arms(asset, frame, key, bend)
    squint = max(beats(u)[2] for u in local.values())
    key_lids(pose, lambda name: .35 * squint * (.8 if 'second' in name else 1))


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
