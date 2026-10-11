"""Kraken brood egg: a slow ember heartbeat, then the shell petals burst open.

Same call contract as apply_kraken; petals pivot on their own bones near the base
and open outward about their tangent axis.
"""
import math
from mathutils import Quaternion, Vector

SUPPORTED = ('kraken_egg_idle', 'kraken_egg_hatch')


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def apply_kraken_egg(asset, motion, phase, frame, idle, p, pose, key):
    if motion not in SUPPORTED:
        raise ValueError(f'Unknown Kraken egg motion: {motion}')
    beat, opening, burst, glow = 0, 0, 1, p.get('idleEmission', 2.5)
    if not idle and motion == 'kraken_egg_idle':
        # Double heartbeat: a strong pulse and a weaker echo.
        cycle = phase % 1
        beat = math.exp(-((cycle - .18) / .07) ** 2) + .55 * math.exp(-((cycle - .40) / .07) ** 2)
        glow += p.get('pulseEmission', 3) * beat
    elif not idle:
        crack = smooth(0, .30, phase)
        opening = smooth(.22, .62, phase)
        beat = 1.4 * math.sin(math.pi * smooth(0, .3, phase))
        burst = 1 + .9 * smooth(.25, .45, phase) - 1.9 * smooth(.45, .75, phase)
        glow += 7 * smooth(.15, .35, phase) * (1 - smooth(.4, .8, phase)) - (glow) * smooth(.6, 1, phase)
        opening += .04 * crack * math.sin(phase * 60) * (1 - opening)
    scale = max(.001, burst) * (1 + .06 * beat)
    pose('core', scale=(scale, scale, scale))
    for k, name in enumerate(asset['parts']['petals']):
        u = math.radians(90 * k + 45)
        tangent = Vector((-math.sin(u), math.cos(u), 0))
        angle = math.radians(118) * opening * (1 + .08 * math.sin(k * 2.1))
        key(asset['rig'].pose.bones[name], 'rotation_euler', Quaternion(tangent, angle).to_euler('XYZ'), frame)
        key(asset['rig'].pose.bones[name], 'location', (0, 0, 0), frame)
    socket = asset['parts'].get('emission')
    if socket is not None:
        socket.default_value = max(0, glow)
        socket.keyframe_insert(data_path='default_value', frame=frame)
