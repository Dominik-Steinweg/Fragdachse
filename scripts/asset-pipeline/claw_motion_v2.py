"""A planted, bilateral claw strike with explicit anticipation and contact poses."""


def smooth(t):
    t = max(0, min(1, t))
    return t * t * (3 - 2 * t)


def apply_claw(asset, phase, frame, idle, parameters, pose, key):
    strike = parameters.get('strikePhase', 8 / 17)
    impact = parameters.get('impactPhase', 11 / 17)
    if idle:
        pull = reach = 0
    elif phase <= strike:
        pull, reach = smooth(phase / strike), 0
    elif phase <= impact:
        t = smooth((phase - strike) / (impact - strike))
        pull, reach = 1 - t, t
    else:
        pull, reach = 0, 1 - smooth((phase - impact) / (1 - impact))
    strength = parameters.get('strength', 1)
    pull *= strength
    reach *= strength
    parts = asset['parts']
    biped = bool(parts.get('claw_bones'))
    for name in parts['limbs']:
        bone = asset['rig'].pose.bones[name]
        front = name.startswith('front_')
        side = -1 if 'left' in name else 1
        location = (side * (.045 * pull - .10 * reach), -.23 * pull + .30 * reach, .12 * pull + .04 * reach) if front else (0, 0, 0)
        rotation = (-.18 * pull + .20 * reach, 0, side * (-.15 * pull + .26 * reach)) if front else (.035 * pull, 0, 0)
        key(bone, 'location', location, frame)
        key(bone, 'rotation_euler', rotation, frame)
    pose('body', location=(0, -.09 * pull + .035 * reach, .035 * pull), rotation=(.045 * pull - .020 * reach, 0, 0))
    pose('head', location=(0, -.018 * pull + .01 * reach, 0))
    pose('tail', rotation=(0, 0, 0))
    for name in ('brood', 'load', 'rear_body'):
        pose(name, location=(0, -.025 * pull + .015 * reach, 0))
    if biped:
        translation = (0, -.20 * pull + .10 * reach, .07 * pull)
        for name in parts['claw_bones']:
            key(asset['rig'].pose.bones[name], 'location', translation, frame)
        pose('claw_weapon', location=translation)
