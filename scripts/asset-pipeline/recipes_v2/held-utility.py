"""Portable utilities use the same reference plane and material system as weapons."""
from rigs_v2 import model, control, attach
from weapon_parts_v2 import WeaponParts
from utility_throwables_v2 import grenade, smoke, molotov, stink
from utility_devices_v2 import time_bubble, decoy, zeus, rock, spore
from utility_translocator_v2 import translocator


def build(ctx, spec):
    parts = WeaponParts(ctx, spec)
    builders = {'grenade': grenade, 'smoke': smoke, 'molotov': molotov, 'stink': stink,
                'time-bubble': time_bubble, 'translocator': translocator, 'decoy': decoy,
                'zeus': zeus, 'rock': rock, 'spore': spore}
    builders[spec['model']['construction']](parts)
    asset = model(ctx.scene)
    attach(parts.objects, asset['root'])
    asset['sockets'] = {name: control(ctx.scene, name, (point[0]-16, 16-point[1], 1), asset['root'])
                        for name, point in [('grip', spec['heldItem']['grip']), ('muzzle', spec['heldItem']['muzzle'])]}
    asset['root'].scale = (.1, .1, .1)
    return asset
