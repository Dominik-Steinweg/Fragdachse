"""Demon badger motions: idle breathing, heat burst (claw-free shock around itself) and void spit.

Controls come from recipes_v2/demon-badger.py. `body`, `head` and `tail` are object controls at
the asset origin; head and tail turn about the recipe's `neck_pivot` / `tail_pivot` through a
compensating translation. `flare_l` / `flare_r` (scapular plate with shoulder horn and seams) pivot
at the inner plate edge, `spine_flare` (spinal shield) at mid-back and `jaw` at its hinge.
`throat_glow` is the throat seam's flare factor (0 rest .. 1 full void flare). Euler X lifts the
front of a forward-pointing part, so a positive head pitch raises the nose and a negative tail pitch
raises the tail tip. Every call keys every control and limb bone, so no clip inherits a pose, and
the one-shots reach the exact rest pose on their last frame. No clip travels in XY; the runtime
owns travel.
"""
import math
from mathutils import Euler, Vector

SUPPORTED_MOTIONS = ('demon_idle', 'demon_burst', 'demon_spit')
ZERO = (0, 0, 0)


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def envelope(phase, *points):
    """Smooth beats with exact plateaus and exact endpoints."""
    if phase <= points[0][0]:
        return points[0][1]
    for (a, value), (b, target) in zip(points, points[1:]):
        if phase <= b:
            return value + (target - value) * smooth(a, b, phase)
    return points[-1][1]


def wrapped(phase, centre, width):
    """Periodic Gaussian bump: exact loop closure."""
    d = abs(phase - centre) % 1
    d = min(d, 1 - d)
    return math.exp(-(d / width) ** 2)


def pivoted(pivot, rotation, location=ZERO):
    """Translation that turns an origin control about `pivot`, plus an extra offset."""
    p = Vector(pivot)
    return tuple(p - Euler(rotation, 'XYZ').to_matrix() @ p + Vector(location))


def key_pose(asset, frame, pose, key, body=(ZERO, ZERO, (1, 1, 1)), head=(ZERO, ZERO), tail=(ZERO, ZERO),
             flare=(0, 0, 0), spine=(0, 0), jaw=(0, 0, 0), throat=0, limbs=None):
    """head/tail = (rotation about the pivot, offset); flare = (splay, roll, grow) per side;
    spine = (spread, rise); jaw = (open, slide, widen); limbs(name, side, front) -> (location, rotation)."""
    parts = asset['parts']
    pose('body', location=body[0], rotation=body[1], scale=body[2])
    pose('head', location=pivoted(parts['neck_pivot'], head[0], head[1]), rotation=head[0])
    pose('tail', location=pivoted(parts['tail_pivot'], tail[0], tail[1]), rotation=tail[0])
    splay, roll, grow = flare
    for key_name, side in (('l', -1), ('r', 1)):
        pose('flare_' + key_name, location=(0, 0, .03 * roll), rotation=(0, -side * roll, -side * splay), scale=(1 + grow,) * 3)
    spread, rise = spine
    pose('spine_flare', location=(0, 0, .03 * rise), scale=(1 + spread, 1, 1 + rise))
    opened, slide, widen = jaw
    pose('jaw', location=(0, slide, 0), rotation=(-opened, 0, 0), scale=(1 + widen, 1, 1))
    socket = parts['throat_glow']
    socket.default_value = parts['throat_glow_rest'] + throat
    socket.keyframe_insert(data_path='default_value', frame=frame)
    for name in parts['limbs']:
        bone = asset['rig'].pose.bones[name]
        location, rotation = limbs(name, -1 if 'left' in name else 1, name.startswith('front_')) if limbs else (ZERO, ZERO)
        key(bone, 'location', location, frame)
        key(bone, 'rotation_euler', rotation, frame)


def idle(asset, phase, frame, p, pose, key):
    """Slow heavy breathing that lifts the plates, a wary head sway and one quick tail flick."""
    angle = math.tau * phase
    breath = (.5 - .5 * math.cos(angle)) * p.get('breath', 1)
    sway = math.sin(angle) * p.get('headSway', 1)
    flick = (wrapped(phase, .62, .07) - wrapped(phase, .74, .06) * .55) * p.get('tailFlick', 1)
    key_pose(asset, frame, pose, key,
             body=((0, -.012 * breath, .012 * breath), (.018 * breath, 0, .016 * sway), (1 + .035 * breath, 1 + .015 * breath, 1 + .035 * breath)),
             head=((.035 * breath, 0, .14 * sway), (0, -.015 * breath, .008 * breath)),
             tail=((-.10 * breath - .05 * abs(flick), 0, .48 * flick), ZERO),
             flare=(.04 * breath, .05 * breath, .03 * breath), spine=(.08 * breath, .10 * breath))


