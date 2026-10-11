"""Giant strike tentacle: erupt, lurk like a cobra, whip down along the lane, dive back.

Geometry lies flat along +Y (the lane) in a soft S; its root climbs out of deep water.
Poses are cumulative (pitch, yaw, twist) profiles in degrees per chain fraction; each
bone keys only its local share, so the arc stays continuous. Top-down readability
drives the shapes: the rear half stays on the ground, only the front rears up.
Rest (frame 0) is the lurking hover.
"""
import math

SUPPORTED = ('kraken_tentacle_rise', 'kraken_tentacle_hover', 'kraken_tentacle_slam', 'kraken_tentacle_retract')
DEEP = -2.9


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


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


# (pitch, yaw, twist) control points per chain fraction.
POSES = {
    'flat': ([(0, 0), (1, 0)], [(0, 0), (1, 0)], [(0, 0), (.3, 0), (1, 32)]),
    'hover': ([(0, 0), (.42, 0), (.58, 82), (.72, 26), (.86, -72), (1, -165)],
              [(0, 0), (.30, 8), (.50, -10), (.70, 6), (1, 22)],
              [(0, 0), (.45, 0), (.7, 55), (1, 80)]),
    'windup': ([(0, 0), (.30, 6), (.46, 30), (.60, 118), (.76, 70), (.88, -40), (1, -150)],
               [(0, 0), (.30, 12), (.50, -14), (.70, 8), (1, 30)],
               [(0, 0), (.45, 0), (.7, 70), (1, 95)]),
    'coiled': ([(0, 0), (.16, -10), (.40, 20), (.70, 35), (1, 10)],
               [(0, 0), (.25, 55), (.45, -55), (.65, 50), (.85, -40), (1, 35)],
               [(0, 0), (1, 40)]),
    'lifted': ([(0, 0), (.20, 6), (.40, 48), (.65, 25), (.85, -20), (1, -60)],
               [(0, 0), (.4, 18), (.7, 70), (1, 140)],
               [(0, 0), (1, 45)]),
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
        shape = [list(c) for c in shapes['hover']]
        if not idle:
            cycle = math.tau * phase
            for j in range(n):
                t = j / (n - 1)
                # Lurking: the raised head bobs and weaves, the tip tastes the air.
                shape[0][j] += 5 * math.sin(cycle - t * 3.2) * smooth(.4, .7, t)
                shape[1][j] += 6 * math.sin(cycle + 1.3 - t * 4.0) * smooth(.3, .6, t)
    elif motion == 'kraken_tentacle_rise':
        # Deep spiral, erupts through the surface, unfurls and overshoots into the lurk.
        surge = smooth(0, .55, phase)
        depth = DEEP * (1 - surge)
        shape = mix(shapes['coiled'], shapes['hover'], smooth(.12, .82, phase))
        overshoot = math.sin(math.pi * smooth(.5, 1, phase)) * (1 - smooth(.85, 1, phase))
        shape[0] = [s + 16 * overshoot * smooth(.4, .8, j / (n - 1)) for j, s in enumerate(shape[0])]
    elif motion == 'kraken_tentacle_slam':
        m = p.get('markerPhases', {})
        strike, impact = m.get('strike', .34), m.get('impact', .52)
        ready = mix(shapes['hover'], shapes['windup'], smooth(0, strike, phase))
        shape = [[], [], []]
        for j in range(n):
            t = j / (n - 1)
            delay = .12 * t  # the tip arrives last: a whip, not a falling log
            whip = smooth(strike - .05 + delay * .4, impact + delay * .3, phase)
            for k in range(3):
                target = shapes['flat'][k][j] - (6 * smooth(.7, 1, t) if k == 0 else 0)
                shape[k].append(lerp(ready[k][j], target, whip))
            # Impact shudder runs down the arm and fades before the hand-over to retract.
            after = max(0, phase - impact)
            shape[1][j] += (5 * math.sin(after * 40 - t * 9) * math.exp(-after * 6) * smooth(.1, .4, t)
                            * (phase > impact) * (1 - smooth(.85, 1, phase)))
        settle = smooth(impact + .1, 1, phase)
        shape = mix(shape, shapes['flat'], settle)
    else:  # kraken_tentacle_retract: peel off the lane, coil and dive vertically home.
        shape = mix(shapes['flat'], shapes['lifted'], smooth(0, .4, phase))
        shape = mix(shape, shapes['coiled'], smooth(.35, 1, phase))
        depth = DEEP * smooth(.4, 1, phase)
    rig = asset['rig']
    previous = [0, 0, 0]
    for j, name in enumerate(chain):
        local = [math.radians(shape[k][j] - previous[k]) for k in range(3)]
        previous = [shape[k][j] for k in range(3)]
        # Bone axes: X lateral (pitch up), Y along the arm (twist), Z up (yaw).
        key(rig.pose.bones[name], 'rotation_euler', (local[0], local[2], local[1]), frame)
        key(rig.pose.bones[name], 'location', (0, 0, 0), frame)
    pose('body', location=(0, 0, depth))
