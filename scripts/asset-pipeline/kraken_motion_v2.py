"""Kraken V8 water body: breathing swell, swimming arms and the cinematic surfacing.

Arms key (pitch, twist, yaw) per chain bone; positive pitch lifts. Lid pivots rotate
about the eye's lateral axis: negative angles lower the hooded lid over the iris.
`kraken_call_tentacle` and `kraken_throw_egg` live in kraken_motion_actions_v2.
"""
import math
import importlib

SUPPORTED_MOTIONS = ('kraken_idle', 'kraken_swim', 'kraken_intro_rise', 'kraken_call_tentacle', 'kraken_throw_egg',
                     'kraken_ink_spit', 'kraken_dive', 'kraken_surface', 'kraken_volley_spines')
DEEP = -1.9  # surfacing depth while dived: the whole body is below the visible water
LIDS = ('lid_main_l', 'lid_main_r', 'lid_second_l', 'lid_second_r')
CLOSED = -1.30  # radians: hood fully over the iris


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def bell(center, width, x):
    return math.exp(-((x - center) / width) ** 2)


def key_arms(asset, frame, key, bend, beard=None):
    """bend/beard(i, side, t) -> (pitch, twist, yaw), in radians.

    Beard indices run left to right; omitted beard explicitly keys the rest pose.
    Every call resets translation and scale too, so clips cannot inherit a pose.
    """
    rig = asset['rig']
    for i, chain in enumerate(asset['parts']['tentacle_chains']):
        side = -1 if i < 4 else 1
        for j, name in enumerate(chain):
            bone = rig.pose.bones[name]
            key(bone, 'rotation_euler', bend(i, side, j / (len(chain) - 1)), frame)
            key(bone, 'location', (0, 0, 0), frame)
    chains = asset['parts'].get('beard_chains', [])
    for i, chain in enumerate(chains):
        side = -1 if i < len(chains) // 2 else 1
        for j, name in enumerate(chain):
            bone = rig.pose.bones[name]
            rotation = beard(i, side, j / (len(chain) - 1)) if beard else (0, 0, 0)
            key(bone, 'rotation_euler', rotation, frame)
            key(bone, 'location', (0, 0, 0), frame)
            key(bone, 'scale', (1, 1, 1), frame)


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
    if not idle and motion == 'kraken_volley_spines':
        return spine_volley(asset, phase, frame, p, pose, key)
    if not idle and motion in ('kraken_dive', 'kraken_surface'):
        return dive_or_surface(asset, motion, phase, frame, p, pose, key)
    cycle = math.tau * phase
    if idle or motion not in ('kraken_intro_rise',):
        live = not idle
        swim = motion == 'kraken_swim' and live
        if swim:
            return swim_stroke(asset, phase, frame, pose, key)
        breath = (.5 - .5 * math.cos(cycle)) if live else 0
        swell = math.sin(cycle + .6) if live else 0
        pose('body', scale=(1 + .03 * breath, 1 + .02 * breath, 1 + .06 * breath), location=(0, 0, .03 * breath))
        pose('surfacing', location=(0, 0, .035 * swell), rotation=(.008 * math.sin(cycle + 1.1) if live else 0, .01 * swell, 0))

        def bend(i, side, t):
            if not live:
                return (0, 0, 0)
            # Every arm keeps its own integer harmonic, phase and reach, so the crown
            # stirs independently instead of wobbling as one; hooks roll in and out.
            k, ph, a = IDLE_HARMONIC[i], IDLE_PHASE[i], IDLE_REACH[i]
            yaw = side * .024 * a * math.sin(k * cycle + ph - 2.6 * t) * (.25 + t)
            pitch = (.016 * a * math.cos(k * cycle + ph - 2.2 * t) * (.2 + t)
                     + .022 * a * math.sin(k * cycle + ph + 1.2) * t ** 3)
            return (pitch, 0, yaw)
        key_arms(asset, frame, key, bend, beard_motion(cycle) if live else None)
        # One slow, deliberate blink per idle loop; the small rear eyes lag behind.
        blink = 0 if not live else bell(.62, .045, phase)
        lag = 0 if not live else bell(.67, .045, phase)
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
        pitch += .18 * bell(arms_break, .11, phase) * t * t
        pitch += (.06 * lift - .08 * slap) * (.4 + t) * settle
        yaw += side * .011 * math.sin(math.tau * phase * 1.5 - t * 4 + i) * (1 - smooth(eyes_open, 1, phase)) * rise
        return (pitch, 0, yaw)
    # The mouth tentacles twitch awake with the eyes and fan out on the roar.
    awake = smooth(arms_break, eyes_open, phase) * (1 - smooth(.90, 1, phase))
    key_arms(asset, frame, key, bend, beard_motion(math.tau * phase * 3, 1.2 * awake,
                                                   splay=1.2 * bell(roar, .05, phase) * (1 - smooth(.92, 1, phase))))
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
        tuck = smooth(.30, .95, phase)  # dive ends tucked; surface starts from exactly this pose
        key_arms(asset, frame, key, bend, beard_motion(math.tau * phase * 2, .5 * one_shot(phase),
                                                       splay=-.6 * tuck, curl=tuck))
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
    tuck = 1 - smooth(.05, .70, phase)
    key_arms(asset, frame, key, bend, beard_motion(math.tau * phase * 2, .5 * one_shot(phase),
                                                   splay=-.6 * tuck, curl=tuck))
    closure = 1 - smooth(eyes - .04, eyes + .06, phase)
    key_lids(pose, lambda name: closure)


