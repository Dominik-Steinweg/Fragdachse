"""Bilateral pounce: coil, launch, extended contact, landing and recoil to rest."""


def smooth(t):
    t = max(0, min(1, t))
    return t * t * (3 - 2 * t)


def apply_claw(asset, phase, frame, idle, parameters, pose, key):
    strike = parameters.get('strikePhase', 8 / 17)
    impact = parameters.get('impactPhase', 11 / 17)
    if idle:
        pull = reach = follow = airborne = 0
    elif phase <= strike:
        pull, reach, follow, airborne = smooth(phase / strike), 0, 0, 0
    elif phase <= impact:
        t = smooth((phase - strike) / (impact - strike))
        pull, reach, follow = 1 - t, t, 0
        airborne = 4 * t * (1 - t)
    else:
        recovery = (phase - impact) / (1 - impact)
        # One pose continues past contact before landing and returning to the pivot.
        reach = 1 - smooth(max(0, (recovery - 1 / 6) * 6 / 5))
        follow = smooth(recovery * 6) * reach
        pull = airborne = 0
    strength = parameters.get('strength', 1)
    pull *= strength
    reach *= strength
    parts = asset['parts']
    biped = bool(parts.get('claw_bones'))
    distance = parameters['leapDistance']
    pose('attack_motion', location=(0, distance * (-.24 * pull + reach + .12 * follow), .32 * airborne),
         scale=(1 + .08 * pull - .05 * reach, 1 - .12 * pull + .12 * reach, 1 - .12 * pull))
    for name in parts['limbs']:
        bone = asset['rig'].pose.bones[name]
        front = name.startswith('front_')
        side = -1 if 'left' in name else 1
        location = (side * (.13 * pull + .04 * reach), -.38 * pull + .42 * reach, .22 * pull + .08 * reach) if front else (side * .06 * pull, .20 * pull - .28 * reach, .10 * airborne)
        rotation = (-.32 * pull + .28 * reach, 0, side * (-.24 * pull + .13 * reach)) if front else (.20 * pull - .24 * reach, 0, side * .10 * reach)
        key(bone, 'location', location, frame)
        key(bone, 'rotation_euler', rotation, frame)
    pose('body', location=(0, -.12 * pull + .06 * reach, -.08 * pull), rotation=(.12 * pull - .08 * reach, 0, 0))
    pose('head', location=(0, -.045 * pull + .04 * reach, .03 * pull))
    pose('tail', rotation=(.18 * pull - .14 * reach, 0, 0))
    for name in ('brood', 'load', 'rear_body'):
        pose(name, location=(0, -.055 * pull - .035 * reach, -.04 * pull))
    if biped:
        translation = (0, -.34 * pull + .36 * reach, .16 * pull + .06 * reach)
        for name in parts['claw_bones']:
            key(asset['rig'].pose.bones[name], 'location', translation, frame)
        pose('claw_weapon', location=translation)