def burst(asset, phase, frame, p, pose, key):
    """Crouch, then at `blast` the plates, spine and horns flare, head and tail rise; recoil to rest."""
    blast = p['markerPhases']['blast']
    step = blast / 3
    crouch = envelope(phase, (0, 0), (blast - step, 1), (blast, 0)) * p.get('crouch', 1)
    flare = envelope(phase, (0, 0), (blast - step, 0), (blast, 1), (blast + step, .85), (1, 0)) * p.get('flare', 1)
    pop = envelope(phase, (0, 0), (blast - step, 0), (blast, 1), (blast + step, .55), (1 - step, 0), (1, 0)) * p.get('recoil', 1)

    def limbs(name, side, front):
        brace = (side * (.035 * crouch + .05 * pop), .04 * crouch - .03 * pop, 0) if front else (side * (.02 * crouch + .03 * pop), -.03 * crouch, 0)
        return brace, ((-.10 * crouch + .06 * pop) if front else .06 * crouch, 0, side * (.06 * crouch - .08 * pop))
    key_pose(asset, frame, pose, key,
             body=((0, -.03 * crouch - .07 * pop, -.07 * crouch + .045 * pop), (-.07 * crouch + .07 * pop, 0, 0),
                   (1 + .07 * crouch + .05 * pop, 1 - .07 * crouch + .03 * pop, 1 - .09 * crouch + .07 * pop)),
             head=((-.12 * crouch + .26 * pop, 0, 0), (0, -.08 * crouch - .02 * pop, -.035 * crouch)),
             tail=((.12 * crouch - .55 * pop, 0, 0), ZERO),
             flare=(.36 * flare, .22 * flare, .16 * flare), spine=(.45 * flare, .55 * flare),
             jaw=(.35 * pop, .05 * pop, .06 * pop), limbs=limbs)


def spit(asset, phase, frame, p, pose, key):
    """Chest heaves, head thrusts, the jaw tears open at `release` with the throat flaring; recoil."""
    release = p['markerPhases']['release']
    step = release / 4
    heave = envelope(phase, (0, 0), (release - 2 * step, 1), (release - step, .8), (release, 0)) * p.get('heave', 1)
    thrust = envelope(phase, (0, 0), (release - 2 * step, 0), (release, 1), (release + step, .8), (release + 2 * step, 0)) * p.get('thrust', 1)
    jaw = envelope(phase, (0, 0), (release - step, .15), (release, 1), (release + step, .85), (release + 2 * step, .35), (1 - step, .05), (1, 0)) * p.get('jawOpen', 1)
    glow = envelope(phase, (0, 0), (release - 2 * step, .3), (release, 1), (release + step, .75), (1 - 2 * step, .15), (1, 0)) * p.get('throatFlare', 1)
    recoil = envelope(phase, (0, 0), (release + step, 0), (release + 2 * step, 1), (1 - step, .2), (1, 0))

    def limbs(name, side, front):
        if front:
            return (side * .02 * thrust, .045 * thrust - .02 * recoil, 0), (.08 * thrust, 0, -side * .04 * thrust)
        return (0, -.02 * heave, 0), (.04 * heave, 0, 0)
    key_pose(asset, frame, pose, key,
             body=((0, -.04 * heave + .06 * thrust - .05 * recoil, .015 * heave), (.05 * heave - .04 * thrust + .03 * recoil, 0, 0),
                   (1 + .09 * heave - .02 * thrust, 1 + .04 * heave, 1 + .08 * heave - .03 * thrust)),
             head=((.16 * heave + .10 * thrust + .06 * recoil, 0, 0), (0, -.08 * heave + .20 * thrust - .07 * recoil, .02 * heave)),
             tail=((-.08 * heave + .05 * recoil, 0, .14 * recoil), ZERO),
             flare=(.08 * heave, .06 * heave, .08 * heave), spine=(.14 * heave, .14 * heave),
             jaw=(.55 * jaw, .24 * jaw, .20 * jaw), throat=glow, limbs=limbs)


def apply_demon_badger(asset, motion, phase, frame, idle_pose, parameters, pose, key):
    if motion not in SUPPORTED_MOTIONS:
        raise ValueError(f'Unknown demon badger motion: {motion}')
    if idle_pose:
        key_pose(asset, frame, pose, key)
    elif motion == 'demon_idle':
        idle(asset, phase, frame, parameters, pose, key)
    elif motion == 'demon_burst':
        burst(asset, phase, frame, parameters, pose, key)
    else:
        spit(asset, phase, frame, parameters, pose, key)
