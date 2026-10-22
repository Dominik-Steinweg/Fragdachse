"""Lobby staff motions: work loops with an exported marker and a one-shot greet.

Feet stay planted and the grips stay rooted like the player's idle; the held tool turns about
its own control at the grip, the torso and head carry the effort. Markers name the frame on
which the runtime fires the matching effect (anvil sparks, stamp, spanner tap).
"""
import math


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def marker(p, name, default):
    return p.get('markerPhases', {}).get(name, default)


def apply_staff(asset, motion, phase, frame, idle, p, pose, key):
    parts = asset['parts']
    for name in parts['limbs']:
        bone = asset['rig'].pose.bones[name]
        key(bone, 'location', (0, 0, 0), frame)
        key(bone, 'rotation_euler', (0, 0, 0), frame)
    breath = 0 if idle else .5 - .5 * math.cos(math.tau * phase)
    body = dict(location=(0, 0, 0), rotation=(0, 0, 0), scale=(1 + .02 * breath, 1 + .015 * breath, 1 + .015 * breath))
    head = dict(location=(0, 0, 0), rotation=(0, 0, 0))
    tool = dict(location=(0, 0, 0), rotation=(0, 0, 0))
    if idle:
        pass
    elif motion == 'staff_work_hammer':
        # Slow lift over the shoulder, fast strike on the marker, short rebound and settle.
        strike = marker(p, 'strike', .62)
        if phase < strike - .1:
            raised = ease(phase / (strike - .1))
        elif phase < strike:
            raised = 1 - ease((phase - (strike - .1)) / .1) ** 1.6
        else:
            rebound = (phase - strike) / (1 - strike)
            raised = .18 * math.sin(math.pi * min(1, rebound * 2.2)) * (1 - rebound)
        tool['rotation'] = (-p.get('swing', 1.05) * raised, 0, 0)
        tool['location'] = (0, -.08 * raised, .16 * raised)
        impact = math.exp(-((phase - strike) / .05) ** 2)
        body['rotation'] = (p.get('lean', .09) * (impact - .4 * raised), 0, 0)
        body['location'] = (0, .04 * impact - .03 * raised, -.03 * impact)
        head['location'] = (0, .03 * impact, 0)
    elif motion == 'staff_work_ledger':
        # Write, then lift the stamp and press it down on the marker.
        stamp = marker(p, 'stamp', .7)
        lift = ease((phase - .45) / (stamp - .45)) if .45 <= phase < stamp else 0
        press = math.exp(-((phase - stamp) / .05) ** 2)
        writing = math.sin(math.tau * phase * 3) * (1 if phase < .45 else 0)
        tool['location'] = (.015 * writing, .02 * writing, .12 * lift - .02 * press)
        head['rotation'] = (.12 * (1 - lift) + .05 * press, 0, .05 * writing)
        body['rotation'] = (.05 * press, 0, 0)
    elif motion == 'staff_work_plan':
        # Reading the plan: the gaze sweeps across it; a small tap marks a point on the marker.
        sweep = math.sin(math.tau * phase)
        tap = math.exp(-((phase - marker(p, 'point', .5)) / .05) ** 2)
        head['rotation'] = (.06, 0, .22 * sweep)
        body['rotation'] = (0, 0, .06 * sweep)
        tool['rotation'] = (.12 * tap, 0, .05 * sweep)
    elif motion == 'staff_work_weigh':
        # Turning a part in the hands, a spanner tap on the marker.
        turn = math.sin(math.tau * phase)
        tap = math.exp(-((phase - marker(p, 'tap', .55)) / .045) ** 2)
        tool['rotation'] = (.35 * tap, 0, .3 * turn)
        head['rotation'] = (.08, 0, .1 * turn)
        body['rotation'] = (.04 * tap, 0, .04 * turn)
    elif motion == 'staff_greet':
        # Turn up from the work, a raised tool and two nods, back to rest at the end.
        up = math.sin(math.pi * phase)
        nod = math.sin(math.tau * 2 * phase) * up
        tool['rotation'] = (-.7 * up, 0, 0)
        tool['location'] = (0, -.06 * up, .14 * up)
        head['rotation'] = (.16 * nod, 0, 0)
        body['location'] = (0, 0, .04 * up)
        body['rotation'] = (-.05 * up, 0, 0)
    else:
        raise ValueError(f'Unknown staff motion: {motion}')
    pose('body', **body)
    pose('head', location=head['location'], rotation=head['rotation'])
    pose('tool', location=tool['location'], rotation=tool['rotation'])
