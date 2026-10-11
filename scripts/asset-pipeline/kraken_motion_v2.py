"""Kraken V8 water body: breathing swell, swimming arms and the cinematic surfacing.

Arms key (pitch, twist, yaw) per chain bone; positive pitch lifts. Lid pivots rotate
about the eye's lateral axis: negative angles lower the hooded lid over the iris.
`kraken_call_tentacle` and `kraken_throw_egg` live in kraken_motion_actions_v2.
"""
import math
import importlib

SUPPORTED_MOTIONS = ('kraken_idle', 'kraken_swim', 'kraken_intro_rise', 'kraken_call_tentacle', 'kraken_throw_egg',
                     'kraken_ink_spit', 'kraken_dive', 'kraken_surface')
DEEP = -1.9  # surfacing depth while dived: the whole body is below the visible water
LIDS = ('lid_main_l', 'lid_main_r', 'lid_second_l', 'lid_second_r')
CLOSED = -1.30  # radians: hood fully over the iris


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def bell(center, width, x):
    return math.exp(-((x - center) / width) ** 2)


def key_arms(asset, frame, key, bend):
    """bend(i, side, t) -> (pitch, twist, yaw) radians for chain i at bone fraction t."""
    rig = asset['rig']
    for i, chain in enumerate(asset['parts']['tentacle_chains']):
        side = -1 if i < 4 else 1
        for j, name in enumerate(chain):
            bone = rig.pose.bones[name]
            key(bone, 'rotation_euler', bend(i, side, j / (len(chain) - 1)), frame)
            key(bone, 'location', (0, 0, 0), frame)


def key_lids(pose, closure):
    for name in LIDS:
        c = closure(name)
        pose(name, rotation=(CLOSED * c, 0, 0))


def apply_kraken(asset, motion, phase, frame, idle, p, pose, key):
    # Carried brood eggs stay hidden (rest scale) unless an action keys them.
    for name in asset['parts']:
        if name.startswith('egg_carry_') and (idle or motion not in ('kraken_call_tentacle', 'kraken_throw_egg')):
            pose(name)
    if motion in ('kraken_call_tentacle', 'kraken_throw_egg') and not idle:
        actions = importlib.import_module('kraken_motion_actions_v2')
        return actions.apply_action(asset, motion, phase, frame, p, pose, key, key_arms, key_lids)
    if not idle and motion == 'kraken_ink_spit':
        return ink_spit(asset, phase, frame, p, pose, key)
    if not idle and motion in ('kraken_dive', 'kraken_surface'):
        return dive_or_surface(asset, motion, phase, frame, p, pose, key)
    cycle = math.tau * phase
    if idle or motion not in ('kraken_intro_rise',):
        live = not idle
        swim = motion == 'kraken_swim' and live
        breath = (.5 - .5 * math.cos(cycle)) if live else 0
        swell = math.sin(cycle + .6) if live else 0
        pose('body', scale=(1 + .03 * breath, 1 + .02 * breath, 1 + .06 * breath), location=(0, (-.02 * math.sin(cycle) if swim else 0), .03 * breath))
        pose('surfacing', location=(0, 0, .035 * swell), rotation=(.012 * math.sin(cycle + 1.1) if live else 0, .015 * swell, 0))
        amplitude = p.get('wave', .025) if live else 0

        def bend(i, side, t):
            if not live:
                return (0, 0, 0)
            offset = i * .72
            yaw = amplitude * side * math.sin(cycle - t * math.tau * (1.25 if swim else 1.05) + offset) * (.4 + t)
            pitch = amplitude * .8 * math.cos(cycle - t * 4.2 + offset) * (.3 + t)
            if swim:
                # Trailing arms: a rhythmic gather-and-push from the roots.
                pitch += .03 * math.sin(cycle) * (1 - t)
            return (pitch, 0, yaw)
        key_arms(asset, frame, key, bend)
        # One slow, deliberate blink per idle loop; the small rear eyes lag behind.
        blink = 0 if not live or swim else bell(.62, .045, phase)
        lag = 0 if not live or swim else bell(.67, .045, phase)
        key_lids(pose, lambda name: lag if 'second' in name else blink)
        return
    # Cinematic surfacing (one shot, ends exactly in the idle rest pose).
    m = p.get('markerPhases', {})
    arms_break, eyes_open, roar = m.get('arms-break', .30), m.get('eyes-open', .70), m.get('roar', .84)
    depth = -1.75 * (1 - smooth(.05, arms_break + .30, phase))
    overshoot = .16 * math.sin(math.pi * smooth(arms_break + .18, roar + .06, phase)) * (1 - smooth(roar, 1, phase))
    heave = .5 - .5 * math.cos(math.pi * smooth(roar - .06, roar + .02, phase))
    pose('surfacing', location=(0, 0, depth + overshoot + .05 * heave * (1 - smooth(roar + .02, 1, phase))),
         rotation=(-.10 * (1 - smooth(.2, .75, phase)), 0, 0))
    squash = bell(roar, .05, phase) * (1 - smooth(.95, 1, phase))
    pose('body', scale=(1 + .06 * squash, 1, 1 - .04 * squash))
    rise = smooth(.02, arms_break + .05, phase)      # arms unfold from under the body
    spread = smooth(arms_break - .05, eyes_open, phase)
    lift = bell(roar - .07, .05, phase)              # rear up ...
    slap = bell(roar + .01, .035, phase)             # ... and slap the water
    settle = 1 - smooth(roar + .04, 1, phase)

    def bend(i, side, t):
        fold = 1 - rise
        # Folded under the mantle: roots dive, tips curl back beneath the body.
        pitch = -.11 * fold * (1 - t) - .09 * fold * t
        yaw = -side * .035 * fold * (.5 + t) + side * .016 * (1 - spread) * rise * t
        # Tips break the surface first: they lift before the body arrives.
        pitch += .12 * bell(arms_break, .11, phase) * t * t
        pitch += (.06 * lift - .08 * slap) * (.4 + t) * settle
        yaw += side * .011 * math.sin(math.tau * phase * 1.5 - t * 4 + i) * (1 - smooth(eyes_open, 1, phase)) * rise
        return (pitch, 0, yaw)
    key_arms(asset, frame, key, bend)
    closure = 1 - smooth(eyes_open - .03, eyes_open + .06, phase)
    late = 1 - smooth(eyes_open + .02, eyes_open + .10, phase)
    key_lids(pose, lambda name: late if 'second' in name else closure)


