"""Compact player-faction salvage delivery crate with an exposed carry handle."""
from dawn_parts import root,finish,supply_palette,supply_crate


def build(c,spec):
    pivot=root(c);p=supply_palette(c)
    supply_crate(c,(0,0,0),1,0,p).parent=pivot
    return finish(c,pivot)
