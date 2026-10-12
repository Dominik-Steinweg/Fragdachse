"""Local wind-up, aimed hold, impulse and rest with fixed projected muzzle XY."""
import math
from mathutils import Euler, Vector


def smooth(value):
    t = max(0, min(1, value))
    return t*t*(3-2*t)


def apply_cast(asset, phase, frame, idle, parameters, pose, key):
    markers = parameters['markerPhases']
    aim, release = markers['aim'], markers['release']
    if idle:
        lift = kick = 0
    elif phase <= aim:
        lift, kick = smooth(phase/aim), 0
    elif phase <= release:
        lift, kick = 1, 0
    else:
        t = (phase-release)/(1-release)
        lift = 1-smooth(t)
        kick = math.sin(math.pi*min(1, t*2))*(1-t)
    rotation = (.28*lift-.22*kick, 0, -.065*lift+.07*kick)
    tip = Vector(asset['parts']['cast_tip_offset'])
    offset = tip-Euler(rotation, 'XYZ').to_matrix()@tip
    offset.z += .09*lift
    pose('right_arm', location=tuple(offset), rotation=rotation)
    pose('left_arm', rotation=(.16*lift, 0, -.10*lift))
    pose('body')
    pose('head', rotation=(0, 0, -.025*lift))
    pose('tail')
    for name in asset['parts']['limbs']:
        bone = asset['rig'].pose.bones[name]
        key(bone, 'location', (0, 0, 0), frame)
        key(bone, 'rotation_euler', (0, 0, 0), frame)
