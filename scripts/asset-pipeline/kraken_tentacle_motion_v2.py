"""Giant strike tentacle: erupts from the water, lurks as an upright column, crashes down on the lane, pulls back.

Geometry lies flat along +Y (the lane) in a soft S; its root climbs out of deep water at the
`waterEntry` socket (chain fraction ~0.16). Poses are cumulative (pitch, yaw, twist) profiles in
degrees per chain fraction; each bone keys only its local share, so the arc stays continuous.
Rest (frame 0) is the towering hover: a near-vertical column over the water entry whose upper
third arches forward over the lane with a hanging hook, cups turned towards the target.
"""
import math

SUPPORTED = ('kraken_tentacle_rise', 'kraken_tentacle_hover', 'kraken_tentacle_slam', 'kraken_tentacle_retract')
DEEP = -3.3


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def bell(center, width, x):
    return math.exp(-((x - center) / width) ** 2)


def lerp(a, b, t):
    return a + (b - a) * t


def profile(points, n):
    """Piecewise-linear cumulative angle (degrees) sampled for n bones."""
    out = []
    for j in range(n):
        x = j / (n - 1)
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            if x0 <= x <= x1:
                out.append(lerp(y0, y1, (x - x0) / ((x1 - x0) or 1)))
                break
    return out


# (pitch, yaw, twist) control points per chain fraction; 0.16 is the water entry.
POSES = {
    'flat': ([(0, 0), (1, 0)], [(0, 0), (1, 0)], [(0, 0), (.3, 0), (1, 32)]),
    # Lurking: an upright column over the entry, the crown bowed with a hanging hook. It does not lie
    # over the lane, so the rest pose never betrays where it will strike.
    'raised': ([(0, 0), (.16, 0), (.28, 82), (.45, 92), (.62, 88), (.78, 72), (.90, 34), (1, -40)],
               [(0, 0), (.40, 6), (.70, -8), (1, 10)],
               [(0, 0), (.78, 0), (1, 60)]),
    # Wind-up: the column rears back past vertical and the hook coils, a short load before the fall.
    'windup': ([(0, 0), (.16, 0), (.28, 96), (.45, 100), (.62, 94), (.78, 78), (.90, 36), (1, -50)],
               [(0, 0), (.40, 5), (.70, -6), (1, 8)],
               [(0, 0), (.78, 0), (1, 85)]),
    # Deep under water: a compact serpentine coil, the start of `rise` (buried parts over land are
    # hidden by the submersion shader).
    'coiled': ([(0, 0), (.16, -14), (.40, 0), (.70, 10), (1, -12)],
               [(0, 0), (.25, 55), (.45, -55), (.65, 50), (.85, -40), (1, 35)],
               [(0, 0), (1, 40)]),
    # End of `retract`: the arm tips steeply down into the water at the entry. From above its
    # projection shrinks back towards the entry while buried parts fade, so it withdraws backwards.
    'plunged': ([(0, 0), (.16, -55), (.40, -62), (.70, -58), (.90, -40), (1, -20)],
                [(0, 0), (.40, 12), (.70, -15), (1, 10)],
                [(0, 0), (.30, 0), (1, 32)]),
}


def sample(name, n):
    return [profile(points, n) for points in POSES[name]]


def mix(a, b, t):
    return [[lerp(x, y, t) for x, y in zip(ca, cb)] for ca, cb in zip(a, b)]


def apply_kraken_tentacle(asset, motion, phase, frame, idle, p, pose, key):
    if motion not in SUPPORTED:
        raise ValueError(f'Unknown Kraken tentacle motion: {motion}')
    chain = asset['parts']['tentacle_chains'][0]
    n = len(chain)
    shapes = {name: sample(name, n) for name in POSES}
    depth = 0
    if idle or motion == 'kraken_tentacle_hover':
        shape = [list(c) for c in shapes['raised']]
        if not idle:
            cycle = math.tau * phase
            for j in range(n):
                t = j / (n - 1)
                up = smooth(.25, .6, t)
                # Lurking: the column breathes, the crown weaves in every direction and the hook tastes
                # the air, so it never settles on one heading. Each term is zero at phase 0 (exact handover).
                shape[0][j] += 5 * (math.sin(cycle - t * 2.4) - math.sin(-t * 2.4)) * up
                shape[1][j] += 12 * (math.sin(cycle + 1.1 - t * 3.6) - math.sin(1.1 - t * 3.6)) * up
                shape[1][j] += 6 * (math.sin(2 * cycle - t * 4.0) - math.sin(-t * 4.0)) * smooth(.55, 1, t)
                shape[2][j] += 14 * (math.sin(cycle + .4) - math.sin(.4)) * smooth(.6, 1, t)
    elif motion == 'kraken_tentacle_rise':
        # Bursts straight up out of the deep, overshoots high, settles into the tower.
        surge = smooth(0, .45, phase)
        depth = DEEP * (1 - surge)
        shape = mix(shapes['coiled'], shapes['raised'], smooth(.05, .70, phase))
        stretch = math.sin(math.pi * smooth(.35, 1, phase)) * (1 - smooth(.85, 1, phase))
        shape[0] = [s - 18 * stretch * smooth(.55, .95, j / (n - 1)) for j, s in enumerate(shape[0])]
    elif motion == 'kraken_tentacle_slam':
        m = p.get('markerPhases', {})
        strike, impact = m.get('strike', .34), m.get('impact', .52)
        ready = mix(shapes['raised'], shapes['windup'], smooth(0, strike, phase))
        shape = [[], [], []]
        for j in range(n):
            t = j / (n - 1)
            delay = .14 * t  # the column topples first, the tip lands last: a whip
            fall = smooth(strike - .04 + delay * .35, impact + delay * .30, phase)
            for k in range(3):
                target = shapes['flat'][k][j] - (8 * smooth(.6, 1, t) if k == 0 else 0)
                shape[k].append(lerp(ready[k][j], target, fall))
            after = max(0, phase - impact)
            shape[1][j] += (6 * math.sin(after * 42 - t * 9) * math.exp(-after * 6) * smooth(.15, .45, t)
                            * (phase > impact) * (1 - smooth(.85, 1, phase)))
        shape = mix(shape, shapes['flat'], smooth(impact + .12, 1, phase))
    else:  # kraken_tentacle_retract: peel up from the tip, gather over the entry, plunge home.
        # The hook lets go of the ground, then the arm is hauled down into the water at the entry.
        shape = mix(shapes['flat'], shapes['plunged'], smooth(.08, .90, phase))
        release = bell(.16, .10, phase) * smooth(0, .08, phase)  # exactly flat on the slam handover
        shape[0] = [a + 45 * release * smooth(.70, 1, j / (n - 1)) for j, a in enumerate(shape[0])]
        depth = DEEP * smooth(.35, 1, phase)
    rig = asset['rig']
    previous = [0, 0, 0]
    for j, name in enumerate(chain):
        local = [math.radians(shape[k][j] - previous[k]) for k in range(3)]
        previous = [shape[k][j] for k in range(3)]
        # Bone axes: X lateral (pitch up), Y along the arm (twist), Z up (yaw).
        key(rig.pose.bones[name], 'rotation_euler', (local[0], local[2], local[1]), frame)
        key(rig.pose.bones[name], 'location', (0, 0, 0), frame)
    pose('body', location=(0, 0, depth))