IDLE_HARMONIC = (1, 2, 1, 1, 2, 1, 2, 1)  # integers keep the loop seamless
IDLE_PHASE = (0, 2.1, 4.0, 1.3, 3.1, .7, 5.2, 2.6)
IDLE_REACH = (1, .7, .85, .6, .9, .65, .8, .7)
STROKE = .34  # share of the swim cycle spent in the power stroke
BEARD_RATE = (1, 2, 1, 2, 1, 1, 2, 1, 2, 1)  # integers keep looping clips seamless
BEARD_PHASE = (0, 2.4, 4.7, 1.1, 3.6, 5.5, .6, 2.9, 4.2, 1.8)


def beard_motion(cycle, writhe=1.0, splay=0.0, curl=0.0, rate=1):
    """beard(i, side, t) for key_arms: every mouth tentacle writhes on its own harmonic, plus action
    terms: splay fans the crown out (negative gathers it), curl rolls the tips under the head.
    One-shot clips scale all terms to zero at their rest ends."""
    def beard(i, side, t):
        k, ph = BEARD_RATE[i] * rate, BEARD_PHASE[i]
        yaw = side * (.11 * writhe * math.sin(k * cycle + ph - 2.2 * t) * (.3 + t) - .16 * splay * (1 - .4 * t))
        pitch = (.09 * writhe * math.cos(k * cycle + ph - 1.8 * t) * (.3 + t) - .15 * curl * t
                 + .04 * splay * (1 - t))
        return (pitch, 0, yaw)
    return beard


def one_shot(phase, edge=.15):
    """Envelope that keeps a one-shot clip's secondary motion at rest on both ends."""
    return smooth(0, edge, phase) * (1 - smooth(1 - edge, 1, phase))


def swim_stroke(asset, phase, frame, pose, key):
    """Rowing jet: a fast power stroke closes the crown backwards like an umbrella while the
    mantle contracts and the body surges; a slow recovery reopens it with trailing tips."""
    def power(u):
        u %= 1
        return smooth(0, STROKE, u) if u < STROKE else 1 - smooth(STROKE, 1, u)

    p0 = power(phase)
    surge = math.sin(math.pi * min(1, (phase % 1) / STROKE)) if phase % 1 < STROKE else 0
    pose('body', scale=(1 - .05 * p0, 1 + .05 * p0, 1 - .03 * p0), location=(0, 0, .02 * p0))
    pose('surfacing', location=(0, .11 * surge, .02 * surge), rotation=(-.02 * surge, 0, 0))

    def bend(i, side, t):
        j = i % 4
        # Tips lag the roots: they still trail while the roots already reopen.
        u = phase - .09 * t - .02 * j
        sweep = power(u)
        reach = (.048, .050, .045, .036)[j]
        yaw = -side * reach * sweep * (1 - .45 * t)
        # Drag curls the tips forward on the stroke and lets them stream back on recovery.
        yaw += side * .017 * (power(u - .12) - sweep) * t * t
        pitch = .012 * sweep * (1 - t) - .01 * sweep * t
        return (pitch, 0, yaw)
    # The mouth tentacles stream back and gather on each stroke, then drift open again.
    key_arms(asset, frame, key, bend, beard_motion(math.tau * phase, .7, splay=-.6 * p0, curl=.8 * p0))
    key_lids(pose, lambda name: .1)


