"""Agile in-place land locomotion and marker-timed Kraken V8 attacks."""
import math

SWING = .40  # share of the scuttle cycle an arm spends in the air

from kraken_motion_v2 import ink_spit, key_arms, key_lids, smooth
from kraken_motion_actions_v2 import brood_throw, envelope, key_eggs, key_rest


SUPPORTED_MOTIONS = ('kraken_land_idle', 'kraken_land_move', 'kraken_land_ashore',
                     'kraken_land_slam', 'kraken_land_egg_throw', 'kraken_land_ink_spit', 'kraken_land_death')


def apply_kraken_land(asset, motion, phase, frame, idle, p, pose, key):
    if motion not in SUPPORTED_MOTIONS:
        raise ValueError(f'Unknown land Kraken motion: {motion}')
    if idle or (phase >= 1 and motion in ('kraken_land_ashore', 'kraken_land_slam', 'kraken_land_egg_throw')):
        return key_rest(asset, frame, pose, key, key_arms, key_lids)
    if motion == 'kraken_land_egg_throw':
        return brood_throw(asset, phase, frame, p, pose, key, key_arms, key_lids, land=True)
    if motion == 'kraken_land_ink_spit':
        key_eggs(pose)
        return ink_spit(asset, phase, frame, p, pose, key, land=True)

    key_eggs(pose)
    cycle = math.tau * phase
    markers = p.get('markerPhases', {})
    closure = 0

    if motion == 'kraken_land_idle':
        breath = .5 - .5 * math.cos(cycle)
        sway = math.sin(cycle)
        pose('body', scale=(1 + .024 * breath, 1 + .015 * breath, 1 + .055 * breath))
        pose('surfacing', location=(0, 0, .024 * breath), rotation=(0, .012 * sway, .007 * sway))

        def bend(i, side, t):
            wave = math.sin(cycle - 3.4 * t + i * .8)
            return (.018 * wave * t * t, 0, side * .021 * wave * t * t)

        # Compact periodic blink: identical first/closure poses, no Gaussian tail.
        closure = envelope(phase, (0, 0), (.42, 0), (.54, .94), (.69, 0), (1, 0))

    elif motion == 'kraken_land_move':
        # Agile tetrapod scuttle: two alternating arm groups swing forward fast
        # and sweep back linearly while planted, so the tips keep pace with the
        # ground. The whole animal surges once per push; the mantle stays fused.
        def gait(u):
            u %= 1
            if u < SWING:
                k = smooth(0, SWING, u)
                return -1 + 2 * k, math.sin(math.pi * u / SWING), 1 - k
            k = (u - SWING) / (1 - SWING)
            return 1 - 2 * k, 0, k

        push = math.sin(2 * cycle)
        load = .5 - .5 * math.cos(2 * cycle)
        pose('body', scale=(1 - .012 * load, 1 + .025 * load, 1 - .02 * load))
        pose('surfacing', location=(0, .10 * push, .05 * load),
             rotation=(0, .03 * math.sin(cycle), .055 * math.sin(cycle)))

        def bend(i, side, t):
            j = i % 4
            offset = 0 if i in (0, 2, 5, 7) else .5
            sweep, lift, pull = gait(phase + offset - .05 * j)  # front-to-back ripple
            wave = math.sin(math.tau * 2 * (phase + offset) - 4.5 * t)
            # Lifted arms foreshorten from above; the hook flicks up while in the air.
            step = .09 * lift * (1 - t) ** 1.4 - .035 * lift * t + .03 * lift * t ** 4
            if j == 0:  # reach out ahead, then hook in and drag
                return (step, 0, side * (.065 * pull * t * t - .024 * (1 - pull) * (1 - t)))
            if j == 3:  # push off behind and trail
                return (.7 * step, 0, side * (.026 * sweep * (1 - .5 * t) + .016 * wave * t))
            return (step, 0, side * (.028 * sweep * (1 - .45 * t) + .009 * wave * t))

        closure = .12

    elif motion == 'kraken_land_ashore':
        # The runtime shows the water body until `grip`; from there the front
        # arms are planted on the shore, drag the body out and the rest of the
        # crown swings forward to land on `heave`.
        grip, heave = markers.get('grip', 9 / 27), markers.get('heave', 18 / 27)
        reach = smooth(0, grip, phase) * (1 - smooth(grip, heave, phase))
        pull = envelope(phase, (0, 0), (grip, 0), (heave, 1), (1, 0))
        heaved = envelope(phase, (0, 0), (grip + (heave - grip) * .5, 0), (heave, 1), (1, 0))
        depth = -.70 * (1 - smooth(grip * .6, heave, phase))
        pose('surfacing', location=(0, .06 * pull, depth + .12 * heaved),
             rotation=(-.08 * (1 - smooth(grip, heave, phase)) + .04 * heaved, 0, 0))
        pose('body', scale=(1 - .02 * pull + .03 * heaved, 1 + .05 * pull, 1 + .06 * heaved))

        def bend(i, side, t):
            j = i % 4
            if j < 2:
                # Front tips arc over the waterline, slap down at grip and hook in.
                lift = smooth(0, grip * .8, phase) * (1 - smooth(grip * .8, grip, phase))
                pitch = .07 * lift * (1 - t) ** 1.3 - .03 * reach * t + .02 * pull * (1 - t)
                k = 1 if j == 0 else 1.3
                drag = side * k * (.07 * reach * (1 - t) ** 2 - .05 * pull * (1 - t) ** 2)
                return (pitch, 0, drag + side * .07 * pull * t * t)
            trail = 1 - smooth(grip, heave + (1 - heave) * .5, phase)
            return (-.02 * heaved * (1 - t) + .02 * heaved * t, 0,
                    side * (-.018 * trail * (1 - .3 * t) + .012 * heaved * (1 - t)))

        closure = .3 * (1 - smooth(grip, heave, phase))

    elif motion == 'kraken_land_slam':
        # Pounce: a short crouch with the claw arms reared and spread, then a
        # fast forward whip that closes them in front of the head. The runtime
        # carries the body forward between `strike` and `impact`.
        strike, impact = markers.get('strike', 8 / 19), markers.get('impact', 11 / 19)
        coil = envelope(phase, (0, 0), (strike * .8, 1), (strike, 1), (impact, 0), (1, 0))
        lunge = envelope(phase, (0, 0), (strike, 0), (impact, 1), (impact + (1 - impact) * .35, .55), (1, 0))
        snap = envelope(phase, (0, 0), (strike, 0), ((strike + impact) / 2, 1), (impact, .4), (1, 0))
        pose('surfacing', location=(0, -.14 * coil + .08 * lunge, -.04 * coil + .03 * snap),
             rotation=(.05 * coil - .03 * lunge, 0, 0))
        pose('body', scale=(1 + .04 * coil - .02 * lunge, 1 - .05 * coil + .06 * lunge, 1 + .03 * coil - .04 * lunge))

        def bend(i, side, t):
            j = i % 4
            if j < 2:
                k = 1 if j == 0 else .7
                spread = -side * .030 * k * coil * (1 - .3 * t)
                # Swing the whole arm in from the root so both claws meet ahead.
                close = side * k * lunge * (.13 * (1 - t) ** 2 + .03 * t)
                pitch = (.10 * coil * (1 - t) ** 1.2 - .04 * coil * t * t
                         - .035 * lunge * (1 - t) + .025 * snap * t)
                return (pitch, 0, spread + close)
            return (-.02 * coil * (1 - t), 0, -side * .016 * (.6 * coil + lunge) * (1 - .4 * t))

        closure = .25 * coil

    else:  # terminal: the final collapsed pose is intentionally held
        collapse = smooth(.25, .9, phase)
        spasm = envelope(phase, (0, 0), (.13, 1), (.24, -.45), (.34, .38), (.46, 0), (1, 0))
        # Compress the whole animal around a shared Z plane, with a little extra
        # mantle squash. Flattening only the mantle exposes the separate arm caps
        # and makes its fins intersect the webbing. Surfacing owns both hierarchies.
        flatten = 1 - .65 * collapse
        pose('body', scale=(1 + .045 * collapse, 1, 1 - .10 * collapse), location=(0, 0, .04 * collapse))
        pose('surfacing', scale=(1, 1, flatten), location=(0, 0, -.16 * collapse),
             rotation=(0, .03 * spasm, -.018 * collapse))

        def bend(i, side, t):
            curl = smooth(.27 + .10 * t, .88 + .10 * t, phase)
            twitch = spasm * math.cos(i * 1.3 - t * 2)
            return (.035 * twitch * t + .025 * curl * t, 0,
                    side * (.026 * twitch - .21 * curl * t ** 1.25))

        closure = smooth(.18, .94, phase)

    key_arms(asset, frame, key, bend)
    key_lids(pose, lambda name: closure)