def folded(side, t):
    """Arms tucked under the mantle (the dived pose), as (pitch, yaw) per bone."""
    return -.11 * (1 - t) - .09 * t, -side * .035 * (.5 + t)


def dive_or_surface(asset, motion, phase, frame, p, pose, key):
    """Dive ends exactly where surface starts: deep, nose down, arms folded, eyes shut."""
    if motion == 'kraken_dive':
        heave = bell(.12, .06, phase)                       # a last breath before going under
        sink = smooth(.25, .85, phase)
        pose('surfacing', location=(0, 0, .08 * heave + DEEP * sink), rotation=(-.10 * sink, 0, 0))
        pose('body', scale=(1 + .04 * heave, 1, 1 + .06 * heave))

        def bend(i, side, t):
            fold = smooth(.30 + .10 * t, .95, phase)        # roots first, the hooks trail last
            fp, fy = folded(side, t)
            lift = .05 * heave * (.4 + t)
            return (fp * fold + lift, 0, fy * fold)
        key_arms(asset, frame, key, bend)
        shut = smooth(.25, .42, phase)
        key_lids(pose, lambda name: max(shut, .3 * heave))
        return
    m = p.get('markerPhases', {})
    eyes = m.get('eyes-open', .64)
    rise = smooth(0, .60, phase)
    overshoot = .10 * math.sin(math.pi * smooth(.45, .95, phase)) * (1 - smooth(.85, 1, phase))
    pose('surfacing', location=(0, 0, DEEP * (1 - rise) + overshoot), rotation=(-.10 * (1 - smooth(.10, .60, phase)), 0, 0))
    pose('body')

    def bend(i, side, t):
        fold = 1 - smooth(.05 + .10 * t, .70, phase)
        fp, fy = folded(side, t)
        flick = .04 * bell(.80, .06, phase) * (.4 + t) * (1 - smooth(.90, 1, phase))
        return (fp * fold + flick, 0, fy * fold)
    key_arms(asset, frame, key, bend)
    closure = 1 - smooth(eyes - .04, eyes + .06, phase)
    key_lids(pose, lambda name: closure)


def ink_spit(asset, phase, frame, p, pose, key, land=False):
    """Telegraphed ink cone: the mantle swells and the head draws back, then a hard forward thrust."""
    m = p.get('markerPhases', {})
    charge_at, spit_at = m.get('charge', .43), m.get('spit', .57)
    recover = 1 - smooth(.85, 1, phase)
    c = smooth(0, charge_at, phase) * (1 - smooth(spit_at, spit_at + .08, phase))
    s = bell(spit_at + .02, .05, phase) * recover
    # Small translations only: larger shifts would expose web roots buried in the mantle.
    pose('body', scale=(1 + .03 * c - .04 * s, 1 + .02 * c - .03 * s, 1 + .09 * c - .11 * s),
         location=(0, -.015 * c + .05 * s, .04 * c))
    pose('surfacing', rotation=(.05 * c - .04 * s, 0, 0))

    def bend(i, side, t):
        if i in (0, 4):  # front arms part to clear the mouth, then snap forward with the jet
            return (.04 * c * (.3 + t), 0, side * .028 * c * (.3 + t) - side * .03 * s * t)
        return (-.02 * c * (1 - t), 0, 0)
    key_arms(asset, frame, key, bend)
    key_lids(pose, lambda name: .35 * c + .5 * s)
