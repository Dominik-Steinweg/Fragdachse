"""Clips of rechargeable reactive props.

Puffball: `swell` inflates before the burst, `burst` folds the dome lobes outward
while the body sags, `refill` is scrubbed by the recharge progress and closes the
lobes again. Hive: `shake` rocks the skep (loop), `release` jolts it once.
Idle is always the authored rest pose.
"""
import math


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def apply_reactive_prop(asset, motion, phase, frame, idle, p, pose, key):
    parts = asset['parts']
    if motion.startswith('puffball_'):
        lobes = sorted(name for name in parts if name.startswith('lobe'))
        opened = sagged = swollen = shiver = 0.0
        if idle:
            pass
        elif motion == 'puffball_swell':
            swollen = smooth(phase)
            shiver = math.sin(phase * math.pi * 4) * (1 - phase) * .6
        elif motion == 'puffball_burst':
            # The dome tears open fast; the empty sack settles a little later.
            opened = smooth(phase / .45)
            sagged = smooth((phase - .1) / .75)
            swollen = 1 - smooth(phase / .3)
            shiver = math.sin(phase * math.pi * 6) * (1 - phase) * .8
        elif motion == 'puffball_refill':
            # Phase is the recharge progress: 0 = just burst, 1 = whole again.
            sagged = 1 - smooth(phase / .85)
            opened = 1 - smooth((phase - .2) / .7)
        else:
            raise ValueError(f'Unknown puffball motion: {motion}')
        grow = p.get('swell', .075) * swollen
        sag = p.get('sag', .42) * sagged
        spread = p.get('spread', .04) * sagged
        pose('body', scale=(1 + grow + spread, 1 + grow + spread, 1 + grow * 1.1 - sag))
        for i, name in enumerate(lobes):
            vary = ((i * 37) % 11) / 10
            pose(name, rotation=(0, opened * math.radians(p.get('openDegrees', 92) + 14 * vary), 0))
        twitch = p.get('companionTwitch', .05) * shiver
        pose('small', scale=(1 + twitch, 1 + twitch, 1 - twitch))
    elif motion.startswith('hive_'):
        if idle:
            pose('skep')
        elif motion == 'hive_shake':
            angle = math.tau * phase
            pose('skep', rotation=(math.radians(p.get('tilt', 3.0)) * math.sin(angle),
                                   math.radians(p.get('tilt', 3.0)) * .8 * math.cos(2 * angle),
                                   math.radians(p.get('twist', 4.0)) * math.sin(2 * angle + .6)))
        elif motion == 'hive_release':
            bump = math.sin(math.pi * min(1.0, phase / .35))
            settle = (1 - phase) ** 2
            pose('skep', location=(0, 0, p.get('lift', .035) * bump),
                 rotation=(math.radians(5) * settle * math.sin(phase * math.pi * 5), 0,
                           math.radians(6) * settle * math.sin(phase * math.pi * 4 + .5)),
                 scale=(1 + .045 * bump, 1 + .045 * bump, 1 + .06 * bump))
        else:
            raise ValueError(f'Unknown hive motion: {motion}')
    else:
        raise ValueError(f'Unknown reactive prop motion: {motion}')
