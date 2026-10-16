"""Kabummtula (kaboomtula) motions: idle, skitter (move), web spit (claw), threat pose (alert), leap.

Placeholder until gate GA1 (form) is approved: the clips are authored for the approved rig in the
animation draft step (GA2). Every motion fails explicitly instead of baking an unreviewed pose.
"""

SUPPORTED_MOTIONS = ('kaboomtula_idle', 'kaboomtula_skitter', 'kaboomtula_spit', 'kaboomtula_alert', 'kaboomtula_leap')


def apply_kaboomtula(asset, motion, phase, frame, idle_pose, p, pose, key):
    if motion not in SUPPORTED_MOTIONS:
        raise ValueError(f'Unknown kaboomtula motion: {motion}')
    raise ValueError(f'Kabummtula motion not authored yet (after GA1): {motion}')
