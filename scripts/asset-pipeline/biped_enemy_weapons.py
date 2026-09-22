"""Reuse the authored held-weapon geometry, scaled into the stable badger grip."""
import importlib.util
import json
from pathlib import Path
from weapon_parts_v2 import WeaponParts
from rigs_v2 import control, attach


def equip(c,asset,kind):
    base=Path(__file__).resolve().parent
    entry='held-plasma' if kind=='alien' else 'held-glock'
    spec=next(a for a in json.loads((base/'catalog-v2.json').read_text(encoding='utf-8'))['assets'] if a['id']==entry)
    module_spec=importlib.util.spec_from_file_location('enemy_held_weapon',base/'recipes_v2/held-weapon.py')
    recipe=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(recipe)
    parts=WeaponParts(c,spec);parts.grip()
    if kind=='alien':recipe.energy(parts,'plasma')
    else:recipe.pistol(parts)
    mount=control(c.scene,'Stable enemy weapon grip',parent=asset['root'])
    attach(parts.objects,mount)
    scale=.037 if kind=='alien' else .044
    mount.scale=(scale,scale,scale)
    gx,gy=spec['heldItem']['grip']
    mount.location=(-(gx-16)*scale,.68-(16-gy)*scale,1.48)
    for ob in parts.objects:ob['motionRole']='held-weapon';ob['heldWeaponAsset']=entry
    asset['sockets']['held-weapon']=mount
    return parts.objects