def spine_volley(asset, phase, frame, p, pose, key):
    """The mantle arches and swells while the crown braces, then six recoil jolts as the dorsal spikes
    (runtime parts at the spine sockets) leave front to back; the runtime hides each spike at its release."""
    m = p.get('markerPhases', {})
    raise_at = m.get('raise', .23)
    releases = [m.get(f'release-{k}', .43 + .06 * (k - 1)) for k in range(1, 7)]
    last = releases[-1]
    arch = smooth(0, raise_at, phase) * (1 - smooth(last, min(.97, last + .2), phase))
    kick = sum(bell(r + .012, .022, phase) for r in releases) * (1 - smooth(.9, 1, phase))
    # Body-only lifts expose the buried arm shoulders; the arch is carried by the whole animal instead.
    pose('body', scale=(1 + .02 * arch - .015 * kick, 1 + .015 * arch, 1 + .05 * arch - .03 * kick))
    pose('surfacing', location=(0, -.05 * arch - .03 * kick, .06 * arch), rotation=(.04 * arch, 0, 0))

    def bend(i, side, t):
        # The crown spreads to brace (yaw only, roots stay seated); each shot jolts the tips.
        return (.02 * kick * t, 0, -side * .02 * arch * (1 - .5 * t) + side * .012 * kick * t)
    key_arms(asset, frame, key, bend, beard_motion(math.tau * phase * 2, .9 * one_shot(phase), splay=.9 * arch, curl=.3 * kick))
    key_lids(pose, lambda name: .35 * arch)


def ink_spit(asset, phase, frame, p, pose, key, land=False):
    """Telegraphed ink cone: the mantle swells and the head draws back, then a hard forward thrust."""
    m = p.get('markerPhases', {})
    charge_at, spit_at = m.get('charge', .43), m.get('spit', .57)
    recover = 1 - smooth(.85, 1, phase)
    c = smooth(0, charge_at, phase) * (1 - smooth(spit_at, spit_at + .06, phase))
    s = bell(spit_at + .02, .045, phase) * recover
    r = smooth(spit_at + .04, spit_at + .16, phase) * (1 - smooth(.70, 1, phase))
    # Body-only shifts stay small (larger ones expose web roots buried in the mantle);
    # the whole animal (surfacing) draws back while loading and lunges with the jet.
    pose('body', scale=(1 + .045 * c - .06 * s, 1 + .03 * c - .04 * s, 1 + .14 * c - .16 * s),
         location=(0, -.015 * c + .05 * s, .05 * c))
    pose('surfacing', location=(0, -.06 * c + .12 * s - .06 * r, .03 * c), rotation=(.06 * c - .05 * s, 0, 0))

    def bend(i, side, t):
        j = i % 4
        if j == 0:  # front arms flare wide and rear up, then whip in ahead of the jet
            return (.06 * c * (1 - t) - .02 * c * t * t + .02 * s * t, 0,
                    -side * .042 * c * (.3 + t) + side * .065 * s * (.2 + t))
        k = (1, .8, .6)[j - 1]  # the crown loads backwards, fans forward with the jet, then trails
        return (-.02 * c * (1 - t) + .015 * s * t, 0,
                side * k * (-.022 * c * (1 - .4 * t) + .03 * s * (1 - .3 * t) - .012 * r * t))
    # The beard fans wide around the mouth while loading and snaps shut as the jet leaves.
    key_arms(asset, frame, key, bend, beard_motion(math.tau * phase * 2, .8 * one_shot(phase),
                                                   splay=1.3 * c - .7 * s, curl=.5 * s + .3 * r))
    key_lids(pose, lambda name: .45 * c * (1 - s))
