"""North-facing folded relay in the placement-utility reference plane."""
import math
from fire_control_parts import relay
from rigs_v2 import control


def build(c, spec):
    asset = relay(c)
    for i in range(3):
        asset['parts'][f'relay_leg_{i}'].rotation_euler.x = math.radians(78)
    # Compact head and folded feet sit just north of the established grip.
    for ob in list(asset['root'].children):
        ob.location *= .62
        ob.scale *= .62
        ob.location.y -= .49
    for name in ('grip', 'muzzle'):
        x, y = spec['heldItem'][name]
        asset['sockets'][name] = control(c.scene, name, ((x-16)*.1, (16-y)*.1, .2), asset['root'])
    return asset
