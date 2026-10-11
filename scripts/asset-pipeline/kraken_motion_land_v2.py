"""Heavy, in-place land locomotion and marker-timed Kraken V8 attacks."""
import math

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
        sway = math.sin(cycle)
        load = .5 - .5 * math.cos(2 * cycle)
        pose('body', scale=(1 + .018 * load, 1 - .016 * load, 1 + .07 * load),
             location=(0, -.035 * math.cos(2 * cycle), .045 * load))
        pose('surfacing', rotation=(.012 * math.sin(2 * cycle), .023 * sway, .012 * sway))

        def bend(i, side, t):
            group = 0 if i in (0, 2, 5, 7) else math.pi
            stroke = cycle + group
            reach = math.sin(stroke - .75 * t)
            lift = max(0, math.cos(stroke)) ** 2
            # Proximal yaw swings the arm north; the tip lags and plants before
            # the body loads it. Opposite groups exchange support every half-cycle.
            return (.037 * lift * (1 - .65 * t), side * .004 * reach * t,
                    side * .025 * reach * (1 - .45 * t))

    elif motion == 'kraken_land_ashore':
        grip, heave = markers.get('grip', 9 / 27), markers.get('heave', 18 / 27)
        pull = envelope(phase, (0, 0), (grip, .25), (heave, 1), (1, 0))
        depth = -.70 * (1 - smooth(grip * .7, heave, phase))
        settle = envelope(phase, (0, 0), (grip, 0), (heave, 1), (1, 0))
        pose('surfacing', location=(0, 0, depth + .07 * settle),
             rotation=(-.07 * (1 - smooth(grip, 1, phase)), 0, 0))
        pose('body', scale=(1 + .035 * pull, 1 - .025 * pull, 1 + .065 * pull))

        def bend(i, side, t):
            front = i % 4 < 2
            reach = 1 - smooth(grip if front else heave * .7, 1, phase)
            plant = envelope(phase, (0, 0), (grip if front else heave, 1), (1, 0))
            # Front tips must clear z=0 while the shoulders are still submerged.
            # Proximal lift carries them to the shore; it unloads as the body rises.
            lift = smooth(0, grip * .85, phase) * (1 - smooth(grip, heave, phase))
            pitch = (.035 * reach * t + .065 * lift * (1 - t) ** 1.3 - .016 * pull * (1 - t)
                     if front else .035 * reach * t - .027 * plant * (1 - t))
            return (pitch, 0,
                    side * (.025 * reach * (1 - t) - .027 * pull * t))

        closure = .35 * (1 - smooth(grip, heave, phase))

    elif motion == 'kraken_land_slam':
        strike, impact = markers.get('strike', 7 / 19), markers.get('impact', 11 / 19)
        recoil = impact + (1 - impact) * .36
        rear = envelope(phase, (0, 0), (strike, 1), (impact, 0), (1, 0))
        hit = envelope(phase, (0, 0), (strike, 0), (impact, 1), (recoil, -.22), (1, 0))
        pose('body', scale=(1 - .025 * rear + .045 * hit, 1, 1 + .09 * rear - .11 * hit),
             location=(0, 0, .07 * hit))
        pose('surfacing', location=(0, 0, .09 * rear - .025 * hit), rotation=(.035 * rear - .025 * hit, 0, 0))

        def bend(i, side, t):
            if i not in (0, 4):
                return (-.012 * rear * (1 - t) + .012 * hit * t, 0, -side * .008 * hit * t)
            whip = envelope(phase, (0, 0), (strike + .035 * t, 0),
                            (impact, 1), (recoil + .055 * t, -.25), (1, 0))
            return (.12 * rear * (1 - .35 * t) - .009 * whip,
                    0, side * (.025 * rear * t + .055 * whip * (1 - .5 * t)))

        closure = .32 * max(0, hit)

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
